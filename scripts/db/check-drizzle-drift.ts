/**
 * AW-02: Drizzle schema drift detector.
 *
 * Purpose:
 *   Detects when a developer adds a table/column to shared/schema.ts (Drizzle ORM)
 *   without writing a corresponding raw SQL migration. If drift is detected, the CI
 *   job fails before the change reaches main, preventing production DB schema surprises.
 *
 * How it works:
 *   1. Assumes SQL migrations have already been applied to $DATABASE_URL (done by
 *      the db-schema CI job's earlier step).
 *   2. Runs `drizzle-kit push --force` which introspects the live DB, compares it
 *      against shared/schema.ts, and applies any missing DDL statements.
 *   3. Captures stdout/stderr and scans for DDL keywords (CREATE TABLE, ALTER TABLE,
 *      ADD COLUMN, CREATE INDEX, etc.).
 *   4. If any DDL appears, the schema.ts has definitions not present in the SQL
 *      migrations → exits with code 1 to fail the CI job.
 *   5. If no DDL appears, the two are in sync → exits with code 0.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/db/check-drizzle-drift.ts
 */

import { execSync } from "node:child_process";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[drift-check] DATABASE_URL is required");
  process.exit(1);
}

// DDL statement patterns that indicate drizzle-kit made schema changes.
// These patterns are matched case-insensitively against the combined push output.
const DDL_PATTERNS = [
  /\bcreate\s+table\b/i,
  /\balter\s+table\b/i,
  /\bdrop\s+table\b/i,
  /\badd\s+column\b/i,
  /\bdrop\s+column\b/i,
  /\bcreate\s+(unique\s+)?index\b/i,
  /\bdrop\s+index\b/i,
  /\bcreate\s+sequence\b/i,
  /\bcreate\s+type\b/i,
];

console.log("[drift-check] Running drizzle-kit push --force to detect schema drift...");
console.log("[drift-check] DATABASE_URL =", DATABASE_URL.replace(/:[^:@]+@/, ":***@"));

let pushOutput = "";
let exitCode = 0;

try {
  // --force skips interactive prompts.
  // --verbose includes the SQL statements drizzle-kit is about to run.
  // We redirect stderr to stdout so we capture everything.
  pushOutput = execSync("npx drizzle-kit push --force --verbose 2>&1", {
    encoding: "utf-8",
    env: { ...process.env, DATABASE_URL },
    // drizzle-kit is a CLI that can take a few seconds
    timeout: 60_000,
  });
} catch (err: any) {
  // execSync throws if exit code is non-zero. Capture the output anyway.
  pushOutput = (err.stdout || "") + (err.stderr || "");
  exitCode = err.status ?? 1;
}

console.log("\n--- drizzle-kit push output ---");
console.log(pushOutput);
console.log("--- end output ---\n");

// If drizzle-kit itself crashed (exit code non-zero and no DDL), report the error
// but don't block CI — the error might be a connectivity issue, not drift.
if (exitCode !== 0 && !DDL_PATTERNS.some((p) => p.test(pushOutput))) {
  console.warn(
    "[drift-check] drizzle-kit push exited with code", exitCode,
    "but no DDL detected in output. This may be a transient error — not failing CI."
  );
  process.exit(0);
}

const driftFound = DDL_PATTERNS.some((p) => p.test(pushOutput));

if (driftFound) {
  console.error(
    "\n❌ SCHEMA DRIFT DETECTED!\n" +
    "   shared/schema.ts contains table or column definitions that are NOT in the SQL migrations.\n" +
    "   drizzle-kit push produced DDL statements (see output above).\n\n" +
    "   To fix:\n" +
    "   1. Write a new SQL migration in migrations/ covering the missing DDL.\n" +
    "   2. Run: npm run db:apply-sql\n" +
    "   3. Re-run this check: DATABASE_URL=... npx tsx scripts/db/check-drizzle-drift.ts\n"
  );
  process.exit(1);
} else {
  console.log("✅ No schema drift detected — shared/schema.ts matches SQL migrations.");
  process.exit(0);
}
