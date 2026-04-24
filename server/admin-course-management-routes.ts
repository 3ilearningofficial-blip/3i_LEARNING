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
      const result = await db.query(
        "INSERT INTO course_folders (course_id, name, type) VALUES ($1, $2, $3) ON CONFLICT (course_id, name, type) DO UPDATE SET is_hidden = FALSE RETURNING *",
        [req.params.id, name, type]
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
        const folder = await db.query("SELECT * FROM course_folders WHERE id = $1 AND course_id = $2", [req.params.folderId, req.params.id]);
        if (folder.rows.length > 0) {
          const oldName = folder.rows[0].name;
          const folderType = folder.rows[0].type;
          await db.query("UPDATE course_folders SET name = $1 WHERE id = $2 AND course_id = $3", [name, req.params.folderId, req.params.id]);
          if (folderType === "lecture") {
            await db.query("UPDATE lectures SET section_title = $1 WHERE course_id = $2 AND section_title = $3", [name, req.params.id, oldName]);
          } else if (folderType === "material") {
            await db.query("UPDATE study_materials SET section_title = $1 WHERE course_id = $2 AND section_title = $3", [name, req.params.id, oldName]);
          } else if (folderType === "test") {
            await db.query("UPDATE tests SET folder_name = $1 WHERE course_id = $2 AND folder_name = $3", [name, req.params.id, oldName]);
          }
        }
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
      const folder = await db.query("SELECT * FROM course_folders WHERE id = $1 AND course_id = $2", [req.params.folderId, req.params.id]);
      if (folder.rows.length > 0) {
        const { name, type } = folder.rows[0];
        if (type === "lecture") await db.query("DELETE FROM lectures WHERE course_id = $1 AND section_title = $2", [req.params.id, name]);
        else if (type === "test") await db.query("DELETE FROM tests WHERE course_id = $1 AND folder_name = $2", [req.params.id, name]);
        else if (type === "material") await db.query("DELETE FROM study_materials WHERE course_id = $1 AND section_title = $2", [req.params.id, name]);
        await db.query("DELETE FROM course_folders WHERE id = $1", [String(req.params.folderId)]);
        await updateCourseTestCounts(String(req.params.id));
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}

