import type { Express, Request, Response } from "express";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminTestRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts: (courseId: string) => Promise<void>;
};

export function registerAdminTestRoutes({
  app,
  db,
  requireAdmin,
  updateCourseTestCounts,
}: RegisterAdminTestRoutesDeps): void {
  app.get("/api/admin/tests", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT t.*, c.title as course_title 
        FROM tests t 
        LEFT JOIN courses c ON t.course_id = c.id 
        WHERE t.course_id IS NULL
        ORDER BY t.created_at DESC
      `);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.post("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, miniCourseId, price } =
        req.body;
      const result = await db.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, mini_course_id, price, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          durationMinutes || 60,
          totalMarks || 100,
          passingMarks || 35,
          testType || "practice",
          folderName || null,
          difficulty || "moderate",
          scheduledAt ? new Date(scheduledAt).getTime() : null,
          miniCourseId || null,
          parseFloat(price) || 0,
          Date.now(),
        ]
      );
      if (courseId) {
        await updateCourseTestCounts(courseId);
        const courseInfo = await db.query("SELECT title FROM courses WHERE id = $1", [courseId]).catch(() => ({ rows: [] as any[] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]).catch(() => ({ rows: [] as any[] }));
        const recipientIds = recipients.rows.map((r: any) => Number(r.user_id));
        const notifTitle = "📝 New Test Added";
        const notifMessage = `"${title}" has been added in ${courseTitle}.`;
        const now = Date.now();
        for (const uid of recipientIds) {
          await db
            .query(
              "INSERT INTO notifications (user_id, title, message, type, created_at) VALUES ($1, $2, $3, $4, $5)",
              [uid, notifTitle, notifMessage, "info", now]
            )
            .catch(() => {});
        }
        await sendPushToUsers(db, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_test_added", testId: result.rows[0]?.id, courseId: Number(courseId) },
        });
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create test" });
    }
  });

  app.post("/api/admin/questions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const questions = Array.isArray(req.body) ? req.body : [req.body];
      for (const q of questions) {
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            q.testId,
            q.questionText,
            q.optionA,
            q.optionB,
            q.optionC,
            q.optionD,
            q.correctOption,
            q.explanation,
            q.topic,
            q.difficulty || "medium",
            q.marks || 4,
            q.negativeMarks || 1,
            q.orderIndex || 0,
            q.imageUrl || null,
            q.solutionImageUrl || null,
          ]
        );
      }
      await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [questions[0].testId]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add questions" });
    }
  });
}

