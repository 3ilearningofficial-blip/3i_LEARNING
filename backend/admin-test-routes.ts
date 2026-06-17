import type { Express, Request, Response } from "express";
import { autoNotificationExpiresAt } from "./auto-notification-expiry";
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
        ORDER BY COALESCE(t.order_index, 0) ASC, t.created_at DESC
      `);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.get("/api/admin/tests/:id/attempts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const testId = Number(req.params.id);
      if (!Number.isFinite(testId) || testId <= 0) {
        return res.status(400).json({ message: "Invalid test id" });
      }

      const [testResult, questionsResult, attemptsResult] = await Promise.all([
        db.query(
          `SELECT t.*, c.title AS course_title, sf.name AS mini_course_title
           FROM tests t
           LEFT JOIN courses c ON c.id = t.course_id
           LEFT JOIN standalone_folders sf ON sf.id = t.mini_course_id
           WHERE t.id = $1`,
          [testId]
        ),
        db.query(
          `SELECT id, question_text, option_a, option_b, option_c, option_d,
                  correct_option, explanation, topic, difficulty, marks,
                  negative_marks, image_url, solution_image_url, order_index
           FROM questions
           WHERE test_id = $1
           ORDER BY order_index ASC, id ASC`,
          [testId]
        ),
        db.query(
          `SELECT DISTINCT ON (ta.user_id)
                  ta.id AS attempt_id,
                  ta.user_id,
                  ta.score,
                  ta.total_marks,
                  ta.percentage,
                  ta.correct,
                  ta.incorrect,
                  ta.attempted,
                  ta.time_taken_seconds,
                  ta.completed_at,
                  ta.answers,
                  ta.question_times,
                  u.name,
                  u.phone,
                  u.email
           FROM test_attempts ta
           JOIN users u ON u.id = ta.user_id
           WHERE ta.test_id = $1 AND ta.status = 'completed'
           ORDER BY ta.user_id, ta.completed_at DESC`,
          [testId]
        ),
      ]);

      if (testResult.rows.length === 0) {
        return res.status(404).json({ message: "Test not found" });
      }

      const attempts = attemptsResult.rows
        .map((row: any) => ({
          ...row,
          score: Number(row.score || 0),
          total_marks: Number(row.total_marks || 0),
          percentage: Number(row.percentage || 0),
          correct: Number(row.correct || 0),
          incorrect: Number(row.incorrect || 0),
          attempted: Number(row.attempted || 0),
          time_taken_seconds: Number(row.time_taken_seconds || 0),
          answers: typeof row.answers === "string" ? JSON.parse(row.answers || "{}") : row.answers || {},
          question_times: typeof row.question_times === "string" ? JSON.parse(row.question_times || "{}") : row.question_times || {},
        }))
        .sort((a: any, b: any) => {
          const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
          if (scoreDiff !== 0) return scoreDiff;
          return Number(a.time_taken_seconds || 0) - Number(b.time_taken_seconds || 0);
        });

      res.json({
        test: testResult.rows[0],
        questions: questionsResult.rows,
        attempts,
      });
    } catch (err) {
      console.error("[AdminTests] Failed to fetch test attempts:", err);
      res.status(500).json({ message: "Failed to fetch test attempts" });
    }
  });

  app.post("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, miniCourseId, price, subjectKey } =
        req.body;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, mini_course_id, price, subject_key, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14) RETURNING *`,
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
          normalizedSubjectKey,
          Date.now(),
        ]
      );
      if (courseId) {
        await updateCourseTestCounts(courseId);
        const courseInfo = await db.query("SELECT title FROM courses WHERE id = $1", [courseId]).catch(() => ({ rows: [] as any[] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]).catch(() => ({ rows: [] as any[] }));
        const recipientIds = recipients.rows.map((r: any) => Number(r.user_id));
        const testTypeNorm = String(testType || "practice").toLowerCase();
        const notifTitle =
          testTypeNorm === "mock" ? "📝 New Mock Test Added" : testTypeNorm === "pyq" ? "📝 New PYQ Added" : "📝 New Test Added";
        const notifMessage = `"${title}" has been added in ${courseTitle}.`;
        const now = Date.now();
        const expiresAt = autoNotificationExpiresAt(now);
        if (recipientIds.length > 0) {
          await db
            .query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
               FROM unnest($1::int[]) AS u`,
              [recipientIds, notifTitle, notifMessage, "info", now, expiresAt]
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
      const rawList = Array.isArray(req.body) ? req.body : [req.body];
      const testId = rawList[0]?.testId;
      if (!testId) {
        return res.status(400).json({ message: "testId is required" });
      }

      async function assignNextOrderInsert(q: any): Promise<number> {
        const insertAfter = q.insertAfterQuestionId ?? q.afterQuestionId;
        const parsedAfter =
          insertAfter !== undefined && insertAfter !== null && insertAfter !== ""
            ? parseInt(String(insertAfter), 10)
            : NaN;

        if (Number.isFinite(parsedAfter)) {
          const ref = await db.query(
            `SELECT order_index FROM questions WHERE id = $1 AND test_id = $2`,
            [parsedAfter, testId]
          );
          if (ref.rows.length > 0) {
            const k = Number(ref.rows[0].order_index ?? 0);
            await db.query(
              `UPDATE questions SET order_index = order_index + 1 WHERE test_id = $1 AND order_index > $2`,
              [testId, k]
            );
            return k + 1;
          }
        }

        const maxRow = await db.query(`SELECT COALESCE(MAX(order_index), 0)::numeric AS m FROM questions WHERE test_id = $1`, [testId]);
        const max = Number(maxRow.rows[0]?.m ?? 0);
        return max + 1;
      }

      for (const q of rawList) {
        const { insertAfterQuestionId: _a, afterQuestionId: _b, orderIndex: _ignoredOrder, ...rest } = q;
        const orderIndex = await assignNextOrderInsert(q);

        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            rest.testId,
            rest.questionText,
            rest.optionA,
            rest.optionB,
            rest.optionC,
            rest.optionD,
            rest.correctOption,
            rest.explanation,
            rest.topic,
            rest.difficulty || "medium",
            rest.marks ?? 4,
            rest.negativeMarks ?? 1,
            orderIndex,
            rest.imageUrl || null,
            rest.solutionImageUrl || null,
          ]
        );
      }

      await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add questions" });
    }
  });
}

