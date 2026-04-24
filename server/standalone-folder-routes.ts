import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterStandaloneFolderRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerStandaloneFolderRoutes({
  app,
  db,
  requireAdmin,
}: RegisterStandaloneFolderRoutesDeps): void {
  app.get("/api/admin/standalone-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { type } = req.query;
      let q = "SELECT * FROM standalone_folders";
      const params: unknown[] = [];
      if (type) {
        params.push(type);
        q += ` WHERE type = $1`;
      }
      q += " ORDER BY created_at ASC";
      const result = await db.query(q, params);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.post("/api/admin/standalone-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type, category, price, originalPrice, isFree, description } = req.body;
      if (type === "test" && category) {
        const result = await db.query(
          "INSERT INTO standalone_folders (name, type, category, price, original_price, is_free, description) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (name, type) DO UPDATE SET is_hidden = FALSE, category = $3, price = $4, original_price = $5, is_free = $6, description = $7 RETURNING *",
          [name, type, category || null, parseFloat(price) || 0, parseFloat(originalPrice) || 0, isFree !== false, description || null]
        );
        return res.json(result.rows[0]);
      }
      const result = await db.query(
        "INSERT INTO standalone_folders (name, type) VALUES ($1, $2) ON CONFLICT (name, type) DO UPDATE SET is_hidden = FALSE RETURNING *",
        [name, type]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  app.put("/api/admin/standalone-folders/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, isHidden, category, price, originalPrice, isFree, description } = req.body;
      if (name !== undefined) {
        const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1", [req.params.id]);
        if (folder.rows.length > 0) {
          const oldName = folder.rows[0].name;
          const folderType = folder.rows[0].type;
          await db.query("UPDATE standalone_folders SET name = $1 WHERE id = $2", [name, req.params.id]);
          if (folderType === "test") await db.query("UPDATE tests SET folder_name = $1 WHERE folder_name = $2 AND course_id IS NULL", [name, oldName]);
          else if (folderType === "material") await db.query("UPDATE study_materials SET section_title = $1 WHERE section_title = $2 AND course_id IS NULL", [name, oldName]);
        }
      } else if (isHidden !== undefined) {
        await db.query("UPDATE standalone_folders SET is_hidden = $1 WHERE id = $2", [isHidden, req.params.id]);
      }
      if (category !== undefined) await db.query("UPDATE standalone_folders SET category = $1 WHERE id = $2", [category, req.params.id]);
      if (price !== undefined) await db.query("UPDATE standalone_folders SET price = $1 WHERE id = $2", [parseFloat(price) || 0, req.params.id]);
      if (originalPrice !== undefined) await db.query("UPDATE standalone_folders SET original_price = $1 WHERE id = $2", [parseFloat(originalPrice) || 0, req.params.id]);
      if (isFree !== undefined) await db.query("UPDATE standalone_folders SET is_free = $1 WHERE id = $2", [isFree, req.params.id]);
      if (description !== undefined) await db.query("UPDATE standalone_folders SET description = $1 WHERE id = $2", [description || null, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  app.delete("/api/admin/standalone-folders/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1", [req.params.id]);
      if (folder.rows.length > 0) {
        const { name, type } = folder.rows[0];
        if (type === "test") await db.query("DELETE FROM tests WHERE folder_name = $1 AND course_id IS NULL", [name]);
        else if (type === "material") await db.query("DELETE FROM study_materials WHERE section_title = $1 AND course_id IS NULL", [name]);
        await db.query("DELETE FROM standalone_folders WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}

