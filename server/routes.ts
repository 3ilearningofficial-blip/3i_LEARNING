import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { verifyFirebaseToken } from "./firebase";
import { getRazorpay, verifyPaymentSignature } from "./razorpay";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// Larger pool for 1000 concurrent users
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_lCd8Q5kexsDH@ep-flat-mud-a1l5ph0p-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
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
        console.warn(`[DB] Transient error on attempt ${attempt}, retrying...`);
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

// Resolve authenticated user from session OR Bearer token OR X-User-Id header
async function getAuthUser(req: Request): Promise<{ id: number; name: string; email?: string; phone?: string; role: string; sessionToken?: string; profileComplete?: boolean } | null> {
  // 1. Try session first
  const sessionUser = (req.session as any).user;
  if (sessionUser?.id) return sessionUser;

  // 2. Try X-User-Id header (most reliable — always sent by authFetch/apiRequest)
  const userIdHeader = req.headers["x-user-id"];
  if (userIdHeader) {
    const uid = parseInt(String(userIdHeader));
    if (uid > 0) {
      try {
        const result = await db.query(
          "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE id = $1",
          [uid]
        );
        if (result.rows.length > 0) {
          const u = result.rows[0];
          if (u.is_blocked) return null;
          const authUser = {
            id: u.id, name: u.name, email: u.email, phone: u.phone,
            role: u.role, sessionToken: u.session_token,
            profileComplete: u.profile_complete || false,
          };
          (req.session as any).user = authUser;
          return authUser;
        }
      } catch (e) {
        console.error("[Auth] X-User-Id lookup error:", e);
      }
    }
  }

  // 3. Fall back to Bearer token
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && token !== "null" && token !== "undefined") {
      try {
        const result = await db.query(
          "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE session_token = $1",
          [token]
        );
        if (result.rows.length > 0) {
          const u = result.rows[0];
          if (u.is_blocked) return null;
          const authUser = {
            id: u.id, name: u.name, email: u.email, phone: u.phone,
            role: u.role, sessionToken: u.session_token,
            profileComplete: u.profile_complete || false,
          };
          (req.session as any).user = authUser;
          return authUser;
        }
        console.log(`[Auth] Stale Bearer token: ${token.slice(0, 15)}...`);
      } catch (e) {
        console.error("[Auth] Bearer token lookup error:", e);
      }
    }
  }

  return null;
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
    console.log(`[SMS] No FAST2SMS_API_KEY set � OTP for ${phone}: ${otp}`);
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

