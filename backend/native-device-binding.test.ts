import { describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import {
  assertLoginAllowedForInstallation,
  assertSessionNotActivelyInUse,
} from "./native-device-binding";

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    get(name: string) {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as Request;
}

describe("staff login gates", () => {
  it("assertLoginAllowedForInstallation allows teacher without device row", async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    const res = await assertLoginAllowedForInstallation(db, mockReq(), {
      userId: 1,
      role: "teacher",
    });
    expect(res.ok).toBe(true);
  });

  it("assertSessionNotActivelyInUse allows staff when another session is active", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [
          {
            session_token: "tok",
            last_active_at: Date.now(),
            role: "teacher",
            device_id: "other",
          },
        ],
      })),
    };
    const res = await assertSessionNotActivelyInUse(db, mockReq({ "x-client-platform": "web" }), {
      userId: 1,
      role: "teacher",
    });
    expect(res.ok).toBe(true);
  });
});

describe("student registration gates", () => {
  it("allows login on registered second device while session active", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [
          {
            session_token: "tok",
            last_active_at: Date.now(),
            role: "student",
            device_id: "laptop-id",
            app_bound_device_id: null,
            web_device_id_phone: "phone-id",
            web_device_id_desktop: "laptop-id",
            phone: "999",
            email: null,
          },
        ],
      })),
    };
    const req = mockReq({
      "x-client-platform": "web",
      "x-client-form-factor": "phone",
      "x-app-device-id": "phone-id",
    });
    const res = await assertSessionNotActivelyInUse(db, req, { userId: 2, role: "student" });
    expect(res.ok).toBe(true);
  });

  it("blocks third unregistered device when two slots full", async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("device_block_events")) return { rows: [] };
        return {
          rows: [
            {
              app_bound_device_id: null,
              web_device_id_phone: "phone-id",
              web_device_id_desktop: "desk1",
              role: "student",
              blocked: false,
            },
          ],
        };
      }),
    };
    const req = mockReq({
      "x-client-platform": "web",
      "x-client-form-factor": "desktop",
      "x-app-device-id": "stranger-id",
    });
    const res = await assertLoginAllowedForInstallation(db, req, { userId: 3, role: "student" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("max_devices_registered");
    }
  });
});
