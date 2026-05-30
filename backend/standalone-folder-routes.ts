import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterStandaloneFolderRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

const STANDALONE_FOLDER_TYPES = new Set(["test", "material", "mini_course", "mission"]);
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
      q += " ORDER BY order_index ASC, created_at ASC";
      const result = await db.query(q, params);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  /**
   * PATCH /api/admin/standalone/reorder
   * Body: { itemType: "test" | "material" | "folder", items: [{ id, orderIndex }] }
   *
   * Bulk-updates order_index for FREE (non-course) tests / study_materials, or
   * for standalone_folders. Mirrors the course reorder endpoint but scopes item
   * updates to `course_id IS NULL` so it can never touch course-owned rows.
   * itemType -> table is hardcoded so user input is never interpolated into SQL.
   */
  app.patch("/api/admin/standalone/reorder", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { itemType, items } = req.body as { itemType: string; items: { id: number; orderIndex: number }[] };
      const TABLE_BY_TYPE: Record<string, { table: string; nonCourse: boolean }> = {
        test: { table: "tests", nonCourse: true },
        material: { table: "study_materials", nonCourse: true },
        mission: { table: "daily_missions", nonCourse: false },
        folder: { table: "standalone_folders", nonCourse: false },
      };
      const target = TABLE_BY_TYPE[itemType];
      if (!target) {
        return res.status(400).json({ message: "itemType must be one of: test, material, mission, folder" });
      }
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "items must be an array" });
      }
      const ids: number[] = [];
      const orders: number[] = [];
      for (const it of items) {
        const idNum = Number(it?.id);
        const orderNum = Number(it?.orderIndex);
        if (!Number.isFinite(idNum) || idNum <= 0 || !Number.isFinite(orderNum)) continue;
        ids.push(idNum);
        orders.push(orderNum);
      }
      if (ids.length === 0) return res.json({ success: true, updated: 0 });

      // `table` comes from the hardcoded allowlist above - safe to interpolate.
      const courseScope = target.nonCourse ? ` AND ${target.table}.course_id IS NULL` : "";
      await db.query(
        `UPDATE ${target.table} SET order_index = v.order_index
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS order_index) v
         WHERE ${target.table}.id = v.id${courseScope}`,
        [ids, orders]
      );
      res.json({ success: true, updated: ids.length });
    } catch (err) {
      console.error("[standalone-reorder] error:", err);
      res.status(500).json({ message: "Failed to reorder items" });
    }
  });

  app.post("/api/admin/standalone-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type, category, price, originalPrice, isFree, description, validityMonths } = req.body;
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

      if (normalizedType === "test") {
        const vm =
          validityMonths != null && String(validityMonths).trim() !== ""
            ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
            : null;
        const result = await db.query(
          "INSERT INTO standalone_folders (name, type, category, price, original_price, is_free, description, validity_months) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
          [normalizedName, normalizedType, category || null, parseFloat(price) || 0, parseFloat(originalPrice) || 0, isFree !== false, description || null, vm]
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
      const { name, isHidden, category, price, originalPrice, isFree, description, validityMonths } = req.body;
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
           ),
           upd_missions AS (
             UPDATE daily_missions dm
             SET folder_name = $2
             FROM renamed r
             WHERE r.folder_type = 'mission' AND dm.folder_name = r.old_name
             RETURNING dm.id
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
      if (validityMonths !== undefined) {
        const vm =
          validityMonths != null && String(validityMonths).trim() !== ""
            ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null
            : null;
        await db.query("UPDATE standalone_folders SET validity_months = $1 WHERE id = $2", [vm, req.params.id]);
      }
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
         ),
         del_missions AS (
           DELETE FROM daily_missions dm
           USING target t
           WHERE t.type = 'mission' AND dm.folder_name = t.name
           RETURNING dm.id
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

