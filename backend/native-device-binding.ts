import type { Request } from "express";
import {
  canRegisterNewDevice,
  countRegisteredDevices,
  getAttemptedInstallationId,
  getRegistrationSlot,
  isInstallationRegistered,
  studentIsWebOnly,
  usesStaffDualSession,
  type StudentDeviceRow,
} from "./session-policy";

export type DbLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

const MAX_DEVICES_MESSAGE =
  "You are not allowed to sign in. This account is already registered on the maximum number of devices (2). Contact support or ask admin to unlock.";

function envFlagEnabled(name: string): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isStudentDeviceBindingDisabled(role: string | undefined | null): boolean {
  return String(role || "").trim().toLowerCase() !== "admin" && envFlagEnabled("DISABLE_STUDENT_DEVICE_BINDING");
}

export function getInstallationIdFromRequest(req: Request): string | null {
  const raw = (req.get("x-app-device-id") || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return raw;
}

export function getClientPlatform(req: Request): "ios" | "android" | "web" | null {
  const p = (req.get("x-client-platform") || "").trim().toLowerCase();
  if (p === "ios" || p === "android" || p === "web") return p;
  return null;
}

/** Student session platform family for web XOR mobile enforcement. */
export function getActiveSessionPlatformFamily(req: Request): "web" | "mobile" | null {
  const plat = getClientPlatform(req);
  if (plat === "web") return "web";
  if (plat === "ios" || plat === "android") return "mobile";
  return null;
}

export type BindPurchaseResult = { ok: true } | { ok: false; message: string };

async function insertBlockEvent(
  db: DbLike,
  row: {
    userId: number;
    attempted: string | null;
    bound: string | null;
    phone?: string | null;
    email?: string | null;
    platform?: string | null;
    reason: string;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO device_block_events (user_id, attempted_device_id, bound_device_id, phone, email, platform, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      row.userId,
      row.attempted,
      row.bound,
      row.phone ?? null,
      row.email ?? null,
      row.platform ?? null,
      row.reason,
      Date.now(),
    ]
  );
}

export async function logWrongInstallationAttempt(
  db: DbLike,
  req: Request,
  userId: number,
  boundId: string | null,
  attemptedId: string | null,
  meta: { phone?: string | null; email?: string | null },
  reason = "wrong_device_login_denied"
): Promise<void> {
  await insertBlockEvent(db, {
    userId,
    attempted: attemptedId,
    bound: boundId,
    phone: meta.phone ?? null,
    email: meta.email ?? null,
    platform: getClientPlatform(req) ?? undefined,
    reason,
  });
}

function studentDeviceRowFromDb(row: Record<string, unknown>): StudentDeviceRow {
  return {
    app_bound_device_id: row.app_bound_device_id,
    web_device_id_phone: row.web_device_id_phone,
    web_device_id_desktop: row.web_device_id_desktop,
  };
}

async function loadStudentDeviceRow(db: DbLike, userId: number): Promise<StudentDeviceRow | null> {
  const r = await db.query(
    `SELECT app_bound_device_id, web_device_id_phone, web_device_id_desktop
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return null;
  return studentDeviceRowFromDb(r.rows[0]);
}

/** Register student installation id into the appropriate slot on first login. */
async function bindStudentDeviceOnLogin(db: DbLike, userId: number, req: Request): Promise<void> {
  const plat = getClientPlatform(req);
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;

  if (plat === "ios" || plat === "android") {
    await db.query(
      "UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND (app_bound_device_id IS NULL OR app_bound_device_id = '')",
      [inst, userId]
    );
    return;
  }

  if (plat === "web") {
    const slot = getRegistrationSlot(req);
    if (slot === "web_phone") {
      await db.query(
        "UPDATE users SET web_device_id_phone = $1 WHERE id = $2 AND (web_device_id_phone IS NULL OR web_device_id_phone = '')",
        [inst, userId]
      );
    } else if (slot === "web_desktop") {
      await db.query(
        "UPDATE users SET web_device_id_desktop = $1 WHERE id = $2 AND (web_device_id_desktop IS NULL OR web_device_id_desktop = '')",
        [inst, userId]
      );
    }
  }
}

/** Call before recording payment/enrollment — blocks paid flow if bound to another installation. */
export async function assertNativePaidPurchaseInstallation(
  db: DbLike,
  userId: number,
  req: Request
): Promise<BindPurchaseResult> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return { ok: true };
  const plat = getClientPlatform(req);
  if (plat === "web") return { ok: true };
  const r = await db.query(`SELECT app_bound_device_id, role FROM users WHERE id = $1`, [userId]);
  if (r.rows.length === 0) return { ok: true };
  const row = r.rows[0];
  if (usesStaffDualSession(row.role as string) || isStudentDeviceBindingDisabled(row.role as string | undefined)) {
    return { ok: true };
  }
  const ok = studentInstallationMatchesActiveSession(
    { app_bound_device_id: row.app_bound_device_id },
    req,
    inst,
    plat
  );
  if (!ok) {
    return {
      ok: false,
      message:
        "Purchases must be completed on the same native device registered for this account.",
    };
  }
  return { ok: true };
}

/** After paid purchase succeeded — binds native app id once. Web uses active-session locking only. */
export async function finalizeInstallationBindAfterPurchase(db: DbLike, userId: number, req: Request): Promise<void> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  const plat = getClientPlatform(req);
  if (plat !== "ios" && plat !== "android") return;
  const ur = await db.query("SELECT role FROM users WHERE id = $1", [userId]);
  const role = ur.rows[0]?.role as string | undefined;
  if (usesStaffDualSession(role) || isStudentDeviceBindingDisabled(role)) return;
  await db.query("UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND app_bound_device_id IS NULL", [inst, userId]);
}

/**
 * Bind installation id on successful student login (native app or web browser slot).
 */
export async function bindDeviceForNativeFirstLogin(
  db: DbLike,
  userId: number,
  role: string | undefined,
  req: Request
): Promise<void> {
  if (role === "admin" || usesStaffDualSession(role)) return;
  if (isStudentDeviceBindingDisabled(role)) return;
  await bindStudentDeviceOnLogin(db, userId, req);
}

/** Legacy single-call helper for routers that forgot pre-check — still used only internally if needed */
export async function bindInstallationAfterPurchase(
  db: DbLike,
  userId: number,
  req: Request
): Promise<BindPurchaseResult> {
  const pre = await assertNativePaidPurchaseInstallation(db, userId, req);
  if (!pre.ok) return pre;
  await finalizeInstallationBindAfterPurchase(db, userId, req);
  return { ok: true };
}

function studentInstallationMatchesActiveSession(
  row: { app_bound_device_id?: unknown },
  req: Request,
  cand: string | null,
  plat: ReturnType<typeof getClientPlatform>
): boolean {
  if (!cand || cand === "web_anon") return false;
  const appb = String(row.app_bound_device_id ?? "").trim();

  if (plat === "ios" || plat === "android") {
    if (!appb) return true;
    return cand === appb;
  }

  if (!appb) return true;
  return cand === appb;
}

export type EnforceBindingResult =
  | { ok: true }
  | { ok: false; code: "device_binding_mismatch" | "device_id_missing" };

/**
 * Block session/API access if account is bound to another installation id.
 */
export async function enforceInstallationBinding(
  db: DbLike,
  req: Request,
  userId: number,
  role: string | undefined
): Promise<EnforceBindingResult> {
  if (role === "admin" || usesStaffDualSession(role)) return { ok: true };
  if (isStudentDeviceBindingDisabled(role)) return { ok: true };

  const plat = getClientPlatform(req);
  const cand = getInstallationIdFromRequest(req);

  if (plat === "web") {
    const deviceRow = await loadStudentDeviceRow(db, userId);
    if (!deviceRow || countRegisteredDevices(deviceRow) === 0) return { ok: true };
    if (!cand || cand === "web_anon") {
      return { ok: false, code: "device_id_missing" };
    }
    if (isInstallationRegistered(deviceRow, cand)) return { ok: true };
    return { ok: false, code: "device_binding_mismatch" };
  }

  const r = await db.query(
    `SELECT COALESCE(app_bound_device_id, '') AS appb
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return { ok: true };

  const appb = String(r.rows[0].appb ?? "").trim();
  if (!appb) return { ok: true };

  if (!cand || cand === "web_anon") {
    return { ok: false, code: "device_id_missing" };
  }

  const matches = studentInstallationMatchesActiveSession(
    { app_bound_device_id: appb },
    req,
    cand,
    plat
  );
  return matches ? { ok: true } : { ok: false, code: "device_binding_mismatch" };
}

type LoginDeviceResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string; code?: string };

/**
 * Run before issuing a new session on login/sign-up flows (OTP, Firebase, email login).
 */
export async function assertLoginAllowedForInstallation(
  db: DbLike,
  req: Request,
  opts: {
    userId: number;
    role?: string;
    bodyDeviceId?: string | null | undefined;
    phone?: string | null;
    email?: string | null;
  }
): Promise<LoginDeviceResult> {
  if (opts.role === "admin" || usesStaffDualSession(opts.role)) return { ok: true };

  const ur = await db.query(
    `SELECT app_bound_device_id, web_device_id_phone, web_device_id_desktop,
            role, COALESCE(is_blocked,FALSE) AS blocked
     FROM users WHERE id = $1`,
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  const role = opts.role ?? (row.role as string | undefined);
  if (row.blocked) {
    return { ok: false, httpStatus: 403, message: "Your account has been blocked. Please contact support." };
  }
  if (isStudentDeviceBindingDisabled(role)) return { ok: true };

  const deviceRow = studentDeviceRowFromDb(row);
  const attempted = getAttemptedInstallationId(req, opts.bodyDeviceId);
  const plat = getClientPlatform(req);
  const slot = getRegistrationSlot(req);
  const meta = { phone: opts.phone ?? null, email: opts.email ?? null };

  if (plat === "ios" || plat === "android") {
    const appb = String(row.app_bound_device_id ?? "").trim();
    if (!appb) return { ok: true };
    if (attempted && attempted === appb) return { ok: true };
    if (attempted && isInstallationRegistered(deviceRow, attempted)) return { ok: true };
    if (attempted && canRegisterNewDevice(deviceRow, "app_bound")) return { ok: true };
    if (countRegisteredDevices(deviceRow) >= 2) {
      await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, meta, "max_devices_registered");
      return { ok: false, httpStatus: 403, message: MAX_DEVICES_MESSAGE, code: "max_devices_registered" };
    }
    await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, meta);
    return {
      ok: false,
      httpStatus: 403,
      message:
        "Access denied: this account is linked to another native device. Use the original device or ask admin to clear the device lock.",
    };
  }

  if (plat === "web") {
    const appb = String(row.app_bound_device_id ?? "").trim();
    if (slot === "web_phone" && appb) {
      await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, meta, "wrong_device_login_denied");
      return {
        ok: false,
        httpStatus: 403,
        message:
          "Phone web sign-in is not available for accounts registered on the mobile app. Use the app or your registered laptop browser.",
      };
    }
    if (attempted && isInstallationRegistered(deviceRow, attempted)) return { ok: true };
    if (slot && canRegisterNewDevice(deviceRow, slot)) return { ok: true };
    if (countRegisteredDevices(deviceRow) >= 2) {
      const bound = getRegisteredInstallationIdsForLog(deviceRow);
      await logWrongInstallationAttempt(db, req, opts.userId, bound, attempted, meta, "max_devices_registered");
      return { ok: false, httpStatus: 403, message: MAX_DEVICES_MESSAGE, code: "max_devices_registered" };
    }
    return { ok: true };
  }

  const appb = String(row.app_bound_device_id ?? "").trim();
  if (!appb) return { ok: true };
  if (!attempted || attempted !== appb) {
    await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, meta);
    return {
      ok: false,
      httpStatus: 403,
      message:
        "Access denied: this account is linked to another native device. Use the original device or ask admin to clear the device lock.",
    };
  }
  return { ok: true };
}

