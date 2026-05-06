import type { Express, Request, Response } from "express";
import { sendPushToUsers } from "./push-notifications";
import { purgeStudentAccountById } from "./user-account-purge";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminUsersAndContentRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  deleteDownloadsForUser: (userId: number, courseId?: number) => Promise<void>;
  runInTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
};

export function registerAdminUsersAndContentRoutes({
  app,
  db,
  requireAdmin,
  deleteDownloadsForUser,
  runInTransaction,
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
        const courseInfo = await db.query("SELECT title FROM courses WHERE id = $1", [parsedCourseId]).catch(() => ({ rows: [] as any[] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId]).catch(() => ({ rows: [] as any[] }));
        const recipientIds = recipients.rows.map((r: any) => Number(r.user_id));
        const notifTitle = "📘 New Material Added";
        const notifMessage = `"${normalizedTitle}" has been added in ${courseTitle}.`;
        const now = Date.now();
        if (recipientIds.length > 0) {
          await db
            .query(
              `INSERT INTO notifications (user_id, title, message, type, created_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint
               FROM unnest($1::int[]) AS u`,
              [recipientIds, notifTitle, notifMessage, "info", now]
            )
            .catch(() => {});
        }
        await sendPushToUsers(db, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_material_added", materialId: result.rows[0]?.id, courseId: parsedCourseId },
        });
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

  /** Distinct students with device / web login denials (for Admin Users tab). */
  app.get("/api/admin/device-denied-users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT u.id AS user_id,
                u.name AS user_name,
                u.phone,
                u.email,
                MAX(e.created_at) AS latest_at,
                COUNT(*)::int AS event_count,
                (ARRAY_AGG(e.reason ORDER BY e.created_at DESC))[1] AS latest_reason,
                (ARRAY_AGG(e.platform ORDER BY e.created_at DESC))[1] AS latest_platform
         FROM device_block_events e
         INNER JOIN users u ON u.id = e.user_id
         WHERE e.reason IN ('wrong_web_browser_login_denied', 'wrong_device_login_denied')
           AND COALESCE(u.role, '') <> 'admin'
         GROUP BY u.id, u.name, u.phone, u.email
         ORDER BY MAX(e.created_at) DESC NULLS LAST
         LIMIT 200`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[Admin] device-denied-users:", err);
      res.status(500).json({ message: "Failed to load device-denied users" });
    }
  });

  app.post("/api/admin/users/:id/reset-device-binding", requireAdmin, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(uid)) return res.status(400).json({ message: "Invalid user id" });
      await db.query(
        "UPDATE users SET app_bound_device_id = NULL, web_device_id_phone = NULL, web_device_id_desktop = NULL WHERE id = $1",
        [uid]
      );
      // Clear historical denial events for this user so the auto-lock list reflects current state immediately.
      await db.query(
        "DELETE FROM device_block_events WHERE user_id = $1 AND reason IN ('wrong_web_browser_login_denied', 'wrong_device_login_denied')",
        [uid]
      ).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      console.error("[Admin] reset-device-binding:", err);
      res.status(500).json({ message: "Failed to reset device binding" });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const colsResult = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'"
      );
      const cols = new Set(colsResult.rows.map((r: any) => String(r.column_name)));
      if (!cols.has("id")) return res.status(500).json({ message: "Users table missing id column" });

      const field = (name: string, fallbackSql: string) => (cols.has(name) ? name : `${fallbackSql} AS ${name}`);
      const selectSql = [
        "id",
        field("name", "NULL"),
        field("email", "NULL"),
        field("phone", "NULL"),
        field("role", "'student'"),
        field("created_at", "NULL"),
        field("is_blocked", "FALSE"),
        field("last_active_at", "NULL"),
      ].join(", ");
      const orderSql = cols.has("created_at") ? "created_at DESC NULLS LAST" : "id DESC";
      const result = await db.query(`SELECT ${selectSql} FROM users ORDER BY ${orderSql}`);
      res.json(
        result.rows.map((r: any) => ({
          id: r.id,
          name: r.name ?? `User${r.id}`,
          email: r.email ?? null,
          phone: r.phone ?? null,
          role: r.role ?? "student",
          created_at: r.created_at ?? null,
          is_blocked: !!r.is_blocked,
          last_active_at: r.last_active_at ?? null,
        }))
      );
    } catch (err) {
      console.error("Admin users error:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.put("/api/admin/users/:id/block", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        await db.query("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]);
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
      const userId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });
      const requester = (req as any).user as { id?: number } | undefined;
      if (requester?.id && Number(requester.id) === userId) {
        return res.status(400).json({ message: "You cannot remove your own admin account" });
      }
      const userRow = await db.query("SELECT id, role FROM users WHERE id = $1 LIMIT 1", [userId]);
      if (userRow.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      if (String((userRow.rows[0] as any).role || "").toLowerCase() === "admin") {
        return res.status(400).json({ message: "Admin accounts cannot be removed from this action" });
      }
      await deleteDownloadsForUser(userId);
      await runInTransaction((tx) => purgeStudentAccountById(tx, userId));
      res.json({ success: true });
    } catch (err) {
      console.error("Delete user error:", err);
      const e = err as any;
      res.status(500).json({ message: "Failed to delete user", code: e?.code || null, detail: e?.message || null });
    }
  });
}

