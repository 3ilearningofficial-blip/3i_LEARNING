/**
 * schedulers.ts — adaptive background worker for the dedicated PM2 scheduler process.
 *
 * Live class 30-min reminders use event-driven `scheduled_jobs` rows (see scheduled-jobs.ts).
 * Other housekeeping runs only when needed or on slow intervals so Neon can scale to zero.
 */

import { deleteDownloadsForUser } from "./download-utils";
import { incrementCounter, setGauge } from "./observability";
import {
  getLatestRecordingForLiveInput,
  getCfVideoByUid,
} from "./cloudflare-stream-api";
import { saveRecordingForClassAndPeers as saveRecordingCore } from "./live-class-recording-save";
import { getNextPendingScheduledJobRunAt, runDueScheduledJobs } from "./scheduled-jobs";

const DOWNLOAD_CLEANUP_RETRY_LOCK_KEY = 31415926536;
const DOWNLOAD_TOKEN_CLEANUP_LOCK_KEY = 31415926537;
const STUCK_LIVE_CLEANUP_LOCK_KEY = 31415926538;
const LIVE_FINALIZE_QUEUE_LOCK_KEY = 31415926539;
const MEDIA_TOKEN_CLEANUP_LOCK_KEY = 31415926540;

const SCHEDULER_MIN_SLEEP_MS = 30_000;
const SCHEDULER_MAX_SLEEP_MS = 5 * 60 * 1000;
const STUCK_LIVE_INTERVAL_MS = 60 * 60 * 1000;
const TOKEN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_RETRY_INTERVAL_MS = 15 * 60 * 1000;
const FINALIZE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

type DbClient = {
  query: (text: string, params?: unknown[], options?: any) => Promise<{ rows: any[]; rowCount?: number }>;
};

type DbPool = DbClient & {
  connect: () => Promise<{
    query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
    release: () => void;
  }>;
};

type SendPushToUsersFn = (
  db: DbClient,
  userIds: number[],
  payload: { title: string; body: string; data?: Record<string, unknown> }
) => Promise<unknown>;

export function startSchedulers(
  db: DbClient,
  pool: DbPool,
  sendPushToUsers: SendPushToUsersFn
): void {
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";

  if (isNeonKeepaliveEnabled()) {
    startNeonKeepalive(db);
  } else {
    console.log("[Keepalive] Neon keepalive disabled — Neon may scale to zero after idle");
  }

  if (!runBackgroundSchedulers) {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
    return;
  }

  resetStuckFinalizeJobs(db);
  startAdaptiveSchedulerLoop(db, pool, sendPushToUsers);
}

function resetStuckFinalizeJobs(db: DbClient): void {
  db.query("UPDATE live_stream_finalize_jobs SET status = 'pending', updated_at = $1 WHERE status = 'running'", [
    Date.now(),
  ])
    .then((r) => {
      if ((r.rowCount ?? 0) > 0) {
        console.log(`[FinalizeQueue] Startup: reset ${r.rowCount} stuck 'running' job(s) to 'pending'`);
      }
    })
    .catch((err) => {
      console.error("[FinalizeQueue] Startup reset of stuck jobs failed:", err);
    });
}

async function runWithAdvisoryLock(pool: DbPool, lockKey: number, job: () => Promise<void>): Promise<void> {
  const client = await pool.connect();
  let locked = false;
  try {
    const got = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
    locked = got.rows[0]?.acquired === true;
    if (!locked) return;
    await job();
  } finally {
    if (locked) {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => {});
    }
    client.release();
  }
}

