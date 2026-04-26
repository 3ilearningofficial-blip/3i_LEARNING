/**
 * Resolves the lecture `section_title` used when saving a live class recording as a course lecture.
 * Convention: `main` (e.g. "Live Class Recordings") + optional `sub` (e.g. "Chapter 1") →
 * "Live Class Recordings / Chapter 1" — also used as the matching `course_folders.name` for that bucket.
 */
export const DEFAULT_LIVE_RECORDING_SECTION = "Live Class Recordings";

export function buildRecordingLectureSectionTitle(
  main: string | null | undefined,
  sub: string | null | undefined,
  bodyOverride?: string | null
): string {
  if (bodyOverride != null && String(bodyOverride).trim() !== "") {
    return String(bodyOverride).trim();
  }
  const m =
    main != null && String(main).trim() !== "" ? String(main).trim() : DEFAULT_LIVE_RECORDING_SECTION;
  const s = sub != null && String(sub).trim() !== "" ? String(sub).trim() : "";
  return s ? `${m} / ${s}` : m;
}
