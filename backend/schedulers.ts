/**
 * schedulers.ts
 * Background scheduled tasks for the 3i Learning server.
 * Extracted from server/routes.ts (Phase 2 refactor — T-07).
 *
 * Two schedulers run on a configurable interval:
 *
 * 1. Live Class 30-min Reminder (every 60 seconds)
 *    Finds classes starting in 29–31 minutes and sends push notifications
 *    to enrolled students (or all students for free/public classes).
 *    Uses a PostgreSQL session-level advisory lock (T-14) so that only ONE
 *    process fires notifications when multiple PM2 instances are running.
 *    A process-local Set provides a second layer of deduplication within
 *    a single process lifetime.
 *
 * 2. Download Token Cleanup (every 5 minutes)
 *    Deletes expired and already-used download tokens from the DB,
 *    keeping the download_tokens table from growing unboundedly.
 *
 * In multi-instance deployments the advisory lock handles coordination
 * automatically. The RUN_BACKGROUND_SCHEDULERS=false escape hatch is still
 * supported for complete disablement on worker-only instances.
 */

import { deleteDownloadsForUser } from "./download-utils";
import { getRedisClient } from "./redis-client";
import { filterNewNotificationRecipientsRedis } from "./redis-notification-dedup";

/**
 * Stable numeric key used for pg_try_advisory_lock / pg_advisory_unlock.
 * This value is arbitrary but must be unique across all advisory lock usages
 * in this codebase and must never change once deployed.
 */
const LIVE_NOTIF_ADVISORY_LOCK_KEY = 31415926535;

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
};

/**
 * Minimal interface for acquiring a dedicated connection from the pg.Pool.
 * We need a dedicated connection (not just pool.query) because advisory locks
 * are session-scoped — they must be acquired and released on the same connection.
 */
type DbPool = DbClient & {
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    release: () => void;
  }>;
};

type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

type SendPushToUsersFn = (
  db: DbClient,
  userIds: number[],
  payload: PushPayload
) => Promise<unknown>;

/**
 * Start all background schedulers.
 * Call once during server startup, after the DB pool and push notification
 * service are ready.
 *
 * @param db              The main database client (wrapped pool with slow-query logging)
 * @param pool            The raw pg.Pool — needed to acquire dedicated connections for advisory locks
 * @param sendPushToUsers Push notification sender from push-notifications.ts
 */
export function startSchedulers(
  db: DbClient,
  pool: DbPool,
  sendPushToUsers: SendPushToUsersFn
): void {
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";

  if (!runBackgroundSchedulers) {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
    return;
  }

  startLiveClassNotificationScheduler(db, pool, sendPushToUsers);
  startDownloadCleanupRetryScheduler(db);
  startDownloadTokenCleanupScheduler(db);
  startStuckLiveClassCleanupScheduler(db);
}

/**
 * Scheduler: retry offline download cleanup when it previously failed.
 * Runs every 10 minutes and clears `enrollments.download_cleanup_pending` on success.
 */
function startDownloadCleanupRetryScheduler(db: DbClient): void {
  const retryIntervalMs = 10 * 60 * 1000;
  const retryNow = async (): Promise<void> => {
    try {
      const pending = await db.query(
        `SELECT id, user_id, course_id
         FROM enrollments
         WHERE download_cleanup_pending = TRUE
         LIMIT 200`
      );

      for (const row of pending.rows) {
        const enrollmentId = Number(row.id);
        const userId = Number(row.user_id);
        const courseId = Number(row.course_id);
        if (!Number.isFinite(enrollmentId) || !Number.isFinite(userId) || !Number.isFinite(courseId)) continue;

        try {
          await deleteDownloadsForUser(db, userId, courseId);
          await db.query(
            "UPDATE enrollments SET download_cleanup_pending = FALSE WHERE id = $1",
            [enrollmentId]
          );
        } catch (err) {
          console.error("[CleanupRetry] cleanup failed; will retry later", {
            enrollmentId,
            userId,
            courseId,
          });
        }
      }
    } catch (err) {
      console.error("[CleanupRetry] scheduler error:", err);
    }
  };

  void retryNow();
  setInterval(() => void retryNow(), retryIntervalMs);
}

/**
 * Scheduler 1: Live class 30-minute reminder notifications.
 * Runs every 60 seconds. Sends a push + in-app notification to students
 * enrolled in a class that starts in ~30 minutes.
 *
 * Multi-instance safety: acquires a PostgreSQL session-level advisory lock
 * (LIVE_NOTIF_ADVISORY_LOCK_KEY) before doing any work. If another PM2 instance
 * already holds the lock, this tick is skipped immediately — no double notifications.
 * The lock is always released in a finally block, even if an error occurs.
 *
 * Deduplication uses Redis SET NX when REDIS_URL is set; otherwise the
 * `notifications_sent` table keyed on (class_id, user_id, type).
 */
