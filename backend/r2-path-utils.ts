/** Single root in R2 for all live class WebM/MP4 uploads (not per–live-class). */
export const LIVE_CLASS_RECORDING_ROOT = "live-class-recording";

const SUBFOLDER_MAX = 80;

/** Returns a safe single path segment, or null if invalid. */
export function sanitizeLiveRecordingSubfolder(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  const s = String(input).trim();
  if (s.length === 0) return null;
  if (s.length > SUBFOLDER_MAX) return null;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return null;
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || slug.length < 1) return null;
  if (slug.length > SUBFOLDER_MAX) return null;
  if (slug === ".." || slug === ".") return null;
  return slug;
}
