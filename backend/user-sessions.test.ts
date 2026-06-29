import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { persistLoginSession, userHasSessionToken } from "./user-sessions";

function mockReq(platform: "web" | "ios" = "web"): Request {
  return {
    get(name: string) {
      if (name.toLowerCase() === "x-client-platform") return platform;
      return undefined;
    },
  } as Request;
}

describe("staff dual session", () => {
  it("persistLoginSession inserts user_sessions row with platform_family for teacher", async () => {
    const queries: string[] = [];
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        queries.push(sql);
        if (sql.includes("SELECT session_token FROM users")) {
          return { rows: [{ session_token: "primary-tok" }] };
        }
        return { rows: [] };
      }),
    };

    await persistLoginSession(
      db as any,
      { id: 10, role: "teacher" },
      "web-tok",
      "dev-web",
      { req: mockReq("web") }
    );

    expect(queries.some((q) => q.includes("DELETE FROM user_sessions") && q.includes("platform_family"))).toBe(
      true
    );
    expect(queries.some((q) => q.includes("INSERT INTO user_sessions") && q.includes("platform_family"))).toBe(
      true
    );
    expect(queries.some((q) => q.includes("DELETE FROM user_sessions WHERE user_id = $1") && !q.includes("platform_family"))).toBe(
      false
    );
  });

  it("userHasSessionToken resolves staff token from user_sessions", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM users WHERE id")) {
          return { rows: [{ session_token: "other", role: "teacher", last_active_at: Date.now() }] };
        }
        if (sql.includes("FROM user_sessions")) {
          return { rows: [{ "1": 1 }] };
        }
        return { rows: [] };
      }),
    };

    const ok = await userHasSessionToken(db as any, 10, "staff-extra-tok");
    expect(ok).toBe(true);
  });
});
