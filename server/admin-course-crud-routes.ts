import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminCourseCrudRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  cacheInvalidate: (prefix: string) => void;
};

export function registerAdminCourseCrudRoutes({
  app,
  db,
  requireAdmin,
  cacheInvalidate,
}: RegisterAdminCourseCrudRoutesDeps): void {
  app.post("/api/admin/courses", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, startDate, endDate, validityMonths, thumbnail, coverColor } =
        req.body;
      const COVER_COLORS = ["#1A56DB", "#7C3AED", "#DC2626", "#059669", "#D97706", "#0891B2", "#DB2777", "#EA580C"];
      const autoColor = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const vm =
        validityMonths != null && String(validityMonths).trim() !== ""
          ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
          : null;
      const result = await db.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, start_date, end_date, validity_months, thumbnail, cover_color, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE, $17) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, courseType || "live", subject || "", startDate || null, endDate || null, vm, thumbnail || null, coverColor || autoColor, Date.now()]
      );
      cacheInvalidate("courses:");
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("Create course error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create course" });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, validityMonths, thumbnail, coverColor } =
        req.body;
      const vm =
        validityMonths != null && String(validityMonths).trim() !== ""
          ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
          : null;
      await db.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), course_type=COALESCE($13, course_type), start_date=COALESCE($14, start_date), end_date=COALESCE($15, end_date), validity_months=COALESCE($16, validity_months), thumbnail=COALESCE($17, thumbnail), cover_color=COALESCE($18, cover_color) WHERE id=$19`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, vm, thumbnail ?? null, coverColor ?? null, req.params.id]
      );
      cacheInvalidate("courses:");
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update course" });
    }
  });
}

