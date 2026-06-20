export function getCourseExplorePath(course: { id: number; course_type?: string | null }): string {
  if (course.course_type === "test_series") return `/course/${course.id}`;
  return `/course-about/${course.id}`;
}
