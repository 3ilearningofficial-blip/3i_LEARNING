import type { Express, Request, Response } from "express";
import { listDefaultFlags } from "./feature-flags";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterRuntimeFlagRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerRuntimeFlagRoutes({
  app,
  db,
  requireAdmin,
}: RegisterRuntimeFlagRoutesDeps): void {
  app.get("/api/admin/runtime-flags", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const rows = await db.query(
        "SELECT key, enabled, description, updated_at FROM runtime_feature_flags ORDER BY key ASC"
      );
      return res.json({ defaults: listDefaultFlags(), flags: rows.rows });
    } catch (err) {
      console.error("[RuntimeFlags] list error:", err);
      return res.status(500).json({ message: "Failed to load runtime flags" });
    }
  });

  app.put("/api/admin/runtime-flags/:key", requireAdmin, async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key || "").trim();
      if (!key) return res.status(400).json({ message: "Invalid flag key" });
      const enabled = req.body?.enabled === true;
      const descriptionRaw = String(req.body?.description ?? "").trim();
      const description = descriptionRaw || null;
      await db.query(
        `INSERT INTO runtime_feature_flags (key, enabled, description, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at`,
        [key, enabled, description, Date.now()]
      );
      return res.json({ success: true, key, enabled });
    } catch (err) {
      console.error("[RuntimeFlags] update error:", err);
      return res.status(500).json({ message: "Failed to update runtime flag" });
    }
  });
}
