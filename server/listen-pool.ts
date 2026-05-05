import { Pool } from "pg";

/**
 * Small pool dedicated to long-lived `LISTEN` clients (SSE).
 * Keeps `LISTEN` traffic off the main API pool configured in routes.ts.
 */
export function createListenPool(connectionString: string): Pool {
  const max = Math.min(100, Math.max(5, parseInt(process.env.PG_LISTEN_POOL_MAX || "32", 10) || 32));
  return new Pool({
    connectionString,
    ssl:
      process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production"
        ? { rejectUnauthorized: false }
        : { rejectUnauthorized: true },
    max,
    min: 0,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 120_000,
  });
}
