import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminUsersAndContentRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  deleteDownloadsForUser: (userId: number, courseId?: number) => Promise<void>;
};

export function registerAdminUsersAndContentRoutes({
  app,
  db,
  requireAdmin,
  deleteDownloadsForUser,
}: RegisterAdminUsersAndContentRoutesDeps): void {
  app.post("/api/admin/study-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle, downloadAllowed } = req.body;
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description, fileUrl, fileType || "pdf", courseId || null, courseId ? false : isFree !== false, sectionTitle || null, downloadAllowed || false, Date.now()]
      );
      if (courseId) {
        await db.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [courseId]);
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to add material" });
    }
  });

  app.post("/api/admin/live-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount } = req.body;
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [title, description, courseId || null, youtubeUrl || null, scheduledAt, isLive || false, isPublic || false, notifyEmail || false, notifyBell || false, isFreePreview || false, streamType || "rtmp", chatMode || "public", showViewerCount !== false, Date.now()]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive}`);
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to add live class" });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT id, name, email, phone, role, created_at,
                COALESCE(is_blocked, FALSE) AS is_blocked,
                last_active_at
         FROM users ORDER BY created_at DESC NULLS LAST`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Admin users error:", err);
      try {
        const result = await db.query("SELECT id, name, email, phone, role, created_at, FALSE AS is_blocked, NULL AS last_active_at FROM users ORDER BY id DESC");
        res.json(result.rows);
      } catch {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    }
  });

  app.put("/api/admin/users/:id/block", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        await db.query("UPDATE users SET is_blocked = TRUE, session_token = NULL WHERE id = $1", [req.params.id]);
        const userId = req.params.id;
        await deleteDownloadsForUser(parseInt(Array.isArray(userId) ? userId[0] : userId));
      } else {
        await db.query("UPDATE users SET is_blocked = FALSE WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      await db.query("DELETE FROM test_attempts WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM enrollments WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM payments WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM book_purchases WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM folder_purchases WHERE user_id = $1", [userId]).catch(() => {});
      await db.query("DELETE FROM support_messages WHERE user_id = $1", [userId]).catch(() => {});
      await db.query("DELETE FROM mission_attempts WHERE user_id = $1", [userId]).catch(() => {});
      await db.query("DELETE FROM users WHERE id = $1", [userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete user error:", err);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });
}

