import type { Express, Request, Response } from "express";

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

      if (cid && user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $2 AND (e.status = 'active' OR e.status IS NULL)) as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1 OR lc.course_id IS NULL)
           AND (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             OR (lc.is_live = TRUE AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $2 AND (e.status = 'active' OR e.status IS NULL))))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $2 AND (e.status = 'active' OR e.status IS NULL))))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid, user.id]
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
             OR (lc.is_live = TRUE AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid]
        );
        return res.json(result.rows);
      }
      if (user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $1 AND (e.status = 'active' OR e.status IS NULL)) as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             OR (lc.is_live = TRUE AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $1 AND (e.status = 'active' OR e.status IS NULL))))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $1 AND (e.status = 'active' OR e.status IS NULL))))
           )
           ORDER BY lc.scheduled_at DESC`,
          [user.id]
        );
        return res.json(result.rows);
      }
      const result = await db.query(
        `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
         FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
         WHERE (
           (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
           OR (lc.is_live = TRUE AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL))
           OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL))
         )
         ORDER BY lc.scheduled_at DESC`
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch live classes" });
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
      res.status(500).json({ message: "Failed to fetch upcoming classes" });
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
        const enroll = await db.query("SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, lc.course_id]);
        isEnrolled = enroll.rows.length > 0;
      }

      const hasAccess = !lc.course_id || lc.is_public || lc.is_free_preview || isEnrolled || user?.role === "admin";

      res.json({ ...lc, is_enrolled: isEnrolled, has_access: hasAccess });
    } catch {
      res.status(500).json({ message: "Failed to fetch live class" });
    }
  });
}

