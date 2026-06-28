import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { registerAdminStaffRoutes } from "./admin-staff-routes";

function mockStaffDb() {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("FROM users u") && sql.includes("staff_profiles")) {
        return { rows: [{ id: 2, name: "Teacher One", role: "teacher", course_count: 1 }] };
      }
      if (sql.includes("UPDATE users SET role = 'student'")) return { rows: [] };
      if (sql.includes("INSERT INTO staff_course_assignments")) {
        return { rows: [{ id: 99, user_id: 2, course_id: 3, subject_key: "maths" }] };
      }
      if (sql.includes("SELECT id, role FROM users WHERE id")) {
        return { rows: [{ id: 2, role: "student" }] };
      }
      if (sql.includes("INSERT INTO staff_profiles") || sql.includes("ON CONFLICT")) return { rows: [] };
      if (sql.includes("UPDATE users SET role = $1")) return { rows: [] };
      return { rows: [] };
    }),
  };
  return { db, queries };
}

describe("admin staff routes", () => {
  it("lists staff with search filter", async () => {
    const { db, queries } = mockStaffDb();
    const app = express();
    app.use(express.json());
    registerAdminStaffRoutes({ app, db: db as any, requireAdmin: (_r, _s, n) => n() });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/staff?search=teacher`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(queries.some((q) => q.sql.includes("ILIKE"))).toBe(true);
    server.close();
  });

  it("promotes student to teacher", async () => {
    const { db } = mockStaffDb();
    const app = express();
    app.use(express.json());
    registerAdminStaffRoutes({ app, db: db as any, requireAdmin: (_r, _s, n) => n() });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/staff/2/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "teacher" }),
    });
    expect(res.status).toBe(200);
    server.close();
  });
});
