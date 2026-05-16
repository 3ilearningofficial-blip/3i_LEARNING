export type AdminCourseTab = "lectures" | "tests" | "materials" | "live" | "enrolled";

const VALID_TABS = new Set<AdminCourseTab>(["lectures", "tests", "materials", "live", "enrolled"]);

export function parseAdminCourseTab(raw: unknown): AdminCourseTab | null {
  const t = String(raw || "").toLowerCase();
  return VALID_TABS.has(t as AdminCourseTab) ? (t as AdminCourseTab) : null;
}

/** Return to course admin after ending live (no Live/Lectures sub-tab forced). */
export function getAdminCourseRoute(courseId: number | string, tab?: AdminCourseTab): string {
  const base = `/admin/course/${courseId}`;
  const qs = new URLSearchParams({ fromLiveEnd: "1" });
  if (tab && tab !== "lectures") qs.set("tab", tab);
  return `${base}?${qs.toString()}`;
}

/** Main admin dashboard — Courses section (course list), not a course sub-tab. */
export function getAdminCoursesSectionRoute(): string {
  return "/admin?tab=courses";
}
