export function getCourseCategoryLabel(course: {
  course_type?: string | null;
  category?: string | null;
}): string {
  if (course.course_type === "test_series") return "Test Series";
  return (course.category || "").trim() || "Course";
}

export function getTestSeriesCardMetaLine(course: {
  exam?: string | null;
  subject?: string | null;
}): string {
  return [course.exam, course.subject].filter(Boolean).join(" · ");
}

export function getTestSeriesMetaLine(course: {
  course_type?: string | null;
  category?: string | null;
  exam?: string | null;
  subject?: string | null;
  level?: string | null;
}): string {
  return [
    getCourseCategoryLabel(course),
    course.exam,
    course.subject,
    course.level || "Beginner",
  ]
    .filter(Boolean)
    .join(" · ");
}
