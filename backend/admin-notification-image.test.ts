import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { registerAdminNotificationRoutes } from "./admin-notification-routes";
import { resolveNotificationImageUrl } from "../shared/notificationImageUrl";

function mockDb() {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO admin_notifications")) return { rows: [{ id: 1 }] };
      if (sql.includes("FROM users")) return { rows: [{ id: 10 }] };
      return { rows: [] };
    }),
  };
}

describe("resolveNotificationImageUrl", () => {
  it("converts Google Drive share links to direct view URLs", () => {
    const url = resolveNotificationImageUrl("https://drive.google.com/file/d/abc123XYZ/view?usp=sharing");
    expect(url).toBe("https://drive.google.com/uc?export=view&id=abc123XYZ");
  });

  it("passes through normal HTTPS image URLs", () => {
    expect(resolveNotificationImageUrl("https://cdn.example.com/banner.jpg")).toBe("https://cdn.example.com/banner.jpg");
  });
});

describe("POST /api/admin/notifications/send", () => {
  it("rejects empty title, message, and image", async () => {
    const app = express();
    app.use(express.json());
    const db = mockDb();
    registerAdminNotificationRoutes({
      app,
      db: db as any,
      requireAdmin: (_req, _res, next) => next(),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/admin/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", message: "", imageUrl: "" }),
    });
    expect(res.status).toBe(400);
    server.close();
  });

  it("accepts image-only notifications and stores resolved Drive URL", async () => {
    const app = express();
    app.use(express.json());
    const db = mockDb();
    registerAdminNotificationRoutes({
      app,
      db: db as any,
      requireAdmin: (_req, _res, next) => next(),
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/admin/notifications/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "",
        message: "",
        imageUrl: "https://drive.google.com/file/d/fileId99/view",
      }),
    });
    expect(res.status).toBe(200);

    const insertCall = (db.query as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).includes("INSERT INTO admin_notifications")
    );
    expect(insertCall?.[1]?.[5]).toBe("https://drive.google.com/uc?export=view&id=fileId99");

    server.close();
  });
});
