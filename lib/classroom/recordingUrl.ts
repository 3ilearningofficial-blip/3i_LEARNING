/** True when URL points at a raster board snapshot, not a video recording. */
export function isBoardSnapshotImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(String(url || "").trim());
}

/** True when URL is suitable as a lecture video recording. */
export function isVideoRecordingUrl(url: string): boolean {
  const lower = String(url || "").trim().toLowerCase();
  if (!lower) return false;
  if (isBoardSnapshotImageUrl(lower)) return false;
  if (/\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/.test(lower)) return true;
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return true;
  if (lower.includes("videodelivery.net")) return true;
  return lower.includes("/api/media/");
}
