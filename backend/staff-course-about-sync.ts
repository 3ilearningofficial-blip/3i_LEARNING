import type { DbClient } from "./staff-access-utils";

/**
 * Phase 6: sync assigned teacher public profile fields to course About block.
 * Called after admin saves staff profile or on assignment.
 */
export async function syncTeacherToCourseAbout(
  db: DbClient,
  userId: number,
  courseId: number,
): Promise<void> {
  try {
    const [profileRes, userRes, courseRes] = await Promise.all([
      db.query(`SELECT photo_url, personal_json, teacher_id FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [userId]),
      db.query(`SELECT name FROM users WHERE id = $1 LIMIT 1`, [userId]),
      db.query(`SELECT teacher_details_json FROM courses WHERE id = $1 LIMIT 1`, [courseId]),
    ]);
    const profile = profileRes.rows[0];
    const user = userRes.rows[0];
    const course = courseRes.rows[0];
    if (!profile || !user || !course) return;

    const personal = typeof profile.personal_json === "string"
      ? JSON.parse(profile.personal_json)
      : profile.personal_json || {};

    let details: any[] = [];
    try {
      details = Array.isArray(course.teacher_details_json)
        ? course.teacher_details_json
        : JSON.parse(course.teacher_details_json || "[]");
    } catch {
      details = [];
    }

    const entry = {
      name: user.name,
      photoUrl: profile.photo_url || "",
      teacherId: profile.teacher_id || "",
      bio: personal.bio || "",
      syncedFromStaffId: userId,
      syncedAt: Date.now(),
    };

    const idx = details.findIndex((d: any) => d.syncedFromStaffId === userId);
    if (idx >= 0) details[idx] = { ...details[idx], ...entry };
    else details.push(entry);

    await db.query(
      `UPDATE courses SET teacher_image_url = COALESCE($2, teacher_image_url), teacher_details_json = $3 WHERE id = $1`,
      [courseId, profile.photo_url || null, JSON.stringify(details)],
    );
  } catch (err) {
    console.warn("[StaffSync] course about sync failed:", err);
  }
}

/** Placeholder for future Aadhar OCR integration (Phase 6). */
export async function parseAadharOcrPlaceholder(_fileUrl: string): Promise<Record<string, string>> {
  return {
    message: "OCR not configured. Enter details manually.",
  };
}
