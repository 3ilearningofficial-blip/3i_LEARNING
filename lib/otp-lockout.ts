import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiUrl, attachInstallationHeaders } from "./query-client";

/**
 * Helpers for the per-user OTP send throttle (3 sends per 2-min window, then
 * 24h lock — enforced by the server via `users.otp_send_locked_until` and
 * `otp_challenges.send_locked_until`). The frontend persists the lockedUntil
 * timestamp so the countdown survives app/page restarts.
 */

const STORAGE_PREFIX = "otpLock:";

function storageKey(identifier: string): string {
  return `${STORAGE_PREFIX}${identifier}`;
}

export type SendOtpType = "phone" | "email";

export type SendOtpResult =
  | {
      ok: true;
      smsSent?: boolean;
      devOtp?: string;
      message?: string;
    }
  | {
      ok: false;
      status: number;
      message: string;
      lockedUntil: number | null;
    };

export type VerifyOtpResult =
  | {
      ok: true;
      registered: true;
      user: any;
    }
  | {
      ok: true;
      registered: false;
      registrationToken: string;
      identifier: string;
      type: SendOtpType;
    }
  | {
      ok: false;
      status: number;
      message: string;
    };

async function buildHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  await attachInstallationHeaders(headers);
  return headers;
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  if (Platform.OS === "web") {
    return globalThis.fetch(url, init);
  }
  const { fetch: expoFetch } = await import("expo/fetch");
  return expoFetch(url, init as any) as unknown as Response;
}

/** POST /api/auth/send-otp without throwing on 429, so we can read lockedUntil. */
export async function sendOtpRequest(
  identifier: string,
  type: SendOtpType
): Promise<SendOtpResult> {
  try {
    const url = `${getApiUrl()}/auth/send-otp`;
    const headers = await buildHeaders();
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ identifier, type }),
      credentials: "include",
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (res.status === 429 || (typeof body?.lockedUntil === "number" && body.lockedUntil > Date.now())) {
      const lockedUntil = typeof body?.lockedUntil === "number" ? body.lockedUntil : Date.now() + 24 * 60 * 60 * 1000;
      await persistLockedUntil(identifier, lockedUntil);
      return {
        ok: false,
        status: res.status || 429,
        message: body?.message || "Too many OTP attempts. Please try again later.",
        lockedUntil,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: body?.message || `Request failed (${res.status})`,
        lockedUntil: null,
      };
    }

    // Successful send clears any stored lock for this identifier.
    await clearLockedUntil(identifier);
    return {
      ok: true,
      smsSent: !!body?.smsSent,
      devOtp: body?.devOtp || "",
      message: body?.message,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      message: err?.message || "Network error",
      lockedUntil: null,
    };
  }
}

/** POST /api/auth/verify-otp without throwing, so we can branch on registrationToken vs. user. */
export async function verifyOtpRequest(
  identifier: string,
  type: SendOtpType,
  otp: string,
  deviceId: string | null
): Promise<VerifyOtpResult> {
  try {
    const url = `${getApiUrl()}/auth/verify-otp`;
    const headers = await buildHeaders();
    const res = await doFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ identifier, type, otp, deviceId }),
      credentials: "include",
    });
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!res.ok) {
      return { ok: false, status: res.status, message: body?.message || `Request failed (${res.status})` };
    }
    if (body?.registrationToken) {
      return {
        ok: true,
        registered: false,
        registrationToken: String(body.registrationToken),
        identifier: String(body.identifier || identifier),
        type: (body.type === "email" ? "email" : "phone") as SendOtpType,
      };
    }
    if (body?.user) {
      return { ok: true, registered: true, user: body.user };
    }
    return { ok: false, status: res.status, message: "Unexpected verify-otp response" };
  } catch (err: any) {
    return { ok: false, status: 0, message: err?.message || "Network error" };
  }
}

export async function persistLockedUntil(identifier: string, lockedUntil: number | null): Promise<void> {
  try {
    if (lockedUntil && lockedUntil > Date.now()) {
      await AsyncStorage.setItem(storageKey(identifier), String(lockedUntil));
    } else {
      await AsyncStorage.removeItem(storageKey(identifier));
    }
  } catch {
    // ignore — countdown will simply not survive app restarts
  }
}

export async function loadLockedUntil(identifier: string): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(identifier));
    if (!raw) return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    if (num <= Date.now()) {
      await AsyncStorage.removeItem(storageKey(identifier)).catch(() => {});
      return null;
    }
    return num;
  } catch {
    return null;
  }
}

export async function clearLockedUntil(identifier: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(storageKey(identifier));
  } catch {
    /* ignore */
  }
}

/** Format `Try again in 23h 59m 12s` style countdown. */
export function formatLockCountdown(ms: number): string {
  if (ms <= 0) return "0s";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
