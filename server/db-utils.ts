/**
 * db-utils.ts
 * Shared database URL and connection utilities.
 * Extracted from routes.ts and index.ts (Phase 2 refactor — T-03).
 */

/**
 * Normalises a PostgreSQL connection string to always use sslmode=verify-full.
 * This is required for Neon serverless Postgres and any production DB with SSL.
 * Previously this function was duplicated in both server/index.ts and server/routes.ts.
 */
export function normalizeDatabaseUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    // Keep current strict behavior across pg major versions and silence warning.
    if (!sslMode || sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}
