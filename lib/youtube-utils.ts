/**
 * Extracts a YouTube video ID from various URL formats.
 *
 * Supported formats:
 * - https://youtube.com/live/VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://youtube.com/watch?v=VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube-nocookie.com/embed/VIDEO_ID
 *
 * Returns null for invalid or unrecognized URLs.
 */
export function getYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  try {
    const trimmed = url.trim();
    if (!trimmed) return null;

    // youtu.be/VIDEO_ID
    const shortMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]+)/
    );
    if (shortMatch) return shortMatch[1];

    // youtube.com/live/VIDEO_ID
    const liveMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]+)/
    );
    if (liveMatch) return liveMatch[1];

    // youtube.com/embed/VIDEO_ID or youtube-nocookie.com/embed/VIDEO_ID
    const embedMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]+)/
    );
    if (embedMatch) return embedMatch[1];

    // youtube.com/watch?v=VIDEO_ID
    const watchMatch = trimmed.match(
      /^https?:\/\/(?:www\.)?youtube\.com\/watch/
    );
    if (watchMatch) {
      const parsed = new URL(trimmed);
      const v = parsed.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]+$/.test(v)) return v;
    }

    return null;
  } catch {
    return null;
  }
}
