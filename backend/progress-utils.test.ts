import { describe, expect, it } from "vitest";
import { getCourseProgressBreakdown, updateCourseProgress } from "./progress-utils";

describe("getCourseProgressBreakdown", () => {
  it("excludes empty mission shells from mission total", async () => {
    const db = {
      query: async (sql: string) => {
        if (sql.includes("FROM courses")) {
          return { rows: [{ course_type: "multi_subject" }] };
        }
        if (sql.includes("mission_shells")) {
          return {
            rows: [
              {
                lec: 1,
                tests_total: 0,
                tests_practice: 0,
                tests_pyq: 0,
                tests_mock: 0,
                missions: 0,
                mission_shells: 2,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const breakdown = await getCourseProgressBreakdown(db, 10);
    expect(breakdown?.missions.total).toBe(0);
    expect(breakdown?.missions.emptyShells).toBe(2);
    expect(breakdown?.totals.items).toBe(1);
  });
});

describe("updateCourseProgress", () => {
  it("returns 100% when only one lecture is complete and missions are empty shells", async () => {
    let progressPercent: number | null = null;
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM courses")) {
          return { rows: [{ course_type: "multi_subject" }] };
        }
        if (sql.includes("FROM lecture_progress")) {
          return { rows: [{ lec: 1, tests: 0, missions: 0 }] };
        }
        if (sql.includes("FROM lectures WHERE course_id")) {
          return { rows: [{ lec: 1, tests: 0, missions: 0 }] };
        }
        if (sql.startsWith("UPDATE enrollments SET progress_percent")) {
          progressPercent = Number(params?.[0]);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await updateCourseProgress(db, 5, 10);
    expect(progressPercent).toBe(100);
  });

  it("returns 50% when one lecture is complete out of lecture + test", async () => {
    let progressPercent: number | null = null;
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM courses")) {
          return { rows: [{ course_type: "multi_subject" }] };
        }
        if (sql.includes("FROM lecture_progress")) {
          return { rows: [{ lec: 1, tests: 0, missions: 0 }] };
        }
        if (sql.includes("FROM lectures WHERE course_id")) {
          return { rows: [{ lec: 1, tests: 1, missions: 0 }] };
        }
        if (sql.startsWith("UPDATE enrollments SET progress_percent")) {
          progressPercent = Number(params?.[0]);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await updateCourseProgress(db, 5, 10);
    expect(progressPercent).toBe(50);
  });
});
