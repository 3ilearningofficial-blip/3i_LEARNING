// server/index.ts
import express from "express";
import session from "express-session";

// server/routes.ts
import { createServer } from "node:http";
import { Pool } from "pg";
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = {
  query: (text, params) => pool.query(text, params)
};
function generateOTP() {
  return Math.floor(1e5 + Math.random() * 9e5).toString();
}
var ADMIN_EMAILS = ["admin@3ilearning.com"];
var ADMIN_PHONES = ["9999999999"];
async function registerRoutes(app2) {
  app2.post("/api/auth/send-otp", async (req, res) => {
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }
      const otp = generateOTP();
      const expires = Date.now() + 10 * 60 * 1e3;
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
  app2.post("/api/auth/verify-otp", async (req, res) => {
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
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1 WHERE id = $2", [deviceId || null, user.id]);
      const sessionUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        deviceId
      };
      req.session.user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });
  app2.get("/api/auth/me", async (req, res) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ message: "Not authenticated" });
    res.json(user);
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.user = null;
    res.json({ success: true });
  });
  app2.put("/api/auth/profile", async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name } = req.body;
      await db.query("UPDATE users SET name = $1 WHERE id = $2", [name, user.id]);
      req.session.user = { ...user, name };
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });
  app2.get("/api/courses", async (req, res) => {
    try {
      const user = req.session.user;
      const { category, search } = req.query;
      let query = "SELECT * FROM courses WHERE is_published = TRUE";
      const params = [];
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
        const enrollMap = {};
        enrollResult.rows.forEach((e) => {
          enrollMap[e.course_id] = e.progress_percent;
        });
        courses.forEach((c) => {
          c.isEnrolled = c.id in enrollMap;
          c.progress = enrollMap[c.id] || 0;
        });
      }
      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });
  app2.get("/api/courses/:id", async (req, res) => {
    try {
      const user = req.session.user;
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
          const lpMap = {};
          lpResult.rows.forEach((lp) => {
            lpMap[lp.lecture_id] = lp.is_completed;
          });
          lecturesResult.rows.forEach((l) => {
            l.isCompleted = lpMap[l.id] || false;
          });
        }
      }
      res.json({
        ...course,
        lectures: lecturesResult.rows,
        tests: testsResult.rows,
        materials: materialsResult.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch course" });
    }
  });
  app2.post("/api/courses/:id/enroll", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.get("/api/my-courses", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.post("/api/lectures/:id/progress", async (req, res) => {
    try {
      const user = req.session.user;
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
        const progress = total > 0 ? Math.round(completed / total * 100) : 0;
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
  app2.get("/api/tests", async (req, res) => {
    try {
      const { courseId, type } = req.query;
      let query = "SELECT * FROM tests WHERE is_published = TRUE";
      const params = [];
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
  app2.get("/api/tests/:id", async (req, res) => {
    try {
      const testResult = await db.query("SELECT * FROM tests WHERE id = $1", [req.params.id]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      res.json({ ...testResult.rows[0], questions: questionsResult.rows });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch test" });
    }
  });
  app2.post("/api/tests/:id/attempt", async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { answers, timeTakenSeconds } = req.body;
      const testResult = await db.query("SELECT * FROM tests WHERE id = $1", [req.params.id]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1", [req.params.id]);
      const questions = questionsResult.rows;
      let score = 0;
      const topicErrors = {};
      questions.forEach((q) => {
        const userAnswer = answers[q.id];
        if (userAnswer === q.correct_option) {
          score += q.marks;
        } else if (userAnswer) {
          score -= parseFloat(q.negative_marks);
          const topic = q.topic || "General";
          topicErrors[topic] = (topicErrors[topic] || 0) + 1;
        }
      });
      const percentage = test.total_marks > 0 ? (score / test.total_marks * 100).toFixed(2) : 0;
      const attemptResult = await db.query(
        `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, status, started_at, completed_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9) RETURNING id`,
        [user.id, req.params.id, JSON.stringify(answers), Math.max(0, score), test.total_marks, percentage, timeTakenSeconds, Date.now() - timeTakenSeconds * 1e3, Date.now()]
      );
      const weakTopics = Object.entries(topicErrors).sort(([, a], [, b]) => b - a).slice(0, 3).map(([topic]) => topic);
      res.json({
        attemptId: attemptResult.rows[0].id,
        score: Math.max(0, score),
        totalMarks: test.total_marks,
        percentage,
        weakTopics,
        passed: score >= test.passing_marks,
        questions: questions.map((q) => ({
          ...q,
          userAnswer: answers[q.id],
          isCorrect: answers[q.id] === q.correct_option
        }))
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit test" });
    }
  });
  app2.get("/api/tests/:id/leaderboard", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT ta.score, ta.percentage, ta.time_taken_seconds, u.name, u.id as user_id
         FROM test_attempts ta JOIN users u ON ta.user_id = u.id 
         WHERE ta.test_id = $1 AND ta.status = 'completed' 
         ORDER BY ta.score DESC, ta.time_taken_seconds ASC LIMIT 20`,
        [req.params.id]
      );
      const leaderboard = result.rows.map((r, i) => ({ ...r, rank: i + 1 }));
      res.json(leaderboard);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });
  app2.get("/api/my-attempts", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.get("/api/daily-mission", async (req, res) => {
    try {
      const user = req.session.user;
      const result = await db.query("SELECT * FROM daily_missions WHERE mission_date = CURRENT_DATE LIMIT 1");
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
  app2.post("/api/daily-mission/:id/complete", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.get("/api/study-materials", async (req, res) => {
    try {
      const { free } = req.query;
      let query = "SELECT * FROM study_materials";
      const params = [];
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
  app2.get("/api/live-classes", async (req, res) => {
    try {
      const { courseId } = req.query;
      let query = "SELECT * FROM live_classes WHERE is_completed = FALSE";
      const params = [];
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
  app2.delete("/api/admin/live-classes/:id", requireAdmin, async (req, res) => {
    try {
      await db.query("DELETE FROM live_classes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete live class" });
    }
  });
  app2.delete("/api/admin/study-materials/:id", requireAdmin, async (req, res) => {
    try {
      await db.query("DELETE FROM study_materials WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete material" });
    }
  });
  app2.post("/api/doubts", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.get("/api/doubts", async (req, res) => {
    try {
      const user = req.session.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query("SELECT * FROM doubts WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch doubts" });
    }
  });
  app2.get("/api/notifications", async (req, res) => {
    try {
      const user = req.session.user;
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
  app2.put("/api/notifications/:id/read", async (req, res) => {
    try {
      await db.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
  function requireAdmin(req, res, next) {
    const user = req.session.user;
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  }
  app2.post("/api/admin/courses", requireAdmin, async (req, res) => {
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
  app2.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
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
  app2.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
    try {
      await db.query("DELETE FROM courses WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete course" });
    }
  });
  app2.post("/api/admin/lectures", requireAdmin, async (req, res) => {
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
  app2.delete("/api/admin/lectures/:id", requireAdmin, async (req, res) => {
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
  app2.post("/api/admin/tests", requireAdmin, async (req, res) => {
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
  app2.post("/api/admin/questions", requireAdmin, async (req, res) => {
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
  app2.post("/api/admin/study-materials", requireAdmin, async (req, res) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle } = req.body;
      const result = await db.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [title, description, fileUrl, fileType || "pdf", courseId || null, isFree !== false, sectionTitle || null, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to add material" });
    }
  });
  app2.post("/api/admin/live-classes", requireAdmin, async (req, res) => {
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
  app2.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const result = await db.query("SELECT id, name, email, phone, role, created_at FROM users ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  app2.post("/api/admin/notifications/send", requireAdmin, async (req, res) => {
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
  app2.delete("/api/admin/questions/:id", requireAdmin, async (req, res) => {
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
  app2.delete("/api/admin/tests/:id", requireAdmin, async (req, res) => {
    try {
      await db.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete test" });
    }
  });
  const httpServer = createServer(app2);
  return httpServer;
}
async function generateAIAnswer(question, topic) {
  const topicContext = topic ? `Topic: ${topic}. ` : "";
  const answers = {
    default: `${topicContext}Great question! Here's a step-by-step explanation:

1. First, identify what's being asked
2. Apply the relevant mathematical concepts
3. Work through the solution systematically

For "${question.slice(0, 50)}...", the key is to understand the underlying mathematical principles. Practice similar problems to strengthen your understanding. If you need more clarity, try revisiting the concept notes or watching the related lecture video.`
  };
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("quadratic")) {
    return `For quadratic equations of the form ax\xB2 + bx + c = 0:

**Methods to solve:**
1. **Factorisation**: Split the middle term
2. **Quadratic Formula**: x = (-b \xB1 \u221A(b\xB2-4ac)) / 2a
3. **Completing the Square**

**Discriminant (b\xB2-4ac):**
\u2022 If D > 0: Two distinct real roots
\u2022 If D = 0: Two equal real roots
\u2022 If D < 0: No real roots

Practice Tip: Always verify your roots by substituting back into the original equation!`;
  }
  if (lowerQ.includes("trigon")) {
    return `**Trigonometry Key Formulas:**

Basic Ratios:
\u2022 sin \u03B8 = Perpendicular/Hypotenuse
\u2022 cos \u03B8 = Base/Hypotenuse
\u2022 tan \u03B8 = Perpendicular/Base

**Standard Values:**
| Angle | sin | cos | tan |
|-------|-----|-----|-----|
| 0\xB0 | 0 | 1 | 0 |
| 30\xB0 | 1/2 | \u221A3/2 | 1/\u221A3 |
| 45\xB0 | 1/\u221A2 | 1/\u221A2 | 1 |
| 60\xB0 | \u221A3/2 | 1/2 | \u221A3 |
| 90\xB0 | 1 | 0 | \u221E |

**Identity:** sin\xB2\u03B8 + cos\xB2\u03B8 = 1`;
  }
  if (lowerQ.includes("calculus") || lowerQ.includes("derivative") || lowerQ.includes("integral")) {
    return `**Calculus Fundamentals:**

**Derivatives:**
\u2022 d/dx (x\u207F) = nx\u207F\u207B\xB9
\u2022 d/dx (sin x) = cos x
\u2022 d/dx (cos x) = -sin x
\u2022 d/dx (e\u02E3) = e\u02E3

**Integration:**
\u2022 \u222Bx\u207F dx = x\u207F\u207A\xB9/(n+1) + C
\u2022 \u222Bsin x dx = -cos x + C
\u2022 \u222Bcos x dx = sin x + C

Remember: Integration is the reverse of differentiation!`;
  }
  return answers.default;
}

// server/index.ts
import * as fs from "fs";
import * as path from "path";
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path2 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path2.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path2} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path !== "/" && req.path !== "/manifest") {
      return next();
    }
    const platform = req.header("expo-platform");
    if (platform && (platform === "ios" || platform === "android")) {
      return serveExpoManifest(platform, res);
    }
    if (req.path === "/") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    next();
  });
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  const isProduction = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);
  app.use(
    session({
      secret: process.env.SESSION_SECRET || "3ilearning-secret-2024",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: isProduction,
        httpOnly: true,
        maxAge: 30 * 24 * 60 * 60 * 1e3,
        sameSite: isProduction ? "none" : "lax"
      }
    })
  );
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
    }
  );
})();
