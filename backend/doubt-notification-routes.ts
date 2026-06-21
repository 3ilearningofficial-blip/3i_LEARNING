import type { Express, Request, Response } from "express";
import type { Pool } from "pg";
import { computeAutoNotificationHideAfterAt } from "./auto-notification-expiry";
import { takeSupportPostSlotPg } from "./pg-rate-limit-store";

// AI tutor rate limit: max 20 requests per hour per student.
// Each call triggers 3 DB queries + an LLM API call — uncapped use is expensive.
const AI_TUTOR_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AI_TUTOR_RATE_MAX = 20;

function normalizeQuestionPattern(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(please|plz|sir|mam|maam|kindly|can|could|would|help|me|with|solve|question)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLimitOffset(rawLimit: unknown, rawOffset: unknown, fallbackLimit: number, maxLimit = 100): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(maxLimit, Number(rawLimit) || fallbackLimit));
  const offset = Math.max(0, Number(rawOffset) || 0);
  return { limit, offset };
}

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterDoubtNotificationRoutesDeps = {
  app: Express;
  db: DbClient;
  pool: Pool;
  getAuthUser: (req: Request) => Promise<any>;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  generateAIAnswer: (question: string, topic?: string, userId?: number) => Promise<string>;
};

export function registerDoubtNotificationRoutes({
  app,
  db,
  pool,
  getAuthUser,
  requireAdmin,
  generateAIAnswer,
}: RegisterDoubtNotificationRoutesDeps): void {
  const buildAdminDoubtFilter = ({
    daysRaw,
    topicFilter,
    studentQuery,
  }: {
    daysRaw: string;
    topicFilter: string;
    studentQuery: string;
  }) => {
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
    return { whereSql, params };
  };

  app.post("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      // Rate-limit AI tutor calls per student — each call costs LLM API credits
      // and triggers 3 DB queries. Without a limit, a single user can exhaust quota.
      const slot = await takeSupportPostSlotPg(pool, user.id, AI_TUTOR_RATE_WINDOW_MS, AI_TUTOR_RATE_MAX);
      if (!slot.ok) {
        return res.status(429).json({
          message: `Too many AI tutor requests. Try again in about ${slot.retryAfterSec} seconds.`,
        });
      }

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

  app.delete("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const deleted = await db.query("DELETE FROM doubts WHERE user_id = $1 RETURNING id", [user.id]);
      res.json({ success: true, deletedCount: deleted.rows.length || 0 });
    } catch {
      res.status(500).json({ message: "Failed to clear doubt history" });
    }
  });

  app.get("/api/admin/doubts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const studentQuery = String(req.query.student || "").trim();
      const { whereSql, params } = buildAdminDoubtFilter({ daysRaw, topicFilter, studentQuery });

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

      const patternCounts: Record<string, { questionPattern: string; count: number; latestAt: number; sampleQuestion: string }> = {};
      for (const r of rows) {
        const normalized = normalizeQuestionPattern(String(r.question || ""));
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

  app.delete("/api/admin/doubts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const studentQuery = String(req.query.student || "").trim();
      const { whereSql, params } = buildAdminDoubtFilter({ daysRaw, topicFilter, studentQuery });
      const target = await db.query(
        `SELECT d.id
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 10000`,
        params
      );
      const ids = (target.rows || [])
        .map((r) => Number(r.id))
        .filter((id) => Number.isFinite(id));
      if (!ids.length) {
        return res.json({ success: true, deletedCount: 0 });
      }
      const deleted = await db.query(
        `DELETE FROM doubts
         WHERE id = ANY($1::int[])
         RETURNING id`,
        [ids]
      );
      return res.json({ success: true, deletedCount: deleted.rows.length || 0 });
    } catch (err) {
      console.error("[Admin Doubts] delete failed:", err);
      res.status(500).json({ message: "Failed to clear doubts" });
    }
  });

  app.get("/api/admin/doubts/students", requireAdmin, async (req: Request, res: Response) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

      const where: string[] = [];
      const params: unknown[] = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (topicFilter && topicFilter !== "all") {
        params.push(topicFilter);
        where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        const qIdx = params.length;
        const digitOnly = q.replace(/\D/g, "");
        let digitClause = "";
        if (digitOnly.length >= 4) {
          params.push(`%${digitOnly}%`);
          digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${params.length}`;
        }
        where.push(`(
          COALESCE(u.name, '') ILIKE $${qIdx}
          OR COALESCE(u.phone, '') ILIKE $${qIdx}
          OR COALESCE(u.email, '') ILIKE $${qIdx}
          OR COALESCE(d.question, '') ILIKE $${qIdx}
          ${digitClause}
        )`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const summary = await db.query(
        `SELECT d.user_id,
                COALESCE(u.name, '') AS user_name,
                COALESCE(u.phone, '') AS user_phone,
                COALESCE(u.email, '') AS user_email,
                COUNT(*)::int AS doubt_count,
                MAX(d.created_at)::bigint AS last_asked_at
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         GROUP BY d.user_id, u.name, u.phone, u.email
         ORDER BY COUNT(*) DESC, MAX(d.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const totalRows = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM (
           SELECT d.user_id
           FROM doubts d
           LEFT JOIN users u ON u.id = d.user_id
           ${whereSql}
           GROUP BY d.user_id
         ) s`,
        params
      );
      res.json({
        rows: summary.rows,
        total: Number(totalRows.rows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (err) {
      console.error("[Admin Doubts] students list failed:", err);
      res.status(500).json({ message: "Failed to fetch student doubt history" });
    }
  });

  app.get("/api/admin/doubts/student/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: "Invalid user id" });
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 50, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

      const where: string[] = ["d.user_id = $1"];
      const params: unknown[] = [userId];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (topicFilter && topicFilter !== "all") {
        params.push(topicFilter);
        where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(COALESCE(d.question, '') ILIKE $${params.length} OR COALESCE(d.answer, '') ILIKE $${params.length})`);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;

      const rows = await db.query(
        `SELECT d.*, COALESCE(u.name, '') AS user_name, COALESCE(u.phone, '') AS user_phone, COALESCE(u.email, '') AS user_email
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const totalRes = await db.query(
        `SELECT COUNT(*)::int AS total
         FROM doubts d
         ${whereSql}`,
        params
      );
      res.json({
        rows: rows.rows,
        total: Number(totalRes.rows[0]?.total || 0),
        limit,
        offset,
      });
    } catch (err) {
      console.error("[Admin Doubts] student details failed:", err);
      res.status(500).json({ message: "Failed to fetch student doubts" });
    }
  });

  app.get("/api/admin/doubts/frequent", requireAdmin, async (req: Request, res: Response) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
      const where: string[] = [];
      const params: unknown[] = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`COALESCE(d.question, '') ILIKE $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const baseRows = await db.query(
        `SELECT d.question, d.created_at
         FROM doubts d
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 5000`,
        params
      );
      const patternCounts: Record<string, { questionPattern: string; count: number; latestAt: number; sampleQuestion: string }> = {};
      for (const r of baseRows.rows) {
        const normalized = normalizeQuestionPattern(String(r.question || ""));
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
      const all = Object.values(patternCounts)
        .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt);
      res.json({
        rows: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        offset,
      });
    } catch (err) {
      console.error("[Admin Doubts] frequent list failed:", err);
      res.status(500).json({ message: "Failed to fetch frequent questions" });
    }
  });

  app.get("/api/admin/doubts/frequent/students", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pattern = normalizeQuestionPattern(String(req.query.pattern || ""));
      if (!pattern) return res.status(400).json({ message: "Pattern is required" });
      const daysRaw = String(req.query.days || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;

      const filterWhere: string[] = [];
      const params: unknown[] = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        filterWhere.push(`d.created_at >= $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        filterWhere.push(`(
          COALESCE(u.name, '') ILIKE $${params.length}
          OR COALESCE(u.phone, '') ILIKE $${params.length}
          OR COALESCE(u.email, '') ILIKE $${params.length}
          OR COALESCE(d.question, '') ILIKE $${params.length}
        )`);
      }
      const whereSql = filterWhere.length ? `AND ${filterWhere.join(" AND ")}` : "";

      const raw = await db.query(
        `SELECT d.user_id,
                COALESCE(u.name, '') AS user_name,
                COALESCE(u.phone, '') AS user_phone,
                COALESCE(u.email, '') AS user_email,
                d.question,
                d.created_at
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         WHERE TRUE ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 6000`,
        params
      );

      const matched = raw.rows.filter((r: any) => normalizeQuestionPattern(String(r.question || "")) === pattern);
      const grouped = new Map<number, { user_id: number; user_name: string; user_phone: string; user_email: string; doubt_count: number; last_asked_at: number }>();
      for (const r of matched) {
        const id = Number(r.user_id || 0);
        if (!grouped.has(id)) {
          grouped.set(id, {
            user_id: id,
            user_name: String(r.user_name || ""),
            user_phone: String(r.user_phone || ""),
            user_email: String(r.user_email || ""),
            doubt_count: 0,
            last_asked_at: 0,
          });
        }
        const g = grouped.get(id)!;
        g.doubt_count += 1;
        g.last_asked_at = Math.max(g.last_asked_at, Number(r.created_at || 0));
      }
      const rows = [...grouped.values()].sort((a, b) => b.doubt_count - a.doubt_count || b.last_asked_at - a.last_asked_at);
      res.json({
        rows: rows.slice(offset, offset + limit),
        total: rows.length,
        limit,
        offset,
      });
    } catch (err) {
      console.error("[Admin Doubts] frequent students failed:", err);
      res.status(500).json({ message: "Failed to fetch students for frequent question" });
    }
  });

  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const isAdmin = String(user.role || "") === "admin";
      const result = isAdmin
        ? await db.query(
            `SELECT * FROM notifications WHERE user_id = $1
             AND source = 'admin_ops'
             AND (is_hidden IS NOT TRUE)
             ORDER BY created_at DESC LIMIT 100`,
            [user.id]
          )
        : await db.query(
            `SELECT * FROM notifications WHERE user_id = $1
             AND (source IS NULL OR source != 'support')
             AND (is_hidden IS NOT TRUE)
             AND (
               admin_notif_id IS NOT NULL
               OR is_read IS NOT TRUE
               OR (hide_after_at IS NOT NULL AND hide_after_at > $2)
             )
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
      const now = Date.now();
      const existing = await db.query(
        "SELECT id, admin_notif_id, expires_at, is_read, source FROM notifications WHERE id = $1 AND user_id = $2",
        [req.params.id, user.id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }
      const row = existing.rows[0] as {
        admin_notif_id: number | null;
        expires_at: number | null;
        is_read: boolean;
        source: string | null;
      };
      const isAdminOps = row.source === "admin_ops";
      const hideAfterAt = isAdminOps
        ? null
        : row.admin_notif_id != null
          ? null
          : computeAutoNotificationHideAfterAt(now, row.expires_at != null ? Number(row.expires_at) : null);
      await db.query(
        `UPDATE notifications
         SET is_read = TRUE,
             hide_after_at = CASE
               WHEN source = 'admin_ops' THEN hide_after_at
               WHEN admin_notif_id IS NOT NULL THEN hide_after_at
               WHEN $3::bigint IS NOT NULL THEN $3::bigint
               ELSE hide_after_at
             END
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id, hideAfterAt]
      );
      res.json({ success: true, hide_after_at: hideAfterAt });
    } catch {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
}

