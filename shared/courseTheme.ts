/** Auto-assigned banner/accent palette for normal (single-subject) courses. */
export const COURSE_GRADIENT_COLORS = [
  "#1A56DB",
  "#7C3AED",
  "#DC2626",
  "#059669",
  "#D97706",
  "#0891B2",
] as const;

export function getCourseAccentColor(courseId: number): string {
  const id = Math.abs(Math.trunc(Number(courseId) || 0));
  return COURSE_GRADIENT_COLORS[id % COURSE_GRADIENT_COLORS.length];
}

export function getCourseGradientColors(courseId: number): [string, string] {
  const base = getCourseAccentColor(courseId);
  return [base, `${base}CC`];
}
