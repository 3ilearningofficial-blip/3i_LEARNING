#!/usr/bin/env tsx
import dotenv from "dotenv";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.resolve(projectRoot, ".env") });

async function discoverMigrationFiles(): Promise<string[]> {
  const migrationDir = path.resolve(projectRoot, "migrations");
  const entries = await fs.readdir(migrationDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /^\d+.*\.sql$/i.test(e.name))
    .map((e) => `migrations/${e.name}`)
    .sort((a, b) => a.localeCompare(b));
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[db:apply-sql] DATABASE_URL not found");
  process.exit(1);
}
const dbHost = (() => {
  try {
    return new URL(connectionString).hostname.toLowerCase();
  } catch {
    return "";
  }
})();
const useInsecureSsl = dbHost && dbHost !== "localhost" && dbHost !== "127.0.0.1";

const pool = new pg.Pool({
  connectionString,
  ...(useInsecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  max: 1,
});

async function run() {
  const migrationFiles = await discoverMigrationFiles();
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [8420010]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        file_name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at BIGINT NOT NULL
      )
    `);
    for (const relativeFile of migrationFiles) {
      const absoluteFile = path.resolve(projectRoot, relativeFile);
      const sql = await fs.readFile(absoluteFile, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM schema_migrations WHERE file_name = $1 LIMIT 1",
        [relativeFile]
      );
      if (existing.rows.length > 0) {
        const prev = String(existing.rows[0].checksum || "");
        if (prev !== checksum) {
          throw new Error(`[db:apply-sql] checksum mismatch for ${relativeFile}; refuse to re-apply modified migration`);
        }
        console.log(`[db:apply-sql] skipping ${relativeFile} (already applied)`);
        continue;
      }
      console.log(`[db:apply-sql] applying ${relativeFile}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (file_name, checksum, applied_at) VALUES ($1, $2, $3)",
          [relativeFile, checksum, Date.now()]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    console.log("[db:apply-sql] all SQL migrations applied");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [8420010]).catch(() => {});
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