function startAdaptiveSchedulerLoop(db: DbClient, pool: DbPool, sendPushToUsers: SendPushToUsersFn): void {
  let lastStuckLiveRun = 0;
  let lastTokenCleanupRun = 0;
  let lastDownloadRetryCheck = 0;
  let lastFinalizeCheck = 0;

  const scheduleNext = (sleepMs: number) => {
    const delay = Math.max(SCHEDULER_MIN_SLEEP_MS, Math.min(SCHEDULER_MAX_SLEEP_MS, sleepMs));
    setTimeout(() => void tick().catch((err) => console.error("[Scheduler] tick error:", err)), delay);
  };

  const tick = async (): Promise<void> => {
    const now = Date.now();
    let sleepMs = SCHEDULER_MAX_SLEEP_MS;

    await runDueScheduledJobs(db, pool, sendPushToUsers, now);

    const nextJobAt = await getNextPendingScheduledJobRunAt(db, now);
    if (nextJobAt != null) {
      sleepMs = Math.min(sleepMs, Math.max(SCHEDULER_MIN_SLEEP_MS, nextJobAt - now));
    }

    if (now - lastFinalizeCheck >= FINALIZE_CHECK_INTERVAL_MS) {
      lastFinalizeCheck = now;
      const hasFinalize = await hasDueFinalizeJobs(db, now);
      if (hasFinalize) {
        await runLiveFinalizeQueueTick(db, pool);
        sleepMs = Math.min(sleepMs, FINALIZE_CHECK_INTERVAL_MS);
      }
    }

    if (now - lastDownloadRetryCheck >= DOWNLOAD_RETRY_INTERVAL_MS) {
      lastDownloadRetryCheck = now;
      const hasDownloadRetry = await hasDownloadCleanupPending(db);
      if (hasDownloadRetry) {
        await runDownloadCleanupRetry(db, pool);
      }
    }

    if (now - lastStuckLiveRun >= STUCK_LIVE_INTERVAL_MS) {
      lastStuckLiveRun = now;
      await runWithAdvisoryLock(pool, STUCK_LIVE_CLEANUP_LOCK_KEY, async () => clearStuckLiveClasses(db));
    }

    if (now - lastTokenCleanupRun >= TOKEN_CLEANUP_INTERVAL_MS) {
      lastTokenCleanupRun = now;
      await runDownloadTokenCleanup(db, pool);
      await runMediaTokenCleanup(db, pool);
    }

    scheduleNext(sleepMs);
  };

  console.log("[Scheduler] Adaptive loop started — event-driven reminders + idle-friendly housekeeping");
  void tick().catch((err) => console.error("[Scheduler] initial tick error:", err));
}

async function hasDueFinalizeJobs(db: DbClient, now: number): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM live_stream_finalize_jobs
     WHERE status IN ('pending', 'running') AND next_attempt_at <= $1
     LIMIT 1`,
    [now]
  );
  return result.rows.length > 0;
}

async function hasDownloadCleanupPending(db: DbClient): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM enrollments WHERE download_cleanup_pending = TRUE LIMIT 1`
  );
  return result.rows.length > 0;
}

async function runDownloadCleanupRetry(db: DbClient, pool: DbPool): Promise<void> {
  try {
    await runWithAdvisoryLock(pool, DOWNLOAD_CLEANUP_RETRY_LOCK_KEY, async () => {
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
          await db.query("UPDATE enrollments SET download_cleanup_pending = FALSE WHERE id = $1", [enrollmentId]);
        } catch {
          console.error("[CleanupRetry] cleanup failed; will retry later", { enrollmentId, userId, courseId });
        }
      }
    });
  } catch (err) {
    console.error("[CleanupRetry] scheduler error:", err);
  }
}

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

async function runDownloadTokenCleanup(db: DbClient, pool: DbPool): Promise<void> {
  try {
    await runWithAdvisoryLock(pool, DOWNLOAD_TOKEN_CLEANUP_LOCK_KEY, async () => {
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
        console.log(`[TokenCleanup] Deleted ${result.rowCount} expired download tokens`);
      }
    });
  } catch (err) {
    console.error("[TokenCleanup] Error:", err);
  }
}

