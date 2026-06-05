import type { Express, Request, Response } from "express";
import { hashPassword, isScryptHash, verifyLegacySha256, verifyPassword } from "./password-utils";
import {
  GENERIC_LOGIN_ERROR,
  GENERIC_OTP_ERROR,
  OTP_LOCKOUT_MESSAGE,
  OTP_COOLDOWN_MESSAGE,
  signRegistrationToken,
  verifyRegistrationToken,
  buildSessionUserFromRow,
  regenerateSession,
  destroySession,
  normalizePhone,
  normalizeEmail,
  evaluateOtpSendThrottle,
} from "./auth-service";
import {
  assertActiveSessionPlatformMatches,
  assertLoginAllowedForInstallation,
  assertSessionNotActivelyInUse,
  bindDeviceForNativeFirstLogin,
  enforceInstallationBinding,
  getClientPlatform,
} from "./native-device-binding";
import {
  ADMIN_SESSION_MAX_AGE_MS,
  isSessionLastActiveValid,
  persistLoginSession,
  resolveUserBySessionToken,
  revokeSessionTokenForUser,
} from "./user-sessions";
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
  const finalizeAuthenticatedSession = async (
    req: Request,
    user: Record<string, any>,
    deviceId: string | null | undefined,
    clearOtp: boolean
  ): Promise<
    | { success: true; user: ReturnType<typeof buildSessionUserFromRow> }
    | { success: false; httpStatus: number; message: string }
  > => {
    const activeGuard = await assertSessionNotActivelyInUse(db, req, {
      userId: Number(user.id),
      role: user.role,
      bodyDeviceId: deviceId,
    });
    if (!activeGuard.ok) {
      return { success: false, httpStatus: activeGuard.httpStatus, message: activeGuard.message };
    }

    const sessionToken = generateSecureToken();
    const normalizedDeviceId = deviceId || null;
    await persistLoginSession(db, user as { id: number; role: string }, sessionToken, normalizedDeviceId, {
      clearOtp,
      req,
    });
    await bindDeviceForNativeFirstLogin(db, Number(user.id), String(user.role), req);

    const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: normalizedDeviceId });
    await regenerateSession(req);
    (req.session as any).user = sessionUser;
    return { success: true, user: sessionUser };
  };

  const registrationTokenPayloadResponse = (
    identifier: string,
    tokenType: "phone" | "email"
  ) => {
    const registrationToken = signRegistrationToken({
      identifier,
      type: tokenType,
      phone: tokenType === "phone" ? identifier : undefined,
      email: tokenType === "email" ? identifier : undefined,
    });
    return {
      success: true,
      registrationToken,
      profileComplete: false,
      identifier,
      type: tokenType,
    };
  };

  app.post("/api/auth/send-otp", async (req: Request, res: Response) => {
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }

      const isPhone = type === "phone";
      let normalizedIdentifier: string;
      if (isPhone) {
        normalizedIdentifier = normalizePhone(identifier);
        if (!normalizedIdentifier || normalizedIdentifier.length !== 10) {
          return res.status(400).json({ message: "Valid phone number is required" });
        }
      } else if (type === "email") {
        normalizedIdentifier = normalizeEmail(identifier);
        if (!normalizedIdentifier || !/.+@.+\..+/.test(normalizedIdentifier)) {
          return res.status(400).json({ message: "Valid email is required" });
        }
      } else {
        return res.status(400).json({ message: "Invalid identifier type" });
      }

      const now = Date.now();
      const otp = generateOTP();
      const otpHash = hashOtpValue(otp);
      const otpExpires = now + 10 * 60 * 1000;
      // OTP is ONLY returned in the response when both conditions are true:
      // 1. NODE_ENV is explicitly 'development' (not just "not production")
      // 2. EXPOSE_DEV_OTP=true is explicitly set in the environment
      // This double-guard ensures a misconfigured NODE_ENV in production never leaks OTPs.
      const isDev =
        process.env.NODE_ENV === "development" &&
        process.env.EXPOSE_DEV_OTP === "true";

      let lockedUntilForClient: number | null = null;

      // 1) If a users row already exists for this identifier, throttle + store OTP on that row.
      const userRow = isPhone
        ? await db.query(
            "SELECT id, otp_send_count, otp_send_window_start, otp_send_locked_until FROM users WHERE phone = $1",
            [normalizedIdentifier]
          )
        : await db.query(
            "SELECT id, otp_send_count, otp_send_window_start, otp_send_locked_until FROM users WHERE LOWER(email) = LOWER($1)",
            [normalizedIdentifier]
          );

      if (userRow.rows.length > 0) {
        const u = userRow.rows[0];
        let locked = u.otp_send_locked_until != null ? Number(u.otp_send_locked_until) : null;
        let count = Number(u.otp_send_count || 0);
        let lastSend = u.otp_send_window_start != null ? Number(u.otp_send_window_start) : null;

        if (locked != null && locked <= now) {
          await db.query(
            `UPDATE users SET otp_send_locked_until = NULL, otp_send_count = 0 WHERE id = $1`,
            [u.id]
          );
          locked = null;
          count = 0;
        }

        const decision = evaluateOtpSendThrottle(
          {
            send_count: count,
            last_send_at: lastSend,
            send_locked_until: locked,
          },
          now
        );

        if (!decision.ok) {
          const msg = decision.reason === "cooldown" ? OTP_COOLDOWN_MESSAGE : OTP_LOCKOUT_MESSAGE;
          return res.status(429).json({
            message: msg,
            lockedUntil: decision.lockedUntil,
            reason: decision.reason,
          });
        }

        await db.query(
          `UPDATE users SET
             otp = $1,
             otp_expires_at = $2,
             otp_failed_attempts = 0,
             otp_locked_until = NULL,
             otp_send_count = $3,
             otp_send_window_start = $4,
             otp_send_locked_until = $5
           WHERE id = $6`,
          [otpHash, otpExpires, decision.nextCount, decision.lastSendAt, decision.newSendLockedUntil, u.id]
        );
        lockedUntilForClient = decision.newSendLockedUntil;
      } else {
        // 2) No users row yet — throttle + store OTP on otp_challenges (no junk users row created).
        const challengeRow = await db.query(
          "SELECT send_count, send_window_start, send_locked_until FROM otp_challenges WHERE identifier = $1",
          [normalizedIdentifier]
        );
        let locked: number | null = null;
        let count = 0;
        let lastSend: number | null = null;
        if (challengeRow.rows.length > 0) {
          const r = challengeRow.rows[0];
          locked = r.send_locked_until != null ? Number(r.send_locked_until) : null;
          count = Number(r.send_count || 0);
          lastSend = r.send_window_start != null ? Number(r.send_window_start) : null;

          if (locked != null && locked <= now) {
            await db.query(
              `UPDATE otp_challenges SET send_locked_until = NULL, send_count = 0, updated_at = $2 WHERE identifier = $1`,
              [normalizedIdentifier, now]
            );
            locked = null;
            count = 0;
          }
        }

        const decision = evaluateOtpSendThrottle(
          {
            send_count: count,
            last_send_at: lastSend,
            send_locked_until: locked,
          },
          now
        );

        if (!decision.ok) {
          const msg = decision.reason === "cooldown" ? OTP_COOLDOWN_MESSAGE : OTP_LOCKOUT_MESSAGE;
          return res.status(429).json({
            message: msg,
            lockedUntil: decision.lockedUntil,
            reason: decision.reason,
          });
        }

        await db.query(
          `INSERT INTO otp_challenges
            (identifier, type, otp_hash, otp_expires_at, verify_failed_attempts, verify_locked_until,
             send_count, send_window_start, send_locked_until, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 0, NULL, $5, $6, $7, $8, $8)
           ON CONFLICT (identifier) DO UPDATE SET
             type = EXCLUDED.type,
             otp_hash = EXCLUDED.otp_hash,
             otp_expires_at = EXCLUDED.otp_expires_at,
             verify_failed_attempts = 0,
             verify_locked_until = NULL,
             send_count = EXCLUDED.send_count,
             send_window_start = EXCLUDED.send_window_start,
             send_locked_until = EXCLUDED.send_locked_until,
             updated_at = EXCLUDED.updated_at`,
          [
            normalizedIdentifier,
            type,
            otpHash,
            otpExpires,
            decision.nextCount,
            decision.lastSendAt,
            decision.newSendLockedUntil,
            now,
          ]
        );
        lockedUntilForClient = decision.newSendLockedUntil;
      }

      // SMS only goes out for phone identifiers; email-OTP is server-stored only.
      let smsSent = false;
      if (isPhone) {
        try {
          smsSent = await sendOTPviaSMS(normalizedIdentifier, otp);
        } catch (smsErr) {
          console.error("[OTP] SMS sending threw error:", smsErr);
        }
        if (!smsSent) {
          console.log("[OTP] SMS delivery failed, OTP stored in DB");
        }
      }

      return res.json({
        success: true,
        message: isPhone
          ? smsSent
            ? "OTP sent to your phone"
            : "OTP sent. If SMS is delayed, please wait 30 seconds and try again."
          : "OTP sent successfully",
        smsSent,
        devOtp: isDev ? otp : "",
        method: isPhone ? undefined : "server",
        lockedUntil: lockedUntilForClient,
      });
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

      const isPhone = type !== "email";
      const normalizedIdentifier = isPhone ? normalizePhone(identifier) : normalizeEmail(identifier);
      if (!normalizedIdentifier) {
        return res.status(400).json({ message: "Identifier and OTP are required" });
      }

      // 1) Existing users path — issues a real session (legacy flow).
      const result = isPhone
        ? await db.query("SELECT * FROM users WHERE phone = $1", [normalizedIdentifier])
        : await db.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [normalizedIdentifier]);

      if (result.rows.length > 0) {
        const user = result.rows[0];
        if (user.is_blocked) return res.status(401).json({ message: GENERIC_OTP_ERROR });
        const lockedUntil = user.otp_locked_until != null ? Number(user.otp_locked_until) : 0;
        if (lockedUntil > Date.now()) {
          return res.status(429).json({ message: "Too many attempts. Please try again later." });
        }
        // Check expiry FIRST — an expired OTP must not increment the fail counter
        // (incrementing on expiry causes premature lockouts for legitimate users).
        if (Date.now() > Number(user.otp_expires_at)) {
          return res.status(401).json({ message: GENERIC_OTP_ERROR });
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

        const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, true);
        if (!finalized.success) {
          return res.status(finalized.httpStatus).json({ message: finalized.message });
        }
        return res.json(finalized);
      }

      // 2) New-user path: verify against otp_challenges, then issue a short-lived
      //    registrationToken WITHOUT creating a session. Profile-setup will call
      //    /api/auth/register-complete which is when the users row is finally INSERTed.
      const chRow = await db.query(
        "SELECT type, otp_hash, otp_expires_at, verify_failed_attempts, verify_locked_until FROM otp_challenges WHERE identifier = $1",
        [normalizedIdentifier]
      );
      if (chRow.rows.length === 0) {
        return res.status(404).json({ message: "Account not found. Please register first." });
      }
      const ch = chRow.rows[0];
      const nowMs = Date.now();
      const verifyLockedUntil = ch.verify_locked_until != null ? Number(ch.verify_locked_until) : 0;
      if (verifyLockedUntil > nowMs) {
        return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }
      // Check expiry FIRST — expired OTPs must not increment fail counter.
      if (nowMs > Number(ch.otp_expires_at || 0)) {
        return res.status(401).json({ message: GENERIC_OTP_ERROR });
      }
      if (!verifyOtpValue(ch.otp_hash, otp)) {
        const failCount = Number(ch.verify_failed_attempts || 0) + 1;
        const lockUntil = failCount >= 5 ? nowMs + 15 * 60 * 1000 : null;
        await db.query(
          `UPDATE otp_challenges SET
             verify_failed_attempts = $1,
             verify_locked_until = COALESCE($2, verify_locked_until),
             updated_at = $3
           WHERE identifier = $4`,
          [failCount, lockUntil, nowMs, normalizedIdentifier]
        );
        return res.status(401).json({ message: GENERIC_OTP_ERROR });
      }

      // OTP ok: clear OTP fields but keep send-throttle counters so a malicious
      // verifier can't bypass the 24h lock by completing a verify.
      await db.query(
        `UPDATE otp_challenges SET
           otp_hash = NULL,
           otp_expires_at = NULL,
           verify_failed_attempts = 0,
           verify_locked_until = NULL,
           updated_at = $1
         WHERE identifier = $2`,
        [nowMs, normalizedIdentifier]
      );

      return res.json(registrationTokenPayloadResponse(normalizedIdentifier, isPhone ? "phone" : "email"));
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

      const result = await db.query("SELECT * FROM users WHERE phone = $1", [claimedPhone]);
      if (result.rows.length === 0) {
        // Brand-new user — don't create a row, hand back a registrationToken
        // and let profile-setup finish the registration.
        return res.json(registrationTokenPayloadResponse(claimedPhone, "phone"));
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

      const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, true);
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
      res.json(finalized);
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
            // Only a CONFIRMED different device ends the session. A missing
            // device-id header (device_id_missing) must not log out an active
            // student — see getAuthUser in routes.ts for the full rationale.
            if (!bindBearer.ok && bindBearer.code === "device_binding_mismatch") {
              (req.session as any).user = null;
              return res.status(401).json({ message: bindBearer.code });
            }
            const platBearer = await assertActiveSessionPlatformMatches(db, req, row.id as number, row.role as string);
            if (!platBearer.ok) {
              (req.session as any).user = null;
              return res.status(401).json({
                message: "active_on_other_platform",
                activePlatform: platBearer.activePlatform,
              });
            }
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
      // Include the extra columns needed for inline session-token validation so we
      // can skip the second DB query that userHasSessionToken() would otherwise make.
      const dbUser = await db.query(
        `SELECT id, name, email, phone, role, session_token, profile_complete,
                date_of_birth, photo_url, is_blocked,
                last_active_at, app_bound_device_id
         FROM users WHERE id = $1`,
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
      // BUG-10 fix: validate session token inline using the row we already fetched.
      // Logic mirrors userHasSessionToken + isSessionLastActiveValid in user-sessions.ts.
      if (tok) {
        const isActive = isSessionLastActiveValid(row);
        const primaryMatches = row.session_token === tok && isActive;
        if (!primaryMatches) {
          if (row.role === "admin") {
            // Admins support multiple concurrent sessions stored in user_sessions table.
            // Fall back to that table only when the primary token doesn't match (rare).
            const minAge = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
            const sess = await db.query(
              "SELECT 1 FROM user_sessions WHERE user_id = $1 AND session_token = $2 AND created_at >= $3",
              [sessionUser.id, tok, minAge]
            );
            if (sess.rows.length === 0) {
              (req.session as any).user = null;
              return res.status(401).json({ message: "logged_in_elsewhere" });
            }
          } else {
            (req.session as any).user = null;
            return res.status(401).json({ message: "logged_in_elsewhere" });
          }
        }
      }
      const bindSes = await enforceInstallationBinding(db, req, sessionUser.id, row.role);
      // Only a CONFIRMED different device ends the session. A missing device-id
      // header (device_id_missing) must not log out an active student — see
      // getAuthUser in routes.ts for the full rationale.
      if (!bindSes.ok && bindSes.code === "device_binding_mismatch") {
        (req.session as any).user = null;
        return res.status(401).json({ message: bindSes.code });
      }
      const platSes = await assertActiveSessionPlatformMatches(db, req, sessionUser.id, row.role);
      if (!platSes.ok) {
        (req.session as any).user = null;
        return res.status(401).json({
          message: "active_on_other_platform",
          activePlatform: platSes.activePlatform,
        });
      }
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
    } catch (err) {
      console.error("[auth/me] session validation failed:", err);
      (req.session as any).user = null;
      return res.status(503).json({ message: "Unable to validate session" });
    }
  });

  app.post("/api/auth/firebase-login", async (req: Request, res: Response) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) return res.status(400).json({ message: "Firebase ID token is required" });

      const decoded = await verifyFirebaseToken(idToken);
      const phoneNumber = decoded.phone_number;
      if (!phoneNumber) return res.status(400).json({ message: "Phone number not found in token" });

      const phone = normalizePhone(phoneNumber);
      if (!phone || phone.length < 10) {
        return res.status(400).json({ message: "Invalid phone number in token" });
      }
      const result = await db.query("SELECT * FROM users WHERE phone = $1", [phone]);
      if (result.rows.length === 0) {
        return res.json(registrationTokenPayloadResponse(phone, "phone"));
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

      const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, false);
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
      res.json(finalized);
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
    let preserveStudentWebLock = false;
    if (revokeUserId) {
      const roleResult = await db
        .query("SELECT role FROM users WHERE id = $1", [revokeUserId])
        .catch(() => ({ rows: [] }));
      preserveStudentWebLock =
        String(roleResult.rows[0]?.role || "").toLowerCase() !== "admin" && getClientPlatform(req) === "web";
    }
    if (revokeUserId && revokeToken && !preserveStudentWebLock) {
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
      if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Phone/email and password are required" });
      }
      const identifier = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      if (!identifier || !normalizedPassword) {
        return res.status(400).json({ message: "Phone/email and password are required" });
      }

      // Accept a phone with formatting/country code (e.g. "+91 98765 43210"):
      // strip non-digits and, if it's a 10-13 digit number and not an email,
      // match on the last 10 digits. Otherwise treat the identifier as an email.
      const digitsOnly = identifier.replace(/\D/g, "");
      const phoneCandidate =
        !identifier.includes("@") && digitsOnly.length >= 10 && digitsOnly.length <= 13
          ? digitsOnly.slice(-10)
          : "";
      const isPhone = phoneCandidate.length === 10;
      console.log("[Auth] email-login: lookup start", { identifierType: isPhone ? "phone" : "email" });
      let result;
      if (isPhone) {
        result = await db.query("SELECT * FROM users WHERE phone = $1", [phoneCandidate]);
      } else {
        result = await db.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [identifier]);
      }

      if (result.rows.length === 0) {
        // No row at all — definitely not registered. Tell the client to send to signup.
        return res.status(404).json({ message: "register_first" });
      }
      const user = result.rows[0];
      if (user.is_blocked) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      if (!user.profile_complete) {
        // Legacy unfinished registration (pre-0014 migration). Send them back to
        // signup so they can complete profile-setup.
        return res.status(401).json({ message: "complete_registration" });
      }

      if (!user.password_hash) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      let matched = false;
      try {
        console.log("[Auth] email-login: verify start", { userId: user.id, hashType: isScryptHash(user.password_hash) ? "scrypt" : "legacy" });
        if (isScryptHash(user.password_hash)) {
          matched = await verifyPassword(normalizedPassword, user.password_hash);
        } else {
          matched = verifyLegacySha256(normalizedPassword, user.id, user.password_hash);
          if (matched) {
            const migratedHash = await hashPassword(normalizedPassword);
            await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [migratedHash, user.id]);
          }
        }
      } catch (verifyErr) {
        console.warn("[Auth] email-login: password verification failed with malformed hash/user data", {
          userId: user.id,
          error: verifyErr instanceof Error ? verifyErr.message : "unknown_error",
        });
        return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      }
      if (!matched) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });

      console.log("[Auth] email-login: device gate start", { userId: user.id });
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

      const dev = typeof deviceId === "string" ? deviceId : null;
      console.log("[Auth] email-login: finalize session start", { userId: user.id });
      const finalized = await finalizeAuthenticatedSession(req, user, dev, false);
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
      res.json(finalized);
    } catch (err) {
      console.error("Email login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });

  /**
   * Final step of new-user registration: consume the registrationToken (issued
   * by /api/auth/verify-otp or /api/auth/verify-firebase), create the users row
   * with the profile fields the student typed on /profile-setup, and start a
   * session. This is the ONLY path that creates a fresh students row now —
   * /api/auth/send-otp no longer touches `users`.
   */
  app.post("/api/auth/register-complete", async (req: Request, res: Response) => {
    try {
      const { registrationToken, name, dateOfBirth, email, photoUrl, password, deviceId } = req.body || {};
      const payload = verifyRegistrationToken(registrationToken);
      if (!payload) {
        return res.status(401).json({ message: "registration_token_invalid" });
      }
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (!normalizedName) {
        return res.status(400).json({ message: "Name is required" });
      }

      const isPhoneFlow = payload.type === "phone";
      const phone = isPhoneFlow ? payload.identifier : null;
      const tokenEmail = isPhoneFlow ? null : payload.identifier;

      // Pre-flight conflict checks: someone may have raced and registered with
      // the same identifier between OTP verify and profile save.
      const existingByIdentifier = phone
        ? await db.query("SELECT id FROM users WHERE phone = $1", [phone])
        : await db.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [tokenEmail!]);
      if (existingByIdentifier.rows.length > 0) {
        return res.status(409).json({ message: "Account already exists for this phone/email. Please sign in." });
      }

      const finalEmail = (typeof email === "string" && email.trim().length > 0)
        ? email.trim().toLowerCase()
        : tokenEmail;
      if (finalEmail) {
        const conflict = await db.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [finalEmail]);
        if (conflict.rows.length > 0) {
          return res.status(409).json({ message: "This email is already in use. Use a different email or sign in." });
        }
      }

      if (typeof password === "string" && password.length > 0 && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }

      const passwordHash = password ? await hashPassword(password) : null;
      const photo = typeof photoUrl === "string" && photoUrl.length > 0 ? photoUrl : null;
      const dob = typeof dateOfBirth === "string" && dateOfBirth.length > 0 ? dateOfBirth : null;
      const now = Date.now();

      const inserted = await db.query(
        `INSERT INTO users
          (name, email, phone, role, profile_complete, date_of_birth, photo_url, password_hash, created_at, last_active_at)
         VALUES ($1, $2, $3, 'student', TRUE, $4, $5, $6, $7, $7)
         RETURNING *`,
        [normalizedName, finalEmail, phone, dob, photo, passwordHash, now]
      );
      const user = inserted.rows[0];

      // Clean up the one-shot challenge so it can't be reused.
      await db
        .query("DELETE FROM otp_challenges WHERE identifier = $1", [payload.identifier])
        .catch(() => {});

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

      const dev = typeof deviceId === "string" ? deviceId : null;
      let finalized: Awaited<ReturnType<typeof finalizeAuthenticatedSession>>;
      try {
        finalized = await finalizeAuthenticatedSession(req, user, dev, true);
      } catch (finalizeErr) {
        // Session finalization threw — user row was already inserted. Clean up the
        // otp_challenges row so it cannot be replayed (defensive: the DELETE above
        // already ran, but guard against future re-ordering).
        await db
          .query("DELETE FROM otp_challenges WHERE identifier = $1", [payload.identifier])
          .catch(() => {});
        throw finalizeErr;
      }
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
      const refreshed = await db.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url FROM users WHERE id = $1",
        [user.id]
      );
      const row = refreshed.rows[0] || user;
      // Keep response aligned with fresh DB row while preserving the active
      // session token/device id established above.
      const responseUser = {
        ...finalized.user,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        profileComplete: !!row.profile_complete,
        date_of_birth: row.date_of_birth ?? null,
        photo_url: row.photo_url ?? null,
      };
      (req.session as any).user = responseUser;
      res.json({ success: true, user: responseUser });
    } catch (err) {
      console.error("Register-complete error:", err);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });

  app.put("/api/auth/profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name, dateOfBirth, email, photoUrl, password } = req.body;
      const normalizedName = typeof name === "string" ? name.trim() : undefined;
      if (name !== undefined && !normalizedName) return res.status(400).json({ message: "Name is required" });
      if (
        normalizedName === undefined &&
        dateOfBirth === undefined &&
        email === undefined &&
        photoUrl === undefined &&
        !password
      ) {
        return res.status(400).json({ message: "No profile fields provided" });
      }

      // If a new email is provided, verify it isn't already taken by another account.
      if (email !== undefined && email) {
        const normalizedNewEmail = String(email).trim().toLowerCase();
        const emailConflict = await db.query(
          "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2",
          [normalizedNewEmail, user.id]
        );
        if (emailConflict.rows.length > 0) {
          return res.status(409).json({ message: "This email is already in use by another account" });
        }
      }

      let passwordHash: string | null = null;
      if (typeof password === "string" && password.length > 0 && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      if (password) {
        passwordHash = await hashPassword(password);
      }

      const updates: string[] = [];
      const params: unknown[] = [];
      if (normalizedName !== undefined) {
        params.push(normalizedName);
        updates.push(`name = $${params.length}`);
      }
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
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
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
