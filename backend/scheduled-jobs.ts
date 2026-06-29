import { autoNotificationExpiresAt } from "./auto-notification-expiry";
import { getRedisClient } from "./redis-client";
import { filterNewNotificationRecipientsRedis } from "./redis-notification-dedup";

export const LIVE_CLASS_REMINDER_30MIN_JOB = "live_class_reminder_30min";
export const LIVE_CLASS_REMINDER_MS = 30 * 60 * 1000;

const SCHEDULED_JOBS_ADVISORY_LOCK_KEY = 31415926541;

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

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

type LiveClassReminderRow = {
  id: number;
  title: string;
  course_id: number | null;
  scheduled_at: number | null;
  notify_bell: boolean | null;
  is_completed: boolean | null;
  is_live: boolean | null;
  is_recording_mode: boolean | null;
  is_free_preview: boolean | null;
  is_public: boolean | null;
};

export function liveClassReminderRunAt(scheduledAt: number): number {
  return scheduledAt - LIVE_CLASS_REMINDER_MS;
}

export function shouldScheduleLiveClassReminder(lc: LiveClassReminderRow, now = Date.now()): boolean {
  if (lc.notify_bell !== true) return false;
  const scheduledAt = Number(lc.scheduled_at);
  if (!Number.isFinite(scheduledAt) || scheduledAt <= now) return false;
  if (lc.is_completed === true) return false;
  if (lc.is_live === true) return false;
  if (lc.is_recording_mode === true) return false;
  return true;
}

export async function cancelLiveClassReminderJob(db: DbClient, liveClassId: number): Promise<void> {
  const now = Date.now();
  await db.query(
    `UPDATE scheduled_jobs
     SET status = 'cancelled', updated_at = $3
     WHERE job_type = $1 AND ref_id = $2 AND status IN ('pending', 'running')`,
    [LIVE_CLASS_REMINDER_30MIN_JOB, liveClassId, now]
  );
}

export async function syncLiveClassReminderJob(db: DbClient, liveClassId: number): Promise<void> {
  const result = await db.query(
    `SELECT id, title, course_id, scheduled_at, notify_bell, is_completed, is_live,
            is_recording_mode, is_free_preview, is_public
     FROM live_classes WHERE id = $1 LIMIT 1`,
    [liveClassId]
  );
  if (!result.rows.length) {
    await cancelLiveClassReminderJob(db, liveClassId);
    return;
  }
  await syncLiveClassReminderJobFromRow(db, result.rows[0] as LiveClassReminderRow);
}

export async function syncLiveClassReminderJobFromRow(
  db: DbClient,
  lc: LiveClassReminderRow
): Promise<void> {
  const now = Date.now();
  const liveClassId = Number(lc.id);
  if (!Number.isFinite(liveClassId)) return;

  if (!shouldScheduleLiveClassReminder(lc, now)) {
    await cancelLiveClassReminderJob(db, liveClassId);
    return;
  }

  const runAt = liveClassReminderRunAt(Number(lc.scheduled_at));
  await db.query(
    `INSERT INTO scheduled_jobs (job_type, ref_id, run_at, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $4)
     ON CONFLICT (job_type, ref_id) DO UPDATE SET
       run_at = EXCLUDED.run_at,
       status = CASE
         WHEN scheduled_jobs.status = 'running' THEN 'running'
         WHEN scheduled_jobs.status = 'done' AND scheduled_jobs.run_at = EXCLUDED.run_at THEN 'done'
         ELSE 'pending'
       END,
       updated_at = EXCLUDED.updated_at`,
    [LIVE_CLASS_REMINDER_30MIN_JOB, liveClassId, runAt, now]
  );
}

