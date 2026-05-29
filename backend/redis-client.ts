import { createClient } from "redis";

export type AppRedisClient = ReturnType<typeof createClient>;

let client: AppRedisClient | null = null;
let connectPromise: Promise<AppRedisClient | null> | null = null;

// Track whether we've already logged the fallback warning for this process lifetime.
// Prevents log spam — log once when Redis becomes unavailable, not on every request.
let fallbackWarningLogged = false;

function redisUrl(): string | null {
  const raw = process.env.REDIS_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** True when REDIS_URL is configured (Upstash or any Redis-compatible host). */
export function isRedisConfigured(): boolean {
  return redisUrl() != null;
}

/**
 * Shared Redis client for dedup, rate limits, etc.
 * Returns null when REDIS_URL is unset or connection fails (callers fall back to PostgreSQL).
 */
export async function getRedisClient(): Promise<AppRedisClient | null> {
  const url = redisUrl();
  if (!url) {
    if (!fallbackWarningLogged) {
      fallbackWarningLogged = true;
      console.warn(
        "[Redis] REDIS_URL not set — rate limiting and notification dedup are using PostgreSQL fallback. " +
        "This increases DB write load under traffic. Set REDIS_URL in .env to resolve."
      );
    }
    return null;
  }

  if (client?.isOpen) return client;

  if (!connectPromise) {
    connectPromise = (async (): Promise<AppRedisClient | null> => {
      try {
        const next = createClient({ url });
        next.on("error", (err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Redis] client error:", message);
        });
        await next.connect();
        client = next;
        if (fallbackWarningLogged) {
          console.log("[Redis] reconnected — resuming Redis-backed rate limiting and dedup");
          fallbackWarningLogged = false;
        } else {
          console.log("[Redis] connected");
        }
        return next;
      } catch (err) {
        console.error("[Redis] connect failed — falling back to PostgreSQL for rate limiting and dedup:", err);
        if (!fallbackWarningLogged) {
          fallbackWarningLogged = true;
          console.warn(
            "[Redis] FALLBACK ACTIVE — all Redis-dependent features (rate limits, OTP dedup, notification dedup) " +
            "are now using PostgreSQL. Check REDIS_URL and Upstash connectivity."
          );
        }
        client = null;
        return null;
      } finally {
        connectPromise = null;
      }
    })();
  }

  return connectPromise;
}

export async function closeRedisClient(): Promise<void> {
  if (client?.isOpen) {
    await client.quit().catch(() => undefined);
  }
  client = null;
}
