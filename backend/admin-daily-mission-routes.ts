import type { Express, Request, Response } from "express";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminDailyMissionRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  recomputeAllEnrollmentsProgressForCourse?: (courseId: number | string) => Promise<void>;
};

async function recomputeMissionCourseProgress(
  db: DbClient,
  recompute: RegisterAdminDailyMissionRoutesDeps["recomputeAllEnrollmentsProgressForCourse"],
  courseId: unknown
): Promise<void> {
  if (!recompute) return;
  const cid = courseId != null && courseId !== "" ? Number(courseId) : NaN;
  if (!Number.isFinite(cid) || cid <= 0) return;
  await recompute(cid).catch(() => {});
}

export function registerAdminDailyMissionRoutes({
  app,
  db,
  requireAdmin,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterAdminDailyMissionRoutesDeps): void {
  app.post("/api/admin/daily-missions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName } = req.body;
      if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Title and questions are required" });
      }
      // Normalise folder_name: trim and store NULL for empty/omitted values so
      // "ungrouped" missions have a consistent NULL rather than empty string.
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      const result = await db.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [title, description || "", JSON.stringify(questions), missionDate || new Date().toISOString().split("T")[0], xpReward || 50, missionType || "daily_drill", courseId || null, folderNameNorm]
      );
      const row = result.rows[0];
      const cid = courseId != null && courseId !== "" ? String(courseId) : "";
      if (cid && row?.id != null) {
        try {
          const courseInfo = await db.query("SELECT title FROM courses WHERE id = $1", [cid]).catch(() => ({ rows: [] as any[] }));
          const courseTitle = String(courseInfo.rows[0]?.title || "your course");
          const recipients = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [cid]).catch(() => ({ rows: [] as any[] }));
          const recipientIds = recipients.rows.map((r: any) => Number(r.user_id)).filter((id: number) => Number.isFinite(id));
          const notifTitle = "🎯 New Daily Mission";
          const notifMessage = `"${title}" has been added to ${courseTitle}.`;
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
            data: { type: "course_mission_added", missionId: Number(row.id), courseId: Number(cid) },
          });
        } catch (e) {
          console.error("Course mission notify:", e);
        }
      }
      await recomputeMissionCourseProgress(db, recomputeAllEnrollmentsProgressForCourse, courseId);
      res.json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create daily mission" });
    }
  });

  app.put("/api/admin/daily-missions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName } = req.body;
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      await db.query(
        `UPDATE daily_missions SET title=$1, description=$2, questions=$3, mission_date=$4, xp_reward=$5, mission_type=$6, course_id=$7, folder_name=$8 WHERE id=$9`,
        [title, description || "", JSON.stringify(questions), missionDate, xpReward || 50, missionType, courseId || null, folderNameNorm, req.params.id]
      );
      await recomputeMissionCourseProgress(db, recomputeAllEnrollmentsProgressForCourse, courseId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update mission" });
    }
  });

  app.delete("/api/admin/daily-missions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const prev = await db.query("SELECT course_id FROM daily_missions WHERE id = $1 LIMIT 1", [req.params.id]);
      await db.query("DELETE FROM daily_missions WHERE id = $1", [req.params.id]);
      await recomputeMissionCourseProgress(db, recomputeAllEnrollmentsProgressForCourse, prev.rows[0]?.course_id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete mission" });
    }
  });

  app.get("/api/admin/daily-missions", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM daily_missions ORDER BY COALESCE(order_index, 0) ASC, mission_date DESC LIMIT 50");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch missions" });
    }
  });

  app.get("/api/admin/daily-missions/:id/attempts", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `
        SELECT um.user_id, um.score, COALESCE(um.time_taken, 0) as time_taken,
               COALESCE(um.incorrect, 0) as incorrect, COALESCE(um.skipped, 0) as skipped,
               um.completed_at, um.answers,
               u.name, u.phone, u.email,
               dm.questions
        FROM user_missions um
        JOIN users u ON u.id = um.user_id
        JOIN daily_missions dm ON dm.id = um.mission_id
        WHERE um.mission_id = $1 AND um.is_completed = TRUE
        ORDER BY um.score DESC, COALESCE(um.time_taken, 0) ASC
      `,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Failed to fetch mission attempts:", err);
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });
}

