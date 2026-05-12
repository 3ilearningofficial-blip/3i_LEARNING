/** Path-safe `/api/media/...` URL with token (same segment encoding as `server/pdf-routes`). */
export function buildMediaUrlWithToken(apiBase: string, fileKey: string, token: string): string {
  const base = String(apiBase || "").replace(/\/+$/, "");
  const encPath = fileKey.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${base}/api/media/${encPath}?token=${encodeURIComponent(token)}`;
}
