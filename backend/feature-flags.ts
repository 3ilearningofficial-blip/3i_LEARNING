type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

function parseBoolean(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input === 1 ? true : input === 0 ? false : null;
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

const DEFAULT_FLAGS: Record<string, boolean> = {
  fail_closed_auth_rate_limit: true,
  fail_closed_media_rate_limit: true,
  enable_cloudflare_stream_webhooks: false,
  enable_runtime_flags_api: true,
};

export function getEnvFlag(name: string, fallback = false): boolean {
  const parsed = parseBoolean(process.env[name]);
  return parsed == null ? fallback : parsed;
}

export async function getRuntimeFlag(db: DbClient, key: string, fallback: boolean): Promise<boolean> {
  const envOverride = parseBoolean(process.env[`FF_${key.toUpperCase()}`]);
  if (envOverride != null) return envOverride;
  if (!getEnvFlag("ENABLE_DB_RUNTIME_FLAGS", false)) return fallback;
  try {
    const result = await db.query(
      "SELECT enabled FROM runtime_feature_flags WHERE key = $1 LIMIT 1",
      [key]
    );
    if (!result.rows.length) return fallback;
    const parsed = parseBoolean(result.rows[0]?.enabled);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function listDefaultFlags(): Record<string, boolean> {
  return { ...DEFAULT_FLAGS };
}
