import type { Request } from "express";
import { resolveUserBySessionToken, userHasSessionToken } from "./user-sessions";

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

function rowsToAuthUser(u: Record<string, any>, sessionTokenOverride?: string | null): AuthUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    sessionToken: (sessionTokenOverride ?? u.session_token) as string | undefined,
    profileComplete: !!u.profile_complete || false,
  };
}

/** WebSocket / internal callers may omit Express session — only sync when present. */
function syncSessionUser(req: Request, user: AuthUser | null) {
  const session = (req as { session?: { user?: AuthUser | null } }).session;
  if (session && typeof session === "object") {
    session.user = user;
  }
}

/**
 * Loads the authenticated user. Students use a single rotated `users.session_token`.
 * Admins may have additional rows in `user_sessions` so multiple devices stay signed in.
 */
export async function getAuthUserFromRequest(req: Request, db: DbClient): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const bearerToken =
    bearerRaw && bearerRaw !== "null" && bearerRaw !== "undefined" ? bearerRaw : "";

  // 1) Bearer present: resolve primary session_token or admin user_sessions row.
  if (bearerToken) {
    const token = bearerToken;
    try {
      const resolved = await resolveUserBySessionToken(db, token);
      if (!resolved) {
        syncSessionUser(req, null);
        return null;
      }
      const u = resolved.row as Record<string, unknown>;
      if (u.is_blocked) {
        syncSessionUser(req, null);
        return null;
      }
      const authUser = rowsToAuthUser(u, token);
      syncSessionUser(req, authUser);
      return authUser;
    } catch (e) {
      console.error("[Auth] Bearer token lookup error:", e);
      return null;
    }
  }

  // 2) Cookie session only: must match current session (students: users.session_token;
  // admins: that token or any user_sessions token for this user).
  const sessionUser = (req.session as any).user as { id?: number; sessionToken?: string | null } | undefined;
  if (!sessionUser?.id) return null;

  try {
    const result = await db.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE id = $1",
      [sessionUser.id]
    );
    if (result.rows.length === 0) {
      syncSessionUser(req, null);
      return null;
    }
    const row = result.rows[0];
    if (row.is_blocked) {
      syncSessionUser(req, null);
      return null;
    }
    const cookieTok = sessionUser.sessionToken;
    if (cookieTok && !(await userHasSessionToken(db, sessionUser.id, cookieTok))) {
      syncSessionUser(req, null);
      return null;
    }
    if (row.session_token && !sessionUser.sessionToken) {
      syncSessionUser(req, null);
      return null;
    }

    const authUser = rowsToAuthUser(row, cookieTok || row.session_token);
    syncSessionUser(req, authUser);
    return authUser;
  } catch (e) {
    console.error("[Auth] Session user lookup error:", e);
    return null;
  }
}

