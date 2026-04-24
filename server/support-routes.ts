import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = {
  id: number;
};

type RegisterSupportRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerSupportRoutes({
  app,
  db,
  getAuthUser,
  requireAdmin,
}: RegisterSupportRoutesDeps): void {
  app.get("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [user.id]
      );
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE",
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'user', $2, $3) RETURNING *",
        [user.id, message.trim().slice(0, 1000), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.get("/api/admin/support/conversations", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT u.id AS user_id, u.name, u.email, u.phone,
               COUNT(sm.id) FILTER (WHERE sm.is_read = FALSE AND sm.sender = 'user') AS unread_count,
               MAX(sm.created_at) AS last_message_at,
               (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message
        FROM users u
        JOIN support_messages sm ON sm.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.phone
        ORDER BY last_message_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [req.params.userId]
      );
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE",
        [req.params.userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  app.post("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'admin', $2, $3) RETURNING *",
        [req.params.userId, message.trim().slice(0, 1000), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send reply" });
    }
  });
}

