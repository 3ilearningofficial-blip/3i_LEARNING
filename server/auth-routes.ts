import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPassword, isScryptHash, verifyLegacySha256, verifyPassword } from "./password-utils";
import {
  assertLoginAllowedForInstallation,
  bindDeviceForNativeFirstLogin,
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

// Per-user OTP send policy: min 2 minutes between sends; up to 3 OTP sends per
// cycle; after the 3rd successful send, lock further sends for 24h. (Counters
// reset when the 24h lock expires.)
const OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1000;
const OTP_SENDS_PER_CYCLE = 3;
const OTP_SEND_LOCK_MS = 24 * 60 * 60 * 1000;
const OTP_LOCKOUT_MESSAGE = "Too many OTP attempts. Please try again after 24 hours.";
const OTP_COOLDOWN_MESSAGE = "Please wait before requesting another OTP.";

// Short-lived registration token for OTP-verified phones that don't yet have a
// users row (issued by /api/auth/verify-otp, consumed by /api/auth/register-complete).
const REGISTRATION_TOKEN_TTL_MS = 15 * 60 * 1000;

function getTokenSecret(): string {
  return process.env.OTP_HMAC_SECRET || process.env.SESSION_SECRET || "dev-otp-secret";
}

function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

type RegistrationTokenPayload = {
  identifier: string;
  type: "phone" | "email";
  phone?: string;
  email?: string;
  exp: number;
};

function signRegistrationToken(payload: Omit<RegistrationTokenPayload, "exp">): string {
  const body: RegistrationTokenPayload = { ...payload, exp: Date.now() + REGISTRATION_TOKEN_TTL_MS };
  const b64 = toBase64Url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = toBase64Url(createHmac("sha256", getTokenSecret()).update(b64).digest());
  return `${b64}.${sig}`;
}

function verifyRegistrationToken(token: string | null | undefined): RegistrationTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = toBase64Url(createHmac("sha256", getTokenSecret()).update(b64).digest());
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const json = fromBase64Url(b64).toString("utf8");
    const obj = JSON.parse(json) as RegistrationTokenPayload;
    if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
    if (obj.type !== "phone" && obj.type !== "email") return null;
    if (typeof obj.identifier !== "string" || !obj.identifier) return null;
    return obj;
  } catch {
    return null;
  }
}

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

function normalizeEmail(input: unknown): string {
  return String(input || "").trim().toLowerCase();
}

type ThrottleSnapshot = {
  send_count: number;
  /** Millis of last accepted send-otp (cooldown anchor). */
  last_send_at: number | null;
  send_locked_until: number | null;
};

type ThrottleDecision =
  | {
      ok: true;
      nextCount: number;
      lastSendAt: number;
      /** When this send completes the 3rd OTP in the cycle, block further sends until this time. */
      newSendLockedUntil: number | null;
    }
  | { ok: false; lockedUntil: number; reason: "quota" | "cooldown" };

/**
 * Enforces: (1) active 24h lock → deny; (2) min 2 min between sends → deny with cooldown;
 * (3) at most 3 sends per cycle → after 3rd send, caller persists 24h lock.
 */
function evaluateOtpSendThrottle(snap: ThrottleSnapshot, now: number): ThrottleDecision {
  const lockedUntil = snap.send_locked_until != null ? Number(snap.send_locked_until) : null;
  if (lockedUntil != null && lockedUntil > now) {
    return { ok: false, lockedUntil, reason: "quota" };
  }
  const lastSend = snap.last_send_at != null ? Number(snap.last_send_at) : null;
  if (lastSend != null && now - lastSend < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, lockedUntil: lastSend + OTP_RESEND_COOLDOWN_MS, reason: "cooldown" };
  }
  let count = Number(snap.send_count) || 0;
  if (lockedUntil != null && lockedUntil <= now) {
    count = 0;
  }
  if (count >= OTP_SENDS_PER_CYCLE) {
    return { ok: false, lockedUntil: now + OTP_SEND_LOCK_MS, reason: "quota" };
  }
  const nextCount = count + 1;
  const newSendLockedUntil = nextCount >= OTP_SENDS_PER_CYCLE ? now + OTP_SEND_LOCK_MS : null;
  return { ok: true, nextCount, lastSendAt: now, newSendLockedUntil };
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
  const finalizeAuthenticatedSession = async (
    req: Request,
    user: Record<string, any>,
    deviceId: string | null | undefined,
    clearOtp: boolean
  ): Promise<{ success: true; user: ReturnType<typeof buildSessionUserFromRow> }> => {
    const sessionToken = generateSecureToken();
    const normalizedDeviceId = deviceId || null;
    await persistLoginSession(db, user as { id: number; role: string }, sessionToken, normalizedDeviceId, { clearOtp });
    await finalizeStudentWebSlotsAfterAuth(db, Number(user.id), String(user.role), req);
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
      const isDev = process.env.NODE_ENV !== "production";

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

        const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, true);
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
      if (!verifyOtpValue(ch.otp_hash, otp) || nowMs > Number(ch.otp_expires_at || 0)) {
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
      if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Phone/email and password are required" });
      }
      const identifier = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      if (!identifier || !normalizedPassword) {
        return res.status(400).json({ message: "Phone/email and password are required" });
      }

      console.log("[Auth] email-login: lookup start", { identifierType: /^\d{10}$/.test(identifier) ? "phone" : "email" });
      const isPhone = /^\d{10}$/.test(identifier);
      let result;
      if (isPhone) {
        result = await db.query("SELECT * FROM users WHERE phone = $1", [identifier]);
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
      const finalized = await finalizeAuthenticatedSession(req, user, dev, true);
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

      let passwordHash: string | null = null;
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
