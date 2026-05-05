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
  const sanitizeLiveClass = (row: any) => {
    if (!row || typeof row !== "object") return row;
    const { cf_stream_key, cf_stream_rtmp_url, ...safe } = row;
    void cf_stream_key;
    void cf_stream_rtmp_url;
    return safe;
  };

  /** Remove playback / meeting URLs from public feeds when user must not watch yet (marketing/home upcoming strip). */
  const stripPublicPlaybackFields = (row: any) => {
    if (!row || typeof row !== "object") return row;
    const {
      recording_url,
      cf_playback_hls,
      youtube_url,
      cf_stream_uid,
      stream_url,
      meeting_url,
      join_url,
      zoom_meeting_id,
      google_meet_link,
      ...rest
    } = row;
    void recording_url;
    void cf_playback_hls;
    void youtube_url;
    void cf_stream_uid;
    void stream_url;
    void meeting_url;
    void join_url;
    void zoom_meeting_id;
    void google_meet_link;
    return rest;
  };

  const toPublicUpcomingDto = (row: any) => stripPublicPlaybackFields(sanitizeLiveClass(row));

  app.get("/api/live-classes", async (req: Request, res: Response) => {
    try {
      const { courseId, admin } = req.query;
      const user = await getAuthUser(req);
      const cid = courseId ? String(courseId) : null;

      if (admin === "true" && user?.role === "admin") {
        if (cid) {
          const result = await db.query(
            "SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id WHERE lc.course_id = $1 ORDER BY lc.scheduled_at DESC",
            [cid]
          );
          res.set("Cache-Control", "private, no-store");
          return res.json(result.rows.map(sanitizeLiveClass));
        }
        const result = await db.query("SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id ORDER BY lc.scheduled_at DESC");
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }

      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND (lc.is_free_preview = TRUE OR ${ex23})
           ORDER BY lc.scheduled_at DESC`,
          [cid, user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }
      if (cid) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND lc.is_free_preview = TRUE
           ORDER BY lc.scheduled_at DESC`,
          [cid]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }
      const ex12 = sqlEnrollmentExistsForLiveList(1, 2);
      if (user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex12} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (
             lc.is_completed IS NOT TRUE
             OR (
               lc.recording_url IS NOT NULL
               OR lc.cf_playback_hls IS NOT NULL
               OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
             )
           )
             AND (
               (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
               OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             )
           ORDER BY lc.scheduled_at DESC`,
          [user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }
      const result = await db.query(
        `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
         FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
         WHERE (
           lc.is_completed IS NOT TRUE
           OR (
             lc.recording_url IS NOT NULL
             OR lc.cf_playback_hls IS NOT NULL
             OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
           )
         )
           AND (
             (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
             OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           )
         ORDER BY lc.scheduled_at DESC`
      );
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows.map(sanitizeLiveClass));
    } catch (err) {
      console.error("[LiveClasses] list error:", err);
      // Keep login/home resilient even if this auxiliary feed fails.
      res.set("Cache-Control", "private, no-store");
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
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows.map(toPublicUpcomingDto));
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.set("Cache-Control", "private, no-store");
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

      const canViewStreamSecrets = user?.role === "admin";
      const base = canViewStreamSecrets ? lc : sanitizeLiveClass(lc);
      const payload = canViewStreamSecrets || hasAccess ? base : stripPublicPlaybackFields(base);
      res.set("Cache-Control", "private, no-store");
      res.json({ ...payload, is_enrolled: isEnrolled, has_access: hasAccess });
    } catch {
      res.status(500).json({ message: "Failed to fetch live class" });
    }
  });
}

