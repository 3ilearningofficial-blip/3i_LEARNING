/** Trim pasted URLs so remote images load on web/RN (http→https, protocol-relative). */
export function normalizeNotificationImageUrl(raw: string): string {
  let u = raw.trim().replace(/\s/g, "");
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://")) return `https://${u.slice(7)}`;
  return u;
}

export function isGoogleDriveUrl(url: string): boolean {
  return url.includes("drive.google.com") || url.includes("docs.google.com");
}

export function getGoogleDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return null;
}

/** Resolve Google Drive share links to a direct view URL loadable by Image/img. */
export function resolveNotificationImageUrl(raw: string): string {
  const normalized = normalizeNotificationImageUrl(raw);
  if (!normalized) return "";
  if (isGoogleDriveUrl(normalized)) {
    const fileId = getGoogleDriveFileId(normalized);
    if (fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  return normalized;
}
