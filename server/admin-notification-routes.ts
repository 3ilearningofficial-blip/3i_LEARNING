import type { Express, Request, Response } from "express";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

type RegisterAdminNotificationRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerAdminNotificationRoutes({
  app,
  db,
  requireAdmin,
}: RegisterAdminNotificationRoutesDeps): void {
  app.post("/api/admin/notifications/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, title, message, type, target, courseId, imageUrl, expiresAfterHours } = req.body;
      let userIds: number[] = [];

      if (userId) {
        userIds = [userId];
      } else if (target === "enrolled" && courseId) {
        const result = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]);
        userIds = result.rows.map((r: any) => r.user_id);
      } else if (target === "enrolled") {
        const result = await db.query("SELECT DISTINCT user_id FROM enrollments");
        userIds = result.rows.map((r: any) => r.user_id);
      } else {
        const result = await db.query("SELECT id FROM users WHERE role = 'student'");
        userIds = result.rows.map((r: any) => r.id);
      }

      const now = Date.now();
      const expiresAt = expiresAfterHours ? now + parseFloat(expiresAfterHours) * 3600000 : null;

      const insertResult = await db.query(
        "INSERT INTO admin_notifications (title, message, target, course_id, sent_count, image_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [title, message, target || "all", courseId || null, userIds.length, imageUrl || null, now]
      );
      const adminNotifId = insertResult.rows[0]?.id || null;

      for (const uid of userIds) {
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, admin_notif_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [uid, title, message, type || "info", now, expiresAt, adminNotifId, imageUrl || null]
        );
      }
      await sendPushToUsers(db, userIds.map((id) => Number(id)), {
        title: String(title || "Notification"),
        body: String(message || ""),
        data: { type: "admin_notification", adminNotifId, courseId: courseId || null },
      });

      res.json({ success: true, sent: userIds.length });
    } catch (err) {
      console.error("[NotifSend] error:", err);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  app.get("/api/admin/notifications/history", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT an.*, c.title as course_title FROM admin_notifications an LEFT JOIN courses c ON c.id = an.course_id ORDER BY an.created_at DESC LIMIT 100"
      );
      console.log(`[NotifHistory] returning ${result.rows.length} records`);
      res.json(result.rows);
    } catch (err) {
      console.error("[NotifHistory] error:", err);
      res.status(500).json({ message: "Failed to fetch notification history" });
    }
  });

  app.put("/api/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, message } = req.body;
      const anId = parseInt(String(req.params.id));
      await db.query("UPDATE admin_notifications SET title = $1, message = $2 WHERE id = $3", [title, message, anId]);
      await db.query("UPDATE notifications SET title = $1, message = $2 WHERE admin_notif_id = $3", [title, message, anId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  app.put("/api/admin/notifications/:id/hide", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { hidden } = req.body;
      const anId = parseInt(String(req.params.id));
      const an = await db.query("UPDATE admin_notifications SET is_hidden = $1 WHERE id = $2 RETURNING title", [hidden, anId]);
      await db.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id = $2", [hidden, anId]);
      if (an.rows.length > 0 && an.rows[0].title) {
        await db.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id IS NULL AND TRIM(title) = TRIM($2)", [hidden, an.rows[0].title]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  app.delete("/api/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const anId = parseInt(String(req.params.id));
      const r1 = await db.query("DELETE FROM notifications WHERE admin_notif_id = $1", [anId]);
      console.log("[NotifDelete] deleted " + (r1.rowCount || 0) + " student notifications for admin_notif_id=" + anId);
      await db.query("DELETE FROM admin_notifications WHERE id = $1", [anId]);
      res.json({ success: true });
    } catch (err) {
      console.error("[NotifDelete] error:", err);
      res.status(500).json({ message: "Failed to delete notification" });
    }
  });
}

