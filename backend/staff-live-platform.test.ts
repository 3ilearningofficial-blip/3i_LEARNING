import { describe, expect, it } from "vitest";
import { getClientPlatform } from "./staff-access-utils";

describe("live platform guard", () => {
  it("detects native from x-app-platform header", () => {
    const req = { headers: { "x-app-platform": "android" }, socket: {} } as any;
    expect(getClientPlatform(req)).toBe("android");
  });

  it("defaults to web without native signals", () => {
    const req = { headers: { "user-agent": "Mozilla/5.0 Chrome" }, socket: {} } as any;
    expect(getClientPlatform(req)).toBe("web");
  });
});
