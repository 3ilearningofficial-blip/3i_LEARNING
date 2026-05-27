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
    private readonly bucketPrefix = "default",
    private readonly options: { failClosed?: boolean } = {}
  ) {}

  init(options: { windowMs: number }): void {
    this.windowMs = options.windowMs;
  }

  private bucketKey(key: string): string {
    return `ratelimit:${this.bucketPrefix}:${key}`;
  }

  private readonly atomicIncrementScript = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local existingReset = tonumber(redis.call('HGET', key, 'resetTimeMs') or '0')
local existingHits = tonumber(redis.call('HGET', key, 'totalHits') or '0')
local resetMs = existingReset
local totalHits = existingHits

if existingReset == 0 or existingReset <= nowMs then
  totalHits = 1
  resetMs = nowMs + windowMs
else
  totalHits = existingHits + 1
end

local ttlMs = resetMs - nowMs
if ttlMs < 1000 then ttlMs = 1000 end
redis.call('HSET', key, 'totalHits', tostring(totalHits), 'resetTimeMs', tostring(resetMs))
redis.call('PEXPIRE', key, ttlMs)
return { tostring(totalHits), tostring(resetMs) }
`;

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
      if (this.options.failClosed) {
        return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(Date.now() + this.windowMs) };
      }
      return undefined;
    }
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    const now = Date.now();
    const win = this.windowMs;
    const bucket = this.bucketKey(key);

    try {
      const out = (await this.redis.eval(this.atomicIncrementScript, {
        keys: [bucket],
        arguments: [String(now), String(win)],
      })) as unknown as [string, string];
      const totalHits = Number(out?.[0] || 1);
      const nextReset = Number(out?.[1] || now + win);
      return { totalHits, resetTime: new Date(nextReset) };
    } catch (err) {
      console.error("[RedisRateLimitStore] increment failed:", err);
      if (this.options.failClosed) {
        return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now + win) };
      }
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
      const pattern = `ratelimit:${this.bucketPrefix}:*`;
      let cursor = "0";
      do {
        const scan = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 200 });
        cursor = String(scan.cursor);
        const keys = scan.keys || [];
        if (keys.length) await this.redis.del(keys);
      } while (cursor !== "0");
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
    const script = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local existingReset = tonumber(redis.call('HGET', key, 'resetTimeMs') or '0')
local existingHits = tonumber(redis.call('HGET', key, 'totalHits') or '0')
local resetMs = existingReset
local totalHits = existingHits

if existingReset == 0 or existingReset <= nowMs then
  totalHits = 1
  resetMs = nowMs + windowMs
else
  totalHits = existingHits + 1
end

local ttlMs = resetMs - nowMs
if ttlMs < 1000 then ttlMs = 1000 end
redis.call('HSET', key, 'totalHits', tostring(totalHits), 'resetTimeMs', tostring(resetMs))
redis.call('PEXPIRE', key, ttlMs)
return { tostring(totalHits), tostring(resetMs) }
`;
    const out = (await redis.eval(script, {
      keys: [bucket],
      arguments: [String(now), String(windowMs)],
    })) as unknown as [string, string];
    const totalHits = Number(out?.[0] || 1);

    return totalHits <= max;
  } catch (err) {
    console.error("[Redis] download-url rate limit failed:", err);
    return null;
  }
}
