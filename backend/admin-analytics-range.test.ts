import { describe, expect, it } from "vitest";
import { buildAnalyticsRange } from "./admin-analytics-range";

describe("buildAnalyticsRange", () => {
  const now = new Date("2026-06-20T15:00:00.000Z").getTime();

  it("returns null for lifetime and all", () => {
    expect(buildAnalyticsRange({ period: "lifetime", now })).toBeNull();
    expect(buildAnalyticsRange({ period: "all", now })).toBeNull();
  });

  it("returns a 30-day rolling window for 30days", () => {
    const range = buildAnalyticsRange({ period: "30days", now });
    expect(range).not.toBeNull();
    expect(range!.endExclusive - range!.start).toBeGreaterThanOrEqual(30 * 86400000);
    expect(range!.endExclusive).toBe(now + 86400000);
  });

  it("parses custom start and end dates inclusively", () => {
    const range = buildAnalyticsRange({
      period: "custom",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      now,
    });
    expect(range).not.toBeNull();
    expect(new Date(range!.start).toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(range!.endExclusive).toBe(new Date("2026-01-31").getTime() + 86400000);
  });

  it("returns null for unknown period", () => {
    expect(buildAnalyticsRange({ period: "unknown", now })).toBeNull();
  });
});
