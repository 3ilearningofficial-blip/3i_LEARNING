import type { QueryClient } from "@tanstack/react-query";
import { myDownloadsQueryKey } from "@/lib/query-keys";

/** Keep course access, enrollment, and offline library caches in sync after purchase/revoke. */
export function invalidateAccessCaches(
  qc: QueryClient,
  opts: { userId?: number | null; courseId?: string | number | null } = {}
): void {
  void qc.invalidateQueries({ queryKey: ["/api/courses"] });
  if (opts.courseId != null && String(opts.courseId).length > 0) {
    void qc.invalidateQueries({ queryKey: ["/api/courses", String(opts.courseId)] });
  }
  const userId = Number(opts.userId ?? 0);
  if (Number.isFinite(userId) && userId > 0) {
    void qc.invalidateQueries({ queryKey: myDownloadsQueryKey(userId) });
  }
}
