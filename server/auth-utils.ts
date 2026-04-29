import type { Request } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type AuthUser = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  sessionToken?: string;
  profileComplete?: boolean;
};

function rowsToAuthUser(u: Record<string, any>): AuthUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    sessionToken: u.session_token,
    profileComplete: !!u.profile_complete || false,
  };
}

/**
 * Loads the authenticated user. Single-session (“one device”) is enforced here:
 * a new login rotates `users.session_token`, so stale cookies or old Bearer tokens
 * must fail after another device logs in. Previous bug: trusting `req.session.user`
 * without querying the DB allowed cookie-only clients to bypass invalidation.
 */
export async function getAuthUserFromRequest(req: Request, db: DbClient): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const bearerToken =
    bearerRaw && bearerRaw !== "null" && bearerRaw !== "undefined" ? bearerRaw : "";

  // 1) Bearer present: DB is authoritative (invalid / rotated token => no user).
  if (bearerToken) {
    const token = bearerToken;
    try {
      const result = await db.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE session_token = $1",
        [token]
      );
      if (result.rows.length === 0) {
        (req.session as any).user = null;
        return null;
      }
      const u = result.rows[0];
      if (u.is_blocked) {
        (req.session as any).user = null;
        return null;
      }
      const authUser = rowsToAuthUser(u);
      (req.session as any).user = authUser;
      return authUser;
    } catch (e) {
      console.error("[Auth] Bearer token lookup error:", e);
      return null;
    }
  }

  // 2) Cookie session only: must match current DB session_token (same as GET /api/auth/me).
  const sessionUser = (req.session as any).user as { id?: number; sessionToken?: string | null } | undefined;
  if (!sessionUser?.id) return null;

  try {
    const result = await db.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE id = $1",
      [sessionUser.id]
    );
    if (result.rows.length === 0) {
      (req.session as any).user = null;
      return null;
    }
    const row = result.rows[0];
    if (row.is_blocked) {
      (req.session as any).user = null;
      return null;
    }
    if (sessionUser.sessionToken && row.session_token !== sessionUser.sessionToken) {
      (req.session as any).user = null;
      return null;
    }
    // DB has a session but cookie has no token (legacy / tampered) — do not trust.
    if (row.session_token && !sessionUser.sessionToken) {
      (req.session as any).user = null;
      return null;
    }

    const authUser = rowsToAuthUser(row);
    (req.session as any).user = authUser;
    return authUser;
  } catch (e) {
    console.error("[Auth] Session user lookup error:", e);
    return null;
  }
}

