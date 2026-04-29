import type { Request } from "express";

export type DbLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

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

export type BindPurchaseResult = { ok: true } | { ok: false; message: string };

/** Call before recording payment/enrollment — blocks paid flow if bound to another installation. */
export async function assertNativePaidPurchaseInstallation(
  db: DbLike,
  userId: number,
  req: Request
): Promise<BindPurchaseResult> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst) return { ok: true };
  const r = await db.query("SELECT app_bound_device_id FROM users WHERE id = $1", [userId]);
  const cur = String(r.rows[0]?.app_bound_device_id ?? "").trim();
  if (cur && cur !== inst) {
    return {
      ok: false,
      message: "Purchases must be completed on the same device/browser installation registered for this account.",
    };
  }
  return { ok: true };
}

/** After paid purchase succeeded — binds installation id once (web + native). */
export async function finalizeInstallationBindAfterPurchase(
  db: DbLike,
  userId: number,
  req: Request
): Promise<void> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst) return;
  await db.query("UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND app_bound_device_id IS NULL", [
    inst,
    userId,
  ]);
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

/** Block session/API access if account is bound to another installation id. */
export async function enforceInstallationBinding(
  db: DbLike,
  req: Request,
  userId: number,
  role: string | undefined
): Promise<boolean> {
  if (role === "admin") return true;
  const r = await db.query(
    "SELECT COALESCE(app_bound_device_id, '') AS bid FROM users WHERE id = $1",
    [userId]
  );
  const bound = String(r.rows[0]?.bid || "").trim();
  if (!bound) return true;

  const cand = getInstallationIdFromRequest(req);
  if (!cand || cand !== bound) return false;
  return true;
}

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
  meta: { phone?: string | null; email?: string | null }
): Promise<void> {
  await insertBlockEvent(db, {
    userId,
    attempted: attemptedId,
    bound: boundId,
    phone: meta.phone ?? null,
    email: meta.email ?? null,
    platform: getClientPlatform(req) ?? undefined,
    reason: "wrong_device_login_denied",
  });
}

type LoginDeviceResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string };

/**
 * Run before issuing a new session on login/sign-up flows (OTP, Firebase, email login).
 * If the account is already bound to another installation id, deny login and log an event.
 */
export async function assertLoginAllowedForInstallation(
  db: DbLike,
  req: Request,
  opts: {
    userId: number;
    role?: string;
    /** Extra device id from JSON body (OTP, etc.) when headers are missing. */
    bodyDeviceId?: string | null | undefined;
    phone?: string | null;
    email?: string | null;
  }
): Promise<LoginDeviceResult> {
  if (opts.role === "admin") return { ok: true };

  const ur = await db.query(
    "SELECT app_bound_device_id, COALESCE(is_blocked,FALSE) AS blocked FROM users WHERE id = $1",
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  if (row.blocked) return { ok: false, httpStatus: 403, message: "Your account has been blocked. Please contact support." };

  const bound = row.app_bound_device_id ? String(row.app_bound_device_id).trim() : "";
  if (!bound) return { ok: true };

  const attemptHeader = getInstallationIdFromRequest(req);
  const bodyId = (opts.bodyDeviceId && String(opts.bodyDeviceId).trim()) || "";
  const attempted = attemptHeader || bodyId || null;
  if (!attempted) {
    return {
      ok: false,
      httpStatus: 403,
      message:
        "This account is linked to a registered device. Update the app or sign in from the same device you used to purchase.",
    };
  }
  if (attempted !== bound) {
    await logWrongInstallationAttempt(db, req, opts.userId, bound, attempted, {
      phone: opts.phone ?? null,
      email: opts.email ?? null,
    });
    return {
      ok: false,
      httpStatus: 403,
      message:
        "Access denied: this account is linked to another device/browser installation. Use the original installation or ask admin to clear the device lock.",
    };
  }
  return { ok: true };
}
