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

/** Phone-class vs desktop-class web browser (two allowed installs per student). */
export function getWebFormFactorFromRequest(req: Request): "phone" | "desktop" {
  const raw = (req.get("x-web-form-factor") || "").trim().toLowerCase();
  if (raw === "phone" || raw === "mobile") return "phone";
  if (raw === "desktop" || raw === "laptop") return "desktop";
  const ua = (req.get("user-agent") || "").toLowerCase();
  if (/ipad/i.test(ua) && !/mobile/i.test(ua)) return "desktop";
  if (/mobile|android|iphone|ipod|webos|blackberry|iemobile|opera mini/i.test(ua)) return "phone";
  return "desktop";
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

/** Call before recording payment/enrollment — blocks paid flow if bound to another installation. */
export async function assertNativePaidPurchaseInstallation(
  db: DbLike,
  userId: number,
  req: Request
): Promise<BindPurchaseResult> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return { ok: true };
  const plat = getClientPlatform(req);
  const r = await db.query(
    `SELECT app_bound_device_id,
            COALESCE(web_device_id_phone, '') AS wph,
            COALESCE(web_device_id_desktop, '') AS wdk
     FROM users WHERE id = $1`,
    [userId]
  );
  if (r.rows.length === 0) return { ok: true };
  const row = r.rows[0];
  const ok = studentInstallationMatchesActiveSession(
    {
      app_bound_device_id: row.app_bound_device_id,
      web_device_id_phone: row.wph,
      web_device_id_desktop: row.wdk,
    },
    req,
    inst,
    plat
  );
  if (!ok) {
    return {
      ok: false,
      message:
        "Purchases must be completed on the same device/browser installation registered for this account.",
    };
  }
  return { ok: true };
}

/** Bind missing slots after login/purchase (students only). */
export async function finalizeStudentWebSlotsAfterAuth(db: DbLike, userId: number, role: string | undefined, req: Request): Promise<void> {
  if (role === "admin") return;
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  if (getClientPlatform(req) !== "web") return;
  const factor = getWebFormFactorFromRequest(req);
  const slot = factor === "phone" ? "phone" : "desktop";
  await db.query(
    `UPDATE users SET
       web_device_id_phone = CASE
         WHEN $1 = 'phone' AND COALESCE(NULLIF(TRIM(web_device_id_phone), ''), '') = '' THEN $2
         ELSE web_device_id_phone END,
       web_device_id_desktop = CASE
         WHEN $1 = 'desktop' AND COALESCE(NULLIF(TRIM(web_device_id_desktop), ''), '') = '' THEN $2
         ELSE web_device_id_desktop END
     WHERE id = $3 AND COALESCE(role, '') <> 'admin'`,
    [slot, inst, userId]
  );
}

