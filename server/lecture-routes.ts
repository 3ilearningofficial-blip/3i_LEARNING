import type { Express, Request, Response } from "express";
import { isEnrollmentExpired } from "./course-access-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLectureRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
  updateCourseProgress: (userId: number, courseId: number) => Promise<void>;
};

export function registerLectureRoutes({
  app,
  db,
  getAuthUser,
  updateCourseProgress,
}: RegisterLectureRoutesDeps): void {
  const canAccessLecture = async (user: any, lectureId: string | number): Promise<{ allowed: boolean; lecture?: any }> => {
    const result = await db.query(
      `SELECT l.*, c.is_free AS course_is_free
       FROM lectures l
       LEFT JOIN courses c ON l.course_id = c.id
       WHERE l.id = $1`,
      [lectureId]
    );
    if (result.rows.length === 0) return { allowed: false };
    const lecture = result.rows[0];
    if (user?.role === "admin" || lecture.is_free_preview) return { allowed: true, lecture };
    if (!lecture.course_id) return { allowed: true, lecture };
    const enrolled = await db.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, lecture.course_id]
    );
    if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) return { allowed: false, lecture };
    return { allowed: true, lecture };
  };

  app.get("/api/lectures/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);

      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Enrollment required to access this lecture" });
      const lecture = access.lecture;

      res.json(lecture);
    } catch {
      res.status(500).json({ message: "Failed to fetch lecture" });
    }
  });

  app.get("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
      const result = await db.query(
        "SELECT is_completed, watch_percent, COALESCE(playback_sessions, 0) AS playback_sessions FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
      res.json(result.rows[0]);
    } catch {
      res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
    }
  });

  /** Debounced "opened player" — does not change watch % or completion. */
  app.post("/api/lectures/:id/progress/session", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Access denied for this lecture" });

      const debounceMs = 8 * 60 * 1000;
      const now = Date.now();
      const prev = await db.query(
        "SELECT last_session_ping_at FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, lectureId]
      );
      const row = prev.rows[0];
      const canBump = !row?.last_session_ping_at || now - Number(row.last_session_ping_at) >= debounceMs;

      if (!row) {
        await db.query(
          `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, playback_sessions, last_session_ping_at, completed_at)
           VALUES ($1, $2, 0, false, 1, $3, NULL)`,
          [user.id, lectureId, now]
        );
      } else if (canBump) {
        await db.query(
          `UPDATE lecture_progress SET
             playback_sessions = COALESCE(playback_sessions, 0) + 1,
             last_session_ping_at = $3
           WHERE user_id = $1 AND lecture_id = $2`,
          [user.id, lectureId, now]
        );
      }
      res.json({ success: true, bumped: canBump || !row });
    } catch {
      res.status(500).json({ message: "Failed to record session" });
    }
  });

  app.post("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { watchPercent, isCompleted } = req.body;
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Access denied for this lecture" });
      const lecture = access.lecture;
      const courseId = lecture.course_id ? Number(lecture.course_id) : null;
      const normalizedWatchPercent = Math.max(0, Math.min(100, Number(watchPercent) || 0));
      await db.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET watch_percent = $3, is_completed = $4, completed_at = $5`,
        [user.id, lectureId, normalizedWatchPercent, Boolean(isCompleted), isCompleted ? Date.now() : null]
      );
      if (courseId && isCompleted) {
        await updateCourseProgress(user.id, Number(courseId));
        await db.query("UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3", [lectureId, user.id, courseId]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });
}

