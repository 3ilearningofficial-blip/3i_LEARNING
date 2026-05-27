#!/usr/bin/env node
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[maintenance] DATABASE_URL not found");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

/** Indexes created by migrations 0027–0033 that matter for prod performance. */
const REQUIRED_INDEXES = [
  "idx_notifications_sent_dedup",
  "idx_lectures_video_url_normalized",
  "idx_live_classes_recording_url_normalized",
  "idx_enrollments_download_cleanup_pending",
  "idx_live_classes_is_live_scheduled_at",
  "idx_live_classes_cf_recording_uid",
];

async function q(name, sql, params = []) {
  const t0 = Date.now();
  const res = await pool.query(sql, params);
  return {
    name,
    elapsedMs: Date.now() - t0,
    rows: res.rows,
  };
}

async function run() {
  const checks = await Promise.all([
    q("table_counts", `
      SELECT
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM courses) AS courses,
        (SELECT COUNT(*) FROM lectures) AS lectures,
        (SELECT COUNT(*) FROM tests) AS tests,
        (SELECT COUNT(*) FROM study_materials) AS materials
    `),
    q("active_connections", `
      SELECT COUNT(*)::int AS active_connections
      FROM pg_stat_activity
      WHERE state = 'active'
    `),
    q("index_health", `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname='public'
      AND indexname = ANY($1::text[])
      ORDER BY indexname
    `, [REQUIRED_INDEXES]),
  ]);

  const found = new Set((checks[2].rows || []).map((r) => r.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !found.has(name));

  const ok = missingIndexes.length === 0;

  console.log(JSON.stringify({
    ok,
    now: Date.now(),
    missingIndexes,
    checks,
  }, null, 2));

  if (!ok) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[maintenance] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
