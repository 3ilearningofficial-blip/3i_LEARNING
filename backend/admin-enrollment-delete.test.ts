import { describe, it, expect, vi } from "vitest";
import { txQueryOptional } from "./admin-enrollment-routes";

describe("txQueryOptional", () => {
  it("continues transaction when optional query fails (savepoint rollback)", async () => {
    const calls: string[] = [];
    const tx = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        if (sql.includes("DELETE FROM download_tokens")) {
          throw new Error('relation "download_tokens" does not exist');
        }
        return { rows: [] };
      }),
    };

    await txQueryOptional(tx, "download_tokens", "DELETE FROM download_tokens WHERE user_id = $1", [1]);
    await (tx as { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }).query(
      "DELETE FROM enrollments WHERE id = $1",
      ["99"],
    );

    expect(calls.some((c) => c.includes("SAVEPOINT sp_download_tokens"))).toBe(true);
    expect(calls.some((c) => c.includes("ROLLBACK TO SAVEPOINT sp_download_tokens"))).toBe(true);
    expect(calls.some((c) => c.includes("DELETE FROM enrollments"))).toBe(true);
  });
});
