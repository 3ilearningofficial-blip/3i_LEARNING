import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterSiteSettingsRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerSiteSettingsRoutes({
  app,
  db,
  requireAdmin,
}: RegisterSiteSettingsRoutesDeps): void {
  app.get("/api/site-settings", async (_req: Request, res: Response) => {
    try {
      await db.query("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT)").catch(() => {});
      const result = await db.query("SELECT key, value FROM site_settings");
      const settings: Record<string, string> = {};
      for (const row of result.rows) settings[row.key] = row.value;
      res.json(settings);
    } catch (err) {
      console.error("[SiteSettings] Fetch error:", err);
      res.json({});
    }
  });

  app.put("/api/admin/site-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== "object") return res.status(400).json({ message: "Settings object required" });
      await db.query("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT)").catch(() => {});
      for (const [key, value] of Object.entries(settings)) {
        await db.query(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
          [key, String(value), Date.now()]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[SiteSettings] Save error:", err);
      res.status(500).json({ message: "Failed to save settings" });
    }
  });
}

