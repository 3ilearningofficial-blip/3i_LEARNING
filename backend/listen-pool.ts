import { Pool } from "pg";

/**
 * Small pool dedicated to long-lived `LISTEN` clients (SSE).
 * Keeps `LISTEN` traffic off the main API pool configured in routes.ts.
 */
export function createListenPool(connectionString: string): Pool {
  const defaultMax = process.env.NODE_ENV === "production" ? 12 : 20;
  const parsedMax = parseInt(process.env.PG_LISTEN_POOL_MAX || String(defaultMax), 10) || defaultMax;
  const max = Math.min(40, Math.max(2, parsedMax));
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
