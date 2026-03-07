import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import pdfParse from "pdf-parse";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const db = {
  query: (text: string, params?: unknown[]) => pool.query(text, params),
};

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const ADMIN_EMAILS = ["3ilearningofficial@gmail.com"];
const ADMIN_PHONES = ["9997198068"];

export async function registerRoutes(app: Express): Promise<Server> {
  // ==================== AUTH ROUTES ====================
  app.post("/api/auth/send-otp", async (req: Request, res: Response) => {
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }
      const otp = generateOTP();
      const expires = Date.now() + 10 * 60 * 1000;

      if (type === "email") {
        const existing = await db.query("SELECT id FROM users WHERE email = $1", [identifier]);
        if (existing.rows.length === 0) {
          await db.query(
            "INSERT INTO users (name, email, otp, otp_expires_at, role) VALUES ($1, $2, $3, $4, $5)",
            [identifier.split("@")[0], identifier, otp, expires, ADMIN_EMAILS.includes(identifier) ? "admin" : "student"]
          );
        } else {
          await db.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE email = $3", [otp, expires, identifier]);
        }
      } else {
        const existing = await db.query("SELECT id FROM users WHERE phone = $1", [identifier]);
        if (existing.rows.length === 0) {
          await db.query(
            "INSERT INTO users (name, phone, otp, otp_expires_at, role) VALUES ($1, $2, $3, $4, $5)",
            [`Student${identifier.slice(-4)}`, identifier, otp, expires, ADMIN_PHONES.includes(identifier) ? "admin" : "student"]
          );
        } else {
          await db.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE phone = $3", [otp, expires, identifier]);
        }
      }
      console.log(`OTP for ${identifier}: ${otp}`);
      res.json({ success: true, message: "OTP sent successfully", devOtp: otp });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const { identifier, type, otp, deviceId } = req.body;
      if (!identifier || !otp) {
        return res.status(400).json({ message: "Identifier and OTP are required" });
      }

      const field = type === "email" ? "email" : "phone";
      const result = await db.query(`SELECT * FROM users WHERE ${field} = $1`, [identifier]);

      if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });

      const user = result.rows[0];
      if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
      if (Date.now() > user.otp_expires_at) return res.status(400).json({ message: "OTP expired" });

      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, user.id]);

      const sessionUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        deviceId: deviceId,
        sessionToken: sessionToken,
      };
      (req.session as Record<string, unknown>).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const user = (req.session as Record<string, unknown>).user as { id: number; sessionToken?: string } | undefined;
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    if (user.sessionToken) {
      const dbUser = await db.query("SELECT session_token FROM users WHERE id = $1", [user.id]);
      if (dbUser.rows.length > 0 && dbUser.rows[0].session_token !== user.sessionToken) {
        (req.session as Record<string, unknown>).user = null;
        return res.status(401).json({ message: "logged_in_elsewhere" });
      }
    }
    res.json(user);
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    (req.session as Record<string, unknown>).user = null;
    res.json({ success: true });
  });

  app.put("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name } = req.body;
      await db.query("UPDATE users SET name = $1 WHERE id = $2", [name, user.id]);
      (req.session as Record<string, unknown>).user = { ...(user as object), name };
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // ==================== COURSES ROUTES ====================
  app.get("/api/courses", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      const { category, search } = req.query;
      let query = "SELECT * FROM courses WHERE is_published = TRUE";
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
      const courses = result.rows;

      if (user) {
        const enrollResult = await db.query(
          "SELECT course_id, progress_percent FROM enrollments WHERE user_id = $1",
          [user.id]
        );
        const enrollMap: Record<number, number> = {};
        enrollResult.rows.forEach((e: { course_id: number; progress_percent: number }) => {
          enrollMap[e.course_id] = e.progress_percent;
        });
        courses.forEach((c: Record<string, unknown>) => {
          c.isEnrolled = c.id in enrollMap;
          c.progress = enrollMap[c.id as number] || 0;
        });
      }

      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  app.get("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      const course = courseResult.rows[0];
      const lecturesResult = await db.query("SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index", [req.params.id]);
      const testsResult = await db.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE", [req.params.id]);
      const materialsResult = await db.query("SELECT * FROM study_materials WHERE course_id = $1", [req.params.id]);

      if (user) {
        const enroll = await db.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, req.params.id]);
        course.isEnrolled = enroll.rows.length > 0;
        course.progress = enroll.rows[0]?.progress_percent || 0;
        course.lastLectureId = enroll.rows[0]?.last_lecture_id;

        if (course.isEnrolled) {
          const lpResult = await db.query("SELECT * FROM lecture_progress WHERE user_id = $1", [user.id]);
          const lpMap: Record<number, boolean> = {};
          lpResult.rows.forEach((lp: { lecture_id: number; is_completed: boolean }) => {
            lpMap[lp.lecture_id] = lp.is_completed;
          });
          lecturesResult.rows.forEach((l: Record<string, unknown>) => {
            l.isCompleted = lpMap[l.id as number] || false;
          });
        }
      }

      res.json({
        ...course,
        lectures: lecturesResult.rows,
        tests: testsResult.rows,
        materials: materialsResult.rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch course" });
    }
  });

  app.post("/api/courses/:id/enroll", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db.query(
        "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, course_id) DO NOTHING",
        [user.id, req.params.id, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to enroll" });
    }
  });

  app.get("/api/my-courses", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT c.*, e.progress_percent, e.enrolled_at FROM courses c 
         JOIN enrollments e ON c.id = e.course_id 
         WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch enrolled courses" });
    }
  });

  app.post("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { courseId, watchPercent, isCompleted } = req.body;
      await db.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET watch_percent = $3, is_completed = $4, completed_at = $5`,
        [user.id, req.params.id, watchPercent, isCompleted, isCompleted ? Date.now() : null]
      );
      if (courseId && isCompleted) {
        const totalLec = await db.query("SELECT COUNT(*) FROM lectures WHERE course_id = $1", [courseId]);
        const completedLec = await db.query(
          `SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id 
           WHERE lp.user_id = $1 AND l.course_id = $2 AND lp.is_completed = TRUE`,
          [user.id, courseId]
        );
        const total = parseInt(totalLec.rows[0].count);
        const completed = parseInt(completedLec.rows[0].count);
        const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
        await db.query(
          "UPDATE enrollments SET progress_percent = $1, last_lecture_id = $2 WHERE user_id = $3 AND course_id = $4",
          [progress, req.params.id, user.id, courseId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });

  // ==================== TESTS ROUTES ====================
  app.get("/api/tests", async (req: Request, res: Response) => {
    try {
      const { courseId, type } = req.query;
      let query = "SELECT * FROM tests WHERE is_published = TRUE";
      const params: unknown[] = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND course_id = $${params.length}`;
      }
      if (type) {
        params.push(type);
        query += ` AND test_type = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.get("/api/tests/:id", async (req: Request, res: Response) => {
    try {
      const testResult = await db.query("SELECT * FROM tests WHERE id = $1", [req.params.id]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      res.json({ ...testResult.rows[0], questions: questionsResult.rows });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch test" });
    }
  });

  app.post("/api/tests/:id/attempt", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { answers, timeTakenSeconds } = req.body;
      const testResult = await db.query("SELECT * FROM tests WHERE id = $1", [req.params.id]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1", [req.params.id]);
      const questions = questionsResult.rows;

      let score = 0;
      const topicErrors: Record<string, number> = {};
      questions.forEach((q: Record<string, unknown>) => {
        const userAnswer = (answers as Record<string, string>)[q.id as string];
        if (userAnswer === q.correct_option) {
          score += q.marks as number;
        } else if (userAnswer) {
          score -= parseFloat(q.negative_marks as string);
          const topic = q.topic as string || "General";
          topicErrors[topic] = (topicErrors[topic] || 0) + 1;
        }
      });

      const percentage = test.total_marks > 0 ? ((score / test.total_marks) * 100).toFixed(2) : 0;

      const attemptResult = await db.query(
        `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, status, started_at, completed_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9) RETURNING id`,
        [user.id, req.params.id, JSON.stringify(answers), Math.max(0, score), test.total_marks, percentage, timeTakenSeconds, Date.now() - (timeTakenSeconds * 1000), Date.now()]
      );

      const weakTopics = Object.entries(topicErrors)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([topic]) => topic);

      res.json({
        attemptId: attemptResult.rows[0].id,
        score: Math.max(0, score),
        totalMarks: test.total_marks,
        percentage,
        weakTopics,
        passed: score >= test.passing_marks,
        questions: questions.map((q: Record<string, unknown>) => ({
          ...q,
          userAnswer: (answers as Record<string, string>)[q.id as string],
          isCorrect: (answers as Record<string, string>)[q.id as string] === q.correct_option,
        })),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit test" });
    }
  });

  app.get("/api/tests/:id/leaderboard", async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT ta.score, ta.percentage, ta.time_taken_seconds, u.name, u.id as user_id
         FROM test_attempts ta JOIN users u ON ta.user_id = u.id 
         WHERE ta.test_id = $1 AND ta.status = 'completed' 
         ORDER BY ta.score DESC, ta.time_taken_seconds ASC LIMIT 20`,
        [req.params.id]
      );
      const leaderboard = result.rows.map((r: Record<string, unknown>, i: number) => ({ ...r, rank: i + 1 }));
      res.json(leaderboard);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get("/api/my-attempts", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.*, t.title, t.total_marks, t.test_type FROM test_attempts ta 
         JOIN tests t ON ta.test_id = t.id 
         WHERE ta.user_id = $1 AND ta.status = 'completed' ORDER BY ta.completed_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // ==================== DAILY MISSION ROUTES ====================
  app.get("/api/daily-missions", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
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
          mission.isAccessible = mission.mission_type === "free_practice" || (mission.course_id ? enrolledCourseIds.has(mission.course_id) : enrolledCourseIds.size > 0);
        }
      } else {
        for (const mission of result.rows) {
          mission.isAccessible = mission.mission_type === "free_practice";
        }
      }
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch daily missions" });
    }
  });

  app.get("/api/daily-mission", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      const result = await db.query("SELECT * FROM daily_missions WHERE mission_date = CURRENT_DATE AND mission_type = 'daily_drill' LIMIT 1");
      if (result.rows.length === 0) return res.json(null);
      const mission = result.rows[0];
      if (user) {
        const um = await db.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
        mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
        mission.userScore = um.rows[0]?.score || 0;
      }
      res.json(mission);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch daily mission" });
    }
  });

  app.post("/api/daily-mission/:id/complete", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { score } = req.body;
      await db.query(
        `INSERT INTO user_missions (user_id, mission_id, is_completed, score, completed_at) 
         VALUES ($1, $2, TRUE, $3, $4) ON CONFLICT (user_id, mission_id) DO UPDATE SET is_completed = TRUE, score = $3, completed_at = $4`,
        [user.id, req.params.id, score, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to complete mission" });
    }
  });

  // ==================== STUDY MATERIALS ROUTES ====================
  app.get("/api/study-materials", async (req: Request, res: Response) => {
    try {
      const { free } = req.query;
      let query = "SELECT * FROM study_materials";
      const params: unknown[] = [];
      if (free === "true") {
        query += " WHERE is_free = TRUE";
      }
      query += " ORDER BY created_at DESC";
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });

  // ==================== LIVE CLASSES ROUTES ====================
  app.get("/api/live-classes", async (req: Request, res: Response) => {
    try {
      const { courseId } = req.query;
      let query = "SELECT * FROM live_classes WHERE is_completed = FALSE";
      const params: unknown[] = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND (course_id = $${params.length} OR course_id IS NULL)`;
      }
      query += " ORDER BY scheduled_at ASC";
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch live classes" });
    }
  });

  app.delete("/api/admin/live-classes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_classes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete live class" });
    }
  });

  app.delete("/api/admin/study-materials/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM study_materials WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete material" });
    }
  });

  // ==================== DOUBTS ROUTES ====================
  app.post("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { question, topic } = req.body;

      const aiAnswer = await generateAIAnswer(question, topic);
      const result = await db.query(
        "INSERT INTO doubts (user_id, question, answer, topic, status, created_at) VALUES ($1, $2, $3, $4, 'answered', $5) RETURNING *",
        [user.id, question, aiAnswer, topic, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit doubt" });
    }
  });

  app.get("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query("SELECT * FROM doubts WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch doubts" });
    }
  });

  // ==================== NOTIFICATIONS ROUTES ====================
  app.get("/api/notifications", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20",
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });

  app.put("/api/notifications/:id/read", async (req: Request, res: Response) => {
    try {
      await db.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });

  // ==================== ADMIN ROUTES ====================
  function requireAdmin(req: Request, res: Response, next: () => void) {
    const user = (req.session as Record<string, unknown>).user as { role: string } | undefined;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }

  app.post("/api/admin/courses", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType } = req.body;
      const result = await db.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, courseType || "standard", Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create course" });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests } = req.body;
      await db.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests) WHERE id=$12`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update course" });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM courses WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete course" });
    }
  });

  app.post("/api/admin/lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { courseId, title, description, videoUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle } = req.body;
      const result = await db.query(
        `INSERT INTO lectures (course_id, title, description, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [courseId, title, description, videoUrl, videoType || "youtube", pdfUrl, durationMinutes || 0, orderIndex || 0, isFreePreview || false, sectionTitle || null, Date.now()]
      );
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [courseId]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add lecture" });
    }
  });

  app.delete("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const lec = await db.query("SELECT course_id FROM lectures WHERE id = $1", [req.params.id]);
      await db.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
      if (lec.rows.length > 0) {
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [lec.rows[0].course_id]);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete lecture" });
    }
  });

  app.post("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType } = req.body;
      const result = await db.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [title, description, courseId || null, durationMinutes || 60, totalMarks || 100, passingMarks || 35, testType || "practice", Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to create test" });
    }
  });

  app.post("/api/admin/questions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const questions = Array.isArray(req.body) ? req.body : [req.body];
      for (const q of questions) {
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [q.testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, q.explanation, q.topic, q.difficulty || "medium", q.marks || 4, q.negativeMarks || 1, q.orderIndex || 0]
        );
      }
      await db.query(
        "UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1",
        [questions[0].testId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add questions" });
    }
  });

  function parseQuestionsFromText(text: string): Array<{questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; correctOption: string}> {
    const questions: Array<{questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; correctOption: string}> = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let currentQuestion = '';
    let options: string[] = [];
    let correctOption = 'A';

    function pushQuestion() {
      if (currentQuestion && options.length >= 2) {
        questions.push({
          questionText: currentQuestion.replace(/^(Q\d+[\.\)\:]?\s*|\d+[\.\)\:]?\s*)/, '').trim(),
          optionA: options[0]?.replace(/^[Aa][\.\)\:]?\s*/, '').trim() || '',
          optionB: options[1]?.replace(/^[Bb][\.\)\:]?\s*/, '').trim() || '',
          optionC: options[2]?.replace(/^[Cc][\.\)\:]?\s*/, '').trim() || '',
          optionD: options[3]?.replace(/^[Dd][\.\)\:]?\s*/, '').trim() || '',
          correctOption: correctOption,
        });
      }
      currentQuestion = '';
      options = [];
      correctOption = 'A';
    }

    for (const line of lines) {
      if (/^(Q\d+[\.\)\:]?\s|Question\s*\d+[\.\)\:]?\s|\d+[\.\)\:]\s)/i.test(line)) {
        pushQuestion();
        currentQuestion = line;
      } else if (/^[Aa][\.\)\:]\s/.test(line) || /^\(a\)\s/i.test(line)) {
        options[0] = line;
      } else if (/^[Bb][\.\)\:]\s/.test(line) || /^\(b\)\s/i.test(line)) {
        options[1] = line;
      } else if (/^[Cc][\.\)\:]\s/.test(line) || /^\(c\)\s/i.test(line)) {
        options[2] = line;
      } else if (/^[Dd][\.\)\:]\s/.test(line) || /^\(d\)\s/i.test(line)) {
        options[3] = line;
      } else if (/^(Answer|Ans|Correct)[\s\:\.]*[:\s]*(A|B|C|D)/i.test(line)) {
        const match = line.match(/^(?:Answer|Ans|Correct)[\s\:\.]*[:\s]*([A-D])/i);
        if (match) correctOption = match[1].toUpperCase();
      } else if (currentQuestion && options.length === 0) {
        currentQuestion += ' ' + line;
      }
    }
    pushQuestion();

    return questions;
  }

  app.post("/api/admin/questions/bulk-text", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { testId, text, defaultMarks, defaultNegativeMarks } = req.body;
      if (!testId || !text) {
        return res.status(400).json({ message: "testId and text are required" });
      }

      const parsed = parseQuestionsFromText(text);
      if (parsed.length === 0) {
        return res.status(400).json({ message: "No questions could be parsed from the provided text" });
      }

      const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
      let idx = (maxOrderResult.rows[0]?.max_order || 0);
      for (const q of parsed) {
        idx++;
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, difficulty, marks, negative_marks, order_index) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx]
        );
      }

      await db.query(
        "UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1",
        [testId]
      );

      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse and add questions" });
    }
  });

  app.post("/api/admin/questions/bulk-pdf", requireAdmin, upload.single('pdf'), async (req: Request, res: Response) => {
    try {
      const testId = req.body.testId;
      const defaultMarks = parseInt(req.body.defaultMarks) || 4;
      const defaultNegativeMarks = parseFloat(req.body.defaultNegativeMarks) || 1;

      if (!testId || !req.file) {
        return res.status(400).json({ message: "testId and PDF file are required" });
      }

      const pdfData = await pdfParse(req.file.buffer);
      const text = pdfData.text;

      const parsed = parseQuestionsFromText(text);
      if (parsed.length === 0) {
        return res.status(400).json({ 
          message: "No questions could be parsed from the PDF. Make sure questions are numbered (Q1, 1., etc.) with options labeled A, B, C, D.",
          rawTextPreview: text.substring(0, 500)
        });
      }

      const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
      let idx = (maxOrderResult.rows[0]?.max_order || 0);
      for (const q of parsed) {
        idx++;
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, difficulty, marks, negative_marks, order_index) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, "medium", defaultMarks, defaultNegativeMarks, idx]
        );
      }

      await db.query(
        "UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1",
        [testId]
      );

      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse PDF and add questions" });
    }
  });

  app.post("/api/admin/study-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle, downloadAllowed } = req.body;
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description, fileUrl, fileType || "pdf", courseId || null, isFree !== false, sectionTitle || null, downloadAllowed || false, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to add material" });
    }
  });

  app.post("/api/admin/live-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive } = req.body;
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [title, description, courseId || null, youtubeUrl, scheduledAt, isLive || false, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to add live class" });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/notifications/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, title, message, type } = req.body;
      if (userId) {
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, created_at) VALUES ($1, $2, $3, $4, $5)",
          [userId, title, message, type || "info", Date.now()]
        );
      } else {
        const users = await db.query("SELECT id FROM users WHERE role = 'student'");
        for (const user of users.rows) {
          await db.query(
            "INSERT INTO notifications (user_id, title, message, type, created_at) VALUES ($1, $2, $3, $4, $5)",
            [user.id, title, message, type || "info", Date.now()]
          );
        }
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  app.delete("/api/admin/questions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const q = await db.query("SELECT test_id FROM questions WHERE id = $1", [req.params.id]);
      await db.query("DELETE FROM questions WHERE id = $1", [req.params.id]);
      if (q.rows.length > 0) {
        await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [q.rows[0].test_id]);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete question" });
    }
  });

  app.delete("/api/admin/tests/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete test" });
    }
  });

  app.post("/api/admin/daily-missions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId } = req.body;
      if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Title and questions are required" });
      }
      const result = await db.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [title, description || "", JSON.stringify(questions), missionDate || new Date().toISOString().split("T")[0], xpReward || 50, missionType || "daily_drill", courseId || null]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create daily mission" });
    }
  });

  app.delete("/api/admin/daily-missions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM daily_missions WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete mission" });
    }
  });

  app.get("/api/admin/daily-missions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM daily_missions ORDER BY mission_date DESC LIMIT 50");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch missions" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function generateAIAnswer(question: string, topic?: string): Promise<string> {
  const topicContext = topic ? `Topic: ${topic}. ` : "";
  const answers: Record<string, string> = {
    default: `${topicContext}Great question! Here's a step-by-step explanation:\n\n1. First, identify what's being asked\n2. Apply the relevant mathematical concepts\n3. Work through the solution systematically\n\nFor "${question.slice(0, 50)}...", the key is to understand the underlying mathematical principles. Practice similar problems to strengthen your understanding. If you need more clarity, try revisiting the concept notes or watching the related lecture video.`,
  };

  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("quadratic")) {
    return `For quadratic equations of the form ax² + bx + c = 0:\n\n**Methods to solve:**\n1. **Factorisation**: Split the middle term\n2. **Quadratic Formula**: x = (-b ± √(b²-4ac)) / 2a\n3. **Completing the Square**\n\n**Discriminant (b²-4ac):**\n• If D > 0: Two distinct real roots\n• If D = 0: Two equal real roots\n• If D < 0: No real roots\n\nPractice Tip: Always verify your roots by substituting back into the original equation!`;
  }
  if (lowerQ.includes("trigon")) {
    return `**Trigonometry Key Formulas:**\n\nBasic Ratios:\n• sin θ = Perpendicular/Hypotenuse\n• cos θ = Base/Hypotenuse\n• tan θ = Perpendicular/Base\n\n**Standard Values:**\n| Angle | sin | cos | tan |\n|-------|-----|-----|-----|\n| 0° | 0 | 1 | 0 |\n| 30° | 1/2 | √3/2 | 1/√3 |\n| 45° | 1/√2 | 1/√2 | 1 |\n| 60° | √3/2 | 1/2 | √3 |\n| 90° | 1 | 0 | ∞ |\n\n**Identity:** sin²θ + cos²θ = 1`;
  }
  if (lowerQ.includes("calculus") || lowerQ.includes("derivative") || lowerQ.includes("integral")) {
    return `**Calculus Fundamentals:**\n\n**Derivatives:**\n• d/dx (xⁿ) = nxⁿ⁻¹\n• d/dx (sin x) = cos x\n• d/dx (cos x) = -sin x\n• d/dx (eˣ) = eˣ\n\n**Integration:**\n• ∫xⁿ dx = xⁿ⁺¹/(n+1) + C\n• ∫sin x dx = -cos x + C\n• ∫cos x dx = sin x + C\n\nRemember: Integration is the reverse of differentiation!`;
  }

  return answers.default;
}
