import { describe, expect, it } from "vitest";
import type { Request } from "express";
import {
  canRegisterNewDevice,
  countRegisteredDevices,
  getRegistrationSlot,
  isInstallationRegistered,
  studentIsWebOnly,
  usesStaffDualSession,
} from "./session-policy";

function mockReq(headers: Record<string, string> = {}): Request {
  return {
    get(name: string) {
      return headers[name.toLowerCase()] ?? headers[name] ?? undefined;
    },
  } as Request;
}

describe("session-policy", () => {
  it("usesStaffDualSession is true for teacher and manager", () => {
    expect(usesStaffDualSession("teacher")).toBe(true);
    expect(usesStaffDualSession("manager")).toBe(true);
    expect(usesStaffDualSession("student")).toBe(false);
  });

  it("countRegisteredDevices for native + one web", () => {
    expect(
      countRegisteredDevices({
        app_bound_device_id: "app1",
        web_device_id_desktop: "web1",
      })
    ).toBe(2);
    expect(
      countRegisteredDevices({
        app_bound_device_id: "app1",
        web_device_id_phone: "p1",
        web_device_id_desktop: "d1",
      })
    ).toBe(2);
  });

  it("countRegisteredDevices for web-only iOS (phone + laptop)", () => {
    expect(
      countRegisteredDevices({
        web_device_id_phone: "p1",
        web_device_id_desktop: "d1",
      })
    ).toBe(2);
  });

  it("isInstallationRegistered matches any slot", () => {
    const row = {
      app_bound_device_id: "app1",
      web_device_id_desktop: "desk1",
    };
    expect(isInstallationRegistered(row, "desk1")).toBe(true);
    expect(isInstallationRegistered(row, "unknown")).toBe(false);
  });

  it("canRegisterNewDevice blocks phone web when native app bound", () => {
    const row = { app_bound_device_id: "app1" };
    expect(canRegisterNewDevice(row, "web_phone")).toBe(false);
    expect(canRegisterNewDevice(row, "web_desktop")).toBe(true);
  });

  it("canRegisterNewDevice blocks third slot", () => {
    const row = {
      app_bound_device_id: "app1",
      web_device_id_desktop: "d1",
    };
    expect(canRegisterNewDevice(row, "web_phone")).toBe(false);
  });

  it("getRegistrationSlot maps web phone vs desktop", () => {
    const phoneReq = mockReq({
      "x-client-platform": "web",
      "x-client-form-factor": "phone",
    });
    const deskReq = mockReq({
      "x-client-platform": "web",
      "x-client-form-factor": "desktop",
    });
    expect(getRegistrationSlot(phoneReq)).toBe("web_phone");
    expect(getRegistrationSlot(deskReq)).toBe("web_desktop");
  });

  it("studentIsWebOnly when no native binding", () => {
    expect(studentIsWebOnly({})).toBe(true);
    expect(studentIsWebOnly({ app_bound_device_id: "x" })).toBe(false);
  });
});