export async function getNextPendingScheduledJobRunAt(db: DbClient, now = Date.now()): Promise<number | null> {
  const result = await db.query(
    `SELECT MIN(run_at) AS next_run_at
     FROM scheduled_jobs
     WHERE status = 'pending' AND run_at > $1`,
    [now]
  );
  const next = Number(result.rows[0]?.next_run_at);
  return Number.isFinite(next) ? next : null;
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

async function trimNotificationsSent(db: DbClient, now: number): Promise<void> {
  await db.query("DELETE FROM notifications_sent WHERE sent_at < $1", [now - 24 * 60 * 60 * 1000]);
}

export async function sendLiveClassReminder30Min(
  db: DbClient,
  lc: LiveClassReminderRow,
  sendPushToUsers: SendPushToUsersFn
): Promise<number> {
  const now = Date.now();
  const expiresAt = autoNotificationExpiresAt(now);
  const notifTitle = "⏰ Live Class in 30 minutes!";
  const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;
  const PUSH_BATCH_SIZE = 500;
  const dedupType = LIVE_CLASS_REMINDER_30MIN_JOB;

  let recipientIds: number[] = [];
  const redis = await getRedisClient();
  let dedupHandled = false;

  if (redis) {
    const candidates =
      !lc.course_id || lc.is_free_preview === true || lc.is_public === true
        ? await db.query(`SELECT u.id::int AS user_id FROM users u WHERE u.role = 'student' LIMIT 5000`, [])
        : await db.query(
            `SELECT e.user_id::int AS user_id
             FROM enrollments e
             WHERE e.course_id = $1::int
               AND (e.status = 'active' OR e.status IS NULL)
               AND (e.valid_until IS NULL OR e.valid_until > $2::bigint)`,
            [lc.course_id, now]
          );
    const candidateIds = candidates.rows.map((r: { user_id: number }) => Number(r.user_id));
    const redisResult = await filterNewNotificationRecipientsRedis(redis, lc.id, candidateIds, dedupType);
    if (redisResult !== null) {
      dedupHandled = true;
      recipientIds = redisResult;
      if (recipientIds.length) {
        await db.query(
          `INSERT INTO notifications_sent (class_id, user_id, type)
           SELECT $1::int, u_id::int, $2::text
           FROM unnest($3::int[]) AS u_id
           ON CONFLICT (class_id, user_id, type) DO NOTHING`,
          [lc.id, dedupType, recipientIds]
        );
      }
    }
  }

  if (!dedupHandled) {
    if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
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
  }

  if (!recipientIds.length) return 0;

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
      data:
        !lc.course_id || lc.is_free_preview === true || lc.is_public === true
          ? { type: "live_class_reminder", liveClassId: lc.id }
          : { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id },
    });
    if (i + PUSH_BATCH_SIZE < recipientIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${recipientIds.length}`);
  return recipientIds.length;
}

async function processDueJob(
  db: DbClient,
  job: { id: number; job_type: string; ref_id: number },
  sendPushToUsers: SendPushToUsersFn
): Promise<void> {
  const now = Date.now();
  const jobId = Number(job.id);
  const liveClassId = Number(job.ref_id);

  await db.query(
    `UPDATE scheduled_jobs SET status = 'running', updated_at = $2 WHERE id = $1 AND status = 'pending'`,
    [jobId, now]
  );

  if (job.job_type !== LIVE_CLASS_REMINDER_30MIN_JOB) {
    await db.query(
      `UPDATE scheduled_jobs SET status = 'cancelled', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
    return;
  }

  const lcResult = await db.query(
    `SELECT id, title, course_id, scheduled_at, notify_bell, is_completed, is_live,
            is_recording_mode, is_free_preview, is_public
     FROM live_classes WHERE id = $1 LIMIT 1`,
    [liveClassId]
  );
  const lc = lcResult.rows[0] as LiveClassReminderRow | undefined;
  if (!lc || !shouldScheduleLiveClassReminder(lc, now)) {
    await db.query(
      `UPDATE scheduled_jobs SET status = 'cancelled', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
    return;
  }

  try {
    await sendLiveClassReminder30Min(db, lc, sendPushToUsers);
    await db.query(
      `UPDATE scheduled_jobs SET status = 'done', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
  } catch (err) {
    console.error("[ScheduledJobs] live class reminder failed:", err);
    await db.query(
      `UPDATE scheduled_jobs
       SET status = 'pending', updated_at = $2, run_at = $3
       WHERE id = $1`,
      [jobId, now, now + 60 * 1000]
    );
  }
}

export async function runDueScheduledJobs(
  db: DbClient,
  pool: DbPool,
  sendPushToUsers: SendPushToUsersFn,
  now = Date.now()
): Promise<void> {
  await runWithAdvisoryLock(pool, SCHEDULED_JOBS_ADVISORY_LOCK_KEY, async () => {
    await trimNotificationsSent(db, now);
    const due = await db.query(
      `SELECT id, job_type, ref_id
       FROM scheduled_jobs
       WHERE status = 'pending' AND run_at <= $1
       ORDER BY run_at ASC
       LIMIT 20`,
      [now]
    );
    for (const job of due.rows) {
      await processDueJob(db, job, sendPushToUsers);
    }
  });
}
