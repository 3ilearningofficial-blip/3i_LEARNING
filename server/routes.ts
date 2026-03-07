import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { verifyFirebaseToken } from "./firebase";
import { getRazorpay, verifyPaymentSignature } from "./razorpay";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const db = {
  query: (text: string, params?: unknown[]) => pool.query(text, params),
};

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendFirebasePhoneVerification(phone: string): Promise<{ sessionInfo: string } | null> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("[Firebase Phone] No FIREBASE_API_KEY set");
    return null;
  }
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: `+91${phone}`,
          recaptchaToken: "FIREBASE_ADMIN_BYPASS",
        }),
      }
    );
    const data = await res.json();
    if (data.sessionInfo) {
      console.log(`[Firebase Phone] Verification sent to ${phone}`);
      return { sessionInfo: data.sessionInfo };
    }
    console.error("[Firebase Phone] Failed:", JSON.stringify(data.error || data));
    return null;
  } catch (err) {
    console.error("[Firebase Phone] Error:", err);
    return null;
  }
}

async function verifyFirebasePhoneCode(sessionInfo: string, code: string): Promise<{ idToken: string; phoneNumber: string } | null> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionInfo, code }),
      }
    );
    const data = await res.json();
    if (data.idToken) {
      return { idToken: data.idToken, phoneNumber: data.phoneNumber || "" };
    }
    console.error("[Firebase Phone] Verify failed:", JSON.stringify(data.error || data));
    return null;
  } catch (err) {
    console.error("[Firebase Phone] Verify error:", err);
    return null;
  }
}

