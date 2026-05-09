import type { Pool } from "pg";

/**
 * express-rate-limit v8 store backed by PostgreSQL so limits are shared across app instances.
 * Table: express_rate_limit (see migrations/0011_distributed_rate_limits_and_session.sql).
 */
export class PgRateLimitStore {
  private windowMs = 60_000;
  /** Marks this store as shared across instances (express-rate-limit contract). */
  readonly localKeys = false;

  constructor(private readonly pool: Pool) {}

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  async get(key: string): Promise<{ totalHits: number; resetTime: Date } | undefined> {
    try {
      const r = await this.pool.query(
        `SELECT total_hits, reset_time_ms FROM express_rate_limit WHERE bucket_key = $1`,
        [key]
      );
      if (r.rows.length === 0) return undefined;
      const row = r.rows[0] as { total_hits: number; reset_time_ms: string | number };
      return {
        totalHits: Number(row.total_hits),
        resetTime: new Date(Number(row.reset_time_ms)),
      };
    } catch (err) {
      // Keep API available when store has transient DB issues.
      console.error("[RateLimitStore] get failed:", err);
      return undefined;
    }
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now();
    const win = this.windowMs;
    try {
      const ins = await this.pool.query(
        `INSERT INTO express_rate_limit (bucket_key, total_hits, reset_time_ms)
         VALUES ($1, 1, $2 + $3::bigint)
         ON CONFLICT (bucket_key) DO UPDATE SET
           total_hits = CASE
             WHEN express_rate_limit.reset_time_ms <= $2::bigint THEN 1
             ELSE express_rate_limit.total_hits + 1
           END,
           reset_time_ms = CASE
             WHEN express_rate_limit.reset_time_ms <= $2::bigint THEN $2::bigint + $3::bigint
             ELSE express_rate_limit.reset_time_ms
           END
         RETURNING total_hits, reset_time_ms`,
        [key, now, win]
      );
      const row = ins.rows[0] as { total_hits: number; reset_time_ms: string | number };
      return {
        totalHits: Number(row.total_hits),
        resetTime: new Date(Number(row.reset_time_ms)),
      };
    } catch (err) {
      // Fail-open fallback.
      console.error("[RateLimitStore] increment failed:", err);
      return { totalHits: 1, resetTime: new Date(now + win) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE express_rate_limit SET total_hits = GREATEST(0, total_hits - 1) WHERE bucket_key = $1`,
        [key]
      );
    } catch (err) {
      console.error("[RateLimitStore] decrement failed:", err);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.pool.query(`DELETE FROM express_rate_limit WHERE bucket_key = $1`, [key]);
    } catch (err) {
      console.error("[RateLimitStore] resetKey failed:", err);
    }
  }

  async resetAll(): Promise<void> {
    try {
      await this.pool.query(`DELETE FROM express_rate_limit`);
    } catch (err) {
      console.error("[RateLimitStore] resetAll failed:", err);
    }
  }

  shutdown(): void {
    /* Pool lifecycle owned by caller */
  }
}

/** Support POST cap: same table semantics as rate limiter (fixed window). */
export async function takeSupportPostSlotPg(
  pool: Pool,
  userId: number,
  windowMs: number,
  max: number
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const key = `support_post:user:${userId}`;
  const store = new PgRateLimitStore(pool);
  store.init({ windowMs });
  const { totalHits, resetTime } = await store.increment(key);
  if (totalHits > max) {
    await store.decrement(key);
    const retryAfterSec = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true };
}
