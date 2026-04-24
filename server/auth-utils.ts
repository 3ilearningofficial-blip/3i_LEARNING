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

export async function getAuthUserFromRequest(req: Request, db: DbClient): Promise<AuthUser | null> {
  const sessionUser = (req.session as any).user;
  if (sessionUser?.id) return sessionUser;

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  if (!token || token === "null" || token === "undefined") return null;

  try {
    const result = await db.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE session_token = $1",
      [token]
    );
    if (result.rows.length === 0) return null;

    const u = result.rows[0];
    if (u.is_blocked) return null;

    const authUser: AuthUser = {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      sessionToken: u.session_token,
      profileComplete: u.profile_complete || false,
    };
    (req.session as any).user = authUser;
    return authUser;
  } catch (e) {
    console.error("[Auth] Bearer token lookup error:", e);
    return null;
  }
}

