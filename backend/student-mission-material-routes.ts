import type { Express, Request, Response } from "express";
import { isEnrollmentExpired } from "./course-access-utils";
import { hasActiveStandaloneEntitlement } from "./standalone-entitlement-service";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterStudentMissionMaterialRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  updateCourseProgress?: (userId: number, courseId: number | string) => Promise<void>;
};

const STANDALONE_FOLDER_SELECT = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      sf.*,
      sf.name::text AS full_name,
      ARRAY[sf.id] AS path_ids
    FROM standalone_folders sf
    WHERE sf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM standalone_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;

export function registerStudentMissionMaterialRoutes({
  app,
  db,
  getAuthUser,
  updateCourseProgress,
}: RegisterStudentMissionMaterialRoutesDeps): void {
  const canAccessStandaloneMaterial = async (user: any | null, material: any): Promise<boolean> => {
    if (material?.is_free) return true;
    if (user?.role === "admin") return true;
    if (!user?.id || !material?.id) return false;
    return hasActiveStandaloneEntitlement(db, Number(user.id), Number(material.id));
  };

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

  const listAccessibleDailyMissions = async (
    user: any | null,
    opts: { type?: string; folderName?: string },
  ): Promise<any[]> => {
    const { type, folderName } = opts;
    // For the main list (no folderName) only surface missions up to today — this is
    // the daily-drill feed.  For a specific folder the full curriculum is shown
    // regardless of mission_date so admins can pre-populate upcoming content.
    let query = `SELECT dm.*, c.title AS course_title
      FROM daily_missions dm
      LEFT JOIN courses c ON c.id = dm.course_id
      WHERE 1=1`;
    if (!folderName) {
      query += ` AND dm.mission_date <= CURRENT_DATE`;
    }
    const params: unknown[] = [];
    if (type && type !== "all") {
      params.push(type);
      query += ` AND dm.mission_type = $${params.length}`;
    }
    if (folderName) {
      params.push(folderName);
      query += ` AND dm.folder_name = $${params.length}`;
    }
    query += " ORDER BY COALESCE(dm.order_index, 0) ASC, dm.mission_date ASC LIMIT 200";
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
      // Which standalone mission folders are free — missions inside free folders
      // are visible to every authenticated student even without a course enrollment.
      const freeFolderNames = new Set<string>();

      if (user.role !== "admin") {
        const courseIds = [
          ...new Set(
            result.rows
              .map((m: any) => Number(m.course_id))
              .filter((cid: number) => Number.isFinite(cid) && cid > 0),
          ),
        ];
        if (courseIds.length > 0) {
          const enr = await db.query(
            `SELECT course_id, valid_until FROM enrollments
             WHERE user_id = $1 AND course_id = ANY($2::int[])
               AND (status = 'active' OR status IS NULL)`,
            [user.id, courseIds],
          );
          for (const row of enr.rows) {
            if (!isEnrollmentExpired(row)) enrolledCourseIds.add(Number(row.course_id));
          }
        }

        // Fetch is_free status for every folder referenced in the result set.
        const folderNamesInResult = [
          ...new Set(
            result.rows
              .map((m: any) => m.folder_name)
              .filter((n: any) => typeof n === "string" && n.length > 0),
          ),
        ] as string[];
        if (folderNamesInResult.length > 0) {
          const freeRows = await db.query(
            `${STANDALONE_FOLDER_SELECT}
             SELECT full_name
             FROM folder_tree
             WHERE type = 'mission' AND is_free = TRUE AND full_name = ANY($1::text[])`,
            [folderNamesInResult],
          );
          for (const row of freeRows.rows) freeFolderNames.add(String(row.full_name));
        }
      }

      const missionAccessible = (mission: any): boolean => {
        if (mission?.mission_type === "free_practice") return true;
        if (user.role === "admin") return true;
        // Missions inside a free standalone folder are accessible to all logged-in students.
        if (mission?.folder_name && freeFolderNames.has(String(mission.folder_name))) return true;
        // Otherwise access is gated by course enrollment.
        const cid = Number(mission?.course_id);
        if (!Number.isFinite(cid) || cid <= 0) return false;
        return enrolledCourseIds.has(cid);
      };

      for (const mission of result.rows) {
        mission.isAccessible = missionAccessible(mission);
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
    return result.rows;
  };

  app.get("/api/daily-missions", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const { type } = req.query;
      const rows = await listAccessibleDailyMissions(user, { type: String(type || "all") });
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch daily missions" });
    }
  });

  app.get("/api/daily-missions/folder/:folderName", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const { type } = req.query;
      const folderName = decodeURIComponent(String(req.params.folderName || "")).trim();
      if (!folderName) return res.status(400).json({ message: "Folder name required" });
      const rows = await listAccessibleDailyMissions(user, {
        type: String(type || "all"),
        folderName,
      });
      res.set("Cache-Control", "private, no-store");
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch folder missions" });
    }
  });

  // Mission folder list for the student daily-mission UI (Group L).
  // Uses standalone_folders where `type='mission'`.
  app.get("/api/mission-folders", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const result = await db.query(
        `${STANDALONE_FOLDER_SELECT}
         SELECT
           id,
           name,
           parent_id,
           full_name,
           category,
           validity_months,
           is_free,
           description,
           created_at
         FROM folder_tree
         WHERE type = 'mission'
           AND (is_hidden = FALSE OR is_hidden IS NULL)
         ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`
      );

      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch (err) {
      console.error("[MissionFolders] error:", err);
      res.status(500).json({ message: "Failed to fetch mission folders" });
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
      const courseId = mission.course_id != null ? Number(mission.course_id) : NaN;
      if (updateCourseProgress && Number.isFinite(courseId) && courseId > 0) {
        await updateCourseProgress(user.id, courseId).catch(() => {});
      }
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
          `${STANDALONE_FOLDER_SELECT}
           SELECT *
           FROM folder_tree
           WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL)
           ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`
        );
        return foldersResult.rows;
      };

      if (user?.role === "admin") {
        let query = "SELECT * FROM study_materials";
        if (free === "true") query += " WHERE is_free = TRUE";
        query += " ORDER BY COALESCE(order_index, 0) ASC, created_at DESC";
        const result = await db.query(query, []);
        const folders = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result.rows, folders });
      }

      if (!user) {
        const result = await db.query(
          "SELECT id, title, description, file_type, course_id, is_free, section_title, download_allowed, created_at, file_url FROM study_materials WHERE is_free = TRUE ORDER BY COALESCE(order_index, 0) ASC, created_at DESC"
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
         ORDER BY COALESCE(sm.order_index, 0) ASC, sm.created_at DESC`,
        [user.id, now]
      );
      const filteredRows = [];
      for (const row of result.rows) {
        if (!row.course_id) {
          if (await canAccessStandaloneMaterial(user, row)) filteredRows.push(row);
          continue;
        }
        filteredRows.push(row);
      }
      const folders = await loadFolders();
      res.set("Cache-Control", "private, no-store");
      res.json({ materials: filteredRows, folders });
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });

  app.get("/api/study-materials/folder/:folderName", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const folderName = decodeURIComponent(String(req.params.folderName));
      const result = await db.query(
        `SELECT *
         FROM study_materials
         WHERE course_id IS NULL
           AND (section_title = $1 OR section_title LIKE $1 || ' / %')
         ORDER BY COALESCE(order_index, 0) ASC, created_at DESC`,
        [folderName]
      );
      const safeRows: any[] = [];
      for (const row of result.rows) {
        if (await canAccessStandaloneMaterial(user, row)) safeRows.push(row);
      }
      res.json(safeRows);
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
      } else {
        const user = await getAuthUser(req);
        const allowed = await canAccessStandaloneMaterial(user, m);
        if (!allowed) return res.status(403).json({ message: "Access denied" });
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to fetch material" });
    }
  });
}

