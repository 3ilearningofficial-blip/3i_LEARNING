import { apiRequest } from "@/lib/query-client";

export async function repairEnrollmentAccess(
  courseId: number
): Promise<{ fixed: boolean; reason?: string }> {
  try {
    const res = await apiRequest("POST", "/api/enrollments/repair-access", { courseId });
    if (!res.ok) return { fixed: false };
    const j = await res.json();
    return { fixed: !!j?.fixed, reason: typeof j?.reason === "string" ? j.reason : undefined };
  } catch {
    return { fixed: false };
  }
}

export function isSessionPlatformMismatchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.includes("SESSION_PLATFORM_MISMATCH");
}
