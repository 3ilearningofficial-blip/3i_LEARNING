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
      const normalizedTitle = typeof title === "string" ? title.trim() : "";
      const normalizedFileUrl = typeof fileUrl === "string" ? fileUrl.trim() : "";
      const parsedCourseId = courseId == null ? null : Number(courseId);
      if (!normalizedTitle) return res.status(400).json({ message: "Material title is required" });
      if (!normalizedFileUrl) return res.status(400).json({ message: "File URL is required" });
      if (parsedCourseId != null && (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (parsedCourseId != null) {
        const courseCheck = await db.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
        if (courseCheck.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      }
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          normalizedTitle,
          description || "",
          normalizedFileUrl,
          fileType || "pdf",
          parsedCourseId,
          parsedCourseId ? false : isFree !== false,
          sectionTitle || null,
          downloadAllowed || false,
          Date.now(),
        ]
      );
      if (parsedCourseId) {
        await db.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[AdminMaterials] create failed", {
        body: {
          courseId: req.body?.courseId,
          title: req.body?.title,
          fileType: req.body?.fileType,
          hasFileUrl: !!req.body?.fileUrl,
        },
        error: err instanceof Error ? err.message : err,
      });
      res.status(500).json({ message: "Failed to add material", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });

  app.post("/api/admin/live-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle } = req.body;
      const mainSec =
        typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() !== "" ? lectureSectionTitle.trim() : null;
      const subSec =
        typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() !== "" ? lectureSubfolderTitle.trim() : null;
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          youtubeUrl || null,
          scheduledAt,
          isLive || false,
          isPublic || false,
          notifyEmail || false,
          notifyBell || false,
          isFreePreview || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          mainSec,
          subSec,
          Date.now(),
        ]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive}`);
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[LiveClass] create failed", err);
      res.status(500).json({ message: "Failed to add live class" });
    }
  });

  app.get("/api/admin/device-block-events", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT e.id, e.user_id, e.attempted_device_id, e.bound_device_id, e.phone, e.email, e.platform, e.reason, e.created_at,
                u.name AS user_name
         FROM device_block_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC NULLS LAST
         LIMIT 300`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[Admin] device-block-events:", err);
      res.status(500).json({ message: "Failed to load device block events" });
    }
  });

  app.post("/api/admin/users/:id/reset-device-binding", requireAdmin, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(uid)) return res.status(400).json({ message: "Invalid user id" });
      await db.query("UPDATE users SET app_bound_device_id = NULL WHERE id = $1", [uid]);
      res.json({ success: true });
    } catch (err) {
      console.error("[Admin] reset-device-binding:", err);
      res.status(500).json({ message: "Failed to reset device binding" });
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

