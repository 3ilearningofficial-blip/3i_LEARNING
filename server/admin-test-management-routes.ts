import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminTestManagementRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts: (courseId: string) => Promise<void>;
};

export function registerAdminTestManagementRoutes({
  app,
  db,
  requireAdmin,
  updateCourseTestCounts,
}: RegisterAdminTestManagementRoutesDeps): void {
  app.get("/api/admin/tests/:id/questions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index ASC, id ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  });

  app.put("/api/admin/questions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { questionText, optionA, optionB, optionC, optionD, correctOption, explanation, topic, marks, negativeMarks, difficulty, imageUrl, solutionImageUrl } =
        req.body;
      await db.query(
        `UPDATE questions SET question_text=$1, option_a=$2, option_b=$3, option_c=$4, option_d=$5, correct_option=$6, explanation=$7, topic=$8, marks=$9, negative_marks=$10, difficulty=$11, image_url=$12, solution_image_url=$13 WHERE id=$14`,
        [questionText, optionA, optionB, optionC, optionD, correctOption, explanation || "", topic || "", parseFloat(marks) || 1, parseFloat(negativeMarks) || 0, difficulty || "moderate", imageUrl || null, solutionImageUrl || null, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update question" });
    }
  });

  app.delete("/api/admin/questions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const q = await db.query("SELECT test_id FROM questions WHERE id = $1", [req.params.id]);
      await db.query("DELETE FROM questions WHERE id = $1", [req.params.id]);
      if (q.rows.length > 0) {
        await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [q.rows[0].test_id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete question" });
    }
  });

  app.put("/api/admin/tests/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, durationMinutes, totalMarks, testType, folderName, difficulty, scheduledAt, passingMarks, courseId, price } = req.body;
      const priceVal = price !== undefined ? parseFloat(price) || 0 : null;
      if (courseId !== undefined) {
        await db.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9, course_id=$10${priceVal !== null ? ", price=$12" : ""} WHERE id=$11`,
          priceVal !== null
            ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id, priceVal]
            : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id]
        );
        if (courseId) await updateCourseTestCounts(courseId);
      } else {
        await db.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9${priceVal !== null ? ", price=$11" : ""} WHERE id=$10`,
          priceVal !== null
            ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id, priceVal]
            : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id]
        );
        const existing = await db.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
        if (existing.rows[0]?.course_id) await updateCourseTestCounts(existing.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update test" });
    }
  });

  app.delete("/api/admin/tests/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const testRow = await db.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
      const courseId = testRow.rows[0]?.course_id;
      await db.query("DELETE FROM test_attempts WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM questions WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      if (courseId) await updateCourseTestCounts(courseId);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete test error:", err);
      res.status(500).json({ message: "Failed to delete test" });
    }
  });
}

