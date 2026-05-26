import type { Request } from "express";
import type { DbLike } from "./native-device-binding";
import { getActiveSessionPlatformFamily } from "./native-device-binding";

/** Admin sessions: effectively never expire from inactivity. */
export const ADMIN_SESSION_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
/** Student sessions (bound or unbound): 7-day inactivity window. */
export const STUDENT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Max inactivity before a session token is rejected (role-aware). */
export function sessionMaxAgeMsForRow(row: Record<string, unknown>): number {
  if (String(row.role ?? "") === "admin") return ADMIN_SESSION_MAX_AGE_MS;
  return STUDENT_SESSION_MAX_AGE_MS;
}

function sessionMinActiveAt(row: Record<string, unknown>): number {
  return Date.now() - sessionMaxAgeMsForRow(row);
}

/** Whether `last_active_at` is within the allowed inactivity window for this user. */
export function isSessionLastActiveValid(row: Record<string, unknown>): boolean {
  const la = Number(row.last_active_at || 0);
  if (!la) return true;
  return la >= sessionMinActiveAt(row);
}

export async function resolveUserBySessionToken(
  db: DbLike,
  token: string
): Promise<{ row: Record<string, unknown>; matchedVia: "primary" | "extra" } | null> {
  const primary = await db.query(
    "SELECT * FROM users WHERE session_token = $1 AND COALESCE(is_blocked, FALSE) = FALSE",
    [token]
  );
  if (primary.rows.length > 0) {
    const row = primary.rows[0] as Record<string, unknown>;
    if (isSessionLastActiveValid(row)) {
      return { row, matchedVia: "primary" };
    }
  }
  const minCreatedAt = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
  const extra = await db.query(
    `SELECT u.* FROM users u
     INNER JOIN user_sessions s ON s.user_id = u.id AND s.session_token = $1
     WHERE u.role = 'admin' AND COALESCE(u.is_blocked, FALSE) = FALSE AND s.created_at >= $2`,
    [token, minCreatedAt]
  );
  if (extra.rows.length > 0) {
    return { row: extra.rows[0] as Record<string, unknown>, matchedVia: "extra" };
  }
  return null;
}

/** Whether this token is still valid for this user (primary or admin multi-session row). */
export async function userHasSessionToken(
  db: DbLike,
  userId: number,
  token: string | null | undefined
): Promise<boolean> {
  if (!token) return false;
  const u = await db.query(
    `SELECT session_token, role, last_active_at,
            app_bound_device_id, web_device_id_phone, web_device_id_desktop
     FROM users WHERE id = $1`,
    [userId]
  );
  if (u.rows.length === 0) return false;
  const row = u.rows[0] as Record<string, unknown>;
  if (row.session_token === token) {
    if (isSessionLastActiveValid(row)) return true;
  }
  if (row.role !== "admin") return false;
  const minCreatedAt = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
  const s = await db.query(
    "SELECT 1 FROM user_sessions WHERE user_id = $1 AND session_token = $2 AND created_at >= $3",
    [userId, token, minCreatedAt]
  );
  return s.rows.length > 0;
}

export async function persistLoginSession(
  db: DbLike,
  user: { id: number; role: string },
  token: string,
  deviceId: string | null,
  opts: { clearOtp?: boolean; req?: Request }
): Promise<void> {
  const isAdmin = user.role === "admin";
  const now = Date.now();
  const platformFamily = !isAdmin && opts.req ? getActiveSessionPlatformFamily(opts.req) : null;

  if (isAdmin) {
    await db.query("INSERT INTO user_sessions (user_id, session_token, created_at) VALUES ($1, $2, $3)", [
      user.id,
      token,
      now,
    ]);
    const urow = await db.query("SELECT session_token FROM users WHERE id = $1", [user.id]);
    const hasPrimary = !!urow.rows[0]?.session_token;
    if (!hasPrimary) {
      await db.query(
        "UPDATE users SET session_token = $1, last_active_at = $2, device_id = COALESCE($3, device_id) WHERE id = $4",
        [token, now, deviceId, user.id]
      );
    } else if (opts.clearOtp) {
      await db.query(
        "UPDATE users SET otp = NULL, otp_expires_at = NULL, otp_failed_attempts = 0, otp_locked_until = NULL, last_active_at = $1, device_id = COALESCE($2, device_id) WHERE id = $3",
        [now, deviceId, user.id]
      );
    } else {
      await db.query(
        "UPDATE users SET last_active_at = $1, device_id = COALESCE($2, device_id) WHERE id = $3",
        [now, deviceId, user.id]
      );
    }
    return;
  }

  await db.query("DELETE FROM user_sessions WHERE user_id = $1", [user.id]);
  const otpClause =
    opts.clearOtp !== false
      ? "otp = NULL, otp_expires_at = NULL, otp_failed_attempts = 0, otp_locked_until = NULL, "
      : "";
  if (platformFamily === "web" || platformFamily === "mobile") {
    await db.query(
      `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3, active_session_platform = $4 WHERE id = $5`,
      [deviceId || null, token, now, platformFamily, user.id]
    );
  } else {
    await db.query(
      `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4`,
      [deviceId || null, token, now, user.id]
    );
  }
}

export async function revokeAllSessionsForUser(db: DbLike, userId: number): Promise<void> {
  await db.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  await db.query(
    "UPDATE users SET session_token = NULL, active_session_platform = NULL WHERE id = $1",
    [userId]
  );
}

export async function revokeSessionTokenForUser(db: DbLike, userId: number, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.query("DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2", [userId, token]);
  const u = await db.query("SELECT session_token FROM users WHERE id = $1", [userId]);
  if (u.rows[0]?.session_token === token) {
    await db.query(
      "UPDATE users SET session_token = NULL, active_session_platform = NULL WHERE id = $1",
      [userId]
    );
  }
}
