import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { verifyFirebaseToken } from "./firebase";
import { getRazorpay, verifyPaymentSignature } from "./razorpay";
import { generateSecureToken, hashOtpValue, verifyOtpValue } from "./security-utils";
import { getAuthUserFromRequest } from "./auth-utils";
import { registerAuthRoutes } from "./auth-routes";
import { registerPdfRoutes } from "./pdf-routes";
import { registerPaymentRoutes } from "./payment-routes";
import { registerSupportRoutes } from "./support-routes";
import { registerLiveChatRoutes } from "./live-chat-routes";
import { registerLiveClassEngagementRoutes } from "./live-class-engagement-routes";
import { registerLiveStreamRoutes } from "./live-stream-routes";
import { registerSiteSettingsRoutes } from "./site-settings-routes";
import { registerAdminCourseImportRoutes } from "./admin-course-import-routes";
import { registerAdminCourseManagementRoutes } from "./admin-course-management-routes";
import { registerAdminAnalyticsRoutes } from "./admin-analytics-routes";
import { registerAdminEnrollmentRoutes } from "./admin-enrollment-routes";
import { registerAdminLectureRoutes } from "./admin-lecture-routes";
import { registerAdminTestRoutes } from "./admin-test-routes";
import { registerAdminQuestionBulkRoutes } from "./admin-question-bulk-routes";
import { registerAdminUsersAndContentRoutes } from "./admin-users-and-content-routes";
import { registerAdminTestManagementRoutes } from "./admin-test-management-routes";
import { registerAdminDailyMissionRoutes } from "./admin-daily-mission-routes";
import { registerAdminNotificationRoutes } from "./admin-notification-routes";
import { registerAdminCourseCrudRoutes } from "./admin-course-crud-routes";
import { registerBookRoutes } from "./book-routes";
import { registerStandaloneFolderRoutes } from "./standalone-folder-routes";
import { registerDoubtNotificationRoutes } from "./doubt-notification-routes";
import { registerStudentMissionMaterialRoutes } from "./student-mission-material-routes";
import { registerLectureRoutes } from "./lecture-routes";
import { registerTestFolderRoutes } from "./test-folder-routes";
import { registerTestCoreRoutes } from "./test-core-routes";
import { registerTestAttemptRoutes } from "./test-attempt-routes";
import { registerLiveClassRoutes } from "./live-class-routes";
import { registerAdminLiveClassManageRoutes } from "./admin-live-class-manage-routes";
import { registerCourseAccessRoutes } from "./course-access-routes";
import { registerUploadRoutes } from "./upload-routes";
import { registerMediaStreamRoutes } from "./media-stream-routes";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Larger pool for 1000 concurrent users
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 10,
  min: 1,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 10000,   // release idle connections quickly (Neon closes them anyway)
  statement_timeout: 25000,
});

// Prevent unhandled 'error' event from crashing the process
// Neon serverless drops idle connections — this is expected
pool.on("error", (err) => {
  console.error("[Pool] Idle client error (connection dropped by Neon):", err.message);
});

// Retry wrapper for transient connection errors
async function dbQuery(text: string, params?: unknown[]): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await pool.query(text, params);
    } catch (err: any) {
      const isTransient = err.message?.includes("Connection terminated") ||
        err.message?.includes("connection timeout") ||
        err.code === "ECONNRESET" ||
        err.code === "ECONNREFUSED";
      if (isTransient && attempt < 3) {
        console.warn("[DB] Transient error on attempt " + attempt + ", retrying...");
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
      throw err;
    }
  }
}

const db = {
  query: (text: string, params?: unknown[]) => dbQuery(text, params),
};

