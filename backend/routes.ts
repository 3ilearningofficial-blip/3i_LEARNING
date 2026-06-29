import type { Express, Request, Response } from "express";
import { createServer, type Server } from "node:http";
import { Pool } from "pg";
import { PDFParse } from "pdf-parse";
import { upload, uploadPdf } from "./upload-config";
import { verifyFirebaseToken } from "./firebase";
import { getRazorpay, verifyPaymentSignature } from "./razorpay";
import { randomInt } from "node:crypto";
import { generateSecureToken, hashOtpValue, verifyOtpValue } from "./security-utils";
import { getAuthUserFromRequest } from "./auth-utils";
import { createRequireAdmin } from "./require-admin";
import { createRequireStaff } from "./require-staff";
import { registerAdminStaffRoutes } from "./admin-staff-routes";
import { registerStaffRoutes } from "./staff-routes";
import { assertActiveSessionPlatformMatches, enforceInstallationBinding } from "./native-device-binding";
import { setAuthFailure } from "./auth-failure-utils";
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
import { registerAdminContentExportRoutes } from "./admin-content-export-routes";
import { registerAdminOpsRoutes } from "./admin-ops-routes";
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
import { registerClassroomRoutes } from "./classroom-routes";
import { registerLiveClassPollRoutes } from "./live-class-poll-routes";
import { attachClassroomSyncServer } from "./classroom-sync";
import { registerCourseAccessRoutes } from "./course-access-routes";
import { registerUploadRoutes } from "./upload-routes";
import { registerMediaStreamRoutes } from "./media-stream-routes";
import { registerRuntimeFlagRoutes } from "./runtime-flag-routes";
import { registerCloudflareWebhookRoutes } from "./cloudflare-webhook-routes";
import { isLiveKitWebhookConfigured } from "./livekit-sdk";
import { registerLiveKitWebhookRoutes } from "./livekit-webhook-routes";
import { createGenerateAIAnswer } from "./ai-tutor-service";
import { checkDatabaseReadiness } from "./db-readiness";
import { normalizeDatabaseUrl } from "./db-utils";
import { sendOTPviaSMS } from "./sms-utils";
import { sendFirebasePhoneVerification, verifyFirebasePhoneCode } from "./firebase-phone-utils";
import {
  updateCourseProgress as _updateCourseProgress,
  updateCourseTestCounts as _updateCourseTestCounts,
  recomputeAllEnrollmentsProgressForCourse as _recomputeAllEnrollmentsProgressForCourse,
} from "./progress-utils";
import { startSchedulers } from "./schedulers";
import {
  deleteDownloadsForUser as _deleteDownloadsForUser,
  deleteDownloadsForCourse as _deleteDownloadsForCourse,
} from "./download-utils";
import {
  registerWebPushSubscription,
  registerPushToken,
  sendPushToUsers,
  unregisterAllPushTokens,
  unregisterPushToken,
  unregisterWebPushSubscription,
} from "./push-notifications";

function isTransientPgError(err: any): boolean {
  const message = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();
  return (
    message.includes("connection terminated") ||
    message.includes("connection timeout") ||
    message.includes("getaddrinfo eai_again") ||
    message.includes("timeout exceeded when trying to connect") ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "57P01" || // admin_shutdown
    code === "57P03" // cannot_connect_now
  );
}

function isRetrySafeSql(text: string): boolean {
  const normalized = String(text || "").trim().toUpperCase();
  if (!normalized) return false;
  // Safe-by-default: only retry read-only statements.
  return normalized.startsWith("SELECT") || normalized.startsWith("WITH");
}

// Larger pool for 1000 concurrent users
const databaseUrlRaw = process.env.DATABASE_URL;
const databaseUrl = databaseUrlRaw ? normalizeDatabaseUrl(databaseUrlRaw) : undefined;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set");
}

