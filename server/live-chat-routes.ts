import type { Express, Request, Response } from "express";
import { userCanAccessLiveClassContent } from "./live-class-access";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveChatRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<{ id: number; role: string } | null>;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

async function checkLiveClassAccess(
  req: Request,
  res: Response,
  db: DbClient,
  getAuthUser: (req: Request) => Promise<{ id: number; role: string } | null>,
  liveClassId: string
): Promise<boolean> {
  const lc = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  if (lc.rows.length === 0) {
    res.status(404).json({ message: "Live class not found" });
    return false;
  }

  const liveClass = lc.rows[0];
  const reqUser = (req as any).user as { id: number; role: string } | undefined;
  const user = reqUser || (await getAuthUser(req));
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return false;
  }
  const allow = await userCanAccessLiveClassContent(db, user, liveClass);
  if (!allow) {
    res.status(403).json({ message: "Not enrolled" });
    return false;
  }
  return true;
}

export function registerLiveChatRoutes({
  app,
  db,
  getAuthUser,
  requireAuth,
  requireAdmin,
}: RegisterLiveChatRoutesDeps): void {
  app.get("/api/live-classes/:id/chat", async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db, getAuthUser, req.params.id as string);
      if (!hasAccess) return;
      const { after } = req.query;
      let query = "SELECT * FROM live_chat_messages WHERE live_class_id = $1";
      const params: unknown[] = [req.params.id];
      if (after) {
        params.push(after);
        query += ` AND created_at > $${params.length}`;
      }
      query += " ORDER BY created_at ASC LIMIT 200";
      const result = await db.query(query, params);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });

  app.post("/api/live-classes/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db, getAuthUser, req.params.id as string);
      if (!hasAccess) return;
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });
      const user = (req as any).user;
      const result = await db.query(
        `INSERT INTO live_chat_messages (live_class_id, user_id, user_name, message, is_admin, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, user.id, user.name || user.phone, message.trim().slice(0, 500), user.role === "admin", Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.delete("/api/admin/live-classes/:lcId/chat/:msgId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_chat_messages WHERE id = $1 AND live_class_id = $2", [req.params.msgId, req.params.lcId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });
}

