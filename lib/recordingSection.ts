/** Same contract as `server/recordingSection.ts` — keep in sync. */
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

/** Split DB columns (and legacy combined `main` with " / ") into admin form main + subfolder fields. */
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