async function sendOTPviaSMS(phone: string, otp: string): Promise<boolean> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.log(`[SMS] No FAST2SMS_API_KEY set — OTP for ${phone}: ${otp}`);
    return false;
  }
  try {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "q",
        message: `Your 3i Learning verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
        numbers: phone,
        flash: "0",
      }),
    });
    const data = await res.json();
    if (data.return) {
      console.log(`[SMS] OTP sent to ${phone}`);
      return true;
    } else {
      console.error(`[SMS] Failed:`, data.message);
      return false;
    }
  } catch (err) {
    console.error(`[SMS] Error sending to ${phone}:`, err);
    return false;
  }
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

      if (type === "phone") {
        const existing = await db.query("SELECT id FROM users WHERE phone = $1", [identifier]);
        if (existing.rows.length === 0) {
          await db.query(
            "INSERT INTO users (name, phone, role) VALUES ($1, $2, $3)",
            [`Student${identifier.slice(-4)}`, identifier, ADMIN_PHONES.includes(identifier) ? "admin" : "student"]
          );
        }

        const otp = generateOTP();
        const expires = Date.now() + 10 * 60 * 1000;
        await db.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE phone = $3", [otp, expires, identifier]);
        console.log(`[OTP] Generated for ${identifier}: ${otp}`);

        let smsSent = false;
        smsSent = await sendOTPviaSMS(identifier, otp);
        if (!smsSent) {
          console.log(`[OTP] SMS delivery failed for ${identifier}, OTP stored in DB: ${otp}`);
        }

        const response: any = { success: true, message: "OTP sent to your phone", smsSent };
        if (!smsSent) {
          response.devOtp = otp;
        }
        return res.json(response);
      }

      const otp = generateOTP();
      const expires = Date.now() + 10 * 60 * 1000;
      const existing = await db.query("SELECT id FROM users WHERE email = $1", [identifier]);
      if (existing.rows.length === 0) {
        await db.query(
          "INSERT INTO users (name, email, otp, otp_expires_at, role) VALUES ($1, $2, $3, $4, $5)",
          [identifier.split("@")[0], identifier, otp, expires, ADMIN_EMAILS.includes(identifier) ? "admin" : "student"]
        );
      } else {
        await db.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE email = $3", [otp, expires, identifier]);
      }
      res.json({ success: true, message: "OTP sent successfully", method: "server" });
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
      if (Date.now() > Number(user.otp_expires_at)) return res.status(400).json({ message: "OTP expired" });

      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, user.id]);

      const sessionUser = {
        id: user.id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        deviceId, sessionToken,
      };
      (req.session as Record<string, unknown>).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.post("/api/auth/verify-firebase", async (req: Request, res: Response) => {
    try {
      const { idToken, phone: phoneNumber, deviceId } = req.body;
      if (!idToken || !phoneNumber) {
        return res.status(400).json({ message: "ID token and phone are required" });
      }

      const decoded = await verifyFirebaseToken(idToken);
      if (!decoded.phone_number || !decoded.phone_number.endsWith(phoneNumber)) {
        return res.status(400).json({ message: "Phone number mismatch" });
      }

      let result = await db.query("SELECT * FROM users WHERE phone = $1", [phoneNumber]);
      if (result.rows.length === 0) {
        await db.query(
          "INSERT INTO users (name, phone, role) VALUES ($1, $2, $3)",
          [`Student${phoneNumber.slice(-4)}`, phoneNumber, ADMIN_PHONES.includes(phoneNumber) ? "admin" : "student"]
        );
        result = await db.query("SELECT * FROM users WHERE phone = $1", [phoneNumber]);
      }

      const user = result.rows[0];
      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, user.id]);

      const sessionUser = {
        id: user.id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        deviceId, sessionToken,
      };
      (req.session as Record<string, unknown>).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Firebase verify error:", err);
      res.status(400).json({ message: "Firebase verification failed" });
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

  app.post("/api/auth/firebase-login", async (req: Request, res: Response) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) return res.status(400).json({ message: "Firebase ID token is required" });

      const decoded = await verifyFirebaseToken(idToken);
      const phoneNumber = decoded.phone_number;
      if (!phoneNumber) return res.status(400).json({ message: "Phone number not found in token" });

      const phone = phoneNumber.replace(/^\+91/, "");

      let result = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
      if (result.rows.length === 0) {
        const role = ADMIN_PHONES.includes(phone) ? "admin" : "student";
        result = await db.query(
          "INSERT INTO users (name, phone, role, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [`Student${phone.slice(-4)}`, phone, role, Date.now()]
        );
      }

      const user = result.rows[0];
      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, user.id]);

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
    } catch (err: any) {
      console.error("Firebase login error:", err);
      if (err.code === "auth/id-token-expired") {
        return res.status(401).json({ message: "Token expired, please try again" });
      }
      res.status(500).json({ message: "Authentication failed" });
    }
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

  // ==================== PAYMENT ROUTES ====================
  app.post("/api/payments/create-order", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { courseId } = req.body;
      if (!courseId) return res.status(400).json({ message: "Course ID is required" });

      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [courseId]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      const course = courseResult.rows[0];
      if (course.is_free) return res.status(400).json({ message: "This course is free, no payment needed" });

      const existingEnrollment = await db.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, courseId]);
      if (existingEnrollment.rows.length > 0) return res.status(400).json({ message: "Already enrolled" });

      const amount = Math.round(parseFloat(course.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `course_${courseId}_user_${user.id}_${Date.now()}`,
        notes: { courseId: courseId.toString(), userId: user.id.toString(), courseTitle: course.title },
      });

      await db.query(
        "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [user.id, courseId, order.id, course.price, "created", Date.now()]
      );

      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        courseName: course.title,
        courseId,
      });
    } catch (err) {
      console.error("Create order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  app.post("/api/payments/verify", async (req: Request, res: Response) => {
    try {
      const user = (req.session as Record<string, unknown>).user as { id: number } | undefined;
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }

      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });

      const paymentRecord = await db.query(
        "SELECT * FROM payments WHERE razorpay_order_id = $1 AND user_id = $2",
        [razorpay_order_id, user.id]
      );
      if (paymentRecord.rows.length === 0) return res.status(400).json({ message: "Payment order not found" });
      if (paymentRecord.rows[0].status === "paid") return res.status(400).json({ message: "Payment already processed" });

      const paymentCourseId = paymentRecord.rows[0].course_id;
      if (courseId && paymentCourseId !== courseId) return res.status(400).json({ message: "Course mismatch" });

      await db.query(
        "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4 AND user_id = $5",
        [razorpay_payment_id, razorpay_signature, "paid", razorpay_order_id, user.id]
      );

      await db.query(
        "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, course_id) DO NOTHING",
        [user.id, paymentCourseId, Date.now()]
      );

      await db.query(
        "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
        [paymentCourseId]
      );

      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      res.status(500).json({ message: "Payment verification failed" });
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

  app.get("/api/study-materials/:id", async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM study_materials WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Material not found" });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch material" });
    }
  });

  // ==================== LIVE CLASSES ROUTES ====================
  app.get("/api/live-classes", async (req: Request, res: Response) => {
    try {
      const { courseId, admin } = req.query;
      let query = admin === "true" ? "SELECT * FROM live_classes WHERE 1=1" : "SELECT * FROM live_classes WHERE is_completed = FALSE";
      const params: unknown[] = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND (course_id = $${params.length} OR course_id IS NULL)`;
      }
      query += " ORDER BY scheduled_at DESC";
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch live classes" });
    }
  });

  app.put("/api/admin/live-classes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];
      if (isLive !== undefined) { params.push(isLive); updates.push(`is_live = $${params.length}`); }
      if (isCompleted !== undefined) { params.push(isCompleted); updates.push(`is_completed = $${params.length}`); }
      if (youtubeUrl !== undefined) { params.push(youtubeUrl); updates.push(`youtube_url = $${params.length}`); }
      if (title !== undefined) { params.push(title); updates.push(`title = $${params.length}`); }
      if (description !== undefined) { params.push(description); updates.push(`description = $${params.length}`); }
      if (updates.length === 0) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const result = await db.query(`UPDATE live_classes SET ${updates.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
      const liveClass = result.rows[0];

      if (isCompleted && convertToLecture && liveClass.youtube_url && liveClass.course_id) {
        const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [liveClass.course_id]);
        await db.query(
          `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [liveClass.course_id, liveClass.title, liveClass.description || "", liveClass.youtube_url, "youtube", 0, maxOrder.rows[0].next_order, false, sectionTitle || "Live Class Recordings", Date.now()]
        );
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [liveClass.course_id]);
      }

      res.json(liveClass);
    } catch (err) {
      console.error("Update live class error:", err);
      res.status(500).json({ message: "Failed to update live class" });
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
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, startDate, endDate } = req.body;
      const result = await db.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, start_date, end_date, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, courseType || "live", subject || "", startDate || null, endDate || null, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create course" });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate } = req.body;
      await db.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), course_type=COALESCE($13, course_type), start_date=COALESCE($14, start_date), end_date=COALESCE($15, end_date) WHERE id=$16`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update course" });
    }
  });

  app.post("/api/admin/courses/:id/import-lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = req.params.id;
      const { lectureIds, sectionTitle } = req.body;
      if (!lectureIds || !Array.isArray(lectureIds) || lectureIds.length === 0) {
        return res.status(400).json({ message: "No lectures selected" });
      }
      const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [targetCourseId]);
      let orderIndex = maxOrder.rows[0].next_order;
      for (const lecId of lectureIds) {
        const lec = await db.query("SELECT * FROM lectures WHERE id = $1", [lecId]);
        if (lec.rows.length > 0) {
          const l = lec.rows[0];
          await db.query(
            `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [targetCourseId, l.title, l.description || "", l.video_url, l.video_type || "youtube", l.duration_minutes || 0, orderIndex++, false, sectionTitle || l.section_title || null, Date.now()]
          );
        }
      }
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [targetCourseId]);
      res.json({ success: true, imported: lectureIds.length });
    } catch (err) {
      console.error("Import lectures error:", err);
      res.status(500).json({ message: "Failed to import lectures" });
    }
  });

  app.post("/api/admin/courses/:id/import-tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = req.params.id;
      const { testIds } = req.body;
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }
      for (const testId of testIds) {
        const test = await db.query("SELECT * FROM tests WHERE id = $1", [testId]);
        if (test.rows.length > 0) {
          const t = test.rows[0];
          const newTest = await db.query(
            `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, total_questions, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [t.title, t.description, targetCourseId, t.duration_minutes, t.total_marks, t.passing_marks, t.test_type, t.total_questions || 0, Date.now()]
          );
          const questions = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [testId]);
          for (const q of questions.rows) {
            await db.query(
              `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [newTest.rows[0].id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation, q.topic, q.difficulty, q.marks, q.negative_marks, q.order_index]
            );
          }
        }
      }
      await db.query("UPDATE courses SET total_tests = (SELECT COUNT(*) FROM tests WHERE course_id = $1) WHERE id = $1", [targetCourseId]);
      res.json({ success: true, imported: testIds.length });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });

  app.get("/api/admin/all-lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT l.*, c.title as course_title, c.course_type 
        FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        ORDER BY c.title, l.order_index
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lectures" });
    }
  });

  app.get("/api/admin/all-tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT t.*, c.title as course_title, c.course_type 
        FROM tests t 
        JOIN courses c ON t.course_id = c.id 
        ORDER BY c.title, t.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = req.params.id;
      await db.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM courses WHERE id = $1", [courseId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
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

  app.get("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT t.*, c.title as course_title 
        FROM tests t 
        LEFT JOIN courses c ON t.course_id = c.id 
        ORDER BY t.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch tests" });
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
        [title, description, fileUrl, fileType || "pdf", courseId || null, courseId ? false : (isFree !== false), sectionTitle || null, downloadAllowed || false, Date.now()]
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
      await db.query("DELETE FROM test_attempts WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM questions WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete test error:", err);
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
