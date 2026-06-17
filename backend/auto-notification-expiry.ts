/** Auto-generated course alerts (new course, live class, recording, material, tests) expire after 12 hours. */
export const AUTO_NOTIFICATION_TTL_MS = 12 * 60 * 60 * 1000;

/** After a student taps an auto notification past its 12-hour mark, keep it visible for 1 more hour. */
export const AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS = 60 * 60 * 1000;

export function autoNotificationExpiresAt(now = Date.now()): number {
  return now + AUTO_NOTIFICATION_TTL_MS;
}

/** When an auto notification is tapped: stay until 12h from creation, or +1h if tapped after that. */
export function computeAutoNotificationHideAfterAt(
  tappedAt: number,
  expiresAt: number | null | undefined
): number | null {
  if (expiresAt == null || !Number.isFinite(Number(expiresAt))) return null;
  const expiry = Number(expiresAt);
  if (tappedAt < expiry) return expiry;
  return tappedAt + AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS;
}

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

/** Insert in-app + push alerts for enrolled students with the standard 12-hour TTL. */
export async function notifyEnrolledCourseStudents(
  db: DbClient,
  courseId: number | string,
  opts: {
    title: string;
    message: string;
    type?: string;
    now?: number;
    pushData?: Record<string, unknown>;
    sendPush?: (
      userIds: number[],
      payload: { title: string; body: string; data?: Record<string, unknown> }
    ) => Promise<unknown>;
  }
): Promise<void> {
  const recipients = await db
    .query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId])
    .catch(() => ({ rows: [] as { user_id: unknown }[] }));
  const recipientIds = recipients.rows
    .map((r) => Number((r as { user_id: unknown }).user_id))
    .filter((id) => Number.isFinite(id));
  if (recipientIds.length === 0) return;

  const now = opts.now ?? Date.now();
  const expiresAt = autoNotificationExpiresAt(now);
  await db
    .query(
      `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
       SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
       FROM unnest($1::int[]) AS u`,
      [recipientIds, opts.title, opts.message, opts.type ?? "info", now, expiresAt]
    )
    .catch(() => {});

  if (opts.sendPush) {
    await opts
      .sendPush(recipientIds, { title: opts.title, body: opts.message, data: opts.pushData })
      .catch(() => {});
  }
}
