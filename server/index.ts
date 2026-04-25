import dotenv from "dotenv";
import * as path from "path";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

import express from "express";
import type { Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import * as fs from "fs";

const app = express();
const log = console.log;

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

function setupCors(app: express.Application) {
  const normalizeOrigin = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return new URL(trimmed).origin.toLowerCase();
    } catch {
      return trimmed.replace(/\/+$/, "").toLowerCase();
    }
  };

  const originMatchesPattern = (origin: string, pattern: string): boolean => {
    // Supports entries like: https://*.vercel.app
    if (!pattern.includes("*")) return origin === pattern;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(origin);
  };

  const defaultAllowedOrigins = [
    "https://3ilearning.in",
    // Keep www variant for compatibility.
    "https://www.3ilearning.in",
  ];
  const envOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
  const allowedOriginPatterns = [
    ...defaultAllowedOrigins.map((origin) => normalizeOrigin(origin)),
    ...envOrigins,
  ];

  const corsOptions = {
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      // Allow non-browser clients (curl/mobile/native fetch without Origin header).
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOriginPatterns.some((pattern) => originMatchesPattern(normalizedOrigin, pattern))) {
        return callback(null, true);
      }
      console.warn(`[CORS] blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
  };

  app.use(cors(corsOptions));
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

  log("Serving static Expo files with dynamic manifest routing");

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

  app.use(express.static(path.resolve(process.cwd(), "static-build", "web")));
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

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

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

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
      res.setHeader("Content-Security-Policy", "frame-ancestors *");
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

  const sessionConfig: session.SessionOptions = {
    secret: process.env.SESSION_SECRET || (isProduction
      ? (() => { throw new Error("SESSION_SECRET must be set in production"); })()
      : "dev-secret-not-for-production"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,        // HTTPS only in production
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",  // "none" required for cross-origin with credentials
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  };

  if (isProduction && process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionConfig.store = new PgSession({
      conString: normalizeDatabaseUrl(process.env.DATABASE_URL),
      tableName: "session",
      createTableIfMissing: true,
    });
  }

  // 3) Auth/session and API protection middleware
  app.use(session(sessionConfig));

  // Lightweight version/health endpoint for deploy consistency checks.
  app.get("/api/health/version", (_req: Request, res: Response) => {
    res.json(getBackendVersion());
  });

  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return `${ipKeyGenerator(req.ip || "")}:${req.body?.identifier || "global"}`;
    },
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => {
      return `${ipKeyGenerator(req.ip || "")}:${req.body?.identifier || "global"}`;
    },
  });
  app.use("/api/auth/send-otp", otpSendLimiter);
  app.use("/api/auth/verify-otp", otpVerifyLimiter);

  // Global API rate limit — prevents abuse across all endpoints
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,  // 300 req/min per IP — plenty for normal use
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/send-otp") || req.path.startsWith("/api/auth/verify-otp"),
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
  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);

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