#!/usr/bin/env tsx
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(projectRoot, ".env") });

const migrationFiles = [
  "migrations/0001_production_hardening_baseline.sql",
  "migrations/0002_runtime_tables_followup.sql",
  "migrations/0003_runtime_schema_baseline.sql",
  "migrations/0004_user_sessions.sql",
  "migrations/0005_student_progress_tracking.sql",
  "migrations/0006_web_dual_device_slots.sql",
];

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[db:apply-sql] DATABASE_URL not found");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function run() {
  const client = await pool.connect();
  try {
    for (const relativeFile of migrationFiles) {
      const absoluteFile = path.resolve(projectRoot, relativeFile);
      const sql = await fs.readFile(absoluteFile, "utf8");
      console.log(`[db:apply-sql] applying ${relativeFile}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    console.log("[db:apply-sql] all SQL migrations applied");
  } finally {
    client.release();
  }
}

run()
  .catch((err) => {
    console.error("[db:apply-sql] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
