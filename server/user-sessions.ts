import type { DbLike } from "./native-device-binding";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function resolveUserBySessionToken(
  db: DbLike,
  token: string
): Promise<{ row: Record<string, unknown>; matchedVia: "primary" | "extra" } | null> {
  const minCreatedAt = Date.now() - SESSION_MAX_AGE_MS;
  const primary = await db.query(
    "SELECT * FROM users WHERE session_token = $1 AND COALESCE(is_blocked, FALSE) = FALSE AND (last_active_at IS NULL OR last_active_at >= $2)",
    [token, minCreatedAt]
  );
  if (primary.rows.length > 0) {
    return { row: primary.rows[0], matchedVia: "primary" };
  }
  const extra = await db.query(
    `SELECT u.* FROM users u
     INNER JOIN user_sessions s ON s.user_id = u.id AND s.session_token = $1
     WHERE u.role = 'admin' AND COALESCE(u.is_blocked, FALSE) = FALSE AND s.created_at >= $2`,
    [token, minCreatedAt]
  );
  if (extra.rows.length > 0) {
    return { row: extra.rows[0], matchedVia: "extra" };
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
  const minCreatedAt = Date.now() - SESSION_MAX_AGE_MS;
  const u = await db.query("SELECT session_token, role, last_active_at FROM users WHERE id = $1", [userId]);
  if (u.rows.length === 0) return false;
  if (u.rows[0].session_token === token) {
    const la = Number(u.rows[0].last_active_at || 0);
    if (!la || la >= minCreatedAt) return true;
  }
  if (u.rows[0].role !== "admin") return false;
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
  opts: { clearOtp?: boolean }
): Promise<void> {
  const isAdmin = user.role === "admin";
  const now = Date.now();

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
  await db.query(
    `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4`,
    [deviceId || null, token, now, user.id]
  );
}

export async function revokeAllSessionsForUser(db: DbLike, userId: number): Promise<void> {
  await db.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  await db.query("UPDATE users SET session_token = NULL WHERE id = $1", [userId]);
}

export async function revokeSessionTokenForUser(db: DbLike, userId: number, token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db.query("DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2", [userId, token]);
  await db.query("UPDATE users SET session_token = NULL WHERE id = $1 AND session_token = $2", [userId, token]);
}
