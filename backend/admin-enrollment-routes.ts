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

/** Optional DELETE inside a transaction — failed statements abort PG tx unless rolled back to savepoint. */
async function txQueryOptional(tx: DbClient, savepoint: string, sql: string, params?: unknown[]): Promise<void> {
  const sp = `sp_${savepoint}`;
  await tx.query(`SAVEPOINT ${sp}`);
  try {
    await tx.query(sql, params);
    await tx.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await tx.query(`RELEASE SAVEPOINT ${sp}`);
    console.warn(`[EnrollmentDelete] optional step skipped (${savepoint}):`, err);
  }
}

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
    // Audit table may not exist yet (migration pending) — non-fatal.
  }
}

async function purgeEnrollmentRelatedRows(
  tx: DbClient,
  userId: number,
  courseId: number,
  enrollmentId: string
): Promise<void> {
  await tx.query(
    `DELETE FROM user_downloads
     WHERE user_id = $1
       AND (
         (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $2))
         OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $2))
       )`,
    [userId, courseId]
  );

  await txQueryOptional(
    tx,
    "download_tokens",
    `DELETE FROM download_tokens WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );

  await tx.query(
    `DELETE FROM media_tokens
     WHERE user_id = $1
       AND file_key IN (
         SELECT file_url FROM study_materials WHERE course_id = $2 AND file_url IS NOT NULL
         UNION ALL
         SELECT video_url FROM lectures WHERE course_id = $2 AND video_url IS NOT NULL
         UNION ALL
         SELECT pdf_url FROM lectures WHERE course_id = $2 AND pdf_url IS NOT NULL
         UNION ALL
         SELECT recording_url FROM live_classes WHERE course_id = $2 AND recording_url IS NOT NULL
       )`,
    [userId, courseId]
  );

  await tx.query(
    `DELETE FROM lecture_progress
     WHERE user_id = $1
       AND lecture_id IN (SELECT id FROM lectures WHERE course_id = $2)`,
    [userId, courseId]
  );

  await txQueryOptional(
    tx,
    "live_recording_progress",
    `DELETE FROM live_class_recording_progress
     WHERE user_id = $1
       AND live_class_id IN (SELECT id FROM live_classes WHERE course_id = $2)`,
    [userId, courseId]
  );

  await txQueryOptional(
    tx,
    "live_class_viewers",
    `DELETE FROM live_class_viewers
     WHERE user_id = $1
       AND live_class_id IN (SELECT id FROM live_classes WHERE course_id = $2)`,
    [userId, courseId]
  );

  await tx.query(
    `DELETE FROM test_attempts
     WHERE user_id = $1
       AND test_id IN (SELECT id FROM tests WHERE course_id = $2)`,
    [userId, courseId]
  );

  await txQueryOptional(
    tx,
    "user_missions",
    `DELETE FROM user_missions
     WHERE user_id = $1
       AND mission_id IN (SELECT id FROM daily_missions WHERE course_id = $2)`,
    [userId, courseId]
  );

  await tx.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);

  await tx.query(
    `UPDATE courses SET total_students = GREATEST(0, COALESCE(total_students, 0) - 1) WHERE id = $1`,
    [courseId]
  );
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
      const enrollmentId = String(req.params.id);

      try {
        await deleteDownloadsForUser(Number(user_id), Number(course_id));
      } catch (cleanupErr) {
        console.warn("[Cleanup] download cleanup failed:", cleanupErr);
      }

      await runInTransaction(async (tx) => {
        await purgeEnrollmentRelatedRows(tx, Number(user_id), Number(course_id), enrollmentId);
      });

      void writeEnrollmentAuditLog(db, adminUserId, "deleted", enrollmentId, {
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

      await runInTransaction(async (tx) => {
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

/** Exported for unit tests. */
export { purgeEnrollmentRelatedRows, txQueryOptional };
