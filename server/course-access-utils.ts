/**
 * Compute when enrollment should expire: earliest of (course end date, purchase/roll date + validity_months).
 * Returns null if no time limit.
 */
export function computeEnrollmentValidUntil(
  course: { end_date?: string | null; validity_months?: number | string | null },
  enrolledAtMs: number
): number | null {
  const cands: number[] = [];
  if (course.end_date != null && String(course.end_date).trim() !== "") {
    const t = Date.parse(String(course.end_date).trim());
    if (Number.isFinite(t)) cands.push(t);
  }
  const vm = course.validity_months;
  if (vm != null && String(vm) !== "" && !Number.isNaN(Number(vm))) {
    const months = Number(vm);
    if (months > 0) {
      const d = new Date(enrolledAtMs);
      d.setUTCMonth(d.getUTCMonth() + months);
      cands.push(d.getTime());
    }
  }
  if (cands.length === 0) return null;
  return Math.min(...cands);
}

export function isEnrollmentExpired(row: { valid_until?: number | null } | null | undefined): boolean {
  if (!row) return true;
  const vu = row.valid_until;
  if (vu == null) return false;
  return Number(vu) < Date.now();
}