function startLiveClassNotificationScheduler(
  db: DbClient,
  pool: DbPool,
  sendPushToUsers: SendPushToUsersFn
): void {
  setInterval(async () => {
    // Acquire a dedicated connection for the advisory lock.
    // Advisory locks are session-scoped: they must be acquired and released
    // on the same connection, which pool.query() does NOT guarantee.
    let lockClient: Awaited<ReturnType<DbPool["connect"]>> | null = null;
    let lockAcquired = false;

    try {
      lockClient = await pool.connect();

      const lockResult = await lockClient.query(
        "SELECT pg_try_advisory_lock($1) AS acquired",
        [LIVE_NOTIF_ADVISORY_LOCK_KEY]
      );
      lockAcquired = lockResult.rows[0]?.acquired === true;

      if (!lockAcquired) {
        // Another instance is handling this tick — skip silently.
        return;
      }

      const now = Date.now();

      // Bound notifications_sent so it doesn't grow unboundedly.
      await db.query("DELETE FROM notifications_sent WHERE sent_at < $1", [now - 24 * 60 * 60 * 1000]);

      const minScheduleAt = now + 29 * 60 * 1000;
      const maxScheduleAt = now + 31 * 60 * 1000;

      const classes = await db.query(
        `SELECT lc.id, lc.title, lc.course_id, lc.is_free_preview, lc.is_public
         FROM live_classes lc
         WHERE lc.is_completed IS NOT TRUE
           AND lc.is_live IS NOT TRUE
           AND lc.notify_bell = TRUE
           AND lc.scheduled_at IS NOT NULL
           AND lc.scheduled_at BETWEEN $1 AND $2
         ORDER BY lc.scheduled_at ASC
         LIMIT 50`,
        [minScheduleAt, maxScheduleAt]
      );

      for (const lc of classes.rows) {
        const expiresAt = now + 6 * 3600000;

        const notifTitle = "⏰ Live Class in 30 minutes!";
        const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;

        // Batch size for push delivery — avoids overwhelming the push service
        // with a single unbounded fanout. 200 ms pause between batches.
        const PUSH_BATCH_SIZE = 500;
        const dedupType = "live_class_reminder_30min";

        let recipientIds: number[] = [];
        const redis = await getRedisClient();

        if (redis) {
          const candidates = !lc.course_id || lc.is_free_preview === true || lc.is_public === true
            ? await db.query(
                `SELECT u.id::int AS user_id FROM users u WHERE u.role = 'student'`,
                []
              )
            : await db.query(
                `SELECT e.user_id::int AS user_id
                 FROM enrollments e
                 WHERE e.course_id = $1::int
                   AND (e.status = 'active' OR e.status IS NULL)
                   AND (e.valid_until IS NULL OR e.valid_until > $2::bigint)`,
                [lc.course_id, now]
              );
          const candidateIds = candidates.rows.map((r: { user_id: number }) => Number(r.user_id));
          recipientIds = await filterNewNotificationRecipientsRedis(
            redis,
            lc.id,
            candidateIds,
            dedupType
          );
          if (recipientIds.length) {
            await db.query(
              `INSERT INTO notifications_sent (class_id, user_id, type)
               SELECT $1::int, u_id::int, $2::text
               FROM unnest($3::int[]) AS u_id
               ON CONFLICT (class_id, user_id, type) DO NOTHING`,
              [lc.id, dedupType, recipientIds]
            );
          }
        } else if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
          const inserted = await db.query(
            `INSERT INTO notifications_sent (class_id, user_id, type)
             SELECT $1::int, u.id::int, $2::text
             FROM users u
             WHERE u.role = 'student'
             ON CONFLICT (class_id, user_id, type) DO NOTHING
             RETURNING user_id`,
            [lc.id, dedupType]
          );
          recipientIds = inserted.rows.map((r: { user_id: number }) => Number(r.user_id));
        } else {
          const inserted = await db.query(
            `INSERT INTO notifications_sent (class_id, user_id, type)
             SELECT $1::int, e.user_id::int, $2::text
             FROM enrollments e
             WHERE e.course_id = $3::int
               AND (e.status = 'active' OR e.status IS NULL)
               AND (e.valid_until IS NULL OR e.valid_until > $4::bigint)
             ON CONFLICT (class_id, user_id, type) DO NOTHING
             RETURNING user_id`,
            [lc.id, dedupType, lc.course_id, now]
          );
          recipientIds = inserted.rows.map((r: { user_id: number }) => Number(r.user_id));
        }

        // If nobody was newly inserted into notifications_sent, we already sent
        // this reminder for this class+type.
        if (!recipientIds.length) continue;

        // Create in-app notifications only for recipients we haven't notified yet.
        await db.query(
          `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
           SELECT u_id::int, $1::text, $2::text, 'info', $3::bigint, $4::bigint
           FROM unnest($5::int[]) AS u_id`,
          [notifTitle, notifMessage, now, expiresAt, recipientIds]
        );

        for (let i = 0; i < recipientIds.length; i += PUSH_BATCH_SIZE) {
          const batch = recipientIds.slice(i, i + PUSH_BATCH_SIZE);
          await sendPushToUsers(db, batch, {
            title: notifTitle,
            body: notifMessage,
            data: !lc.course_id || lc.is_free_preview === true || lc.is_public === true
              ? { type: "live_class_reminder", liveClassId: lc.id }
              : { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id },
          });
          if (i + PUSH_BATCH_SIZE < recipientIds.length) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }

        console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${recipientIds.length}`);
      }

      // dedup: Redis SET NX when configured, else notifications_sent (PostgreSQL).
    } catch (err) {
      console.error("[LiveNotif] Scheduler error:", err);
    } finally {
      // Always release the advisory lock and return the connection to the pool,
      // even if an error was thrown during the notification work.
      if (lockClient) {
        if (lockAcquired) {
          try {
            await lockClient.query(
              "SELECT pg_advisory_unlock($1)",
              [LIVE_NOTIF_ADVISORY_LOCK_KEY]
            );
          } catch (unlockErr) {
            console.error("[LiveNotif] Failed to release advisory lock:", unlockErr);
          }
        }
        lockClient.release();
      }
    }
  }, 60 * 1000);

  console.log("[LiveNotif] Scheduler started — checks every 60s");
}

/**
 * Scheduler 2: Stuck live-class cleanup.
 * Runs every 15 minutes. Clears the is_live flag on any class that has been
 * marked live for over 6 hours — this handles the case where the Cloudflare
 * Stream webhook that sets is_live=FALSE was lost (network error, cold restart,
 * etc.), leaving the class permanently "live" in the UI.
 *
 * 21600000 ms = 6 hours in milliseconds.
 * The cast to BIGINT epoch arithmetic matches the JavaScript Date.now() values
 * stored in started_at.
 */
async function clearStuckLiveClasses(db: DbClient): Promise<void> {
  try {
    const result = await db.query(`
      UPDATE live_classes
      SET is_live = FALSE
      WHERE is_live = TRUE
        AND started_at IS NOT NULL
        AND started_at < EXTRACT(EPOCH FROM NOW()) * 1000 - 21600000
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[StuckLiveCleanup] Cleared is_live flag on ${result.rowCount} stuck class(es)`);
    }
  } catch (err) {
    console.error("[StuckLiveCleanup] Error clearing stuck live classes:", err);
  }
}

function startStuckLiveClassCleanupScheduler(db: DbClient): void {
  // Run immediately on startup to fix any classes stuck before the server restarted,
  // then repeat every 15 minutes.
  clearStuckLiveClasses(db);
  setInterval(() => clearStuckLiveClasses(db), 15 * 60 * 1000);
  console.log("[StuckLiveCleanup] Scheduler started — runs every 15 minutes");
}

/**
 * Scheduler 3: Download token cleanup.
 * Runs every 5 minutes. Deletes expired and already-used download tokens
 * in batches of 2000 to avoid long-running DELETE operations.
 */
function startDownloadTokenCleanupScheduler(db: DbClient): void {
  setInterval(async () => {
    try {
      // Delete ALL expired tokens — both used and unused (abandoned registrations).
      // Previously only used=TRUE tokens were cleaned, leaving unused-but-expired
      // tokens to accumulate indefinitely.
      const result = await db.query(
        `DELETE FROM download_tokens
         WHERE id IN (
           SELECT id
           FROM download_tokens
           WHERE expires_at < $1
           ORDER BY expires_at ASC
           LIMIT 2000
         )`,
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[TokenCleanup] Deleted ${result.rowCount} expired tokens`);
      }
    } catch (err) {
      console.error("[TokenCleanup] Error:", err);
    }
  }, 5 * 60 * 1000);

  console.log("[TokenCleanup] Scheduler started — runs every 5 minutes");
}
