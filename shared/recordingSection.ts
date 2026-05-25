/**
 * shared/recordingSection.ts
 * Canonical home for live class recording section title logic.
 *
 * Previously duplicated across:
 *   - server/recordingSection.ts  (server-only subset)
 *   - lib/recordingSection.ts     (frontend superset)
 *
 * Both files are now removed. Import from here in all server and frontend code.
 *
 * Convention: `main` (e.g. "Live Class Recordings") + optional `sub` (e.g. "Chapter 1") →
 * "Live Class Recordings / Chapter 1" — also used as the matching `course_folders.name` for that bucket.
 */

export const DEFAULT_LIVE_RECORDING_SECTION = "Live Class Recordings";

/**
 * Resolve the lecture `section_title` used when saving a live class recording as a course lecture.
 * Used by both the server (when persisting the recording) and the frontend (when displaying/editing).
 */
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

/**
 * Split DB columns (and legacy combined `main` with " / ") into admin form main + subfolder fields.
 * Used by the frontend admin UI to pre-populate recording section inputs.
 */
export function prefillLiveRecordingFormFields(
  main: string | null | undefined,
  sub: string | null | undefined
): { main: string; sub: string } {
  const subTrim = sub != null && String(sub).trim() !== "" ? String(sub).trim() : "";
  if (subTrim) {
    const m =
      main != null && String(main).trim() !== "" ? String(main).trim() : DEFAULT_LIVE_RECORDING_SECTION;
    return { main: m, sub: subTrim };
  }
  const m = (main != null && String(main).trim()) || "";
  if (m.includes(" / ")) {
    const i = m.indexOf(" / ");
    return { main: m.slice(0, i).trim() || DEFAULT_LIVE_RECORDING_SECTION, sub: m.slice(i + 3).trim() };
  }
  return { main: m, sub: "" };
}
