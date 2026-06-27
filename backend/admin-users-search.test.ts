import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { registerAdminUsersAndContentRoutes } from "./admin-users-and-content-routes";

function mockUsersDb() {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("information_schema.columns")) {
        return {
          rows: ["id", "name", "email", "phone", "role", "created_at", "is_blocked", "last_active_at"].map(
            (column_name) => ({ column_name }),
          ),
        };
      }
      if (sql.includes("COUNT(*)")) return { rows: [{ total: 0 }] };
      if (sql.includes("FROM users")) return { rows: [] };
      return { rows: [] };
    }),
  };
  return { db, queries };
}

describe("GET /api/admin/users search", () => {
  it("adds ILIKE filter when search query param is present", async () => {
    const { db, queries } = mockUsersDb();
    const app = express();
    app.use(express.json());
    registerAdminUsersAndContentRoutes({
      app,
      db: db as any,
      requireAdmin: (_req, _res, next) => next(),
      deleteDownloadsForUser: async () => {},
      runInTransaction: async (fn) => fn(db as any),
      recomputeAllEnrollmentsProgressForCourse: async () => {},
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users?search=john`);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Total-Count")).toBe("0");

    const userListQuery = queries.find((q) => q.sql.includes("FROM users") && q.sql.includes("SELECT id"));
    expect(userListQuery).toBeDefined();
    expect(userListQuery!.sql).toContain("ILIKE");
    expect(userListQuery!.sql).toContain("COALESCE(name,'') ILIKE");
    expect(userListQuery!.params).toContain("%john%");

    server.close();
  });

  it("does not add ILIKE filter when search is empty", async () => {
    const { db, queries } = mockUsersDb();
    const app = express();
    app.use(express.json());
    registerAdminUsersAndContentRoutes({
      app,
      db: db as any,
      requireAdmin: (_req, _res, next) => next(),
      deleteDownloadsForUser: async () => {},
      runInTransaction: async (fn) => fn(db as any),
      recomputeAllEnrollmentsProgressForCourse: async () => {},
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users`);
    expect(res.status).toBe(200);

    const userListQuery = queries.find((q) => q.sql.includes("FROM users") && q.sql.includes("SELECT id"));
    expect(userListQuery).toBeDefined();
    expect(userListQuery!.sql).not.toContain("ILIKE");

    server.close();
  });
});
