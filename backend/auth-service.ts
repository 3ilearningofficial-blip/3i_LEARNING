/**
 * auth-service.ts — Pure business logic and utilities extracted from auth-routes.ts.
 *
 * Nothing in this file handles HTTP (no req/res). Each function here is:
 *   - Unit-testable in isolation
 *   - Free of Express/session side-effects (except regenerateSession / destroySession,
 *     which wrap the callback-based session API in Promises)
 *
 * Route handlers in auth-routes.ts import from here and remain responsible only for
 * parsing HTTP inputs, calling these helpers, and writing HTTP responses.
 */

import type { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

// ─── OTP / session constants ───────────────────────────────────────────────

/** Short-lived registration token TTL (issued by verify-otp, consumed by register-complete). */
export const REGISTRATION_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Per-user OTP send policy: minimum delay between consecutive OTP requests. */
export const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000;

/** Maximum OTP sends allowed before a 24h lockout is applied. */
export const OTP_SENDS_PER_CYCLE = 3;

/** Duration of the lockout that activates after OTP_SENDS_PER_CYCLE sends. */
export const OTP_SEND_LOCK_MS = 24 * 60 * 60 * 1000;

export const OTP_LOCKOUT_MESSAGE =
  "Too many OTP attempts. Please try again after 24 hours.";
export const OTP_COOLDOWN_MESSAGE =
  "Please wait before requesting another OTP.";

export const GENERIC_LOGIN_ERROR = "Invalid credentials";
export const GENERIC_OTP_ERROR = "Invalid or expired OTP";

// ─── Token helpers ─────────────────────────────────────────────────────────

/** Throws at runtime if OTP_HMAC_SECRET is unset — startup must catch this. */
export function getTokenSecret(): string {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error("OTP_HMAC_SECRET must be set");
  }
  return secret;
}

export function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

// ─── Registration token ────────────────────────────────────────────────────

export type RegistrationTokenPayload = {
  identifier: string;
  type: "phone" | "email";
  phone?: string;
  email?: string;
  exp: number;
};

/**
 * Issue a short-lived HMAC-signed token for an OTP-verified identifier that
 * doesn't have a users row yet. Consumed by /api/auth/register-complete.
 */
export function signRegistrationToken(
  payload: Omit<RegistrationTokenPayload, "exp">
): string {
  const body: RegistrationTokenPayload = {
    ...payload,
    exp: Date.now() + REGISTRATION_TOKEN_TTL_MS,
  };
  const b64 = toBase64Url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = toBase64Url(createHmac("sha256", getTokenSecret()).update(b64).digest());
  return `${b64}.${sig}`;
}

/**
 * Verify and decode a registration token. Returns null if the token is
 * missing, malformed, expired, or has an invalid signature.
 */
export function verifyRegistrationToken(
  token: string | null | undefined
): RegistrationTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = toBase64Url(
    createHmac("sha256", getTokenSecret()).update(b64).digest()
  );
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const json = fromBase64Url(b64).toString("utf8");
    const obj = JSON.parse(json) as RegistrationTokenPayload;
    if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
    if (obj.type !== "phone" && obj.type !== "email") return null;
    if (typeof obj.identifier !== "string" || !obj.identifier) return null;
    return obj;
  } catch {
    return null;
  }
}

// ─── Session user builder ──────────────────────────────────────────────────

/**
 * Map a DB user row to the session user shape returned by GET /api/auth/me.
 * Keeping this centralised avoids field mismatches across login code paths.
 */
export function buildSessionUserFromRow(
  row: Record<string, any>,
  opts: { sessionToken: string; deviceId?: string | null }
) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    deviceId: opts.deviceId,
    sessionToken: opts.sessionToken,
    profileComplete: !!(row.profile_complete),
    date_of_birth: row.date_of_birth ?? null,
    photo_url: row.photo_url ?? null,
  };
}

// ─── Session Promise wrappers ──────────────────────────────────────────────

/** Mitigate session fixation: regenerate session id before attaching authenticated user. */
export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// ─── Input normalisation ───────────────────────────────────────────────────

/** Strip non-digits and return the last 10, matching Indian mobile numbers. */
export function normalizePhone(input: unknown): string {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function normalizeEmail(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

// ─── OTP throttle evaluator ────────────────────────────────────────────────

export type ThrottleSnapshot = {
  send_count: number;
  /** Millis of last accepted send-otp (cooldown anchor). */
  last_send_at: number | null;
  send_locked_until: number | null;
};

export type ThrottleDecision =
  | {
      ok: true;
      nextCount: number;
      lastSendAt: number;
      /** Non-null when this is the 3rd send in the cycle — caller must persist the lock. */
      newSendLockedUntil: number | null;
    }
  | { ok: false; lockedUntil: number; reason: "quota" | "cooldown" };

/**
 * Decides whether an OTP send is allowed given the user's current throttle state.
 *
 * Rules:
 *   1. Active 24h lock → deny (quota).
 *   2. Less than 2 min since last send → deny (cooldown).
 *   3. ≥ 3 sends in cycle → deny (quota) and set a new lock.
 *   4. Otherwise → allow; returns the values the caller should persist.
 *
 * Pure function — no DB access, fully testable.
 */
export function evaluateOtpSendThrottle(
  snap: ThrottleSnapshot,
  now: number
): ThrottleDecision {
  const lockedUntil =
    snap.send_locked_until != null ? Number(snap.send_locked_until) : null;

  if (lockedUntil != null && lockedUntil > now) {
    return { ok: false, lockedUntil, reason: "quota" };
  }

  const lastSend = snap.last_send_at != null ? Number(snap.last_send_at) : null;
  if (lastSend != null && now - lastSend < OTP_RESEND_COOLDOWN_MS) {
    return {
      ok: false,
      lockedUntil: lastSend + OTP_RESEND_COOLDOWN_MS,
      reason: "cooldown",
    };
  }

  // If the previous lock has expired, reset the counter.
  let count = Number(snap.send_count) || 0;
  if (lockedUntil != null && lockedUntil <= now) {
    count = 0;
  }

  if (count >= OTP_SENDS_PER_CYCLE) {
    return { ok: false, lockedUntil: now + OTP_SEND_LOCK_MS, reason: "quota" };
  }

  const nextCount = count + 1;
  const newSendLockedUntil =
    nextCount >= OTP_SENDS_PER_CYCLE ? now + OTP_SEND_LOCK_MS : null;

  return { ok: true, nextCount, lastSendAt: now, newSendLockedUntil };
}
