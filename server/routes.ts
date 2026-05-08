import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");
import { verifyFirebaseToken } from "./firebase";
import { getRazorpay, verifyPaymentSignature } from "./razorpay";
import { randomInt } from "node:crypto";
import { generateSecureToken, hashOtpValue, verifyOtpValue } from "./security-utils";
import { getAuthUserFromRequest } from "./auth-utils";
import { enforceInstallationBinding } from "./native-device-binding";
import { registerAuthRoutes } from "./auth-routes";
import { registerPdfRoutes } from "./pdf-routes";
import { registerPaymentRoutes } from "./payment-routes";
import { registerSupportRoutes } from "./support-routes";
import { registerLiveChatRoutes } from "./live-chat-routes";
import { createListenPool } from "./listen-pool";
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
import { createGenerateAIAnswer } from "./ai-tutor-service";
import { checkDatabaseReadiness } from "./db-readiness";
import {
  registerPushToken,
  sendPushToUsers,
  unregisterAllPushTokens,
  unregisterPushToken,
} from "./push-notifications";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimetype = String(file?.mimetype || "").toLowerCase();
    if (mimetype === "application/pdf") return cb(null, true);
    return cb(new Error("Only PDF files are allowed"));
  },
});
const uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

function normalizeDatabaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    // Keep current strict behavior across pg major versions and silence warning.
    if (!sslMode || sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

// Larger pool for 1000 concurrent users
const databaseUrlRaw = process.env.DATABASE_URL;
const databaseUrl = databaseUrlRaw ? normalizeDatabaseUrl(databaseUrlRaw) : undefined;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

const pgPoolMax = Math.min(50, Math.max(1, parseInt(process.env.PG_POOL_MAX || "10", 10) || 10));
const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
  max: pgPoolMax,
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

const listenPool = createListenPool(databaseUrl);
listenPool.on("error", (err) => {
  console.error("[ListenPool] Idle client error:", err.message);
});

/** Dedicated connection; no retry wrapper — use for short BEGIN/COMMIT scopes only. */
async function runInTransaction<T>(
  fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exec = {
      query: async (text: string, params?: unknown[]) => {
        const r = await client.query(text, params);
        return { rows: r.rows };
      },
    };
    const out = await fn(exec);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    throw e;
  } finally {
    client.release();
  }
}

type DbQueryOptions = { logSlow?: boolean };

// Retry wrapper for transient connection errors
async function dbQuery(text: string, params?: unknown[], options?: DbQueryOptions): Promise<any> {
  const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || "300");
  const shouldLogSlow = options?.logSlow !== false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await pool.query(text, params);
      const elapsedMs = Date.now() - startedAt;
      if (shouldLogSlow && elapsedMs >= slowQueryThresholdMs) {
        const compactSql = text.replace(/\s+/g, " ").trim().slice(0, 220);
        console.warn("[DB] Slow query", { elapsedMs, attempt, sql: compactSql });
      }
      return result;
    } catch (err: any) {
      const elapsedMs = Date.now() - startedAt;
      const isTransient = err.message?.includes("Connection terminated") ||
        err.message?.includes("connection timeout") ||
        err.code === "ECONNRESET" ||
        err.code === "ECONNREFUSED";
      if (isTransient && attempt < 3) {
        console.warn("[DB] Transient error on attempt " + attempt + ", retrying...");
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
      console.error("[DB] Query failed", {
        elapsedMs,
        attempt,
        code: err?.code,
        message: err?.message,
      });
      throw err;
    }
  }
}

const db = {
  query: (text: string, params?: unknown[], options?: DbQueryOptions) => dbQuery(text, params, options),
};
const generateAIAnswer = createGenerateAIAnswer(db);

function generateOTP(): string {
  return String(randomInt(100_000, 1_000_000));
}

type AuthUserResolved = { id: number; name: string; email?: string; phone?: string; role: string; sessionToken?: string; profileComplete?: boolean } | null;
const authUserLazyKey = Symbol("authUserLazy");

