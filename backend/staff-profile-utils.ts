import type { DbClient } from "./staff-access-utils";

export async function ensureStaffProfile(db: DbClient, userId: number): Promise<void> {
  await db.query(
    `INSERT INTO staff_profiles (user_id, created_at, updated_at)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, Date.now()],
  );
}

export async function loadStaffProfileBundle(db: DbClient, userId: number) {
  const [userRes, profileRes, eduRes, expRes] = await Promise.all([
    db.query(
      `SELECT id, name, email, phone, role, last_active_at, created_at FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    ),
    db.query(`SELECT * FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [userId]),
    db.query(
      `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
      [userId],
    ),
    db.query(
      `SELECT * FROM staff_experience WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
      [userId],
    ),
  ]);
  const user = userRes.rows[0];
  if (!user) return null;
  return {
    user,
    profile: profileRes.rows[0] || null,
    education: eduRes.rows,
    experience: expRes.rows,
  };
}

export function serializeStaffListRow(row: any) {
  return {
    id: Number(row.id),
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    role: row.role || "teacher",
    employeeId: row.employee_id || "",
    teacherId: row.teacher_id || "",
    status: row.status || "active",
    photoUrl: row.photo_url || "",
    courseCount: Number(row.course_count || 0),
    lastActiveAt: row.last_active_at != null ? Number(row.last_active_at) : null,
    createdAt: row.created_at != null ? Number(row.created_at) : null,
  };
}
