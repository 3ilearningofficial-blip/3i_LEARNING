#!/usr/bin/env tsx
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[admin:check] DATABASE_URL not found");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

async function run() {
  const r = await pool.query(
    "SELECT id, role, email, phone FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 20"
  );
  const admins = r.rows.map((x: any) => ({
    id: x.id,
    role: x.role,
    email: x.email ? String(x.email).replace(/(^.).+(@.*$)/, "$1***$2") : null,
    phone: x.phone ? String(x.phone).replace(/.(?=.{2})/g, "*") : null,
  }));
  console.log(JSON.stringify({ adminCount: r.rowCount, admins }, null, 2));
}

run()
  .catch((err) => {
    console.error("[admin:check] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
