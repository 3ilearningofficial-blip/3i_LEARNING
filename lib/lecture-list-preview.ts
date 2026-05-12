export type LectureListPreviewSpec =
  | { kind: "image"; uri: string }
  | { kind: "pdf" }
  | { kind: "placeholder" };

function trimUrl(s: string | undefined | null): string {
  return String(s || "").trim();
}

/** Cloudflare Stream video UID (32 hex) from videodelivery.net or *.cloudflarestream.com URLs. */
export function extractCfStreamUid(url: string): string | null {
  const m1 = url.match(/videodelivery\.net\/([a-f0-9]{32})\//i);
  if (m1?.[1]) return m1[1].toLowerCase();
  const m2 = url.match(/cloudflarestream\.com\/([a-f0-9]{32})\//i);
  if (m2?.[1]) return m2[1].toLowerCase();
  return null;
}

export function cfStreamThumbnailUrl(uid: string): string {
  return `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=1s&height=200&width=356`;
}

export function getYouTubeVideoIdForPreview(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1).split("?")[0] || null;
    if (parsed.hostname.includes("youtube.com") || parsed.hostname.includes("youtube-nocookie.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => ["embed", "shorts", "live", "v"].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    }
  } catch {
    /* ignore */
  }
  const m = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/|v\/))([A-Za-z0-9_-]{11})/,
  );
  return m?.[1] || null;
}

function youtubeThumbnailUrl(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Resolves what to show in the lecture list preview column (no network I/O).
 * Stream / YouTube → remote still image; PDF-only → pdf icon; R2 /api/media → placeholder.
 */
export function getLectureListPreviewSpec(
  videoUrl: string | undefined | null,
  pdfUrl: string | undefined | null,
): LectureListPreviewSpec {
  const v = trimUrl(videoUrl);
  const p = trimUrl(pdfUrl);

  if (v) {
    const yt = getYouTubeVideoIdForPreview(v);
    if (yt) return { kind: "image", uri: youtubeThumbnailUrl(yt) };
    const uid = extractCfStreamUid(v);
    if (uid) return { kind: "image", uri: cfStreamThumbnailUrl(uid) };
    return { kind: "placeholder" };
  }

  if (p) return { kind: "pdf" };

  return { kind: "placeholder" };
}
