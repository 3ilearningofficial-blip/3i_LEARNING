import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { registerLiveKitWebhookRoutes } from "./livekit-webhook-routes";

const mockGetWebhookReceiver = vi.fn(async () => null);

vi.mock("./livekit-sdk", () => ({
  getWebhookReceiver: mockGetWebhookReceiver,
}));

function mockDb() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
  };
}

describe("registerLiveKitWebhookRoutes", () => {
  it("registers without throwing when webhook env vars are set", () => {
    const app = express();
    expect(() =>
      registerLiveKitWebhookRoutes({
        app,
        db: mockDb() as any,
      })
    ).not.toThrow();
  });

  it("POST /api/webhooks/livekit returns 200 immediately even when receiver is null", async () => {
    mockGetWebhookReceiver.mockResolvedValue(null);

    const app = express();
    app.use(
      express.json({
        verify: (req, _res, buf) => {
          (req as any).rawBody = buf;
        },
      })
    );
    registerLiveKitWebhookRoutes({
      app,
      db: mockDb() as any,
    });

    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/livekit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer fake",
      },
      body: JSON.stringify({ event: "room_finished", room: { name: "lc-1" } }),
    });

    expect(res.status).toBe(200);
    server.close();
  });
});
