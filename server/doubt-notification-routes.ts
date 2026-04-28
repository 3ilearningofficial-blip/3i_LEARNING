import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterDoubtNotificationRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  generateAIAnswer: (question: string, topic?: string, userId?: number) => Promise<string>;
};

export function registerDoubtNotificationRoutes({
  app,
  db,
  getAuthUser,
  requireAdmin,
  generateAIAnswer,
}: RegisterDoubtNotificationRoutesDeps): void {
  app.post("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { question, topic } = req.body;
      const aiAnswer = await generateAIAnswer(question, topic, user.id);
      const result = await db.query(
        "INSERT INTO doubts (user_id, question, answer, topic, status, created_at) VALUES ($1, $2, $3, $4, 'answered', $5) RETURNING *",
        [user.id, question, aiAnswer, topic, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit doubt" });
    }
  });

  app.get("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query("SELECT * FROM doubts WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch doubts" });
    }
  });

  app.get("/api/admin/doubts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const studentQuery = String(req.query.student || "").trim();
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

      const where: string[] = [];
      const params: unknown[] = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (topicFilter) {
        params.push(topicFilter);
        where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
      }
      if (studentQuery) {
        params.push(`%${studentQuery}%`);
        const textParamIdx = params.length;
        const digitOnly = studentQuery.replace(/\D/g, "");
        let digitClause = "";
        if (digitOnly.length >= 4) {
          params.push(`%${digitOnly}%`);
          const digitParamIdx = params.length;
          digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${digitParamIdx}`;
        }
        where.push(`(
          COALESCE(u.name, '') ILIKE $${textParamIdx}
          OR COALESCE(u.phone, '') ILIKE $${textParamIdx}
          OR COALESCE(u.email, '') ILIKE $${textParamIdx}
          OR COALESCE(d.question, '') ILIKE $${textParamIdx}
          ${digitClause}
        )`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const baseSelect = `SELECT d.*, u.name as user_name, u.phone as user_phone, u.email as user_email
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id`;
      const result = await db.query(
        `${baseSelect}
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 500`,
        params
      );
      let rows = result.rows || [];

      // If search text is provided but strict filters yield no rows, relax non-student filters automatically.
      if (rows.length === 0 && studentQuery) {
        const relaxedParams: unknown[] = [];
        relaxedParams.push(`%${studentQuery}%`);
        const textParamIdx = relaxedParams.length;
        const digitOnly = studentQuery.replace(/\D/g, "");
        let digitClause = "";
        if (digitOnly.length >= 4) {
          relaxedParams.push(`%${digitOnly}%`);
          const digitParamIdx = relaxedParams.length;
          digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${digitParamIdx}`;
        }
        const relaxedWhere = `WHERE (
          COALESCE(u.name, '') ILIKE $${textParamIdx}
          OR COALESCE(u.phone, '') ILIKE $${textParamIdx}
          OR COALESCE(u.email, '') ILIKE $${textParamIdx}
          OR COALESCE(d.question, '') ILIKE $${textParamIdx}
          ${digitClause}
        )`;
        const relaxed = await db.query(
          `${baseSelect}
           ${relaxedWhere}
           ORDER BY d.created_at DESC
           LIMIT 500`,
          relaxedParams
        );
        rows = relaxed.rows || [];
      }
      const topicCounts: Record<string, number> = {};
      for (const r of rows) {
        const k = String(r.topic || "General").trim() || "General";
        topicCounts[k] = (topicCounts[k] || 0) + 1;
      }
      const topTopics = Object.entries(topicCounts)
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const normalizeQuestion = (input: string): string =>
        String(input || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\b(please|plz|sir|mam|maam|kindly|can|could|would|help|me|with|solve|question)\b/g, " ")
          .replace(/\s+/g, " ")
          .trim();

      const patternCounts: Record<string, { questionPattern: string; count: number; latestAt: number; sampleQuestion: string }> = {};
      for (const r of rows) {
        const normalized = normalizeQuestion(String(r.question || ""));
        if (!normalized) continue;
        const existing = patternCounts[normalized];
        if (!existing) {
          patternCounts[normalized] = {
            questionPattern: normalized,
            count: 1,
            latestAt: Number(r.created_at || 0),
            sampleQuestion: String(r.question || ""),
          };
        } else {
          existing.count += 1;
          if (Number(r.created_at || 0) > existing.latestAt) {
            existing.latestAt = Number(r.created_at || 0);
            existing.sampleQuestion = String(r.question || existing.sampleQuestion);
          }
        }
      }
      const repeatedPatterns = Object.values(patternCounts)
        .filter((p) => p.count >= 2)
        .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt)
        .slice(0, 12);

      const studentMap: Record<string, { user_id: number; name: string; phone: string; email: string; doubtCount: number; lastAskedAt: number; topTopic: string }> = {};
      const perStudentTopicCounts: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const idKey = String(r.user_id || 0);
        if (!studentMap[idKey]) {
          studentMap[idKey] = {
            user_id: Number(r.user_id || 0),
            name: String(r.user_name || ""),
            phone: String(r.user_phone || ""),
            email: String(r.user_email || ""),
            doubtCount: 0,
            lastAskedAt: 0,
            topTopic: "General",
          };
          perStudentTopicCounts[idKey] = {};
        }
        const s = studentMap[idKey];
        s.doubtCount += 1;
        s.lastAskedAt = Math.max(s.lastAskedAt, Number(r.created_at || 0));
        const topic = String(r.topic || "General").trim() || "General";
        perStudentTopicCounts[idKey][topic] = (perStudentTopicCounts[idKey][topic] || 0) + 1;
      }
      const studentInsights = Object.values(studentMap)
        .map((s) => {
          const topicCounter = perStudentTopicCounts[String(s.user_id)] || {};
          const topTopicEntry = Object.entries(topicCounter).sort((a, b) => b[1] - a[1])[0];
          return { ...s, topTopic: topTopicEntry?.[0] || "General" };
        })
        .sort((a, b) => b.doubtCount - a.doubtCount || b.lastAskedAt - a.lastAskedAt)
        .slice(0, 20);

      res.json({ doubts: rows, topTopics, repeatedPatterns, studentInsights, total: rows.length });
    } catch {
      res.status(500).json({ message: "Failed to fetch admin doubts" });
    }
  });

  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const result = await db.query(
        `SELECT * FROM notifications WHERE user_id = $1
         AND (source IS NULL OR source != 'support')
         AND (is_hidden IS NOT TRUE)
         AND (is_read IS NOT TRUE)
         AND (expires_at IS NULL OR expires_at > $2)
         AND title NOT ILIKE 'New message from%'
         AND title NOT ILIKE 'New reply from Support%'
         ORDER BY created_at DESC LIMIT 50`,
        [user.id, now]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.put("/api/notifications/:id/read", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db.query("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
}

