#!/usr/bin/env node
/**
 * Lightweight smoke load test (no extra deps).
 *
 * Usage:
 *   node scripts/loadtest-smoke.mjs --base https://api.3ilearning.in --concurrency 20 --duration 20
 */

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx === args.length - 1) return fallback;
  return args[idx + 1];
};

const base = String(readArg("base", "http://localhost:5000")).replace(/\/+$/, "");
const concurrency = Math.max(1, Number(readArg("concurrency", "20")) || 20);
const durationSec = Math.max(5, Number(readArg("duration", "20")) || 20);

const endpoints = ["/api/courses", "/api/live-classes", "/api/site-settings"];
const startedAt = Date.now();
const deadline = startedAt + durationSec * 1000;

let ok = 0;
let failed = 0;
let totalLatency = 0;

async function hitOnce() {
  const path = endpoints[Math.floor(Math.random() * endpoints.length)];
  const url = `${base}${path}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "GET" });
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
        base,
        concurrency,
        durationSec,
        totalRequests: total,
        ok,
        failed,
        errorRatePct: Number(errorRate),
        avgLatencyMs: avgLatency,
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

