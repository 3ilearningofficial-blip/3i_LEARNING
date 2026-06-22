import { describe, it, expect } from "vitest";
import {
  enrollmentAccessState,
  isEnrollmentExpired,
  repairCourseEnrollmentAccess,
} from "./course-access-utils";

describe("enrollmentAccessState", () => {
  it("marks expired active enrollments as expired", () => {
    expect(
      enrollmentAccessState({ status: "active", valid_until: Date.now() - 1000 })
    ).toBe("expired");
  });

  it("marks inactive enrollments", () => {
    expect(enrollmentAccessState({ status: "inactive", valid_until: null })).toBe("inactive");
  });
});

describe("repairCourseEnrollmentAccess", () => {
  it("renews expired enrollment row", async () => {
    const updates: string[] = [];
    const db = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM courses")) {
          return { rows: [{ id: 2, end_date: null, validity_months: null }] };
        }
        if (sql.includes("FROM enrollments") && sql.includes("SELECT")) {
          return {
            rows: [{ id: 20, status: "active", valid_until: Date.now() - 5000 }],
          };
        }
        if (sql.startsWith("UPDATE enrollments")) {
          updates.push(sql);
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const result = await repairCourseEnrollmentAccess(db, 5, 2);
    expect(result.fixed).toBe(true);
    expect(result.reason).toBe("renewed");
    expect(updates.length).toBe(1);
  });

  it("returns already_active for valid enrollment", async () => {
    const db = {
      query: async (sql: string) => {
        if (sql.includes("FROM courses")) {
          return { rows: [{ id: 2 }] };
        }
        if (sql.includes("FROM enrollments")) {
          return {
            rows: [{ id: 20, status: "active", valid_until: Date.now() + 60_000 }],
          };
        }
        return { rows: [] };
      },
    };
    const result = await repairCourseEnrollmentAccess(db, 5, 2);
    expect(result.fixed).toBe(false);
    expect(result.reason).toBe("already_active");
    expect(isEnrollmentExpired({ valid_until: Date.now() + 60_000 })).toBe(false);
  });
});
