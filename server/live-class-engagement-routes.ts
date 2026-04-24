import type { Express, Request, Response } from "express";

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
  app.post("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await db.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET last_heartbeat = $4, user_name = $3`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });

  app.get("/api/live-classes/:id/viewers", async (req: Request, res: Response) => {
    try {
      const cutoff = Date.now() - 30000;
      const result = await db.query(
        `SELECT user_id, user_name FROM live_class_viewers
         WHERE live_class_id = $1 AND last_heartbeat > $2
         ORDER BY user_name ASC`,
        [req.params.id, cutoff]
      );
      const lcResult = await db.query("SELECT show_viewer_count FROM live_classes WHERE id = $1", [req.params.id]);
      const visible = lcResult.rows[0]?.show_viewer_count ?? true;
      res.json({ viewers: result.rows, count: result.rows.length, visible });
    } catch (err) {
      console.error("Viewer list error:", err);
      res.status(500).json({ message: "Failed to fetch viewers" });
    }
  });

  app.post("/api/live-classes/:id/raise-hand", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
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

