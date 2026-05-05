#!/usr/bin/env node
/**
 * Lightweight smoke load test (no extra deps).
 *
 * Usage:
 *   node scripts/loadtest-smoke.mjs --base https://api.example.com --concurrency 20 --duration 20
 *
 * Multi-instance / LB: pass several bases; each request picks one at random (simulates clients spread across instances).
 *   node scripts/loadtest-smoke.mjs --bases "https://a.example.com,https://b.example.com" --duration 30
 *
 * Authenticated paths (401 without session): set Cookie header, e.g. from browser devtools after login.
 *   node scripts/loadtest-smoke.mjs --base http://localhost:5000 --cookie "connect.sid=..." --include-auth-paths true
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return args[idx + 1];
};

const readBool = (name, fallback) => {
  const v = String(readArg(name, String(fallback))).toLowerCase();
  return v === "1" || v === "true" || v === "yes";
};

const baseSingle = String(readArg("base", "http://localhost:5000")).replace(/\/+$/, "");
const basesRaw = readArg("bases", "");
const bases = basesRaw
  ? String(basesRaw)
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean)
  : [baseSingle];

const concurrency = Math.max(1, Number(readArg("concurrency", "20")) || 20);
const durationSec = Math.max(5, Number(readArg("duration", "20")) || 20);
const cookieHeader = String(readArg("cookie", "")).trim();
const includeAuthPaths = readBool("include-auth-paths", false);

const defaultEndpoints = [
  "/api/courses",
  "/api/live-classes",
  "/api/site-settings",
  "/api/health/ready",
  "/api/health/version",
];

const authEndpoints = ["/api/support/messages", "/api/notifications"];

const extraRaw = readArg("extra", "");
const extraEndpoints = extraRaw
  ? String(extraRaw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : [];

const endpoints = [
  ...defaultEndpoints,
  ...(cookieHeader && includeAuthPaths ? authEndpoints : []),
  ...extraEndpoints,
];

const startedAt = Date.now();
const deadline = startedAt + durationSec * 1000;

let ok = 0;
let failed = 0;
let totalLatency = 0;

function pickBase() {
  return bases[Math.floor(Math.random() * bases.length)];
}

async function hitOnce() {
  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const url = `${pickBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const t0 = Date.now();
  const headers = {};
  if (cookieHeader) {
    headers.Cookie = cookieHeader;
  }
  try {
    const res = await fetch(url, { method: "GET", headers });
    const dt = Date.now() - t0;
    totalLatency += dt;
    if (res.ok) ok += 1;
    else failed += 1;
  } catch {
    failed += 1;
  }
}

async function worker() {
  while (Date.now() < deadline) {
    await hitOnce();
  }
}

async function main() {
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  const total = ok + failed;
  const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;
  const errorRate = total > 0 ? ((failed / total) * 100).toFixed(2) : "0.00";
  console.log(
    JSON.stringify(
      {
        bases,
        endpoints,
        concurrency,
        durationSec,
        totalRequests: total,
        ok,
        failed,
        errorRatePct: Number(errorRate),
        avgLatencyMs: avgLatency,
        note:
          "SSE streams are not exercised here; use a dedicated tool for long-lived /api/.../stream connections. Chat REST is covered if you pass --extra with a valid live class id path.",
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[loadtest-smoke] failed", err);
  process.exit(1);
});
