import type { Express, Request, Response } from "express";
import { userCanAccessLiveClassContent } from "./live-class-access";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = { id: number; role: string } | null;

type RegisterLiveClassPollRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<AuthUser>;
};

function nowMs() {
  return Date.now();
}

async function loadLiveClass(db: DbClient, id: string) {
  const r = await db.query("SELECT * FROM live_classes WHERE id = $1", [id]);
  return r.rows[0] || null;
}

async function finalizeExpiredPolls(db: DbClient, liveClassId: string) {
  const t = nowMs();
  await db.query(
    `UPDATE live_class_polls SET ended_at = $1 WHERE live_class_id = $2 AND ended_at IS NULL AND ends_at <= $3`,
    [t, liveClassId, t]
  );
}

async function finalizeExpiredTimers(db: DbClient, liveClassId: string) {
  const t = nowMs();
  await db.query(
    `UPDATE live_class_activity_timers SET ended_at = $1 WHERE live_class_id = $2 AND ended_at IS NULL AND ends_at <= $3`,
    [t, liveClassId, t]
  );
}

export function registerLiveClassPollRoutes({
  app,
  db,
  requireAuth,
  requireAdmin,
  getAuthUser,
}: RegisterLiveClassPollRoutesDeps): void {
  app.post("/api/admin/live-classes/:id/polls", requireAdmin, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser(req);
      const { kind, question, options, durationSeconds, correctOptionIndex } = req.body || {};

      if (kind !== "poll" && kind !== "quiz") {
        return res.status(400).json({ message: "kind must be poll or quiz" });
      }
      const q = String(question || "").trim();
      if (!q) return res.status(400).json({ message: "question required" });
      const opts: string[] = Array.isArray(options)
        ? options.map((o: unknown) => String(o || "").trim()).filter(Boolean)
        : [];
      if (opts.length < 2) return res.status(400).json({ message: "At least 2 options required" });

      const duration = Number(durationSeconds);
      if (!Number.isFinite(duration) || duration < 5 || duration > 600) {
        return res.status(400).json({ message: "durationSeconds must be 5–600" });
      }

      const started = nowMs();
      const ends = started + duration * 1000;

      await finalizeExpiredPolls(db, liveClassId);

      const pollRes = await db.query(
        `INSERT INTO live_class_polls (live_class_id, kind, question, duration_seconds, started_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [liveClassId, kind, q, duration, started, ends, user?.id || null]
      );
      const poll = pollRes.rows[0];
      const optionRows: { id: number; label: string; sort_order: number }[] = [];
      for (let i = 0; i < opts.length; i += 1) {
        const o = await db.query(
          `INSERT INTO live_class_poll_options (poll_id, label, sort_order) VALUES ($1, $2, $3) RETURNING id, label, sort_order`,
          [poll.id, opts[i], i]
        );
        optionRows.push(o.rows[0]);
      }

      let correctOptionId: number | null = null;
      if (kind === "quiz") {
        const idx = Number(correctOptionIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= optionRows.length) {
          return res.status(400).json({ message: "correctOptionIndex required for quiz" });
        }
        correctOptionId = optionRows[idx].id;
        await db.query("UPDATE live_class_polls SET correct_option_id = $1 WHERE id = $2", [
          correctOptionId,
          poll.id,
        ]);
        poll.correct_option_id = correctOptionId;
      }

      res.json({
        poll: { ...poll, correct_option_id: correctOptionId, options: optionRows },
      });
    } catch (err: any) {
      console.error("[Poll] create error:", err?.message || err);
      res.status(500).json({ message: "Failed to create poll" });
    }
  });

  app.post("/api/admin/live-classes/:id/polls/:pollId/end", requireAdmin, async (req: Request, res: Response) => {
    try {
      const t = nowMs();
      await db.query(
        "UPDATE live_class_polls SET ended_at = $1 WHERE id = $2 AND live_class_id = $3",
        [t, req.params.pollId, req.params.id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to end poll" });
    }
  });

  app.get("/api/admin/live-classes/:id/polls/:pollId/results", requireAdmin, async (req: Request, res: Response) => {
    try {
      const pollId = Number(req.params.pollId);
      const pollRes = await db.query("SELECT * FROM live_class_polls WHERE id = $1 AND live_class_id = $2", [
        pollId,
        req.params.id,
      ]);
      if (!pollRes.rows[0]) return res.status(404).json({ message: "Poll not found" });

      const options = await db.query(
        "SELECT id, label, sort_order FROM live_class_poll_options WHERE poll_id = $1 ORDER BY sort_order",
        [pollId]
      );
      const votes = await db.query(
        `SELECT option_id, COUNT(*)::int AS count FROM live_class_poll_votes WHERE poll_id = $1 GROUP BY option_id`,
        [pollId]
      );
      const total = votes.rows.reduce((s: number, r: any) => s + Number(r.count), 0);
      const results = options.rows.map((o: any) => {
        const row = votes.rows.find((v: any) => Number(v.option_id) === Number(o.id));
        const count = Number(row?.count || 0);
        return {
          ...o,
          count,
          percent: total > 0 ? Math.round((count / total) * 100) : 0,
        };
      });

      res.json({ poll: pollRes.rows[0], results, totalVotes: total });
    } catch {
      res.status(500).json({ message: "Failed to load poll results" });
    }
  });

  app.get("/api/live-classes/:id/polls/active", requireAuth, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser(req);
      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lc))) {
        return res.status(403).json({ message: "Access denied" });
      }

      await finalizeExpiredPolls(db, liveClassId);
      const t = nowMs();
      const pollRes = await db.query(
        `SELECT * FROM live_class_polls
         WHERE live_class_id = $1 AND ended_at IS NULL AND ends_at > $2
         ORDER BY started_at DESC LIMIT 1`,
        [liveClassId, t]
      );
      const poll = pollRes.rows[0];
      if (!poll) return res.json({ poll: null });

      const options = await db.query(
        "SELECT id, label, sort_order FROM live_class_poll_options WHERE poll_id = $1 ORDER BY sort_order",
        [poll.id]
      );

      let myVote: number | null = null;
      if (user) {
        const v = await db.query(
          "SELECT option_id FROM live_class_poll_votes WHERE poll_id = $1 AND user_id = $2",
          [poll.id, user.id]
        );
        myVote = v.rows[0]?.option_id ?? null;
      }

      const ended = Number(poll.ends_at) <= t;
      res.json({
        poll: { ...poll, options: options.rows, ended, myVoteOptionId: myVote },
      });
    } catch {
      res.status(500).json({ message: "Failed to load poll" });
    }
  });

  app.post("/api/live-classes/:id/polls/:pollId/vote", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const pollId = Number(req.params.pollId);
      const optionId = Number(req.body?.optionId);
      if (!Number.isFinite(optionId)) return res.status(400).json({ message: "optionId required" });

      const pollRes = await db.query(
        "SELECT * FROM live_class_polls WHERE id = $1 AND live_class_id = $2",
        [pollId, req.params.id]
      );
      const poll = pollRes.rows[0];
      if (!poll) return res.status(404).json({ message: "Poll not found" });
      const t = nowMs();
      if (poll.ended_at || Number(poll.ends_at) <= t) {
        return res.status(400).json({ message: "Poll has ended" });
      }

      const opt = await db.query(
        "SELECT id FROM live_class_poll_options WHERE id = $1 AND poll_id = $2",
        [optionId, pollId]
      );
      if (!opt.rows[0]) return res.status(400).json({ message: "Invalid option" });

      await db.query(
        `INSERT INTO live_class_poll_votes (poll_id, user_id, option_id, voted_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = EXCLUDED.voted_at`,
        [pollId, user.id, optionId, t]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to vote" });
    }
  });

  app.post("/api/admin/live-classes/:id/activity-timer", requireAdmin, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser(req);
      const label = String(req.body?.label || "Answer before time ends").trim();
      const duration = Number(req.body?.durationSeconds);
      if (!Number.isFinite(duration) || duration < 5 || duration > 3600) {
        return res.status(400).json({ message: "durationSeconds must be 5–3600" });
      }
      const started = nowMs();
      const ends = started + duration * 1000;
      await finalizeExpiredTimers(db, liveClassId);
      const r = await db.query(
        `INSERT INTO live_class_activity_timers (live_class_id, label, duration_seconds, started_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [liveClassId, label, duration, started, ends, user?.id || null]
      );
      res.json({ timer: r.rows[0] });
    } catch {
      res.status(500).json({ message: "Failed to start timer" });
    }
  });

  app.get("/api/live-classes/:id/activity-timer/active", requireAuth, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser(req);
      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lc))) {
        return res.status(403).json({ message: "Access denied" });
      }
      await finalizeExpiredTimers(db, liveClassId);
      const t = nowMs();
      const r = await db.query(
        `SELECT * FROM live_class_activity_timers
         WHERE live_class_id = $1 AND ended_at IS NULL AND ends_at > $2
         ORDER BY started_at DESC LIMIT 1`,
        [liveClassId, t]
      );
      const timer = r.rows[0];
      if (!timer) return res.json({ timer: null });
      res.json({
        timer: {
          ...timer,
          remainingSeconds: Math.max(0, Math.ceil((Number(timer.ends_at) - t) / 1000)),
        },
      });
    } catch {
      res.status(500).json({ message: "Failed to load timer" });
    }
  });
}
