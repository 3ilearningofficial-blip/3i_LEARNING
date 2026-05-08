import dotenv from "dotenv";
import * as path from "path";

if (process.env.NODE_ENV !== "production" || process.env.LOAD_DOTENV === "true") {
  dotenv.config({
    path: path.resolve(process.cwd(), ".env"),
  });
}

import express from "express";
import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import * as fs from "fs";
import pg from "pg";
import { PgRateLimitStore } from "./pg-rate-limit-store";

const app = express();
const log = console.log;

Sentry.init({
  dsn: "https://d7c714bdd1391597e651669e7a87ba26@o4511353056264192.ingest.us.sentry.io/4511353198346240",
  integrations: [Sentry.expressIntegration(), nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

function normalizeDatabaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    if (!sslMode || sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

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
      "X-Web-Form-Factor",
    ],
    credentials: true,
    exposedHeaders: ["Content-Length", "Content-Type", "Content-Disposition"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
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
    const clientPlatform = (req.get("x-client-platform") || "").trim().toLowerCase();
    const hasNativeAppHeader = clientPlatform === "android" || clientPlatform === "ios";
    const trustedOrigin = origin ? isTrustedOrigin(origin) : false;
    const trustedReferer = referer ? isTrustedOrigin(referer) : false;
    const missingBrowserHeaders = !origin && !referer;

    if (trustedOrigin || trustedReferer) return next();
    // Native app requests (expo/fetch) may omit Origin/Referer.
    // If they explicitly identify as android/ios, allow them.
    if (hasNativeAppHeader && missingBrowserHeaders) return next();

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
    const start = Date.now();
    const reqPath = req.path;
    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      // Only log slow requests (>500ms) or errors in production to reduce I/O
      if (duration > 500 || res.statusCode >= 500) {
        log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
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
    `[startup] production mode | scheduler_role=${schedulerRole} | health=/api/health/version,/api/health/ready`
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
    "server",
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

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message =
      status >= 500 && process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    // Make sure error responses still carry CORS credential headers — otherwise the
    // browser logs a confusing "Access-Control-Allow-Credentials" error on top of
    // whatever the underlying failure was. cors() normally handles this for
    // happy-path responses but is bypassed when an error short-circuits the chain.
    const origin = req.get("origin");
    if (origin && isTrustedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }

    return res.status(status).json({ message });
  });
}

function normalizeOtpIdentifier(input: unknown): string {
  const raw = String(input || "").trim().toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return `phone:${digits.slice(-10)}`;
  return `id:${raw || "global"}`;
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
  app.use(compression());
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
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
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
  }

  // 3) Auth/session and API protection middleware
  app.use(session(sessionConfig));
  setupApiOriginProtection(app);
  setupApiHostSearchHints(app);

  // Lightweight version/health endpoint for deploy consistency checks.
  app.get("/api/health/version", (_req: Request, res: Response) => {
    res.json(getBackendVersion());
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

  const otpSendStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : undefined;
  const otpVerifyStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : undefined;
  const globalApiStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : undefined;

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

  // Global API rate limit — prevents abuse across all endpoints
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 600,
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/send-otp") || req.path.startsWith("/api/auth/verify-otp"),
    ...(globalApiStore ? { store: globalApiStore } : {}),
  });
  app.use("/api", globalApiLimiter);

  // 4) API routes
  const server = await registerRoutes(app);

  // Non-API pages/assets and landing routes
  app.get("/firebase-phone-auth", (_req: Request, res: Response) => {
    const firebaseAuthPath = path.resolve(process.cwd(), "server", "templates", "firebase-phone-auth.html");
    if (fs.existsSync(firebaseAuthPath)) {
      return res.type("html").sendFile(firebaseAuthPath);
    }
    res.status(404).send("Not found");
  });
  configureExpoAndLanding(app);

  // 5) Error handler (must be last)
  Sentry.setupExpressErrorHandler(app);
  setupErrorHandler(app);

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
  });
})();