import { isEnrollmentExpired } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type LiveClassRow = {
  course_id?: number | null;
  is_free_preview?: boolean;
};

type UserRow = { id: number; role: string } | null;

/**
 * In list queries, pass pg placeholder indices for the signed-in user id and `Date.now()`.
 * Example: sqlEnrollmentExistsForLiveList(2, 3) → $2 and $3
 */
export function sqlEnrollmentExistsForLiveList(userIdParam: number, nowParam: number): string {
  return `EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $${userIdParam} AND (e.status = 'active' OR e.status IS NULL) AND (e.valid_until IS NULL OR e.valid_until >= $${nowParam}))`;
}

/**
 * Chat, heartbeat, and detail: no course → open; free preview → open; else enrolled and not expired; admin open.
 * Does not treat is_public as enough for course-bound classes.
 */
export async function userCanAccessLiveClassContent(
  db: DbClient,
  user: UserRow,
  lc: LiveClassRow
): Promise<boolean> {
  if (user?.role === "admin") return true;
  if (!lc.course_id) return true;
  if (lc.is_free_preview) return true;
  if (!user) return false;
  const enroll = await db.query(
    "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
    [user.id, lc.course_id]
  );
  if (enroll.rows.length === 0 || isEnrollmentExpired(enroll.rows[0])) return false;
  return true;
}
