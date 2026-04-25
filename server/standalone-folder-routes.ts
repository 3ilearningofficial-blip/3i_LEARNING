import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterStandaloneFolderRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

const STANDALONE_FOLDER_TYPES = new Set(["test", "material", "mini_course"]);
const MAX_STANDALONE_FOLDER_NAME_LENGTH = 120;

function normalizeStandaloneFolderName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

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
      const normalizedName = normalizeStandaloneFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!STANDALONE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });

      const existing = await db.query(
        "SELECT * FROM standalone_folders WHERE type = $1 AND LOWER(name) = LOWER($2) LIMIT 1",
        [normalizedType, normalizedName]
      );
      if (existing.rows.length > 0) {
        const revived = await db.query(
          "UPDATE standalone_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *",
          [existing.rows[0].id]
        );
        return res.json(revived.rows[0]);
      }

      if (normalizedType === "test" && category) {
        const result = await db.query(
          "INSERT INTO standalone_folders (name, type, category, price, original_price, is_free, description) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
          [normalizedName, normalizedType, category || null, parseFloat(price) || 0, parseFloat(originalPrice) || 0, isFree !== false, description || null]
        );
        return res.json(result.rows[0]);
      }
      const result = await db.query(
        "INSERT INTO standalone_folders (name, type) VALUES ($1, $2) RETURNING *",
        [normalizedName, normalizedType]
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
        const normalizedName = normalizeStandaloneFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });

        const current = await db.query("SELECT id, type FROM standalone_folders WHERE id = $1", [req.params.id]);
        if (current.rows.length > 0) {
          const folderType = current.rows[0].type;
          const dup = await db.query(
            "SELECT id FROM standalone_folders WHERE type = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1",
            [folderType, normalizedName, req.params.id]
          );
          if (dup.rows.length > 0) {
            return res.status(409).json({ message: "A folder with this name already exists for this type" });
          }
        }

        await db.query(
          `WITH target AS (
             SELECT id, name, type
             FROM standalone_folders
             WHERE id = $1
           ),
           renamed AS (
             UPDATE standalone_folders sf
             SET name = $2
             FROM target t
             WHERE sf.id = t.id
             RETURNING t.name AS old_name, t.type AS folder_type
           ),
           upd_tests AS (
             UPDATE tests tt
             SET folder_name = $2
             FROM renamed r
             WHERE r.folder_type = 'test' AND tt.folder_name = r.old_name AND tt.course_id IS NULL
             RETURNING tt.id
           )
           UPDATE study_materials sm
           SET section_title = $2
           FROM renamed r
           WHERE r.folder_type = 'material' AND sm.section_title = r.old_name AND sm.course_id IS NULL`,
          [req.params.id, normalizedName]
        );
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
      await db.query(
        `WITH target AS (
           SELECT id, name, type
           FROM standalone_folders
           WHERE id = $1
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.folder_name = t.name AND tt.course_id IS NULL
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.section_title = t.name AND sm.course_id IS NULL
           RETURNING sm.id
         )
         DELETE FROM standalone_folders sf
         USING target t
         WHERE sf.id = t.id`,
        [req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}

