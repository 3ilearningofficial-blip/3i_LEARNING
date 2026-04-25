import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminCourseManagementRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  updateCourseTestCounts: (courseId: string) => Promise<void>;
};

const COURSE_FOLDER_TYPES = new Set(["lecture", "material", "test"]);
const MAX_FOLDER_NAME_LENGTH = 120;

function normalizeFolderName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

export function registerAdminCourseManagementRoutes({
  app,
  db,
  requireAdmin,
  updateCourseTestCounts,
}: RegisterAdminCourseManagementRoutesDeps): void {
  app.get("/api/admin/all-materials", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT sm.*, c.title as course_title, c.course_type 
        FROM study_materials sm 
        JOIN courses c ON sm.course_id = c.id 
        ORDER BY c.title, sm.created_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });

  app.get("/api/admin/all-lectures", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT l.*, c.title as course_title, c.course_type 
        FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        ORDER BY c.title, l.order_index
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch lectures" });
    }
  });

  app.get("/api/admin/all-tests", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT t.*, c.title as course_title, c.course_type 
        FROM tests t 
        JOIN courses c ON t.course_id = c.id 
        ORDER BY c.title, t.created_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.get("/api/admin/courses/:id/folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM course_folders WHERE course_id = $1 ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.post("/api/admin/courses/:id/folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type } = req.body;
      const normalizedName = normalizeFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!COURSE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });

      const existing = await db.query(
        "SELECT * FROM course_folders WHERE course_id = $1 AND type = $2 AND LOWER(name) = LOWER($3) LIMIT 1",
        [req.params.id, normalizedType, normalizedName]
      );
      if (existing.rows.length > 0) {
        const revived = await db.query(
          "UPDATE course_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *",
          [existing.rows[0].id]
        );
        return res.json(revived.rows[0]);
      }

      const result = await db.query(
        "INSERT INTO course_folders (course_id, name, type) VALUES ($1, $2, $3) RETURNING *",
        [req.params.id, normalizedName, normalizedType]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  app.put("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { isHidden, name } = req.body;
      if (name !== undefined) {
        const normalizedName = normalizeFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });

        const dup = await db.query(
          "SELECT id FROM course_folders WHERE course_id = $1 AND type = (SELECT type FROM course_folders WHERE id = $2 AND course_id = $1) AND LOWER(name) = LOWER($3) AND id <> $2 LIMIT 1",
          [req.params.id, req.params.folderId, normalizedName]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ message: "A folder with this name already exists for this type" });
        }

        await db.query(
          `WITH target AS (
             SELECT id, name, type
             FROM course_folders
             WHERE id = $1 AND course_id = $2
           ),
           renamed AS (
             UPDATE course_folders cf
             SET name = $3
             FROM target t
             WHERE cf.id = t.id
             RETURNING t.name AS old_name, t.type AS folder_type
           ),
           upd_lectures AS (
             UPDATE lectures l
             SET section_title = $3
             FROM renamed r
             WHERE r.folder_type = 'lecture' AND l.course_id = $2 AND l.section_title = r.old_name
             RETURNING l.id
           ),
           upd_materials AS (
             UPDATE study_materials sm
             SET section_title = $3
             FROM renamed r
             WHERE r.folder_type = 'material' AND sm.course_id = $2 AND sm.section_title = r.old_name
             RETURNING sm.id
           )
           UPDATE tests t
           SET folder_name = $3
           FROM renamed r
           WHERE r.folder_type = 'test' AND t.course_id = $2 AND t.folder_name = r.old_name`,
          [req.params.folderId, req.params.id, normalizedName]
        );
      } else if (isHidden !== undefined) {
        await db.query("UPDATE course_folders SET is_hidden = $1 WHERE id = $2 AND course_id = $3", [isHidden, req.params.folderId, req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  app.delete("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query(
        `WITH target AS (
           SELECT id, name, type
           FROM course_folders
           WHERE id = $1 AND course_id = $2
         ),
         del_lectures AS (
           DELETE FROM lectures l
           USING target t
           WHERE t.type = 'lecture' AND l.course_id = $2 AND l.section_title = t.name
           RETURNING l.id
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.course_id = $2 AND tt.folder_name = t.name
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.course_id = $2 AND sm.section_title = t.name
           RETURNING sm.id
         )
         DELETE FROM course_folders cf
         USING target t
         WHERE cf.id = t.id`,
        [req.params.folderId, req.params.id]
      );
      await updateCourseTestCounts(String(req.params.id));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}

