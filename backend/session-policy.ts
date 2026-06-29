import type { Request } from "express";
import { isStaffRole } from "./staff-permissions";

function getClientPlatform(req: Request): "ios" | "android" | "web" | null {
  const p = (req.get("x-client-platform") || "").trim().toLowerCase();
  if (p === "ios" || p === "android" || p === "web") return p;
  return null;
}

function getInstallationIdFromRequest(req: Request): string | null {
  const raw = (req.get("x-app-device-id") || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return raw;
}

export type RegistrationSlot = "app_bound" | "web_phone" | "web_desktop";
export type WebFormFactor = "phone" | "desktop";

export type StudentDeviceRow = {
  app_bound_device_id?: unknown;
  web_device_id_phone?: unknown;
  web_device_id_desktop?: unknown;
};

export function usesStaffDualSession(role: string | undefined | null): boolean {
  return isStaffRole(String(role || ""));
}

export function getWebFormFactor(req: Request): WebFormFactor {
  const header = (req.get("x-client-form-factor") || "").trim().toLowerCase();
  if (header === "phone" || header === "desktop") return header;
  const ua = (req.get("user-agent") || "").toLowerCase();
  if (/iphone|ipod|android.+mobile|mobile/.test(ua)) return "phone";
  return "desktop";
}

export function getRegistrationSlot(req: Request): RegistrationSlot | null {
  const plat = getClientPlatform(req);
  if (plat === "ios" || plat === "android") return "app_bound";
  if (plat === "web") {
    return getWebFormFactor(req) === "phone" ? "web_phone" : "web_desktop";
  }
  return null;
}

function trimId(value: unknown): string {
  return String(value ?? "").trim();
}

export function countRegisteredDevices(row: StudentDeviceRow): number {
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);
  if (appb) {
    return 1 + (phone || desktop ? 1 : 0);
  }
  return (phone ? 1 : 0) + (desktop ? 1 : 0);
}

export function getRegisteredInstallationIds(row: StudentDeviceRow): string[] {
  const ids: string[] = [];
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);
  if (appb) ids.push(appb);
  if (phone) ids.push(phone);
  if (desktop) ids.push(desktop);
  return ids;
}

export function isInstallationRegistered(row: StudentDeviceRow, installationId: string | null | undefined): boolean {
  const cand = trimId(installationId);
  if (!cand || cand === "web_anon") return false;
  return getRegisteredInstallationIds(row).includes(cand);
}

/** Whether this login may claim a new registration slot (max 2 devices). */
export function canRegisterNewDevice(row: StudentDeviceRow, slot: RegistrationSlot): boolean {
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);

  if (countRegisteredDevices(row) >= 2) return false;

  if (slot === "web_phone" && appb) return false;

  if (appb && (slot === "web_phone" || slot === "web_desktop")) {
    if (phone || desktop) return false;
  }

  return true;
}

export function studentIsWebOnly(row: StudentDeviceRow): boolean {
  return !trimId(row.app_bound_device_id);
}

export function getAttemptedInstallationId(
  req: Request,
  bodyDeviceId?: string | null | undefined
): string | null {
  const header = getInstallationIdFromRequest(req);
  const bodyId = (bodyDeviceId && String(bodyDeviceId).trim()) || "";
  return header || bodyId || null;
}
