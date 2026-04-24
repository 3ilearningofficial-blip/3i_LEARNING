import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterTestAttemptRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
};

export function registerTestAttemptRoutes({
  app,
  db,
  getAuthUser,
}: RegisterTestAttemptRoutesDeps): void {
  app.get("/api/tests/:id/my-attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  app.get("/api/tests/:id/my_attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  app.get("/api/tests/:id/analysis/:attemptId", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const attemptRes = await db.query("SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2", [req.params.attemptId, user.id]);
      if (attemptRes.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const attempt = attemptRes.rows[0];
      const answers = typeof attempt.answers === "string" ? JSON.parse(attempt.answers) : attempt.answers || {};

      const questionsRes = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      const questions = questionsRes.rows;

      const topicMap: Record<string, { total: number; correct: number; wrong: number; skipped: number; qNums: number[] }> = {};
      questions.forEach((q: any, idx: number) => {
        const topic = q.topic || "Uncategorized";
        if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0, wrong: 0, skipped: 0, qNums: [] };
        const ua = answers[String(q.id)] || answers[q.id];
        topicMap[topic].total++;
        topicMap[topic].qNums.push(idx + 1);
        if (!ua) topicMap[topic].skipped++;
        else if (ua === q.correct_option) topicMap[topic].correct++;
        else topicMap[topic].wrong++;
      });

      const topics = Object.entries(topicMap).map(([name, data]) => ({
        name,
        total: data.total,
        correct: data.correct,
        wrong: data.wrong,
        skipped: data.skipped,
        correctPct: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
        qNums: data.qNums,
        isWeak: data.total > 0 && data.correct / data.total < 0.5,
      }));

      const topperRes = await db.query(
        `SELECT DISTINCT ON (user_id) score, total_marks, percentage, correct, incorrect, attempted, time_taken_seconds
         FROM test_attempts WHERE test_id = $1 AND status = 'completed'
         ORDER BY user_id, score DESC, time_taken_seconds ASC`,
        [req.params.id]
      );
      const allAttempts = topperRes.rows;
      const topper = allAttempts.sort((a: any, b: any) => parseFloat(b.score) - parseFloat(a.score))[0];

      const avgRes = await db.query(
        `SELECT AVG(score::numeric) as avg_score, AVG(percentage::numeric) as avg_pct,
                AVG(correct) as avg_correct, AVG(incorrect) as avg_incorrect,
                AVG(time_taken_seconds) as avg_time
         FROM (
           SELECT DISTINCT ON (user_id) score, percentage, correct, incorrect, time_taken_seconds
           FROM test_attempts WHERE test_id = $1 AND status = 'completed'
           ORDER BY user_id, score DESC
         ) sub`,
        [req.params.id]
      );
      const avg = avgRes.rows[0];

      let youCorrect = attempt.correct != null ? parseInt(attempt.correct) : null;
      let youIncorrect = attempt.incorrect != null ? parseInt(attempt.incorrect) : null;
      if (youCorrect === null || youIncorrect === null) {
        let c = 0,
          w = 0;
        questions.forEach((q: any) => {
          const ua = answers[String(q.id)] || answers[q.id];
          if (ua === q.correct_option) c++;
          else if (ua) w++;
        });
        youCorrect = c;
        youIncorrect = w;
      }

      res.json({
        topics,
        topper: topper
          ? {
              score: parseFloat(topper.score),
              totalMarks: topper.total_marks,
              percentage: parseFloat(topper.percentage),
              correct: topper.correct != null ? topper.correct : null,
              incorrect: topper.incorrect != null ? topper.incorrect : null,
              timeTaken: topper.time_taken_seconds || 0,
            }
          : null,
        avg: avg
          ? {
              score: parseFloat(avg.avg_score) || 0,
              percentage: parseFloat(avg.avg_pct) || 0,
              correct: avg.avg_correct != null ? Math.round(parseFloat(avg.avg_correct)) : null,
              incorrect: avg.avg_incorrect != null ? Math.round(parseFloat(avg.avg_incorrect)) : null,
              timeTaken: Math.round(parseFloat(avg.avg_time) || 0),
            }
          : null,
        you: {
          score: parseFloat(attempt.score),
          totalMarks: attempt.total_marks,
          percentage: parseFloat(attempt.percentage),
          correct: youCorrect,
          incorrect: youIncorrect,
          timeTaken: attempt.time_taken_seconds || 0,
        },
      });
    } catch (err) {
      console.error("[Analysis]", err);
      res.status(500).json({ message: "Failed to fetch analysis" });
    }
  });

  app.get("/api/tests/:id/leaderboard", async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT DISTINCT ON (ta.user_id)
           ta.score, ta.percentage, ta.time_taken_seconds, u.name, u.id as user_id
         FROM test_attempts ta JOIN users u ON ta.user_id = u.id 
         WHERE ta.test_id = $1 AND ta.status = 'completed' 
         ORDER BY ta.user_id, ta.score DESC, ta.time_taken_seconds ASC`,
        [req.params.id]
      );
      const sorted = result.rows.sort((a: any, b: any) => {
        const scoreDiff = parseFloat(b.score) - parseFloat(a.score);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.time_taken_seconds || 0) - (b.time_taken_seconds || 0);
      });
      const leaderboard = sorted.slice(0, 20).map((r: Record<string, unknown>, i: number) => ({ ...r, rank: i + 1 }));
      res.json(leaderboard);
    } catch {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get("/api/my-attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.*, t.title, t.total_marks, t.test_type FROM test_attempts ta 
         JOIN tests t ON ta.test_id = t.id 
         WHERE ta.user_id = $1 AND ta.status = 'completed'
           AND (t.course_id IS NULL OR t.course_id IN (SELECT id FROM courses WHERE course_type = 'test_series'))
         ORDER BY ta.completed_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  app.get("/api/my-attempts/summary", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT DISTINCT ON (ta.test_id)
           ta.test_id, ta.id AS attempt_id, ta.score, ta.total_marks, ta.percentage,
           ta.correct, ta.incorrect, ta.attempted, ta.time_taken_seconds, ta.completed_at
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.status = 'completed'
         ORDER BY ta.test_id, ta.completed_at ASC`,
        [user.id]
      );
      const summary: Record<number, any> = {};
      result.rows.forEach((row: any) => {
        summary[row.test_id] = row;
      });
      res.json(summary);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempt summary" });
    }
  });

  app.get("/api/attempts/:attemptId/detail", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const attempt = await db.query("SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2", [req.params.attemptId, user.id]);
      if (attempt.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const att = attempt.rows[0];
      const questions = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [att.test_id]);
      const answers = typeof att.answers === "string" ? JSON.parse(att.answers) : att.answers || {};
      const qTimes = att.question_times ? (typeof att.question_times === "string" ? JSON.parse(att.question_times) : att.question_times) : {};
      res.json({
        attemptId: att.id,
        testId: att.test_id,
        score: att.score,
        totalMarks: att.total_marks,
        timeTakenSeconds: att.time_taken_seconds,
        questions: questions.rows.map((q: any) => ({
          ...q,
          userAnswer: answers[q.id] || null,
          isCorrect: answers[q.id] === q.correct_option,
          timeTaken: qTimes[q.id] || null,
        })),
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch attempt detail" });
    }
  });

  app.post("/api/questions/:id/report", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { reason, details } = req.body;
      await db.query(
        `INSERT INTO question_reports (question_id, user_id, reason, details, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (question_id, user_id) DO UPDATE SET reason=$3, details=$4, created_at=$5`,
        [req.params.id, user.id, reason, details || null, Date.now()]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to submit report" });
    }
  });
}

