#!/usr/bin/env tsx
import dotenv from "dotenv";
import fs from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? undefined : { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    const t = await client.query(`SELECT to_regclass('public.staff_profiles') AS tbl`);
    const exists = !!t.rows[0]?.tbl;
    console.log("[smoke] staff_profiles:", exists ? "EXISTS" : "MISSING");
    if (!exists) {
      const rel = "migrations/0060_staff_rbac.sql";
      const sql = fs.readFileSync(rel, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (file_name, checksum, applied_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rel, checksum, Date.now()],
      );
      await client.query("COMMIT");
      console.log("[smoke] Applied", rel);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[smoke] migration check failed:", e.message);
  process.exit(1);
});
