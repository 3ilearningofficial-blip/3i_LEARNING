#!/usr/bin/env node
/**
 * Production push notification verification (read-only + optional test send).
 *
 * Usage:
 *   node scripts/verify-push-production.mjs
 *   SEND_TEST_PUSH=1 node scripts/verify-push-production.mjs
 *
 * Requires DATABASE_URL in .env for DB checks (optional).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const API_BASE = process.env.API_BASE || "https://api.3ilearning.in";
const WEB_BASE = process.env.WEB_BASE || "https://3ilearning.in";

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

const results = [];

function pass(name, detail) {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}: ${detail}`);
}

function fail(name, detail) {
  results.push({ name, ok: false, detail });
  console.log(`FAIL  ${name}: ${detail}`);
}

function warn(name, detail) {
  results.push({ name, ok: null, detail });
  console.log(`WARN  ${name}: ${detail}`);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, json };
}

function unwrap(json) {
  if (json && typeof json === "object" && typeof json.success === "boolean" && "data" in json) {
    return json.data;
  }
  return json;
}

async function checkPublicInfra() {
  const keyRes = await fetchJson(`${API_BASE}/api/push/web-public-key`);
  const keyPayload = unwrap(keyRes.json);
  if (keyRes.res.ok && keyPayload?.publicKey) {
    pass("vapid_public_key", `configured (${String(keyPayload.publicKey).slice(0, 12)}...)`);
  } else {
    fail("vapid_public_key", `status=${keyRes.res.status}`);
  }

  const ready = await fetchJson(`${API_BASE}/api/health/ready`);
  const readyData = unwrap(ready.json);
  if (readyResOk(ready, readyData)) {
    pass("health_ready", `db=${readyData.checks?.db}, tables=${readyData.checks?.tables}`);
  } else {
    fail("health_ready", JSON.stringify(readyData));
  }

  const swRes = await fetch(`${WEB_BASE}/web-push-sw.js`);
  const swText = await swRes.text();
  const localSw = fs.readFileSync(path.join(root, "public", "web-push-sw.js"), "utf8");
  if (swRes.ok && swText.includes('addEventListener("push"') && swText.trim() === localSw.trim()) {
    pass("service_worker_deployed", `${WEB_BASE}/web-push-sw.js matches repo`);
  } else if (swRes.ok && swText.includes('addEventListener("push"')) {
    warn("service_worker_deployed", "live SW differs from repo (may be older deploy)");
  } else {
    fail("service_worker_deployed", `status=${swRes.status}`);
  }

  const regRes = await fetchJson(`${API_BASE}/api/push/web/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: {} }),
  });
  if (regRes.res.status === 401) {
    pass("web_register_requires_auth", "POST /api/push/web/register returns 401 without session");
  } else {
    warn("web_register_requires_auth", `expected 401, got ${regRes.res.status}`);
  }

  const expoReg = await fetchJson(`${API_BASE}/api/push/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "invalid", platform: "android" }),
  });
  if (expoReg.res.status === 401) {
    pass("expo_register_requires_auth", "POST /api/push/register returns 401 without session");
  } else {
    warn("expo_register_requires_auth", `expected 401, got ${expoReg.res.status}`);
  }
}

function readyResOk(ready, readyData) {
  return ready.res.ok && readyData?.ok === true && readyData?.checks?.tables === true;
}

async function checkDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    warn("database_counts", "DATABASE_URL not set — skip SQL checks");
    return null;
  }

  let pg;
  try {
    pg = (await import("pg")).default;
  } catch {
    warn("database_counts", "pg module unavailable");
    return null;
  }

  const pool = new pg.Pool({ connectionString: url, ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false } });
  try {
    const webCount = await pool.query(
      "SELECT COUNT(*)::int AS active_web FROM web_push_subscriptions WHERE is_active = TRUE"
    );
    const activeWeb = webCount.rows[0]?.active_web ?? 0;
    if (activeWeb > 0) {
      pass("web_push_subscriptions", `${activeWeb} active subscription(s)`);
    } else {
      warn("web_push_subscriptions", "0 active subscriptions (users may not have allowed browser notifications yet)");
    }

    const platformCounts = await pool.query(
      `SELECT platform, COUNT(*)::int AS cnt
       FROM user_push_tokens WHERE is_active = TRUE
       GROUP BY platform ORDER BY cnt DESC`
    );
    const androidRow = platformCounts.rows.find((r) => String(r.platform).toLowerCase() === "android");
    const androidCount = androidRow?.cnt ?? 0;
    if (androidCount > 0) {
      pass("android_expo_tokens", `${androidCount} active Android token(s)`);
    } else {
      warn("android_expo_tokens", "0 active Android Expo tokens in DB");
    }

    const summary = platformCounts.rows.map((r) => `${r.platform}:${r.cnt}`).join(", ") || "none";
    pass("expo_tokens_by_platform", summary);

    const recentAndroid = await pool.query(
      `SELECT user_id, LEFT(expo_push_token, 48) AS token_prefix, last_seen_at
       FROM user_push_tokens
       WHERE is_active = TRUE AND LOWER(platform) = 'android'
       ORDER BY last_seen_at DESC LIMIT 5`
    );
    if (recentAndroid.rows.length > 0) {
      pass(
        "recent_android_tokens",
        recentAndroid.rows.map((r) => `user=${r.user_id} token=${r.token_prefix}...`).join(" | ")
      );
    }

    const recentWeb = await pool.query(
      `SELECT user_id, LEFT(endpoint, 60) AS endpoint_prefix, last_seen_at
       FROM web_push_subscriptions
       WHERE is_active = TRUE
       ORDER BY last_seen_at DESC LIMIT 5`
    );
    if (recentWeb.rows.length > 0) {
      pass(
        "recent_web_subscriptions",
        recentWeb.rows.map((r) => `user=${r.user_id}`).join(", ")
      );
    }

    const mig = await pool.query(
      "SELECT file_name FROM schema_migrations WHERE file_name LIKE '%0055%' LIMIT 1"
    ).catch(() => ({ rows: [] }));
    if (mig.rows.length > 0) {
      pass("migration_0055", `applied (${mig.rows[0].file_name})`);
    } else {
      warn("migration_0055", "0055 not found in schema_migrations");
    }

    return { activeWeb, androidCount, platformCounts: platformCounts.rows };
  } finally {
    await pool.end();
  }
}

async function checkExpoFcm() {
  const projectId = "1a053771-7e15-4507-9ecb-18c317018357";
  const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const configuredId = appJson?.expo?.extra?.eas?.projectId;
  if (configuredId === projectId) {
    pass("eas_project_id", projectId);
  } else {
    fail("eas_project_id", `expected ${projectId}, got ${configuredId}`);
  }

  const gsPath = path.join(root, "google-services.json");
  if (fs.existsSync(gsPath)) {
    const gs = JSON.parse(fs.readFileSync(gsPath, "utf8"));
    const pkg = appJson?.expo?.android?.package;
    const hasPkg = (gs.client || []).some(
      (c) => c?.client_info?.android_client_info?.package_name === pkg || c?.android_client_info?.package_name === pkg
    );
    if (hasPkg) pass("google_services_json", `includes ${pkg}`);
    else fail("google_services_json", `missing package ${pkg}`);
  } else {
    fail("google_services_json", "file missing");
  }

  warn(
    "expo_fcm_credentials",
    "Run on your machine: npx eas credentials -p android (production profile) and confirm FCM V1 service account is uploaded"
  );
}

async function optionalTestSend() {
  if (process.env.SEND_TEST_PUSH !== "1") {
    warn("test_push_send", "Set SEND_TEST_PUSH=1 to send a test web push via VAPID");
    return;
  }

  const url = process.env.DATABASE_URL;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:3ilearningofficial@gmail.com";
  if (!url || !pub || !priv) {
    fail("test_push_send", "DATABASE_URL + VAPID keys required in .env");
    return;
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: url, ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false } });
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(subject, pub, priv);

  try {
    const subs = await pool.query(
      "SELECT id, endpoint, p256dh, auth FROM web_push_subscriptions WHERE is_active = TRUE LIMIT 10"
    );
    if (!subs.rows.length) {
      warn("test_push_send", "no active web subscriptions to test");
      return;
    }

    let sent = 0;
    const body = JSON.stringify({
      title: "3i Learning test",
      body: "Push verification test — if you see this, web push delivery works.",
      data: { type: "admin_notification" },
    });

    for (const row of subs.rows) {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body
        );
        sent += 1;
      } catch (err) {
        warn("test_push_send_delivery", `sub ${row.id}: ${err?.statusCode || err?.message || err}`);
      }
    }

    if (sent > 0) pass("test_push_send", `delivered to ${sent}/${subs.rows.length} web subscription(s)`);
    else fail("test_push_send", "all web push sends failed");
  } finally {
    await pool.end();
  }
}

async function main() {
  console.log(`\n=== Push verification ===`);
  console.log(`API: ${API_BASE}`);
  console.log(`Web: ${WEB_BASE}\n`);

  await checkPublicInfra();
  const dbStats = await checkDatabase();
  await checkExpoFcm();
  await optionalTestSend();

  const failed = results.filter((r) => r.ok === false).length;
  const passed = results.filter((r) => r.ok === true).length;
  const warned = results.filter((r) => r.ok === null).length;

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${warned} warnings ===\n`);

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
