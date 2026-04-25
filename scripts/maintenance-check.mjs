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

async function q(name, sql) {
  const t0 = Date.now();
  const res = await pool.query(sql);
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
      AND indexname IN (
        'idx_enrollments_user_course_status_valid_until',
        'idx_lectures_course_section',
        'idx_materials_course_section',
        'idx_live_classes_course_scheduled',
        'idx_download_tokens_token_used_expires'
      )
      ORDER BY indexname
    `),
  ]);

  console.log(JSON.stringify({
    ok: true,
    now: Date.now(),
    checks,
  }, null, 2));
}

run()
  .catch((err) => {
    console.error("[maintenance] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