// Resolve authenticated user from session OR Bearer token — also enforces per-install binding after paid native purchase.
// Memoized per request so middleware + handlers do not repeat session/token/binding work.
async function getAuthUser(req: Request): Promise<AuthUserResolved> {
  const r = req as Request & { [authUserLazyKey]?: Promise<AuthUserResolved> };
  let p = r[authUserLazyKey];
  if (!p) {
    p = (async (): Promise<AuthUserResolved> => {
      const user = await getAuthUserFromRequest(req, db);
      if (!user) return null;
      const boundOk = await enforceInstallationBinding(db, req, user.id, user.role);
      if (!boundOk) {
        (req.session as any).user = null;
        return null;
      }
      return user;
    })();
    r[authUserLazyKey] = p;
  }
  return p;
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
      console.log("[Firebase Phone] Verification sent");
      return { sessionInfo: data.sessionInfo };
    }
    console.error("[Firebase Phone] Failed:", data?.error?.message || "provider_error");
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
    console.log("[SMS] No FAST2SMS_API_KEY set");
    return false;
  }

  try {
    console.log("[SMS] Sending OTP via Quick SMS route");
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
    console.log("[SMS] Quick SMS response received");
    if (data.return === true) {
      console.log("[SMS] OTP sent successfully");
      return true;
    }
    console.error("[SMS] Quick SMS failed:", data.message || "provider_error");
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[SMS] Quick SMS timeout");
    } else {
      console.error(`[SMS] Quick SMS error:`, err);
    }
  }

  try {
    console.log("[SMS] Trying OTP route as fallback");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(phone)}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    console.log("[SMS] OTP route response received");
    if (data.return === true) {
      console.log("[SMS] OTP route sent successfully");
      return true;
    }
    console.error("[SMS] OTP route failed:", data.message || "provider_error");
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[SMS] OTP route timeout");
    } else {
      console.error(`[SMS] OTP route error:`, err);
    }
  }

  return false;
}

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
  await recomputeAllEnrollmentsProgressForCourse(id);
}