export async function registerRoutes(app: Express): Promise<Server> {
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
    let sessionUser = req.session?.user;

    // 🔥 If no session, check Bearer token
    if (!sessionUser) {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];

        const result = await db.query(
          "SELECT * FROM users WHERE session_token = $1",
          [token]
        );

        if (result.rows.length > 0) {
          const user = result.rows[0];

          sessionUser = {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            sessionToken: user.session_token,
          };

          req.session = req.session || {};
          req.session.user = sessionUser;
        }
      }
    }

    // ✅ Update last active
    const headerUserId = req.headers["x-user-id"];
    const userId =
      sessionUser?.id ||
      (headerUserId ? parseInt(String(headerUserId)) : null);

    if (userId && userId > 0) {
      db.query(
        "UPDATE users SET last_active_at = $1 WHERE id = $2",
        [Date.now(), userId]
      ).catch(() => {});
    }

    next();
  } catch (_e) {
    next();
  }
});

  app.post("/api/auth/send-otp", async (req: Request, res: Response) => {
    console.log("OTP request received:", req.body);
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
        try {
          smsSent = await sendOTPviaSMS(identifier, otp);
        } catch (smsErr) {
          console.error(`[OTP] SMS sending threw error for ${identifier}:`, smsErr);
        }
        if (!smsSent) {
          console.log(`[OTP] SMS delivery failed for ${identifier}, OTP stored in DB`);
        }

        const isDev = process.env.NODE_ENV !== "production";
        return res.json({
          success: true,
          message: smsSent ? "OTP sent to your phone" : "OTP sent. If SMS is delayed, please wait 30 seconds and try again.",
          smsSent,
          // Show OTP on screen when SMS fails OR in dev mode
          devOtp: (!smsSent || isDev) ? otp : "",
        });
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
      if (user.is_blocked) return res.status(403).json({ message: "Your account has been blocked. Please contact support." });
      if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });
      if (Date.now() > Number(user.otp_expires_at)) return res.status(400).json({ message: "OTP expired" });

      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4", [deviceId || null, sessionToken, Date.now(), user.id]);

      const sessionUser = {
        id: user.id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        deviceId, sessionToken,
        profileComplete: !!(user.profile_complete),
      };
      console.log(`[OTP] Verified user ${user.id} (${user.role}), profile_complete=${user.profile_complete}, returning profileComplete=${sessionUser.profileComplete}`);
      (req.session as any).user = sessionUser;
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
      await db.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4", [deviceId || null, sessionToken, Date.now(), user.id]);

      const sessionUser = {
        id: user.id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        deviceId, sessionToken,
      };
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Firebase verify error:", err);
      res.status(400).json({ message: "Firebase verification failed" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const sessionUser = (req.session as any).user as { id: number; sessionToken?: string } | undefined;
    if (!sessionUser) {
      // Try Bearer token
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
          const dbUser = await db.query(
            "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url, is_blocked FROM users WHERE session_token = $1",
            [token]
          );
          if (dbUser.rows.length > 0) {
            const row = dbUser.rows[0];
            if (row.is_blocked) return res.status(403).json({ message: "account_blocked" });
            const fresh = {
              id: row.id, name: row.name, email: row.email, phone: row.phone,
              role: row.role, sessionToken: row.session_token,
              profileComplete: row.profile_complete || false,
              date_of_birth: row.date_of_birth, photo_url: row.photo_url,
            };
            (req.session as any).user = fresh;
            return res.json(fresh);
          }
          // Stale token — return 401 so client can handle gracefully
        } catch (_e) {}
      }
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const dbUser = await db.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url, is_blocked FROM users WHERE id = $1",
        [sessionUser.id]
      );
      if (dbUser.rows.length === 0) {
        (req.session as any).user = null;
        return res.status(401).json({ message: "account_deleted" });
      }
      const row = dbUser.rows[0];
      if (row.is_blocked) {
        (req.session as any).user = null;
        return res.status(403).json({ message: "account_blocked" });
      }
      if (sessionUser.sessionToken && row.session_token !== sessionUser.sessionToken) {
        (req.session as any).user = null;
        return res.status(401).json({ message: "logged_in_elsewhere" });
      }
      const fresh = {
        ...sessionUser,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        sessionToken: row.session_token,
        profileComplete: row.profile_complete || false,
        date_of_birth: row.date_of_birth,
        photo_url: row.photo_url,
      };
      (req.session as any).user = fresh;
      res.json(fresh);
    } catch (err) {
      res.json(sessionUser);
    }
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
      await db.query("UPDATE users SET device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, Date.now(), user.id]);

      const sessionUser = {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        deviceId: deviceId,
        sessionToken: sessionToken,
        profileComplete: user.profile_complete || false,
      };
      (req.session as any).user = sessionUser;
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
    (req.session as any).user = null;
    res.json({ success: true });
  });

  app.post("/api/auth/email-login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Phone/email and password are required" });

      // Search by email OR phone number
      const identifier = email.trim().toLowerCase();
      const isPhone = /^\d{10}$/.test(identifier);
      let result;
      if (isPhone) {
        result = await db.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      } else {
        result = await db.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [identifier]);
      }

      if (result.rows.length === 0) return res.status(404).json({ message: "Account not found. Please sign up first." });
      const user = result.rows[0];

      // Check if blocked
      if (user.is_blocked) return res.status(403).json({ message: "Your account has been blocked. Please contact support." });

      // Check if profile is complete (registered properly)
      if (!user.profile_complete && user.role !== "admin") {
        return res.status(401).json({ message: "Account not fully registered. Please complete sign up first." });
      }

      // Ensure admin emails/phones always have admin role
      if ((ADMIN_EMAILS.includes(identifier) || ADMIN_PHONES.includes(identifier)) && user.role !== "admin") {
        await db.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
        user.role = "admin";
      }

      if (!user.password_hash) return res.status(401).json({ message: "No password set. Please use Phone OTP to sign in, then set a password in Profile." });
      const { createHash } = await import("crypto");
      const inputForHash = password + String(user.id);
      const hash = createHash("sha256").update(inputForHash).digest("hex");
      // Also try plain password hash (no salt) as fallback for legacy accounts
      const plainHash = createHash("sha256").update(password).digest("hex");
      console.log("[Login] id=" + user.id + " identifier=" + identifier + " stored_hash_len=" + (user.password_hash || "").length + " stored_hash_prefix=" + (user.password_hash || "").slice(0, 10) + " computed_hash_prefix=" + hash.slice(0, 10) + " plain_hash_prefix=" + plainHash.slice(0, 10) + " match=" + (hash === user.password_hash) + " plain_match=" + (plainHash === user.password_hash));
      let matched = hash === user.password_hash;
      if (!matched && plainHash === user.password_hash) {
        // Legacy hash without salt — update to salted hash
        matched = true;
        await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, user.id]);
        console.log("[Login] Migrated legacy password hash for user " + user.id);
      }
      if (!matched) return res.status(401).json({ message: "Incorrect password. Try again or use Phone OTP." });
      const sessionToken = Date.now().toString(36) + Math.random().toString(36).substr(2, 12);
      await db.query("UPDATE users SET session_token = $1, last_active_at = $2 WHERE id = $3", [sessionToken, Date.now(), user.id]);
      const sessionUser = {
        id: user.id, name: user.name, email: user.email,
        phone: user.phone, role: user.role,
        sessionToken, profileComplete: !!(user.profile_complete),
      };
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Email login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.put("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name, dateOfBirth, email, photoUrl, password } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      // Simple password hash using built-in crypto
      let passwordHash: string | null = null;
      if (password) {
        const { createHash } = await import("crypto");
        passwordHash = createHash("sha256").update(password + String(user.id)).digest("hex");
        console.log("[ProfileSetup] Storing password hash for user " + user.id + " hash_prefix=" + passwordHash.slice(0, 10));
      }
      // Build update query dynamically � only update provided fields
      const updates: string[] = ["name = $1"];
      const params: unknown[] = [name];
      if (dateOfBirth !== undefined) { params.push(dateOfBirth || null); updates.push(`date_of_birth = $${params.length}`); }
      if (email !== undefined) { params.push(email || null); updates.push(`email = COALESCE($${params.length}, email)`); }
      if (photoUrl !== undefined) { params.push(photoUrl || null); updates.push(`photo_url = $${params.length}`); }
      if (passwordHash) { params.push(passwordHash); updates.push(`password_hash = $${params.length}`); }
      updates.push("profile_complete = TRUE");
      params.push(user.id);
      await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      const updated = { ...(user as object), name, profileComplete: true };
      (req.session as any).user = updated;
      res.json({ success: true, user: updated });
    } catch (err) {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // ==================== COURSES ROUTES ====================
  app.get("/api/courses", async (req: Request, res: Response) => {
    try {
      let user = await getAuthUser(req);

      // Fallback: if Bearer token lookup failed but _uid is provided,
      // try to find the user by ID (safe since we only use it for enrollment overlay)
      if (!user && req.query._uid) {
        const uid = parseInt(String(req.query._uid));
        if (uid > 0) {
          try {
            const r = await db.query("SELECT id, name, email, phone, role, profile_complete FROM users WHERE id = $1", [uid]);
            if (r.rows.length > 0) {
              const u = r.rows[0];
              user = { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, profileComplete: u.profile_complete };
            }
          } catch (_e) {}
        }
      }
      console.log(`[Courses] auth user=${user?.id || "none"}, xUserId=${req.headers["x-user-id"] || "none"}, _uid=${req.query._uid || "none"}`);
      const { category, search } = req.query;
      // Admins see all courses; students only see published ones
      let query = user?.role === "admin"
        ? `SELECT c.*, (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials FROM courses c WHERE 1=1`
        : `SELECT c.*, (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials FROM courses c WHERE c.is_published = TRUE`;
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
      // No server-side cache — enrollment data must be fresh per user
      let courses: any[] = result.rows;

      if (user) {
        const enrollResult = await db.query(
          "SELECT course_id, progress_percent FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL)",
          [user.id]
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
        console.log(`[Courses] user ${user.id} progress map:`, JSON.stringify(Object.fromEntries(enrollMap)));
      }

      res.set("Cache-Control", "private, no-store");
      // Log enrolled courses for debugging
      if (user) {
        const enrolledCourses = courses.filter((c: any) => c.isEnrolled);
      }
      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });

  // Public endpoint for course folders (students can see non-hidden folders)
  app.get("/api/courses/:id/folders", async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM course_folders WHERE course_id = $1 AND is_hidden = FALSE ORDER BY created_at ASC",
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Failed to fetch folders" }); }
  });

  app.get("/api/courses/:id", async (req: Request, res: Response) => {
    try {
      let user = await getAuthUser(req);
      // Fallback: use _uid param if Bearer token is stale
      if (!user && req.query._uid) {
        const uid = parseInt(String(req.query._uid));
        if (uid > 0) {
          try {
            const r = await db.query("SELECT id, name, email, phone, role FROM users WHERE id = $1", [uid]);
            if (r.rows.length > 0) user = r.rows[0];
          } catch (_e) {}
        }
      }
      const courseResult = await db.query("SELECT * FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      const course = courseResult.rows[0];
      const lecturesResult = await db.query("SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index", [req.params.id]);
      const testsResult = await db.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE", [req.params.id]);
      const materialsResult = await db.query("SELECT * FROM study_materials WHERE course_id = $1", [req.params.id]);

      if (user) {
        const enroll = await db.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, req.params.id]);
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
        total_materials: materialsResult.rows.length, // Always accurate count
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
      // Capture the actual requester (admin or student) FIRST
      const requester = await getAuthUser(req);

      let user = requester;

      // If Bearer token is stale, use userId from request body
      if (!user && req.body.userId) {
        const uid = parseInt(req.body.userId);
        if (uid > 0) {
          const r = await db.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
          if (r.rows.length > 0) user = r.rows[0];
        }
      }

      // Admin granting access to another user — enroll the TARGET user, not the admin
      const isAdminGrant = requester?.role === "admin" && req.body.userId && requester.id !== parseInt(req.body.userId);
      if (isAdminGrant) {
        const uid = parseInt(req.body.userId);
        const r = await db.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
        if (r.rows.length > 0) user = r.rows[0];
      } else if (user && req.body.userId && user.id !== parseInt(req.body.userId)) {
        // Non-admin: token user differs from body userId — use body userId
        const uid = parseInt(req.body.userId);
        if (uid > 0) {
          const r = await db.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
          if (r.rows.length > 0) {
            console.log(`[Enroll] Token user ${user.id} != body userId ${uid}, using body userId`);
            user = r.rows[0];
          }
        }
      }

      if (!user) return res.status(401).json({ message: "Not authenticated" });

      // Validate course exists
      const courseResult = await db.query("SELECT id, is_free FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });

      // Admin grants bypass payment check
      if (!courseResult.rows[0].is_free && !isAdminGrant) return res.status(403).json({ message: "This course requires payment" });

      // Check not already enrolled
      const existing = await db.query("SELECT id, status FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, req.params.id]);
      if (existing.rows.length > 0) {
        // Reactivate if inactive and admin is granting
        if (existing.rows[0].status === "inactive" && isAdminGrant) {
          await db.query("UPDATE enrollments SET status = 'active' WHERE id = $1", [existing.rows[0].id]);
          return res.json({ success: true, reactivated: true });
        }
        return res.json({ success: true, alreadyEnrolled: true });
      }

      await db.query(
        "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, $3)",
        [user.id, req.params.id, Date.now()]
      );
      await db.query(
        "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
        [req.params.id]
      );
      cacheInvalidate("courses:");
      res.json({ success: true });
    } catch (err) {
      console.error("Enroll error:", err);
      res.status(500).json({ message: "Failed to enroll" });
    }
  });

  // ==================== PAYMENT ROUTES ====================
  // Track Buy Now click (before Razorpay opens)
  app.post("/api/payments/track-click", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      const { courseId } = req.body;
      if (!courseId) return res.json({ ok: true });
      // Ensure column exists
      await db.query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 1`).catch(() => {});
      const course = await db.query("SELECT price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;
      // Check if any unpaid record exists for this user+course (status = 'created' OR NULL)
      const existing = await db.query(
        "SELECT id, click_count FROM payments WHERE user_id = $1 AND course_id = $2 AND (status = 'created' OR status IS NULL) ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existing.rows.length > 0) {
        const currentCount = parseInt(existing.rows[0].click_count) || 1;
        const newCount = currentCount + 1;
        const updated = await db.query(
          "UPDATE payments SET click_count = $1, status = 'created' WHERE id = $2 RETURNING id, click_count",
          [newCount, existing.rows[0].id]
        );
        console.log(`[BuyNow] user=${user.id} course=${courseId} click_count: ${currentCount} → ${updated.rows[0]?.click_count}`);
      } else {
        // Only insert if not already paid
        const paid = await db.query(
          "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' LIMIT 1",
          [user.id, courseId]
        );
        if (paid.rows.length === 0) {
          // Use ON CONFLICT to handle race conditions with the UNIQUE constraint
          await db.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at) 
             VALUES ($1, $2, $3, 'created', 1, $4)
             ON CONFLICT (user_id, course_id) DO UPDATE SET click_count = payments.click_count + 1`,
            [user.id, courseId, price, Date.now()]
          );
          console.log(`[BuyNow] user=${user.id} course=${courseId} new record created or incremented`);
        }
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[BuyNow] track-click error:", err);
      res.json({ ok: true });
    }
  });

  app.post("/api/payments/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
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

      // Update existing track-click record with the order ID (don't insert new row — preserves click_count)
      const existingPayment = await db.query(
        "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'created' ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existingPayment.rows.length > 0) {
        await db.query(
          "UPDATE payments SET razorpay_order_id = $1, amount = $2 WHERE id = $3",
          [order.id, course.price, existingPayment.rows[0].id]
        );
      } else {
        await db.query(
          "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, click_count, created_at) VALUES ($1, $2, $3, $4, 'created', 1, $5)",
          [user.id, courseId, order.id, course.price, Date.now()]
        );
      }

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
      const user = await getAuthUser(req);
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

      // Only insert enrollment and increment counter if not already enrolled
      const alreadyEnrolled = await db.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [user.id, paymentCourseId]
      );
      if (alreadyEnrolled.rows.length === 0) {
        await db.query(
          "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, $3)",
          [user.id, paymentCourseId, Date.now()]
        );
        await db.query(
          "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
          [paymentCourseId]
        );
      }
      cacheInvalidate("courses:");
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      res.status(500).json({ message: "Payment verification failed" });
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
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch enrolled courses" });
    }
  });

  // Student downloads � study materials they have access to
  app.get("/api/my-downloads", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      // Return only items the user has explicitly downloaded AND still have download enabled
      // AND enrollment is still valid (not expired)
      const materialsResult = await db.query(
        `SELECT sm.id, sm.title, sm.file_url, sm.file_type, sm.section_title, sm.download_allowed,
                c.title AS course_title, 'material' AS type, ud.downloaded_at, ud.local_filename
         FROM user_downloads ud
         JOIN study_materials sm ON ud.item_id = sm.id
         LEFT JOIN courses c ON sm.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'material' AND sm.download_allowed = TRUE
         AND (e.valid_until IS NULL OR e.valid_until > $2 OR c.id IS NULL)
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
         JOIN courses c ON l.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'lecture' AND l.download_allowed = TRUE
         AND (e.valid_until IS NULL OR e.valid_until > $2)
         ORDER BY ud.downloaded_at DESC`,
        [user.id, Date.now()]
      );

      res.json({ materials: materialsResult.rows, lectures: lecturesResult.rows });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch downloads" });
    }
  });

  // Track a download
  app.post("/api/my-downloads", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId, localFilename } = req.body;
      if (!itemType || !itemId) return res.status(400).json({ message: "itemType and itemId required" });
      await db.query(
        "INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET downloaded_at = EXTRACT(EPOCH FROM NOW()) * 1000, local_filename = EXCLUDED.local_filename",
        [user.id, itemType, itemId, localFilename || null]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to track download" });
    }
  });

  // Delete a download record
  app.delete("/api/my-downloads/:itemType/:itemId", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId } = req.params;
      const result = await db.query(
        "DELETE FROM user_downloads WHERE user_id = $1 AND item_type = $2 AND item_id = $3",
        [user.id, itemType, itemId]
      );
      if (result.rowCount === 0) return res.status(404).json({ message: "Download record not found" });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete download" });
    }
  });

  // Get signed download token (secure offline downloads)
  app.get("/api/download-url", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user || user.role !== "student") {
        return res.status(401).json({ message: "Not authenticated" });
      }

      const { itemType, itemId } = req.query;
      if (!itemType || !itemId || !["lecture", "material"].includes(String(itemType))) {
        return res.status(400).json({ message: "Valid itemType (lecture|material) and itemId required" });
      }

      const id = parseInt(String(itemId));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid itemId" });

      // Resolve item to course and check download_allowed
      let courseId: number | null = null;
      let downloadAllowed = false;
      let r2Key: string | null = null;

      if (itemType === "lecture") {
        const lectureResult = await db.query(
          "SELECT course_id, download_allowed, video_url FROM lectures WHERE id = $1",
          [id]
        );
        if (lectureResult.rows.length === 0) {
          return res.status(404).json({ message: "Lecture not found" });
        }
        const lecture = lectureResult.rows[0];
        courseId = lecture.course_id;
        downloadAllowed = lecture.download_allowed;
        r2Key = lecture.video_url;
      } else if (itemType === "material") {
        const materialResult = await db.query(
          "SELECT course_id, download_allowed, file_url FROM study_materials WHERE id = $1",
          [id]
        );
        if (materialResult.rows.length === 0) {
          return res.status(404).json({ message: "Material not found" });
        }
        const material = materialResult.rows[0];
        courseId = material.course_id;
        downloadAllowed = material.download_allowed;
        r2Key = material.file_url;
      }

      if (!downloadAllowed) {
        return res.status(403).json({ message: "Download not allowed for this item" });
      }

      if (!r2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }

      // Check active enrollment with valid_until validation
      if (courseId) {
        const enrollmentResult = await db.query(
          "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
          [user.id, courseId]
        );
        if (enrollmentResult.rows.length === 0) {
          return res.status(403).json({ message: "Not enrolled in this course" });
        }
        const enrollment = enrollmentResult.rows[0];
        if (enrollment.valid_until && enrollment.valid_until < Date.now()) {
          return res.status(403).json({ message: "Course access has expired" });
        }
      }

      // Strip CDN prefix to get R2 key (if URL contains full CDN path)
      let cleanR2Key = r2Key;
      if (r2Key.startsWith("http")) {
        try {
          const url = new URL(r2Key);
          cleanR2Key = url.pathname.substring(1); // Remove leading /
        } catch (_e) {
          cleanR2Key = r2Key;
        }
      }

      // Generate token
      const { randomUUID } = await import("crypto");
      const token = randomUUID();
      const createdAt = Date.now();
      const expiresAt = createdAt + 30000; // 30 seconds

      // Insert token into database
      await db.query(
        "INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [token, user.id, itemType, id, cleanR2Key, createdAt, expiresAt]
      );

      res.json({ token, expiresAt });
    } catch (err) {
      console.error("[download-url] Error:", err);
      res.status(500).json({ message: "Failed to generate download token" });
    }
  });

  // Download proxy endpoint (streams file from R2 with watermark)
  app.get("/api/download-proxy", async (req: Request, res: Response) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token required" });
      }

      // Look up token
      const tokenResult = await db.query(
        "SELECT * FROM download_tokens WHERE token = $1 AND used = FALSE AND expires_at > $2",
        [token, Date.now()]
      );

      if (tokenResult.rows.length === 0) {
        return res.status(403).json({ message: "Token invalid, expired, or already used" });
      }

      const tokenData = tokenResult.rows[0];

      // Mark token as used immediately
      await db.query("UPDATE download_tokens SET used = TRUE WHERE token = $1", [token]);

      // Fetch file from R2
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

      // Generate watermark token
      const { createHmac } = await import("crypto");
      const timestamp = Date.now();
      const watermarkData = `${tokenData.user_id}:${timestamp}`;
      const hmac = createHmac("sha256", process.env.SESSION_SECRET || "default-secret")
        .update(watermarkData)
        .digest("hex");
      const watermarkToken = `${watermarkData}:${hmac}`;

      // Set response headers
      res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("X-Watermark-Token", watermarkToken);
      if (r2Response.ContentLength) {
        res.setHeader("Content-Length", r2Response.ContentLength);
      }

      // Stream the file
      const stream = r2Response.Body as any;
      stream.pipe(res);

      stream.on("error", (err: Error) => {
        console.error("[download-proxy] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Stream error" });
        }
      });
    } catch (err) {
      console.error("[download-proxy] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to download file" });
      }
    }
  });

  // Student payments / invoices
  app.get("/api/my-payments", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT p.id, p.amount, p.currency, p.status, p.created_at,
                c.title AS course_title, c.price AS course_price
         FROM payments p
         JOIN courses c ON p.course_id = c.id
         WHERE p.user_id = $1 AND p.status = 'paid'
         ORDER BY p.created_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });

  // ==================== SUPPORT CHAT ROUTES ====================

  // Get messages for current user
  app.get("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [user.id]
      );
      // Mark admin messages as read
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE",
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Send message (student)
  app.post("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'user', $2, $3) RETURNING *",
        [user.id, message.trim().slice(0, 1000), Date.now()]
      );
      // Notify all admins — skip inserting into notifications since support has its own tab/badge
      // (inserting here causes support messages to appear in the bell icon notification list)
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  // Admin: get all support conversations
  app.get("/api/admin/support/conversations", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT u.id AS user_id, u.name, u.email, u.phone,
               COUNT(sm.id) FILTER (WHERE sm.is_read = FALSE AND sm.sender = 'user') AS unread_count,
               MAX(sm.created_at) AS last_message_at,
               (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message
        FROM users u
        JOIN support_messages sm ON sm.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.phone
        ORDER BY last_message_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  // Admin: get messages for a specific user
  app.get("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [req.params.userId]
      );
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE",
        [req.params.userId]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  // Admin: reply to a user
  app.post("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'admin', $2, $3) RETURNING *",
        [req.params.userId, message.trim().slice(0, 1000), Date.now()]
      );
      // Skip inserting into notifications — student sees replies in the Support tab, not the bell
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to send reply" });
    }
  });

  // ==================== BOOKS / STORE ROUTES ====================
  app.get("/api/books", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      // Students don't see hidden books; admins see all
      const isAdmin = user?.role === "admin";
      const result = await db.query(
        isAdmin
          ? "SELECT * FROM books ORDER BY created_at DESC"
          : "SELECT * FROM books WHERE is_published = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at DESC"
      );
      const books = result.rows;
      if (user) {
        const purchased = await db.query("SELECT book_id FROM book_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchased.rows.map((r: any) => r.book_id));
        books.forEach((b: any) => { b.isPurchased = purchasedIds.has(b.id); });
      }
      res.json(books);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });

  app.get("/api/my-books", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT b.*, bp.purchased_at FROM books b
         JOIN book_purchases bp ON b.id = bp.book_id
         WHERE bp.user_id = $1 ORDER BY bp.purchased_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch purchased books" });
    }
  });

  // Admin: manage books
  app.get("/api/admin/books", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM books ORDER BY created_at DESC");
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });

  app.post("/api/admin/books", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const result = await db.query(
        `INSERT INTO books (title, description, author, price, original_price, cover_url, file_url, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description || "", author || "", price || 0, originalPrice || 0, coverUrl || null, fileUrl || null, isPublished !== false, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to create book" });
    }
  });

  app.put("/api/admin/books/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      await db.query(
        `UPDATE books SET title=$1, description=$2, author=$3, price=$4, original_price=$5, cover_url=$6, file_url=$7, is_published=$8 WHERE id=$9`,
        [title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished, req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  // Toggle hide/unhide a book
  app.put("/api/admin/books/:id/hide", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { hidden } = req.body;
      await db.query("UPDATE books SET is_hidden = $1 WHERE id = $2", [hidden, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update book" });
    }
  });

  app.delete("/api/admin/books/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM book_purchases WHERE book_id = $1", [req.params.id]);
      await db.query("DELETE FROM book_click_tracking WHERE book_id = $1", [req.params.id]).catch(() => {});
      await db.query("DELETE FROM books WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete book" });
    }
  });

  // Track book Buy Now click (for abandoned checkout analytics)
  app.post("/api/books/track-click", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      const { bookId } = req.body;
      if (!bookId) return res.json({ ok: true });
      // Check if already purchased
      const purchased = await db.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (purchased.rows.length > 0) return res.json({ ok: true });
      // Upsert click count
      const result = await db.query(`
        INSERT INTO book_click_tracking (user_id, book_id, click_count, created_at)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (user_id, book_id) DO UPDATE SET click_count = book_click_tracking.click_count + 1
        RETURNING click_count
      `, [user.id, bookId, Date.now()]);
      console.log(`[BookClick] user=${user.id} book=${bookId} count=${result.rows[0]?.click_count}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[BookBuyNow] track-click error:", err);
      res.json({ ok: true });
    }
  });

  // Create Razorpay order for book
  app.post("/api/books/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId } = req.body;
      if (!bookId) return res.status(400).json({ message: "Book ID required" });
      console.log(`[BookOrder] user=${user.id} bookId=${bookId}`);
      const bookResult = await db.query("SELECT * FROM books WHERE id = $1", [bookId]);
      if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
      const book = bookResult.rows[0];
      if (parseFloat(book.price) === 0) return res.status(400).json({ message: "This book is free" });
      const alreadyPurchased = await db.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (alreadyPurchased.rows.length > 0) return res.status(400).json({ message: "Already purchased" });
      const amount = Math.round(parseFloat(book.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({
        amount, currency: "INR",
        receipt: `book_${bookId}_user_${user.id}_${Date.now()}`,
        notes: { bookId: bookId.toString(), userId: user.id.toString(), bookTitle: book.title },
      });
      console.log(`[BookOrder] created orderId=${order.id} amount=${amount}`);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, bookTitle: book.title, bookId });
    } catch (err) {
      console.error("Book create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  // Verify book payment
  app.post("/api/books/verify-payment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db.query(
        "INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING",
        [user.id, bookId, Date.now()]
      );
      // Remove from click tracking (now purchased)
      await db.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [user.id, bookId]).catch(() => {});
      res.json({ success: true });
    } catch (err) {
      console.error("Book verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  // ==================== TEST PAYMENT ROUTES ====================
  app.post("/api/tests/create-order", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { testId } = req.body;
      const testResult = await db.query("SELECT id, title, price FROM tests WHERE id = $1", [testId]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      if (!test.price || parseFloat(test.price) <= 0) return res.status(400).json({ message: "This test is free" });
      // Check already purchased
      const existing = await db.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
      if (existing.rows.length > 0) return res.json({ alreadyPurchased: true });
      const amount = Math.round(parseFloat(test.price) * 100);
      const razorpay = getRazorpay();
      const order = await razorpay.orders.create({ amount, currency: "INR", receipt: `test_${testId}_user_${user.id}_${Date.now()}` });
      res.json({ orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, testName: test.title });
    } catch (err) {
      console.error("Test create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  app.post("/api/tests/verify-payment", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testId } = req.body;
      const isValid = verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [user.id, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Test verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });

  // Check if user has purchased a test
  app.get("/api/tests/:id/purchased", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ purchased: false });
      const result = await db.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, req.params.id]);
      res.json({ purchased: result.rows.length > 0 });
    } catch (err) {
      res.json({ purchased: false });
    }
  });

  // Change password
  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { oldPassword, newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ message: "New password must be at least 6 characters" });
      const dbUser = await db.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (dbUser.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const { createHash } = await import("crypto");
      if (oldPassword) {
        const oldHash = createHash("sha256").update(oldPassword + String(user.id)).digest("hex");
        if (oldHash !== dbUser.rows[0].password_hash) return res.status(401).json({ message: "Current password is incorrect" });
      }
      const newHash = createHash("sha256").update(newPassword + String(user.id)).digest("hex");
      await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to change password" });
    }
  });

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

      // Access control — admins and free-preview lectures bypass enrollment check
      if (user.role !== "admin" && !lecture.is_free_preview) {
        if (lecture.course_id) {
          const enrolled = await db.query(
            "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, lecture.course_id]
          );
          if (enrolled.rows.length === 0) {
            return res.status(403).json({ message: "Enrollment required to access this lecture" });
          }
        }
      }

      res.json(lecture);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch lecture" });
    }
  });

  app.get("/api/lectures/:id/progress", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ is_completed: false });
      const result = await db.query(
        "SELECT is_completed, watch_percent FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0 });
      res.json(result.rows[0]);
    } catch (err) {
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
        await db.query(
          "UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3",
          [req.params.id, user.id, courseId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });

  // ==================== TESTS ROUTES ====================
  // Student-facing test folders (mini practice courses)
  app.get("/api/test-folders", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const result = await db.query(
        "SELECT sf.*, (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = sf.id) as total_tests FROM standalone_folders sf WHERE sf.type = 'mini_course' AND (sf.is_hidden = FALSE OR sf.is_hidden IS NULL) ORDER BY sf.created_at DESC"
      );
      const folders = result.rows.map((f: any) => ({ ...f, is_purchased: false }));
      if (user) {
        const purchases = await db.query("SELECT folder_id FROM folder_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchases.rows.map((p: any) => p.folder_id));
        for (const f of folders) f.is_purchased = f.is_free || purchasedIds.has(f.id);
      } else {
        for (const f of folders) f.is_purchased = f.is_free;
      }
      res.json(folders);
    } catch (err) {
      console.error("Test folders error:", err);
      res.status(500).json({ message: "Failed to fetch test folders" });
    }
  });

  app.get("/api/test-folders/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      const f = folder.rows[0];
      const tests = await db.query("SELECT t.*, t.folder_name as sub_folder FROM tests t WHERE t.mini_course_id = $1 ORDER BY t.folder_name ASC NULLS LAST, t.created_at ASC", [f.id]);
      let isPurchased = f.is_free;
      let attempts: Record<number, any> = {};
      if (user) {
        const purchase = await db.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, f.id]);
        if (purchase.rows.length > 0) isPurchased = true;
        if (tests.rows.length > 0) {
          const attemptsResult = await db.query(
            "SELECT test_id, score, total_marks, completed_at FROM test_attempts WHERE user_id = $1 AND test_id = ANY($2) AND completed_at IS NOT NULL ORDER BY score DESC",
            [user.id, tests.rows.map((t: any) => t.id)]
          );
          for (const a of attemptsResult.rows) {
            if (!attempts[a.test_id]) attempts[a.test_id] = a;
          }
        }
      }
      res.json({ ...f, is_purchased: isPurchased, tests: tests.rows, attempts });
    } catch (err) {
      console.error("Test folder detail error:", err);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });

  app.post("/api/test-folders/:id/enroll", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      if (!folder.rows[0].is_free) return res.status(400).json({ message: "This folder requires payment" });
      await db.query("INSERT INTO folder_purchases (user_id, folder_id, amount) VALUES ($1, $2, 0) ON CONFLICT (user_id, folder_id) DO NOTHING", [user.id, req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to enroll" });
    }
  });

  app.get("/api/tests", async (req: Request, res: Response) => {
    try {
      const { courseId, type } = req.query;
      // Show published tests + scheduled upcoming tests
      let query = `SELECT t.*, c.is_free AS course_is_free, c.price AS course_price, c.title AS course_title, c.id AS course_id_ref FROM tests t LEFT JOIN courses c ON t.course_id = c.id WHERE TRUE`;
      const params: unknown[] = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND course_id = $${params.length}`;
      } else {
        // Test Series tab: show only standalone tests (not linked to any course)
        query += ` AND course_id IS NULL`;
      }
      if (type) {
        params.push(type);
        query += ` AND test_type = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      const user = await getAuthUser(req);
      const result = await db.query(query, params);
      let tests: any[] = result.rows;
      // Overlay lock status based on enrollment
      if (user) {
        const enrollResult = await db.query("SELECT course_id FROM enrollments WHERE user_id = $1", [user.id]);
        const enrolledIds = new Set(enrollResult.rows.map((e: any) => Number(e.course_id)));
        tests = tests.map((t: any) => ({
          ...t,
          isLocked: t.course_id && !t.course_is_free && !enrolledIds.has(Number(t.course_id)),
        }));
      } else {
        tests = tests.map((t: any) => ({
          ...t,
          isLocked: !!(t.course_id && !t.course_is_free),
        }));
      }
      res.set("Cache-Control", "private, no-store");
      res.json(tests);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.get("/api/tests/:id", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const testResult = await db.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];

      // Access control — admins bypass
      if (user.role !== "admin") {
        if (test.course_id) {
          const enrolled = await db.query(
            "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, test.course_id]
          );
          if (enrolled.rows.length === 0) {
            return res.status(403).json({ message: "Enrollment required to access this test" });
          }
        } else if (test.mini_course_id && !test.folder_is_free) {
          const purchased = await db.query(
            "SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2",
            [user.id, test.mini_course_id]
          );
          if (purchased.rows.length === 0) {
            return res.status(403).json({ message: "Purchase required to access this test" });
          }
        } else if (test.price && parseFloat(test.price) > 0) {
          const purchased = await db.query(
            "SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2",
            [user.id, req.params.id]
          );
          if (purchased.rows.length === 0) {
            return res.status(403).json({ message: "Purchase required to access this test" });
          }
        }
      }

      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      res.json({ ...test, questions: questionsResult.rows });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch test" });
    }
  });

  app.post("/api/tests/:id/attempt", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { answers, timeTakenSeconds, questionTimes } = req.body;
      const timeTaken = parseInt(String(timeTakenSeconds || "0")) || 0;
      console.log(`[Attempt] test=${req.params.id} user=${user.id} answers=${JSON.stringify(answers)?.slice(0,100)} timeTaken=${timeTaken}`);
      const testResult = await db.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];

      // Access control — admins bypass all checks
      if (user.role !== "admin") {
        if (test.course_id) {
          // Course test: must be enrolled regardless of whether course is free or paid
          const enrolled = await db.query(
            "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, test.course_id]
          );
          if (enrolled.rows.length === 0) {
            return res.status(403).json({ message: "Enrollment required to attempt this test" });
          }
        } else if (test.mini_course_id) {
          // Folder/mini-course test: must have purchased the folder (unless folder is free)
          if (!test.folder_is_free) {
            const purchased = await db.query(
              "SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2",
              [user.id, test.mini_course_id]
            );
            if (purchased.rows.length === 0) {
              return res.status(403).json({ message: "Purchase required to attempt this test" });
            }
          }
        } else if (test.price && parseFloat(test.price) > 0) {
          // Standalone paid test: must have purchased it
          const purchased = await db.query(
            "SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2",
            [user.id, req.params.id]
          );
          if (purchased.rows.length === 0) {
            return res.status(403).json({ message: "Purchase required to attempt this test" });
          }
        }
        // else: free standalone test — open to all authenticated users
      }
      const questionsResult = await db.query("SELECT * FROM questions WHERE test_id = $1", [req.params.id]);
      const questions = questionsResult.rows;

      let score = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let attemptedCount = 0;
      const topicErrors: Record<string, number> = {};
      const answersMap = typeof answers === "string" ? JSON.parse(answers) : (answers || {});
      questions.forEach((q: Record<string, unknown>) => {
        const userAnswer = answersMap[String(q.id)] || answersMap[q.id as number];
        if (userAnswer) attemptedCount++;
        if (userAnswer === q.correct_option) {
          score += q.marks as number;
          correctCount++;
        } else if (userAnswer) {
          score -= parseFloat(q.negative_marks as string) || 0;
          incorrectCount++;
          const topic = q.topic as string || "General";
          topicErrors[topic] = (topicErrors[topic] || 0) + 1;
        }
      });

      const percentage = test.total_marks > 0 ? ((score / test.total_marks) * 100).toFixed(2) : 0;

      let attemptResult;
      try {
        attemptResult = await db.query(
          `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, question_times, status, started_at, completed_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12, $13) RETURNING id`,
          [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, questionTimes ? JSON.stringify(questionTimes) : null, Date.now() - (timeTaken * 1000), Date.now()]
        );
      } catch (_e1) {
        try {
          attemptResult = await db.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, Date.now() - (timeTaken * 1000), Date.now()]
          );
        } catch (_e2) {
          attemptResult = await db.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, Date.now() - (timeTaken * 1000), Date.now()]
          );
        }
      }
      const weakTopics = Object.entries(topicErrors)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([topic]) => topic);

      // Update course progress based on all content (lectures + tests)
      if (test.course_id) {
        try {
          await updateCourseProgress(user.id, test.course_id);
        } catch (_pe) { /* non-critical */ }
      }

      res.json({
        attemptId: attemptResult.rows[0].id,
        score: Math.max(0, Math.round(score * 100) / 100),
        totalMarks: test.total_marks,
        percentage,
        correct: correctCount,
        incorrect: incorrectCount,
        attempted: attemptedCount,
        testType: test.test_type,
        weakTopics,
        passed: score >= (test.passing_marks || 0),
        questions: questions.map((q: Record<string, unknown>) => ({
          ...q,
          userAnswer: answersMap[String(q.id)] || answersMap[q.id as number] || null,
          isCorrect: (answersMap[String(q.id)] || answersMap[q.id as number]) === q.correct_option,
        })),
      });
    } catch (err) {
      console.error("[Attempt] Submit error:", err);
      res.status(500).json({ message: "Failed to submit test", detail: String(err) });
    }
  });

  // Get all attempts for a specific test by the current user (most recent first)
  app.get("/api/tests/:id/my-attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // Alias with underscore for compatibility
  app.get("/api/tests/:id/my_attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // Analysis: topic breakdown + topper/avg comparison for a specific attempt
  app.get("/api/tests/:id/analysis/:attemptId", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      // Get the user's attempt
      const attemptRes = await db.query(
        "SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2",
        [req.params.attemptId, user.id]
      );
      if (attemptRes.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const attempt = attemptRes.rows[0];
      const answers = typeof attempt.answers === "string" ? JSON.parse(attempt.answers) : attempt.answers || {};

      // Get questions with topics
      const questionsRes = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      const questions = questionsRes.rows;

      // Build topic breakdown
      const topicMap: Record<string, { total: number; correct: number; wrong: number; skipped: number; qNums: number[] }> = {};
      questions.forEach((q: any, idx: number) => {
        const topic = q.topic || "Uncategorized";
        if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0, wrong: 0, skipped: 0, qNums: [] };
        const ua = answers[String(q.id)] || answers[q.id];
        topicMap[topic].total++;
        topicMap[topic].qNums.push(idx + 1);
        if (!ua) topicMap[topic].skipped++;
        else if (ua === q.correct_option) topicMap[topic].correct++;
        else topicMap[topic].wrong++;
      });

      const topics = Object.entries(topicMap).map(([name, data]) => ({
        name,
        total: data.total,
        correct: data.correct,
        wrong: data.wrong,
        skipped: data.skipped,
        correctPct: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
        qNums: data.qNums,
        isWeak: data.total > 0 && (data.correct / data.total) < 0.5,
      }));

      // Topper: best attempt on this test
      const topperRes = await db.query(
        `SELECT DISTINCT ON (user_id) score, total_marks, percentage, correct, incorrect, attempted, time_taken_seconds
         FROM test_attempts WHERE test_id = $1 AND status = 'completed'
         ORDER BY user_id, score DESC, time_taken_seconds ASC`,
        [req.params.id]
      );
      const allAttempts = topperRes.rows;
      const topper = allAttempts.sort((a: any, b: any) => parseFloat(b.score) - parseFloat(a.score))[0];

      // Average across all users
      const avgRes = await db.query(
        `SELECT AVG(score::numeric) as avg_score, AVG(percentage::numeric) as avg_pct,
                AVG(correct) as avg_correct, AVG(incorrect) as avg_incorrect,
                AVG(time_taken_seconds) as avg_time
         FROM (
           SELECT DISTINCT ON (user_id) score, percentage, correct, incorrect, time_taken_seconds
           FROM test_attempts WHERE test_id = $1 AND status = 'completed'
           ORDER BY user_id, score DESC
         ) sub`,
        [req.params.id]
      );
      const avg = avgRes.rows[0];

      // Calculate correct/incorrect from answers if not stored
      let youCorrect = attempt.correct != null ? parseInt(attempt.correct) : null;
      let youIncorrect = attempt.incorrect != null ? parseInt(attempt.incorrect) : null;
      if (youCorrect === null || youIncorrect === null) {
        let c = 0, w = 0;
        questions.forEach((q: any) => {
          const ua = answers[String(q.id)] || answers[q.id];
          if (ua === q.correct_option) c++;
          else if (ua) w++;
        });
        youCorrect = c;
        youIncorrect = w;
      }

      res.json({
        topics,
        topper: topper ? {
          score: parseFloat(topper.score),
          totalMarks: topper.total_marks,
          percentage: parseFloat(topper.percentage),
          correct: topper.correct != null ? topper.correct : null,
          incorrect: topper.incorrect != null ? topper.incorrect : null,
          timeTaken: topper.time_taken_seconds || 0,
        } : null,
        avg: avg ? {
          score: parseFloat(avg.avg_score) || 0,
          percentage: parseFloat(avg.avg_pct) || 0,
          correct: avg.avg_correct != null ? Math.round(parseFloat(avg.avg_correct)) : null,
          incorrect: avg.avg_incorrect != null ? Math.round(parseFloat(avg.avg_incorrect)) : null,
          timeTaken: Math.round(parseFloat(avg.avg_time) || 0),
        } : null,
        you: {
          score: parseFloat(attempt.score),
          totalMarks: attempt.total_marks,
          percentage: parseFloat(attempt.percentage),
          correct: youCorrect,
          incorrect: youIncorrect,
          timeTaken: attempt.time_taken_seconds || 0,
        },
      });
    } catch (err) {
      console.error("[Analysis]", err);
      res.status(500).json({ message: "Failed to fetch analysis" });
    }
  });

  app.get("/api/tests/:id/leaderboard", async (req: Request, res: Response) => {
    try {
      // Best attempt per user (highest score, then fastest time)
      const result = await db.query(
        `SELECT DISTINCT ON (ta.user_id)
           ta.score, ta.percentage, ta.time_taken_seconds, u.name, u.id as user_id
         FROM test_attempts ta JOIN users u ON ta.user_id = u.id 
         WHERE ta.test_id = $1 AND ta.status = 'completed' 
         ORDER BY ta.user_id, ta.score DESC, ta.time_taken_seconds ASC`,
        [req.params.id]
      );
      // Re-sort by score desc, time asc for final ranking
      const sorted = result.rows.sort((a: any, b: any) => {
        const scoreDiff = parseFloat(b.score) - parseFloat(a.score);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.time_taken_seconds || 0) - (b.time_taken_seconds || 0);
      });
      const leaderboard = sorted.slice(0, 20).map((r: Record<string, unknown>, i: number) => ({ ...r, rank: i + 1 }));
      res.json(leaderboard);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.get("/api/my-attempts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      // Only return attempts for tests in test_series courses or standalone (no course)
      const result = await db.query(
        `SELECT ta.*, t.title, t.total_marks, t.test_type FROM test_attempts ta 
         JOIN tests t ON ta.test_id = t.id 
         WHERE ta.user_id = $1 AND ta.status = 'completed'
           AND (t.course_id IS NULL OR t.course_id IN (SELECT id FROM courses WHERE course_type = 'test_series'))
         ORDER BY ta.completed_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // Summary: first attempt per test for the current user (all tests, not just test series)
  app.get("/api/my-attempts/summary", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      // Get the FIRST attempt per test (oldest completed_at) — ALL tests
      const result = await db.query(
        `SELECT DISTINCT ON (ta.test_id)
           ta.test_id, ta.id AS attempt_id, ta.score, ta.total_marks, ta.percentage,
           ta.correct, ta.incorrect, ta.attempted, ta.time_taken_seconds, ta.completed_at
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.status = 'completed'
         ORDER BY ta.test_id, ta.completed_at ASC`,
        [user.id]
      );
      const summary: Record<number, any> = {};
      result.rows.forEach((row: any) => { summary[row.test_id] = row; });
      res.json(summary);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempt summary" });
    }
  });

  // Attempt detail: questions + student answers for verify screen
  app.get("/api/attempts/:attemptId/detail", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const attempt = await db.query(
        "SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2",
        [req.params.attemptId, user.id]
      );
      if (attempt.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const att = attempt.rows[0];
      const questions = await db.query(
        "SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index",
        [att.test_id]
      );
      const answers = typeof att.answers === "string" ? JSON.parse(att.answers) : att.answers || {};
      const qTimes = att.question_times ? (typeof att.question_times === "string" ? JSON.parse(att.question_times) : att.question_times) : {};
      res.json({
        attemptId: att.id,
        testId: att.test_id,
        score: att.score,
        totalMarks: att.total_marks,
        timeTakenSeconds: att.time_taken_seconds,
        questions: questions.rows.map((q: any) => ({
          ...q,
          userAnswer: answers[q.id] || null,
          isCorrect: answers[q.id] === q.correct_option,
          timeTaken: qTimes[q.id] || null,
        })),
      });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch attempt detail" });
    }
  });

  // Report a question
  app.post("/api/questions/:id/report", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { reason, details } = req.body;
      await db.query(
        `INSERT INTO question_reports (question_id, user_id, reason, details, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (question_id, user_id) DO UPDATE SET reason=$3, details=$4, created_at=$5`,
        [req.params.id, user.id, reason, details || null, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to submit report" });
    }
  });

  // ==================== DAILY MISSION ROUTES ====================
  app.get("/api/daily-missions", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
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
          mission.userTimeTaken = um.rows[0]?.time_taken || 0;
          mission.userAnswers = um.rows[0]?.answers || {};
          mission.userIncorrect = um.rows[0]?.incorrect || 0;
          mission.userSkipped = um.rows[0]?.skipped || 0;
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
      const user = await getAuthUser(req);
      const result = await db.query("SELECT * FROM daily_missions WHERE mission_date = CURRENT_DATE AND mission_type = 'daily_drill' LIMIT 1");
      if (result.rows.length === 0) return res.json(null);
      const mission = result.rows[0];
      if (user) {
        const um = await db.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
        mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
        mission.userScore = um.rows[0]?.score || 0;
        mission.userTimeTaken = um.rows[0]?.time_taken || 0;
        mission.userAnswers = um.rows[0]?.answers || {};
        mission.userIncorrect = um.rows[0]?.incorrect || 0;
        mission.userSkipped = um.rows[0]?.skipped || 0;
      }
      res.json(mission);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch daily mission" });
    }
  });

  app.post("/api/daily-mission/:id/complete", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { score, timeTaken, answers, incorrect, skipped } = req.body;
      // Ensure columns and constraints exist (safe migration)
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS time_taken INTEGER DEFAULT 0`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS incorrect INTEGER DEFAULT 0`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS skipped INTEGER DEFAULT 0`).catch(() => {});
      // Ensure unique constraint exists for ON CONFLICT to work
      await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_missions_unique ON user_missions(user_id, mission_id)`).catch(() => {});
      // Upsert the attempt
      await db.query(
        `INSERT INTO user_missions (user_id, mission_id, is_completed, score, completed_at, time_taken, answers, incorrect, skipped) 
         VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8) 
         ON CONFLICT (user_id, mission_id) DO UPDATE SET is_completed = TRUE, score = $3, completed_at = $4, time_taken = $5, answers = $6, incorrect = $7, skipped = $8`,
        [user.id, req.params.id, score, Date.now(), timeTaken || 0, JSON.stringify(answers || {}), incorrect || 0, skipped || 0]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[Mission Complete] Error:", err);
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

      // Also return standalone material folders (not hidden)
      let folders: any[] = [];
      if (free === "true") {
        const foldersResult = await db.query(
          "SELECT * FROM standalone_folders WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at ASC"
        );
        folders = foldersResult.rows;
      }

      res.json({ materials: result.rows, folders });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });

  // Get materials inside a standalone folder by folder name
  app.get("/api/study-materials/folder/:folderName", async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM study_materials WHERE section_title = $1 AND course_id IS NULL ORDER BY created_at DESC",
        [decodeURIComponent(String(req.params.folderName))]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch folder materials" });
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

      // Student/public view:
      // - Scheduled (not live, not completed) → visible to everyone
      // - Live (is_live = TRUE) → only enrolled/public/free
      // - Completed WITH recording → visible to enrolled students (as recordings)
      if (cid && user) {
        const result = await db.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            EXISTS(SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $2 AND (e.status = 'active' OR e.status IS NULL)) as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1 OR lc.course_id IS NULL)
           AND (
             -- Scheduled (upcoming)
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE)
             -- Currently live (enrollment check)
             OR (lc.is_live = TRUE AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE OR lc.course_id IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $2 AND (e.status = 'active' OR e.status IS NULL))))
             -- Completed with recording (enrolled students can watch)
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
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch live classes" });
    }
  });
  // Upcoming scheduled classes (for admin panel and student home)
  app.get("/api/upcoming-classes", async (req: Request, res: Response) => {
    try {
      // Include both scheduled (not completed) AND currently live classes
      const result = await db.query(`
        SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
        FROM live_classes lc
        LEFT JOIN courses c ON c.id = lc.course_id
        WHERE lc.is_completed IS NOT TRUE
        ORDER BY 
          lc.is_live DESC,          -- live classes first
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

      // Add enrollment status for the requesting user
      let isEnrolled = false;
      if (user && lc.course_id) {
        const enroll = await db.query(
          "SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
          [user.id, lc.course_id]
        );
        isEnrolled = enroll.rows.length > 0;
      }

      // Check access: free/public classes are open to all; paid classes need enrollment
      const hasAccess = !lc.course_id || lc.is_public || lc.is_free_preview || isEnrolled || user?.role === "admin";

      res.json({ ...lc, is_enrolled: isEnrolled, has_access: hasAccess });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch live class" });
    }
  });

  // POST /api/admin/live-classes/cleanup — mark orphaned live classes as completed
  // NOTE: Must be registered BEFORE /:id routes to avoid "cleanup" being treated as an id
  app.post("/api/admin/live-classes/cleanup", requireAdmin, async (req: Request, res: Response) => {
    try {
      console.log("[Cleanup] Starting live class cleanup...");
      const findResult = await db.query(`
        SELECT id, title FROM live_classes WHERE is_live = true ORDER BY scheduled_at DESC
      `);
      if (findResult.rows.length === 0) {
        return res.json({ success: true, message: "No cleanup needed", cleaned: 0, classes: [] });
      }
      const updateResult = await db.query(`
        UPDATE live_classes SET is_live = false, is_completed = true
        WHERE is_live = true RETURNING id, title
      `);
      console.log(`[Cleanup] Marked ${updateResult.rows.length} live classes as completed`);
      res.json({ success: true, message: `Marked ${updateResult.rows.length} live classes as completed`, cleaned: updateResult.rows.length, classes: updateResult.rows });
    } catch (err) {
      console.error("[Cleanup] Error:", err);
      res.status(500).json({ message: "Failed to cleanup live classes" });
    }
  });

  app.put("/api/admin/live-classes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];
      const add = (col: string, val: unknown) => { params.push(val); updates.push(col + " = $" + params.length); };
      if (isLive !== undefined) add("is_live", isLive);
      if (isCompleted !== undefined) add("is_completed", isCompleted);
      // Track when class goes live (for duration calculation)
      if (isLive === true) add("started_at", Date.now());
      // Calculate duration when class ends
      if (isCompleted === true || isLive === false) add("ended_at", Date.now());
      if (youtubeUrl !== undefined) add("youtube_url", youtubeUrl);
      if (title !== undefined) add("title", title);
      if (description !== undefined) add("description", description);
      if (scheduledAt !== undefined) add("scheduled_at", scheduledAt);
      if (notifyEmail !== undefined) add("notify_email", notifyEmail);
      if (notifyBell !== undefined) add("notify_bell", notifyBell);
      if (isFreePreview !== undefined) add("is_free_preview", isFreePreview);
      if (streamType !== undefined) add("stream_type", streamType);
      if (chatMode !== undefined) add("chat_mode", chatMode);
      if (showViewerCount !== undefined) add("show_viewer_count", showViewerCount);
      if (recordingUrl !== undefined) add("recording_url", recordingUrl);
      if (cfStreamUid !== undefined) add("cf_stream_uid", cfStreamUid);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== undefined) add("is_public", isPublicVal);
      if (updates.length === 0) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const whereIdx = "$" + params.length;
      const sql = "UPDATE live_classes SET " + updates.join(", ") + " WHERE id = " + whereIdx + " RETURNING *";
      const result = await db.query(sql, params);
      const liveClass = result.rows[0];

      // Send notification to enrolled students when going live (expires after 12 hours)
      if (isLive === true && liveClass.course_id) {
        const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = Date.now() + 12 * 3600000;
        for (const e of enrolled.rows) {
          await db.query(
            "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
            [e.user_id, "🔴 Live Class Started!", '"' + liveClass.title + '" is live now. Join now!', "info", Date.now(), expiresAt]
          );
        }
        console.log("[GoLive] Notification sent for '" + liveClass.title + "' to " + enrolled.rows.length + " students");
      }

      // When going live, also mark all other classes with the same title as live
      // so students in other courses see it as live too
      if (isLive === true) {
        const syncUpdates: string[] = [];
        const syncParams: unknown[] = [];
        const syncAdd = (col: string, val: unknown) => { syncParams.push(val); syncUpdates.push(col + " = $" + syncParams.length); };
        syncAdd("is_live", true);
        syncAdd("started_at", Date.now());
        if (youtubeUrl !== undefined) syncAdd("youtube_url", youtubeUrl);
        if (streamType !== undefined) syncAdd("stream_type", streamType);
        if (chatMode !== undefined) syncAdd("chat_mode", chatMode);
        if (showViewerCount !== undefined) syncAdd("show_viewer_count", showViewerCount);
        // cf stream info
        if (cfStreamUid !== undefined) syncAdd("cf_stream_uid", cfStreamUid);
        const cfStreamKey = (req.body as any).cfStreamKey;
        const cfStreamRtmpUrl = (req.body as any).cfStreamRtmpUrl;
        const cfPlaybackHls = (req.body as any).cfPlaybackHls;
        if (cfStreamKey !== undefined) syncAdd("cf_stream_key", cfStreamKey);
        if (cfStreamRtmpUrl !== undefined) syncAdd("cf_stream_rtmp_url", cfStreamRtmpUrl);
        if (cfPlaybackHls !== undefined) syncAdd("cf_playback_hls", cfPlaybackHls);

        syncParams.push(req.params.id);
        syncParams.push(liveClass.title);
        await db.query(
          `UPDATE live_classes SET ${syncUpdates.join(", ")} 
           WHERE id != $${syncParams.length - 1} 
             AND title = $${syncParams.length}
             AND is_completed IS NOT TRUE`,
          syncParams
        ).catch(() => {});

        // Send notifications for other courses too
        const otherClasses = await db.query(
          "SELECT course_id FROM live_classes WHERE id != $1 AND title = $2 AND is_completed IS NOT TRUE AND course_id IS NOT NULL",
          [req.params.id, liveClass.title]
        ).catch(() => ({ rows: [] as any[] }));
        const expiresAt = Date.now() + 12 * 3600000;
        for (const other of otherClasses.rows) {
          const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [other.course_id]).catch(() => ({ rows: [] as any[] }));
          for (const e of enrolled.rows) {
            await db.query(
              "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
              [e.user_id, "🔴 Live Class Started!", '"' + liveClass.title + '" is live now. Join now!', "info", Date.now(), expiresAt]
            ).catch(() => {});
          }
        }
      }

      if (isCompleted && convertToLecture && liveClass.youtube_url && liveClass.course_id) {
        // Delete live class notifications when ending (they're no longer relevant)
        await db.query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClass.title + '%']).catch(() => {});
        const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [liveClass.course_id]);
        await db.query(
          "INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [liveClass.course_id, liveClass.title, liveClass.description || "", liveClass.youtube_url, "youtube", 0, maxOrder.rows[0].next_order, false, sectionTitle || "Live Class Recordings", Date.now()]
        );
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [liveClass.course_id]);
      }
      // Also clean up live notifications if just completing without lecture conversion
      if (isCompleted && !convertToLecture && liveClass.title) {
        await db.query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClass.title + '%']).catch(() => {});
      }

      // When a live class ends, also mark any OTHER classes with the same title
      // as completed — handles classes scheduled across multiple courses
      if (isCompleted === true || isLive === false) {
        await db.query(
          `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live IS NOT TRUE 
             AND is_completed IS NOT TRUE
             AND title = $2`,
          [req.params.id, liveClass.title]
        ).catch(() => {});

        // Also end any currently live classes with the same title (started in other courses)
        await db.query(
          `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live = TRUE
             AND title = $2`,
          [req.params.id, liveClass.title]
        ).catch(() => {});
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

  app.put("/api/admin/study-materials/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, fileUrl, fileType, isFree, sectionTitle, downloadAllowed } = req.body;
      await db.query(
        `UPDATE study_materials SET title=$1, description=$2, file_url=$3, file_type=$4, is_free=$5, section_title=$6, download_allowed=$7 WHERE id=$8`,
        [title, description || "", fileUrl, fileType || "pdf", isFree || false, sectionTitle || null, downloadAllowed || false, req.params.id]
      );
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update material" }); }
  });

  app.delete("/api/admin/study-materials/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get material details before deletion
      const material = await db.query("SELECT file_url, course_id FROM study_materials WHERE id = $1", [req.params.id]);
      
      if (material.rows.length > 0 && material.rows[0].file_url) {
        // Delete from R2
        try {
          const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
          const r2 = await getR2Client();
          
          // Extract R2 key from URL
          let r2Key = material.rows[0].file_url;
          if (r2Key.startsWith("http")) {
            try {
              const url = new URL(r2Key);
              r2Key = url.pathname.substring(1); // Remove leading /
            } catch (_e) {
              // If URL parsing fails, use as-is
            }
          }
          
          const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: r2Key,
          });
          
          await r2.send(deleteCommand);
          console.log(`[R2] Deleted study material file: ${r2Key}`);
        } catch (r2Err) {
          console.error("[R2] Failed to delete study material file:", r2Err);
          // Continue with database deletion even if R2 deletion fails
        }
      }
      
      const courseId = material.rows[0]?.course_id;
      // Delete from database
      await db.query("DELETE FROM study_materials WHERE id = $1", [req.params.id]);
      // Update total_materials count on the course
      if (courseId) {
        await db.query(
          "UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1",
          [courseId]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete study material error:", err);
      res.status(500).json({ message: "Failed to delete material" });
    }
  });

  // ==================== DOUBTS ROUTES ====================
  app.post("/api/doubts", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
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
      const user = await getAuthUser(req);
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
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const result = await db.query(
        `SELECT * FROM notifications WHERE user_id = $1
         AND (source IS NULL OR source != 'support')
         AND (is_hidden IS NOT TRUE)
         AND (expires_at IS NULL OR expires_at > $2)
         AND title NOT ILIKE 'New message from%'
         AND title NOT ILIKE 'New reply from Support%'
         ORDER BY created_at DESC LIMIT 50`,
        [user.id, now]
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

  async function requireAuth(req: Request, res: Response, next: () => void) {
    let user = (req.session as any).user as { id: number; name: string; phone: string; role: string } | undefined;
    if (!user) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
          const result = await db.query(
            "SELECT id, name, email, phone, role FROM users WHERE session_token = $1",
            [token]
          );
          if (result.rows.length > 0) {
            user = result.rows[0];
            (req.session as any).user = user;
          }
        } catch (_e) {}
      }
    }
    if (!user) {
      return res.status(401).json({ message: "Login required" });
    }
    (req as any).user = user;
    next();
  }

  // ==================== STANDALONE FOLDERS (Tests & Materials tabs) ====================
  app.get("/api/admin/standalone-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { type } = req.query;
      let q = "SELECT * FROM standalone_folders";
      const params: unknown[] = [];
      if (type) { params.push(type); q += ` WHERE type = $1`; }
      q += " ORDER BY created_at ASC";
      const result = await db.query(q, params);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Failed to fetch folders" }); }
  });

  app.post("/api/admin/standalone-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type, category, price, originalPrice, isFree, description } = req.body;
      if (type === "test" && category) {
        const result = await db.query(
          "INSERT INTO standalone_folders (name, type, category, price, original_price, is_free, description) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (name, type) DO UPDATE SET is_hidden = FALSE, category = $3, price = $4, original_price = $5, is_free = $6, description = $7 RETURNING *",
          [name, type, category || null, parseFloat(price) || 0, parseFloat(originalPrice) || 0, isFree !== false, description || null]
        );
        return res.json(result.rows[0]);
      }
      const result = await db.query(
        "INSERT INTO standalone_folders (name, type) VALUES ($1, $2) ON CONFLICT (name, type) DO UPDATE SET is_hidden = FALSE RETURNING *",
        [name, type]
      );
      res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ message: "Failed to create folder" }); }
  });

  app.put("/api/admin/standalone-folders/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, isHidden, category, price, originalPrice, isFree, description } = req.body;
      if (name !== undefined) {
        const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1", [req.params.id]);
        if (folder.rows.length > 0) {
          const oldName = folder.rows[0].name;
          const folderType = folder.rows[0].type;
          await db.query("UPDATE standalone_folders SET name = $1 WHERE id = $2", [name, req.params.id]);
          if (folderType === "test") await db.query("UPDATE tests SET folder_name = $1 WHERE folder_name = $2 AND course_id IS NULL", [name, oldName]);
          else if (folderType === "material") await db.query("UPDATE study_materials SET section_title = $1 WHERE section_title = $2 AND course_id IS NULL", [name, oldName]);
        }
      } else if (isHidden !== undefined) {
        await db.query("UPDATE standalone_folders SET is_hidden = $1 WHERE id = $2", [isHidden, req.params.id]);
      }
      // Update test folder extra fields
      if (category !== undefined) await db.query("UPDATE standalone_folders SET category = $1 WHERE id = $2", [category, req.params.id]);
      if (price !== undefined) await db.query("UPDATE standalone_folders SET price = $1 WHERE id = $2", [parseFloat(price) || 0, req.params.id]);
      if (originalPrice !== undefined) await db.query("UPDATE standalone_folders SET original_price = $1 WHERE id = $2", [parseFloat(originalPrice) || 0, req.params.id]);
      if (isFree !== undefined) await db.query("UPDATE standalone_folders SET is_free = $1 WHERE id = $2", [isFree, req.params.id]);
      if (description !== undefined) await db.query("UPDATE standalone_folders SET description = $1 WHERE id = $2", [description || null, req.params.id]);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update folder" }); }
  });

  app.delete("/api/admin/standalone-folders/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const folder = await db.query("SELECT * FROM standalone_folders WHERE id = $1", [req.params.id]);
      if (folder.rows.length > 0) {
        const { name, type } = folder.rows[0];
        if (type === "test") await db.query("DELETE FROM tests WHERE folder_name = $1 AND course_id IS NULL", [name]);
        else if (type === "material") await db.query("DELETE FROM study_materials WHERE section_title = $1 AND course_id IS NULL", [name]);
        await db.query("DELETE FROM standalone_folders WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to delete folder" }); }
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

  // Student profile photo upload presign (authenticated users, images folder only)
  app.post("/api/upload/presign-profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { filename, contentType } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      if (!contentType.startsWith("image/")) return res.status(400).json({ message: "Only image uploads allowed" });
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const ext = filename.split(".").pop() || "jpg";
      const key = `images/profile-${user.id}-${Date.now()}.${ext}`;
      const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
      const publicUrl = key;
      res.json({ uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Profile presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  // Generate presigned URL for direct upload from client to R2 (admin only)
  app.post("/api/upload/presign", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { filename, contentType, folder = "uploads" } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured. Check .env file." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const ext = filename.split(".").pop() || "";
      const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      // Use server proxy URL so files are accessible even without custom domain DNS
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  // Server-side upload to R2 (bypasses CORS — file goes through server)
  app.post("/api/upload/to-r2", requireAdmin, uploadLarge.single("file"), async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const folder = req.body.folder || "uploads";
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const ext = req.file.originalname.split(".").pop() || "";
      const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Server upload complete: ${key} (${req.file.size} bytes)`);
      res.json({ publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Server upload error:", err?.message || err);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  // Delete a file from R2
  app.delete("/api/upload/file", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ message: "key required" });
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
      res.json({ success: true });
    } catch (err) {
      console.error("[R2] Delete error:", err);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  // Proxy R2 files through the server (avoids CORS / DNS issues with custom domain)
  app.get("/api/media/:folder/:filename", async (req: Request, res: Response) => {
    try {
      const key = `${req.params.folder}/${req.params.filename}`;
      if (!key || key === "/") return res.status(400).json({ message: "No file key" });
      const { GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        // Handle Range requests for video seeking
        const head = await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
        const totalSize = head.ContentLength || 0;
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;

        const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Range: `bytes=${start}-${end}` });
        const obj = await r2.send(command);
        if (!obj.Body) return res.status(404).json({ message: "File not found" });

        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(chunkSize));
        if (head.ContentType) res.setHeader("Content-Type", head.ContentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Content-Disposition", "inline");

        const stream = obj.Body as any;
        if (typeof stream.pipe === "function") { stream.pipe(res); }
        else if (stream.transformToByteArray) { const bytes = await stream.transformToByteArray(); res.end(Buffer.from(bytes)); }
        else { res.status(500).json({ message: "Cannot stream file" }); }
      } else {
        // Full file request
        const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
        const obj = await r2.send(command);
        if (!obj.Body) return res.status(404).json({ message: "File not found" });

        if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
        if (obj.ContentLength) res.setHeader("Content-Length", String(obj.ContentLength));
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Content-Disposition", "inline");

        const stream = obj.Body as any;
        if (typeof stream.pipe === "function") { stream.pipe(res); }
        else if (stream.transformToByteArray) { const bytes = await stream.transformToByteArray(); res.end(Buffer.from(bytes)); }
        else { res.status(500).json({ message: "Cannot stream file" }); }
      }
    } catch (err: any) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      res.status(500).json({ message: "Failed to fetch file" });
    }
  });

  // ==================== SITE SETTINGS ROUTES ====================
  app.get("/api/site-settings", async (req: Request, res: Response) => {
    try {
      await db.query("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT)").catch(() => {});
      const result = await db.query("SELECT key, value FROM site_settings");
      const settings: Record<string, string> = {};
      for (const row of result.rows) settings[row.key] = row.value;
      res.json(settings);
    } catch (err) {
      console.error("[SiteSettings] Fetch error:", err);
      res.json({});
    }
  });

  app.put("/api/admin/site-settings", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== "object") return res.status(400).json({ message: "Settings object required" });
      await db.query("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT)").catch(() => {});
      for (const [key, value] of Object.entries(settings)) {
        await db.query(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
          [key, String(value), Date.now()]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[SiteSettings] Save error:", err);
      res.status(500).json({ message: "Failed to save settings" });
    }
  });

  app.post("/api/admin/courses", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, startDate, endDate, thumbnail, coverColor } = req.body;
      // Auto-assign a cover color if none provided
      const COVER_COLORS = ["#1A56DB","#7C3AED","#DC2626","#059669","#D97706","#0891B2","#DB2777","#EA580C"];
      const autoColor = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const result = await db.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, start_date, end_date, thumbnail, cover_color, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, TRUE, $16) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, courseType || "live", subject || "", startDate || null, endDate || null, thumbnail || null, coverColor || autoColor, Date.now()]
      );
      cacheInvalidate("courses:");
      res.json(result.rows[0]);
    } catch (err: any) {
      console.error("Create course error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create course" });
    }
  });

  app.put("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, thumbnail, coverColor } = req.body;
      await db.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), course_type=COALESCE($13, course_type), start_date=COALESCE($14, start_date), end_date=COALESCE($15, end_date), thumbnail=COALESCE($16, thumbnail), cover_color=COALESCE($17, cover_color) WHERE id=$18`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, thumbnail ?? null, coverColor ?? null, req.params.id]
      );
      cacheInvalidate("courses:");
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
            [targetCourseId, l.title, l.description || "", l.video_url, l.video_type || "youtube", l.duration_minutes || 0, orderIndex++, false, l.section_title || null, Date.now()]
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
      const targetCourseId = String(req.params.id);
      const { testIds } = req.body;
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }
      for (const testId of testIds) {
        const test = await db.query("SELECT * FROM tests WHERE id = $1", [testId]);
        if (test.rows.length > 0) {
          const t = test.rows[0];
          const newTest = await db.query(
            `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, total_questions, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [t.title, t.description, targetCourseId, t.duration_minutes, t.total_marks, t.passing_marks, t.test_type, t.folder_name || null, t.total_questions || 0, Date.now()]
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
      await updateCourseTestCounts(targetCourseId);
      res.json({ success: true, imported: testIds.length });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });

  app.post("/api/admin/courses/:id/import-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const targetCourseId = req.params.id;
      const { materialIds } = req.body;
      if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
        return res.status(400).json({ message: "No materials selected" });
      }
      for (const matId of materialIds) {
        const mat = await db.query("SELECT * FROM study_materials WHERE id = $1", [matId]);
        if (mat.rows.length > 0) {
          const m = mat.rows[0];
          await db.query(
            `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [m.title, m.description || "", m.file_url, m.file_type || "pdf", targetCourseId, false, m.section_title || null, m.download_allowed || false, Date.now()]
          );
        }
      }
      res.json({ success: true, imported: materialIds.length });
    } catch (err) {
      console.error("Import materials error:", err);
      res.status(500).json({ message: "Failed to import materials" });
    }
  });

  app.get("/api/admin/all-materials", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT sm.*, c.title as course_title, c.course_type 
        FROM study_materials sm 
        JOIN courses c ON sm.course_id = c.id 
        ORDER BY c.title, sm.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch materials" });
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

  // Course folders CRUD
  app.get("/api/admin/courses/:id/folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM course_folders WHERE course_id = $1 ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Failed to fetch folders" }); }
  });

  app.post("/api/admin/courses/:id/folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { name, type } = req.body;
      const result = await db.query(
        "INSERT INTO course_folders (course_id, name, type) VALUES ($1, $2, $3) ON CONFLICT (course_id, name, type) DO UPDATE SET is_hidden = FALSE RETURNING *",
        [req.params.id, name, type]
      );
      res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ message: "Failed to create folder" }); }
  });

  app.put("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { isHidden, name } = req.body;
      if (name !== undefined) {
        // Rename folder — also update all items that reference the old folder name
        const folder = await db.query("SELECT * FROM course_folders WHERE id = $1 AND course_id = $2", [req.params.folderId, req.params.id]);
        if (folder.rows.length > 0) {
          const oldName = folder.rows[0].name;
          const folderType = folder.rows[0].type;
          await db.query("UPDATE course_folders SET name = $1 WHERE id = $2 AND course_id = $3", [name, req.params.folderId, req.params.id]);
          // Update section_title on all items in this folder
          if (folderType === "lecture") {
            await db.query("UPDATE lectures SET section_title = $1 WHERE course_id = $2 AND section_title = $3", [name, req.params.id, oldName]);
          } else if (folderType === "material") {
            await db.query("UPDATE study_materials SET section_title = $1 WHERE course_id = $2 AND section_title = $3", [name, req.params.id, oldName]);
          } else if (folderType === "test") {
            await db.query("UPDATE tests SET folder_name = $1 WHERE course_id = $2 AND folder_name = $3", [name, req.params.id, oldName]);
          }
        }
      } else if (isHidden !== undefined) {
        await db.query("UPDATE course_folders SET is_hidden = $1 WHERE id = $2 AND course_id = $3", [isHidden, req.params.folderId, req.params.id]);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update folder" }); }
  });

  app.delete("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get folder info first
      const folder = await db.query("SELECT * FROM course_folders WHERE id = $1 AND course_id = $2", [req.params.folderId, req.params.id]);
      if (folder.rows.length > 0) {
        const { name, type } = folder.rows[0];
        // Delete all items in this folder
        if (type === "lecture") await db.query("DELETE FROM lectures WHERE course_id = $1 AND section_title = $2", [req.params.id, name]);
        else if (type === "test") await db.query("DELETE FROM tests WHERE course_id = $1 AND folder_name = $2", [req.params.id, name]);
        else if (type === "material") await db.query("DELETE FROM study_materials WHERE course_id = $1 AND section_title = $2", [req.params.id, name]);
        await db.query("DELETE FROM course_folders WHERE id = $1", [String(req.params.folderId)]);
        await updateCourseTestCounts(String(req.params.id));
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to delete folder" }); }
  });

  app.get("/api/admin/analytics", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { period, startDate, endDate } = req.query;

      // Build date filters
      const now = Date.now();
      const day = 86400000;
      let paymentDateFilter = "";
      let enrollDateFilter = "";
      let bookDateFilter = "";

      const buildFilters = () => {
        if (period === "today") {
          const start = new Date(); start.setHours(0,0,0,0);
          const ts = start.getTime();
          paymentDateFilter = `AND p.created_at >= ${ts}`;
          enrollDateFilter = `AND e.enrolled_at >= ${ts}`;
          bookDateFilter = `AND bp.purchased_at >= ${ts}`;
        } else if (period === "yesterday") {
          const start = new Date(); start.setHours(0,0,0,0); start.setDate(start.getDate()-1);
          const end = new Date(); end.setHours(0,0,0,0);
          paymentDateFilter = `AND p.created_at >= ${start.getTime()} AND p.created_at < ${end.getTime()}`;
          enrollDateFilter = `AND e.enrolled_at >= ${start.getTime()} AND e.enrolled_at < ${end.getTime()}`;
          bookDateFilter = `AND bp.purchased_at >= ${start.getTime()} AND bp.purchased_at < ${end.getTime()}`;
        } else if (period === "7days") {
          paymentDateFilter = `AND p.created_at >= ${now - 7*day}`;
          enrollDateFilter = `AND e.enrolled_at >= ${now - 7*day}`;
          bookDateFilter = `AND bp.purchased_at >= ${now - 7*day}`;
        } else if (period === "15days") {
          paymentDateFilter = `AND p.created_at >= ${now - 15*day}`;
          enrollDateFilter = `AND e.enrolled_at >= ${now - 15*day}`;
          bookDateFilter = `AND bp.purchased_at >= ${now - 15*day}`;
        } else if (period === "30days") {
          paymentDateFilter = `AND p.created_at >= ${now - 30*day}`;
          enrollDateFilter = `AND e.enrolled_at >= ${now - 30*day}`;
          bookDateFilter = `AND bp.purchased_at >= ${now - 30*day}`;
        } else if (period === "custom" && startDate && endDate) {
          const s = new Date(String(startDate)).getTime();
          const e2 = new Date(String(endDate)).getTime() + day;
          paymentDateFilter = `AND p.created_at >= ${s} AND p.created_at < ${e2}`;
          enrollDateFilter = `AND e.enrolled_at >= ${s} AND e.enrolled_at < ${e2}`;
          bookDateFilter = `AND bp.purchased_at >= ${s} AND bp.purchased_at < ${e2}`;
        }
      };
      buildFilters();

      // Run all queries in parallel to minimize round-trips to Neon
      const [
        revenueResult,
        enrollResult,
        lifetimeResult,
        lifetimeEnrollResult,
        courseBreakdown,
        recentPurchases,
        abandonedResult,
        bookPurchases,
        lifetimeBookRevenue,
        bookAbandonedResult,
        testPurchases,
        lifetimeTestRevenue,
      ] = await Promise.all([
        db.query(`SELECT COALESCE(SUM(p.amount), 0) as total_revenue FROM payments p WHERE p.status = 'paid' ${paymentDateFilter}`),
        db.query(`SELECT COUNT(*) as total_enrollments FROM enrollments e WHERE 1=1 ${enrollDateFilter}`),
        db.query(`SELECT COALESCE(SUM(amount), 0) as lifetime_revenue FROM payments WHERE status = 'paid'`),
        db.query(`SELECT COUNT(*) as cnt FROM enrollments`),
        db.query(`
          SELECT c.id, c.title, c.category, c.price, c.is_free, c.course_type,
                 COUNT(DISTINCT e.id) as enrollment_count,
                 COALESCE(SUM(p.amount), 0) as revenue
          FROM courses c
          LEFT JOIN enrollments e ON e.course_id = c.id ${enrollDateFilter.replace(/e\./g, "e.")}
          LEFT JOIN payments p ON p.course_id = c.id AND p.status = 'paid' ${paymentDateFilter.replace(/p\./g, "p.")}
          GROUP BY c.id, c.title, c.category, c.price, c.is_free, c.course_type
          ORDER BY enrollment_count DESC
        `),
        db.query(`
          SELECT p.id, p.created_at, p.amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE p.status = 'paid' ${paymentDateFilter}
          ORDER BY p.created_at DESC LIMIT 20
        `),
        db.query(`
          SELECT MIN(p.id) as id, MAX(p.created_at) as created_at, MAX(p.amount) as amount,
                 SUM(COALESCE(p.click_count, 1)) as click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category, c.price
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE (p.status = 'created' OR p.status IS NULL)
          GROUP BY p.user_id, p.course_id, u.name, u.phone, u.email, c.title, c.category, c.price
          ORDER BY click_count DESC, MAX(p.created_at) DESC LIMIT 100
        `),
        db.query(`
          SELECT bp.id, bp.purchased_at as created_at, b.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.cover_url
          FROM book_purchases bp
          JOIN users u ON u.id = bp.user_id
          JOIN books b ON b.id = bp.book_id
          WHERE 1=1 ${bookDateFilter}
          ORDER BY bp.purchased_at DESC LIMIT 100
        `),
        db.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM book_purchases bp JOIN books b ON b.id = bp.book_id`),
        db.query(`
          SELECT bct.id, bct.created_at, bct.click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.price
          FROM book_click_tracking bct
          JOIN users u ON u.id = bct.user_id
          JOIN books b ON b.id = bct.book_id
          ORDER BY bct.click_count DESC, bct.created_at DESC LIMIT 100
        `),
        db.query(`
          SELECT tp.id, tp.created_at, t.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 t.title as test_title, t.test_type
          FROM test_purchases tp
          JOIN users u ON u.id = tp.user_id
          JOIN tests t ON t.id = tp.test_id
          ORDER BY tp.created_at DESC LIMIT 100
        `).catch(() => ({ rows: [] })),
        db.query(`SELECT COALESCE(SUM(t.price), 0) as total FROM test_purchases tp JOIN tests t ON t.id = tp.test_id`).catch(() => ({ rows: [{ total: 0 }] })),
      ]);

      res.json({
        totalEnrollments: parseInt(enrollResult.rows[0]?.total_enrollments || "0"),
        totalRevenue: parseFloat(revenueResult.rows[0]?.total_revenue || "0"),
        lifetimeRevenue: parseFloat(lifetimeResult.rows[0]?.lifetime_revenue || "0"),
        lifetimeEnrollments: parseInt(lifetimeEnrollResult.rows[0]?.cnt || "0"),
        lifetimeBookRevenue: parseFloat(lifetimeBookRevenue.rows[0]?.total || "0"),
        lifetimeTestRevenue: parseFloat(lifetimeTestRevenue.rows[0]?.total || "0"),
        courseBreakdown: courseBreakdown.rows,
        recentPurchases: recentPurchases.rows,
        abandonedCheckouts: abandonedResult.rows,
        bookPurchases: bookPurchases.rows,
        bookAbandonedCheckouts: bookAbandonedResult.rows,
        testPurchases: testPurchases.rows,
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  app.get("/api/admin/courses/:id/enrollments", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT e.id, e.user_id, u.name AS user_name, u.phone AS user_phone, u.email AS user_email,
                e.enrolled_at, e.progress_percent, COALESCE(e.status, 'active') AS status
         FROM enrollments e JOIN users u ON e.user_id = u.id
         WHERE e.course_id = $1 ORDER BY e.enrolled_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });

  app.put("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { status, valid_until } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];
      
      if (status !== undefined) {
        params.push(status);
        updates.push(`status = $${params.length}`);
      }
      
      if (valid_until !== undefined) {
        params.push(valid_until);
        updates.push(`valid_until = $${params.length}`);
      }
      
      if (updates.length > 0) {
        params.push(req.params.id);
        await db.query(
          `UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`,
          params
        );
      }
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update enrollment" });
    }
  });

  app.delete("/api/admin/enrollments/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get enrollment details before deleting
      const enrollment = await db.query(
        "SELECT user_id, course_id FROM enrollments WHERE id = $1",
        [req.params.id]
      );
      
      if (enrollment.rows.length > 0) {
        const { user_id, course_id } = enrollment.rows[0];
        
        // Delete enrollment
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
        
        // Clean up downloads for this user-course combination
        await deleteDownloadsForUser(user_id, course_id);
      } else {
        await db.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
      }
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to remove enrollment" });
    }
  });

  app.delete("/api/admin/courses/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const courseId = req.params.id;
      
      // Clean up downloads for this course (all users)
      await deleteDownloadsForCourse(parseInt(Array.isArray(courseId) ? courseId[0] : courseId));
      
      await db.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
      await db.query("DELETE FROM courses WHERE id = $1", [courseId]);
      cacheInvalidate("courses:");
      cacheInvalidate("tests:");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
      res.status(500).json({ message: "Failed to delete course" });
    }
  });

  app.post("/api/admin/lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { courseId, title, description, videoUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } = req.body;
      const result = await db.query(
        `INSERT INTO lectures (course_id, title, description, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [courseId, title, description, videoUrl, videoType || "youtube", pdfUrl, durationMinutes || 0, orderIndex || 0, isFreePreview || false, sectionTitle || null, downloadAllowed || false, Date.now()]
      );
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [courseId]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add lecture" });
    }
  });

  app.put("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, videoUrl, videoType, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } = req.body;
      await db.query(
        `UPDATE lectures SET title=$1, description=$2, video_url=$3, video_type=$4, duration_minutes=$5, order_index=$6, is_free_preview=$7, section_title=$8, download_allowed=$9 WHERE id=$10`,
        [title, description || "", videoUrl, videoType || "youtube", parseInt(durationMinutes) || 0, parseInt(orderIndex) || 0, isFreePreview || false, sectionTitle || null, downloadAllowed || false, req.params.id]
      );
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update lecture" }); }
  });

  app.delete("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get lecture details before deletion
      const lec = await db.query("SELECT course_id, video_url FROM lectures WHERE id = $1", [req.params.id]);
      
      if (lec.rows.length > 0) {
        const lecture = lec.rows[0];
        
        // Delete from R2 if video_url exists
        if (lecture.video_url) {
          try {
            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const r2 = await getR2Client();
            
            // Extract R2 key from URL
            let r2Key = lecture.video_url;
            if (r2Key.startsWith("http")) {
              try {
                const url = new URL(r2Key);
                r2Key = url.pathname.substring(1); // Remove leading /
              } catch (_e) {
                // If URL parsing fails, use as-is
              }
            }
            
            const deleteCommand = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key,
            });
            
            await r2.send(deleteCommand);
            console.log(`[R2] Deleted lecture file: ${r2Key}`);
          } catch (r2Err) {
            console.error("[R2] Failed to delete lecture file:", r2Err);
            // Continue with database deletion even if R2 deletion fails
          }
        }
        
        // Delete from database
        await db.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
        
        // Update course lecture count
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [lecture.course_id]);
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error("Delete lecture error:", err);
      res.status(500).json({ message: "Failed to delete lecture" });
    }
  });

  app.get("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT t.*, c.title as course_title 
        FROM tests t 
        LEFT JOIN courses c ON t.course_id = c.id 
        WHERE t.course_id IS NULL
        ORDER BY t.created_at DESC
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });

  app.post("/api/admin/tests", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, miniCourseId, price } = req.body;
      const result = await db.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, mini_course_id, price, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13) RETURNING *`,
        [title, description, courseId || null, durationMinutes || 60, totalMarks || 100, passingMarks || 35, testType || "practice", folderName || null, difficulty || "moderate", scheduledAt ? new Date(scheduledAt).getTime() : null, miniCourseId || null, parseFloat(price) || 0, Date.now()]
      );
      if (courseId) await updateCourseTestCounts(courseId);
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
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [q.testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, q.explanation, q.topic, q.difficulty || "medium", q.marks || 4, q.negativeMarks || 1, q.orderIndex || 0, q.imageUrl || null, q.solutionImageUrl || null]
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
    type Q = { questionText: string; optionA: string; optionB: string; optionC: string; optionD: string; correctOption: string };
    const questions: Q[] = [];

    // Normalize: remove form feeds (page breaks from PPT/PDF), normalize whitespace
    const normalized = text
      .replace(/\f/g, '\n')           // form feed (page break) → newline
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '') // strip bullet chars (•▸◦⁃∙)
      .replace(/^[\s\-\*\>\•]+/gm, (m) => m.replace(/[\-\*\>\•]/g, '').trimStart()); // strip leading bullets per line

    const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Patterns — very flexible, handles PPT exports
    const isQuestion = (l: string) =>
      /^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+[\.\)\:])\s*[\.\)\:]?\s*.+/i.test(l);

    // PPT often has standalone option letter on one line, text on next — detect bare letter lines
    const isOptionLetter = (l: string) => /^[AaBbCcDd][\.\)\:]?\s*$/.test(l);

    const isOption = (l: string) =>
      /^[\(\[]?[AaBbCcDd][\)\]\.\:][\s\)]/.test(l) ||
      /^\([AaBbCcDd]\)/.test(l) ||
      /^[AaBbCcDd]\s*[\.\)]\s*/.test(l) ||
      /^[AaBbCcDd]\s+\S/.test(l); // "A some text" — letter + space + text (PPT style)

    const getOptionLetter = (l: string): string => {
      const m = l.match(/^[\(\[]?([AaBbCcDd])[\)\]\.\:]/);
      if (m) return m[1].toUpperCase();
      const m2 = l.match(/^\(([AaBbCcDd])\)/);
      if (m2) return m2[1].toUpperCase();
      const m3 = l.match(/^([AaBbCcDd])\s+\S/); // PPT: "A text"
      if (m3) return m3[1].toUpperCase();
      return '';
    };

    const stripOptionPrefix = (l: string) =>
      l.replace(/^[\(\[]?[AaBbCcDd][\)\]\.\:]\s*/, '')
       .replace(/^\([AaBbCcDd]\)\s*/, '')
       .replace(/^[AaBbCcDd]\s+/, '') // PPT: "A text" → "text"
       .trim();

    const stripQuestionPrefix = (l: string) =>
      l.replace(/^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+)[\.\)\:]?\s*/i, '').trim();

    const isAnswer = (l: string) =>
      /^(Answer|Ans|Correct\s*Answer|Key|Sol|Solution)[\s\:\.\-]*[:\-]?\s*[\(\[]?[A-Da-d][\)\]]?/i.test(l) ||
      /^Correct[\s:]+[A-Da-d]/i.test(l) ||
      /^Answer\s*-\s*[A-Da-d]/i.test(l);

    const getAnswerLetter = (l: string): string => {
      // "Answer - B" or "Answer: B" or "Ans B" — grab the letter
      const m = l.match(/[:\-\s]\s*[\(\[]?([A-Da-d])[\)\]]?\s*$/i);
      if (m) return m[1].toUpperCase();
      const m2 = l.match(/[\(\[]?([A-Da-d])[\)\]]?\s*$/);
      if (m2) return m2[1].toUpperCase();
      return 'A';
    };

    // Handle inline options on same line as question: "Q1. text (A) opt1 (B) opt2 (C) opt3 (D) opt4"
    const tryParseInline = (l: string): Q | null => {
      // Standard uppercase inline: Q1. text (A) opt1 (B) opt2 ...
      const inlineMatch = l.match(/^(?:Q\.?\s*\d+[\.\)]?\s*|Q\d+[\.\)]?\s*|\d+[\.\)]\s*)(.+?)\s*[\(\[](A)[\)\]]\s*(.+?)\s*[\(\[](B)[\)\]]\s*(.+?)\s*[\(\[](C)[\)\]]\s*(.+?)\s*[\(\[](D)[\)\]]\s*(.+?)(?:\s*(?:Ans|Answer|Key)[\s:\-]*[\(\[]?([A-Da-d])[\)\]]?)?$/i);
      if (inlineMatch) {
        return {
          questionText: inlineMatch[1].trim(),
          optionA: inlineMatch[3].trim(),
          optionB: inlineMatch[5].trim(),
          optionC: inlineMatch[7].trim(),
          optionD: inlineMatch[9].trim(),
          correctOption: inlineMatch[10] ? inlineMatch[10].toUpperCase() : 'A',
        };
      }
      // Lowercase inline options: "(a) text (b) text (c) text (d) text" — common in PDF exports
      const lcInline = l.match(/\(([aAbB])\)\s*(.+?)\s*\(([bBcC])\)\s*(.+?)\s*\(([cCdD])\)\s*(.+?)\s*\(([dD])\)\s*(.+?)(?:\s*(?:Ans(?:wer)?|Key|Correct)[\s:\-]+[\(\[]?([A-Da-d])[\)\]]?)?$/i);
      if (lcInline && curQ) {
        return {
          questionText: curQ,
          optionA: lcInline[2].trim(),
          optionB: lcInline[4].trim(),
          optionC: lcInline[6].trim(),
          optionD: lcInline[8].trim(),
          correctOption: lcInline[9] ? lcInline[9].toUpperCase() : 'A',
        };
      }
      return null;
    };

    let curQ = '';
    let opts: Record<string, string> = {};
    let correct = 'A';
    let pendingOptionLetter = ''; // for PPT: letter on one line, text on next

    const flush = () => {
      if (curQ && (opts['A'] || opts['B'])) {
        questions.push({
          questionText: curQ,
          optionA: opts['A'] || '',
          optionB: opts['B'] || '',
          optionC: opts['C'] || '',
          optionD: opts['D'] || '',
          correctOption: correct,
        });
      }
      curQ = ''; opts = {}; correct = 'A'; pendingOptionLetter = '';
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      // If previous line was a bare option letter (PPT style), this line is the option text
      if (pendingOptionLetter) {
        opts[pendingOptionLetter] = line;
        pendingOptionLetter = '';
        continue;
      }

      // Try inline format first
      const inline = tryParseInline(line);
      if (inline) {
        flush();
        questions.push(inline);
        continue;
      }

      if (isQuestion(line)) {
        flush();
        curQ = stripQuestionPrefix(line);
        // Check if this same line also has inline options (e.g. "1. Question (a) opt (b) opt...")
        const inlineAfterQ = tryParseInline(line);
        if (inlineAfterQ) {
          questions.push(inlineAfterQ);
          curQ = ''; opts = {}; correct = 'A'; pendingOptionLetter = '';
        }
      } else if (isOptionLetter(line)) {
        // PPT style: bare "A" or "A." on its own line — next line is the text
        pendingOptionLetter = line.replace(/[\.\)\:]/g, '').trim().toUpperCase();
      } else if (isOption(line)) {
        const letter = getOptionLetter(line);
        if (letter) opts[letter] = stripOptionPrefix(line);
      } else if (isAnswer(line)) {
        correct = getAnswerLetter(line);
      } else if (curQ && Object.keys(opts).length === 0) {
        // continuation of question text
        curQ += ' ' + line;
      }
    }
    flush();

    return questions;
  }

  app.post("/api/admin/questions/bulk-text", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { testId, text, defaultMarks, defaultNegativeMarks, save } = req.body;
      if (!testId || !text) {
        return res.status(400).json({ message: "testId and text are required" });
      }

      const parsed = parseQuestionsFromText(text);
      if (parsed.length === 0) {
        return res.status(400).json({ message: "No questions could be parsed from the provided text" });
      }

      // If save=true, persist to DB; otherwise just return parsed for preview
      if (save) {
        const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
        let idx = (maxOrderResult.rows[0]?.max_order || 0);
        for (const q of parsed) {
          idx++;
          await db.query(
            `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, (q as any).explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx]
          );
        }
        await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      }

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

      console.log("[bulk-pdf] testId:", testId, "file:", req.file?.originalname, "size:", req.file?.size);

      if (!testId || !req.file) {
        return res.status(400).json({ message: !testId ? "testId is required" : "PDF file is required — make sure you selected a .pdf file" });
      }

      const parser = new PDFParse({ data: req.file.buffer });
      const result = await parser.getText();
      const text = result.text;
      console.log("[bulk-pdf] extracted text length:", text.length, "preview:", text.substring(0, 200));

      const parsed = parseQuestionsFromText(text);
      console.log("[bulk-pdf] parsed questions:", parsed.length);
      if (parsed.length === 0) {
        return res.status(400).json({ 
          message: "No questions could be parsed from the PDF. Make sure questions are numbered (Q1, 1., etc.) with options labeled A, B, C, D.",
          rawTextPreview: text.substring(0, 500)
        });
      }

      // Return parsed questions for preview — don't save yet
      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err: any) {
      console.error("[bulk-pdf] error:", err);
      res.status(500).json({ message: `Failed to parse PDF: ${err?.message || "unknown error"}` });
    }
  });

  // Save bulk questions after admin review/edit
  app.post("/api/admin/questions/bulk-save", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { testId, questions, defaultMarks, defaultNegativeMarks } = req.body;
      if (!testId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "testId and questions array are required" });
      }
      const maxOrderResult = await db.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
      let idx = (maxOrderResult.rows[0]?.max_order || 0);
      for (const q of questions) {
        idx++;
        await db.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption || "A", q.explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx, q.imageUrl || null, q.solutionImageUrl || null]
        );
      }
      await db.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      res.json({ success: true, count: questions.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save questions" });
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
      // Update total_materials count on the course
      if (courseId) {
        await db.query(
          "UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1",
          [courseId]
        );
      }
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to add material" });
    }
  });

  app.post("/api/admin/live-classes", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount } = req.body;
      const result = await db.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [title, description, courseId || null, youtubeUrl || null, scheduledAt, isLive || false, isPublic || false, notifyEmail || false, notifyBell || false, isFreePreview || false, streamType || 'rtmp', chatMode || 'public', showViewerCount !== false, Date.now()]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive}`);
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to add live class" });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        `SELECT id, name, email, phone, role, created_at,
                COALESCE(is_blocked, FALSE) AS is_blocked,
                last_active_at
         FROM users ORDER BY created_at DESC NULLS LAST`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Admin users error:", err);
      // Fallback without new columns if they don't exist yet
      try {
        const result = await db.query(
          "SELECT id, name, email, phone, role, created_at, FALSE AS is_blocked, NULL AS last_active_at FROM users ORDER BY id DESC"
        );
        res.json(result.rows);
      } catch (err2) {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    }
  });

  app.put("/api/admin/users/:id/block", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        // Clear session token so existing sessions are immediately invalidated
        await db.query("UPDATE users SET is_blocked = TRUE, session_token = NULL WHERE id = $1", [req.params.id]);
        
        // Clean up all downloads for this user
        const userId = req.params.id;
        await deleteDownloadsForUser(parseInt(Array.isArray(userId) ? userId[0] : userId));
      } else {
        await db.query("UPDATE users SET is_blocked = FALSE WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update user" });
    }
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = req.params.id;
      // Delete all user data comprehensively
      await db.query("DELETE FROM test_attempts WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM enrollments WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM payments WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM book_purchases WHERE user_id = $1", [userId]);
      await db.query("DELETE FROM folder_purchases WHERE user_id = $1", [userId]).catch(() => {});
      await db.query("DELETE FROM support_messages WHERE user_id = $1", [userId]).catch(() => {});
      await db.query("DELETE FROM mission_attempts WHERE user_id = $1", [userId]).catch(() => {});
      // Finally delete the user account
      await db.query("DELETE FROM users WHERE id = $1", [userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete user error:", err);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });

  app.post("/api/admin/notifications/send", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { userId, title, message, type, target, courseId, imageUrl, expiresAfterHours } = req.body;
      let userIds: number[] = [];

      if (userId) {
        userIds = [userId];
      } else if (target === "enrolled" && courseId) {
        const result = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]);
        userIds = result.rows.map((r: any) => r.user_id);
      } else if (target === "enrolled") {
        const result = await db.query("SELECT DISTINCT user_id FROM enrollments");
        userIds = result.rows.map((r: any) => r.user_id);
      } else {
        const result = await db.query("SELECT id FROM users WHERE role = 'student'");
        userIds = result.rows.map((r: any) => r.id);
      }

      const now = Date.now();
      const expiresAt = expiresAfterHours ? now + (parseFloat(expiresAfterHours) * 3600000) : null;

      // Create admin_notifications record first to get the ID
      const insertResult = await db.query(
        "INSERT INTO admin_notifications (title, message, target, course_id, sent_count, image_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [title, message, target || "all", courseId || null, userIds.length, imageUrl || null, now]
      );
      const adminNotifId = insertResult.rows[0]?.id || null;

      // Insert student notifications with admin_notif_id link and image
      for (const uid of userIds) {
        await db.query(
          "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, admin_notif_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [uid, title, message, type || "info", now, expiresAt, adminNotifId, imageUrl || null]
        );
      }

      res.json({ success: true, sent: userIds.length });
    } catch (err) {
      console.error("[NotifSend] error:", err);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });

  // Get past admin notifications
  app.get("/api/admin/notifications/history", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT an.*, c.title as course_title FROM admin_notifications an LEFT JOIN courses c ON c.id = an.course_id ORDER BY an.created_at DESC LIMIT 100"
      );
      console.log(`[NotifHistory] returning ${result.rows.length} records`);
      res.json(result.rows);
    } catch (err) {
      console.error("[NotifHistory] error:", err);
      res.status(500).json({ message: "Failed to fetch notification history" });
    }
  });

  // Edit a past notification — also updates student notifications
  app.put("/api/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, message } = req.body;
      const anId = parseInt(String(req.params.id));
      await db.query("UPDATE admin_notifications SET title = $1, message = $2 WHERE id = $3", [title, message, anId]);
      // Update student notifications linked by admin_notif_id
      await db.query("UPDATE notifications SET title = $1, message = $2 WHERE admin_notif_id = $3", [title, message, anId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  // Toggle hide/unhide a past notification
  app.put("/api/admin/notifications/:id/hide", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { hidden } = req.body;
      const anId = parseInt(String(req.params.id));
      const an = await db.query("UPDATE admin_notifications SET is_hidden = $1 WHERE id = $2 RETURNING title", [hidden, anId]);
      // Update student notifications by admin_notif_id
      await db.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id = $2", [hidden, anId]);
      // Also update by title for old notifications
      if (an.rows.length > 0 && an.rows[0].title) {
        await db.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id IS NULL AND TRIM(title) = TRIM($2)", [hidden, an.rows[0].title]);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });

  // Delete a past notification permanently — removes from both admin and student tables
  app.delete("/api/admin/notifications/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const anId = parseInt(String(req.params.id));
      // Delete all student notifications linked to this admin notification
      const r1 = await db.query("DELETE FROM notifications WHERE admin_notif_id = $1", [anId]);
      console.log("[NotifDelete] deleted " + (r1.rowCount || 0) + " student notifications for admin_notif_id=" + anId);
      // Delete the admin notification
      await db.query("DELETE FROM admin_notifications WHERE id = $1", [anId]);
      res.json({ success: true });
    } catch (err) {
      console.error("[NotifDelete] error:", err);
      res.status(500).json({ message: "Failed to delete notification" });
    }
  });

  app.get("/api/admin/tests/:id/questions", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index ASC, id ASC", [req.params.id]);
      res.json(result.rows);
    } catch (err) { res.status(500).json({ message: "Failed to fetch questions" }); }
  });

  app.put("/api/admin/questions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { questionText, optionA, optionB, optionC, optionD, correctOption, explanation, topic, marks, negativeMarks, difficulty, imageUrl, solutionImageUrl } = req.body;
      await db.query(
        `UPDATE questions SET question_text=$1, option_a=$2, option_b=$3, option_c=$4, option_d=$5, correct_option=$6, explanation=$7, topic=$8, marks=$9, negative_marks=$10, difficulty=$11, image_url=$12, solution_image_url=$13 WHERE id=$14`,
        [questionText, optionA, optionB, optionC, optionD, correctOption, explanation || "", topic || "", parseFloat(marks) || 1, parseFloat(negativeMarks) || 0, difficulty || "moderate", imageUrl || null, solutionImageUrl || null, req.params.id]
      );
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update question" }); }
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

  app.put("/api/admin/tests/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, durationMinutes, totalMarks, testType, folderName, difficulty, scheduledAt, passingMarks, courseId, price } = req.body;
      const priceVal = price !== undefined ? parseFloat(price) || 0 : null;
      if (courseId !== undefined) {
        await db.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9, course_id=$10${priceVal !== null ? ", price=$12" : ""} WHERE id=$11`,
          priceVal !== null
            ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id, priceVal]
            : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id]
        );
        if (courseId) await updateCourseTestCounts(courseId);
      } else {
        await db.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9${priceVal !== null ? ", price=$11" : ""} WHERE id=$10`,
          priceVal !== null
            ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id, priceVal]
            : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id]
        );
        const existing = await db.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
        if (existing.rows[0]?.course_id) await updateCourseTestCounts(existing.rows[0].course_id);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update test" }); }
  });

  app.delete("/api/admin/tests/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Get courseId before deleting
      const testRow = await db.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
      const courseId = testRow.rows[0]?.course_id;
      await db.query("DELETE FROM test_attempts WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM questions WHERE test_id = $1", [req.params.id]);
      await db.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      if (courseId) await updateCourseTestCounts(courseId);
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

  app.put("/api/admin/daily-missions/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId } = req.body;
      await db.query(
        `UPDATE daily_missions SET title=$1, description=$2, questions=$3, mission_date=$4, xp_reward=$5, mission_type=$6, course_id=$7 WHERE id=$8`,
        [title, description || "", JSON.stringify(questions), missionDate, xpReward || 50, missionType, courseId || null, req.params.id]
      );
      res.json({ success: true });
    } catch (err) { res.status(500).json({ message: "Failed to update mission" }); }
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

  // Get all student attempts for a specific mission (sorted by score desc, time asc)
  app.get("/api/admin/daily-missions/:id/attempts", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Ensure columns exist before querying
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS time_taken INTEGER DEFAULT 0`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS incorrect INTEGER DEFAULT 0`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS skipped INTEGER DEFAULT 0`).catch(() => {});
      await db.query(`ALTER TABLE user_missions ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'`).catch(() => {});
      const result = await db.query(`
        SELECT um.user_id, um.score, COALESCE(um.time_taken, 0) as time_taken,
               COALESCE(um.incorrect, 0) as incorrect, COALESCE(um.skipped, 0) as skipped,
               um.completed_at, um.answers,
               u.name, u.phone, u.email,
               dm.questions
        FROM user_missions um
        JOIN users u ON u.id = um.user_id
        JOIN daily_missions dm ON dm.id = um.mission_id
        WHERE um.mission_id = $1 AND um.is_completed = TRUE
        ORDER BY um.score DESC, COALESCE(um.time_taken, 0) ASC
      `, [req.params.id]);
      res.json(result.rows);
    } catch (err) {
      console.error("Failed to fetch mission attempts:", err);
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });

  // ==================== LIVE CHAT ROUTES ====================
  async function checkLiveClassAccess(req: Request, res: Response, liveClassId: string): Promise<boolean> {
    const lc = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
    if (lc.rows.length === 0) { res.status(404).json({ message: "Live class not found" }); return false; }
    const liveClass = lc.rows[0];
    if (liveClass.is_public || !liveClass.course_id) return true;
    const session = req.session as any;
    const user = session.user as { id: number; role: string } | undefined;
    if (!user) { res.status(401).json({ message: "Login required" }); return false; }
    if (user.role === "admin") return true;
    const enrolled = await db.query("SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, liveClass.course_id]);
    if (enrolled.rows.length === 0) { res.status(403).json({ message: "Not enrolled" }); return false; }
    return true;
  }

  app.get("/api/live-classes/:id/chat", async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, req.params.id as string);
      if (!hasAccess) return;
      const { after } = req.query;
      let query = "SELECT * FROM live_chat_messages WHERE live_class_id = $1";
      const params: unknown[] = [req.params.id];
      if (after) {
        params.push(after);
        query += ` AND created_at > $${params.length}`;
      }
      query += " ORDER BY created_at ASC LIMIT 200";
      const result = await db.query(query, params);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });

  app.post("/api/live-classes/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, req.params.id as string);
      if (!hasAccess) return;
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });
      const user = (req as any).user;
      const result = await db.query(
        `INSERT INTO live_chat_messages (live_class_id, user_id, user_name, message, is_admin, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, user.id, user.name || user.phone, message.trim().slice(0, 500), user.role === "admin", Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.delete("/api/admin/live-classes/:lcId/chat/:msgId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_chat_messages WHERE id = $1 AND live_class_id = $2", [req.params.msgId, req.params.lcId]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });

  // ==================== LIVE CLASS VIEWERS & HAND RAISES ====================

  // POST /api/live-classes/:id/viewers/heartbeat — upsert viewer heartbeat
  app.post("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await db.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET last_heartbeat = $4, user_name = $3`,
        [req.params.id, user.id, user.name || user.phone || 'Anonymous', Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });

  // GET /api/live-classes/:id/viewers — return active viewers (heartbeat within 30s)
  app.get("/api/live-classes/:id/viewers", async (req: Request, res: Response) => {
    try {
      const cutoff = Date.now() - 30000;
      const result = await db.query(
        `SELECT user_id, user_name FROM live_class_viewers
         WHERE live_class_id = $1 AND last_heartbeat > $2
         ORDER BY user_name ASC`,
        [req.params.id, cutoff]
      );
      // Include show_viewer_count from live class so students know if they can see it
      const lcResult = await db.query(
        "SELECT show_viewer_count FROM live_classes WHERE id = $1",
        [req.params.id]
      );
      const visible = lcResult.rows[0]?.show_viewer_count ?? true;
      res.json({ viewers: result.rows, count: result.rows.length, visible });
    } catch (err) {
      console.error("Viewer list error:", err);
      res.status(500).json({ message: "Failed to fetch viewers" });
    }
  });

  // POST /api/live-classes/:id/raise-hand — upsert hand raise for student
  app.post("/api/live-classes/:id/raise-hand", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await db.query(
        `INSERT INTO live_class_hand_raises (live_class_id, user_id, user_name, raised_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET raised_at = $4`,
        [req.params.id, user.id, user.name || user.phone || 'Anonymous', Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Raise hand error:", err);
      res.status(500).json({ message: "Failed to raise hand" });
    }
  });

  // DELETE /api/live-classes/:id/raise-hand — remove hand raise for student
  app.delete("/api/live-classes/:id/raise-hand", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await db.query(
        "DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2",
        [req.params.id, user.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Lower hand error:", err);
      res.status(500).json({ message: "Failed to lower hand" });
    }
  });

  // GET /api/admin/live-classes/:id/raised-hands — list all raised hands (admin only)
  app.get("/api/admin/live-classes/:id/raised-hands", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT id, user_id, user_name, raised_at FROM live_class_hand_raises WHERE live_class_id = $1 ORDER BY raised_at ASC",
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Raised hands list error:", err);
      res.status(500).json({ message: "Failed to fetch raised hands" });
    }
  });

  // POST /api/admin/live-classes/:id/raised-hands/:userId/resolve — dismiss a raised hand (admin only)
  app.post("/api/admin/live-classes/:id/raised-hands/:userId/resolve", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query(
        "DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2",
        [req.params.id, req.params.userId]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Resolve hand error:", err);
      res.status(500).json({ message: "Failed to resolve hand raise" });
    }
  });

  // ==================== CLOUDFLARE STREAM ENDPOINTS ====================

  // POST /api/admin/live-classes/:id/stream/create — create a Cloudflare Stream live input
  app.post("/api/admin/live-classes/:id/stream/create", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured. Add CF_STREAM_ACCOUNT_ID and CF_STREAM_API_TOKEN to .env" });
      }

      const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const liveClass = lcResult.rows[0];

      // If already has a stream UID, return existing
      if (liveClass.cf_stream_uid) {
        return res.json({
          uid: liveClass.cf_stream_uid,
          rtmpUrl: liveClass.cf_stream_rtmp_url,
          streamKey: liveClass.cf_stream_key,
          playbackHls: liveClass.cf_playback_hls,
        });
      }

      // Create a new live input on Cloudflare Stream
      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            meta: { name: liveClass.title },
            recording: { mode: "automatic", timeoutSeconds: 60 },
          }),
        }
      );

      if (!cfRes.ok) {
        const errBody = await cfRes.text();
        console.error("[CF Stream] Create live input failed:", errBody);
        return res.status(502).json({ message: "Cloudflare Stream API error: " + errBody });
      }

      const cfData = await cfRes.json() as any;
      const input = cfData.result;
      const uid = input.uid;
      const rtmpUrl = input.rtmps?.url || `rtmps://live.cloudflare.com:443/live/`;
      const streamKey = input.rtmps?.streamKey || uid;
      const playbackHls = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

      // Persist to DB
      await db.query(
        "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE id = $5",
        [uid, streamKey, rtmpUrl, playbackHls, req.params.id]
      );

      console.log(`[CF Stream] Created live input uid=${uid} for live class ${req.params.id}`);
      res.json({ uid, rtmpUrl, streamKey, playbackHls });
    } catch (err: any) {
      console.error("[CF Stream] Create error:", err);
      res.status(500).json({ message: "Failed to create Cloudflare Stream live input" });
    }
  });

  // GET /api/admin/live-classes/:id/stream/status — get stream status from Cloudflare
  app.get("/api/admin/live-classes/:id/stream/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured" });
      }

      const lcResult = await db.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const uid = lcResult.rows[0].cf_stream_uid;
      if (!uid) return res.json({ connected: false, uid: null });

      const cfRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`,
        { headers: { "Authorization": `Bearer ${apiToken}` } }
      );
      if (!cfRes.ok) return res.json({ connected: false, uid });

      const cfData = await cfRes.json() as any;
      const status = cfData.result?.status;
      res.json({ connected: status?.current?.state === "connected", uid, status: status?.current?.state || "idle" });
    } catch (err) {
      console.error("[CF Stream] Status error:", err);
      res.status(500).json({ message: "Failed to get stream status" });
    }
  });

  // POST /api/admin/live-classes/:id/stream/end — end the Cloudflare Stream live input
  app.post("/api/admin/live-classes/:id/stream/end", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) return res.status(500).json({ message: "CF Stream credentials not configured" });

      const lcResult = await db.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      const uid = lcResult.rows[0]?.cf_stream_uid;
      if (!uid) return res.json({ success: true });

      // Delete the live input (stops the stream, recording is preserved)
      await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`,
        { method: "DELETE", headers: { "Authorization": `Bearer ${apiToken}` } }
      );

      console.log(`[CF Stream] Ended live input uid=${uid}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[CF Stream] End error:", err);
      res.status(500).json({ message: "Failed to end stream" });
    }
  });

  // POST /api/admin/live-classes/:id/recording — save recording and create lecture
  app.post("/api/admin/live-classes/:id/recording", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordingUrl, sectionTitle } = req.body;
      if (!recordingUrl) {
        return res.status(400).json({ message: "recordingUrl is required" });
      }

      // Get the live class
      const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) {
        return res.status(404).json({ message: "Live class not found" });
      }
      const liveClass = lcResult.rows[0];

      // Update live class: set recording_url, is_completed=true, is_live=false, ended_at, duration
      const endedAt = Date.now();
      await db.query(
        `UPDATE live_classes 
         SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2,
             duration_minutes = CASE 
               WHEN started_at IS NOT NULL 
               THEN GREATEST(1, ROUND(($2 - started_at) / 60000.0)::INTEGER)
               ELSE 0 
             END
         WHERE id = $3`,
        [recordingUrl, endedAt, req.params.id]
      );

      // Create lecture record if course is associated
      let lectureId = null;
      if (liveClass.course_id) {
        // Calculate duration in minutes
        const durationMins = liveClass.started_at
          ? Math.max(1, Math.round((Date.now() - Number(liveClass.started_at)) / 60000))
          : 0;
        const maxOrder = await db.query(
          "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
          [liveClass.course_id]
        );
        const lectureResult = await db.query(
          `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [liveClass.course_id, liveClass.title, liveClass.description || "", recordingUrl, "r2", durationMins, maxOrder.rows[0].next_order, false, sectionTitle || "Live Class Recordings", Date.now()]
        );
        lectureId = lectureResult.rows[0].id;

        // Update course total_lectures count
        await db.query(
          "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
          [liveClass.course_id]
        );
      }

      // Mark all other classes with the same title as completed (cross-course cleanup)
      await db.query(
        `UPDATE live_classes 
         SET is_completed = TRUE, is_live = FALSE
         WHERE id != $1 AND title = $2 AND (is_live = TRUE OR is_completed IS NOT TRUE)`,
        [req.params.id, liveClass.title]
      ).catch(() => {});

      res.json({ success: true, lectureId });
    } catch (err) {
      console.error("Recording completion error:", err);
      res.status(500).json({ message: "Failed to save recording" });
    }
  });

  app.get("/api/pdf-proxy", (req: Request, res: Response) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL is required" });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ message: "Invalid URL" });
    }

    const isGoogleDrive = parsedUrl.hostname.includes("drive.google.com") || parsedUrl.hostname.includes("docs.google.com");
    const isPdfUrl = parsedUrl.pathname.toLowerCase().endsWith(".pdf");
    if (!isPdfUrl && !isGoogleDrive) {
      return res.status(400).json({ message: "Only PDF files and Google Drive links are allowed" });
    }

    let finalUrl = url;
    if (isGoogleDrive) {
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        finalUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
      }
    }

    const finalParsed = new URL(finalUrl);
    const protocol = finalParsed.protocol === "https:" ? require("https") : require("http");
    const options = {
      hostname: finalParsed.hostname,
      path: finalParsed.pathname + finalParsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,*/*",
      },
      timeout: 30000,
    };

    console.log(`[PDF-Proxy] Fetching: ${parsedUrl.hostname}${parsedUrl.pathname}`);

    const proxyReq = protocol.request(options, (proxyRes: any) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, url);
        console.log(`[PDF-Proxy] Following redirect to: ${redirectUrl.href}`);
        proxyRes.resume();
        req.query.url = redirectUrl.href;
        return app._router.handle(req, res, () => {});
      }

      if (proxyRes.statusCode !== 200) {
        console.log(`[PDF-Proxy] Upstream returned ${proxyRes.statusCode}`);
        proxyRes.resume();
        return res.status(proxyRes.statusCode).json({ message: "Failed to fetch PDF" });
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err: any) => {
      console.error("[PDF-Proxy] Request error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ message: "Failed to fetch PDF" });
      }
    });

    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ message: "PDF download timed out" });
      }
    });

    proxyReq.end();
  });

  app.post("/upload/presign", async (req, res) => {
  try {
    const { filename, contentType, folder } = req.body;

    if (!filename) {
      return res.status(400).json({ message: "Filename required" });
    }

    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");

    const r2 = await getR2Client();

    const safeFilename = filename.replace(/\s+/g, "_");
const key = `${folder || "materials"}/${Date.now()}_${safeFilename}`;

    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });

    // ✅ IMPORTANT FIX
    const publicUrl = key;

    res.json({
      uploadUrl,
      publicUrl,
      key,
    });

  } catch (err) {
    console.error("[UPLOAD ERROR]", err);
    res.status(500).json({ message: "Failed to generate upload URL" });
  }
});

app.get("/api/media/:key(*)", async (req, res) => {
  try {
    const key = (req.params as any).key;

    const r2 = await getR2Client();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");

    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    });

    const response = await r2.send(command);

    if (!response.Body) {
      return res.status(404).send("File not found");
    }

    res.setHeader("Content-Type", response.ContentType || "application/octet-stream");
    res.setHeader("Content-Length", response.ContentLength?.toString() || "");

    // 🔥 IMPORTANT FIXES
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("X-Frame-Options", "ALLOWALL");

    response.Body.pipe(res);

  } catch (err) {
    console.error("[MEDIA ERROR]", err);
    res.status(500).send("Error fetching file");
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
    return `For quadratic equations of the form ax� + bx + c = 0:\n\n**Methods to solve:**\n1. **Factorisation**: Split the middle term\n2. **Quadratic Formula**: x = (-b � v(b�-4ac)) / 2a\n3. **Completing the Square**\n\n**Discriminant (b�-4ac):**\n� If D > 0: Two distinct real roots\n� If D = 0: Two equal real roots\n� If D < 0: No real roots\n\nPractice Tip: Always verify your roots by substituting back into the original equation!`;
  }
  if (lowerQ.includes("trigon")) {
    return `**Trigonometry Key Formulas:**\n\nBasic Ratios:\n� sin ? = Perpendicular/Hypotenuse\n� cos ? = Base/Hypotenuse\n� tan ? = Perpendicular/Base\n\n**Standard Values:**\n| Angle | sin | cos | tan |\n|-------|-----|-----|-----|\n| 0� | 0 | 1 | 0 |\n| 30� | 1/2 | v3/2 | 1/v3 |\n| 45� | 1/v2 | 1/v2 | 1 |\n| 60� | v3/2 | 1/2 | v3 |\n| 90� | 1 | 0 | 8 |\n\n**Identity:** sin�? + cos�? = 1`;
  }
  if (lowerQ.includes("calculus") || lowerQ.includes("derivative") || lowerQ.includes("integral")) {
    return `**Calculus Fundamentals:**\n\n**Derivatives:**\n� d/dx (xn) = nxn?�\n� d/dx (sin x) = cos x\n� d/dx (cos x) = -sin x\n� d/dx (e?) = e?\n\n**Integration:**\n� ?xn dx = xn?�/(n+1) + C\n� ?sin x dx = -cos x + C\n� ?cos x dx = sin x + C\n\nRemember: Integration is the reverse of differentiation!`;
  }

  return answers.default;
}

