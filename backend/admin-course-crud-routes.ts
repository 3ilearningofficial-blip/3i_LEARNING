import type { Express, Request, Response } from "express";
import { autoNotificationExpiresAt } from "./auto-notification-expiry";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminCourseCrudRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

function normalizeJsonArray(value: unknown, fallback: unknown[] = []): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeJsonValue(value: unknown, fallback: unknown = []): unknown {
  if (value === undefined) return fallback;
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && (Array.isArray(parsed) || typeof parsed === "object") ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function normalizeBatchStatus(value: unknown): "live" | "recorded" {
  const status = String(value || "").toLowerCase();
  return status === "recorded" || status === "completed" ? "recorded" : "live";
}

export function registerAdminCourseCrudRoutes({
  app,
  db,
  requireAdmin,
}: RegisterAdminCourseCrudRoutesDeps): void {
  app.post("/api/admin/courses", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, startDate, endDate, validityMonths, thumbnail, coverColor, teacherBio, teacherImageUrl, teacherDetailsJson, multiSubjectConfig, courseLanguage, batchStatus } =
        req.body;
      const COVER_COLORS = ["#1A56DB", "#7C3AED", "#DC2626", "#059669", "#D97706", "#0891B2", "#DB2777", "#EA580C"];
      const autoColor = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const normalizedCourseType = courseType || "live";
      const resolvedCoverColor =
        normalizedCourseType === "multi_subject"
          ? (coverColor || autoColor)
          : null;
      const vm =
        validityMonths != null && String(validityMonths).trim() !== ""
          ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
          : null;
      const subjects = normalizeJsonArray(multiSubjectConfig, [
        { key: "maths", label: "Maths", icon: "calculator" },
        { key: "english", label: "English", icon: "book" },
        { key: "science", label: "Science", icon: "flask" },
        { key: "gk", label: "G.K", icon: "earth" },
      ]);
      const teacherDetails = normalizeJsonValue(teacherDetailsJson, []);
      const result = await db.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, start_date, end_date, validity_months, thumbnail, cover_color, teacher_bio, teacher_image_url, teacher_details_json, multi_subject_config, course_language, batch_status, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22, TRUE, $23) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, normalizedCourseType, subject || "", startDate || null, endDate || null, vm, thumbnail || null, resolvedCoverColor, teacherBio || null, teacherImageUrl || null, JSON.stringify(teacherDetails), JSON.stringify(normalizedCourseType === "multi_subject" ? subjects : normalizeJsonArray(multiSubjectConfig)), normalizedCourseType === "multi_subject" ? (courseLanguage || "HINGLISH") : null, normalizedCourseType === "multi_subject" ? normalizeBatchStatus(batchStatus) : null, Date.now()]
      );
      if (normalizedCourseType !== "test_series") {
        const course = result.rows[0];
        const students = await db.query("SELECT id FROM users WHERE role = 'student'").catch(() => ({ rows: [] as any[] }));
        const studentIds = students.rows.map((row: any) => Number(row.id)).filter((id: number) => Number.isFinite(id));
        const notifTitle = "📚 New Course Added";
        const notifMessage = `"${course.title}" is now available.`;
        const courseNotifNow = Date.now();
        const courseNotifExpiresAt = autoNotificationExpiresAt(courseNotifNow);
        if (studentIds.length > 0) {
          await db.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
             SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
             FROM unnest($1::int[]) AS u`,
            [studentIds, notifTitle, notifMessage, courseNotifNow, courseNotifExpiresAt]
          ).catch(() => {});
        }
        await sendPushToUsers(db, studentIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_course_added", courseId: Number(course.id) },
        }).catch((err) => console.error("[CourseNotify] new course push failed:", err));
      }
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("Create course error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create course" });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, validityMonths, thumbnail, coverColor, teacherBio, teacherImageUrl, teacherDetailsJson, multiSubjectConfig, courseLanguage, batchStatus } =
        req.body;
      const vm =
        validityMonths != null && String(validityMonths).trim() !== ""
          ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
          : null;
      const teacherDetails = normalizeJsonValue(teacherDetailsJson, []);
      const subjects = normalizeJsonArray(multiSubjectConfig);
      await db.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), course_type=COALESCE($13, course_type), start_date=COALESCE($14, start_date), end_date=COALESCE($15, end_date), validity_months=COALESCE($16, validity_months), thumbnail=COALESCE($17, thumbnail), cover_color=COALESCE($18, cover_color), teacher_bio=COALESCE($19, teacher_bio), teacher_image_url=COALESCE($20, teacher_image_url), teacher_details_json=COALESCE($21::jsonb, teacher_details_json), multi_subject_config=COALESCE($22::jsonb, multi_subject_config), course_language=COALESCE($23, course_language), batch_status=COALESCE($24, batch_status) WHERE id=$25`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, vm, thumbnail ?? null, coverColor ?? null, teacherBio ?? null, teacherImageUrl ?? null, teacherDetailsJson !== undefined ? JSON.stringify(teacherDetails) : null, multiSubjectConfig !== undefined ? JSON.stringify(subjects) : null, courseLanguage ?? null, batchStatus !== undefined ? normalizeBatchStatus(batchStatus) : null, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update course" });
    }
  });
}

