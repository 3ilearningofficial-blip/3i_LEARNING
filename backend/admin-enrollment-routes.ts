import type { Express, Request, Response } from "express";

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

      // Snapshot old values for audit log before updating
      const before = await db.query(
        "SELECT status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      ).catch(() => ({ rows: [] }));
      const oldRow = before.rows[0] || {};

      if (status !== undefined) {
        params.push(status);
        updates.push(`status = $${params.length}`);
      }

      if (valid_until !== undefined) {
        params.push(valid_until);
        updates.push(`valid_until = $${params.length}`);
      }

      if (updates.length > 0) {
        params.push(req.params.id);
        await db.query(`UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      }

      // Non-blocking audit log — must not affect the response
      void writeEnrollmentAuditLog(db, adminUserId, "updated", req.params.id, {
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
        "SELECT user_id, course_id, status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      );

      if (enrollment.rows.length > 0) {
        const { user_id, course_id } = enrollment.rows[0];
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
        await deleteDownloadsForUser(user_id, course_id);
        // Non-blocking audit log
        void writeEnrollmentAuditLog(db, adminUserId, "deleted", req.params.id, {
          user_id,
          course_id,
          status: enrollment.rows[0].status,
          valid_until: enrollment.rows[0].valid_until,
        });
      } else {
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
      }

      res.json({ success: true });
    } catch {
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
           WHERE file_url IN (
             SELECT file_url FROM study_materials WHERE course_id = $1 AND file_url IS NOT NULL
             UNION ALL
             SELECT video_url FROM lectures WHERE course_id = $1 AND video_url IS NOT NULL
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