// ==================== IN-MEMORY CACHE ====================
interface CacheEntry { data: unknown; expiresAt: number; }
const cache = new Map<string, CacheEntry>();
function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data as T;
}
function cacheSet(key: string, data: unknown, ttlMs: number) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}
function cacheInvalidate(pattern: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) cache.delete(key);
  }
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, 5 * 60 * 1000);

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Resolve authenticated user from session OR Bearer token
async function getAuthUser(req: Request): Promise<{ id: number; name: string; email?: string; phone?: string; role: string; sessionToken?: string; profileComplete?: boolean } | null> {
  return getAuthUserFromRequest(req, db);
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
    console.log(`[SMS] No FAST2SMS_API_KEY set for ${phone}`);
    return false;
  }

  try {
    console.log(`[SMS] Sending OTP via Quick SMS route to ${phone}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "q",
        message: `Your 3i Learning verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
        numbers: phone,
        flash: "0",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    console.log(`[SMS] Quick SMS response:`, JSON.stringify(data));
    if (data.return === true) {
      console.log(`[SMS] OTP sent successfully to ${phone}`);
      return true;
    }
    console.error(`[SMS] Quick SMS failed:`, data.message || JSON.stringify(data));
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(`[SMS] Quick SMS timeout for ${phone}`);
    } else {
      console.error(`[SMS] Quick SMS error:`, err);
    }
  }

  try {
    console.log(`[SMS] Trying OTP route as fallback for ${phone}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(phone)}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    console.log(`[SMS] OTP route response:`, JSON.stringify(data));
    if (data.return === true) {
      console.log(`[SMS] OTP route sent successfully to ${phone}`);
      return true;
    }
    console.error(`[SMS] OTP route failed:`, data.message || JSON.stringify(data));
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error(`[SMS] OTP route timeout for ${phone}`);
    } else {
      console.error(`[SMS] OTP route error:`, err);
    }
  }

  return false;
}

const ADMIN_EMAILS = ["3ilearningofficial@gmail.com"];
const ADMIN_PHONES = ["9997198068"];

// Recompute and persist all test-type counts for a course
async function updateCourseTestCounts(courseId: number | string) {
  const id = String(courseId);
  await db.query(`
    UPDATE courses SET
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'pyq'),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'mock'),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'practice')
    WHERE id = $1
  `, [id]);
}

// Recompute course progress for a user based on ALL content: lectures + tests + live class recordings
async function updateCourseProgress(userId: number, courseId: number | string) {
  const cid = String(courseId);
  try {
    // Count total items
    const totalLec = await db.query("SELECT COUNT(*) FROM lectures WHERE course_id = $1", [cid]);
    const totalTests = await db.query("SELECT COUNT(*) FROM tests WHERE course_id = $1 AND is_published = TRUE", [cid]);
    const totalLive = await db.query("SELECT COUNT(*) FROM live_classes WHERE course_id = $1 AND is_completed = TRUE", [cid]);

    // Count completed items by user
    const completedLec = await db.query(
      `SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id 
       WHERE lp.user_id = $1 AND l.course_id = $2 AND lp.is_completed = TRUE`,
      [userId, cid]
    );
    const completedTests = await db.query(
      `SELECT COUNT(DISTINCT test_id) FROM test_attempts 
       WHERE user_id = $1 AND test_id IN (SELECT id FROM tests WHERE course_id = $2) AND status = 'completed'`,
      [userId, cid]
    );
    // Live class recordings count as "watched" if user has lecture_progress for the converted lecture
    // (live classes become lectures when recording is saved, so they're already counted in lectures)

    const total = parseInt(totalLec.rows[0].count) + parseInt(totalTests.rows[0].count);
    const completed = parseInt(completedLec.rows[0].count) + parseInt(completedTests.rows[0].count);
    const progress = total > 0 ? Math.round((completed / total) * 100) : 0;

    await db.query(
      "UPDATE enrollments SET progress_percent = $1 WHERE user_id = $2 AND course_id = $3",
      [progress, userId, cid]
    );
  } catch (err) {
    console.error("[Progress] Failed to update:", err);
  }
}

// Delete downloads for a user (optionally filtered by course)
async function deleteDownloadsForUser(userId: number, courseId?: number): Promise<void> {
  try {
    if (courseId) {
      // Delete downloads for specific course
      await db.query(
        `DELETE FROM user_downloads 
         WHERE user_id = $1 
         AND (
           (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $2))
           OR
           (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $2))
         )`,
        [userId, courseId]
      );
      console.log(`[Cleanup] Deleted downloads for user ${userId} in course ${courseId}`);
    } else {
      // Delete all downloads for user
      await db.query("DELETE FROM user_downloads WHERE user_id = $1", [userId]);
      console.log(`[Cleanup] Deleted all downloads for user ${userId}`);
    }
  } catch (err) {
    console.error("[Cleanup] Failed to delete downloads:", err);
  }
}

// Delete downloads for a course (all users)
async function deleteDownloadsForCourse(courseId: number): Promise<void> {
  try {
    await db.query(
      `DELETE FROM user_downloads 
       WHERE (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $1))
       OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $1))`,
      [courseId]
    );
    console.log(`[Cleanup] Deleted all downloads for course ${courseId}`);
  } catch (err) {
    console.error("[Cleanup] Failed to delete course downloads:", err);
  }
}

async function generateAIAnswer(question: string, topic?: string): Promise<string> {
  const topicContext = topic ? `Topic: ${topic}. ` : "";
  const answers: Record<string, string> = {
    default: `${topicContext}Great question! Here's a step-by-step explanation:\n\n1. First, identify what's being asked\n2. Apply the relevant mathematical concepts\n3. Work through the solution systematically\n\nFor "${question.slice(0, 50)}...", the key is to understand the underlying mathematical principles. Practice similar problems to strengthen your understanding. If you need more clarity, try revisiting the concept notes or watching the related lecture video.`,
  };
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("quadratic")) {
    return "For quadratic equations: use factorisation, quadratic formula x=(-b\u00b1\u221a(b\u00b2-4ac))/2a, or completing the square. Check discriminant: D>0 two roots, D=0 equal roots, D<0 no real roots.";
  }
  if (lowerQ.includes("trigon")) {
    return "Trigonometry: sin=P/H, cos=B/H, tan=P/B. Key identity: sin\u00b2\u03b8+cos\u00b2\u03b8=1. Standard values: sin30=1/2, sin45=1/\u221a2, sin60=\u221a3/2.";
  }
  if (lowerQ.includes("calculus") || lowerQ.includes("derivative") || lowerQ.includes("integral")) {
    return "Calculus: d/dx(x\u207f)=nx\u207f\u207b\u00b9, d/dx(sinx)=cosx, d/dx(cosx)=-sinx. Integration is reverse of differentiation: \u222bx\u207f dx=x\u207f\u207a\u00b9/(n+1)+C.";
  }
  return answers.default;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Run first: admin create/update and live-classes SELECT/INSERT need these. Without them Postgres errors
  // when ALLOW_RUNTIME_SCHEMA_SYNC is false (Vercel → api.3ilearning.in / EC2 + Neon with an old `courses` row shape).
  try {
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Mathematics'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Beginner'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5, 1) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_lectures INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_tests INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8, 2) DEFAULT NULL");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT DEFAULT 'live'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT ''");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_date TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_date TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_students INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_materials INTEGER DEFAULT 0").catch(() => {});
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS pyq_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS mock_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS practice_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_color TEXT");
    await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'");
    await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT");
    await db.query("ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE lectures ADD COLUMN IF NOT EXISTS section_title TEXT").catch(() => {});
    await db.query("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS section_title TEXT").catch(() => {});
    await db.query("ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT").catch(() => {});
    console.log("[DB] courses + enrollments columns ensured (admin + live APIs)");
  } catch (err) {
    console.error("[DB] CRITICAL: could not ensure course/enrollment columns. Run SQL in Neon (same branch as DATABASE_URL). Error:", err);
  }

  const allowRuntimeSchemaSync = process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true";
  if (allowRuntimeSchemaSync) {
    // ==================== BASE TABLE CREATION ====================
    try {
    // Create base tables if they don't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'student',
        device_id TEXT,
        session_token TEXT,
        otp TEXT,
        otp_expires_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        teacher_name TEXT NOT NULL DEFAULT '3i Learning',
        price DECIMAL(10, 2) DEFAULT 0,
        original_price DECIMAL(10, 2) DEFAULT 0,
        validity_months NUMERIC(8, 2) DEFAULT NULL,
        category TEXT DEFAULT 'Mathematics',
        thumbnail TEXT,
        is_free BOOLEAN DEFAULT FALSE,
        total_lectures INTEGER DEFAULT 0,
        total_tests INTEGER DEFAULT 0,
        total_students INTEGER DEFAULT 0,
        level TEXT DEFAULT 'Beginner',
        duration_hours DECIMAL(5, 1) DEFAULT 0,
        is_published BOOLEAN DEFAULT TRUE,
        course_type TEXT DEFAULT 'standard',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS lectures (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        video_url TEXT,
        video_type TEXT DEFAULT 'youtube',
        pdf_url TEXT,
        duration_minutes INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        is_free_preview BOOLEAN DEFAULT FALSE,
        section_title TEXT,
        download_allowed BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        progress_percent INTEGER DEFAULT 0,
        last_lecture_id INTEGER,
        enrolled_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        UNIQUE(user_id, course_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS lecture_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
        is_completed BOOLEAN DEFAULT FALSE,
        watch_percent INTEGER DEFAULT 0,
        completed_at BIGINT,
        UNIQUE(user_id, lecture_id)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS study_materials (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        file_url TEXT,
        file_type TEXT DEFAULT 'pdf',
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        is_free BOOLEAN DEFAULT TRUE,
        section_title TEXT,
        download_allowed BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS tests (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        duration_minutes INTEGER DEFAULT 60,
        total_questions INTEGER DEFAULT 0,
        total_marks INTEGER DEFAULT 100,
        passing_marks INTEGER DEFAULT 35,
        test_type TEXT DEFAULT 'practice',
        folder_name TEXT,
        is_published BOOLEAN DEFAULT TRUE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        explanation TEXT,
        topic TEXT,
        difficulty TEXT DEFAULT 'medium',
        marks INTEGER DEFAULT 4,
        negative_marks DECIMAL(3, 1) DEFAULT 1,
        order_index INTEGER DEFAULT 0
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS test_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
        answers JSONB DEFAULT '{}',
        score INTEGER DEFAULT 0,
        total_marks INTEGER DEFAULT 0,
        percentage DECIMAL(5, 2) DEFAULT 0,
        time_taken_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'in_progress',
        started_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        completed_at BIGINT
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        is_read BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS live_classes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        youtube_url TEXT,
        recording_url TEXT,
        scheduled_at BIGINT,
        is_live BOOLEAN DEFAULT FALSE,
        is_completed BOOLEAN DEFAULT FALSE,
        is_public BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS live_chat_messages (
        id SERIAL PRIMARY KEY,
        live_class_id INTEGER REFERENCES live_classes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        message TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS doubts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT,
        topic TEXT,
        status TEXT DEFAULT 'pending',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount DECIMAL(10, 2),
        currency TEXT DEFAULT 'INR',
        status TEXT DEFAULT 'created',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS daily_missions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        questions JSONB DEFAULT '[]',
        mission_date DATE,
        xp_reward INTEGER DEFAULT 50,
        mission_type TEXT DEFAULT 'daily_drill',
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_missions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mission_id INTEGER REFERENCES daily_missions(id) ON DELETE CASCADE,
        is_completed BOOLEAN DEFAULT FALSE,
        score INTEGER DEFAULT 0,
        completed_at BIGINT,
        UNIQUE(user_id, mission_id)
      )
    `);

    // Secure offline downloads tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS download_tokens (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
        item_id INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        expires_at BIGINT NOT NULL
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS user_downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
        item_id INTEGER NOT NULL,
        local_filename TEXT,
        downloaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        UNIQUE(user_id, item_type, item_id)
      )
    `);

    console.log("[DB] Base tables ensured");
  } catch (err) {
    console.error("[DB] Failed to create base tables:", err);
  }

    // ==================== STARTUP MIGRATIONS ====================
    try {
    // DB indexes for 1000-user scale
    await db.query("CREATE INDEX IF NOT EXISTS idx_tests_course_id ON tests(course_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_test_attempts_user_test ON test_attempts(user_id, test_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_test_attempts_test_id ON test_attempts(test_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_lecture_progress_user ON lecture_progress(user_id)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id)");
    // Secure offline downloads indexes
    await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_token ON download_tokens(token)");
    await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_expires ON download_tokens(expires_at)");
    // Short-lived media access tokens (for PDF/video viewing in iframes)
    await db.query(`CREATE TABLE IF NOT EXISTS media_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_key TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`).catch(() => {});
    await db.query("CREATE INDEX IF NOT EXISTS idx_media_tokens_expires ON media_tokens(expires_at)").catch(() => {});
    console.log("[DB] Indexes ensured");
    } catch (err) {
    console.error("[DB] Failed to create indexes:", err);
  }
    // Profile & user columns
    try {
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TEXT");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT FALSE");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at BIGINT");
    await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
    await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'");
    // Ensure courses table has all required columns
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Mathematics'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Beginner'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5, 1) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_lectures INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_tests INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2) DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8, 2) DEFAULT NULL");
    await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT DEFAULT 'live'");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT ''");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_date TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_date TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_students INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_materials INTEGER DEFAULT 0").catch(() => {});
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS pyq_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS mock_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS practice_count INTEGER DEFAULT 0");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail TEXT");
    await db.query("ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_color TEXT");
    await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'moderate'");
    await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS scheduled_at BIGINT");
    await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE");
    await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS mini_course_id INTEGER").catch(() => {});
    await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0").catch(() => {});
    await db.query("ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {});
    // Add download_allowed column to study_materials table
    await db.query("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {});
    // Test purchases table
    await db.query(`CREATE TABLE IF NOT EXISTS test_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, test_id)
    )`).catch(() => {});
    await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT");
    await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS solution_image_url TEXT");
    await db.query(`CREATE TABLE IF NOT EXISTS course_folders (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_hidden BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(course_id, name, type)
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS standalone_folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_hidden BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(name, type)
    )`);
    // Test folder extra columns (mini practice course)
    await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS category TEXT").catch(() => {});
    await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0").catch(() => {});
    await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2) DEFAULT 0").catch(() => {});
    await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT TRUE").catch(() => {});
    await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS description TEXT").catch(() => {});
    // Test folder purchases table
    await db.query(`CREATE TABLE IF NOT EXISTS folder_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES standalone_folders(id) ON DELETE CASCADE,
      amount NUMERIC(10,2),
      payment_id TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, folder_id)
    )`).catch(() => {});
    await db.query(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'created',
      click_count INTEGER DEFAULT 1,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, course_id)
    )`);
    await db.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'created'").catch(() => {});
    await db.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 1").catch(() => {});
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS payments_user_course_unique ON payments(user_id, course_id)").catch(() => {});
    // Fix existing rows with NULL status or NULL click_count
    await db.query("UPDATE payments SET status = 'created' WHERE status IS NULL").catch(() => {});
    await db.query("UPDATE payments SET click_count = 1 WHERE click_count IS NULL").catch(() => {});
    await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS correct INTEGER DEFAULT 0");
    await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS incorrect INTEGER DEFAULT 0");
    await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS attempted INTEGER DEFAULT 0");
    await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS question_times JSONB");
    // Allow decimal scores (negative marking can produce floats)
    await db.query("ALTER TABLE test_attempts ALTER COLUMN score TYPE NUMERIC USING score::NUMERIC").catch(() => {});
    await db.query(`CREATE TABLE IF NOT EXISTS question_reports (
      id SERIAL PRIMARY KEY,
      question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT,
      created_at BIGINT,
      UNIQUE(question_id, user_id)
    )`);
    // Books table
    await db.query(`CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      price NUMERIC DEFAULT 0,
      original_price NUMERIC DEFAULT 0,
      cover_url TEXT,
      file_url TEXT,
      is_published BOOLEAN DEFAULT TRUE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS book_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      book_id INTEGER REFERENCES books(id),
      purchased_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, book_id)
    )`);
    await db.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE").catch(() => {});
    // Book click tracking (abandoned checkouts for books)
    await db.query(`CREATE TABLE IF NOT EXISTS book_click_tracking (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      click_count INTEGER DEFAULT 1,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, book_id)
    )`);
    console.log("[DB] book_click_tracking table ensured");
    // Live class notification columns
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_bell BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_free_preview BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE").catch(() => {});
    // Live class studio columns
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS stream_type TEXT DEFAULT 'rtmp'").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS chat_mode TEXT DEFAULT 'public'").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS recording_url TEXT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS show_viewer_count BOOLEAN DEFAULT TRUE").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS started_at BIGINT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS ended_at BIGINT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0").catch(() => {});
    // Cloudflare Stream integration columns
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_uid TEXT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_key TEXT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_rtmp_url TEXT").catch(() => {});
    await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_playback_hls TEXT").catch(() => {});
    // Live class viewers tracking (student presence via heartbeats)
    await db.query(`CREATE TABLE IF NOT EXISTS live_class_viewers (
      id SERIAL PRIMARY KEY,
      live_class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      last_heartbeat BIGINT NOT NULL,
      UNIQUE(live_class_id, user_id)
    )`).catch(() => {});
    // Live class hand raises
    await db.query(`CREATE TABLE IF NOT EXISTS live_class_hand_raises (
      id SERIAL PRIMARY KEY,
      live_class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      raised_at BIGINT NOT NULL,
      UNIQUE(live_class_id, user_id)
    )`).catch(() => {});
    // Clean up old scheduled classes created before the new system (before April 2026)
    // Mark old non-live, non-completed classes with no notify_bell/notify_email as completed
    await db.query("UPDATE live_classes SET is_completed = TRUE WHERE is_completed IS NOT TRUE AND is_live IS NOT TRUE AND notify_bell IS NULL AND notify_email IS NULL AND created_at < 1743465600000").catch(() => {});
    // Set profile_complete=FALSE for all users who haven't completed it yet
    await db.query("UPDATE users SET profile_complete = FALSE WHERE profile_complete IS NULL");
    // Reset to FALSE anyone who doesn't have date_of_birth (profile setup wasn't completed)
    await db.query(
      "UPDATE users SET profile_complete = FALSE WHERE role = 'student' AND (date_of_birth IS NULL OR date_of_birth = '')"
    );
    // Only mark complete if they went through profile setup (has DOB which is only set there)
    await db.query(
      "UPDATE users SET profile_complete = TRUE WHERE profile_complete = FALSE AND role = 'student' AND email IS NOT NULL AND date_of_birth IS NOT NULL AND name IS NOT NULL AND name NOT LIKE 'Student%'"
    );
    console.log("[DB] Schema columns ensured");

    // User downloads tracking table
    await db.query(`CREATE TABLE IF NOT EXISTS user_downloads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('material', 'lecture')),
      item_id INTEGER NOT NULL,
      downloaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, item_type, item_id)
    )`).catch(() => {});
    // Add local_filename column for encrypted offline downloads
    await db.query("ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT").catch(() => {});

    // Download tokens table for secure offline downloads
    await db.query(`CREATE TABLE IF NOT EXISTS download_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
      item_id INTEGER NOT NULL,
      r2_key TEXT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      expires_at BIGINT NOT NULL
    )`).catch(() => {});
    await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_token ON download_tokens(token)").catch(() => {});
    await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_expires ON download_tokens(expires_at)").catch(() => {});

    // Add valid_until column to enrollments for course access expiry
    await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT").catch(() => {});

    // Lecture progress tracking table
    await db.query(`CREATE TABLE IF NOT EXISTS lecture_progress (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
      watch_percent INTEGER DEFAULT 0,
      is_completed BOOLEAN DEFAULT FALSE,
      completed_at BIGINT,
      UNIQUE(user_id, lecture_id)
    )`).catch(() => {});
    // Ensure unique constraint exists (for ON CONFLICT to work)
    await db.query("CREATE UNIQUE INDEX IF NOT EXISTS lecture_progress_user_lecture ON lecture_progress(user_id, lecture_id)").catch(() => {});

    // Site settings table (for welcome page config etc.)
    await db.query(`CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT
    )`);

    // Support chat table
    await db.query(`CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
    await db.query("CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id)");
    // Permanently remove ALL old support chat notifications from the notifications table
    await db.query(`
      DELETE FROM notifications 
      WHERE title ILIKE 'New message from%' 
         OR title ILIKE 'New reply from Support%'
         OR title ILIKE '%support%'
         OR source = 'support'
    `).catch(() => {});
    // Add source column to notifications to tag support messages going forward
    await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system'").catch(() => {});
    await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at BIGINT").catch(() => {});
    await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE").catch(() => {});
    await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_notif_id INTEGER").catch(() => {});
    await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS image_url TEXT").catch(() => {});
    // Admin notifications log (tracks what was broadcast)
    await db.query(`CREATE TABLE IF NOT EXISTS admin_notifications (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'all',
      course_id INTEGER,
      sent_count INTEGER DEFAULT 0,
      is_hidden BOOLEAN DEFAULT FALSE,
      image_url TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
    await db.query("ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS image_url TEXT").catch(() => {});
    // Backfill from existing notifications only if table is empty
    const anCount = await db.query("SELECT COUNT(*) as cnt FROM admin_notifications");
    if (parseInt(anCount.rows[0]?.cnt || "0") === 0) {
      await db.query(`
        INSERT INTO admin_notifications (title, message, target, sent_count, created_at)
        SELECT title, message, 'all', COUNT(*), MIN(created_at)
        FROM notifications
        WHERE title NOT ILIKE 'New message from%'
          AND title NOT ILIKE 'New reply from Support%'
          AND title IS NOT NULL AND message IS NOT NULL
        GROUP BY title, message
      `).catch((e) => console.error("[DB] Backfill admin_notifications failed:", e));
    }
    console.log("[DB] admin_notifications ready");
    // Backfill admin_notif_id for old notifications that don't have it
    await db.query(`
      UPDATE notifications n SET admin_notif_id = an.id
      FROM admin_notifications an
      WHERE n.admin_notif_id IS NULL AND n.title = an.title AND n.message = an.message
    `).catch((e) => console.error("[DB] Backfill admin_notif_id failed:", e));
    console.log("[DB] admin_notif_id backfill done");
    // Backfill image_url on student notifications from admin_notifications
    await db.query(`
      UPDATE notifications n SET image_url = an.image_url
      FROM admin_notifications an
      WHERE n.admin_notif_id = an.id AND n.image_url IS NULL AND an.image_url IS NOT NULL
    `).catch(() => {});
    // Clean up orphaned student notifications that have no matching admin_notifications
    await db.query(`
      DELETE FROM notifications 
      WHERE admin_notif_id IS NOT NULL 
      AND admin_notif_id NOT IN (SELECT id FROM admin_notifications)
    `).catch(() => {});
    // Also clean up old notifications (without admin_notif_id) whose title doesn't exist in admin_notifications
    // These are notifications from deleted admin notifications before the linking system
    await db.query(`
      DELETE FROM notifications 
      WHERE admin_notif_id IS NULL 
      AND source IS DISTINCT FROM 'support'
      AND title NOT ILIKE 'New message from%'
      AND title NOT ILIKE 'New reply from%'
      AND title NOT ILIKE '%Live Class%'
      AND title NOT IN (SELECT title FROM admin_notifications)
    `).catch(() => {});
    console.log("[DB] Orphaned notifications cleaned up");
    } catch (err) {
    console.error("[DB] Failed to add columns:", err);
  }

    // Backfill test counts for all courses (fixes existing data)
    try {
    await db.query(`
      UPDATE courses c SET
        total_tests    = sub.total,
        pyq_count      = sub.pyq,
        mock_count     = sub.mock,
        practice_count = sub.practice
      FROM (
        SELECT course_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE test_type = 'pyq') AS pyq,
          COUNT(*) FILTER (WHERE test_type = 'mock') AS mock,
          COUNT(*) FILTER (WHERE test_type = 'practice') AS practice
        FROM tests
        GROUP BY course_id
      ) sub
      WHERE c.id = sub.course_id
    `);
    // Zero out courses with no tests
    await db.query(`
      UPDATE courses SET total_tests=0, pyq_count=0, mock_count=0, practice_count=0
      WHERE id NOT IN (SELECT DISTINCT course_id FROM tests WHERE course_id IS NOT NULL)
    `);
    console.log("[DB] Course test counts backfilled");
    } catch (err) {
    console.error("[DB] Failed to backfill test counts:", err);
  }

    // Backfill progress_percent for all enrollments based on lectures + tests completed
    try {
    await db.query(`
      UPDATE enrollments e SET progress_percent = sub.pct
      FROM (
        SELECT 
          e2.user_id,
          e2.course_id,
          ROUND(
            (COALESCE(lp_done.cnt, 0) + COALESCE(ta_done.cnt, 0))::numeric /
            NULLIF(COALESCE(lec_total.cnt, 0) + COALESCE(test_total.cnt, 0), 0) * 100
          ) AS pct
        FROM enrollments e2
        LEFT JOIN (
          SELECT l.course_id, lp.user_id, COUNT(*) AS cnt
          FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id
          WHERE lp.is_completed = TRUE
          GROUP BY l.course_id, lp.user_id
        ) lp_done ON lp_done.course_id = e2.course_id AND lp_done.user_id = e2.user_id
        LEFT JOIN (
          SELECT t.course_id, ta.user_id, COUNT(DISTINCT ta.test_id) AS cnt
          FROM test_attempts ta JOIN tests t ON ta.test_id = t.id
          WHERE ta.status = 'completed' AND t.course_id IS NOT NULL
          GROUP BY t.course_id, ta.user_id
        ) ta_done ON ta_done.course_id = e2.course_id AND ta_done.user_id = e2.user_id
        LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM lectures GROUP BY course_id) lec_total ON lec_total.course_id = e2.course_id
        LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM tests WHERE is_published = TRUE GROUP BY course_id) test_total ON test_total.course_id = e2.course_id
        WHERE (COALESCE(lp_done.cnt, 0) + COALESCE(ta_done.cnt, 0)) > 0
      ) sub
      WHERE e.user_id = sub.user_id AND e.course_id = sub.course_id
    `);
    console.log("[DB] Enrollment progress backfilled (lectures + tests)");
    } catch (err) {
    console.error("[DB] Failed to backfill enrollment progress:", err);
  }

  } else {
    console.log("[DB] Runtime schema sync skipped (ALLOW_RUNTIME_SCHEMA_SYNC != true)");
  }

  // ==================== LIVE CLASS NOTIFICATION SCHEDULER ====================
  // Runs every 60 seconds — sends notifications 30 min before and at start time
  const sentNotifications = new Set<string>(); // track sent to avoid duplicates
  setInterval(async () => {
    try {
      const now = Date.now();
      const thirtyMinFromNow = now + 30 * 60 * 1000;
      // Get all scheduled (not live, not completed) classes with notify_bell = true
      const classes = await db.query(
        "SELECT lc.id, lc.title, lc.course_id, lc.scheduled_at, lc.notify_bell FROM live_classes lc WHERE lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND lc.notify_bell = TRUE AND lc.scheduled_at IS NOT NULL"
      );
      for (const lc of classes.rows) {
        const scheduledAt = parseInt(lc.scheduled_at);
        if (isNaN(scheduledAt)) continue;
        const diff = scheduledAt - now;
        // 30 min before (between 29-31 min window)
        const key30 = `30min_${lc.id}`;
        if (diff > 0 && diff <= 31 * 60 * 1000 && diff >= 29 * 60 * 1000 && !sentNotifications.has(key30)) {
          sentNotifications.add(key30);
          const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [lc.course_id]);
          for (const e of enrolled.rows) {
            await db.query(
              "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
              [e.user_id, "⏰ Live Class in 30 minutes!", `"${lc.title}" starts in 30 minutes. Get ready!`, "info", now, scheduledAt]
            );
          }
          console.log(`[LiveNotif] 30min reminder sent for "${lc.title}" to ${enrolled.rows.length} students`);
        }
        // At start time (within 2 min window)
        const keyStart = `start_${lc.id}`;
        if (diff <= 0 && diff >= -2 * 60 * 1000 && !sentNotifications.has(keyStart)) {
          sentNotifications.add(keyStart);
          const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [lc.course_id]);
          for (const e of enrolled.rows) {
            await db.query(
              "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
              [e.user_id, "🔴 Live Class Starting Now!", `"${lc.title}" is about to start. Join now!`, "info", now, now + 12 * 3600000]
            );
          }
          console.log(`[LiveNotif] Start reminder sent for "${lc.title}" to ${enrolled.rows.length} students`);
        }
      }
      // Clean up old keys (older than 1 hour)
      if (sentNotifications.size > 500) sentNotifications.clear();
    } catch (err) {
      console.error("[LiveNotif] Scheduler error:", err);
    }
  }, 60 * 1000); // every 60 seconds
  console.log("[LiveNotif] Scheduler started — checks every 60s");

  // ==================== DOWNLOAD TOKEN CLEANUP JOB ====================
  // Runs every 5 minutes — deletes expired used tokens
  setInterval(async () => {
    try {
      const result = await db.query(
        "DELETE FROM download_tokens WHERE expires_at < $1 AND used = TRUE",
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[TokenCleanup] Deleted ${result.rowCount} expired tokens`);
      }
    } catch (err) {
      console.error("[TokenCleanup] Error:", err);
    }
  }, 5 * 60 * 1000); // every 5 minutes
  console.log("[TokenCleanup] Scheduler started — runs every 5 minutes");

  // ==================== AUTH ROUTES ====================

  // Update last_active_at for any authenticated API request
  app.use("/api", async (req: any, res, next) => {
    try {
      const authUser = await getAuthUser(req);
      const userId = authUser?.id || null;
      if (userId && userId > 0) {
        db.query("UPDATE users SET last_active_at = $1 WHERE id = $2", [Date.now(), userId]).catch(() => {});
      }
      next();
    } catch (_e) {
      next();
    }
  });

  registerAuthRoutes({
    app,
    db,
    getAuthUser,
    generateOTP,
    hashOtpValue,
    verifyOtpValue,
    generateSecureToken: () => generateSecureToken(),
    sendOTPviaSMS,
    verifyFirebaseToken,
    adminEmails: ADMIN_EMAILS,
    adminPhones: ADMIN_PHONES,
  });

  registerPaymentRoutes({
    app,
    db,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature,
    cacheInvalidate,
  });


  registerSupportRoutes({
    app,
    db,
    getAuthUser,
    requireAdmin,
  });

  registerBookRoutes({
    app,
    db,
    requireAdmin,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature,
  });

  registerLectureRoutes({
    app,
    db,
    getAuthUser,
    updateCourseProgress,
  });

  // ==================== TESTS ROUTES ====================
  registerTestFolderRoutes({
    app,
    db,
    getAuthUser,
  });

  registerTestCoreRoutes({
    app,
    db,
    getAuthUser,
    updateCourseProgress,
  });

  registerTestAttemptRoutes({
    app,
    db,
    getAuthUser,
  });

  registerStudentMissionMaterialRoutes({
    app,
    db,
    getAuthUser,
  });

  // ==================== LIVE CLASSES ROUTES ====================
  registerLiveClassRoutes({
    app,
    db,
    getAuthUser,
  });

  registerDoubtNotificationRoutes({
    app,
    db,
    getAuthUser,
    generateAIAnswer,
  });

  async function requireAuth(req: Request, res: Response, next: () => void) {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ message: "Login required" });
    }
    (req as any).user = user;
    next();
  }

  registerStandaloneFolderRoutes({
    app,
    db,
    requireAdmin,
  });

  // ==================== ADMIN ROUTES ====================
  async function requireAdmin(req: Request, res: Response, next: () => void) {
    const user = await getAuthUser(req);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    (req as any).user = user;
    next();
  }

  // ==================== CLOUDFLARE R2 UPLOAD ROUTES ====================
  let r2Client: any = null;
  const getR2Client = async () => {
    if (r2Client) return r2Client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
    return r2Client;
  };

  registerAdminLiveClassManageRoutes({
    app,
    db,
    requireAdmin,
    getR2Client,
  });

  registerCourseAccessRoutes({
    app,
    db,
    getAuthUser,
    generateSecureToken,
    cacheInvalidate: (prefix?: string) => cacheInvalidate(prefix ?? ""),
    getR2Client,
  });

  registerUploadRoutes({
    app,
    requireAdmin,
    getAuthUser,
    getR2Client,
    uploadLarge,
  });

  registerMediaStreamRoutes({
    app,
    db,
    getAuthUser,
    getR2Client,
  });

  registerSiteSettingsRoutes({
    app,
    db,
    requireAdmin,
  });

  registerAdminCourseCrudRoutes({
    app,
    db,
    requireAdmin,
    cacheInvalidate,
  });

  registerAdminCourseImportRoutes({
    app,
    db,
    requireAdmin,
    updateCourseTestCounts,
  });

  registerAdminCourseManagementRoutes({
    app,
    db,
    requireAdmin,
    updateCourseTestCounts,
  });

  registerAdminAnalyticsRoutes({
    app,
    db,
    requireAdmin,
  });

  registerAdminEnrollmentRoutes({
    app,
    db,
    requireAdmin,
    cacheInvalidate,
    deleteDownloadsForUser,
    deleteDownloadsForCourse,
  });

  registerAdminLectureRoutes({
    app,
    db,
    requireAdmin,
    getR2Client,
  });

  registerAdminTestRoutes({
    app,
    db,
    requireAdmin,
    updateCourseTestCounts,
  });

  registerAdminQuestionBulkRoutes({
    app,
    db,
    requireAdmin,
    upload,
    PDFParse,
  });

  registerAdminUsersAndContentRoutes({
    app,
    db,
    requireAdmin,
    deleteDownloadsForUser,
  });

  registerAdminNotificationRoutes({
    app,
    db,
    requireAdmin,
  });

  registerAdminTestManagementRoutes({
    app,
    db,
    requireAdmin,
    updateCourseTestCounts,
  });

  registerAdminDailyMissionRoutes({
    app,
    db,
    requireAdmin,
  });

  registerLiveChatRoutes({
    app,
    db,
    getAuthUser,
    requireAuth,
    requireAdmin,
  });

  registerLiveClassEngagementRoutes({
    app,
    db,
    requireAuth,
    requireAdmin,
  });

  registerLiveStreamRoutes({
    app,
    db,
    requireAdmin,
  });

  registerPdfRoutes({ app, db });

  const httpServer = createServer(app);
  return httpServer;
}

