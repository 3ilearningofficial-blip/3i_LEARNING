import type { Express, Request, Response } from "express";
import { hashPassword, isScryptHash, verifyLegacySha256, verifyPassword } from "./password-utils";
import {
  assertLoginAllowedForInstallation,
  enforceInstallationBinding,
  finalizeStudentWebSlotsAfterAuth,
} from "./native-device-binding";
import { persistLoginSession, resolveUserBySessionToken, revokeSessionTokenForUser, userHasSessionToken } from "./user-sessions";
import { purgeStudentAccountById } from "./user-account-purge";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  sessionToken?: string;
  profileComplete?: boolean;
};

type RegisterAuthRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  generateOTP: () => string;
  hashOtpValue: (otp: string) => string;
  verifyOtpValue: (storedOtp: string | null | undefined, providedOtp: string) => boolean;
  generateSecureToken: () => string;
  sendOTPviaSMS: (phone: string, otp: string) => Promise<boolean>;
  verifyFirebaseToken: (idToken: string) => Promise<any>;
  runInTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
};

const GENERIC_LOGIN_ERROR = "Invalid credentials";
const GENERIC_OTP_ERROR = "Invalid or expired OTP";

/** Same fields as GET /api/auth/me so the client can show DOB, photo, etc. without a second fetch. */
function buildSessionUserFromRow(
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

/** Mitigate session fixation: new session id before attaching authenticated user. */
function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function normalizePhone(input: unknown): string {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export function registerAuthRoutes({
  app,
  db,
  getAuthUser,
  generateOTP,
  hashOtpValue,
  verifyOtpValue,
  generateSecureToken,
  sendOTPviaSMS,
  verifyFirebaseToken,
  runInTransaction,
}: RegisterAuthRoutesDeps): void {
  app.post("/api/auth/send-otp", async (req: Request, res: Response) => {
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }

      if (type === "phone") {
        const normalizedPhone = normalizePhone(identifier);
        if (!normalizedPhone || normalizedPhone.length !== 10) {
          return res.status(400).json({ message: "Valid phone number is required" });
        }
        await db.query(
          `INSERT INTO users (name, phone, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (phone) DO NOTHING`,
          [`Student${normalizedPhone.slice(-4)}`, normalizedPhone, "student"]
        );

        const lockRow = await db.query("SELECT otp_locked_until FROM users WHERE phone = $1", [normalizedPhone]);
        const lockedUntil = lockRow.rows[0]?.otp_locked_until != null ? Number(lockRow.rows[0].otp_locked_until) : 0;
        if (lockedUntil > Date.now()) {
          return res.status(429).json({ message: "Too many attempts. Please try again later." });
        }

        const otp = generateOTP();
        const otpHash = hashOtpValue(otp);
        const expires = Date.now() + 10 * 60 * 1000;
        await db.query(
          "UPDATE users SET otp = $1, otp_expires_at = $2, otp_failed_attempts = 0, otp_locked_until = NULL WHERE phone = $3",
          [otpHash, expires, normalizedPhone]
        );

        let smsSent = false;
        try {
          smsSent = await sendOTPviaSMS(normalizedPhone, otp);
        } catch (smsErr) {
          console.error("[OTP] SMS sending threw error:", smsErr);
        }
        if (!smsSent) {
          console.log("[OTP] SMS delivery failed, OTP stored in DB");
        }

        const isDev = process.env.NODE_ENV !== "production";
        return res.json({
          success: true,
          message: smsSent ? "OTP sent to your phone" : "OTP sent. If SMS is delayed, please wait 30 seconds and try again.",
          smsSent,
          devOtp: isDev ? otp : "",
        });
      }

      const email = String(identifier).trim().toLowerCase();
      const lockEmail = await db.query("SELECT otp_locked_until FROM users WHERE email = $1", [email]);
      const lockedUntilE = lockEmail.rows[0]?.otp_locked_until != null ? Number(lockEmail.rows[0].otp_locked_until) : 0;
      if (lockedUntilE > Date.now()) {
        return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }

      const otp = generateOTP();
      const otpHash = hashOtpValue(otp);
      const expires = Date.now() + 10 * 60 * 1000;
      await db.query(
        `INSERT INTO users (name, email, otp, otp_expires_at, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET otp = EXCLUDED.otp, otp_expires_at = EXCLUDED.otp_expires_at,
           otp_failed_attempts = 0, otp_locked_until = NULL`,
        [email.split("@")[0], email, otpHash, expires, "student"]
      );
      res.json({ success: true, message: "OTP sent successfully", method: "server" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });

  app.post("/api/auth/verify-otp", async (req: Request, res: Response) => {
    try {
      const { identifier, type, otp, deviceId } = req.body;
      if (!identifier || !otp) {
        return res.status(400).json({ message: "Identifier and OTP are required" });
      }

      const result =
        type === "email"
          ? await db.query("SELECT * FROM users WHERE email = $1", [identifier])
          : await db.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Account not found. Please register first." });
      }

      const user = result.rows[0];
      if (user.is_blocked) return res.status(401).json({ message: GENERIC_OTP_ERROR });
      const lockedUntil = user.otp_locked_until != null ? Number(user.otp_locked_until) : 0;
      if (lockedUntil > Date.now()) {
        return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }
      if (!verifyOtpValue(user.otp, otp)) {
        const lockMs = Date.now() + 15 * 60 * 1000;
        await db.query(
          `UPDATE users SET
             otp_failed_attempts = LEAST(COALESCE(otp_failed_attempts, 0) + 1, 99),
             otp_locked_until = CASE WHEN COALESCE(otp_failed_attempts, 0) + 1 >= 5 THEN $1 ELSE otp_locked_until END
           WHERE id = $2`,
          [lockMs, user.id]
        );
        return res.status(401).json({ message: GENERIC_OTP_ERROR });
      }
      if (Date.now() > Number(user.otp_expires_at)) return res.status(401).json({ message: GENERIC_OTP_ERROR });

      const loginGate = await assertLoginAllowedForInstallation(db, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: deviceId || null,
        phone: user.phone,
        email: user.email,
      });
      if (!loginGate.ok) {
        return res.status(loginGate.httpStatus).json({ message: loginGate.message });
      }

      const sessionToken = generateSecureToken();
      await persistLoginSession(db, user, sessionToken, deviceId || null, { clearOtp: true });
      await finalizeStudentWebSlotsAfterAuth(db, user.id, user.role, req);

      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      await regenerateSession(req);
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });

  app.post("/api/auth/verify-firebase", async (req: Request, res: Response) => {
    try {
      const { idToken, phone: phoneNumber, deviceId } = req.body;
      if (!idToken || !phoneNumber) {
        return res.status(400).json({ message: "ID token and phone are required" });
      }

      const decoded = await verifyFirebaseToken(idToken);
      const claimedPhone = normalizePhone(phoneNumber);
      const tokenPhone = normalizePhone(decoded.phone_number);
      if (!tokenPhone || !claimedPhone || tokenPhone !== claimedPhone) {
        return res.status(400).json({ message: "Phone number mismatch" });
      }

      let result = await db.query("SELECT * FROM users WHERE phone = $1", [claimedPhone]);
      if (result.rows.length === 0) {
        await db.query(
          "INSERT INTO users (name, phone, role) VALUES ($1, $2, $3)",
          [`Student${claimedPhone.slice(-4)}`, claimedPhone, "student"]
        );
        result = await db.query("SELECT * FROM users WHERE phone = $1", [claimedPhone]);
      }

      const user = result.rows[0];
      const loginGate = await assertLoginAllowedForInstallation(db, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: deviceId || null,
        phone: user.phone,
        email: user.email,
      });
      if (!loginGate.ok) {
        return res.status(loginGate.httpStatus).json({ message: loginGate.message });
      }

      const sessionToken = generateSecureToken();
      await persistLoginSession(db, user, sessionToken, deviceId || null, { clearOtp: true });
      await finalizeStudentWebSlotsAfterAuth(db, user.id, user.role, req);

      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      await regenerateSession(req);
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Firebase verify error:", err);
      res.status(400).json({ message: "Firebase verification failed" });
    }
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    const sessionUser = (req.session as any).user as { id: number; sessionToken?: string } | undefined;
    if (!sessionUser) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        try {
          const resolved = await resolveUserBySessionToken(db, token);
          if (resolved) {
            const row = resolved.row as Record<string, unknown>;
            if (row.is_blocked) return res.status(403).json({ message: "account_blocked" });
            const fresh = {
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              role: row.role,
              sessionToken: token,
              profileComplete: !!(row.profile_complete as boolean),
              date_of_birth: row.date_of_birth,
              photo_url: row.photo_url,
            };
            const bindBearer = await enforceInstallationBinding(db, req, row.id as number, row.role as string);
            if (!bindBearer) {
              (req.session as any).user = null;
              return res.status(401).json({ message: "device_binding_mismatch" });
            }
            await finalizeStudentWebSlotsAfterAuth(db, row.id as number, row.role as string, req);
            (req.session as any).user = fresh;
            return res.json(fresh);
          }
        } catch {
          // Invalid or expired bearer token
        }
        return res.status(401).json({ message: "Not authenticated" });
      }
      // No session cookie and no Authorization header: treat as anonymous (avoids noisy 401 in browser consoles).
      return res.status(200).json({});
    }
    try {
      const dbUser = await db.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url, is_blocked FROM users WHERE id = $1",
        [sessionUser.id]
      );
      if (dbUser.rows.length === 0) {
        (req.session as any).user = null;
        return res.status(401).json({ message: "account_deleted" });
      }
      const row = dbUser.rows[0];
      if (row.is_blocked) {
        (req.session as any).user = null;
        return res.status(403).json({ message: "account_blocked" });
      }
      const tok = sessionUser.sessionToken;
      if (tok && !(await userHasSessionToken(db, sessionUser.id, tok))) {
        (req.session as any).user = null;
        return res.status(401).json({ message: "logged_in_elsewhere" });
      }
      const bindSes = await enforceInstallationBinding(db, req, sessionUser.id, row.role);
      if (!bindSes) {
        (req.session as any).user = null;
        return res.status(401).json({ message: "device_binding_mismatch" });
      }
      await finalizeStudentWebSlotsAfterAuth(db, sessionUser.id, row.role, req);
      const effectiveToken = tok || row.session_token;
      const fresh = {
        ...sessionUser,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        sessionToken: effectiveToken,
        profileComplete: row.profile_complete || false,
        date_of_birth: row.date_of_birth,
        photo_url: row.photo_url,
      };
      (req.session as any).user = fresh;
      res.json(fresh);
    } catch {
      res.json(sessionUser);
    }
  });

  app.post("/api/auth/firebase-login", async (req: Request, res: Response) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) return res.status(400).json({ message: "Firebase ID token is required" });

      const decoded = await verifyFirebaseToken(idToken);
      const phoneNumber = decoded.phone_number;
      if (!phoneNumber) return res.status(400).json({ message: "Phone number not found in token" });

      const phone = phoneNumber.replace(/^\+91/, "");
      let result = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
      if (result.rows.length === 0) {
        result = await db.query(
          "INSERT INTO users (name, phone, role, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [`Student${phone.slice(-4)}`, phone, "student", Date.now()]
        );
      }

      const user = result.rows[0];
      const loginGate = await assertLoginAllowedForInstallation(db, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: deviceId || null,
        phone: user.phone,
        email: user.email,
      });
      if (!loginGate.ok) {
        return res.status(loginGate.httpStatus).json({ message: loginGate.message });
      }

      const sessionToken = generateSecureToken();
      await persistLoginSession(db, user, sessionToken, deviceId || null, { clearOtp: false });
      await finalizeStudentWebSlotsAfterAuth(db, user.id, user.role, req);

      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      await regenerateSession(req);
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err: any) {
      console.error("Firebase login error:", err);
      if (err.code === "auth/id-token-expired") {
        return res.status(401).json({ message: "Token expired, please try again" });
      }
      res.status(500).json({ message: "Authentication failed" });
    }
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    const cookie = req.session?.cookie;
    const sessionUser = (req.session as any)?.user as { id?: number; sessionToken?: string } | undefined;
    let revokeUserId = sessionUser?.id ? Number(sessionUser.id) : null;
    let revokeToken = sessionUser?.sessionToken || null;
    if (!revokeToken) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) revokeToken = authHeader.slice(7).trim();
    }
    if (!revokeUserId && revokeToken) {
      const resolved = await resolveUserBySessionToken(db, revokeToken).catch(() => null);
      if (resolved?.row?.id) revokeUserId = Number(resolved.row.id);
    }
    if (revokeUserId && revokeToken) {
      await revokeSessionTokenForUser(db, revokeUserId, revokeToken).catch(() => {});
    }
    try {
      await destroySession(req);
    } catch (err) {
      console.error("[auth] logout destroy failed:", err);
      return res.status(500).json({ message: "Logout failed" });
    }
    if (cookie) {
      res.clearCookie("connect.sid", {
        path: cookie.path || "/",
        httpOnly: cookie.httpOnly !== false,
        secure: !!cookie.secure,
        sameSite: cookie.sameSite as "lax" | "strict" | "none" | undefined,
        domain: cookie.domain,
      });
    } else {
      res.clearCookie("connect.sid", { path: "/" });
    }
    res.json({ success: true });
  });

  /** Student-only: permanently delete account and all related app data (GDPR-style erase). Admins cannot use this endpoint. */
  app.delete("/api/auth/account", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
      if (user.role === "admin") {
        return res.status(403).json({ message: "Admin accounts cannot be deleted here. Contact support." });
      }
      await runInTransaction((tx) => purgeStudentAccountById(tx, user.id));
      const cookie = req.session?.cookie;
      try {
        await destroySession(req);
      } catch {
        (req.session as any).user = null;
      }
      if (cookie) {
        res.clearCookie("connect.sid", {
          path: cookie.path || "/",
          httpOnly: cookie.httpOnly !== false,
          secure: !!cookie.secure,
          sameSite: cookie.sameSite as "lax" | "strict" | "none" | undefined,
          domain: cookie.domain,
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete account error:", err);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });

  app.post("/api/auth/email-login", async (req: Request, res: Response) => {
    try {
      const { email, password, deviceId } = req.body || {};
      if (!email || !password) return res.status(400).json({ message: "Phone/email and password are required" });

      const identifier = email.trim().toLowerCase();
      const isPhone = /^\d{10}$/.test(identifier);
      let result;
      if (isPhone) {
        result = await db.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      } else {
        result = await db.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [identifier]);
      }

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Account not found. Please register first." });
      }
      const user = result.rows[0];
      if (user.is_blocked) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      if (!user.profile_complete) {
        return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      }

      if (!user.password_hash) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      let matched = false;
      if (isScryptHash(user.password_hash)) {
        matched = await verifyPassword(password, user.password_hash);
      } else {
        matched = verifyLegacySha256(password, user.id, user.password_hash);
        if (matched) {
          const migratedHash = await hashPassword(password);
          await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [migratedHash, user.id]);
        }
      }
      if (!matched) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });

      const gate = await assertLoginAllowedForInstallation(db, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: typeof deviceId === "string" ? deviceId : null,
        phone: user.phone,
        email: user.email,
      });
      if (!gate.ok) {
        return res.status(gate.httpStatus).json({ message: gate.message });
      }

      const sessionToken = generateSecureToken();
      const dev = typeof deviceId === "string" ? deviceId : null;
      await persistLoginSession(db, user, sessionToken, dev, { clearOtp: false });
      await finalizeStudentWebSlotsAfterAuth(db, user.id, user.role, req);
      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: dev });
      await regenerateSession(req);
      (req.session as any).user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Email login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.put("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name, dateOfBirth, email, photoUrl, password } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });

      let passwordHash: string | null = null;
      if (password) {
        passwordHash = await hashPassword(password);
      }

      const updates: string[] = ["name = $1"];
      const params: unknown[] = [name];
      if (dateOfBirth !== undefined) { params.push(dateOfBirth || null); updates.push(`date_of_birth = $${params.length}`); }
      if (email !== undefined) { params.push(email || null); updates.push(`email = COALESCE($${params.length}, email)`); }
      if (photoUrl !== undefined) { params.push(photoUrl || null); updates.push(`photo_url = $${params.length}`); }
      if (passwordHash) { params.push(passwordHash); updates.push(`password_hash = $${params.length}`); }
      updates.push("profile_complete = TRUE");
      params.push(user.id);
      await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);

      const full = await db.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url FROM users WHERE id = $1",
        [user.id]
      );
      const row = full.rows[0];
      if (!row) {
        return res.status(500).json({ message: "Failed to load profile after update" });
      }
      const keepTok = user.sessionToken || row.session_token;
      const updated = buildSessionUserFromRow(row, {
        sessionToken: keepTok,
        deviceId: (user as { deviceId?: string }).deviceId,
      });
      (req.session as any).user = updated;
      res.json({ success: true, user: updated });
    } catch {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  app.post("/api/auth/change-password", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { oldPassword, newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }

      const dbUser = await db.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (dbUser.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const storedHash = dbUser.rows[0].password_hash as string | null;

      if (storedHash && !oldPassword) {
        return res.status(400).json({ message: "Current password is required" });
      }

      if (oldPassword && storedHash) {
        const validOld = isScryptHash(storedHash)
          ? await verifyPassword(oldPassword, storedHash)
          : verifyLegacySha256(oldPassword, user.id, storedHash);
        if (!validOld) {
          return res.status(401).json({ message: "Current password is incorrect" });
        }
      }

      const newHash = await hashPassword(newPassword);
      await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}

