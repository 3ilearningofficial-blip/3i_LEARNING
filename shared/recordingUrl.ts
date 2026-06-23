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

/** Pick the first video-capable URL from a live_class row (never board snapshot PNGs). */
export function pickVideoRecordingUrlFromRow(
  row: Record<string, unknown>,
  fallback?: Record<string, unknown>
): string {
  const candidates = (r: Record<string, unknown>) =>
    [r.recording_url, r.cf_playback_hls, r.youtube_url].map((u) => String(u || "").trim());

  for (const url of candidates(row)) {
    if (isVideoRecordingUrl(url)) return url;
  }
  if (fallback) {
    for (const url of candidates(fallback)) {
      if (isVideoRecordingUrl(url)) return url;
    }
  }
  return "";
}
