import type { Express, Request, Response } from "express";
import { isEnrollmentAccessRevoked } from "./download-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminEnrollmentRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  deleteDownloadsForUser: (userId: number, courseId: number) => Promise<void>;
  deleteDownloadsForCourse: (courseId: number) => Promise<void>;
  runInTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
};

/** Write a non-blocking audit entry. Never throws — audit failure must not break the main operation. */
async function writeEnrollmentAuditLog(
  db: DbClient,
  adminUserId: number | null,
  action: "updated" | "deleted",
  enrollmentId: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, meta, created_at)
       VALUES ($1, $2, 'enrollment', $3, $4, $5)`,
      [adminUserId, action, enrollmentId, JSON.stringify(meta), Date.now()]
    );
  } catch {
    // Audit table may not exist yet (migration pending) — non-fatal. Log for ops visibility.
    // Run migration: CREATE TABLE IF NOT EXISTS admin_audit_log (id BIGSERIAL PRIMARY KEY,
    //   admin_user_id INT, action TEXT, target_type TEXT, target_id TEXT,
    //   meta JSONB, created_at BIGINT);
  }
}

export function registerAdminEnrollmentRoutes({
  app,
  db,
  requireAdmin,
  deleteDownloadsForUser,
  deleteDownloadsForCourse,
  runInTransaction,
}: RegisterAdminEnrollmentRoutesDeps): void {
  app.put("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const adminUserId = Number((req as any).user?.id) || null;
      const { status, valid_until } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];

      const before = await db.query(
        "SELECT user_id, course_id, status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      ).catch(() => ({ rows: [] }));
      const oldRow = before.rows[0] || {};

      let nextStatus: unknown = oldRow.status;
      let nextValidUntil: unknown = oldRow.valid_until;

      if (status !== undefined) {
        const statusNorm = String(status).trim().toLowerCase();
        if (statusNorm && statusNorm !== "active" && statusNorm !== "inactive") {
          return res.status(400).json({ message: "Invalid status" });
        }
        nextStatus = statusNorm === "" ? null : statusNorm || null;
        params.push(nextStatus);
        updates.push(`status = $${params.length}`);
      }

      if (valid_until !== undefined) {
        const vu = valid_until === null || valid_until === "" ? null : Number(valid_until);
        if (vu !== null && (!Number.isFinite(vu) || vu < 0)) {
          return res.status(400).json({ message: "Invalid valid_until" });
        }
        nextValidUntil = vu;
        params.push(vu);
        updates.push(`valid_until = $${params.length}`);
      }

      const willRevoke = isEnrollmentAccessRevoked(nextStatus, nextValidUntil);

      if (updates.length > 0) {
        params.push(req.params.id);
        await db.query(`UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      }

      if (willRevoke && oldRow.user_id && oldRow.course_id) {
        await db.query(
          "UPDATE enrollments SET download_cleanup_pending = TRUE WHERE id = $1",
          [req.params.id]
        );
        try {
          await deleteDownloadsForUser(Number(oldRow.user_id), Number(oldRow.course_id));
          await db.query("UPDATE enrollments SET download_cleanup_pending = FALSE WHERE id = $1", [
            req.params.id,
          ]);
        } catch (cleanupErr) {
          console.warn("[Cleanup] enrollment PUT download cleanup failed; will retry", {
            enrollmentId: req.params.id,
            cleanupErr,
          });
        }
      }

      void writeEnrollmentAuditLog(db, adminUserId, "updated", String(req.params.id), {
        old_status: oldRow.status,
        new_status: status,
        old_valid_until: oldRow.valid_until,
        new_valid_until: valid_until,
      });

      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update enrollment" });
    }
  });

  app.delete("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const adminUserId = Number((req as any).user?.id) || null;
      const enrollment = await db.query(
        "SELECT id, user_id, course_id, status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      );
      if (enrollment.rows.length === 0) {
        return res.json({ success: true });
      }
      const { user_id, course_id } = enrollment.rows[0];

      // R2 / IndexedDB offline downloads are external state — run before the DB
      // transaction so a storage failure doesn't block the DB cleanup.
      try {
        await deleteDownloadsForUser(Number(user_id), Number(course_id));
      } catch (cleanupErr) {
        console.warn("[Cleanup] download cleanup failed:", cleanupErr);
      }

      await runInTransaction(async (tx) => {
        // Invalidate active media tokens the student holds for this course's content
        await tx.query(
          `DELETE FROM media_tokens
           WHERE user_id = $1
             AND file_key IN (
               SELECT file_url FROM study_materials WHERE course_id = $2 AND file_url IS NOT NULL
               UNION ALL
               SELECT video_url FROM lectures        WHERE course_id = $2 AND video_url IS NOT NULL
               UNION ALL
               SELECT pdf_url   FROM lectures        WHERE course_id = $2 AND pdf_url IS NOT NULL
               UNION ALL
               SELECT recording_url FROM live_classes WHERE course_id = $2 AND recording_url IS NOT NULL
             )`,
          [user_id, course_id]
        );

        // Download tokens for this user+course (table added in 0034; tolerate absence)
        await tx
          .query(`DELETE FROM download_tokens WHERE user_id = $1 AND course_id = $2`, [user_id, course_id])
          .catch(() => {});

        // Lecture progress for any lecture in this course
        await tx.query(
          `DELETE FROM lecture_progress
           WHERE user_id = $1
             AND lecture_id IN (SELECT id FROM lectures WHERE course_id = $2)`,
          [user_id, course_id]
        );

        // Test attempts for any test in this course
        await tx.query(
          `DELETE FROM test_attempts
           WHERE user_id = $1
             AND test_id IN (SELECT id FROM tests WHERE course_id = $2)`,
          [user_id, course_id]
        );

        // Daily mission attempts for this user on this course's missions (table from 0035; tolerate absence)
        await tx
          .query(
            `DELETE FROM user_missions
             WHERE user_id = $1
               AND mission_id IN (SELECT id FROM daily_missions WHERE course_id = $2)`,
            [user_id, course_id]
          )
          .catch(() => {});

        // Hard-delete the enrollment row last so the cascade above is atomic
        await tx.query(`DELETE FROM enrollments WHERE id = $1`, [req.params.id]);
      });

      void writeEnrollmentAuditLog(db, adminUserId, "deleted", String(req.params.id), {
        user_id,
        course_id,
        hard_delete: true,
        status_before: enrollment.rows[0].status,
        valid_until_before: enrollment.rows[0].valid_until,
      });

      res.json({ success: true });
    } catch (err) {
      console.error("Remove from course error:", err);
      res.status(500).json({ message: "Failed to remove enrollment" });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = req.params.id;

      await deleteDownloadsForCourse(parseInt(Array.isArray(courseId) ? courseId[0] : courseId));

      // R2/storage is already cleared; DB deletes are atomic so we do not leave a half-deleted course row graph.
      await runInTransaction(async (tx) => {
        // Invalidate all media tokens for this course's content BEFORE deleting the
        // content rows. Tokens that survive deletion stay valid until their TTL expires,
        // allowing access to deleted content — this prevents that.
        await tx.query(
          `DELETE FROM media_tokens
           WHERE file_key IN (
             SELECT file_url FROM study_materials WHERE course_id = $1 AND file_url IS NOT NULL
             UNION ALL
             SELECT video_url FROM lectures WHERE course_id = $1 AND video_url IS NOT NULL
             UNION ALL
             SELECT pdf_url FROM lectures WHERE course_id = $1 AND pdf_url IS NOT NULL
             UNION ALL
             SELECT recording_url FROM live_classes WHERE course_id = $1 AND recording_url IS NOT NULL
           )`,
          [courseId]
        );
        await tx.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
        await tx.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
        await tx.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM courses WHERE id = $1", [courseId]);
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
      res.status(500).json({ message: "Failed to delete course" });
    }
  });
}

