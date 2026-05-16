export type AdminCourseTab = "lectures" | "tests" | "materials" | "live" | "enrolled";

const VALID_TABS = new Set<AdminCourseTab>(["lectures", "tests", "materials", "live", "enrolled"]);

export function parseAdminCourseTab(raw: unknown): AdminCourseTab | null {
  const t = String(raw || "").toLowerCase();
  return VALID_TABS.has(t as AdminCourseTab) ? (t as AdminCourseTab) : null;
}

/** Admin course page with optional tab (defaults to lectures when tab omitted). */
export function getAdminCourseRoute(courseId: number | string, tab?: AdminCourseTab): string {
  const base = `/admin/course/${courseId}`;
  if (tab && tab !== "lectures") return `${base}?tab=${tab}`;
  return base;
}
