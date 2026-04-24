import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterTestFolderRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
};

export function registerTestFolderRoutes({
  app,
  db,
  getAuthUser,
}: RegisterTestFolderRoutesDeps): void {
  app.get("/api/test-folders", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const result = await db.query(
        "SELECT sf.*, (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = sf.id) as total_tests FROM standalone_folders sf WHERE sf.type = 'mini_course' AND (sf.is_hidden = FALSE OR sf.is_hidden IS NULL) ORDER BY sf.created_at DESC"
      );
      const folders = result.rows.map((f: any) => ({ ...f, is_purchased: false }));
      if (user) {
        const purchases = await db.query("SELECT folder_id FROM folder_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchases.rows.map((p: any) => p.folder_id));
        for (const f of folders) f.is_purchased = f.is_free || purchasedIds.has(f.id);
      } else {
        for (const f of folders) f.is_purchased = f.is_free;
      }
      res.json(folders);
    } catch (err) {
      console.error("Test folders error:", err);
      res.status(500).json({ message: "Failed to fetch test folders" });
    }
  });

  app.get("/api/test-folders/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      const f = folder.rows[0];
      const tests = await db.query("SELECT t.*, t.folder_name as sub_folder FROM tests t WHERE t.mini_course_id = $1 ORDER BY t.folder_name ASC NULLS LAST, t.created_at ASC", [f.id]);
      let isPurchased = f.is_free;
      const attempts: Record<number, any> = {};
      if (user) {
        const purchase = await db.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, f.id]);
        if (purchase.rows.length > 0) isPurchased = true;
        if (tests.rows.length > 0) {
          const attemptsResult = await db.query(
            "SELECT test_id, score, total_marks, completed_at FROM test_attempts WHERE user_id = $1 AND test_id = ANY($2) AND completed_at IS NOT NULL ORDER BY score DESC",
            [user.id, tests.rows.map((t: any) => t.id)]
          );
          for (const a of attemptsResult.rows) {
            if (!attempts[a.test_id]) attempts[a.test_id] = a;
          }
        }
      }
      res.json({ ...f, is_purchased: isPurchased, tests: tests.rows, attempts });
    } catch (err) {
      console.error("Test folder detail error:", err);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });

  app.post("/api/test-folders/:id/enroll", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      if (!folder.rows[0].is_free) return res.status(400).json({ message: "This folder requires payment" });
      await db.query("INSERT INTO folder_purchases (user_id, folder_id, amount) VALUES ($1, $2, 0) ON CONFLICT (user_id, folder_id) DO NOTHING", [user.id, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to enroll" });
    }
  });
}

