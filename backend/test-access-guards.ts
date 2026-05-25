import { isEnrollmentExpired } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type AuthUser = { id: number; role: string };

/**
 * Admins, free-standalone, and valid enrollments / purchases.
 */
export async function assertTestAccess(
  db: DbClient,
  user: AuthUser,
  test: {
    course_id?: number | null;
    mini_course_id?: number | null;
    price?: string | number | null;
    course_is_free?: boolean;
    folder_is_free?: boolean;
  },
  testId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (user.role === "admin") return { ok: true };
  if (test.course_id) {
    if (test.course_is_free) return { ok: true };
    const enrolled = await db.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, test.course_id]
    );
    if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
      return { ok: false, message: "Enrollment required for this test" };
    }
    return { ok: true };
  }
  if (test.mini_course_id && !test.folder_is_free) {
    const purchased = await db.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, test.mini_course_id]);
    if (purchased.rows.length === 0) return { ok: false, message: "Purchase required to access this test" };
    return { ok: true };
  }
  if (test.price && parseFloat(String(test.price)) > 0) {
    const purchased = await db.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
    if (purchased.rows.length === 0) return { ok: false, message: "Purchase required to access this test" };
  }
  return { ok: true };
}
