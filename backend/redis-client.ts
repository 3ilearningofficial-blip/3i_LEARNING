import { createClient } from "redis";

export type AppRedisClient = ReturnType<typeof createClient>;

let client: AppRedisClient | null = null;
let connectPromise: Promise<AppRedisClient | null> | null = null;

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
  if (!url) return null;

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
        console.log("[Redis] connected");
        return next;
      } catch (err) {
        console.error("[Redis] connect failed:", err);
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