const pgPoolMax = Math.min(50, Math.max(1, parseInt(process.env.PG_POOL_MAX || "10", 10) || 10));
// Warm floor connections (default 0). node-pg never reaps below `min`; a non-zero
// min keeps sockets open and can prevent Neon scale-to-zero. Use PG_POOL_MIN=2 only
// when cross-region latency to Neon is painful; same-region deploys should stay at 0.
const pgPoolMin = Math.min(pgPoolMax, Math.max(0, parseInt(process.env.PG_POOL_MIN || "0", 10) || 0));
const pgIdleTimeoutMs = Math.max(1000, parseInt(process.env.PG_POOL_IDLE_MS || "60000", 10) || 60000);
const pool = new Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production"
      ? { rejectUnauthorized: false }
      : { rejectUnauthorized: true },
  max: pgPoolMax,
  min: pgPoolMin,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: pgIdleTimeoutMs,
  statement_timeout: 25000,
  // Neon / PgBouncer / long-lived sockets benefit from TCP keep-alive.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});
console.log("[DB] Main pool configured", {
  max: pgPoolMax,
  min: pgPoolMin,
  idleTimeoutMs: pgIdleTimeoutMs,
  nodeEnv: process.env.NODE_ENV || "development",
  sslNoVerify: process.env.PGSSL_NO_VERIFY === "true",
});

// Prevent unhandled 'error' event from crashing the process
// Neon serverless drops idle connections — this is expected
pool.on("error", (err) => {
  console.error("[Pool] Idle client error (connection dropped by Neon):", err.message);
});

const listenPool = createListenPool(databaseUrl);
console.log("[DB] Listen pool configured", {
  max: Math.min(
    40,
    Math.max(
      2,
      parseInt(
        process.env.PG_LISTEN_POOL_MAX || (process.env.NODE_ENV === "production" ? "12" : "20"),
        10
      ) || (process.env.NODE_ENV === "production" ? 12 : 20)
    )
  ),
  sseCap: Math.max(10, parseInt(process.env.PG_LISTEN_SSE_MAX_CONCURRENT || "100", 10) || 100),
});
listenPool.on("error", (err) => {
  console.error("[ListenPool] Idle client error:", err.message);
});

/** Dedicated connection; no retry wrapper — use for short BEGIN/COMMIT scopes only. */
async function runInTransaction<T>(
  fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> }) => Promise<T>
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
    } catch (e: any) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      if (isTransientPgError(e) && attempt < maxAttempts) {
        console.warn("[DB] Transient transaction error, retrying", { attempt, code: e?.code, message: e?.message });
        await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }
  throw new Error("Transaction failed after retries");
}

type DbQueryOptions = { logSlow?: boolean };

// Retry wrapper for transient connection errors
async function dbQuery(text: string, params?: unknown[], options?: DbQueryOptions): Promise<any> {
  const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || "300");
  const shouldLogSlow = options?.logSlow !== false;
  const retrySafe = isRetrySafeSql(text);
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
      const isTransient = isTransientPgError(err);
      if (isTransient && retrySafe && attempt < 3) {
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

// db-bound wrappers — bind the db client so route files receive the same
// (userId, courseId) / (courseId) signatures they always have.
// Pass runInTransaction so updateCourseProgress can serialize concurrent
// updates for the same user+course via SELECT FOR UPDATE (BUG-09 fix).
const updateCourseProgress = (userId: number, courseId: number | string) =>
  _updateCourseProgress(db, userId, courseId, runInTransaction);
const recomputeAllEnrollmentsProgressForCourse = (courseId: number | string) =>
  _recomputeAllEnrollmentsProgressForCourse(db, courseId);
const updateCourseTestCounts = (courseId: number | string) =>
  _updateCourseTestCounts(db, courseId);
const deleteDownloadsForUser = (userId: number, courseId?: number) =>
  _deleteDownloadsForUser(db, userId, courseId);
const deleteDownloadsForCourse = (courseId: number) =>
  _deleteDownloadsForCourse(db, courseId);

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
      // Only a CONFIRMED different device (device_binding_mismatch) ends the
      // session — that is the intended "bound device used on another device"
      // logout. A merely MISSING device-id header (device_id_missing) must NOT
      // log out an already-authenticated student: it happens intermittently when
      // a request reaches the server without x-app-device-id (transient
      // AsyncStorage/localStorage read failure, SSE, or a non-wrapped fetch),
      // and was causing active users to be logged out mid-lecture.
      if (!boundOk.ok && boundOk.code === "device_binding_mismatch") {
        (req.session as any).user = null;
        return null;
      }
      const platOk = await assertActiveSessionPlatformMatches(db, req, user.id, user.role);
      if (!platOk.ok) {
        (req.session as any).user = null;
        setAuthFailure(req, {
          code: "SESSION_PLATFORM_MISMATCH",
          activePlatform: platOk.activePlatform,
        });
        return null;
      }
      setAuthFailure(req, null);
      return user;
    })();
    r[authUserLazyKey] = p;
  }
  return p;
}

