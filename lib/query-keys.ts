/** User-scoped React Query keys to avoid cross-account cache bleed after logout/login. */

export function notificationsQueryKey(userId: number) {
  return ["/api/notifications", userId] as const;
}

export function supportMessagesQueryKey(userId: number) {
  return ["/api/support/messages", userId] as const;
}

export function liveClassesQueryKey() {
  return ["/api/live-classes"] as const;
}

export function liveClassQueryKey(id: string | number) {
  return ["/api/live-classes", String(id)] as const;
}

/** Prefetch / list keys scoped to a course (distinct from detail `liveClassQueryKey`). */
export function liveClassesForCourseQueryKey(courseId: string | number) {
  return ["/api/live-classes", String(courseId), "list"] as const;
}

export function testQueryKey(id: string | number) {
  return ["/api/tests", String(id)] as const;
}

export function myAttemptsSummaryQueryKey(userId: number) {
  return ["/api/my-attempts/summary", userId] as const;
}

export function myDownloadsQueryKey(userId: number) {
  return ["/api/my-downloads", userId] as const;
}

export function myPaymentsQueryKey(userId: number) {
  return ["/api/my-payments", userId] as const;
}