// Recompute course progress for a user based on ALL content: lectures + tests + live class recordings
async function updateCourseProgress(userId: number, courseId: number | string) {
  const cid = String(courseId);
  try {
    // Count total items
    const totalLec = await db.query("SELECT COUNT(*) FROM lectures WHERE course_id = $1", [cid]);
    const totalTests = await db.query("SELECT COUNT(*) FROM tests WHERE course_id = $1 AND is_published = TRUE", [cid]);

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

/** Re-run progress for every enrolled user when lecture/test counts change (e.g. new lecture added). */
async function recomputeAllEnrollmentsProgressForCourse(courseId: number | string) {
  const cid = String(courseId);
  try {
    await db.query(
      `UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0)) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               (100.0 * (COALESCE(cl.done_lec, 0) + COALESCE(ct.done_tests, 0)))
               / NULLIF(COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0), 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_lec FROM lectures WHERE course_id = $1
         ) tl
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_tests FROM tests WHERE course_id = $1 AND is_published = TRUE
         ) tt
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::bigint AS done_lec
           FROM lecture_progress lp
           INNER JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1
           WHERE lp.user_id = en.user_id AND lp.is_completed = TRUE
         ) cl ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT test_id)::bigint AS done_tests
           FROM test_attempts ta
           WHERE ta.user_id = en.user_id
             AND ta.status = 'completed'
             AND ta.test_id IN (SELECT id FROM tests WHERE course_id = $1)
         ) ct ON TRUE
         WHERE en.course_id::text = $1 AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
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
  if (process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true" || process.env.ALLOW_STARTUP_SCHEMA_ENSURE === "true") {
    console.warn(
      "[DB] Legacy startup schema flags were requested, but runtime schema mutation is now disabled. Run SQL migrations before starting the server."
    );
  }

  // ==================== LIVE CLASS NOTIFICATION + TOKEN CLEANUP SCHEDULERS ====================
  // In multi-instance deployments, run schedulers on a single designated instance only.
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";
  if (runBackgroundSchedulers) {
    // Runs every 60s — 30 min reminder only. "Live now" is sent when admin goes live in studio.
    const sentNotifications = new Set<string>(); // process-local dedupe
    setInterval(async () => {
      try {
        const now = Date.now();
        const minScheduleAt = now + 29 * 60 * 1000;
        const maxScheduleAt = now + 31 * 60 * 1000;
        const classes = await db.query(
          `SELECT lc.id, lc.title, lc.course_id, lc.is_free_preview, lc.is_public
           FROM live_classes lc
           WHERE lc.is_completed IS NOT TRUE
             AND lc.is_live IS NOT TRUE
             AND lc.notify_bell = TRUE
             AND lc.scheduled_at IS NOT NULL
             AND lc.scheduled_at BETWEEN $1 AND $2
           ORDER BY lc.scheduled_at ASC
           LIMIT 50`,
          [minScheduleAt, maxScheduleAt]
        );
        for (const lc of classes.rows) {
          const expiresAt = now + 6 * 3600000;
          const key30 = `30min_${lc.id}`;
          if (!sentNotifications.has(key30)) {
            sentNotifications.add(key30);
            const notifTitle = "⏰ Live Class in 30 minutes!";
            const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;
            if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
              const inserted = await db.query(
                `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
                 SELECT u.id, $1, $2, 'info', $3, $4
                 FROM users u
                 WHERE u.role = 'student'
                 RETURNING user_id`,
                [notifTitle, notifMessage, now, expiresAt]
              );
              await sendPushToUsers(
                db,
                inserted.rows.map((r: any) => Number(r.user_id)),
                {
                  title: notifTitle,
                  body: notifMessage,
                  data: { type: "live_class_reminder", liveClassId: lc.id },
                }
              );
              console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
            } else {
              const inserted = await db.query(
                `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
                 SELECT e.user_id, $1, $2, 'info', $3, $4
                 FROM enrollments e
                 WHERE e.course_id = $5
                 RETURNING user_id`,
                [notifTitle, notifMessage, now, expiresAt, lc.course_id]
              );
              await sendPushToUsers(
                db,
                inserted.rows.map((r: any) => Number(r.user_id)),
                {
                  title: notifTitle,
                  body: notifMessage,
                  data: { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id },
                }
              );
              console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
            }
          }
        }
        if (sentNotifications.size > 500) sentNotifications.clear();
      } catch (err) {
        console.error("[LiveNotif] Scheduler error:", err);
      }
    }, 60 * 1000);
    console.log("[LiveNotif] Scheduler started — checks every 60s");

    // Runs every 5 minutes — deletes expired used tokens.
    setInterval(async () => {
      try {
        const result = await db.query(
          `DELETE FROM download_tokens
           WHERE id IN (
             SELECT id
             FROM download_tokens
             WHERE expires_at < $1 AND used = TRUE
             ORDER BY expires_at ASC
             LIMIT 2000
           )`,
          [Date.now()]
        );
        if (result.rowCount && result.rowCount > 0) {
          console.log(`[TokenCleanup] Deleted ${result.rowCount} expired tokens`);
        }
      } catch (err) {
        console.error("[TokenCleanup] Error:", err);
      }
    }, 5 * 60 * 1000);
    console.log("[TokenCleanup] Scheduler started — runs every 5 minutes");
  } else {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
  }

  // Readiness endpoint: used by orchestrators/load balancers to verify this instance can serve traffic.
  app.get("/api/health/ready", async (_req: Request, res: Response) => {
    try {
      const readiness = await checkDatabaseReadiness(db);
      if (!readiness.ok) {
        return res.status(503).json({
          ok: false,
          message: "Database schema is not fully migrated",
          checks: readiness.checks,
          missingTables: readiness.missingTables,
          missingColumns: readiness.missingColumns,
          missingIndexes: readiness.missingIndexes,
        });
      }
      return res.json({
        ok: true,
        checks: readiness.checks,
      });
    } catch (err: any) {
      return res.status(503).json({ ok: false, message: err?.message || "DB not ready" });
    }
  });

  // ==================== AUTH ROUTES ====================

  async function requireAuth(req: Request, res: Response, next: () => void) {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ message: "Login required" });
    }
    (req as any).user = user;
    next();
  }

  registerSupportRoutes({
    app,
    db,
    pool,
    listenPool,
    getAuthUser,
    requireAuth,
    requireAdmin,
  });

  // Update last_active_at for any authenticated API request
  app.use("/api", async (req: any, res, next) => {
    try {
      const authUser = await getAuthUser(req);
      const userId = authUser?.id || null;
      if (userId && userId > 0) {
        const now = Date.now();
        // Throttle write amplification: update at most once every 5 minutes per user.
        db.query(
          "UPDATE users SET last_active_at = $1 WHERE id = $2 AND (last_active_at IS NULL OR last_active_at < $3)",
          [now, userId, now - 5 * 60 * 1000],
          { logSlow: false }
        ).catch(() => {});
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
    runInTransaction,
  });

  registerPaymentRoutes({
    app,
    db,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature,
    runInTransaction,
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
    getRazorpay,
    verifyPaymentSignature,
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
    requireAdmin,
    generateAIAnswer,
  });

  app.post("/api/push/register", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const token = String(req.body?.token || "").trim();
      const platform = String(req.body?.platform || "").trim().toLowerCase();
      if (!token || !token.startsWith("ExponentPushToken[")) {
        return res.status(400).json({ message: "Valid Expo push token is required" });
      }
      await registerPushToken(db, Number(user.id), token, platform || "unknown");
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] register error:", err);
      return res.status(500).json({ message: "Failed to register push token" });
    }
  });

  app.post("/api/push/unregister", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const token = String(req.body?.token || "").trim();
      if (!token) return res.status(400).json({ message: "Token is required" });
      await unregisterPushToken(db, Number(user.id), token);
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] unregister error:", err);
      return res.status(500).json({ message: "Failed to unregister push token" });
    }
  });

  app.post("/api/push/unregister-all", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await unregisterAllPushTokens(db, Number(user.id));
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] unregister-all error:", err);
      return res.status(500).json({ message: "Failed to unregister push tokens" });
    }
  });

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

  // Admin debug endpoint: inspect push-token registration health.
  app.get("/api/admin/push-tokens", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userIdRaw = String(req.query.userId || "").trim();
      const activeOnlyRaw = String(req.query.activeOnly || "true").trim().toLowerCase();
      const activeOnly = activeOnlyRaw !== "false";

      if (userIdRaw) {
        const userId = Number(userIdRaw);
        if (!Number.isFinite(userId) || userId <= 0) {
          return res.status(400).json({ message: "Invalid userId" });
        }
        const detail = await db.query(
          `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.expo_push_token, t.platform, t.is_active, t.created_at, t.last_seen_at
           FROM user_push_tokens t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.user_id = $1
           ${activeOnly ? "AND t.is_active = TRUE" : ""}
           ORDER BY t.last_seen_at DESC`,
          [userId]
        );
        return res.json({
          summary: {
            userId,
            total: detail.rows.length,
            active: detail.rows.filter((r: any) => r.is_active === true).length,
          },
          tokens: detail.rows,
        });
      }

      const summary = await db.query(
        `SELECT
           COUNT(*)::int AS total_tokens,
           COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_tokens,
           COUNT(DISTINCT user_id)::int AS total_users,
           COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_tokens
         FROM user_push_tokens`
      );
      const recent = await db.query(
        `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.platform, t.is_active, t.last_seen_at
         FROM user_push_tokens t
         LEFT JOIN users u ON u.id = t.user_id
         ${activeOnly ? "WHERE t.is_active = TRUE" : ""}
         ORDER BY t.last_seen_at DESC
         LIMIT 200`
      );
      return res.json({
        summary: summary.rows[0] || {
          total_tokens: 0,
          active_tokens: 0,
          total_users: 0,
          users_with_active_tokens: 0,
        },
        recentTokens: recent.rows,
      });
    } catch (err) {
      console.error("[Push Debug] failed:", err);
      return res.status(500).json({ message: "Failed to fetch push token stats" });
    }
  });

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
    recomputeAllEnrollmentsProgressForCourse,
  });

  registerCourseAccessRoutes({
    app,
    db,
    getAuthUser,
    generateSecureToken,
    getR2Client,
    updateCourseProgress,
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
  });

  registerAdminCourseImportRoutes({
    app,
    db,
    requireAdmin,
    updateCourseTestCounts,
    recomputeAllEnrollmentsProgressForCourse,
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
    deleteDownloadsForUser,
    deleteDownloadsForCourse,
    runInTransaction,
  });

  registerAdminLectureRoutes({
    app,
    db,
    requireAdmin,
    getR2Client,
    recomputeAllEnrollmentsProgressForCourse,
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
    upload: uploadPdf,
    PDFParse,
  });

  registerAdminUsersAndContentRoutes({
    app,
    db,
    requireAdmin,
    deleteDownloadsForUser,
    runInTransaction,
    recomputeAllEnrollmentsProgressForCourse,
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
    listenPool,
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
    recomputeAllEnrollmentsProgressForCourse,
    getR2Client,
  });

  registerPdfRoutes({ app, db, getAuthUser });

  const httpServer = createServer(app);
  return httpServer;
}

