/**
 * Extracts a YouTube video ID from various URL formats used in lectures,
 * free study materials, and live classes.
 *
 * Returns null for invalid or unrecognized URLs.
 */
export function getYouTubeVideoId(url: string): string | null {
  if (!url || typeof url !== "string") return null;

  let decoded = url;
  try {
    decoded = decodeURIComponent(decodeURIComponent(url));
  } catch {
    try {
      decoded = decodeURIComponent(url);
    } catch {
      decoded = url;
    }
  }
  decoded = decoded.trim();
  if (!decoded) return null;

  try {
    const parsed = new URL(decoded);
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.slice(1).split("?")[0].split("/")[0];
      return id || null;
    }
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (pathParts[0] === "embed" || pathParts[0] === "shorts" || pathParts[0] === "live") {
        return pathParts[1] || null;
      }
      if (pathParts.length >= 2 && pathParts[pathParts.length - 2] === "live") {
        return pathParts[pathParts.length - 1] || null;
      }
      for (const part of pathParts) {
        if (/^[A-Za-z0-9_-]{11}$/.test(part) && part !== "watch" && part !== "channel" && !part.startsWith("@")) {
          return part;
        }
      }
    }
  } catch {
    /* fall through to regex */
  }

  const match = decoded.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/,
  );
  if (match?.[1]) return match[1];

  const simpleMatch = decoded.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (simpleMatch?.[1]) return simpleMatch[1];

  if (/^[A-Za-z0-9_-]{11}$/.test(decoded)) return decoded;

  return null;
}