function getRegisteredInstallationIdsForLog(row: StudentDeviceRow): string | null {
  const ids = [
    String(row.app_bound_device_id ?? "").trim(),
    String(row.web_device_id_phone ?? "").trim(),
    String(row.web_device_id_desktop ?? "").trim(),
  ].filter(Boolean);
  return ids[0] ?? null;
}

/** Student web sessions stay locked to the same browser profile for the 7-day inactivity window. */
export const STUDENT_WEB_SESSION_LOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type SessionActiveResult = { ok: true } | { ok: false; httpStatus: number; message: string };

/**
 * Before rotating `session_token`, ensure no other installation is actively using
 * the account. Staff/admins are exempt. Registered students may switch devices (single session).
 */
export async function assertSessionNotActivelyInUse(
  db: DbLike,
  req: Request,
  opts: {
    userId: number;
    role?: string;
    bodyDeviceId?: string | null | undefined;
  }
): Promise<SessionActiveResult> {
  if (opts.role === "admin" || usesStaffDualSession(opts.role)) return { ok: true };

  const ur = await db.query(
    `SELECT session_token, last_active_at, role, device_id, phone, email,
            app_bound_device_id, web_device_id_phone, web_device_id_desktop
     FROM users WHERE id = $1`,
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  if (String(row.role ?? "") === "admin" || usesStaffDualSession(String(row.role ?? ""))) {
    return { ok: true };
  }

  const sessionToken = row.session_token ? String(row.session_token).trim() : "";
  if (!sessionToken) return { ok: true };

  const attempted = getAttemptedInstallationId(req, opts.bodyDeviceId);
  const storedDeviceId = row.device_id ? String(row.device_id).trim() : "";
  const deviceRow = studentDeviceRowFromDb(row);

  if (attempted && storedDeviceId && attempted === storedDeviceId) {
    return { ok: true };
  }

  if (attempted && isInstallationRegistered(deviceRow, attempted)) {
    return { ok: true };
  }

  if (attempted && countRegisteredDevices(deviceRow) < 2) {
    return { ok: true };
  }

  const lastActive = Number(row.last_active_at || 0);
  const plat = getClientPlatform(req);
  const lockWindowMs = plat === "web" ? STUDENT_WEB_SESSION_LOCK_WINDOW_MS : 10 * 60 * 1000;
  if (!lastActive || Date.now() - lastActive > lockWindowMs) {
    return { ok: true };
  }

  await logWrongInstallationAttempt(
    db,
    req,
    opts.userId,
    storedDeviceId || getRegisteredInstallationIdsForLog(deviceRow),
    attempted,
    { phone: row.phone ?? null, email: row.email ?? null },
    "active_web_session_login_denied"
  );
  return {
    ok: false,
    httpStatus: 403,
    message:
      "This account is already logged in on another device. Sign in here to switch devices, or ask admin to unlock.",
  };
}

export function userRowHasDeviceBinding(row: {
  app_bound_device_id?: unknown;
  web_device_id_phone?: unknown;
  web_device_id_desktop?: unknown;
}): boolean {
  return countRegisteredDevices(row) > 0;
}

/** True when the request installation matches a bound slot on the user row. */
export function requestMatchesUserDeviceBinding(
  req: Request,
  row: {
    app_bound_device_id?: unknown;
    web_device_id_phone?: unknown;
    web_device_id_desktop?: unknown;
  }
): boolean {
  const cand = getInstallationIdFromRequest(req);
  if (!cand || cand === "web_anon") return false;
  return isInstallationRegistered(row, cand);
}

/**
 * Students may only use /api/auth/me on the platform family that last logged in (web XOR mobile).
 * Web-only students (no native app) may use phone and laptop web interchangeably (one session).
 */
export async function assertActiveSessionPlatformMatches(
  db: DbLike,
  req: Request,
  userId: number,
  role: string | undefined
): Promise<{ ok: true } | { ok: false; activePlatform: string }> {
  if (role === "admin" || usesStaffDualSession(role)) return { ok: true };
  const r = await db.query(
    `SELECT COALESCE(active_session_platform, '') AS asp,
            app_bound_device_id
     FROM users WHERE id = $1`,
    [userId]
  );
  if (studentIsWebOnly({ app_bound_device_id: r.rows[0]?.app_bound_device_id })) {
    return { ok: true };
  }
  const active = String(r.rows[0]?.asp ?? "").trim();
  if (!active || (active !== "web" && active !== "mobile")) return { ok: true };
  const requestFamily = getActiveSessionPlatformFamily(req);
  if (!requestFamily || requestFamily === active) return { ok: true };
  return { ok: false, activePlatform: active };
}
