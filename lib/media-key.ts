function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function extractMediaFileKey(rawUrl: string | null | undefined): string | null {
  const raw = String(rawUrl || "").trim();
  if (!raw || !raw.includes("/api/media/")) return null;

  const path = raw.startsWith("/") ? raw : raw.replace(/^https?:\/\/[^/]+/, "");
  const afterPrefix = path.replace(/^\/api\/media\//, "").split("#")[0]?.split("?")[0] || "";
  const decoded = safeDecode(afterPrefix).replace(/^\/+/, "").replace(/\/+$/g, "");
  if (!decoded || decoded.includes("..")) return null;
  return decoded;
}
