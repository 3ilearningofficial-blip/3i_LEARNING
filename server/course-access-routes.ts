import type { Express, Request, Response } from "express";
import { computeEnrollmentValidUntil, isEnrollmentExpired } from "./course-access-utils";

type DbQueryResult = {
  rows: any[];
  rowCount?: number;
};

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<DbQueryResult>;
};

type AuthUser = {
  id: number;
  role: string;
};

type RegisterCourseAccessRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  generateSecureToken: () => string;
  getR2Client: () => Promise<any>;
  updateCourseProgress: (userId: number, courseId: number | string) => Promise<void>;
};

export function registerCourseAccessRoutes({
  app,
  db,
  getAuthUser,
  generateSecureToken,
  getR2Client,
  updateCourseProgress,
}: RegisterCourseAccessRoutesDeps): void {
  /** Same rules as GET /api/download-url (without issuing a token). */
  const assertTrackDownloadAllowed = async (
    user: AuthUser,
    itemType: string,
    itemId: number
  ): Promise<{ ok: true } | { ok: false; status: number; message: string }> => {
    const roleNorm = String(user.role ?? "student").toLowerCase();
    if (roleNorm !== "student" && roleNorm !== "admin") {
      return { ok: false, status: 401, message: "Not authenticated" };
    }
    const bypass = roleNorm === "admin";
    if (itemType !== "lecture" && itemType !== "material") {
      return { ok: false, status: 400, message: "Invalid itemType" };
    }
    let courseId: number | null = null;
    let materialIsFree = false;
    let downloadAllowed = false;
    if (itemType === "lecture") {
      const lectureResult = await db.query("SELECT course_id, download_allowed FROM lectures WHERE id = $1", [itemId]);
      if (lectureResult.rows.length === 0) return { ok: false, status: 404, message: "Lecture not found" };
      courseId = lectureResult.rows[0].course_id;
      downloadAllowed = !!lectureResult.rows[0].download_allowed;
    } else {
      const materialResult = await db.query("SELECT course_id, download_allowed, is_free FROM study_materials WHERE id = $1", [itemId]);
      if (materialResult.rows.length === 0) return { ok: false, status: 404, message: "Material not found" };
      courseId = materialResult.rows[0].course_id;
      downloadAllowed = !!materialResult.rows[0].download_allowed;
      materialIsFree = !!materialResult.rows[0].is_free;
    }
    if (!downloadAllowed) return { ok: false, status: 403, message: "Download not allowed for this item" };
    const courseIdResolved = courseId == null ? null : Math.trunc(Number(courseId));
    if (itemType === "material" && courseIdResolved === null && !bypass && !materialIsFree) {
      return { ok: false, status: 403, message: "This material requires purchase" };
    }
    if (courseIdResolved !== null && !bypass) {
      const enrollmentResult = await db.query(
        "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
        [user.id, courseIdResolved]
      );
      if (enrollmentResult.rows.length === 0) {
        return { ok: false, status: 403, message: "Not enrolled in this course" };
      }
      const row = enrollmentResult.rows[0];
      if (isEnrollmentExpired(row)) {
        return { ok: false, status: 403, message: "Course access has expired" };
      }
    }
    return { ok: true };
  };

  const normalizeStorageKey = (raw: string): string => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      try {
        const parsed = new URL(trimmed);
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      } catch {
        return trimmed;
      }
    }
    return trimmed.replace(/^\/+/, "");
  };

  /** Path after host + optional `/api/media/` — matches client `fileKey` and DB `video_url` / `file_url` variants. */
  const canonicalMediaRelativeKey = (raw: string): string => {
    let s = normalizeStorageKey(raw);
    if (!s) return "";
    s = s.replace(/^\/+/, "");
    const proxy = "api/media/";
    if (s.toLowerCase().startsWith(proxy)) {
      s = s.slice(proxy.length).replace(/^\/+/, "");
    }
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep */
    }
    return s.replace(/^\/+/, "").replace(/\/+$/g, "");
  };

  const mediaKeyMatchVariants = (raw: string): string[] => {
    const k = canonicalMediaRelativeKey(raw);
    if (!k || k.includes("..")) return [];
    const set = new Set<string>([k, `api/media/${k}`, `/api/media/${k}`]);
    return [...set];
  };

  /** Buckets use keys like `folder/file.pdf`. App URLs use `/api/media/folder/file.pdf` — strip that proxy prefix for GetObject. */
  const toR2ObjectKey = (raw: string): string => {
    let key = normalizeStorageKey(raw);
    if (!key) return "";
    const proxy = "api/media/";
    if (key.toLowerCase().startsWith(proxy)) key = key.slice(proxy.length).replace(/^\/+/, "");
    try {
      key = decodeURIComponent(key);
    } catch {
      /* keep */
    }
    return key.replace(/^\/+/, "").replace(/\/+$/g, "");
  };

  const userCanMintMediaToken = async (user: AuthUser, requestedKeyRaw: string): Promise<boolean> => {
    const variants = mediaKeyMatchVariants(requestedKeyRaw);
    if (variants.length === 0) return false;

    const roleNorm = String(user.role ?? "").toLowerCase();
    if (roleNorm === "admin") {
      return true;
    }

    const now = Date.now();

    const lectureMatch = await db.query(
      `SELECT l.id
       FROM lectures l
       LEFT JOIN enrollments e
         ON e.user_id = $1
        AND e.course_id = l.course_id
        AND (e.status = 'active' OR e.status IS NULL)
       WHERE l.video_url IS NOT NULL
         AND (
           regexp_replace(regexp_replace(COALESCE(l.video_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($2::text[])
           OR regexp_replace(COALESCE(l.video_url, ''), '^https?://[^/]+/', '') = ANY($2::text[])
         )
         AND (
           l.course_id IS NULL
           OR l.is_free_preview = TRUE
           OR (
             e.id IS NOT NULL
             AND (e.valid_until IS NULL OR e.valid_until > $3)
           )
         )
       LIMIT 1`,
      [user.id, variants, now]
    );
    if (lectureMatch.rows.length > 0) return true;

    const materialMatch = await db.query(
      `SELECT sm.id
       FROM study_materials sm
       LEFT JOIN enrollments e
         ON e.user_id = $1
        AND e.course_id = sm.course_id
        AND (e.status = 'active' OR e.status IS NULL)
       WHERE sm.file_url IS NOT NULL
         AND (
           regexp_replace(regexp_replace(COALESCE(sm.file_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($2::text[])
           OR regexp_replace(COALESCE(sm.file_url, ''), '^https?://[^/]+/', '') = ANY($2::text[])
         )
         AND (
           sm.course_id IS NULL
           OR sm.is_free = TRUE
           OR (
             e.id IS NOT NULL
             AND (e.valid_until IS NULL OR e.valid_until > $3)
           )
         )
       LIMIT 1`,
      [user.id, variants, now]
    );
    return materialMatch.rows.length > 0;
  };

  const canAccessCourseContent = async (user: AuthUser | null, courseId: string): Promise<boolean> => {
    if (!user) return false;
    if (user.role === "admin") return true;
    const enroll = await db.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, courseId]
    );
    if (enroll.rows.length === 0) return false;
    return !isEnrollmentExpired(enroll.rows[0]);
  };

  app.post("/api/media-token", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { fileKey } = req.body;
      if (!fileKey || typeof fileKey !== "string") return res.status(400).json({ message: "fileKey required" });
      const allowed = await userCanMintMediaToken(user, fileKey);
      if (!allowed) return res.status(403).json({ message: "You do not have access to this media file" });
      const token = generateSecureToken();
      const expiresAt = Date.now() + 10 * 60 * 1000;
      const storedKey = canonicalMediaRelativeKey(fileKey) || normalizeStorageKey(fileKey);
      await db.query("INSERT INTO media_tokens (token, user_id, file_key, expires_at) VALUES ($1, $2, $3, $4)", [token, user.id, storedKey, expiresAt]);
      db.query("DELETE FROM media_tokens WHERE expires_at < $1", [Date.now()]).catch(() => {});
      res.set("Cache-Control", "private, no-store");
      res.json({ token, expiresAt });
    } catch {
      res.status(500).json({ message: "Failed to generate token" });
    }
  });

  app.get("/api/courses", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const { category, search } = req.query;
      let query =
        user?.role === "admin"
          ? `SELECT c.*,
               (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS total_lectures,
               (SELECT COUNT(*) FROM tests t WHERE t.course_id = c.id AND t.is_published = TRUE) AS total_tests,
               (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials
             FROM courses c WHERE 1=1`
          : `SELECT c.*,
               (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS total_lectures,
               (SELECT COUNT(*) FROM tests t WHERE t.course_id = c.id AND t.is_published = TRUE) AS total_tests,
               (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials
             FROM courses c WHERE c.is_published = TRUE`;
      const params: unknown[] = [];

      if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
      }
      if (category && category !== "All") {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";

      const result = await db.query(query, params);
      let courses: any[] = result.rows;

      if (user) {
        const enrollResult = await db.query(
          "SELECT course_id, progress_percent FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL) AND (valid_until IS NULL OR valid_until > $2)",
          [user.id, Date.now()]
        );
        const enrollMap = new Map<number, number>();
        enrollResult.rows.forEach((e: { course_id: number; progress_percent: number }) => {
          enrollMap.set(Number(e.course_id), Number(e.progress_percent) || 0);
        });
        courses = courses.map((c: Record<string, unknown>) => ({
          ...c,
          isEnrolled: enrollMap.has(Number(c.id)),
          progress: enrollMap.get(Number(c.id)) ?? 0,
        }));
      }

      res.set("Cache-Control", "private, no-store");
      if (user) {
        const enrolledCourses = courses.filter((c: any) => c.isEnrolled);
        void enrolledCourses;
      }
      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  app.get("/api/courses/:id/folders", async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM course_folders WHERE course_id = $1 AND is_hidden = FALSE ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });

  app.get("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const courseIdParam = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [courseIdParam]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      const course = courseResult.rows[0];
      const endTs = course.end_date != null && String(course.end_date).trim() !== ""
        ? Date.parse(String(course.end_date).trim()) : null;
      if (Number.isFinite(endTs) && (endTs as number) < Date.now()) {
        (course as any).courseEnded = true;
      } else {
        (course as any).courseEnded = false;
      }
      const lecturesResult = await db.query("SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index", [courseIdParam]);
      const testsResult = await db.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE ORDER BY created_at DESC, id DESC", [courseIdParam]);
      const materialsResult = await db.query("SELECT * FROM study_materials WHERE course_id = $1", [courseIdParam]);
      const fullLectures = lecturesResult.rows;
      const fullMaterials = materialsResult.rows;
      const responseLectures = fullLectures;
      const responseMaterials = fullMaterials;

      if (user) {
        const enroll = await db.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, courseIdParam]);
        const row = enroll.rows[0];
        const accessExpired = row && isEnrollmentExpired(row);
        (course as any).isEnrolled = enroll.rows.length > 0 && !accessExpired;
        (course as any).accessExpired = accessExpired || false;
        (course as any).enrollmentValidUntil = row && row.valid_until != null ? row.valid_until : null;

        const progressRow = row;
        (course as any).progress = progressRow && !accessExpired ? (progressRow?.progress_percent || 0) : 0;
        (course as any).lastLectureId = progressRow && !accessExpired ? progressRow?.last_lecture_id : null;

        if ((course as any).isEnrolled) {
          const lpResult = await db.query(
            `SELECT lp.lecture_id, lp.is_completed
             FROM lecture_progress lp
             JOIN lectures l ON l.id = lp.lecture_id
             WHERE lp.user_id = $1 AND l.course_id = $2`,
            [user.id, courseIdParam],
          );
          const lpMap: Record<number, boolean> = {};
          lpResult.rows.forEach((lp: { lecture_id: number; is_completed: boolean }) => {
            lpMap[lp.lecture_id] = lp.is_completed;
          });
          lecturesResult.rows.forEach((l: Record<string, unknown>) => {
            l.isCompleted = lpMap[l.id as number] || false;
          });
        }
      }

      const hasContentAccess = await canAccessCourseContent(user, courseIdParam);
      // Always return complete course content so unenrolled students can still see
      // what the course includes. Frontend enforces lock state + purchase prompt.
      (course as any).hasContentAccess = hasContentAccess;

      res.set("Cache-Control", "private, no-store");
      res.json({
        ...course,
        total_materials: responseMaterials.length,
        lectures: responseLectures,
        tests: testsResult.rows,
        materials: responseMaterials,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch course" });
    }
  });

  app.post("/api/courses/:id/enroll", async (req: Request, res: Response) => {
    try {
      const requester = await getAuthUser(req);
      if (!requester) return res.status(401).json({ message: "Not authenticated" });
      let user = requester;

      const isAdminGrant = requester?.role === "admin" && req.body.userId && requester.id !== parseInt(req.body.userId);
      if (isAdminGrant) {
        const uid = parseInt(req.body.userId);
        const r = await db.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
        if (r.rows.length > 0) user = r.rows[0];
      } else if (req.body.userId && user.id !== parseInt(req.body.userId)) {
        return res.status(403).json({ message: "Cannot enroll another user" });
      }

      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const courseRow = courseResult.rows[0];
      if (!courseRow.is_free && !isAdminGrant) return res.status(403).json({ message: "This course requires payment" });

      const existing = await db.query("SELECT id, status FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, req.params.id]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].status === "inactive" && isAdminGrant) {
          await db.query("UPDATE enrollments SET status = 'active' WHERE id = $1", [existing.rows[0].id]);
          return res.json({ success: true, reactivated: true });
        }
        return res.json({ success: true, alreadyEnrolled: true });
      }

      const at = Date.now();
      const vu = computeEnrollmentValidUntil(courseRow, at);
      const ins = await db.query(
        `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (user_id, course_id) DO NOTHING
         RETURNING id`,
        [user.id, req.params.id, at, vu]
      );
      if (ins.rows.length > 0) {
        await db.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Enroll error:", err);
      res.status(500).json({ message: "Failed to enroll" });
    }
  });

  app.get("/api/my-courses", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT c.*, e.progress_percent, e.enrolled_at FROM courses c 
         JOIN enrollments e ON c.id = e.course_id 
         WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrolled courses" });
    }
  });

  app.get("/api/my-downloads", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const materialsResult = await db.query(
        `SELECT sm.id, sm.title, sm.file_url, sm.file_type, sm.section_title, sm.download_allowed,
                c.title AS course_title, 'material' AS type, ud.downloaded_at, ud.local_filename
         FROM user_downloads ud
         JOIN study_materials sm ON ud.item_id = sm.id
         LEFT JOIN courses c ON sm.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'material' AND sm.download_allowed = TRUE
         AND (
           c.id IS NULL
           OR (
             (e.status = 'active' OR e.status IS NULL)
             AND (e.valid_until IS NULL OR e.valid_until > $2)
           )
         )
         ORDER BY ud.downloaded_at DESC`,
        [user.id, Date.now()]
      );

      const lecturesResult = await db.query(
        `SELECT l.id, l.title, COALESCE(l.video_url, l.pdf_url) AS file_url,
                CASE WHEN l.video_url IS NOT NULL AND l.video_url != '' THEN 'video' ELSE 'pdf' END AS file_type,
                l.section_title,
                c.title AS course_title, 'lecture' AS type, ud.downloaded_at, ud.local_filename
         FROM user_downloads ud
         JOIN lectures l ON ud.item_id = l.id
         LEFT JOIN courses c ON l.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'lecture' AND l.download_allowed = TRUE
         AND (
           c.id IS NULL
           OR (
             (e.status = 'active' OR e.status IS NULL)
             AND (e.valid_until IS NULL OR e.valid_until > $2)
           )
         )
         ORDER BY ud.downloaded_at DESC`,
        [user.id, Date.now()]
      );

      res.json({
        materials: Array.isArray(materialsResult.rows) ? materialsResult.rows : [],
        lectures: Array.isArray(lecturesResult.rows) ? lecturesResult.rows : [],
      });
    } catch (err) {
      console.error("[Downloads] fetch error:", err);
      // Keep downloads screen resilient instead of surfacing a hard 500 to clients.
      res.json({ materials: [], lectures: [] });
    }
  });

  app.post("/api/my-downloads", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId, localFilename } = req.body;
      if (!itemType || !itemId) return res.status(400).json({ message: "itemType and itemId required" });
      const idNum = parseInt(String(itemId), 10);
      if (!Number.isFinite(idNum)) return res.status(400).json({ message: "Invalid itemId" });
      const gate = await assertTrackDownloadAllowed(user, String(itemType), idNum);
      if (!gate.ok) return res.status(gate.status).json({ message: gate.message });
      await db.query(
        "INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET downloaded_at = EXTRACT(EPOCH FROM NOW()) * 1000, local_filename = EXCLUDED.local_filename",
        [user.id, itemType, idNum, localFilename || null]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to track download" });
    }
  });

  app.delete("/api/my-downloads/:itemType/:itemId", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId } = req.params;
      const result = await db.query("DELETE FROM user_downloads WHERE user_id = $1 AND item_type = $2 AND item_id = $3", [user.id, itemType, itemId]);
      if ((result.rowCount || 0) === 0) return res.status(404).json({ message: "Download record not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete download" });
    }
  });

  app.get("/api/download-url", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const roleNorm = String(user?.role ?? "student").toLowerCase();
      if (!user || (roleNorm !== "student" && roleNorm !== "admin")) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const bypassEnrollment = roleNorm === "admin";

      const { itemType, itemId } = req.query;
      if (!itemType || !itemId || !["lecture", "material"].includes(String(itemType))) {
        return res.status(400).json({ message: "Valid itemType (lecture|material) and itemId required" });
      }

      const id = parseInt(String(itemId));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid itemId" });

      let courseId: number | null = null;
      let materialIsFree = false;
      let downloadAllowed = false;
      let r2Key: string | null = null;

      if (itemType === "lecture") {
        const lectureResult = await db.query(
          "SELECT course_id, download_allowed, video_url, pdf_url FROM lectures WHERE id = $1",
          [id]
        );
        if (lectureResult.rows.length === 0) {
          return res.status(404).json({ message: "Lecture not found" });
        }
        const lecture = lectureResult.rows[0];
        courseId = lecture.course_id;
        downloadAllowed = lecture.download_allowed;
        const vu = lecture.video_url != null ? String(lecture.video_url).trim() : "";
        const pu = lecture.pdf_url != null ? String(lecture.pdf_url).trim() : "";
        r2Key = vu || pu || null;
      } else if (itemType === "material") {
        const materialResult = await db.query("SELECT course_id, download_allowed, file_url, is_free FROM study_materials WHERE id = $1", [id]);
        if (materialResult.rows.length === 0) {
          return res.status(404).json({ message: "Material not found" });
        }
        const material = materialResult.rows[0];
        courseId = material.course_id;
        downloadAllowed = material.download_allowed;
        r2Key = material.file_url;
        materialIsFree = !!material.is_free;
      }

      const courseIdNumeric = courseId == null ? null : Number(courseId);
      const courseIdResolved =
        courseIdNumeric != null && Number.isFinite(courseIdNumeric) ? Math.trunc(courseIdNumeric) : null;

      if (!downloadAllowed) {
        return res.status(403).json({ message: "Download not allowed for this item" });
      }

      if (!r2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }
      if (itemType === "material" && courseIdResolved === null && !bypassEnrollment && !materialIsFree) {
        return res.status(403).json({ message: "This material requires purchase" });
      }

      if (courseIdResolved !== null && !bypassEnrollment) {
        const enrollmentResult = await db.query(
          "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
          [user.id, courseIdResolved]
        );
        if (enrollmentResult.rows.length === 0) {
          return res.status(403).json({ message: "Not enrolled in this course" });
        }
        const enrollment = enrollmentResult.rows[0];
        if (enrollment.valid_until && enrollment.valid_until < Date.now()) {
          return res.status(403).json({ message: "Course access has expired" });
        }
      }

      const cleanR2Key = toR2ObjectKey(String(r2Key));
      if (!cleanR2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }

      const { randomUUID } = await import("crypto");
      const token = randomUUID();
      const createdAt = Date.now();
      // Keep token valid long enough for mobile startup and slower networks.
      const expiresAt = createdAt + 5 * 60 * 1000;

      await db.query("INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        token,
        user.id,
        itemType,
        id,
        cleanR2Key,
        createdAt,
        expiresAt,
      ]);

      res.json({ token, expiresAt });
    } catch (err) {
      console.error("[download-url] Error:", err);
      res.status(500).json({ message: "Failed to generate download token" });
    }
  });

  app.get("/api/download-proxy", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token required" });
      }

      const tokenResult = await db.query(
        "DELETE FROM download_tokens WHERE token = $1 AND expires_at > $2 RETURNING *",
        [token, Date.now()]
      );
      if (tokenResult.rows.length === 0) {
        return res.status(403).json({ message: "Token invalid or expired" });
      }
      const tokenData = tokenResult.rows[0];
      if (Number(tokenData.user_id) !== Number(user.id)) {
        return res.status(403).json({ message: "Token does not belong to this user" });
      }

      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: tokenData.r2_key,
      });
      const r2Response = await r2.send(command);

      if (!r2Response.Body) {
        return res.status(404).json({ message: "File not found in storage" });
      }

      const { createHmac } = await import("crypto");
      const timestamp = Date.now();
      const watermarkData = `${tokenData.user_id}:${timestamp}`;
      const hmac = createHmac("sha256", process.env.SESSION_SECRET || "default-secret").update(watermarkData).digest("hex");
      const watermarkToken = `${watermarkData}:${hmac}`;

      res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("X-Watermark-Token", watermarkToken);
      if (r2Response.ContentLength) {
        res.setHeader("Content-Length", r2Response.ContentLength);
      }

      const stream = r2Response.Body as any;
      stream.pipe(res);
      stream.on("error", (err: Error) => {
        console.error("[download-proxy] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Stream error" });
        }
      });
    } catch (err: unknown) {
      const name = err && typeof err === "object" && "name" in err ? String((err as { name?: string }).name) : "";
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[download-proxy] Error:", name || msg, msg);
      if ((name === "NoSuchKey" || msg.includes("NoSuchKey")) && !res.headersSent) {
        res.status(404).json({ message: "File not found in storage" });
        return;
      }
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to download file" });
      }
    }
  });

  app.get("/api/my-payments", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT p.id,
                (CASE
                  WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                    AND p.amount::numeric = c.price::numeric
                  THEN (ROUND(c.price::numeric * 100))::integer
                  ELSE p.amount
                END) AS amount,
                p.currency, p.status, p.created_at,
                c.title AS course_title, c.price AS course_price
         FROM payments p
         JOIN courses c ON p.course_id = c.id
         WHERE p.user_id = $1 AND p.status = 'paid'
         ORDER BY p.created_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });
}