/** After paid purchase succeeded — binds native app id once, plus web dual slots when applicable. */
export async function finalizeInstallationBindAfterPurchase(db: DbLike, userId: number, req: Request): Promise<void> {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  const ur = await db.query("SELECT role FROM users WHERE id = $1", [userId]);
  const role = ur.rows[0]?.role as string | undefined;
  await finalizeStudentWebSlotsAfterAuth(db, userId, role, req);
  await db.query("UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND app_bound_device_id IS NULL", [inst, userId]);
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
  row: { app_bound_device_id?: unknown; web_device_id_phone?: unknown; web_device_id_desktop?: unknown },
  req: Request,
  cand: string | null,
  plat: ReturnType<typeof getClientPlatform>
): boolean {
  if (!cand || cand === "web_anon") return false;
  const appb = String(row.app_bound_device_id ?? "").trim();
  const wph = String(row.web_device_id_phone ?? "").trim();
  const wdk = String(row.web_device_id_desktop ?? "").trim();

  if (plat === "ios" || plat === "android") {
    if (!appb) return true;
    return cand === appb;
  }

  if (plat === "web") {
    const factor = getWebFormFactorFromRequest(req);
    if (!wph && !wdk && !appb) return true;
    if (cand === wph || cand === wdk) return true;
    if (!wph && factor === "phone") return true;
    if (!wdk && factor === "desktop") return true;
    if (!wph && !wdk && appb && cand === appb) return true;
    return false;
  }

  if (!appb) return true;
  return cand === appb;
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
    `SELECT COALESCE(app_bound_device_id, '') AS appb,
            COALESCE(web_device_id_phone, '') AS wph,
            COALESCE(web_device_id_desktop, '') AS wdk
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return true;

  const row = r.rows[0];
  const appb = String(row.appb ?? "").trim();
  const wph = String(row.wph ?? "").trim();
  const wdk = String(row.wdk ?? "").trim();

  const cand = getInstallationIdFromRequest(req);
  const plat = getClientPlatform(req);

  if (!wph && !wdk && !appb) return true;

  if (!cand || cand === "web_anon") return false;

  return studentInstallationMatchesActiveSession(
    { app_bound_device_id: appb, web_device_id_phone: wph, web_device_id_desktop: wdk },
    req,
    cand,
    plat
  );
}

type LoginDeviceResult =
  | { ok: true }
  | { ok: false; httpStatus: number; message: string };

/**
 * Run before issuing a new session on login/sign-up flows (OTP, Firebase, email login).
 * Native apps: single app_bound_device_id. Web students: one phone browser + one desktop browser.
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
  if (opts.role === "admin") return { ok: true };

  const ur = await db.query(
    `SELECT app_bound_device_id,
            COALESCE(web_device_id_phone, '') AS wph,
            COALESCE(web_device_id_desktop, '') AS wdk,
            COALESCE(is_blocked,FALSE) AS blocked
     FROM users WHERE id = $1`,
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  if (row.blocked) return { ok: false, httpStatus: 403, message: "Your account has been blocked. Please contact support." };

  const attemptHeader = getInstallationIdFromRequest(req);
  const bodyId = (opts.bodyDeviceId && String(opts.bodyDeviceId).trim()) || "";
  const attempted = attemptHeader || bodyId || null;

  const plat = getClientPlatform(req);

  const appb = row.app_bound_device_id ? String(row.app_bound_device_id).trim() : "";
  const wph = String(row.wph ?? "").trim();
  const wdk = String(row.wdk ?? "").trim();

  if (plat === "ios" || plat === "android") {
    if (!appb) return { ok: true };
    if (!attempted || attempted !== appb) {
      await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, {
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

  if (plat === "web") {
    const factor = getWebFormFactorFromRequest(req);
    if (!attempted || attempted === "web_anon") {
      if (!wph && !wdk && !appb) return { ok: true };
      return {
        ok: false,
        httpStatus: 403,
        message:
          "Enable cookies/storage for this site and retry sign-in so your browser installation can be verified.",
      };
    }

    if (attempted === wph || attempted === wdk) return { ok: true };
    if (!wph && factor === "phone") return { ok: true };
    if (!wdk && factor === "desktop") return { ok: true };
    if (!wph && !wdk && appb && attempted === appb) return { ok: true };
    if (!wph && !wdk && !appb) return { ok: true };

    await logWrongInstallationAttempt(
      db,
      req,
      opts.userId,
      factor === "phone" ? wph || null : wdk || null,
      attempted,
      { phone: opts.phone ?? null, email: opts.email ?? null },
      "wrong_web_browser_login_denied"
    );
    return {
      ok: false,
      httpStatus: 403,
      message:
        "Access denied: this account is already signed in on another phone web and/or laptop web browser. Use those browsers or ask admin to clear the web device lock.",
    };
  }

  if (!appb) return { ok: true };
  if (!attempted || attempted !== appb) {
    await logWrongInstallationAttempt(db, req, opts.userId, appb, attempted, {
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
