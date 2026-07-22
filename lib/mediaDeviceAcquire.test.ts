import { describe, it, expect } from "vitest";
import {
  buildAudioConstraintAttempts,
  buildVideoConstraintAttempts,
  formatMediaAccessError,
  pickDeviceId,
} from "./mediaDeviceAcquire";

describe("buildVideoConstraintAttempts", () => {
  it("returns lightweight then sized constraints when no device id", () => {
    const attempts = buildVideoConstraintAttempts();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ facingMode: "user" });
    expect(attempts[1]).toMatchObject({ width: { ideal: 1280 } });
  });

  it("prefers ideal device-only first, then ideal+size, then exact", () => {
    const attempts = buildVideoConstraintAttempts("cam-123");
    expect(attempts).toHaveLength(3);
    expect(attempts[0].deviceId).toEqual({ ideal: "cam-123" });
    expect(attempts[0].width).toBeUndefined();
    expect(attempts[1].deviceId).toEqual({ ideal: "cam-123" });
    expect(attempts[1].width).toEqual({ ideal: 1280 });
    expect(attempts[2].deviceId).toEqual({ exact: "cam-123" });
  });
});

describe("buildAudioConstraintAttempts", () => {
  it("falls back to default mic", () => {
    const attempts = buildAudioConstraintAttempts("mic-1");
    expect(attempts[0]).toEqual({ deviceId: { ideal: "mic-1" } });
    expect(attempts[2]).toBe(true);
  });
});

describe("formatMediaAccessError", () => {
  it("maps timeout errors to actionable guidance", () => {
    const msg = formatMediaAccessError(new DOMException("Timeout starting video source", "TimeoutError"));
    expect(msg).toContain("too long to start");
  });

  it("maps NotReadableError", () => {
    const msg = formatMediaAccessError({ name: "NotReadableError", message: "Could not start" });
    expect(msg).toContain("in use");
  });
});

describe("pickDeviceId", () => {
  const devices = [
    { deviceId: "a", kind: "videoinput" } as MediaDeviceInfo,
    { deviceId: "b", kind: "videoinput" } as MediaDeviceInfo,
  ];

  it("keeps preferred id when present", () => {
    expect(pickDeviceId("b", devices)).toBe("b");
  });

  it("falls back to first device when preferred missing", () => {
    expect(pickDeviceId("missing", devices)).toBe("a");
  });
});
