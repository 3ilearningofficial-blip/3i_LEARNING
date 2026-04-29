import type { Express, Request, Response } from "express";
import { assertTestAccess } from "./test-access-guards";
import { isEnrollmentExpired } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterTestCoreRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  updateCourseProgress: (userId: number, courseId: number) => Promise<void>;
};

export function registerTestCoreRoutes({
  app,
  db,
  getAuthUser,
  updateCourseProgress,
}: RegisterTestCoreRoutesDeps): void {
  app.get("/api/tests", async (req: Request, res: Response) => {
    try {
      const { courseId, type } = req.query;
      let query = `SELECT t.*, c.is_free AS course_is_free, c.price AS course_price, c.title AS course_title, c.id AS course_id_ref FROM tests t LEFT JOIN courses c ON t.course_id = c.id WHERE TRUE`;
      const params: unknown[] = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND course_id = $${params.length}`;
      } else {
        query += ` AND course_id IS NULL`;
      }
      if (type) {
        params.push(type);
        query += ` AND test_type = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      const user = await getAuthUser(req);
      const result = await db.query(query, params);
      let tests: any[] = result.rows;
      if (user) {
        const enrollResult = await db.query("SELECT course_id, valid_until FROM enrollments WHERE user_id = $1", [user.id]);
        const courseUnlocked = new Set<number>();
        for (const e of enrollResult.rows as { course_id: number; valid_until?: number | null }[]) {
          if (!isEnrollmentExpired(e as any)) courseUnlocked.add(Number(e.course_id));
        }
        tests = tests.map((t: any) => ({
          ...t,
          isLocked: !!(t.course_id && !t.course_is_free && !courseUnlocked.has(Number(t.course_id))),
        }));
      } else {
        tests = tests.map((t: any) => ({
          ...t,
          isLocked: !!(t.course_id && !t.course_is_free),
        }));
      }
      res.set("Cache-Control", "private, no-store");
      res.json(tests);
    } catch (err) {
      console.error("[api/tests] list error:", err);
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.get("/api/tests/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const testResult = await db.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];

      if (user.role !== "admin") {
        const a = await assertTestAccess(db, user, test, String(req.params.id));
        if (!a.ok) return res.status(403).json({ message: a.message });
      }

      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      res.json({ ...test, questions: questionsResult.rows });
    } catch {
      res.status(500).json({ message: "Failed to fetch test" });
    }
  });

  app.post("/api/tests/:id/attempt", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { answers, timeTakenSeconds, questionTimes } = req.body;
      const timeTaken = parseInt(String(timeTakenSeconds || "0")) || 0;
      const answerCount =
        answers && typeof answers === "object" ? Object.keys(answers as Record<string, unknown>).length : 0;
      console.log(`[Attempt] submit started test=${req.params.id} user=${user.id} answers=${answerCount} timeTaken=${timeTaken}`);
      const testResult = await db.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];

      if (user.role !== "admin") {
        const a = await assertTestAccess(db, user, test, String(req.params.id));
        if (!a.ok) return res.status(403).json({ message: a.message });
      }
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1", [req.params.id]);
      const questions = questionsResult.rows;

      let score = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let attemptedCount = 0;
      const topicErrors: Record<string, number> = {};
      const answersMap = typeof answers === "string" ? JSON.parse(answers) : answers || {};
      questions.forEach((q: Record<string, unknown>) => {
        const userAnswer = answersMap[String(q.id)] || answersMap[q.id as number];
        if (userAnswer) attemptedCount++;
        if (userAnswer === q.correct_option) {
          score += q.marks as number;
          correctCount++;
        } else if (userAnswer) {
          score -= parseFloat(q.negative_marks as string) || 0;
          incorrectCount++;
          const topic = (q.topic as string) || "General";
          topicErrors[topic] = (topicErrors[topic] || 0) + 1;
        }
      });

      const percentage = test.total_marks > 0 ? ((score / test.total_marks) * 100).toFixed(2) : 0;

      let attemptResult;
      try {
        attemptResult = await db.query(
          `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, question_times, status, started_at, completed_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12, $13) RETURNING id`,
          [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, questionTimes ? JSON.stringify(questionTimes) : null, Date.now() - timeTaken * 1000, Date.now()]
        );
      } catch (_e1) {
        try {
          attemptResult = await db.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, Date.now() - timeTaken * 1000, Date.now()]
          );
        } catch (_e2) {
          attemptResult = await db.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, Date.now() - timeTaken * 1000, Date.now()]
          );
        }
      }
      const weakTopics = Object.entries(topicErrors)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([topic]) => topic);

      if (test.course_id) {
        try {
          await updateCourseProgress(user.id, test.course_id);
        } catch (_pe) {}
      }

      res.json({
        attemptId: attemptResult.rows[0].id,
        score: Math.max(0, Math.round(score * 100) / 100),
        totalMarks: test.total_marks,
        percentage,
        correct: correctCount,
        incorrect: incorrectCount,
        attempted: attemptedCount,
        testType: test.test_type,
        weakTopics,
        passed: score >= (test.passing_marks || 0),
        questions: questions.map((q: Record<string, unknown>) => ({
          ...q,
          userAnswer: answersMap[String(q.id)] || answersMap[q.id as number] || null,
          isCorrect: (answersMap[String(q.id)] || answersMap[q.id as number]) === q.correct_option,
        })),
      });
    } catch (err) {
      console.error("[Attempt] Submit error:", err);
      res.status(500).json({ message: "Failed to submit test", detail: String(err) });
    }
  });
}

