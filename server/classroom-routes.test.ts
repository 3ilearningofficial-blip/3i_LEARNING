import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { registerClassroomRoutes } from "./classroom-routes";

function mockDb(overrides: { liveClass?: any } = {}) {
  const lc = overrides.liveClass ?? {
    id: 1,
    stream_type: "classroom",
    is_live: true,
    is_completed: false,
    course_id: 10,
    is_free_preview: false,
    classroom_room_name: null,
  };
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM live_classes")) return { rows: [lc] };
      if (sql.includes("UPDATE live_classes")) return { rows: [] };
      if (sql.includes("FROM enrollments")) return { rows: [{ status: "active", valid_until: null }] };
      return { rows: [] };
    }),
  };
}

describe("classroom token", () => {
  it("returns 503 when LiveKit is not configured", async () => {
    const prev = { ...process.env };
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const app = express();
    app.use(express.json());
    const db = mockDb();
    registerClassroomRoutes({
      app,
      db: db as any,
      requireAuth: (_req, _res, next) => next(),
      requireAdmin: (_req, _res, next) => next(),
      getAuthUser: async () => ({ id: 2, name: "Student", role: "student" }),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/live-classes/1/classroom/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(503);
    server.close();
    process.env = prev;
  });
});
