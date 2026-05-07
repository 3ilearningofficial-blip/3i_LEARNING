#!/usr/bin/env tsx
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { checkDatabaseReadiness } from "../server/db-readiness";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[db:check] DATABASE_URL not found");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function run() {
  const result = await checkDatabaseReadiness(pool);
  console.log(
    JSON.stringify(
      result,
      null,
      2
    )
  );

  if (!result.ok) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[db:check] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
