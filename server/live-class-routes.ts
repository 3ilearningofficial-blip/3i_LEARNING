import type { Express, Request, Response } from "express";
import { isEnrollmentExpired } from "./course-access-utils";
import { sqlEnrollmentExistsForLiveList, userCanAccessLiveClassContent } from "./live-class-access";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveClassRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
};

export function registerLiveClassRoutes({
  app,
  db,
  getAuthUser,
}: RegisterLiveClassRoutesDeps): void {
  app.get("/api/live-classes", async (req: Request, res: Response) => {
    try {
      const { courseId, admin } = req.query;
      const user = await getAuthUser(req);
      const cid = courseId ? String(courseId) : null;

      if (admin === "true" && user?.role === "admin") {
        if (cid) {
          const result = await db.query(
            "SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id WHERE lc.course_id = $1 OR lc.course_id IS NULL ORDER BY lc.scheduled_at DESC",
            [cid]
          );
          return res.json(result.rows);
        }
        const result = await db.query("SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id ORDER BY lc.scheduled_at DESC");
        return res.json(result.rows);
      }

      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1 OR lc.course_id IS NULL)
           AND (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             OR (lc.is_live = TRUE AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id = $1 AND (lc.is_free_preview = TRUE OR ${ex23}))
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id = $1 AND (lc.is_free_preview = TRUE OR ${ex23}))
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid, user.id, now]
        );
        return res.json(result.rows);
      }
      if (cid) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1 OR lc.course_id IS NULL)
           AND (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             OR (lc.is_live = TRUE AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id = $1 AND lc.is_free_preview = TRUE)
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id = $1 AND lc.is_free_preview = TRUE)
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid]
        );
        return res.json(result.rows);
      }
      const ex12 = sqlEnrollmentExistsForLiveList(1, 2);
      if (user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex12} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             OR (lc.is_live = TRUE AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [user.id, now]
        );
        return res.json(result.rows);
      }
      const result = await db.query(
        `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
         FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
         WHERE (
           (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
           OR (lc.is_live = TRUE AND (
                (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           ))
           OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           ))
         )
         ORDER BY lc.scheduled_at DESC`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[LiveClasses] list error:", err);
      // Keep login/home resilient even if this auxiliary feed fails.
      res.json([]);
    }
  });

  app.get("/api/upcoming-classes", async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
        FROM live_classes lc
        LEFT JOIN courses c ON c.id = lc.course_id
        WHERE lc.is_completed IS NOT TRUE
        ORDER BY 
          lc.is_live DESC,
          lc.scheduled_at ASC NULLS LAST
        LIMIT 50
      `);
      console.log(`[UpcomingClasses] returning ${result.rows.length} classes`);
      res.json(result.rows);
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.json([]);
    }
  });

  app.get("/api/live-classes/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const result = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const lc = result.rows[0];

      let isEnrolled = false;
      if (user && lc.course_id) {
        const enroll = await db.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, lc.course_id]);
        isEnrolled = enroll.rows.length > 0 && !isEnrollmentExpired(enroll.rows[0]);
      }

      const hasAccess = await userCanAccessLiveClassContent(db, user, lc);

      res.json({ ...lc, is_enrolled: isEnrolled, has_access: hasAccess });
    } catch {
      res.status(500).json({ message: "Failed to fetch live class" });
    }
  });
}

