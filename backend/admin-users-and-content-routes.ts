import type { Express, Request, Response } from "express";
import { autoNotificationExpiresAt } from "./auto-notification-expiry";
import { notifyStandaloneMaterialAdded } from "./notification-utils";
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
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
};

export function registerAdminUsersAndContentRoutes({
  app,
  db,
  requireAdmin,
  deleteDownloadsForUser,
  runInTransaction,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterAdminUsersAndContentRoutesDeps): void {
  app.post("/api/admin/study-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle, downloadAllowed, subjectKey } = req.body;
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
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, subject_key, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          normalizedTitle,
          description || "",
          normalizedFileUrl,
          fileType || "pdf",
          parsedCourseId,
          parsedCourseId ? false : isFree !== false,
          sectionTitle || null,
          downloadAllowed || false,
          normalizedSubjectKey,
          Date.now(),
        ]
      );
      if (parsedCourseId) {
        await db.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
        await recomputeAllEnrollmentsProgressForCourse(parsedCourseId);
        const courseInfo = await db.query("SELECT title FROM courses WHERE id = $1", [parsedCourseId]).catch(() => ({ rows: [] as any[] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId]).catch(() => ({ rows: [] as any[] }));
        const recipientIds = recipients.rows.map((r: any) => Number(r.user_id));
        const notifTitle = "📘 New Material Added";
        const notifMessage = `"${normalizedTitle}" has been added in ${courseTitle}.`;
        const now = Date.now();
        const expiresAt = autoNotificationExpiresAt(now);
        if (recipientIds.length > 0) {
          await db
            .query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
               FROM unnest($1::int[]) AS u`,
              [recipientIds, notifTitle, notifMessage, "info", now, expiresAt]
            )
            .catch(() => {});
        }
        await sendPushToUsers(db, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_material_added", materialId: result.rows[0]?.id, courseId: parsedCourseId },
        });
      } else {
        await notifyStandaloneMaterialAdded(db, {
          materialId: Number(result.rows[0]?.id),
          title: normalizedTitle,
          sectionTitle: sectionTitle || null,
        }).catch((err) => console.error("[AdminMaterials] standalone notify failed:", err));
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

  app.post("/api/admin/study-materials/bulk", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { courseId, subjectKey, items } = req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ message: "items must contain 1–50 materials" });
      }

      const courseCheck = await db.query("SELECT id, title FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
      if (courseCheck.rows.length === 0) {
        return res.status(404).json({ message: "Course not found" });
      }
      const courseTitle = String(courseCheck.rows[0]?.title || "your course");
      const normalizedSubjectKey =
        typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;

      const titles: string[] = [];
      const fileUrls: string[] = [];
      const fileTypes: string[] = [];
      const orderIndexes: number[] = [];
      const sectionTitles: (string | null)[] = [];
      const downloadFlags: boolean[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const title = String(item.title || "").trim();
        const fileUrl = String(item.fileUrl || "").trim();
        if (!title || !fileUrl) {
          return res.status(400).json({ message: `Item ${i + 1}: title and fileUrl are required` });
        }
        titles.push(title);
        fileUrls.push(fileUrl);
        fileTypes.push(String(item.fileType || "pdf").trim() || "pdf");
        orderIndexes.push(Number(item.orderIndex) || 0);
        const section = item.sectionTitle != null ? String(item.sectionTitle).trim() : "";
        sectionTitles.push(section || null);
        downloadFlags.push(!!item.downloadAllowed);
      }

      const now = Date.now();
      const inserted = await runInTransaction(async (tx) => {
        const result = await tx.query(
          `INSERT INTO study_materials (
             title, description, file_url, file_type, course_id, is_free,
             section_title, download_allowed, subject_key, order_index, created_at
           )
           SELECT
             t.title,
             ''::text,
             t.file_url,
             t.file_type,
             $1::int,
             false,
             t.section_title,
             t.download_allowed,
             $2::text,
             t.order_index,
             $3::bigint
           FROM unnest(
             $4::text[],
             $5::text[],
             $6::text[],
             $7::int[],
             $8::text[],
             $9::boolean[]
           ) AS t(title, file_url, file_type, order_index, section_title, download_allowed)
           RETURNING *`,
          [
            parsedCourseId,
            normalizedSubjectKey,
            now,
            titles,
            fileUrls,
            fileTypes,
            orderIndexes,
            sectionTitles,
            downloadFlags,
          ],
        );
        return result.rows;
      });

      await db.query(
        "UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1",
        [parsedCourseId],
      );
      await recomputeAllEnrollmentsProgressForCourse(parsedCourseId);

      const count = inserted.length;
      const recipients = await db
        .query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId])
        .catch(() => ({ rows: [] as any[] }));
      const recipientIds = recipients.rows.map((r: any) => Number(r.user_id));
      const notifTitle = count === 1 ? "📘 New Material Added" : `📘 ${count} new materials added`;
      const notifMessage =
        count === 1
          ? `"${titles[0]}" has been added in ${courseTitle}.`
          : `${count} new materials have been added in ${courseTitle}.`;
      const expiresAt = autoNotificationExpiresAt(now);
      if (recipientIds.length > 0) {
        await db
          .query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
             SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
             FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, "info", now, expiresAt],
          )
          .catch(() => {});
      }
      await sendPushToUsers(db, recipientIds, {
        title: notifTitle,
        body: notifMessage,
        data: { type: "new_material_added", courseId: parsedCourseId, count },
      });

      res.json({ inserted, count });
    } catch (err) {
      console.error("[AdminMaterials] bulk create failed", {
        courseId: req.body?.courseId,
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
        error: err instanceof Error ? err.message : err,
      });
      res.status(500).json({ message: "Failed to bulk add materials", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });

  app.post("/api/admin/live-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle, isRecordingMode, visibleAfterAt, subjectKey } = req.body;
      const mainSec =
        typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() !== "" ? lectureSectionTitle.trim() : null;
      const subSec =
        typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() !== "" ? lectureSubfolderTitle.trim() : null;
      const recMode = isRecordingMode === true;
      const visAfter = (recMode && visibleAfterAt && Number.isFinite(Number(visibleAfterAt))) ? Number(visibleAfterAt) : null;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, is_recording_mode, visible_after_at, subject_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          youtubeUrl || null,
          scheduledAt,
          isLive || false,
          recMode ? false : (isPublic || false),  // recording sessions are never public
          recMode ? false : (notifyEmail || false),
          recMode ? false : (notifyBell || false),
          isFreePreview || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          mainSec,
          subSec,
          recMode,
          visAfter,
          normalizedSubjectKey,
          Date.now(),
        ]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive} isRecordingMode=${recMode}`);
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
      const activeWebLockCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
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
         WHERE e.reason IN ('wrong_device_login_denied', 'active_web_session_login_denied', 'max_devices_registered')
           AND (
             e.reason <> 'active_web_session_login_denied'
             OR (
               u.session_token IS NOT NULL
               AND COALESCE(u.last_active_at, 0) >= $1
             )
           )
           AND COALESCE(u.role, '') <> 'admin'
         GROUP BY u.id, u.name, u.phone, u.email
         ORDER BY MAX(e.created_at) DESC NULLS LAST
         LIMIT 200`,
        [activeWebLockCutoff]
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
        "UPDATE users SET app_bound_device_id = NULL, session_token = NULL, device_id = NULL, active_session_platform = NULL, web_device_id_phone = NULL, web_device_id_desktop = NULL WHERE id = $1",
        [uid]
      );
      await db.query("DELETE FROM user_sessions WHERE user_id = $1", [uid]).catch(() => {});
      await db.query(
        "DELETE FROM device_block_events WHERE user_id = $1 AND reason IN ('wrong_device_login_denied', 'active_web_session_login_denied', 'max_devices_registered')",
        [uid]
      ).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      console.error("[Admin] reset-device-binding:", err);
      res.status(500).json({ message: "Failed to reset device binding" });
    }
  });

  /**
   * One-shot cleanup for the legacy `Student7890` placeholder rows that the
   * old /api/auth/send-otp used to insert before OTP verify (see migration
   * 0014). Deletes student rows that have not completed profile-setup, are
   * older than 24h, and have NO activity at all (no enrollments, payments,
   * lecture progress, test attempts, daily missions, downloads, push tokens,
   * etc.). Uses `purgeStudentAccountById` for full FK-safe cleanup.
   */
  app.post("/api/admin/users/cleanup-pending", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const candidates = await db.query(
        `SELECT u.id
         FROM users u
         WHERE COALESCE(u.role, 'student') = 'student'
           AND COALESCE(u.profile_complete, FALSE) = FALSE
           AND COALESCE(u.created_at, 0) < $1
           AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM lecture_progress lp WHERE lp.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM test_attempts ta WHERE ta.user_id = u.id)
         LIMIT 1000`,
        [cutoff]
      );

      const ids: number[] = candidates.rows.map((r: any) => Number(r.id)).filter((n: number) => Number.isFinite(n));
      const deleted: number[] = [];
      const failed: { id: number; error: string }[] = [];

      for (const id of ids) {
        try {
          await runInTransaction((tx) => purgeStudentAccountById(tx, id));
          deleted.push(id);
        } catch (err: any) {
          failed.push({ id, error: String(err?.message || err) });
        }
      }

      // Also expire any orphaned otp_challenges rows older than 24h so they
      // don't accumulate forever for spam phone numbers.
      await db
        .query("DELETE FROM otp_challenges WHERE updated_at < $1", [cutoff])
        .catch(() => {});

      res.json({ success: true, deleted: deleted.length, ids: deleted, failed });
    } catch (err) {
      console.error("[Admin] cleanup-pending:", err);
      res.status(500).json({ message: "Failed to clean up pending signups" });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
      const search = String(req.query.search ?? "").trim();

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

      const where: string[] = [];
      const params: unknown[] = [];
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(
          `(COALESCE(name,'') ILIKE ${p} OR COALESCE(email,'') ILIKE ${p} OR COALESCE(phone,'') ILIKE ${p})`
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

      const countResult = await db.query(
        `SELECT COUNT(*)::int AS total FROM users ${whereSql}`,
        params
      );
      const total = Number(countResult.rows[0]?.total ?? 0);

      params.push(limit, offset);
      const result = await db.query(
        `SELECT ${selectSql} FROM users ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      res.setHeader("X-Total-Count", String(total));
      res.setHeader("X-Has-More", String(offset + result.rows.length < total));
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

  /** Course IDs where this student already has an enrollment row. */
  app.get("/api/admin/users/:id/enrollments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });
      const result = await db.query(
        `SELECT course_id
         FROM enrollments
         WHERE user_id = $1`,
        [userId]
      );
      const courseIds = result.rows
        .map((r: any) => Number(r.course_id))
        .filter((n: number) => Number.isFinite(n));
      res.json({ courseIds });
    } catch (err) {
      console.error("Admin user enrollments error:", err);
      res.status(500).json({ message: "Failed to fetch user enrollments" });
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

