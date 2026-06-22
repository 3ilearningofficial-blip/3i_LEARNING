/**
 * Compute when enrollment should expire: earliest of (course end date, purchase/roll date + validity_months).
 * Returns null if no time limit.
 */
export function computeEnrollmentValidUntil(
  course: { end_date?: string | null; validity_months?: number | string | null },
  enrolledAtMs: number
): number | null {
  const cands: number[] = [];
  if (course.end_date != null && String(course.end_date).trim() !== "") {
    const t = Date.parse(String(course.end_date).trim());
    if (Number.isFinite(t)) cands.push(t);
  }
  const vm = course.validity_months;
  if (vm != null && String(vm) !== "" && !Number.isNaN(Number(vm))) {
    const months = Number(vm);
    if (months > 0) {
      const d = new Date(enrolledAtMs);
      d.setUTCMonth(d.getUTCMonth() + months);
      cands.push(d.getTime());
    }
  }
  if (cands.length === 0) return null;
  return Math.min(...cands);
}

export function isEnrollmentExpired(row: { valid_until?: number | null } | null | undefined): boolean {
  if (!row) return true;
  const vu = row.valid_until;
  if (vu == null) return false;
  return Number(vu) < Date.now();
}

export function enrollmentAccessState(row: {
  status?: string | null;
  valid_until?: number | null;
} | null | undefined): "active" | "inactive" | "expired" {
  if (!row) return "inactive";
  const status = String(row.status ?? "active").trim().toLowerCase();
  if (status === "inactive") return "inactive";
  if (isEnrollmentExpired(row)) return "expired";
  return "active";
}

type DbLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

/** Idempotent repair: renew expired/inactive rows or create from paid payment. */
export async function repairCourseEnrollmentAccess(
  db: DbLike,
  userId: number,
  courseId: number
): Promise<{ fixed: boolean; reason: string }> {
  const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [courseId]);
  if (courseResult.rows.length === 0) return { fixed: false, reason: "course_not_found" };
  const courseRow = courseResult.rows[0];

  const existing = await db.query(
    "SELECT id, valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2",
    [userId, courseId]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (enrollmentAccessState(row) === "active") {
      return { fixed: false, reason: "already_active" };
    }
    const at = Date.now();
    const vu = computeEnrollmentValidUntil(courseRow, at);
    await db.query(
      `UPDATE enrollments SET status = 'active', enrolled_at = $1, valid_until = $2 WHERE id = $3`,
      [at, vu, row.id]
    );
    return { fixed: true, reason: row.status === "inactive" ? "reactivated" : "renewed" };
  }

  const pay = await db.query(
    "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
    [userId, courseId]
  );
  if (pay.rows.length === 0) {
    return { fixed: false, reason: "no_enrollment_or_payment" };
  }

  const at = Date.now();
  const vu = computeEnrollmentValidUntil(courseRow, at);
  const ins = await db.query(
    `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (user_id, course_id) DO NOTHING
     RETURNING id`,
    [userId, courseId, at, vu]
  );
  if (ins.rows.length > 0) {
    await db.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [courseId]);
  }
  return { fixed: true, reason: "paid_sync" };
}
