import type { Express, Request, Response } from "express";
import { isEnrollmentExpired } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterStudentMissionMaterialRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
};

export function registerStudentMissionMaterialRoutes({
  app,
  db,
  getAuthUser,
}: RegisterStudentMissionMaterialRoutesDeps): void {
  app.get("/api/daily-missions", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const { type } = req.query;
      let query = "SELECT * FROM daily_missions WHERE mission_date <= CURRENT_DATE";
      const params: unknown[] = [];
      if (type && type !== "all") {
        params.push(type);
        query += ` AND mission_type = $${params.length}`;
      }
      query += " ORDER BY mission_date DESC LIMIT 20";
      const result = await db.query(query, params);

      if (user) {
        const userEnrollments = await db.query("SELECT course_id FROM enrollments WHERE user_id = $1", [user.id]);
        const enrolledCourseIds = new Set(userEnrollments.rows.map((e: { course_id: number }) => e.course_id));
        for (const mission of result.rows) {
          const um = await db.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
          mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
          mission.userScore = um.rows[0]?.score || 0;
          mission.userTimeTaken = um.rows[0]?.time_taken || 0;
          mission.userAnswers = um.rows[0]?.answers || {};
          mission.userIncorrect = um.rows[0]?.incorrect || 0;
          mission.userSkipped = um.rows[0]?.skipped || 0;
          mission.isAccessible = mission.mission_type === "free_practice" || (mission.course_id ? enrolledCourseIds.has(mission.course_id) : enrolledCourseIds.size > 0);
        }
      } else {
        for (const mission of result.rows) mission.isAccessible = mission.mission_type === "free_practice";
      }
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch daily missions" });
    }
  });

  app.get("/api/daily-mission", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const result = await db.query("SELECT * FROM daily_missions WHERE mission_date = CURRENT_DATE AND mission_type = 'daily_drill' LIMIT 1");
      if (result.rows.length === 0) return res.json(null);
      const mission = result.rows[0];
      if (user) {
        const um = await db.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
        mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
        mission.userScore = um.rows[0]?.score || 0;
        mission.userTimeTaken = um.rows[0]?.time_taken || 0;
        mission.userAnswers = um.rows[0]?.answers || {};
        mission.userIncorrect = um.rows[0]?.incorrect || 0;
        mission.userSkipped = um.rows[0]?.skipped || 0;
      }
      res.json(mission);
    } catch {
      res.status(500).json({ message: "Failed to fetch daily mission" });
    }
  });

  app.post("/api/daily-mission/:id/complete", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { score, timeTaken, answers, incorrect, skipped } = req.body;
      await db.query(
        `INSERT INTO user_missions (user_id, mission_id, is_completed, score, completed_at, time_taken, answers, incorrect, skipped) 
         VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8) 
         ON CONFLICT (user_id, mission_id) DO UPDATE SET is_completed = TRUE, score = $3, completed_at = $4, time_taken = $5, answers = $6, incorrect = $7, skipped = $8`,
        [user.id, req.params.id, score, Date.now(), timeTaken || 0, JSON.stringify(answers || {}), incorrect || 0, skipped || 0]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[Mission Complete] Error:", err);
      res.status(500).json({ message: "Failed to complete mission" });
    }
  });

  app.get("/api/study-materials", async (req: Request, res: Response) => {
    try {
      const { free } = req.query;
      let query = "SELECT * FROM study_materials";
      const params: unknown[] = [];
      if (free === "true") query += " WHERE is_free = TRUE";
      query += " ORDER BY created_at DESC";
      const result = await db.query(query, params);

      let folders: any[] = [];
      if (free === "true") {
        const foldersResult = await db.query("SELECT * FROM standalone_folders WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at ASC");
        folders = foldersResult.rows;
      }
      res.set("Cache-Control", "private, no-store");
      res.json({ materials: result.rows, folders });
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });

  app.get("/api/study-materials/folder/:folderName", async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM study_materials WHERE section_title = $1 AND course_id IS NULL ORDER BY created_at DESC", [
        decodeURIComponent(String(req.params.folderName)),
      ]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folder materials" });
    }
  });

  app.get("/api/study-materials/:id", async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM study_materials WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Material not found" });
      const m = result.rows[0] as { course_id?: number | null; is_free?: boolean };
      if (m.course_id) {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ message: "Not authenticated" });
        if (user.role !== "admin" && !m.is_free) {
          const e = await db.query(
            "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, m.course_id],
          );
          if (e.rows.length === 0 || isEnrollmentExpired(e.rows[0])) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to fetch material" });
    }
  });
}

