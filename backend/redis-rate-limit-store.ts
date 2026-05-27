import type { AppRedisClient } from "./redis-client";

/**
 * express-rate-limit v8 store backed by Redis (shared across PM2 instances).
 * Falls back to PostgreSQL via PgRateLimitStore when Redis is unavailable.
 */
export class RedisRateLimitStore {
  private windowMs = 60_000;
  readonly localKeys = false;

  constructor(
    private readonly redis: AppRedisClient,
    private readonly bucketPrefix = "default"
  ) {}

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  private bucketKey(key: string): string {
    return `ratelimit:${this.bucketPrefix}:${key}`;
  }

  async get(key: string): Promise<{ totalHits: number; resetTime: Date } | undefined> {
    try {
      const raw = await this.redis.hGetAll(this.bucketKey(key));
      if (!raw.totalHits) return undefined;
      return {
        totalHits: Number(raw.totalHits),
        resetTime: new Date(Number(raw.resetTimeMs)),
      };
    } catch (err) {
      console.error("[RedisRateLimitStore] get failed:", err);
      return undefined;
    }
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now();
    const win = this.windowMs;
    const bucket = this.bucketKey(key);

    try {
      const existing = await this.redis.hGetAll(bucket);
      const resetMs = Number(existing.resetTimeMs || 0);
      let totalHits = Number(existing.totalHits || 0);
      let nextReset = resetMs;

      if (!resetMs || resetMs <= now) {
        totalHits = 1;
        nextReset = now + win;
      } else {
        totalHits += 1;
      }

      const ttlMs = Math.max(1000, nextReset - now);
      await this.redis
        .multi()
        .hSet(bucket, { totalHits: String(totalHits), resetTimeMs: String(nextReset) })
        .pExpire(bucket, ttlMs)
        .exec();

      return { totalHits, resetTime: new Date(nextReset) };
    } catch (err) {
      console.error("[RedisRateLimitStore] increment failed:", err);
      return { totalHits: 1, resetTime: new Date(now + win) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      const bucket = this.bucketKey(key);
      const hits = await this.redis.hGet(bucket, "totalHits");
      if (hits) {
        const next = Math.max(0, Number(hits) - 1);
        await this.redis.hSet(bucket, "totalHits", String(next));
      }
    } catch (err) {
      console.error("[RedisRateLimitStore] decrement failed:", err);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.redis.del(this.bucketKey(key));
    } catch (err) {
      console.error("[RedisRateLimitStore] resetKey failed:", err);
    }
  }

  async resetAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`ratelimit:${this.bucketPrefix}:*`);
      if (keys.length) await this.redis.del(keys);
    } catch (err) {
      console.error("[RedisRateLimitStore] resetAll failed:", err);
    }
  }

  shutdown(): void {
    /* Client lifecycle owned by redis-client.ts */
  }
}

/** Fixed-window rate limit for /api/download-url (student-only). */
export async function checkDownloadUrlRateLimitRedis(
  redis: AppRedisClient,
  userId: number,
  windowMs: number,
  max: number
): Promise<boolean | null> {
  try {
    const key = `download_url:user:${userId}`;
    const bucket = `ratelimit:${key}`;
    const now = Date.now();
    const existing = await redis.hGetAll(bucket);
    const resetMs = Number(existing.resetTimeMs || 0);
    let totalHits = Number(existing.totalHits || 0);
    let nextReset = resetMs;

    if (!resetMs || resetMs <= now) {
      totalHits = 1;
      nextReset = now + windowMs;
    } else {
      totalHits += 1;
    }

    const ttlMs = Math.max(1000, nextReset - now);
    await redis
      .multi()
      .hSet(bucket, { totalHits: String(totalHits), resetTimeMs: String(nextReset) })
      .pExpire(bucket, ttlMs)
      .exec();

    return totalHits <= max;
  } catch (err) {
    console.error("[Redis] download-url rate limit failed:", err);
    return null;
  }
}
