export const HOME_TEST_SERIES_CHIP = "Test Series";
export const HOME_BASE_CATEGORIES = ["All", "NDA", "CDS", "AFCAT", HOME_TEST_SERIES_CHIP] as const;

export function isHomeTestSeriesCategory(category: string): boolean {
  return category.trim().toLowerCase() === HOME_TEST_SERIES_CHIP.toLowerCase();
}

export function filterCoursesByHomeCategory<T extends { category?: string | null; course_type?: string | null }>(
  courses: T[],
  selectedCategory: string,
): T[] {
  if (!selectedCategory || selectedCategory === "All") return courses;
  if (isHomeTestSeriesCategory(selectedCategory)) {
    return courses.filter((c) => String(c.course_type || "").toLowerCase() === "test_series");
  }
  const normalized = selectedCategory.trim().toLowerCase();
  return courses.filter((c) => String(c.category || "").trim().toLowerCase() === normalized);
}

export function buildHomeCategoryChips(courseCategories: string[]): string[] {
  const combined: string[] = [...HOME_BASE_CATEGORIES];
  const lowerSet = new Set(combined.map((c) => c.trim().toLowerCase()));
  courseCategories.forEach((cat) => {
    const trimmed = cat.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (lower === HOME_TEST_SERIES_CHIP.toLowerCase()) return;
    if (!lowerSet.has(lower)) {
      lowerSet.add(lower);
      combined.push(trimmed);
    }
  });
  return combined;
}
