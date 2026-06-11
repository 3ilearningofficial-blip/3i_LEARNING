import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

const envPath = path.resolve(process.cwd(), ".env");
if (process.env.NODE_ENV !== "production" || process.env.LOAD_DOTENV === "true") {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envPath)) {
  // EC2/PM2 often inject core secrets; merge .env for newer vars (e.g. LIVEKIT_*) without overriding.
  dotenv.config({ path: envPath, override: false });
}

if (!process.env.OTP_HMAC_SECRET) {
  // Hard fail: a missing OTP secret must never silently downgrade to a guessable fallback.
  throw new Error("OTP_HMAC_SECRET must be set");
}

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  // Hard fail: a missing session secret means every session cookie is signed with an
  // empty string, making sessions trivially forgeable by any user who reads the source.
  // Never allow this in production — set SESSION_SECRET in your environment / secrets manager.
  throw new Error("SESSION_SECRET must be set in production");
}

import express from "express";
import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { PgRateLimitStore } from "./pg-rate-limit-store";
import { getRedisClient } from "./redis-client";
import { RedisRateLimitStore } from "./redis-rate-limit-store";
import { setupErrorHandler } from "./error-middleware";
import { getAiTutorHealthSnapshot } from "./ai-tutor-service";
import { normalizeDatabaseUrl } from "./db-utils";
import { getEnvFlag } from "./feature-flags";
import { getMetricsSnapshot, metricsMiddleware } from "./observability";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

import cors from "cors";

function normalizeOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}

function originMatchesPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes("*")) return origin === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(origin);
}

function isPrivateLocalOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
    if (isLocalhost) return true;
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}

function getAllowedOriginPatterns(): string[] {
  const defaultAllowedOrigins = [
    "https://3ilearning.in",
    "https://www.3ilearning.in",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
    "https://api.razorpay.com",
    "https://checkout.razorpay.com",
  ];
  const envOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
  return [...defaultAllowedOrigins.map((origin) => normalizeOrigin(origin)), ...envOrigins];
}

/** Host-only name for SEO / subdomain checks (handles X-Forwarded-Host behind nginx/ALB). */
function getInboundHostname(req: Request): string {
  const xf = (req.get("x-forwarded-host") || "").split(",")[0].trim();
  if (xf) return xf.replace(/:\d+$/, "").toLowerCase();
  try {
    const h = typeof req.hostname === "string" ? req.hostname : "";
    if (h) return h.replace(/:\d+$/, "").toLowerCase();
  } catch {
    /* ignore */
  }
  const host = (req.get("host") || "").trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}

function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  const normalizedOrigin = normalizeOrigin(origin);
  if (process.env.NODE_ENV !== "production" && isPrivateLocalOrigin(normalizedOrigin)) {
    return true;
  }
  return getAllowedOriginPatterns().some((pattern) => originMatchesPattern(normalizedOrigin, pattern));
}

function setupCors(app: express.Application) {
  const allowedOriginPatterns = getAllowedOriginPatterns();

  const corsOptions = {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // Allow non-browser clients (curl/mobile/native fetch without Origin header).
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (process.env.NODE_ENV !== "production" && isPrivateLocalOrigin(normalizedOrigin)) {
        return callback(null, true);
      }
      if (allowedOriginPatterns.some((pattern) => originMatchesPattern(normalizedOrigin, pattern))) {
        return callback(null, true);
      }
      console.warn(`[CORS] blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-User-Id",
      "X-App-Device-Id",
      "X-Client-Platform",
    ],
    credentials: true,
    exposedHeaders: ["Content-Length", "Content-Type", "Content-Disposition"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    // maxAge: 0 tells the browser never to cache preflight responses.
    // Without this, Chrome caches a preflight that lacks PATCH for up to 600s
    // and "Disable cache" in DevTools does NOT clear the CORS preflight cache.
    maxAge: 0,
  };

  app.use(cors(corsOptions));
}

function setupApiOriginProtection(app: express.Application) {
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

    const hasBearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
    const hasCookie = typeof req.headers.cookie === "string" && req.headers.cookie.length > 0;
    if (!hasCookie || hasBearer) return next();

    const origin = req.get("origin");
    const referer = req.get("referer");
    const trustedOrigin = origin ? isTrustedOrigin(origin) : false;
    const trustedReferer = referer ? isTrustedOrigin(referer) : false;

    if (trustedOrigin || trustedReferer) return next();

    // Cookie-only POSTs must use a trusted Origin/Referer. Native apps must send Bearer
    // (see authFetch in lib/query-client.ts) so they are not blocked here.
    return res.status(403).json({ message: "Cross-site request blocked" });
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "10mb", // allow base64 image uploads in notification payloads
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "10mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const reqId = req.get("x-request-id") || randomUUID();
    res.setHeader("x-request-id", reqId);
    const start = Date.now();
    const reqPath = req.path;
    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      // Only log slow requests (>500ms) or errors in production to reduce I/O
      if (duration > 500 || res.statusCode >= 500) {
        log(`[req:${reqId}] ${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
      }
    });
    next();
  });
}

