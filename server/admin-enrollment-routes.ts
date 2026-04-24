import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminEnrollmentRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  cacheInvalidate: (prefix: string) => void;
  deleteDownloadsForUser: (userId: number, courseId: number) => Promise<void>;
  deleteDownloadsForCourse: (courseId: number) => Promise<void>;
};

export function registerAdminEnrollmentRoutes({
  app,
  db,
  requireAdmin,
  cacheInvalidate,
  deleteDownloadsForUser,
  deleteDownloadsForCourse,
}: RegisterAdminEnrollmentRoutesDeps): void {
  app.put("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { status, valid_until } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];

      if (status !== undefined) {
        params.push(status);
        updates.push(`status = $${params.length}`);
      }

      if (valid_until !== undefined) {
        params.push(valid_until);
        updates.push(`valid_until = $${params.length}`);
      }

      if (updates.length > 0) {
        params.push(req.params.id);
        await db.query(`UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update enrollment" });
    }
  });

  app.delete("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const enrollment = await db.query("SELECT user_id, course_id FROM enrollments WHERE id = $1", [req.params.id]);

      if (enrollment.rows.length > 0) {
        const { user_id, course_id } = enrollment.rows[0];
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
        await deleteDownloadsForUser(user_id, course_id);
      } else {
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
      }

      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to remove enrollment" });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = req.params.id;

      await deleteDownloadsForCourse(parseInt(Array.isArray(courseId) ? courseId[0] : courseId));

      await db.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM courses WHERE id = $1", [courseId]);
      cacheInvalidate("courses:");
      cacheInvalidate("tests:");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
      res.status(500).json({ message: "Failed to delete course" });
    }
  });
}

