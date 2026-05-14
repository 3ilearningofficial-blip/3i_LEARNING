#!/usr/bin/env tsx
/**
 * When a migration file changes after it was already applied, apply-sql-migrations
 * refuses to continue (checksum mismatch). This script only updates the stored checksum
 * to match the current file — it does NOT re-run the SQL. Use only when the database
 * already reflects that migration (e.g. comment/whitespace change in the file).
 *
 * Usage:
 *   npx tsx scripts/repair-migration-checksum.ts migrations/0014_....sql
 *   npx tsx scripts/repair-migration-checksum.ts migrations/0014_....sql --apply
 */
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(projectRoot, ".env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[repair-migration-checksum] DATABASE_URL not found");
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== "--apply");
const apply = process.argv.includes("--apply");
const relativeFile = args[0];

if (!relativeFile || !relativeFile.startsWith("migrations/") || !relativeFile.endsWith(".sql")) {
  console.error(
    "[repair-migration-checksum] Pass a migration path, e.g. migrations/0014_otp_challenges_and_send_throttle.sql"
  );
  console.error("  Append --apply to write the new checksum to schema_migrations.");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function run() {
  const absoluteFile = path.resolve(projectRoot, relativeFile);
  const sql = await fs.readFile(absoluteFile, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT checksum FROM schema_migrations WHERE file_name = $1 LIMIT 1",
      [relativeFile]
    );
    if (existing.rows.length === 0) {
      console.error(
        `[repair-migration-checksum] No row for ${relativeFile}. This migration was never recorded; do not use this script — run db:apply-sql normally.`
      );
      process.exitCode = 1;
      return;
    }
    const prev = String(existing.rows[0].checksum || "");
    if (prev === checksum) {
      console.log(`[repair-migration-checksum] Checksum already matches for ${relativeFile}. Nothing to do.`);
      return;
    }
    console.log(`[repair-migration-checksum] file: ${relativeFile}`);
    console.log(`[repair-migration-checksum] old checksum: ${prev}`);
    console.log(`[repair-migration-checksum] new checksum: ${checksum}`);
    if (!apply) {
      console.log(
        "[repair-migration-checksum] Dry run only. Run the same command with --apply to update schema_migrations (SQL is not re-executed)."
      );
      return;
    }
    await client.query("UPDATE schema_migrations SET checksum = $1 WHERE file_name = $2", [
      checksum,
      relativeFile,
    ]);
    console.log(`[repair-migration-checksum] Updated checksum for ${relativeFile}. Next: npm run db:apply-sql`);
  } finally {
    client.release();
  }
}

run()
  .catch((err) => {
    console.error("[repair-migration-checksum] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