function setupApiResponseFormat(app: express.Application) {
  app.use("/api", (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    (res as any).json = (payload: any) => {
      const statusCode = res.statusCode || 200;

      // If already standardized, pass through unchanged.
      if (
        payload &&
        typeof payload === "object" &&
        typeof payload.success === "boolean" &&
        ("data" in payload || "message" in payload || "error" in payload)
      ) {
        return originalJson(payload);
      }

      if (statusCode >= 400) {
        const fallback =
          typeof payload === "string"
            ? payload
            : payload?.error || payload?.message || "Request failed";

        return originalJson({
          success: false,
          error: String(fallback),
          message: typeof payload?.message === "string" ? payload.message : undefined,
          data:
            payload &&
            typeof payload === "object" &&
            payload.data !== undefined
              ? payload.data
              : undefined,
        });
      }

      // Success responses
      if (payload === undefined || payload === null) {
        return originalJson({ success: true });
      }

      if (typeof payload === "object" && !Array.isArray(payload)) {
        if (Object.keys(payload).length === 1 && typeof payload.message === "string") {
          return originalJson({ success: true, message: payload.message });
        }
        return originalJson({ success: true, data: payload });
      }

      return originalJson({ success: true, data: payload });
    };

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

function getBackendVersion() {
  return {
    service: "backend",
    env: process.env.NODE_ENV || "development",
    commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA || "unknown",
    version: process.env.npm_package_version || "unknown",
    now: Date.now(),
  };
}

function logProductionReleaseHints() {
  if (process.env.NODE_ENV !== "production") return;

  const schedulerRole = process.env.RUN_BACKGROUND_SCHEDULERS === "false" ? "api-only" : "scheduler-enabled";
  log(
    `[startup] production mode | scheduler_role=${schedulerRole} | health=/api/health/version,/api/health/ready,/api/health/ai-providers`
  );

  if (
    process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true" ||
    process.env.ALLOW_STARTUP_SCHEMA_ENSURE === "true"
  ) {
    console.warn(
      "[startup] production should rely on migrations only; disable ALLOW_RUNTIME_SCHEMA_SYNC and ALLOW_STARTUP_SCHEMA_ENSURE"
    );
  }
}

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
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
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "backend",
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  const apiNoMarketingHosts = getApiNoindexHosts();

  log("Serving static Expo files with dynamic manifest routing");

  // API hostname: avoid serving SPA index (duplicate “3i Learning” snippets in Google). Still allow /api, /manifest, hashed assets.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const host = getInboundHostname(req);
    if (!apiNoMarketingHosts.has(host)) return next();
    const p = req.path || "";
    if (
      p.startsWith("/api") ||
      p === "/manifest" ||
      p.startsWith("/firebase-phone-auth") ||
      p.startsWith("/_expo") ||
      p.startsWith("/assets") ||
      (p.includes(".") && /\.[a-z0-9]+$/i.test(p))
    ) {
      return next();
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow,noarchive"/><title>API</title></head><body><p>This host serves the application API only.</p><p>Visit <a href="https://www.3ilearning.in">3i Learning</a> in your browser.</p></body></html>`;
    return res.status(200).type("html").send(body);
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
  // Skip API routes
  if (req.path.startsWith("/api")) {
    return next();
  }

  // Serve your React/Expo Web App
  if (
    req.path === "/" ||
    req.path === "/app" ||
    req.path.startsWith("/app/")
  ) {
    const webBuildPath = path.resolve(
      process.cwd(),
      "dist",
      "index.html"
    );

    if (fs.existsSync(webBuildPath)) {
      return res.sendFile(webBuildPath);
    }
  }

  // Expo manifest (keep this for mobile)
  if (req.path === "/manifest") {
    const platform = req.header("expo-platform");
    if (platform === "ios" || platform === "android") {
      return serveExpoManifest(platform, res);
    }
  }

  next();
});

  const staticAssetOptions = {
    setHeaders: (res: Response, filePath: string) => {
      const normalized = filePath.replace(/\\/g, "/");
      const isHtml = normalized.endsWith(".html");
      const isVersionedBundle =
        normalized.includes("/static-build/") ||
        normalized.includes("/_expo/static/") ||
        normalized.includes("/assets/");
      if (isHtml) {
        res.setHeader("Cache-Control", "no-store");
      } else if (isVersionedBundle) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  };

  app.use(express.static(path.resolve(process.cwd(), "static-build", "web"), staticAssetOptions));
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets"), staticAssetOptions));
  app.use(express.static(path.resolve(process.cwd(), "static-build"), staticAssetOptions));

  const expoRoutes = ["/login", "/otp", "/profile", "/courses", "/settings", "/admin", "/material", "/test", "/ai-tutor", "/missions", "/live-class"];
  app.get(expoRoutes, (req: Request, res: Response, next: NextFunction) => {
    const webBuildPath = path.resolve(process.cwd(), "static-build", "web", "index.html");
    if (fs.existsSync(webBuildPath)) {
      return res.sendFile(webBuildPath);
    }
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/_expo") || req.path.startsWith("/assets") || req.path.startsWith("/firebase-phone-auth") || req.path.includes(".")) {
      return next();
    }
    const webBuildPath = path.resolve(process.cwd(), "static-build", "web", "index.html");
    if (fs.existsSync(webBuildPath)) {
      return res.sendFile(webBuildPath);
    }
    next();
  });

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function getApiNoindexHosts(): Set<string> {
  return new Set(
    (process.env.SEARCH_NOINDEX_HOSTNAMES || "api.3ilearning.in")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * De-index API-origin host (robots + X-Robots-Tag). Uses forwarded Host so nginx → Node still matches.
 *
 * Ops (URLs already in Google): verify production sends X-Robots-Tag on api host (`curl -sI https://api…/`).
 * Then use Google Search Console → Removals to request temporary removal of `https://api…/` URLs;
 * noindex stops new indexing but does not instantly purge cached snippets.
 */
function setupApiHostSearchHints(app: express.Application) {
  const noindexHosts = getApiNoindexHosts();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = getInboundHostname(req);
    if (noindexHosts.has(host)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
    next();
  });

  app.get("/robots.txt", (req: Request, res: Response, next: NextFunction) => {
    const host = getInboundHostname(req);
    if (noindexHosts.has(host)) {
      res.type("text/plain");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send("User-agent: *\nDisallow: /\n");
    }
    next();
  });
}

function normalizeOtpIdentifier(input: unknown): string {
  const raw = String(input || "").trim().toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return `phone:${digits.slice(-10)}`;
  return `id:${raw || "global"}`;
}

type RateLimitStoreKind = "pg" | "redis" | "memory";

function normalizeRateLimitStoreKind(value: unknown, fallback: RateLimitStoreKind): RateLimitStoreKind {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "postgres" || raw === "postgresql") return "pg";
  if (raw === "pg" || raw === "redis" || raw === "memory") return raw;
  return fallback;
}

(async () => {
  // Import routes only after dotenv has initialized env vars.
  const { registerRoutes } = await import("./routes");

  // 1) CORS
  setupCors(app);

  // 2) Body parsers
  setupBodyParsing(app);
  setupApiResponseFormat(app);

  // Cross-cutting middleware for responses/logging
  // BPR-02: Exclude SSE and streaming endpoints from compression.
  // compression() buffers output chunks before compressing — this defeats real-time
  // SSE delivery and introduces latency for live notifications. Media streams must also
  // be excluded so range-request byte offsets survive the compression pass.
  app.use(
    compression({
      filter: (req, res) => {
        const p = req.path || "";
        if (
          p.includes("/sse") ||
          p.includes("/stream") ||
          p.includes("/api/media/") ||
          p.startsWith("/api/live-classes/") ||
          p.includes("/listen")
        ) {
          return false;
        }
        return compression.filter(req, res);
      },
    })
  );
  app.use(metricsMiddleware);
  setupRequestLogging(app);

  const isProduction = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);

  // Security headers. PDF viewer and media streams are loaded in an iframe from the web app
  // (Vercel / custom domain) while the API is on a different host — so SAMEORIGIN must not apply to those paths.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const p = req.path || "";
    const allowEmbed = p.startsWith("/api/pdf-viewer") || p.startsWith("/api/media");
    if (allowEmbed) {
      const frameAncestors = (process.env.FRAME_ANCESTORS || "https://3ilearning.in https://www.3ilearning.in")
        .trim()
        .replace(/\s+/g, " ");
      res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
    } else {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  /** e.g. `.3ilearning.in` so the session cookie applies on both apex and `www` (set in EC2 env if you use both hostnames). */
  const sessionCookieDomain = (process.env.SESSION_COOKIE_DOMAIN || "").trim() || undefined;

  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || (isProduction
      ? (() => { throw new Error("SESSION_SECRET must be set in production"); })()
      : "dev-secret-not-for-production"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,        // HTTPS only in production
      httpOnly: true,
      // SEC-02: "strict" prevents the cookie from being sent on any cross-site request,
      // eliminating CSRF risk on cookie-authenticated GET endpoints with side effects.
      // The app primarily uses Bearer token auth (CSRF-immune by design), so changing
      // from "lax" to "strict" has no functional impact on normal usage.
      sameSite: "strict",
      maxAge: 400 * 24 * 60 * 60 * 1000,
      ...(isProduction && sessionCookieDomain ? { domain: sessionCookieDomain } : {}),
    },
  };

  if (isProduction && process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionConfig.store = new PgSession({
      conString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      tableName: "session",
      // Table is created by migrations/0011_distributed_rate_limits_and_session.sql
      createTableIfMissing: false,
    });
    const sessionStoreWithEvents = sessionConfig.store as session.Store & { on?: (event: string, listener: (...args: any[]) => void) => void };
    sessionStoreWithEvents.on?.("error", (err: unknown) => {
      console.error("[SessionStore] error:", err);
    });
  }

  // 3) Auth/session and API protection middleware
  app.use(session(sessionConfig));
  setupApiOriginProtection(app);
  setupApiHostSearchHints(app);

  // Lightweight version/health endpoint for deploy consistency checks.
  // In production: returns minimal { ok: true } without git hash unless a valid
  // METRICS_SECRET Bearer token is provided. This prevents commit hash enumeration.
  app.get("/api/health/version", (req: Request, res: Response) => {
    const secret = process.env.METRICS_SECRET?.trim();
    const auth = String(req.headers.authorization || "");
    const isAuthed = !!secret && auth.startsWith("Bearer ") && auth.slice(7).trim() === secret;
    if (process.env.NODE_ENV === "production" && !isAuthed) {
      // Return only a basic liveness signal without internal details.
      return res.json({ ok: true });
    }
    res.json(getBackendVersion());
  });

  app.get("/api/health/ai-providers", (_req: Request, res: Response) => {
    res.json({ ok: true, ...getAiTutorHealthSnapshot() });
  });

  // Metrics endpoint exposes route names, error rates, and latencies.
  // Require METRICS_SECRET Bearer token in production to prevent reconnaissance.
  app.get("/api/metrics", (req: Request, res: Response) => {
    const secret = process.env.METRICS_SECRET?.trim();
    if (secret) {
      const auth = String(req.headers.authorization || "");
      if (!auth.startsWith("Bearer ") || auth.slice(7).trim() !== secret) {
        return res.status(403).json({ error: "Forbidden" });
      }
    } else if (process.env.NODE_ENV === "production") {
      // No secret configured in production — block entirely to avoid
      // exposing route map and error rates to unauthenticated callers.
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(getMetricsSnapshot());
  });

  const rateLimitPgSsl =
    process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production"
      ? { rejectUnauthorized: false as const }
      : { rejectUnauthorized: true as const };
  const rateLimitPool =
    typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0
      ? new pg.Pool({
          connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
          max: 5,
          min: 0,
          connectionTimeoutMillis: 8000,
          ssl: rateLimitPgSsl,
        })
      : null;
  if (rateLimitPool) {
    console.log("[DB] Rate-limit pool configured", {
      max: 5,
      nodeEnv: process.env.NODE_ENV || "development",
      sslNoVerify: process.env.PGSSL_NO_VERIFY === "true",
    });
    rateLimitPool.on("error", (err) => {
      console.error("[RateLimitPool] idle client error:", err.message);
    });
  }

  const redisClient = await getRedisClient();
  const failClosedAuthRateLimit = getEnvFlag("FF_FAIL_CLOSED_AUTH_RATE_LIMIT", true);
  const failClosedMediaRateLimit = getEnvFlag("FF_FAIL_CLOSED_MEDIA_RATE_LIMIT", true);
  // Rate-limit counters are intentionally PostgreSQL-backed by default. Upstash
  // free-tier Redis can exhaust its monthly command quota; auth must not become
  // unavailable just because Redis refuses increments. Redis can still be chosen
  // explicitly for a category after provisioning enough quota.
  const defaultRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.RATE_LIMIT_STORE, "pg");
  const authRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.AUTH_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const mediaRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.MEDIA_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const globalRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.GLOBAL_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const makeRateLimitStore = (
    prefix: string,
    options?: { failClosed?: boolean },
    storeKind: RateLimitStoreKind = defaultRateLimitStoreKind
  ) => {
    if (storeKind === "pg") {
      if (rateLimitPool) return new PgRateLimitStore(rateLimitPool, options);
      if (redisClient) return new RedisRateLimitStore(redisClient, prefix, options);
      return undefined;
    }
    if (storeKind === "redis") {
      if (redisClient) return new RedisRateLimitStore(redisClient, prefix, options);
      if (rateLimitPool) return new PgRateLimitStore(rateLimitPool, options);
      return undefined;
    }
    return undefined;
  };
  const otpSendStore = makeRateLimitStore("otp-send", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const otpVerifyStore = makeRateLimitStore("otp-verify", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const authLoginStore = makeRateLimitStore("auth-login", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const mediaTokenStore = makeRateLimitStore("media-token", { failClosed: failClosedMediaRateLimit }, mediaRateLimitStoreKind);
  const globalApiStore = makeRateLimitStore("global-api", undefined, globalRateLimitStoreKind);
  if (redisClient) {
    console.log("[Redis] Client configured for optional shared features");
  }
  console.log("[RateLimit] Store selection", {
    default: defaultRateLimitStoreKind,
    auth: authRateLimitStoreKind,
    media: mediaRateLimitStoreKind,
    global: globalRateLimitStoreKind,
    pgAvailable: !!rateLimitPool,
    redisAvailable: !!redisClient,
  });

  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return `${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(req.body?.identifier)}`;
    },
    ...(otpSendStore ? { store: otpSendStore } : {}),
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return `${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(req.body?.identifier)}`;
    },
    ...(otpVerifyStore ? { store: otpVerifyStore } : {}),
  });
  app.use("/api/auth/send-otp", otpSendLimiter);
  app.use("/api/auth/verify-otp", otpVerifyLimiter);

  const authLoginKey = (req: Request) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw =
      body.identifier ?? body.email ?? body.phoneNumber ?? body.phone ?? "global";
    return `auth-login:${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(raw)}`;
  };
  const authLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 25,
    message: { message: "Too many login attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: authLoginKey,
    ...(authLoginStore ? { store: authLoginStore } : {}),
  });
  app.use("/api/auth/email-login", authLoginLimiter);
  app.use("/api/auth/verify-firebase", authLoginLimiter);
  app.use("/api/auth/firebase-login", authLoginLimiter);
  app.use("/api/auth/register-complete", authLoginLimiter);

  const mediaTokenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    message: { message: "Too many media requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      const auth = req.headers.authorization || "";
      const suffix = auth.startsWith("Bearer ") ? auth.slice(7, 24) : ipKeyGenerator(req.ip || "");
      return `media-token:${suffix}`;
    },
    ...(mediaTokenStore ? { store: mediaTokenStore } : {}),
  });
  app.use("/api/media-token", mediaTokenLimiter);

  // Global API rate limit — prevents abuse across all endpoints
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path.startsWith("/api/auth/send-otp") ||
      req.path.startsWith("/api/auth/verify-otp") ||
      req.path.startsWith("/api/auth/email-login") ||
      req.path.startsWith("/api/auth/verify-firebase") ||
      req.path.startsWith("/api/auth/firebase-login") ||
      req.path.startsWith("/api/auth/register-complete") ||
      req.path === "/api/media-token",
    ...(globalApiStore ? { store: globalApiStore } : {}),
  });
  app.use("/api", globalApiLimiter);

  // 4) API routes
  const server = await registerRoutes(app);

  // Non-API pages/assets and landing routes
  app.get("/firebase-phone-auth", (_req: Request, res: Response) => {
    const firebaseAuthPath = path.resolve(process.cwd(), "backend", "templates", "firebase-phone-auth.html");
    if (fs.existsSync(firebaseAuthPath)) {
      return res.type("html").sendFile(firebaseAuthPath);
    }
    res.status(404).send("Not found");
  });
  configureExpoAndLanding(app);

  // 5) Error handler (must be last)
  setupErrorHandler(app, isTrustedOrigin);

  const port = parseInt(process.env.PORT || "5000", 10);
  logProductionReleaseHints();

  // Show local network IP for mobile access
  try {
    const { networkInterfaces } = await import("os");
    const nets = networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const net of iface || []) {
        if (net.family === "IPv4" && !net.internal) {
          log(`Mobile access: http://${net.address}:${port}`);
        }
      }
    }
  } catch (_e) {}

  server.listen(port, "0.0.0.0", () => {
    log(`express server running on http://localhost:${port}`);
    // FRW-03: Signal PM2 that the server is ready to receive traffic.
    // Requires wait_ready: true in ecosystem.config.js.
    // Without this signal, PM2 routes requests to the new process immediately
    // on fork — before DB pools and session middleware are initialized.
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });

  // FRW-03: Graceful shutdown on SIGTERM (PM2 reload / container stop).
  // Without this, PM2 kills the process immediately — dropping in-flight HTTP
  // requests including payment verifications and file uploads mid-stream.
  // server.close() stops accepting new connections and waits for active requests
  // to finish. We force-exit after 10 seconds to prevent hung deploys.
  process.on("SIGTERM", () => {
    log("[shutdown] SIGTERM received — draining in-flight requests");
    server.close(() => {
      log("[shutdown] All connections closed — exiting cleanly");
      process.exit(0);
    });
    // Force exit after 10 s if requests are still pending (e.g. a stalled SSE connection).
    // Cast via unknown: DOM typings return `number` for setTimeout, but .unref() is
    // a Node.js-only method on NodeJS.Timeout. The cast is safe — we are always on Node.
    (setTimeout(() => {
      console.warn("[shutdown] Forced exit after 10 s timeout");
      process.exit(1);
    }, 10_000) as unknown as NodeJS.Timeout).unref();
  });

  // Also handle SIGINT (Ctrl+C in development) with the same graceful path.
  process.on("SIGINT", () => {
    log("[shutdown] SIGINT received \u2014 exiting");
    server.close(() => process.exit(0));
    (setTimeout(() => process.exit(1), 5_000) as unknown as NodeJS.Timeout).unref();
  });
})();
