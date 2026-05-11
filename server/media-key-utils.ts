const MEDIA_PROXY_PREFIX = "api/media/";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripHostIfUrl(raw: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const path = `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
    return path || raw;
  } catch {
    return raw;
  }
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}

function removeSearchAndHash(value: string): string {
  const noHash = value.split("#")[0] || "";
  return noHash.split("?")[0] || "";
}

export function canonicalMediaKey(raw: string): string {
  let key = String(raw || "").trim();
  if (!key) return "";

  key = stripHostIfUrl(key);
  key = removeSearchAndHash(key);
  key = normalizeSlashes(key).replace(/^\/+/, "");
  key = safeDecode(key);
  key = normalizeSlashes(key).replace(/^\/+/, "");

  const lower = key.toLowerCase();
  if (lower.startsWith(MEDIA_PROXY_PREFIX)) {
    key = key.slice(MEDIA_PROXY_PREFIX.length);
  }

  key = key.replace(/^\/+/, "").replace(/\/+$/g, "");
  if (!key || key.includes("..")) return "";
  return key;
}

export function mediaKeyMatchVariants(raw: string): string[] {
  const canonical = canonicalMediaKey(raw);
  if (!canonical) return [];

  const decoded = safeDecode(canonical);
  const encoded = encodeURI(canonical);
  const values = new Set<string>([
    canonical,
    decoded,
    encoded,
    `api/media/${canonical}`,
    `/api/media/${canonical}`,
    `api/media/${decoded}`,
    `/api/media/${decoded}`,
    `api/media/${encoded}`,
    `/api/media/${encoded}`,
  ]);

  return [...values].filter(Boolean);
}