const requireAdmin = createRequireAdmin(getAuthUser);
const requireStaff = createRequireStaff(getAuthUser);

export async function registerRoutes(app: Express): Promise<Server> {
  if (process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true" || process.env.ALLOW_STARTUP_SCHEMA_ENSURE === "true") {
    console.warn(
      "[DB] Legacy startup schema flags were requested, but runtime schema mutation is now disabled. Run SQL migrations before starting the server."
    );
  }
  try {
    const readiness = await checkDatabaseReadiness(db);
    if (!readiness.ok) {
      const missingTables = new Set((readiness.missingTables || []).map((v) => String(v).toLowerCase()));
      const missingColumns = new Set((readiness.missingColumns || []).map((v) => String(v).toLowerCase()));
      const authCriticalIssues: string[] = [];
      if (missingTables.has("user_sessions")) authCriticalIssues.push("missing table: user_sessions");
      if (missingTables.has("session")) authCriticalIssues.push("missing table: session");
      if (missingTables.has("express_rate_limit")) authCriticalIssues.push("missing table: express_rate_limit");
      if (missingColumns.has("users.password_hash")) authCriticalIssues.push("missing column: users.password_hash");

      if (authCriticalIssues.length > 0) {
        console.warn("[DB] Auth-critical readiness issues detected", {
          issues: authCriticalIssues,
        });
      }
    }
  } catch (err) {
    console.warn("[DB] Startup readiness preflight failed:", err);
  }

  // ==================== BACKGROUND SCHEDULERS ====================
  // Extracted to server/schedulers.ts — see that file for full implementation.
  // In multi-instance deployments, set RUN_BACKGROUND_SCHEDULERS=false on all
  // instances except one to prevent duplicate push notifications.
  startSchedulers(db, pool, sendPushToUsers);

  // Readiness endpoint: used by orchestrators/load balancers to verify this instance can serve traffic.
  app.get("/api/health/ready", async (_req: Request, res: Response) => {
    try {
      const readiness = await checkDatabaseReadiness(db);
      if (!readiness.ok) {
        return res.status(503).json({
          ok: false,
          message: "Database schema is not fully migrated",
          checks: readiness.checks,
          dependencyChecks: readiness.dependencyChecks,
          missingTables: readiness.missingTables,
          missingColumns: readiness.missingColumns,
          missingIndexes: readiness.missingIndexes,
        });
      }
      const hasDegradedDependency = Object.values(readiness.dependencyChecks || {}).includes("degraded");
      if (hasDegradedDependency) {
        return res.status(200).json({
          ok: true,
          degraded: true,
          checks: readiness.checks,
          dependencyChecks: readiness.dependencyChecks,
        });
      }
      return res.json({
        ok: true,
        checks: readiness.checks,
        dependencyChecks: readiness.dependencyChecks,
      });
    } catch (err: any) {
      return res.status(503).json({ ok: false, message: err?.message || "DB not ready" });
    }
  });

  // ==================== AUTH ROUTES ====================

  async function requireAuth(req: Request, res: Response, next: () => void) {
    try {
      const user = await getAuthUser(req);
      if (!user) {
        return res.status(401).json({ message: "Login required" });
      }
      (req as any).user = user;
      next();
    } catch (err) {
      console.error("[Auth] requireAuth failed:", err);
      return res.status(500).json({ message: "Authentication check failed" });
    }
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

  registerAdminOpsRoutes({
    app,
    db,
    getAuthUser,
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
    updateCourseProgress,
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
    pool,
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

  app.get("/api/push/web-public-key", async (_req: Request, res: Response) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    if (!publicKey) return res.status(503).json({ message: "Web push is not configured" });
    res.json({ publicKey });
  });

  app.post("/api/push/web/register", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      await registerWebPushSubscription(db, Number(user.id), req.body?.subscription, String(req.headers["user-agent"] || ""));
      return res.json({ success: true });
    } catch (err) {
      console.error("[WebPush] register error:", err);
      return res.status(500).json({ message: "Failed to register web push subscription" });
    }
  });

  app.post("/api/push/web/unregister", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const endpoint = String(req.body?.endpoint || "").trim();
      if (!endpoint) return res.status(400).json({ message: "Endpoint is required" });
      await unregisterWebPushSubscription(db, Number(user.id), endpoint);
      return res.json({ success: true });
    } catch (err) {
      console.error("[WebPush] unregister error:", err);
      return res.status(500).json({ message: "Failed to unregister web push subscription" });
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

  app.post("/api/admin/material-entitlements/grant", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = Number(req.body?.userId);
      const materialId = Number(req.body?.materialId);
      const expiresAtRaw = req.body?.expiresAt;
      const expiresAt =
        expiresAtRaw == null || expiresAtRaw === ""
          ? null
          : Number.isFinite(Number(expiresAtRaw))
            ? Number(expiresAtRaw)
            : null;
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(materialId) || materialId <= 0) {
        return res.status(400).json({ message: "userId and materialId are required" });
      }
      await db.query(
        `INSERT INTO standalone_material_entitlements
           (user_id, material_id, granted_at, granted_by_payment_ref, expires_at, is_active)
         VALUES ($1, $2, $3, NULL, $4, TRUE)
         ON CONFLICT (user_id, material_id)
         DO UPDATE SET is_active = TRUE, expires_at = EXCLUDED.expires_at, granted_at = EXCLUDED.granted_at`,
        [userId, materialId, Date.now(), expiresAt]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[Entitlement] grant failed:", err);
      return res.status(500).json({ message: "Failed to grant entitlement" });
    }
  });

  app.post("/api/admin/material-entitlements/revoke", requireAdmin, async (req: Request, res: Response) => {
    try {
      const userId = Number(req.body?.userId);
      const materialId = Number(req.body?.materialId);
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(materialId) || materialId <= 0) {
        return res.status(400).json({ message: "userId and materialId are required" });
      }
      await db.query(
        "UPDATE standalone_material_entitlements SET is_active = FALSE WHERE user_id = $1 AND material_id = $2",
        [userId, materialId]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[Entitlement] revoke failed:", err);
      return res.status(500).json({ message: "Failed to revoke entitlement" });
    }
  });

  registerCloudflareWebhookRoutes({
    app,
    db,
  });

  // CFSR-01: LiveKit room_finished webhook — safety net to set is_live = FALSE
  // even when the admin "End Class" button is never clicked (crash, network drop, etc.).
  if (isLiveKitWebhookConfigured()) {
    registerLiveKitWebhookRoutes({
      app,
      db,
    });
  }

  registerRuntimeFlagRoutes({
    app,
    db,
    requireAdmin,
  });

  // ==================== ADMIN ROUTES ====================

  // Admin debug endpoint: inspect push-token and web-push registration health.
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
        const [expoDetail, webDetail] = await Promise.all([
          db.query(
            `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.expo_push_token, t.platform, t.is_active, t.created_at, t.last_seen_at
             FROM user_push_tokens t
             LEFT JOIN users u ON u.id = t.user_id
             WHERE t.user_id = $1
             ${activeOnly ? "AND t.is_active = TRUE" : ""}
             ORDER BY t.last_seen_at DESC`,
            [userId]
          ),
          db.query(
            `SELECT w.id, w.user_id, u.name AS user_name, w.endpoint, w.user_agent, w.is_active, w.created_at, w.last_seen_at
             FROM web_push_subscriptions w
             LEFT JOIN users u ON u.id = w.user_id
             WHERE w.user_id = $1
             ${activeOnly ? "AND w.is_active = TRUE" : ""}
             ORDER BY w.last_seen_at DESC`,
            [userId]
          ),
        ]);
        return res.json({
          summary: {
            userId,
            expoTotal: expoDetail.rows.length,
            expoActive: expoDetail.rows.filter((r: any) => r.is_active === true).length,
            webTotal: webDetail.rows.length,
            webActive: webDetail.rows.filter((r: any) => r.is_active === true).length,
          },
          expoTokens: expoDetail.rows,
          webSubscriptions: webDetail.rows.map((r: any) => ({
            ...r,
            endpoint: String(r.endpoint || "").slice(0, 80) + (String(r.endpoint || "").length > 80 ? "…" : ""),
          })),
        });
      }

      const [expoSummary, webSummary, recentExpo, recentWeb] = await Promise.all([
        db.query(
          `SELECT
             COUNT(*)::int AS total_tokens,
             COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_tokens,
             COUNT(DISTINCT user_id)::int AS total_users,
             COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_tokens
           FROM user_push_tokens`
        ),
        db.query(
          `SELECT
             COUNT(*)::int AS total_subscriptions,
             COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_subscriptions,
             COUNT(DISTINCT user_id)::int AS total_users,
             COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_subscriptions
           FROM web_push_subscriptions`
        ),
        db.query(
          `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, u.role, t.platform, t.is_active, t.last_seen_at
           FROM user_push_tokens t
           LEFT JOIN users u ON u.id = t.user_id
           ${activeOnly ? "WHERE t.is_active = TRUE" : ""}
           ORDER BY t.last_seen_at DESC
           LIMIT 200`
        ),
        db.query(
          `SELECT w.user_id, u.name AS user_name, u.role, w.is_active, w.last_seen_at, LEFT(w.endpoint, 64) AS endpoint_prefix
           FROM web_push_subscriptions w
           LEFT JOIN users u ON u.id = w.user_id
           ${activeOnly ? "WHERE w.is_active = TRUE" : ""}
           ORDER BY w.last_seen_at DESC
           LIMIT 200`
        ),
      ]);
      return res.json({
        expo: expoSummary.rows[0] || {
          total_tokens: 0,
          active_tokens: 0,
          total_users: 0,
          users_with_active_tokens: 0,
        },
        web: webSummary.rows[0] || {
          total_subscriptions: 0,
          active_subscriptions: 0,
          total_users: 0,
          users_with_active_subscriptions: 0,
        },
        recentExpoTokens: recentExpo.rows,
        recentWebSubscriptions: recentWeb.rows,
      });
    } catch (err) {
      console.error("[Push Debug] failed:", err);
      return res.status(500).json({ message: "Failed to fetch push token stats" });
    }
  });

  app.post("/api/admin/push/test", requireAdmin, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const userId = Number(user?.id);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const result = await sendPushToUsers(db, [userId], {
        title: "3i Learning — test push",
        body: "If you see this, admin push delivery is working.",
        data: { type: "admin_push_test" },
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("[Push Test] failed:", err);
      return res.status(500).json({ message: "Failed to send test push" });
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
    db,
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
    runInTransaction: runInTransaction,
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
    runInTransaction,
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
    recomputeAllEnrollmentsProgressForCourse,
  });

  registerAdminContentExportRoutes({
    app,
    db,
    requireAdmin,
    getR2Client,
  });

  registerAdminStaffRoutes({
    app,
    db,
    requireAdmin,
    runInTransaction,
  });

  registerStaffRoutes({
    app,
    db,
    requireStaff,
    updateCourseTestCounts,
    recomputeAllEnrollmentsProgressForCourse,
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
    pool,
    requireAdmin,
    recomputeAllEnrollmentsProgressForCourse,
    getR2Client,
  });

  registerClassroomRoutes({
    app,
    db,
    requireAuth,
    requireAdmin,
    getAuthUser,
    recomputeAllEnrollmentsProgressForCourse,
  });

  registerLiveClassPollRoutes({
    app,
    db,
    listenPool,
    requireAuth,
    requireAdmin,
    getAuthUser,
  });

  registerPdfRoutes({ app, db, getAuthUser, getR2Client });

  const httpServer = createServer(app);
  attachClassroomSyncServer(httpServer, db, getR2Client);
  return httpServer;
}

