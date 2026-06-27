export type AnalyticsRange = { start: number; endExclusive: number };

export type BuildAnalyticsRangeInput = {
  period?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  now?: number;
};

const DAY_MS = 86400000;

function toSafeTs(value: unknown): number | null {
  const ts = new Date(String(value)).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/** Map admin analytics period filter to a millisecond range, or null for all-time (lifetime). */
export function buildAnalyticsRange(input: BuildAnalyticsRangeInput): AnalyticsRange | null {
  const period = String(input.period || "").trim();
  const now = input.now ?? Date.now();

  if (period === "lifetime" || period === "all") return null;

  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.getTime(), endExclusive: start.getTime() + DAY_MS };
  }
  if (period === "yesterday") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    return { start: start.getTime(), endExclusive: end.getTime() };
  }
  if (period === "7days") return { start: now - 7 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "15days") return { start: now - 15 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "30days") return { start: now - 30 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "custom" && input.startDate && input.endDate) {
    const s = toSafeTs(input.startDate);
    const e = toSafeTs(input.endDate);
    if (s !== null && e !== null) return { start: s, endExclusive: e + DAY_MS };
  }
  return null;
}
