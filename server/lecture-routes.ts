import type { Express, Request, Response } from "express";

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
  app.get("/api/lectures/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const result = await db.query(
        `SELECT l.*, c.is_free AS course_is_free
         FROM lectures l
         LEFT JOIN courses c ON l.course_id = c.id
         WHERE l.id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Lecture not found" });
      const lecture = result.rows[0];

      if (user.role !== "admin" && !lecture.is_free_preview) {
        if (lecture.course_id) {
          const enrolled = await db.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, lecture.course_id]);
          if (enrolled.rows.length === 0) {
            return res.status(403).json({ message: "Enrollment required to access this lecture" });
          }
        }
      }

      res.json(lecture);
    } catch {
      res.status(500).json({ message: "Failed to fetch lecture" });
    }
  });

  app.get("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ is_completed: false });
      const result = await db.query("SELECT is_completed, watch_percent FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2", [user.id, req.params.id]);
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0 });
      res.json(result.rows[0]);
    } catch {
      res.json({ is_completed: false });
    }
  });

  app.post("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { courseId, watchPercent, isCompleted } = req.body;
      await db.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET watch_percent = $3, is_completed = $4, completed_at = $5`,
        [user.id, req.params.id, watchPercent, isCompleted, isCompleted ? Date.now() : null]
      );
      if (courseId && isCompleted) {
        await updateCourseProgress(user.id, courseId);
        await db.query("UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3", [req.params.id, user.id, courseId]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });
}

