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
          // BUG-15 fix: add LIMIT so a course with many historical classes doesn't send
          // an unbounded payload. 500 is generous — no single course needs more at once.
          const result = await db.query(
            `SELECT lc.*, c.title as course_title
             FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
             WHERE lc.course_id = $1
             ORDER BY lc.scheduled_at DESC
             LIMIT 500`,
            [cid]
          );
          res.set("Cache-Control", "private, no-store");
          return res.json(result.rows.map(sanitizeLiveClass));
        }
        // BUG-15 fix: paginate the all-classes admin listing.
        // Accepts ?limit=N (1–500, default 200) and ?offset=N (default 0).
        const rawLimit  = parseInt(String(req.query.limit  || "200"), 10);
        const rawOffset = parseInt(String(req.query.offset || "0"),   10);
        const safeLimit  = Number.isFinite(rawLimit)  && rawLimit  > 0 ? Math.min(rawLimit,  500) : 200;
        const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const result = await db.query(
          `SELECT lc.*, c.title as course_title
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           ORDER BY lc.scheduled_at DESC
           LIMIT $1 OFFSET $2`,
          [safeLimit, safeOffset]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }

      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const rawLimit = parseInt(String(req.query.limit || "20"), 10);
        const rawOffset = parseInt(String(req.query.offset || "0"), 10);
        const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;
        const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const safeLimitPlusOne = safeLimit + 1;
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND (lc.is_free_preview = TRUE OR ${ex23})
           ORDER BY lc.scheduled_at DESC
           LIMIT $4 OFFSET $5`,
          [cid, user.id, now, safeLimitPlusOne, safeOffset]
        );
        const hasMore = result.rows.length > safeLimit;
        const rowsToSend = hasMore ? result.rows.slice(0, safeLimit) : result.rows;
        res.set("Cache-Control", "private, no-store");
        res.set("X-Has-More", hasMore ? "true" : "false");
        return res.json(rowsToSend.map(sanitizeLiveClass));
      }
      if (cid) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
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
           WHERE COALESCE(lc.is_recording_mode, FALSE) = FALSE
             AND (
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
         WHERE COALESCE(lc.is_recording_mode, FALSE) = FALSE
           AND (
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

  app.get("/api/upcoming-classes", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const isAdmin = user?.role === "admin";

      let result;
      if (isAdmin) {
        // Admins see ALL upcoming classes across all courses — including paid, private,
        // and recording-mode classes. This powers the "Upcoming Class" widget on the
        // admin dashboard so admins can see every class they've scheduled.
        result = await db.query(`
          SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
          FROM live_classes lc
          LEFT JOIN courses c ON c.id = lc.course_id
          WHERE lc.is_completed IS NOT TRUE
          ORDER BY
            lc.is_live DESC,
            lc.scheduled_at ASC NULLS LAST
          LIMIT 200
        `);
        console.log(`[UpcomingClasses] admin: returning ${result.rows.length} classes`);
        res.set("Cache-Control", "private, no-store");
        // Admins receive the full row (including stream keys are stripped by sanitizeLiveClass
        // but playback/meeting URLs are kept so admin can act on them).
        return res.json(result.rows.map(sanitizeLiveClass));
      }

      // Public/student feed: only expose classes that are explicitly public, free, or
      // free-preview. Private paid-course classes must NOT appear here — their schedule,
      // title, and course details would be visible to unauthenticated users otherwise.
      result = await db.query(`
        SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
        FROM live_classes lc
        LEFT JOIN courses c ON c.id = lc.course_id
        WHERE lc.is_completed IS NOT TRUE
          AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
          AND (
            lc.course_id IS NULL
            OR lc.is_public = TRUE
            OR lc.is_free_preview = TRUE
            OR c.is_free = TRUE
          )
        ORDER BY
          lc.is_live DESC,
          lc.scheduled_at ASC NULLS LAST
        LIMIT 50
      `);
      console.log(`[UpcomingClasses] public: returning ${result.rows.length} classes`);
      res.set("Cache-Control", "private, max-age=30");
      res.json(result.rows.map(toPublicUpcomingDto));
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.set("Cache-Control", "private, max-age=30");
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

