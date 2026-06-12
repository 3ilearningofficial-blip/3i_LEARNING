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

function parseParentId(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

const COURSE_FOLDER_SELECT = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      cf.*,
      cf.name::text AS full_name,
      ARRAY[cf.id] AS path_ids
    FROM course_folders cf
    WHERE cf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM course_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;

async function resolveCourseFolderFullName(db: DbClient, folderId: unknown, courseId: unknown): Promise<string | null> {
  const result = await db.query(
    `${COURSE_FOLDER_SELECT}
     SELECT full_name
     FROM folder_tree
     WHERE id = $1 AND course_id = $2
     LIMIT 1`,
    [folderId, courseId]
  );
  return result.rows[0]?.full_name || null;
}

async function createCourseFolderPath(
  db: DbClient,
  courseId: unknown,
  type: string,
  rawName: string,
  rawParentId: unknown,
  rawSubjectKey?: unknown,
): Promise<any> {
  const parts = rawName.split(/\s+\/\s+/).map((p) => normalizeFolderName(p)).filter(Boolean);
  const names = parts.length > 0 ? parts : [rawName];
  let parentId = parseParentId(rawParentId);
  const subjectKey = typeof rawSubjectKey === "string" && rawSubjectKey.trim() ? rawSubjectKey.trim().toLowerCase() : null;
  let current: any = null;

  for (const namePart of names) {
    const existing = await db.query(
      `SELECT *
       FROM course_folders
       WHERE course_id = $1
         AND type = $2
         AND COALESCE(subject_key, '') = COALESCE($5::text, '')
         AND COALESCE(parent_id, 0) = COALESCE($3::int, 0)
         AND LOWER(name) = LOWER($4)
       LIMIT 1`,
      [courseId, type, parentId, namePart, subjectKey]
    );
    if (existing.rows.length > 0) {
      current = existing.rows[0];
      if (current.is_hidden) {
        const revived = await db.query("UPDATE course_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *", [current.id]);
        current = revived.rows[0];
      }
    } else {
      const inserted = await db.query(
        "INSERT INTO course_folders (course_id, name, type, parent_id, subject_key) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [courseId, namePart, type, parentId, subjectKey]
      );
      current = inserted.rows[0];
    }
    parentId = Number(current.id);
  }

  return current;
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
      const result = await db.query(
        `${COURSE_FOLDER_SELECT}
         SELECT *
         FROM folder_tree
         WHERE course_id = $1
         ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.post("/api/admin/courses/:id/folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type, parentId, subjectKey } = req.body;
      const normalizedName = normalizeFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!COURSE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });

      const normalizedParentId = parseParentId(parentId);
      if (normalizedParentId) {
        const parent = await db.query(
          "SELECT id FROM course_folders WHERE id = $1 AND course_id = $2 AND type = $3 AND COALESCE(subject_key, '') = COALESCE($4::text, '') LIMIT 1",
          [normalizedParentId, req.params.id, normalizedType, typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null]
        );
        if (parent.rows.length === 0) return res.status(400).json({ message: "Parent folder not found" });
      }

      const folder = await createCourseFolderPath(db, req.params.id, normalizedType, normalizedName, normalizedParentId, subjectKey);
      res.json(folder);
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

        const oldFullName = await resolveCourseFolderFullName(db, req.params.folderId, req.params.id);
        if (!oldFullName) return res.status(404).json({ message: "Folder not found" });

        const dup = await db.query(
          `SELECT id
           FROM course_folders
           WHERE course_id = $1
             AND type = (SELECT type FROM course_folders WHERE id = $2 AND course_id = $1)
             AND COALESCE(subject_key, '') = COALESCE((SELECT subject_key FROM course_folders WHERE id = $2 AND course_id = $1), '')
             AND COALESCE(parent_id, 0) = COALESCE((SELECT parent_id FROM course_folders WHERE id = $2 AND course_id = $1), 0)
             AND LOWER(name) = LOWER($3)
             AND id <> $2
           LIMIT 1`,
          [req.params.id, req.params.folderId, normalizedName]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ message: "A folder with this name already exists in this parent" });
        }

        await db.query("UPDATE course_folders SET name = $1 WHERE id = $2 AND course_id = $3", [normalizedName, req.params.folderId, req.params.id]);
        const newFullName = await resolveCourseFolderFullName(db, req.params.folderId, req.params.id);
        if (newFullName) {
          await db.query(
            `WITH target AS (
               SELECT type AS folder_type FROM course_folders WHERE id = $1 AND course_id = $2
             ),
             upd_lectures AS (
               UPDATE lectures l
               SET section_title = CASE
                 WHEN l.section_title = $3 THEN $4
                 ELSE $4 || substring(l.section_title from length($3) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'lecture' AND l.course_id = $2 AND (l.section_title = $3 OR l.section_title LIKE $3 || ' / %')
               RETURNING l.id
             ),
             upd_materials AS (
               UPDATE study_materials sm
               SET section_title = CASE
                 WHEN sm.section_title = $3 THEN $4
                 ELSE $4 || substring(sm.section_title from length($3) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'material' AND sm.course_id = $2 AND (sm.section_title = $3 OR sm.section_title LIKE $3 || ' / %')
               RETURNING sm.id
             )
             UPDATE tests tt
             SET folder_name = CASE
               WHEN tt.folder_name = $3 THEN $4
               ELSE $4 || substring(tt.folder_name from length($3) + 1)
             END
             FROM target t
             WHERE t.folder_type = 'test' AND tt.course_id = $2 AND (tt.folder_name = $3 OR tt.folder_name LIKE $3 || ' / %')`,
            [req.params.folderId, req.params.id, oldFullName, newFullName]
          );
        }
      } else if (isHidden !== undefined) {
        await db.query(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM course_folders WHERE id = $1 AND course_id = $2
             UNION ALL
             SELECT cf.id FROM course_folders cf JOIN descendants d ON cf.parent_id = d.id
           )
           UPDATE course_folders SET is_hidden = $3 WHERE id IN (SELECT id FROM descendants)`,
          [req.params.folderId, req.params.id, isHidden]
        );
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });

  /**
   * PATCH /api/admin/courses/:id/reorder
   * Body: { itemType: "test" | "material", items: [{ id: number, orderIndex: number }] }
   *
   * Bulk-updates order_index for tests or study_materials that belong to this
   * course.  Each update is verified against course_id so admins cannot
   * accidentally reorder items from other courses.
   * Uses unnest to do a single SQL UPDATE instead of N round-trips.
   */
  app.patch("/api/admin/courses/:id/reorder", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = Number(req.params.id);
      if (!Number.isFinite(courseId) || courseId <= 0) {
        return res.status(400).json({ message: "Invalid course id" });
      }
      const { itemType, items } = req.body as { itemType: string; items: { id: number; orderIndex: number }[] };
      // Allowlist of reorderable item types -> their table. Hardcoded so user
      // input is NEVER interpolated into SQL. All four tables share the same
      // columns (id, order_index, course_id), so the UPDATE below is identical.
      const TABLE_BY_TYPE: Record<string, string> = {
        test: "tests",
        material: "study_materials",
        lecture: "lectures",
        folder: "course_folders",
      };
      const table = TABLE_BY_TYPE[itemType];
      if (!table) {
        return res.status(400).json({ message: "itemType must be one of: test, material, lecture, folder" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items must be a non-empty array" });
      }
      // Build parallel arrays for unnest
      const ids: number[] = [];
      const orders: number[] = [];
      for (const item of items) {
        const itemId = Number(item.id);
        const orderIdx = Number(item.orderIndex);
        if (!Number.isFinite(itemId) || !Number.isFinite(orderIdx)) continue;
        ids.push(itemId);
        orders.push(orderIdx);
      }
      if (ids.length === 0) return res.json({ success: true, updated: 0 });

      // `table` comes from the hardcoded TABLE_BY_TYPE allowlist above - safe to
      // interpolate (table/column names cannot be passed as query parameters).
      await db.query(
        `UPDATE ${table} SET order_index = v.order_index
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS order_index) v
         WHERE ${table}.id = v.id AND ${table}.course_id = $3`,
        [ids, orders, courseId]
      );
      res.json({ success: true, updated: ids.length });
    } catch (err) {
      console.error("[reorder] error:", err);
      res.status(500).json({ message: "Failed to reorder items" });
    }
  });

  app.delete("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const fullName = await resolveCourseFolderFullName(db, req.params.folderId, req.params.id);
      if (!fullName) return res.status(404).json({ message: "Folder not found" });
      await db.query(
        `WITH RECURSIVE target AS (
           SELECT id, name, type
           FROM course_folders
           WHERE id = $1 AND course_id = $2
           UNION ALL
           SELECT cf.id, cf.name, cf.type
           FROM course_folders cf
           JOIN target t ON cf.parent_id = t.id
         ),
         del_lectures AS (
           DELETE FROM lectures l
           USING target t
           WHERE t.type = 'lecture' AND l.course_id = $2 AND (l.section_title = $3 OR l.section_title LIKE $3 || ' / %')
           RETURNING l.id
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.course_id = $2 AND (tt.folder_name = $3 OR tt.folder_name LIKE $3 || ' / %')
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.course_id = $2 AND (sm.section_title = $3 OR sm.section_title LIKE $3 || ' / %')
           RETURNING sm.id
         )
         DELETE FROM course_folders cf
         USING target t
         WHERE cf.id = t.id`,
        [req.params.folderId, req.params.id, fullName]
      );
      await updateCourseTestCounts(String(req.params.id));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}

