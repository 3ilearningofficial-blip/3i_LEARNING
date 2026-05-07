import type { Express, Request, Response } from "express";
import { userCanAccessLiveClassContent } from "./live-class-access";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveClassEngagementRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerLiveClassEngagementRoutes({
  app,
  db,
  requireAuth,
  requireAdmin,
}: RegisterLiveClassEngagementRoutesDeps): void {
  /** Recording replay progress (after class is completed): debounced session count + optional watch %. */
  app.post("/api/live-classes/:id/recording-progress", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const lcResult = await db.query(
        "SELECT id, course_id, is_free_preview, is_completed, recording_url FROM live_classes WHERE id = $1",
        [req.params.id]
      );
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const lc = lcResult.rows[0];
      if (!(await userCanAccessLiveClassContent(db, user, lc))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lc.is_completed || !String(lc.recording_url || "").trim()) {
        return res.status(400).json({ message: "Recording not available for this class" });
      }
      const body = req.body || {};
      const openSession = Boolean(body.openSession);
      const watchPercentRaw = body.watchPercent != null ? Number(body.watchPercent) : null;
      const now = Date.now();
      const debounceMs = 8 * 60 * 1000;

      if (watchPercentRaw != null && Number.isFinite(watchPercentRaw)) {
        const wp = Math.max(0, Math.min(100, Math.round(watchPercentRaw)));
        await db.query(
          `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at)
           VALUES ($1, $2, $3, 0, NULL, $4)
           ON CONFLICT (user_id, live_class_id) DO UPDATE SET
             watch_percent = GREATEST(live_class_recording_progress.watch_percent, EXCLUDED.watch_percent),
             updated_at = EXCLUDED.updated_at`,
          [user.id, req.params.id, wp, now]
        );
      }

      if (openSession) {
        const prev = await db.query(
          "SELECT playback_sessions, last_session_ping_at FROM live_class_recording_progress WHERE user_id = $1 AND live_class_id = $2",
          [user.id, req.params.id]
        );
        const row = prev.rows[0];
        const canBump = !row?.last_session_ping_at || now - Number(row.last_session_ping_at) >= debounceMs;
        if (!row) {
          await db.query(
            `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at)
             VALUES ($1, $2, 0, 1, $3, $3)`,
            [user.id, req.params.id, now]
          );
        } else if (canBump) {
          await db.query(
            `UPDATE live_class_recording_progress SET
               playback_sessions = COALESCE(playback_sessions, 0) + 1,
               last_session_ping_at = $3,
               updated_at = $3
             WHERE user_id = $1 AND live_class_id = $2`,
            [user.id, req.params.id, now]
          );
        }
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Recording progress error:", err);
      res.status(500).json({ message: "Failed to save recording progress" });
    }
  });

  app.post("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const lcResult = await db.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lcResult.rows[0]))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Class is not live" });
      }
      const now = Date.now();
      await db.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET
           last_heartbeat = EXCLUDED.last_heartbeat,
           user_name = COALESCE(EXCLUDED.user_name, live_class_viewers.user_name)
         WHERE live_class_viewers.last_heartbeat IS NULL
            OR EXCLUDED.last_heartbeat - live_class_viewers.last_heartbeat >= 20000`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", now]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });

  app.get("/api/live-classes/:id/viewers", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const lcAccess = await db.query("SELECT course_id, is_free_preview, show_viewer_count, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcAccess.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lcAccess.rows[0]))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcAccess.rows[0].is_live || lcAccess.rows[0].is_completed) {
        const visible = lcAccess.rows[0]?.show_viewer_count ?? true;
        return res.json({ viewers: [], count: 0, visible });
      }
      const cutoff = Date.now() - 30000;
      const result = await db.query(
        `SELECT user_name FROM live_class_viewers
         WHERE live_class_id = $1 AND last_heartbeat > $2
         ORDER BY user_name ASC`,
        [req.params.id, cutoff]
      );
      const visible = lcAccess.rows[0]?.show_viewer_count ?? true;
      res.json({ viewers: result.rows, count: result.rows.length, visible });
    } catch (err) {
      console.error("Viewer list error:", err);
      res.status(500).json({ message: "Failed to fetch viewers" });
    }
  });

  app.post("/api/live-classes/:id/raise-hand", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const lcResult = await db.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lcResult.rows[0]))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Hand raise is available only during live class" });
      }
      await db.query(
        `INSERT INTO live_class_hand_raises (live_class_id, user_id, user_name, raised_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET raised_at = $4`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Raise hand error:", err);
      res.status(500).json({ message: "Failed to raise hand" });
    }
  });

  app.delete("/api/live-classes/:id/raise-hand", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const lcResult = await db.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!(await userCanAccessLiveClassContent(db, user, lcResult.rows[0]))) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Hand raise is available only during live class" });
      }
      await db.query("DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2", [req.params.id, user.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Lower hand error:", err);
      res.status(500).json({ message: "Failed to lower hand" });
    }
  });

  app.get("/api/admin/live-classes/:id/raised-hands", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT id, user_id, user_name, raised_at FROM live_class_hand_raises WHERE live_class_id = $1 ORDER BY raised_at ASC",
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Raised hands list error:", err);
      res.status(500).json({ message: "Failed to fetch raised hands" });
    }
  });

  app.post("/api/admin/live-classes/:id/raised-hands/:userId/resolve", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Resolve hand error:", err);
      res.status(500).json({ message: "Failed to resolve hand raise" });
    }
  });
}

