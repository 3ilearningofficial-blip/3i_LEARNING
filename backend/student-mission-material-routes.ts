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
  const hasActiveCourseEnrollment = async (userId: number, courseId: number): Promise<boolean> => {
    const e = await db.query(
      "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
      [userId, courseId]
    );
    if (e.rows.length === 0) return false;
    return !isEnrollmentExpired(e.rows[0]);
  };

  const canAccessMission = async (user: any | null, mission: any): Promise<boolean> => {
    if (mission?.mission_type === "free_practice") return true;
    if (!user?.id) return false;
    if (user.role === "admin") return true;
    if (!mission?.course_id) return false;
    return hasActiveCourseEnrollment(Number(user.id), Number(mission.course_id));
  };

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
        const missionIds = result.rows.map((m: any) => Number(m.id)).filter((id: number) => Number.isFinite(id));
        const userMissionMap = new Map<number, any>();
        if (missionIds.length > 0) {
          const umBatch = await db.query(
            "SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = ANY($2::int[])",
            [user.id, missionIds],
          );
          umBatch.rows.forEach((um: any) => {
            userMissionMap.set(Number(um.mission_id), um);
          });
        }

        const enrolledCourseIds = new Set<number>();
        if (user.role !== "admin") {
          const courseIds = [
            ...new Set(
              result.rows
                .map((m: any) => Number(m.course_id))
                .filter((cid: number) => Number.isFinite(cid) && cid > 0)
            ),
          ];
          if (courseIds.length > 0) {
            const enr = await db.query(
              `SELECT course_id, valid_until FROM enrollments
               WHERE user_id = $1 AND course_id = ANY($2::int[])
                 AND (status = 'active' OR status IS NULL)`,
              [user.id, courseIds]
            );
            for (const row of enr.rows) {
              if (!isEnrollmentExpired(row)) enrolledCourseIds.add(Number(row.course_id));
            }
          }
        }

        const missionAccessible = (mission: any): boolean => {
          if (mission?.mission_type === "free_practice") return true;
          if (user.role === "admin") return true;
          const cid = Number(mission?.course_id);
          if (!Number.isFinite(cid) || cid <= 0) return false;
          return enrolledCourseIds.has(cid);
        };

        for (const mission of result.rows) {
          mission.isAccessible = missionAccessible(mission);
          if (!mission.isAccessible && user.role !== "admin") continue;
          const um = userMissionMap.get(Number(mission.id));
          mission.isCompleted = !!um?.is_completed;
          mission.userScore = um?.score || 0;
          mission.userTimeTaken = um?.time_taken || 0;
          mission.userAnswers = um?.answers || {};
          mission.userIncorrect = um?.incorrect || 0;
          mission.userSkipped = um?.skipped || 0;
        }
        if (user.role !== "admin") {
          result.rows = result.rows.filter((m: any) => !!m.isAccessible);
        }
      } else {
        for (const mission of result.rows) mission.isAccessible = mission.mission_type === "free_practice";
        result.rows = result.rows.filter((m: any) => !!m.isAccessible);
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
      const missionRes = await db.query("SELECT * FROM daily_missions WHERE id = $1 LIMIT 1", [req.params.id]);
      if (missionRes.rows.length === 0) return res.status(404).json({ message: "Mission not found" });
      const mission = missionRes.rows[0];
      const allowed = await canAccessMission(user, mission);
      if (!allowed) return res.status(403).json({ message: "Access denied" });
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
      const user = await getAuthUser(req);
      const { free } = req.query;
      const now = Date.now();

      const loadFolders = async () => {
        if (free !== "true") return [];
        const foldersResult = await db.query(
          "SELECT * FROM standalone_folders WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at ASC"
        );
        return foldersResult.rows;
      };

      if (user?.role === "admin") {
        let query = "SELECT * FROM study_materials";
        if (free === "true") query += " WHERE is_free = TRUE";
        query += " ORDER BY created_at DESC";
        const result = await db.query(query, []);
        const folders = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result.rows, folders });
      }

      if (!user) {
        const result = await db.query(
          "SELECT id, title, description, file_type, course_id, is_free, section_title, download_allowed, created_at, file_url FROM study_materials WHERE is_free = TRUE ORDER BY created_at DESC"
        );
        const folders = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result.rows, folders });
      }

      const result = await db.query(
        `SELECT sm.*
         FROM study_materials sm
         WHERE sm.is_free = TRUE
           OR (sm.course_id IS NULL AND sm.is_free = TRUE)
            OR EXISTS (
              SELECT 1 FROM enrollments e
              WHERE e.user_id = $1
                AND e.course_id = sm.course_id
                AND (e.status = 'active' OR e.status IS NULL)
                AND (e.valid_until IS NULL OR e.valid_until > $2)
            )
         ORDER BY sm.created_at DESC`,
        [user.id, now]
      );
      const folders = await loadFolders();
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

