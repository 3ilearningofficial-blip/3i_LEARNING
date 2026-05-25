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
 *    Uses a process-local Set for deduplication (see Phase 4 T-17 for
 *    the multi-instance distributed lock improvement).
 *
 * 2. Download Token Cleanup (every 5 minutes)
 *    Deletes expired and already-used download tokens from the DB,
 *    keeping the download_tokens table from growing unboundedly.
 *
 * In multi-instance deployments, set RUN_BACKGROUND_SCHEDULERS=false on all
 * instances except one to prevent duplicate push notifications.
 */

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
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
 * @param db           The main database client
 * @param sendPushToUsers  Push notification sender from push-notifications.ts
 */
export function startSchedulers(
  db: DbClient,
  sendPushToUsers: SendPushToUsersFn
): void {
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";

  if (!runBackgroundSchedulers) {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
    return;
  }

  startLiveClassNotificationScheduler(db, sendPushToUsers);
  startDownloadTokenCleanupScheduler(db);
}

/**
 * Scheduler 1: Live class 30-minute reminder notifications.
 * Runs every 60 seconds. Sends a push + in-app notification to students
 * enrolled in a class that starts in ~30 minutes.
 *
 * process-local sentNotifications Set prevents duplicate sends within
 * a single process lifetime. For multi-process safety see Phase 4 T-17.
 */
function startLiveClassNotificationScheduler(
  db: DbClient,
  sendPushToUsers: SendPushToUsersFn
): void {
  // process-local dedupe — prevents re-sending within same process restart cycle
  const sentNotifications = new Set<string>();

  setInterval(async () => {
    try {
      const now = Date.now();
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
        const key30 = `30min_${lc.id}`;

        if (!sentNotifications.has(key30)) {
          sentNotifications.add(key30);
          const notifTitle = "⏰ Live Class in 30 minutes!";
          const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;

          if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
            // Free/public class — notify all students
            const inserted = await db.query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u.id, $1, $2, 'info', $3, $4
               FROM users u
               WHERE u.role = 'student'
               RETURNING user_id`,
              [notifTitle, notifMessage, now, expiresAt]
            );
            await sendPushToUsers(
              db,
              inserted.rows.map((r: any) => Number(r.user_id)),
              {
                title: notifTitle,
                body: notifMessage,
                data: { type: "live_class_reminder", liveClassId: lc.id },
              }
            );
            console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
          } else {
            // Paid class — notify enrolled students only
            const inserted = await db.query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT e.user_id, $1, $2, 'info', $3, $4
               FROM enrollments e
               WHERE e.course_id = $5
               RETURNING user_id`,
              [notifTitle, notifMessage, now, expiresAt, lc.course_id]
            );
            await sendPushToUsers(
              db,
              inserted.rows.map((r: any) => Number(r.user_id)),
              {
                title: notifTitle,
                body: notifMessage,
                data: { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id },
              }
            );
            console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
          }
        }
      }

      // Prevent unbounded memory growth in long-running processes
      if (sentNotifications.size > 500) sentNotifications.clear();
    } catch (err) {
      console.error("[LiveNotif] Scheduler error:", err);
    }
  }, 60 * 1000);

  console.log("[LiveNotif] Scheduler started — checks every 60s");
}

/**
 * Scheduler 2: Download token cleanup.
 * Runs every 5 minutes. Deletes expired and already-used download tokens
 * in batches of 2000 to avoid long-running DELETE operations.
 */
function startDownloadTokenCleanupScheduler(db: DbClient): void {
  setInterval(async () => {
    try {
      const result = await db.query(
        `DELETE FROM download_tokens
         WHERE id IN (
           SELECT id
           FROM download_tokens
           WHERE expires_at < $1 AND used = TRUE
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
