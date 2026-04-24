import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterDoubtNotificationRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  generateAIAnswer: (question: string, topic?: string) => Promise<string>;
};

export function registerDoubtNotificationRoutes({
  app,
  db,
  getAuthUser,
  generateAIAnswer,
}: RegisterDoubtNotificationRoutesDeps): void {
  app.post("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { question, topic } = req.body;
      const aiAnswer = await generateAIAnswer(question, topic);
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

  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const result = await db.query(
        `SELECT * FROM notifications WHERE user_id = $1
         AND (source IS NULL OR source != 'support')
         AND (is_hidden IS NOT TRUE)
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
      await db.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
}