async function runMediaTokenCleanup(db: DbClient, pool: DbPool): Promise<void> {
  try {
    await runWithAdvisoryLock(pool, MEDIA_TOKEN_CLEANUP_LOCK_KEY, async () => {
      const result = await db.query(
        `DELETE FROM media_tokens
         WHERE token IN (
           SELECT token FROM media_tokens
           WHERE expires_at < $1
           ORDER BY expires_at ASC
           LIMIT 2000
         )`,
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[MediaTokenCleanup] Deleted ${result.rowCount} expired media tokens`);
      }
    });
  } catch (err) {
    console.error("[MediaTokenCleanup] Error:", err);
  }
}

async function runLiveFinalizeQueueTick(db: DbClient, pool: DbPool): Promise<void> {
  await runWithAdvisoryLock(pool, LIVE_FINALIZE_QUEUE_LOCK_KEY, async () => {
    const now = Date.now();
    const pending = await db.query(
      `SELECT id, live_class_id, attempts
       FROM live_stream_finalize_jobs
       WHERE status IN ('pending', 'running')
         AND next_attempt_at <= $1
       ORDER BY next_attempt_at ASC
       LIMIT 100`,
      [now]
    );
    setGauge("live_finalize_queue_backlog", pending.rows.length);
    for (const job of pending.rows) {
      const jobId = Number(job.id);
      const liveClassId = Number(job.live_class_id);
      const attempts = Number(job.attempts || 0);
      if (!Number.isFinite(jobId) || !Number.isFinite(liveClassId)) continue;
      try {
        await db.query("UPDATE live_stream_finalize_jobs SET status = 'running', updated_at = $2 WHERE id = $1", [
          jobId,
          now,
        ]);
        const lc = await db.query(
          "SELECT recording_url, cf_stream_uid, cf_recording_uid FROM live_classes WHERE id = $1 LIMIT 1",
          [liveClassId]
        );
        let recordingUrl = String(lc.rows[0]?.recording_url || "").trim();

        if (!recordingUrl && attempts >= 5) {
          const cfAccountId = process.env.CF_STREAM_ACCOUNT_ID;
          const cfApiToken = process.env.CF_STREAM_API_TOKEN;
          if (cfAccountId && cfApiToken) {
            const cfRecordingUid = String(lc.rows[0]?.cf_recording_uid || "").trim();
            const cfStreamUid = String(lc.rows[0]?.cf_stream_uid || "").trim();
            let cfRecording = null;

            if (cfRecordingUid) {
              cfRecording = await getCfVideoByUid(cfAccountId, cfApiToken, cfRecordingUid);
            }
            if (!cfRecording && cfStreamUid) {
              cfRecording = await getLatestRecordingForLiveInput(cfAccountId, cfApiToken, cfStreamUid);
            }

            if (cfRecording?.recordingUid) {
              await db
                .query("UPDATE live_classes SET cf_recording_uid = COALESCE(cf_recording_uid, $1) WHERE id = $2", [
                  cfRecording.recordingUid,
                  liveClassId,
                ])
                .catch(() => {});

              if (cfRecording.status === "ready") {
                try {
                  await saveRecordingCore(db, String(liveClassId), cfRecording.manifestUrl);
                  recordingUrl = cfRecording.manifestUrl;
                  incrementCounter("live_finalize_queue_cf_fallback_success");
                } catch (saveErr) {
                  console.warn("[LiveFinalizeQueue] CF fallback save failed:", saveErr);
                }
              }
            }
          }
        }

        if (recordingUrl) {
          await db.query("UPDATE live_stream_finalize_jobs SET status = 'done', updated_at = $2 WHERE id = $1", [
            jobId,
            now,
          ]);
          continue;
        }

        const nextAttempts = attempts + 1;
        const maxAttempts = Number(process.env.LIVE_FINALIZE_MAX_ATTEMPTS || 24);
        const backoffMs = Math.min(10 * 60 * 1000, nextAttempts * 60 * 1000);
        await db.query(
          `UPDATE live_stream_finalize_jobs
           SET status = $2,
               attempts = $3,
               updated_at = $4,
               next_attempt_at = $5,
               last_error = $6
           WHERE id = $1`,
          [
            jobId,
            nextAttempts >= maxAttempts ? "failed" : "pending",
            nextAttempts,
            now,
            now + backoffMs,
            "recording_url_not_ready",
          ]
        );
        if (nextAttempts >= maxAttempts) incrementCounter("live_finalize_queue_failed");
      } catch (err: any) {
        incrementCounter("live_finalize_queue_errors");
        await db
          .query(
            `UPDATE live_stream_finalize_jobs
             SET status = 'pending',
                 attempts = COALESCE(attempts, 0) + 1,
                 updated_at = $2,
                 next_attempt_at = $3,
                 last_error = $4
             WHERE id = $1`,
            [jobId, now, now + 60 * 1000, String(err?.message || "queue_error").slice(0, 500)]
          )
          .catch(() => {});
      }
    }
  });
}

/** True only when NEON_KEEPALIVE=true (default off — allows Neon scale-to-zero). */
export function isNeonKeepaliveEnabled(): boolean {
  const raw = String(process.env.NEON_KEEPALIVE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function startNeonKeepalive(db: DbClient): void {
  const KEEPALIVE_INTERVAL_MS = 30 * 1000;
  setInterval(async () => {
    try {
      await db.query("SELECT 1");
    } catch {
      // Silently ignore — the main pool already handles reconnect logic.
    }
  }, KEEPALIVE_INTERVAL_MS);
  console.log("[Keepalive] Neon keepalive started — pings every 30s");
}
