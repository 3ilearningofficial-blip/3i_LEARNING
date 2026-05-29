/**
 * ecosystem.config.js — PM2 process configuration for 3i Learning
 *
 * WHY THIS FILE EXISTS:
 *   `pm2 restart backend --update-env` only propagates the current shell's
 *   environment. If the .env file was updated but the shell that launched PM2
 *   doesn't have the new vars, --update-env propagates nothing — silently.
 *   This file loads .env explicitly via dotenv so every restart picks up the
 *   latest secrets without manual intervention.
 *
 * PROCESS ARCHITECTURE:
 *   - "backend"   : HTTP API workers (2 instances). Schedulers DISABLED here
 *                   so setInterval loops don't compete with HTTP request serving
 *                   and don't fire notifications multiple times.
 *   - "scheduler" : Single dedicated process. Schedulers ENABLED only here.
 *                   Advisory locks in schedulers.ts ensure only one instance
 *                   fires per tick even if this process is accidentally started
 *                   on multiple machines.
 *
 * CPR-01: Separating schedulers from HTTP workers prevents the live notification
 *         INSERT (potentially 10,000+ rows) from blocking the event loop that
 *         serves student HTTP requests simultaneously.
 *
 * USAGE:
 *   Start all:       pm2 start ecosystem.config.js --env production
 *   Reload HTTP:     pm2 reload backend
 *   Restart all:     pm2 reload ecosystem.config.js --env production
 *   Stop scheduler:  pm2 stop scheduler
 */

// Load .env before passing env_production to PM2 processes.
// This makes secret values available in the env_production block below.
require("dotenv").config();

const sharedEnv = {
  NODE_ENV: "production",
  // Read from .env at config-load time so PM2 bakes the values in.
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  OTP_HMAC_SECRET: process.env.OTP_HMAC_SECRET,
  REDIS_URL: process.env.REDIS_URL,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY,
  EXPO_PUBLIC_DOMAIN: process.env.EXPO_PUBLIC_DOMAIN,
  // Pool size: each HTTP worker gets PG_POOL_MAX connections.
  // With 2 workers × 25 = 50 connections to Neon's PgBouncer proxy — safe headroom.
  PG_POOL_MAX: process.env.PG_POOL_MAX || "25",
  PORT: process.env.PORT || "5000",
};

module.exports = {
  apps: [
    // ─── HTTP API Workers ───────────────────────────────────────────────────────
    {
      name: "backend",
      script: "./server_dist/index.js",

      // 2 workers: enough for I/O concurrency without overloading a single EC2.
      // Increase to 4 on a c5.large or larger instance.
      instances: process.env.PM2_INSTANCES ? parseInt(process.env.PM2_INSTANCES, 10) : 2,
      exec_mode: "cluster",

      // CPR-01: Schedulers are disabled on HTTP workers.
      // All 5 setInterval loops run ONLY in the "scheduler" process below.
      env_production: {
        ...sharedEnv,
        RUN_BACKGROUND_SCHEDULERS: "false",
      },

      // FRW-03: PM2 waits for the process to signal readiness before routing traffic.
      // The server calls process.send('ready') after listen() completes (index.ts).
      // This ensures DB pools and session middleware are fully initialized before
      // any student requests arrive during rolling deploys or crash recovery.
      wait_ready: true,
      listen_timeout: 10000,

      // Zero-downtime reload: new process starts, old drains, then exits.
      // Matches our SIGTERM graceful shutdown handler (10s drain window).
      kill_timeout: 12000,

      // Log files
      out_file: "./logs/backend-out.log",
      error_file: "./logs/backend-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      // Restart on crash, but not more than 10 times in 5 minutes (avoids restart loop).
      max_restarts: 10,
      min_uptime: "30s",
    },

    // ─── Background Scheduler Process ──────────────────────────────────────────
    {
      name: "scheduler",
      script: "./server_dist/index.js",

      // Single instance ONLY. Advisory locks in schedulers.ts prevent double-firing
      // even if this is accidentally started twice, but 1 instance is the intention.
      instances: 1,
      exec_mode: "fork",

      env_production: {
        ...sharedEnv,
        // CPR-01: Schedulers ENABLED only on this process.
        RUN_BACKGROUND_SCHEDULERS: "true",
        // Scheduler process uses a smaller HTTP pool — it serves no user traffic.
        // The pool is only used for advisory locks and scheduler DB queries.
        PG_POOL_MAX: "5",
        // Run on a different port so it doesn't accidentally receive HTTP traffic
        // if something misconfigures the load balancer.
        PORT: process.env.SCHEDULER_PORT || "5001",
      },

      out_file: "./logs/scheduler-out.log",
      error_file: "./logs/scheduler-err.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",

      max_restarts: 10,
      min_uptime: "30s",
      kill_timeout: 12000,
    },
  ],
};
