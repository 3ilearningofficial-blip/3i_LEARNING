/** Corner where the teacher PiP sits over the board (student view + recording). */
export type ClassroomPipPosition = "top-right" | "bottom-right" | "top-left" | "bottom-left";

export const DEFAULT_PIP_POSITION: ClassroomPipPosition = "bottom-left";

const VALID = new Set<string>(["top-right", "bottom-right", "top-left", "bottom-left"]);

export function normalizePipPosition(value: unknown): ClassroomPipPosition {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (VALID.has(s)) return s as ClassroomPipPosition;
  return DEFAULT_PIP_POSITION;
}

export type ClassroomTeacherStreamMeta = {
  pipPosition?: ClassroomPipPosition;
  greenScreen?: boolean;
};

export function parseClassroomTeacherStreamMeta(raw: string | undefined | null): ClassroomTeacherStreamMeta {
  if (!raw || typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      pipPosition: normalizePipPosition(parsed.pipPosition),
      greenScreen: parsed.greenScreen === true,
    };
  } catch {
    return {};
  }
}

export function serializeClassroomTeacherStreamMeta(meta: ClassroomTeacherStreamMeta): string {
  return JSON.stringify({
    pipPosition: normalizePipPosition(meta.pipPosition),
    greenScreen: meta.greenScreen === true,
  });
}
