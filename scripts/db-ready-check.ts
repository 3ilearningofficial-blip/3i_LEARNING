#!/usr/bin/env tsx
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { REQUIRED_COLUMNS, REQUIRED_TABLES } from "../server/schema-readiness-contract";

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
  await pool.query("SELECT 1");

  const tableRes = await pool.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  const presentTables = new Set(tableRes.rows.map((row) => String(row.table_name)));
  const missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));

  const columnRes = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const presentColumns = new Map<string, Set<string>>();
  for (const row of columnRes.rows) {
    if (!presentColumns.has(row.table_name)) presentColumns.set(row.table_name, new Set());
    presentColumns.get(row.table_name)?.add(row.column_name);
  }

  const missingColumns: string[] = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const set = presentColumns.get(table) ?? new Set<string>();
    for (const column of columns) {
      if (!set.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  const ok = missingTables.length === 0 && missingColumns.length === 0;
  console.log(
    JSON.stringify(
      {
        ok,
        checks: {
          db: true,
          tables: missingTables.length === 0,
          columns: missingColumns.length === 0,
        },
        missingTables,
        missingColumns,
      },
      null,
      2
    )
  );

  if (!ok) process.exitCode = 1;
}

run()
  .catch((err) => {
    console.error("[db:check] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
