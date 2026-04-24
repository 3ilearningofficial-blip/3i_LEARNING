import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminCourseImportRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts: (courseId: string) => Promise<void>;
};

export function registerAdminCourseImportRoutes({
  app,
  db,
  requireAdmin,
  updateCourseTestCounts,
}: RegisterAdminCourseImportRoutesDeps): void {
  app.post("/api/admin/courses/:id/import-lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = req.params.id;
      const { lectureIds, sectionTitle } = req.body;
      if (!lectureIds || !Array.isArray(lectureIds) || lectureIds.length === 0) {
        return res.status(400).json({ message: "No lectures selected" });
      }
      const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [targetCourseId]);
      let orderIndex = maxOrder.rows[0].next_order;
      for (const lecId of lectureIds) {
        const lec = await db.query("SELECT * FROM lectures WHERE id = $1", [lecId]);
        if (lec.rows.length > 0) {
          const l = lec.rows[0];
          await db.query(
            `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [targetCourseId, l.title, l.description || "", l.video_url, l.video_type || "youtube", l.duration_minutes || 0, orderIndex++, false, l.section_title || null, Date.now()]
          );
        }
      }
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [targetCourseId]);
      res.json({ success: true, imported: lectureIds.length });
    } catch (err) {
      console.error("Import lectures error:", err);
      res.status(500).json({ message: "Failed to import lectures" });
    }
  });

  app.post("/api/admin/courses/:id/import-tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = String(req.params.id);
      const { testIds } = req.body;
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }
      for (const testId of testIds) {
        const test = await db.query("SELECT * FROM tests WHERE id = $1", [testId]);
        if (test.rows.length > 0) {
          const t = test.rows[0];
          const newTest = await db.query(
            `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, total_questions, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [t.title, t.description, targetCourseId, t.duration_minutes, t.total_marks, t.passing_marks, t.test_type, t.folder_name || null, t.total_questions || 0, Date.now()]
          );
          const questions = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [testId]);
          for (const q of questions.rows) {
            await db.query(
              `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [newTest.rows[0].id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation, q.topic, q.difficulty, q.marks, q.negative_marks, q.order_index]
            );
          }
        }
      }
      await updateCourseTestCounts(targetCourseId);
      res.json({ success: true, imported: testIds.length });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });

  app.post("/api/admin/courses/:id/import-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = req.params.id;
      const { materialIds } = req.body;
      if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
        return res.status(400).json({ message: "No materials selected" });
      }
      for (const matId of materialIds) {
        const mat = await db.query("SELECT * FROM study_materials WHERE id = $1", [matId]);
        if (mat.rows.length > 0) {
          const m = mat.rows[0];
          await db.query(
            `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [m.title, m.description || "", m.file_url, m.file_type || "pdf", targetCourseId, false, m.section_title || null, m.download_allowed || false, Date.now()]
          );
        }
      }
      res.json({ success: true, imported: materialIds.length });
    } catch (err) {
      console.error("Import materials error:", err);
      res.status(500).json({ message: "Failed to import materials" });
    }
  });
}

