var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/firebase.ts
import * as admin from "firebase-admin";
function getFirebaseAdmin() {
  if (firebaseApp) return firebaseApp;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not set");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON format");
  }
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  return firebaseApp;
}
async function verifyFirebaseToken(idToken) {
  const app2 = getFirebaseAdmin();
  return admin.auth(app2).verifyIdToken(idToken);
}
var firebaseApp;
var init_firebase = __esm({
  "server/firebase.ts"() {
    "use strict";
    firebaseApp = null;
  }
});

// server/razorpay.ts
import crypto from "crypto";
import { createRequire } from "module";
function getRazorpay() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required");
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
}
function verifyPaymentSignature(orderId, paymentId, signature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) return false;
  const body = orderId + "|" + paymentId;
  const expectedSignature = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
  return expectedSignature === signature;
}
var require2, Razorpay;
var init_razorpay = __esm({
  "server/razorpay.ts"() {
    "use strict";
    require2 = createRequire(import.meta.url);
    Razorpay = require2("razorpay");
  }
});

// server/security-utils.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
function generateSecureToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}
function hashOtpValue(otp) {
  const secret = process.env.OTP_HMAC_SECRET || process.env.SESSION_SECRET || "dev-otp-secret";
  return createHmac("sha256", secret).update(otp).digest("hex");
}
function verifyOtpValue(storedOtp, providedOtp) {
  if (!storedOtp || !providedOtp) return false;
  const hashedProvided = hashOtpValue(providedOtp);
  try {
    const storedBuffer = Buffer.from(storedOtp, "utf8");
    const providedBuffer = Buffer.from(hashedProvided, "utf8");
    if (storedBuffer.length === providedBuffer.length) {
      return timingSafeEqual(storedBuffer, providedBuffer);
    }
  } catch {
  }
  return storedOtp === providedOtp;
}
var init_security_utils = __esm({
  "server/security-utils.ts"() {
    "use strict";
  }
});

// server/auth-utils.ts
async function getAuthUserFromRequest(req, db2) {
  const sessionUser = req.session.user;
  if (sessionUser?.id) return sessionUser;
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token === "null" || token === "undefined") return null;
  try {
    const result = await db2.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE session_token = $1",
      [token]
    );
    if (result.rows.length === 0) return null;
    const u = result.rows[0];
    if (u.is_blocked) return null;
    const authUser = {
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role,
      sessionToken: u.session_token,
      profileComplete: u.profile_complete || false
    };
    req.session.user = authUser;
    return authUser;
  } catch (e) {
    console.error("[Auth] Bearer token lookup error:", e);
    return null;
  }
}
var init_auth_utils = __esm({
  "server/auth-utils.ts"() {
    "use strict";
  }
});

// server/password-utils.ts
import { randomBytes as randomBytes2, pbkdf2 as pbkdf2Cb, timingSafeEqual as timingSafeEqual2, createHash } from "crypto";
import { promisify } from "util";
function toHex(input) {
  return Buffer.isBuffer(input) ? input.toString("hex") : Buffer.from(input).toString("hex");
}
function isScryptHash(hash) {
  return typeof hash === "string" && (hash.startsWith("scrypt$") || hash.startsWith("pbkdf2$"));
}
async function hashPassword(password) {
  const salt = randomBytes2(16);
  const derived = await pbkdf2Async(password, salt, PBKDF2_ITERATIONS, KEY_LEN, "sha512");
  return `pbkdf2$${PBKDF2_ITERATIONS}$sha512$${toHex(salt)}$${toHex(derived)}`;
}
async function verifyPassword(password, storedHash) {
  if (!isScryptHash(storedHash)) return false;
  const parts = storedHash.split("$");
  if (parts[0] === "pbkdf2") {
    if (parts.length !== 5) return false;
    const [, iterStr, digest, saltHex, hashHex] = parts;
    const iterations = Number(iterStr);
    if (!Number.isFinite(iterations) || !digest || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(hashHex, "hex");
    const derived = await pbkdf2Async(password, salt, iterations, expected.length, digest);
    if (derived.length !== expected.length) return false;
    return timingSafeEqual2(derived, expected);
  }
  return false;
}
function verifyLegacySha256(password, userId, storedHash) {
  const withUserId = createHash("sha256").update(password + String(userId)).digest("hex");
  const plain = createHash("sha256").update(password).digest("hex");
  return storedHash === withUserId || storedHash === plain;
}
var pbkdf2Async, PBKDF2_ITERATIONS, KEY_LEN;
var init_password_utils = __esm({
  "server/password-utils.ts"() {
    "use strict";
    pbkdf2Async = promisify(pbkdf2Cb);
    PBKDF2_ITERATIONS = 21e4;
    KEY_LEN = 64;
  }
});

// server/auth-routes.ts
function buildSessionUserFromRow(row, opts) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    deviceId: opts.deviceId,
    sessionToken: opts.sessionToken,
    profileComplete: !!row.profile_complete,
    date_of_birth: row.date_of_birth ?? null,
    photo_url: row.photo_url ?? null
  };
}
function registerAuthRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  generateOTP: generateOTP2,
  hashOtpValue: hashOtpValue2,
  verifyOtpValue: verifyOtpValue2,
  generateSecureToken: generateSecureToken2,
  sendOTPviaSMS: sendOTPviaSMS2,
  verifyFirebaseToken: verifyFirebaseToken2,
  adminEmails,
  adminPhones
}) {
  app2.post("/api/auth/send-otp", async (req, res) => {
    console.log("OTP request received:", req.body);
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }
      if (type === "phone") {
        const existing2 = await db2.query("SELECT id FROM users WHERE phone = $1", [identifier]);
        if (existing2.rows.length === 0) {
          await db2.query(
            "INSERT INTO users (name, phone, role) VALUES ($1, $2, $3)",
            [`Student${identifier.slice(-4)}`, identifier, adminPhones.includes(identifier) ? "admin" : "student"]
          );
        }
        const otp2 = generateOTP2();
        const otpHash2 = hashOtpValue2(otp2);
        const expires2 = Date.now() + 10 * 60 * 1e3;
        await db2.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE phone = $3", [otpHash2, expires2, identifier]);
        let smsSent = false;
        try {
          smsSent = await sendOTPviaSMS2(identifier, otp2);
        } catch (smsErr) {
          console.error(`[OTP] SMS sending threw error for ${identifier}:`, smsErr);
        }
        if (!smsSent) {
          console.log(`[OTP] SMS delivery failed for ${identifier}, OTP stored in DB`);
        }
        const isDev = process.env.NODE_ENV !== "production";
        return res.json({
          success: true,
          message: smsSent ? "OTP sent to your phone" : "OTP sent. If SMS is delayed, please wait 30 seconds and try again.",
          smsSent,
          devOtp: isDev ? otp2 : ""
        });
      }
      const otp = generateOTP2();
      const otpHash = hashOtpValue2(otp);
      const expires = Date.now() + 10 * 60 * 1e3;
      const existing = await db2.query("SELECT id FROM users WHERE email = $1", [identifier]);
      if (existing.rows.length === 0) {
        await db2.query(
          "INSERT INTO users (name, email, otp, otp_expires_at, role) VALUES ($1, $2, $3, $4, $5)",
          [identifier.split("@")[0], identifier, otpHash, expires, adminEmails.includes(identifier) ? "admin" : "student"]
        );
      } else {
        await db2.query("UPDATE users SET otp = $1, otp_expires_at = $2 WHERE email = $3", [otpHash, expires, identifier]);
      }
      res.json({ success: true, message: "OTP sent successfully", method: "server" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to send OTP" });
    }
  });
  app2.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const { identifier, type, otp, deviceId } = req.body;
      if (!identifier || !otp) {
        return res.status(400).json({ message: "Identifier and OTP are required" });
      }
      const result = type === "email" ? await db2.query("SELECT * FROM users WHERE email = $1", [identifier]) : await db2.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      if (result.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const user = result.rows[0];
      if (user.is_blocked) return res.status(403).json({ message: "Your account has been blocked. Please contact support." });
      if (!verifyOtpValue2(user.otp, otp)) return res.status(400).json({ message: "Invalid OTP" });
      if (Date.now() > Number(user.otp_expires_at)) return res.status(400).json({ message: "OTP expired" });
      const sessionToken = generateSecureToken2();
      await db2.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4", [deviceId || null, sessionToken, Date.now(), user.id]);
      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      req.session.user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  });
  app2.post("/api/auth/verify-firebase", async (req, res) => {
    try {
      const { idToken, phone: phoneNumber, deviceId } = req.body;
      if (!idToken || !phoneNumber) {
        return res.status(400).json({ message: "ID token and phone are required" });
      }
      const decoded = await verifyFirebaseToken2(idToken);
      if (!decoded.phone_number || !decoded.phone_number.endsWith(phoneNumber)) {
        return res.status(400).json({ message: "Phone number mismatch" });
      }
      let result = await db2.query("SELECT * FROM users WHERE phone = $1", [phoneNumber]);
      if (result.rows.length === 0) {
        await db2.query(
          "INSERT INTO users (name, phone, role) VALUES ($1, $2, $3)",
          [`Student${phoneNumber.slice(-4)}`, phoneNumber, adminPhones.includes(phoneNumber) ? "admin" : "student"]
        );
        result = await db2.query("SELECT * FROM users WHERE phone = $1", [phoneNumber]);
      }
      const user = result.rows[0];
      const sessionToken = generateSecureToken2();
      await db2.query("UPDATE users SET otp = NULL, otp_expires_at = NULL, device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4", [deviceId || null, sessionToken, Date.now(), user.id]);
      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      req.session.user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Firebase verify error:", err);
      res.status(400).json({ message: "Firebase verification failed" });
    }
  });
  app2.get("/api/auth/me", async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        try {
          const dbUser = await db2.query(
            "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url, is_blocked FROM users WHERE session_token = $1",
            [token]
          );
          if (dbUser.rows.length > 0) {
            const row = dbUser.rows[0];
            if (row.is_blocked) return res.status(403).json({ message: "account_blocked" });
            const fresh = {
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              role: row.role,
              sessionToken: row.session_token,
              profileComplete: row.profile_complete || false,
              date_of_birth: row.date_of_birth,
              photo_url: row.photo_url
            };
            req.session.user = fresh;
            return res.json(fresh);
          }
        } catch {
        }
      }
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      const dbUser = await db2.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url, is_blocked FROM users WHERE id = $1",
        [sessionUser.id]
      );
      if (dbUser.rows.length === 0) {
        req.session.user = null;
        return res.status(401).json({ message: "account_deleted" });
      }
      const row = dbUser.rows[0];
      if (row.is_blocked) {
        req.session.user = null;
        return res.status(403).json({ message: "account_blocked" });
      }
      if (sessionUser.sessionToken && row.session_token !== sessionUser.sessionToken) {
        req.session.user = null;
        return res.status(401).json({ message: "logged_in_elsewhere" });
      }
      const fresh = {
        ...sessionUser,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        sessionToken: row.session_token,
        profileComplete: row.profile_complete || false,
        date_of_birth: row.date_of_birth,
        photo_url: row.photo_url
      };
      req.session.user = fresh;
      res.json(fresh);
    } catch {
      res.json(sessionUser);
    }
  });
  app2.post("/api/auth/firebase-login", async (req, res) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) return res.status(400).json({ message: "Firebase ID token is required" });
      const decoded = await verifyFirebaseToken2(idToken);
      const phoneNumber = decoded.phone_number;
      if (!phoneNumber) return res.status(400).json({ message: "Phone number not found in token" });
      const phone = phoneNumber.replace(/^\+91/, "");
      let result = await db2.query("SELECT * FROM users WHERE phone = $1", [phone]);
      if (result.rows.length === 0) {
        const role = adminPhones.includes(phone) ? "admin" : "student";
        result = await db2.query(
          "INSERT INTO users (name, phone, role, created_at) VALUES ($1, $2, $3, $4) RETURNING *",
          [`Student${phone.slice(-4)}`, phone, role, Date.now()]
        );
      }
      const user = result.rows[0];
      const sessionToken = generateSecureToken2();
      await db2.query("UPDATE users SET device_id = $1, session_token = $2 WHERE id = $3", [deviceId || null, sessionToken, user.id]);
      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: deviceId || null });
      req.session.user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Firebase login error:", err);
      if (err.code === "auth/id-token-expired") {
        return res.status(401).json({ message: "Token expired, please try again" });
      }
      res.status(500).json({ message: "Authentication failed" });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    req.session.user = null;
    res.json({ success: true });
  });
  app2.post("/api/auth/email-login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ message: "Phone/email and password are required" });
      const identifier = email.trim().toLowerCase();
      const isPhone = /^\d{10}$/.test(identifier);
      let result;
      if (isPhone) {
        result = await db2.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      } else {
        result = await db2.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [identifier]);
      }
      if (result.rows.length === 0) return res.status(404).json({ message: "Account not found. Please sign up first." });
      const user = result.rows[0];
      if (user.is_blocked) return res.status(403).json({ message: "Your account has been blocked. Please contact support." });
      if (!user.profile_complete) {
        return res.status(401).json({ message: "Profile not complete. Please sign in with Phone OTP to complete your profile first." });
      }
      if ((adminEmails.includes(identifier) || adminPhones.includes(identifier)) && user.role !== "admin") {
        await db2.query("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
        user.role = "admin";
      }
      if (!user.password_hash) return res.status(401).json({ message: "No password set. Please use Phone OTP to sign in, then set a password in Profile." });
      let matched = false;
      if (isScryptHash(user.password_hash)) {
        matched = await verifyPassword(password, user.password_hash);
      } else {
        matched = verifyLegacySha256(password, user.id, user.password_hash);
        if (matched) {
          const migratedHash = await hashPassword(password);
          await db2.query("UPDATE users SET password_hash = $1 WHERE id = $2", [migratedHash, user.id]);
        }
      }
      if (!matched) return res.status(401).json({ message: "Incorrect password. Try again or use Phone OTP." });
      const sessionToken = generateSecureToken2();
      await db2.query("UPDATE users SET session_token = $1, last_active_at = $2 WHERE id = $3", [sessionToken, Date.now(), user.id]);
      const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: null });
      req.session.user = sessionUser;
      res.json({ success: true, user: sessionUser });
    } catch (err) {
      console.error("Email login error:", err);
      res.status(500).json({ message: "Login failed" });
    }
  });
  app2.put("/api/auth/profile", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name, dateOfBirth, email, photoUrl, password } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      let passwordHash = null;
      if (password) {
        passwordHash = await hashPassword(password);
      }
      const updates = ["name = $1"];
      const params = [name];
      if (dateOfBirth !== void 0) {
        params.push(dateOfBirth || null);
        updates.push(`date_of_birth = $${params.length}`);
      }
      if (email !== void 0) {
        params.push(email || null);
        updates.push(`email = COALESCE($${params.length}, email)`);
      }
      if (photoUrl !== void 0) {
        params.push(photoUrl || null);
        updates.push(`photo_url = $${params.length}`);
      }
      if (passwordHash) {
        params.push(passwordHash);
        updates.push(`password_hash = $${params.length}`);
      }
      updates.push("profile_complete = TRUE");
      params.push(user.id);
      await db2.query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      const full = await db2.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url FROM users WHERE id = $1",
        [user.id]
      );
      const row = full.rows[0];
      if (!row) {
        return res.status(500).json({ message: "Failed to load profile after update" });
      }
      const updated = buildSessionUserFromRow(row, { sessionToken: row.session_token, deviceId: user.deviceId });
      req.session.user = updated;
      res.json({ success: true, user: updated });
    } catch {
      res.status(500).json({ message: "Failed to update profile" });
    }
  });
  app2.post("/api/auth/change-password", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { oldPassword, newPassword } = req.body;
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "New password must be at least 6 characters" });
      }
      const dbUser = await db2.query("SELECT password_hash FROM users WHERE id = $1", [user.id]);
      if (dbUser.rows.length === 0) return res.status(404).json({ message: "User not found" });
      if (oldPassword) {
        const storedHash = dbUser.rows[0].password_hash;
        const validOld = isScryptHash(storedHash) ? await verifyPassword(oldPassword, storedHash) : verifyLegacySha256(oldPassword, user.id, storedHash);
        if (!validOld) {
          return res.status(401).json({ message: "Current password is incorrect" });
        }
      }
      const newHash = await hashPassword(newPassword);
      await db2.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, user.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to change password" });
    }
  });
}
var init_auth_routes = __esm({
  "server/auth-routes.ts"() {
    "use strict";
    init_password_utils();
  }
});

// server/pdf-routes.ts
import * as http from "node:http";
import * as https from "node:https";
function registerPdfRoutes({ app: app2, db: db2 }) {
  app2.get("/api/pdf-viewer", async (req, res) => {
    const { token, key } = req.query;
    if (!token || !key || typeof token !== "string" || typeof key !== "string") {
      return res.status(400).send("Missing token or key");
    }
    const tokenResult = await db2.query(
      "SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3",
      [token, Date.now(), key]
    ).catch(() => ({ rows: [] }));
    if (!tokenResult.rows.length) {
      return res.status(401).send("Token expired or invalid");
    }
    const origin = `${req.headers["x-forwarded-proto"] || req.protocol}://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const pdfUrl = `${origin}/api/media/${key}?token=${token}`;
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
<meta name="robots" content="noindex,nofollow">
<title>PDF Viewer</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#2a2a2a;overflow:auto;font-family:-apple-system,sans-serif;-webkit-overflow-scrolling:touch;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#viewer{width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 0 16px}
.page-canvas{display:block;max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,0.3);background:#fff;pointer-events:none}
.loading{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#ccc;background:#2a2a2a;z-index:10}
.spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.1);border-top:3px solid #1A56DB;border-radius:50%;animation:spin 0.8s linear infinite}
.page-info{color:#888;font-size:12px;padding:4px 0}
.error{position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:#ccc;padding:32px;text-align:center;background:#2a2a2a;z-index:20}
.error h3{font-size:18px;color:#fff}.error p{font-size:13px;color:#999;line-height:1.5}
@keyframes spin{to{transform:rotate(360deg)}}
@media print{body{display:none!important}}
</style>
</head><body>
<div id="loading" class="loading"><div class="spinner"></div><p>Loading PDF...</p></div>
<div id="viewer"></div>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
(function(){
  var pdfUrl=${JSON.stringify(pdfUrl)};
  function renderPdf(url){
    return pdfjsLib.getDocument({url:url,withCredentials:true}).promise.then(function(pdf){
      document.getElementById('loading').style.display='none';
      var viewer=document.getElementById('viewer');
      viewer.innerHTML='';
      var n=pdf.numPages;
      function renderPage(num){
        pdf.getPage(num).then(function(page){
          var w=Math.min(window.innerWidth-16,900);
          var vp=page.getViewport({scale:1});
          var scale=w/vp.width;
          var svp=page.getViewport({scale:scale*2});
          var canvas=document.createElement('canvas');
          canvas.className='page-canvas';
          canvas.width=svp.width;canvas.height=svp.height;
          canvas.style.width=(svp.width/2)+'px';canvas.style.height=(svp.height/2)+'px';
          viewer.appendChild(canvas);
          var info=document.createElement('div');
          info.className='page-info';info.textContent='Page '+num+' of '+n;
          viewer.appendChild(info);
          page.render({canvasContext:canvas.getContext('2d'),viewport:svp}).promise.then(function(){
            if(num<n)renderPage(num+1);
          });
        });
      }
      renderPage(1);
    });
  }
  renderPdf(pdfUrl).catch(function(){
    document.getElementById('loading').style.display='none';
    var d=document.createElement('div');d.className='error';
    d.innerHTML='<h3>Unable to load PDF</h3><p>Please try again or contact support.</p>';
    document.body.appendChild(d);
  });
  document.addEventListener('contextmenu',function(e){e.preventDefault();});
  document.addEventListener('keydown',function(e){
    if(e.key==='PrintScreen'||(e.ctrlKey&&(e.key==='p'||e.key==='P'||e.key==='s'||e.key==='S'))){e.preventDefault();}
  });
})();
</script></body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.send(html);
  });
  app2.get("/api/pdf-proxy", (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "URL is required" });
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ message: "Invalid URL" });
    }
    const isGoogleDrive = parsedUrl.hostname.includes("drive.google.com") || parsedUrl.hostname.includes("docs.google.com");
    const isPdfUrl = parsedUrl.pathname.toLowerCase().endsWith(".pdf");
    if (!isPdfUrl && !isGoogleDrive) {
      return res.status(400).json({ message: "Only PDF files and Google Drive links are allowed" });
    }
    let finalUrl = url;
    if (isGoogleDrive) {
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch) {
        finalUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
      }
    }
    const finalParsed = new URL(finalUrl);
    const protocol = finalParsed.protocol === "https:" ? https : http;
    const options = {
      hostname: finalParsed.hostname,
      path: finalParsed.pathname + finalParsed.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/pdf,*/*"
      },
      timeout: 3e4
    };
    console.log(`[PDF-Proxy] Fetching: ${parsedUrl.hostname}${parsedUrl.pathname}`);
    const proxyReq = protocol.request(options, (proxyRes) => {
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const redirectUrl = new URL(proxyRes.headers.location, url);
        console.log(`[PDF-Proxy] Following redirect to: ${redirectUrl.href}`);
        proxyRes.resume();
        req.query.url = redirectUrl.href;
        return app2._router.handle(req, res, () => {
        });
      }
      if (proxyRes.statusCode !== 200) {
        console.log(`[PDF-Proxy] Upstream returned ${proxyRes.statusCode}`);
        proxyRes.resume();
        return res.status(proxyRes.statusCode).json({ message: "Failed to fetch PDF" });
      }
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "public, max-age=86400");
      if (proxyRes.headers["content-length"]) {
        res.setHeader("Content-Length", proxyRes.headers["content-length"]);
      }
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      console.error("[PDF-Proxy] Request error:", err.message);
      if (!res.headersSent) {
        res.status(502).json({ message: "Failed to fetch PDF" });
      }
    });
    proxyReq.on("timeout", () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).json({ message: "PDF download timed out" });
      }
    });
    proxyReq.end();
  });
}
var init_pdf_routes = __esm({
  "server/pdf-routes.ts"() {
    "use strict";
  }
});

// server/course-access-utils.ts
function computeEnrollmentValidUntil(course, enrolledAtMs) {
  const cands = [];
  if (course.end_date != null && String(course.end_date).trim() !== "") {
    const t = Date.parse(String(course.end_date).trim());
    if (Number.isFinite(t)) cands.push(t);
  }
  const vm = course.validity_months;
  if (vm != null && String(vm) !== "" && !Number.isNaN(Number(vm))) {
    const months = Number(vm);
    if (months > 0) {
      const d = new Date(enrolledAtMs);
      d.setUTCMonth(d.getUTCMonth() + months);
      cands.push(d.getTime());
    }
  }
  if (cands.length === 0) return null;
  return Math.min(...cands);
}
function isEnrollmentExpired(row) {
  if (!row) return true;
  const vu = row.valid_until;
  if (vu == null) return false;
  return Number(vu) < Date.now();
}
var init_course_access_utils = __esm({
  "server/course-access-utils.ts"() {
    "use strict";
  }
});

// server/payment-routes.ts
function registerPaymentRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  getRazorpay: getRazorpay2,
  verifyPaymentSignature: verifyPaymentSignature2,
  cacheInvalidate: cacheInvalidate2
}) {
  const ensureCourseEnrollment = async (paymentRow) => {
    const paidCourseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
    const paidCourse = paidCourseResult.rows[0];
    if (!paidCourse) throw new Error("Course not found");
    const alreadyEnrolled = await db2.query(
      "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2",
      [paymentRow.user_id, paymentRow.course_id]
    );
    if (alreadyEnrolled.rows.length > 0) return;
    const at = Date.now();
    const vu = computeEnrollmentValidUntil(paidCourse, at);
    await db2.query(
      "INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until) VALUES ($1, $2, $3, $4)",
      [paymentRow.user_id, paymentRow.course_id, at, vu]
    );
    await db2.query(
      "UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1",
      [paymentRow.course_id]
    );
  };
  const completeCoursePaymentByOrder = async ({
    orderId,
    paymentId,
    signature,
    expectedUserId,
    expectedCourseId
  }) => {
    const isValid = verifyPaymentSignature2(orderId, paymentId, signature);
    if (!isValid) {
      throw new Error("Invalid payment signature");
    }
    const paymentRecord = await db2.query(
      "SELECT * FROM payments WHERE razorpay_order_id = $1",
      [orderId]
    );
    if (paymentRecord.rows.length === 0) {
      throw new Error("Payment order not found");
    }
    const paymentRow = paymentRecord.rows[0];
    if (expectedUserId && paymentRow.user_id !== expectedUserId) {
      throw new Error("Payment does not belong to this user");
    }
    if (expectedCourseId && paymentRow.course_id !== expectedCourseId) {
      throw new Error("Course mismatch");
    }
    if (paymentRow.status !== "paid") {
      const paidCourseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
      const paidCourse = paidCourseResult.rows[0];
      if (!paidCourse) throw new Error("Course not found");
      const endTsPaid = paidCourse.end_date != null && String(paidCourse.end_date).trim() !== "" ? Date.parse(String(paidCourse.end_date).trim()) : null;
      if (Number.isFinite(endTsPaid) && endTsPaid < Date.now()) {
        throw new Error("This course has ended");
      }
      await db2.query(
        "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4",
        [paymentId, signature, "paid", orderId]
      );
    }
    await ensureCourseEnrollment(paymentRow);
    cacheInvalidate2?.("courses:");
    return { userId: paymentRow.user_id, courseId: paymentRow.course_id };
  };
  app2.post("/api/payments/track-click", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ ok: true });
      const { courseId } = req.body;
      if (!courseId) return res.json({ ok: true });
      const course = await db2.query("SELECT price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;
      const existing = await db2.query(
        "SELECT id, click_count FROM payments WHERE user_id = $1 AND course_id = $2 AND (status = 'created' OR status IS NULL) ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existing.rows.length > 0) {
        const currentCount = parseInt(existing.rows[0].click_count) || 1;
        const newCount = currentCount + 1;
        await db2.query(
          "UPDATE payments SET click_count = $1, status = 'created' WHERE id = $2 RETURNING id, click_count",
          [newCount, existing.rows[0].id]
        );
      } else {
        const paid = await db2.query(
          "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' LIMIT 1",
          [user.id, courseId]
        );
        if (paid.rows.length === 0) {
          await db2.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at)
             VALUES ($1, $2, $3, 'created', 1, $4)
             ON CONFLICT (user_id, course_id) DO UPDATE SET click_count = payments.click_count + 1`,
            [user.id, courseId, price, Date.now()]
          );
        }
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
  app2.post("/api/payments/create-order", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { courseId } = req.body;
      if (!courseId) return res.status(400).json({ message: "Course ID is required" });
      const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [courseId]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const course = courseResult.rows[0];
      if (course.is_free) return res.status(400).json({ message: "This course is free, no payment needed" });
      const endTs = course.end_date != null && String(course.end_date).trim() !== "" ? Date.parse(String(course.end_date).trim()) : null;
      if (Number.isFinite(endTs) && endTs < Date.now()) {
        return res.status(400).json({ message: "This course has ended" });
      }
      const existingEnrollment = await db2.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, courseId]);
      if (existingEnrollment.rows.length > 0) return res.status(400).json({ message: "Already enrolled" });
      const amount = Math.round(parseFloat(course.price) * 100);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `course_${courseId}_user_${user.id}_${Date.now()}`,
        notes: { courseId: courseId.toString(), userId: user.id.toString(), courseTitle: course.title }
      });
      console.log("[Payments] create-order success", {
        userId: user.id,
        courseId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency
      });
      const existingPayment = await db2.query(
        "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'created' ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (existingPayment.rows.length > 0) {
        await db2.query(
          "UPDATE payments SET razorpay_order_id = $1, amount = $2 WHERE id = $3",
          [order.id, course.price, existingPayment.rows[0].id]
        );
      } else {
        await db2.query(
          "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, click_count, created_at) VALUES ($1, $2, $3, $4, 'created', 1, $5)",
          [user.id, courseId, order.id, course.price, Date.now()]
        );
      }
      res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        courseName: course.title,
        courseId
      });
    } catch (err) {
      console.error("Create order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });
  app2.post("/api/payments/verify", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        expectedUserId: user.id,
        expectedCourseId: courseId
      });
      console.log("[Payments] verify success", {
        userId: result.userId,
        courseId: result.courseId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      });
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      res.status(500).json({ message: "Payment verification failed" });
    }
  });
  app2.post("/api/payments/sync-enrollment", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const courseId = Number(req.body?.courseId);
      if (!Number.isFinite(courseId)) {
        return res.status(400).json({ message: "courseId is required" });
      }
      const pay = await db2.query(
        "SELECT * FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
        [user.id, courseId]
      );
      if (pay.rows.length === 0) {
        return res.json({ ok: true, fixed: false, message: "No paid order for this course" });
      }
      await ensureCourseEnrollment(pay.rows[0]);
      cacheInvalidate2?.("courses:");
      return res.json({ ok: true, fixed: true, message: "Enrollment synced" });
    } catch (err) {
      console.error("sync-enrollment error:", err);
      res.status(500).json({ message: "Failed to sync enrollment" });
    }
  });
  app2.post("/api/payments/verify-redirect", async (req, res) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/store?payment=failed`;
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
      } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.redirect(fail);
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
      return res.redirect(`${frontendBase}/course/${result.courseId}?payment=success`);
    } catch (err) {
      console.error("[Payments] redirect verify failed:", err);
      return res.redirect(fail);
    }
  });
  app2.post("/api/tests/create-order", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { testId } = req.body;
      const testResult = await db2.query("SELECT id, title, price FROM tests WHERE id = $1", [testId]);
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      if (!test.price || parseFloat(test.price) <= 0) return res.status(400).json({ message: "This test is free" });
      const existing = await db2.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
      if (existing.rows.length > 0) return res.json({ alreadyPurchased: true });
      const amount = Math.round(parseFloat(test.price) * 100);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `test_${testId}_user_${user.id}_${Date.now()}`,
        notes: { testId: String(testId), userId: String(user.id), kind: "test" }
      });
      res.json({ orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, testName: test.title });
    } catch (err) {
      console.error("Test create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });
  app2.post("/api/tests/verify-redirect", async (req, res) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/test-series?payment=failed`;
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.redirect(fail);
      }
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.redirect(fail);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.fetch(razorpay_order_id);
      const n = order.notes || {};
      if (n.kind !== "test") return res.redirect(fail);
      const testId = parseInt(n.testId || "0", 10);
      const userId = parseInt(n.userId || "0", 10);
      if (!testId || !userId) return res.redirect(fail);
      await db2.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [userId, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      return res.redirect(`${frontendBase}/test-series?payment=success&testId=${testId}`);
    } catch (err) {
      console.error("[Tests] verify-redirect failed:", err);
      return res.redirect(fail);
    }
  });
  app2.post("/api/tests/verify-payment", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testId } = req.body;
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db2.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [user.id, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Test verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });
  app2.get("/api/tests/:id/purchased", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ purchased: false });
      const result = await db2.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, req.params.id]);
      res.json({ purchased: result.rows.length > 0 });
    } catch {
      res.json({ purchased: false });
    }
  });
}
var init_payment_routes = __esm({
  "server/payment-routes.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/support-routes.ts
function registerSupportRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  requireAdmin
}) {
  app2.get("/api/support/messages", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [user.id]
      );
      await db2.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE",
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });
  app2.post("/api/support/messages", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db2.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'user', $2, $3) RETURNING *",
        [user.id, message.trim().slice(0, 1e3), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });
  app2.get("/api/admin/support/conversations", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT u.id AS user_id, u.name, u.email, u.phone,
               COUNT(sm.id) FILTER (WHERE sm.is_read = FALSE AND sm.sender = 'user') AS unread_count,
               MAX(sm.created_at) AS last_message_at,
               (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message
        FROM users u
        JOIN support_messages sm ON sm.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.phone
        ORDER BY last_message_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });
  app2.get("/api/admin/support/messages/:userId", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [req.params.userId]
      );
      await db2.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE",
        [req.params.userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });
  app2.post("/api/admin/support/messages/:userId", requireAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db2.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'admin', $2, $3) RETURNING *",
        [req.params.userId, message.trim().slice(0, 1e3), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send reply" });
    }
  });
}
var init_support_routes = __esm({
  "server/support-routes.ts"() {
    "use strict";
  }
});

// server/live-class-access.ts
function sqlEnrollmentExistsForLiveList(userIdParam, nowParam) {
  return `EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = lc.course_id AND e.user_id = $${userIdParam} AND (e.status = 'active' OR e.status IS NULL) AND (e.valid_until IS NULL OR e.valid_until >= $${nowParam}))`;
}
async function userCanAccessLiveClassContent(db2, user, lc) {
  if (user?.role === "admin") return true;
  if (!lc.course_id) return true;
  if (lc.is_free_preview) return true;
  if (!user) return false;
  const enroll = await db2.query(
    "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
    [user.id, lc.course_id]
  );
  if (enroll.rows.length === 0 || isEnrollmentExpired(enroll.rows[0])) return false;
  return true;
}
var init_live_class_access = __esm({
  "server/live-class-access.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/live-chat-routes.ts
async function checkLiveClassAccess(req, res, db2, getAuthUser2, liveClassId) {
  const lc = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  if (lc.rows.length === 0) {
    res.status(404).json({ message: "Live class not found" });
    return false;
  }
  const liveClass = lc.rows[0];
  const reqUser = req.user;
  const user = reqUser || await getAuthUser2(req);
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return false;
  }
  const allow = await userCanAccessLiveClassContent(db2, user, liveClass);
  if (!allow) {
    res.status(403).json({ message: "Not enrolled" });
    return false;
  }
  return true;
}
function registerLiveChatRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  requireAuth,
  requireAdmin
}) {
  app2.get("/api/live-classes/:id/chat", async (req, res) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db2, getAuthUser2, req.params.id);
      if (!hasAccess) return;
      const { after } = req.query;
      let query = "SELECT * FROM live_chat_messages WHERE live_class_id = $1";
      const params = [req.params.id];
      if (after) {
        params.push(after);
        query += ` AND created_at > $${params.length}`;
      }
      query += " ORDER BY created_at ASC LIMIT 200";
      const result = await db2.query(query, params);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });
  app2.post("/api/live-classes/:id/chat", requireAuth, async (req, res) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db2, getAuthUser2, req.params.id);
      if (!hasAccess) return;
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });
      const user = req.user;
      const result = await db2.query(
        `INSERT INTO live_chat_messages (live_class_id, user_id, user_name, message, is_admin, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, user.id, user.name || user.phone, message.trim().slice(0, 500), user.role === "admin", Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });
  app2.delete("/api/admin/live-classes/:lcId/chat/:msgId", requireAdmin, async (req, res) => {
    try {
      await db2.query("DELETE FROM live_chat_messages WHERE id = $1 AND live_class_id = $2", [req.params.msgId, req.params.lcId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });
}
var init_live_chat_routes = __esm({
  "server/live-chat-routes.ts"() {
    "use strict";
    init_live_class_access();
  }
});

// server/live-class-engagement-routes.ts
function registerLiveClassEngagementRoutes({
  app: app2,
  db: db2,
  requireAuth,
  requireAdmin
}) {
  app2.post("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query("SELECT course_id, is_free_preview FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      await db2.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET last_heartbeat = $4, user_name = $3`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });
  app2.get("/api/live-classes/:id/viewers", async (req, res) => {
    try {
      const cutoff = Date.now() - 3e4;
      const result = await db2.query(
        `SELECT user_id, user_name FROM live_class_viewers
         WHERE live_class_id = $1 AND last_heartbeat > $2
         ORDER BY user_name ASC`,
        [req.params.id, cutoff]
      );
      const lcResult = await db2.query("SELECT show_viewer_count FROM live_classes WHERE id = $1", [req.params.id]);
      const visible = lcResult.rows[0]?.show_viewer_count ?? true;
      res.json({ viewers: result.rows, count: result.rows.length, visible });
    } catch (err) {
      console.error("Viewer list error:", err);
      res.status(500).json({ message: "Failed to fetch viewers" });
    }
  });
  app2.post("/api/live-classes/:id/raise-hand", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query("SELECT course_id, is_free_preview FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      await db2.query(
        `INSERT INTO live_class_hand_raises (live_class_id, user_id, user_name, raised_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET raised_at = $4`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", Date.now()]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Raise hand error:", err);
      res.status(500).json({ message: "Failed to raise hand" });
    }
  });
  app2.delete("/api/live-classes/:id/raise-hand", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query("SELECT course_id, is_free_preview FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      await db2.query("DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2", [req.params.id, user.id]);
      res.json({ success: true });
    } catch (err) {
      console.error("Lower hand error:", err);
      res.status(500).json({ message: "Failed to lower hand" });
    }
  });
  app2.get("/api/admin/live-classes/:id/raised-hands", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query(
        "SELECT id, user_id, user_name, raised_at FROM live_class_hand_raises WHERE live_class_id = $1 ORDER BY raised_at ASC",
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Raised hands list error:", err);
      res.status(500).json({ message: "Failed to fetch raised hands" });
    }
  });
  app2.post("/api/admin/live-classes/:id/raised-hands/:userId/resolve", requireAdmin, async (req, res) => {
    try {
      await db2.query("DELETE FROM live_class_hand_raises WHERE live_class_id = $1 AND user_id = $2", [req.params.id, req.params.userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Resolve hand error:", err);
      res.status(500).json({ message: "Failed to resolve hand raise" });
    }
  });
}
var init_live_class_engagement_routes = __esm({
  "server/live-class-engagement-routes.ts"() {
    "use strict";
    init_live_class_access();
  }
});

// server/live-stream-routes.ts
function registerLiveStreamRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  app2.post("/api/admin/live-classes/:id/stream/create", requireAdmin, async (req, res) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured. Add CF_STREAM_ACCOUNT_ID and CF_STREAM_API_TOKEN to .env" });
      }
      const lcResult = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const liveClass = lcResult.rows[0];
      if (liveClass.cf_stream_uid) {
        return res.json({
          uid: liveClass.cf_stream_uid,
          rtmpUrl: liveClass.cf_stream_rtmp_url,
          streamKey: liveClass.cf_stream_key,
          playbackHls: liveClass.cf_playback_hls
        });
      }
      const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          meta: { name: liveClass.title },
          recording: { mode: "automatic", timeoutSeconds: 60 }
        })
      });
      if (!cfRes.ok) {
        const errBody = await cfRes.text();
        console.error("[CF Stream] Create live input failed:", errBody);
        return res.status(502).json({ message: "Cloudflare Stream API error: " + errBody });
      }
      const cfData = await cfRes.json();
      const input = cfData.result;
      const uid = input.uid;
      const rtmpUrl = input.rtmps?.url || "rtmps://live.cloudflare.com:443/live/";
      const streamKey = input.rtmps?.streamKey || uid;
      const playbackHls = `https://videodelivery.net/${uid}/manifest/video.m3u8`;
      await db2.query(
        "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE id = $5",
        [uid, streamKey, rtmpUrl, playbackHls, req.params.id]
      );
      console.log(`[CF Stream] Created live input uid=${uid} for live class ${req.params.id}`);
      res.json({ uid, rtmpUrl, streamKey, playbackHls });
    } catch (err) {
      console.error("[CF Stream] Create error:", err);
      res.status(500).json({ message: "Failed to create Cloudflare Stream live input" });
    }
  });
  app2.get("/api/admin/live-classes/:id/stream/status", requireAdmin, async (req, res) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured" });
      }
      const lcResult = await db2.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const uid = lcResult.rows[0].cf_stream_uid;
      if (!uid) return res.json({ connected: false, uid: null });
      const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      if (!cfRes.ok) return res.json({ connected: false, uid });
      const cfData = await cfRes.json();
      const status = cfData.result?.status;
      res.json({ connected: status?.current?.state === "connected", uid, status: status?.current?.state || "idle" });
    } catch (err) {
      console.error("[CF Stream] Status error:", err);
      res.status(500).json({ message: "Failed to get stream status" });
    }
  });
  app2.post("/api/admin/live-classes/:id/stream/end", requireAdmin, async (req, res) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) return res.status(500).json({ message: "CF Stream credentials not configured" });
      const lcResult = await db2.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      const uid = lcResult.rows[0]?.cf_stream_uid;
      if (!uid) return res.json({ success: true });
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiToken}` }
      });
      console.log(`[CF Stream] Ended live input uid=${uid}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[CF Stream] End error:", err);
      res.status(500).json({ message: "Failed to end stream" });
    }
  });
  app2.post("/api/admin/live-classes/:id/recording", requireAdmin, async (req, res) => {
    try {
      const { recordingUrl, sectionTitle } = req.body;
      if (!recordingUrl) {
        return res.status(400).json({ message: "recordingUrl is required" });
      }
      const lcResult = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) {
        return res.status(404).json({ message: "Live class not found" });
      }
      const liveClass = lcResult.rows[0];
      const endedAt = Date.now();
      await db2.query(
        `UPDATE live_classes 
         SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2,
             duration_minutes = CASE 
               WHEN started_at IS NOT NULL 
               THEN GREATEST(1, ROUND(($2 - started_at) / 60000.0)::INTEGER)
               ELSE 0 
             END
         WHERE id = $3`,
        [recordingUrl, endedAt, req.params.id]
      );
      let lectureId = null;
      if (liveClass.course_id) {
        const durationMins = liveClass.started_at ? Math.max(1, Math.round((Date.now() - Number(liveClass.started_at)) / 6e4)) : 0;
        const maxOrder = await db2.query(
          "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
          [liveClass.course_id]
        );
        const lectureResult = await db2.query(
          `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
          [
            liveClass.course_id,
            liveClass.title,
            liveClass.description || "",
            recordingUrl,
            "r2",
            durationMins,
            maxOrder.rows[0].next_order,
            false,
            sectionTitle || "Live Class Recordings",
            Date.now()
          ]
        );
        lectureId = lectureResult.rows[0].id;
        await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
          liveClass.course_id
        ]);
      }
      await db2.query(
        `UPDATE live_classes 
         SET is_completed = TRUE, is_live = FALSE
         WHERE id != $1 AND title = $2 AND (is_live = TRUE OR is_completed IS NOT TRUE)`,
        [req.params.id, liveClass.title]
      ).catch(() => {
      });
      res.json({ success: true, lectureId });
    } catch (err) {
      console.error("Recording completion error:", err);
      res.status(500).json({ message: "Failed to save recording" });
    }
  });
}
var init_live_stream_routes = __esm({
  "server/live-stream-routes.ts"() {
    "use strict";
  }
});

// server/site-settings-routes.ts
function registerSiteSettingsRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  let ensureSiteSettingsTablePromise = null;
  const ensureSiteSettingsTable = async () => {
    if (!ensureSiteSettingsTablePromise) {
      ensureSiteSettingsTablePromise = db2.query("CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at BIGINT)").then(() => void 0).catch((err) => {
        ensureSiteSettingsTablePromise = null;
        throw err;
      });
    }
    await ensureSiteSettingsTablePromise;
  };
  app2.get("/api/site-settings", async (_req, res) => {
    try {
      await ensureSiteSettingsTable();
      const result = await db2.query("SELECT key, value FROM site_settings");
      const settings = {};
      for (const row of result.rows) settings[row.key] = row.value;
      res.json(settings);
    } catch (err) {
      console.error("[SiteSettings] Fetch error:", err);
      res.json({});
    }
  });
  app2.put("/api/admin/site-settings", requireAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== "object") return res.status(400).json({ message: "Settings object required" });
      await ensureSiteSettingsTable();
      for (const [key, value] of Object.entries(settings)) {
        await db2.query(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
          [key, String(value), Date.now()]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[SiteSettings] Save error:", err);
      res.status(500).json({ message: "Failed to save settings" });
    }
  });
}
var init_site_settings_routes = __esm({
  "server/site-settings-routes.ts"() {
    "use strict";
  }
});

// server/admin-course-import-routes.ts
function registerAdminCourseImportRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  updateCourseTestCounts: updateCourseTestCounts2
}) {
  app2.post("/api/admin/courses/:id/import-lectures", requireAdmin, async (req, res) => {
    try {
      const targetCourseId = req.params.id;
      const { lectureIds, sectionTitle } = req.body;
      if (!lectureIds || !Array.isArray(lectureIds) || lectureIds.length === 0) {
        return res.status(400).json({ message: "No lectures selected" });
      }
      const maxOrder = await db2.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [targetCourseId]);
      let orderIndex = maxOrder.rows[0].next_order;
      for (const lecId of lectureIds) {
        const lec = await db2.query("SELECT * FROM lectures WHERE id = $1", [lecId]);
        if (lec.rows.length > 0) {
          const l = lec.rows[0];
          await db2.query(
            `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [targetCourseId, l.title, l.description || "", l.video_url, l.video_type || "youtube", l.duration_minutes || 0, orderIndex++, false, l.section_title || null, Date.now()]
          );
        }
      }
      await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [targetCourseId]);
      res.json({ success: true, imported: lectureIds.length });
    } catch (err) {
      console.error("Import lectures error:", err);
      res.status(500).json({ message: "Failed to import lectures" });
    }
  });
  app2.post("/api/admin/courses/:id/import-tests", requireAdmin, async (req, res) => {
    try {
      const targetCourseId = String(req.params.id);
      const { testIds } = req.body;
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }
      for (const testId of testIds) {
        const test = await db2.query("SELECT * FROM tests WHERE id = $1", [testId]);
        if (test.rows.length > 0) {
          const t = test.rows[0];
          const newTest = await db2.query(
            `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, total_questions, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [t.title, t.description, targetCourseId, t.duration_minutes, t.total_marks, t.passing_marks, t.test_type, t.folder_name || null, t.total_questions || 0, Date.now()]
          );
          const questions = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [testId]);
          for (const q of questions.rows) {
            await db2.query(
              `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
              [newTest.rows[0].id, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_option, q.explanation, q.topic, q.difficulty, q.marks, q.negative_marks, q.order_index]
            );
          }
        }
      }
      await updateCourseTestCounts2(targetCourseId);
      res.json({ success: true, imported: testIds.length });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });
  app2.post("/api/admin/courses/:id/import-materials", requireAdmin, async (req, res) => {
    try {
      const targetCourseId = req.params.id;
      const { materialIds } = req.body;
      if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
        return res.status(400).json({ message: "No materials selected" });
      }
      for (const matId of materialIds) {
        const mat = await db2.query("SELECT * FROM study_materials WHERE id = $1", [matId]);
        if (mat.rows.length > 0) {
          const m = mat.rows[0];
          await db2.query(
            `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [m.title, m.description || "", m.file_url, m.file_type || "pdf", targetCourseId, false, m.section_title || null, m.download_allowed || false, Date.now()]
          );
        }
      }
      res.json({ success: true, imported: materialIds.length });
    } catch (err) {
      console.error("Import materials error:", err);
      res.status(500).json({ message: "Failed to import materials" });
    }
  });
}
var init_admin_course_import_routes = __esm({
  "server/admin-course-import-routes.ts"() {
    "use strict";
  }
});

// server/admin-course-management-routes.ts
function normalizeFolderName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}
function registerAdminCourseManagementRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  updateCourseTestCounts: updateCourseTestCounts2
}) {
  app2.get("/api/admin/all-materials", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT sm.*, c.title as course_title, c.course_type 
        FROM study_materials sm 
        JOIN courses c ON sm.course_id = c.id 
        ORDER BY c.title, sm.created_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });
  app2.get("/api/admin/all-lectures", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT l.*, c.title as course_title, c.course_type 
        FROM lectures l 
        JOIN courses c ON l.course_id = c.id 
        ORDER BY c.title, l.order_index
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch lectures" });
    }
  });
  app2.get("/api/admin/all-tests", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT t.*, c.title as course_title, c.course_type 
        FROM tests t 
        JOIN courses c ON t.course_id = c.id 
        ORDER BY c.title, t.created_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });
  app2.get("/api/admin/courses/:id/folders", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM course_folders WHERE course_id = $1 ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.post("/api/admin/courses/:id/folders", requireAdmin, async (req, res) => {
    try {
      const { name, type } = req.body;
      const normalizedName = normalizeFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!COURSE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });
      const existing = await db2.query(
        "SELECT * FROM course_folders WHERE course_id = $1 AND type = $2 AND LOWER(name) = LOWER($3) LIMIT 1",
        [req.params.id, normalizedType, normalizedName]
      );
      if (existing.rows.length > 0) {
        const revived = await db2.query(
          "UPDATE course_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *",
          [existing.rows[0].id]
        );
        return res.json(revived.rows[0]);
      }
      const result = await db2.query(
        "INSERT INTO course_folders (course_id, name, type) VALUES ($1, $2, $3) RETURNING *",
        [req.params.id, normalizedName, normalizedType]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });
  app2.put("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req, res) => {
    try {
      const { isHidden, name } = req.body;
      if (name !== void 0) {
        const normalizedName = normalizeFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
        const dup = await db2.query(
          "SELECT id FROM course_folders WHERE course_id = $1 AND type = (SELECT type FROM course_folders WHERE id = $2 AND course_id = $1) AND LOWER(name) = LOWER($3) AND id <> $2 LIMIT 1",
          [req.params.id, req.params.folderId, normalizedName]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ message: "A folder with this name already exists for this type" });
        }
        await db2.query(
          `WITH target AS (
             SELECT id, name, type
             FROM course_folders
             WHERE id = $1 AND course_id = $2
           ),
           renamed AS (
             UPDATE course_folders cf
             SET name = $3
             FROM target t
             WHERE cf.id = t.id
             RETURNING t.name AS old_name, t.type AS folder_type
           ),
           upd_lectures AS (
             UPDATE lectures l
             SET section_title = $3
             FROM renamed r
             WHERE r.folder_type = 'lecture' AND l.course_id = $2 AND l.section_title = r.old_name
             RETURNING l.id
           ),
           upd_materials AS (
             UPDATE study_materials sm
             SET section_title = $3
             FROM renamed r
             WHERE r.folder_type = 'material' AND sm.course_id = $2 AND sm.section_title = r.old_name
             RETURNING sm.id
           )
           UPDATE tests t
           SET folder_name = $3
           FROM renamed r
           WHERE r.folder_type = 'test' AND t.course_id = $2 AND t.folder_name = r.old_name`,
          [req.params.folderId, req.params.id, normalizedName]
        );
      } else if (isHidden !== void 0) {
        await db2.query("UPDATE course_folders SET is_hidden = $1 WHERE id = $2 AND course_id = $3", [isHidden, req.params.folderId, req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });
  app2.delete("/api/admin/courses/:id/folders/:folderId", requireAdmin, async (req, res) => {
    try {
      await db2.query(
        `WITH target AS (
           SELECT id, name, type
           FROM course_folders
           WHERE id = $1 AND course_id = $2
         ),
         del_lectures AS (
           DELETE FROM lectures l
           USING target t
           WHERE t.type = 'lecture' AND l.course_id = $2 AND l.section_title = t.name
           RETURNING l.id
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.course_id = $2 AND tt.folder_name = t.name
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.course_id = $2 AND sm.section_title = t.name
           RETURNING sm.id
         )
         DELETE FROM course_folders cf
         USING target t
         WHERE cf.id = t.id`,
        [req.params.folderId, req.params.id]
      );
      await updateCourseTestCounts2(String(req.params.id));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}
var COURSE_FOLDER_TYPES, MAX_FOLDER_NAME_LENGTH;
var init_admin_course_management_routes = __esm({
  "server/admin-course-management-routes.ts"() {
    "use strict";
    COURSE_FOLDER_TYPES = /* @__PURE__ */ new Set(["lecture", "material", "test"]);
    MAX_FOLDER_NAME_LENGTH = 120;
  }
});

// server/admin-analytics-routes.ts
function registerAdminAnalyticsRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  app2.get("/api/admin/analytics", requireAdmin, async (req, res) => {
    try {
      const { period, startDate, endDate } = req.query;
      const now = Date.now();
      const day = 864e5;
      const toSafeTs = (value) => {
        const ts = new Date(String(value)).getTime();
        return Number.isFinite(ts) ? ts : null;
      };
      const buildRange = () => {
        if (period === "today") {
          const start = /* @__PURE__ */ new Date();
          start.setHours(0, 0, 0, 0);
          return { start: start.getTime(), endExclusive: start.getTime() + day };
        }
        if (period === "yesterday") {
          const start = /* @__PURE__ */ new Date();
          start.setHours(0, 0, 0, 0);
          start.setDate(start.getDate() - 1);
          const end = /* @__PURE__ */ new Date();
          end.setHours(0, 0, 0, 0);
          return { start: start.getTime(), endExclusive: end.getTime() };
        }
        if (period === "7days") return { start: now - 7 * day, endExclusive: now + day };
        if (period === "15days") return { start: now - 15 * day, endExclusive: now + day };
        if (period === "30days") return { start: now - 30 * day, endExclusive: now + day };
        if (period === "custom" && startDate && endDate) {
          const s = toSafeTs(startDate);
          const e = toSafeTs(endDate);
          if (s !== null && e !== null) return { start: s, endExclusive: e + day };
        }
        return null;
      };
      const range = buildRange();
      const rangeParams = range ? [range.start, range.endExclusive] : [];
      const paymentWhere = range ? " AND p.created_at >= $1 AND p.created_at < $2" : "";
      const enrollWhere = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      const bookWhere = range ? " AND bp.purchased_at >= $1 AND bp.purchased_at < $2" : "";
      const enrollJoin = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      const paymentJoin = range ? " AND p.created_at >= $3 AND p.created_at < $4" : "";
      const courseJoinParams = range ? [range.start, range.endExclusive, range.start, range.endExclusive] : [];
      const [
        revenueResult,
        enrollResult,
        lifetimeResult,
        lifetimeEnrollResult,
        courseBreakdown,
        recentPurchases,
        abandonedResult,
        bookPurchases,
        lifetimeBookRevenue,
        bookAbandonedResult,
        testPurchases,
        lifetimeTestRevenue
      ] = await Promise.all([
        db2.query(`SELECT COALESCE(SUM(p.amount), 0) as total_revenue FROM payments p WHERE p.status = 'paid'${paymentWhere}`, rangeParams),
        db2.query(`SELECT COUNT(*) as total_enrollments FROM enrollments e WHERE 1=1${enrollWhere}`, rangeParams),
        db2.query(`SELECT COALESCE(SUM(amount), 0) as lifetime_revenue FROM payments WHERE status = 'paid'`),
        db2.query(`SELECT COUNT(*) as cnt FROM enrollments`),
        db2.query(`
          SELECT c.id, c.title, c.category, c.price, c.is_free, c.course_type,
                 COUNT(DISTINCT e.id) as enrollment_count,
                 COALESCE(SUM(p.amount), 0) as revenue
          FROM courses c
          LEFT JOIN enrollments e ON e.course_id = c.id${enrollJoin}
          LEFT JOIN payments p ON p.course_id = c.id AND p.status = 'paid'${paymentJoin}
          GROUP BY c.id, c.title, c.category, c.price, c.is_free, c.course_type
          ORDER BY enrollment_count DESC
        `, courseJoinParams),
        db2.query(`
          SELECT p.id, p.created_at, p.amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE p.status = 'paid'${paymentWhere}
          ORDER BY p.created_at DESC LIMIT 20
        `, rangeParams),
        db2.query(`
          SELECT MIN(p.id) as id, MAX(p.created_at) as created_at, MAX(p.amount) as amount,
                 SUM(COALESCE(p.click_count, 1)) as click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category, c.price
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE (p.status = 'created' OR p.status IS NULL)
          GROUP BY p.user_id, p.course_id, u.name, u.phone, u.email, c.title, c.category, c.price
          ORDER BY click_count DESC, MAX(p.created_at) DESC LIMIT 100
        `),
        db2.query(`
          SELECT bp.id, bp.purchased_at as created_at, b.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.cover_url
          FROM book_purchases bp
          JOIN users u ON u.id = bp.user_id
          JOIN books b ON b.id = bp.book_id
          WHERE 1=1${bookWhere}
          ORDER BY bp.purchased_at DESC LIMIT 100
        `, rangeParams),
        db2.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM book_purchases bp JOIN books b ON b.id = bp.book_id`),
        db2.query(`
          SELECT bct.id, bct.created_at, bct.click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.price
          FROM book_click_tracking bct
          JOIN users u ON u.id = bct.user_id
          JOIN books b ON b.id = bct.book_id
          ORDER BY bct.click_count DESC, bct.created_at DESC LIMIT 100
        `),
        db2.query(`
          SELECT tp.id, tp.created_at, t.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 t.title as test_title, t.test_type
          FROM test_purchases tp
          JOIN users u ON u.id = tp.user_id
          JOIN tests t ON t.id = tp.test_id
          ORDER BY tp.created_at DESC LIMIT 100
        `).catch(() => ({ rows: [] })),
        db2.query(`SELECT COALESCE(SUM(t.price), 0) as total FROM test_purchases tp JOIN tests t ON t.id = tp.test_id`).catch(() => ({ rows: [{ total: 0 }] }))
      ]);
      res.json({
        totalEnrollments: parseInt(enrollResult.rows[0]?.total_enrollments || "0"),
        totalRevenue: parseFloat(revenueResult.rows[0]?.total_revenue || "0"),
        lifetimeRevenue: parseFloat(lifetimeResult.rows[0]?.lifetime_revenue || "0"),
        lifetimeEnrollments: parseInt(lifetimeEnrollResult.rows[0]?.cnt || "0"),
        lifetimeBookRevenue: parseFloat(lifetimeBookRevenue.rows[0]?.total || "0"),
        lifetimeTestRevenue: parseFloat(lifetimeTestRevenue.rows[0]?.total || "0"),
        courseBreakdown: courseBreakdown.rows,
        recentPurchases: recentPurchases.rows,
        abandonedCheckouts: abandonedResult.rows,
        bookPurchases: bookPurchases.rows,
        bookAbandonedCheckouts: bookAbandonedResult.rows,
        testPurchases: testPurchases.rows
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });
  app2.get("/api/admin/courses/:id/enrollments", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query(
        `SELECT e.id, e.user_id, u.name AS user_name, u.phone AS user_phone, u.email AS user_email,
                e.enrolled_at, e.progress_percent, COALESCE(e.status, 'active') AS status
         FROM enrollments e JOIN users u ON e.user_id = u.id
         WHERE e.course_id = $1 ORDER BY e.enrolled_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });
}
var init_admin_analytics_routes = __esm({
  "server/admin-analytics-routes.ts"() {
    "use strict";
  }
});

// server/admin-enrollment-routes.ts
function registerAdminEnrollmentRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  cacheInvalidate: cacheInvalidate2,
  deleteDownloadsForUser: deleteDownloadsForUser2,
  deleteDownloadsForCourse: deleteDownloadsForCourse2
}) {
  app2.put("/api/admin/enrollments/:id", requireAdmin, async (req, res) => {
    try {
      const { status, valid_until } = req.body;
      const updates = [];
      const params = [];
      if (status !== void 0) {
        params.push(status);
        updates.push(`status = $${params.length}`);
      }
      if (valid_until !== void 0) {
        params.push(valid_until);
        updates.push(`valid_until = $${params.length}`);
      }
      if (updates.length > 0) {
        params.push(req.params.id);
        await db2.query(`UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update enrollment" });
    }
  });
  app2.delete("/api/admin/enrollments/:id", requireAdmin, async (req, res) => {
    try {
      const enrollment = await db2.query("SELECT user_id, course_id FROM enrollments WHERE id = $1", [req.params.id]);
      if (enrollment.rows.length > 0) {
        const { user_id, course_id } = enrollment.rows[0];
        await db2.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
        await deleteDownloadsForUser2(user_id, course_id);
      } else {
        await db2.query("DELETE FROM enrollments WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to remove enrollment" });
    }
  });
  app2.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
    try {
      const courseId = req.params.id;
      await deleteDownloadsForCourse2(parseInt(Array.isArray(courseId) ? courseId[0] : courseId));
      await db2.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db2.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
      await db2.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
      await db2.query("DELETE FROM courses WHERE id = $1", [courseId]);
      cacheInvalidate2("courses:");
      cacheInvalidate2("tests:");
      res.json({ success: true });
    } catch (err) {
      console.error("Delete course error:", err);
      res.status(500).json({ message: "Failed to delete course" });
    }
  });
}
var init_admin_enrollment_routes = __esm({
  "server/admin-enrollment-routes.ts"() {
    "use strict";
  }
});

// server/admin-lecture-routes.ts
function registerAdminLectureRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  getR2Client
}) {
  const inferLectureVideoType = (url) => {
    const u = (url || "").trim().toLowerCase();
    if (!u) return "youtube";
    if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
    if (u.includes("drive.google.com")) return "gdrive";
    if (u.includes("/api/media/") || u.includes("r2.dev") || u.includes("cdn.") || u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".mkv")) return "r2";
    return "upload";
  };
  app2.post("/api/admin/lectures", requireAdmin, async (req, res) => {
    try {
      const { courseId, title, description, videoUrl, fileUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } = req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseCheck = await db2.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
      if (courseCheck.rows.length === 0) {
        return res.status(404).json({ message: "Course not found" });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ message: "Lecture title is required" });
      }
      const normalizedVideoUrl = String(videoUrl || fileUrl || "").trim();
      const normalizedPdfUrl = String(pdfUrl || "").trim();
      if (!normalizedVideoUrl && !normalizedPdfUrl) {
        return res.status(400).json({ message: "Either videoUrl or pdfUrl is required" });
      }
      const effectiveVideoType = String(videoType || "").trim() || inferLectureVideoType(normalizedVideoUrl);
      const result = await db2.query(
        `INSERT INTO lectures (course_id, title, description, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          parsedCourseId,
          String(title).trim(),
          description || "",
          normalizedVideoUrl || null,
          effectiveVideoType,
          normalizedPdfUrl || null,
          Number(durationMinutes) || 0,
          Number(orderIndex) || 0,
          isFreePreview || false,
          sectionTitle || null,
          downloadAllowed || false,
          Date.now()
        ]
      );
      await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[AdminLectures] create failed", {
        body: {
          courseId: req.body?.courseId,
          title: req.body?.title,
          videoType: req.body?.videoType,
          hasVideoUrl: !!req.body?.videoUrl,
          hasFileUrl: !!req.body?.fileUrl,
          hasPdfUrl: !!req.body?.pdfUrl
        },
        error: err instanceof Error ? err.message : err
      });
      res.status(500).json({ message: "Failed to add lecture", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });
  app2.put("/api/admin/lectures/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, videoUrl, videoType, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } = req.body;
      await db2.query(
        `UPDATE lectures SET title=$1, description=$2, video_url=$3, video_type=$4, duration_minutes=$5, order_index=$6, is_free_preview=$7, section_title=$8, download_allowed=$9 WHERE id=$10`,
        [
          title,
          description || "",
          videoUrl,
          videoType || "youtube",
          parseInt(durationMinutes) || 0,
          parseInt(orderIndex) || 0,
          isFreePreview || false,
          sectionTitle || null,
          downloadAllowed || false,
          req.params.id
        ]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update lecture" });
    }
  });
  app2.delete("/api/admin/lectures/:id", requireAdmin, async (req, res) => {
    try {
      const lec = await db2.query("SELECT course_id, video_url FROM lectures WHERE id = $1", [req.params.id]);
      if (lec.rows.length > 0) {
        const lecture = lec.rows[0];
        if (lecture.video_url) {
          try {
            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const r2 = await getR2Client();
            let r2Key = lecture.video_url;
            if (r2Key.startsWith("http")) {
              try {
                const url = new URL(r2Key);
                r2Key = url.pathname.substring(1);
              } catch (_e) {
              }
            }
            const deleteCommand = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key
            });
            await r2.send(deleteCommand);
            console.log(`[R2] Deleted lecture file: ${r2Key}`);
          } catch (r2Err) {
            console.error("[R2] Failed to delete lecture file:", r2Err);
          }
        }
        await db2.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
        await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
          lecture.course_id
        ]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete lecture error:", err);
      res.status(500).json({ message: "Failed to delete lecture" });
    }
  });
}
var init_admin_lecture_routes = __esm({
  "server/admin-lecture-routes.ts"() {
    "use strict";
  }
});

// server/admin-test-routes.ts
function registerAdminTestRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  updateCourseTestCounts: updateCourseTestCounts2
}) {
  app2.get("/api/admin/tests", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT t.*, c.title as course_title 
        FROM tests t 
        LEFT JOIN courses c ON t.course_id = c.id 
        WHERE t.course_id IS NULL
        ORDER BY t.created_at DESC
      `);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });
  app2.post("/api/admin/tests", requireAdmin, async (req, res) => {
    try {
      const { title, description, courseId, durationMinutes, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, miniCourseId, price } = req.body;
      const result = await db2.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, mini_course_id, price, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          durationMinutes || 60,
          totalMarks || 100,
          passingMarks || 35,
          testType || "practice",
          folderName || null,
          difficulty || "moderate",
          scheduledAt ? new Date(scheduledAt).getTime() : null,
          miniCourseId || null,
          parseFloat(price) || 0,
          Date.now()
        ]
      );
      if (courseId) await updateCourseTestCounts2(courseId);
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create test" });
    }
  });
  app2.post("/api/admin/questions", requireAdmin, async (req, res) => {
    try {
      const questions = Array.isArray(req.body) ? req.body : [req.body];
      for (const q of questions) {
        await db2.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            q.testId,
            q.questionText,
            q.optionA,
            q.optionB,
            q.optionC,
            q.optionD,
            q.correctOption,
            q.explanation,
            q.topic,
            q.difficulty || "medium",
            q.marks || 4,
            q.negativeMarks || 1,
            q.orderIndex || 0,
            q.imageUrl || null,
            q.solutionImageUrl || null
          ]
        );
      }
      await db2.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [questions[0].testId]);
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add questions" });
    }
  });
}
var init_admin_test_routes = __esm({
  "server/admin-test-routes.ts"() {
    "use strict";
  }
});

// server/admin-question-bulk-routes.ts
function parseQuestionsFromText(text) {
  const questions = [];
  const normalized = text.replace(/\f/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, "").replace(/^[\s\-\*\>\•]+/gm, (m) => m.replace(/[\-\*\>\•]/g, "").trimStart());
  const lines = normalized.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const isQuestion = (l) => /^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+[\.\)\:])\s*[\.\)\:]?\s*.+/i.test(l);
  const isOptionLetter = (l) => /^[AaBbCcDd][\.\)\:]?\s*$/.test(l);
  const isOption = (l) => /^[\(\[]?[AaBbCcDd][\)\]\.\:][\s\)]/.test(l) || /^\([AaBbCcDd]\)/.test(l) || /^[AaBbCcDd]\s*[\.\)]\s*/.test(l) || /^[AaBbCcDd]\s+\S/.test(l);
  const getOptionLetter = (l) => {
    const m = l.match(/^[\(\[]?([AaBbCcDd])[\)\]\.\:]/);
    if (m) return m[1].toUpperCase();
    const m2 = l.match(/^\(([AaBbCcDd])\)/);
    if (m2) return m2[1].toUpperCase();
    const m3 = l.match(/^([AaBbCcDd])\s+\S/);
    if (m3) return m3[1].toUpperCase();
    return "";
  };
  const stripOptionPrefix = (l) => l.replace(/^[\(\[]?[AaBbCcDd][\)\]\.\:]\s*/, "").replace(/^\([AaBbCcDd]\)\s*/, "").replace(/^[AaBbCcDd]\s+/, "").trim();
  const stripQuestionPrefix = (l) => l.replace(/^(Q\.?\s*\d+|Q\d+|Question\s*\d+|\d+)[\.\)\:]?\s*/i, "").trim();
  const isAnswer = (l) => /^(Answer|Ans|Correct\s*Answer|Key|Sol|Solution)[\s\:\.\-]*[:\-]?\s*[\(\[]?[A-Da-d][\)\]]?/i.test(l) || /^Correct[\s:]+[A-Da-d]/i.test(l) || /^Answer\s*-\s*[A-Da-d]/i.test(l);
  const getAnswerLetter = (l) => {
    const m = l.match(/[:\-\s]\s*[\(\[]?([A-Da-d])[\)\]]?\s*$/i);
    if (m) return m[1].toUpperCase();
    const m2 = l.match(/[\(\[]?([A-Da-d])[\)\]]?\s*$/);
    if (m2) return m2[1].toUpperCase();
    return "A";
  };
  let curQ = "";
  const tryParseInline = (l) => {
    const inlineMatch = l.match(/^(?:Q\.?\s*\d+[\.\)]?\s*|Q\d+[\.\)]?\s*|\d+[\.\)]\s*)(.+?)\s*[\(\[](A)[\)\]]\s*(.+?)\s*[\(\[](B)[\)\]]\s*(.+?)\s*[\(\[](C)[\)\]]\s*(.+?)\s*[\(\[](D)[\)\]]\s*(.+?)(?:\s*(?:Ans|Answer|Key)[\s:\-]*[\(\[]?([A-Da-d])[\)\]]?)?$/i);
    if (inlineMatch) {
      return {
        questionText: inlineMatch[1].trim(),
        optionA: inlineMatch[3].trim(),
        optionB: inlineMatch[5].trim(),
        optionC: inlineMatch[7].trim(),
        optionD: inlineMatch[9].trim(),
        correctOption: inlineMatch[10] ? inlineMatch[10].toUpperCase() : "A"
      };
    }
    const lcInline = l.match(/\(([aAbB])\)\s*(.+?)\s*\(([bBcC])\)\s*(.+?)\s*\(([cCdD])\)\s*(.+?)\s*\(([dD])\)\s*(.+?)(?:\s*(?:Ans(?:wer)?|Key|Correct)[\s:\-]+[\(\[]?([A-Da-d])[\)\]]?)?$/i);
    if (lcInline && curQ) {
      return {
        questionText: curQ,
        optionA: lcInline[2].trim(),
        optionB: lcInline[4].trim(),
        optionC: lcInline[6].trim(),
        optionD: lcInline[8].trim(),
        correctOption: lcInline[9] ? lcInline[9].toUpperCase() : "A"
      };
    }
    return null;
  };
  let opts = {};
  let correct = "A";
  let pendingOptionLetter = "";
  const flush = () => {
    if (curQ && (opts["A"] || opts["B"])) {
      questions.push({
        questionText: curQ,
        optionA: opts["A"] || "",
        optionB: opts["B"] || "",
        optionC: opts["C"] || "",
        optionD: opts["D"] || "",
        correctOption: correct
      });
    }
    curQ = "";
    opts = {};
    correct = "A";
    pendingOptionLetter = "";
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (pendingOptionLetter) {
      opts[pendingOptionLetter] = line;
      pendingOptionLetter = "";
      continue;
    }
    const inline = tryParseInline(line);
    if (inline) {
      flush();
      questions.push(inline);
      continue;
    }
    if (isQuestion(line)) {
      flush();
      curQ = stripQuestionPrefix(line);
      const inlineAfterQ = tryParseInline(line);
      if (inlineAfterQ) {
        questions.push(inlineAfterQ);
        curQ = "";
        opts = {};
        correct = "A";
        pendingOptionLetter = "";
      }
    } else if (isOptionLetter(line)) {
      pendingOptionLetter = line.replace(/[\.\)\:]/g, "").trim().toUpperCase();
    } else if (isOption(line)) {
      const letter = getOptionLetter(line);
      if (letter) opts[letter] = stripOptionPrefix(line);
    } else if (isAnswer(line)) {
      correct = getAnswerLetter(line);
    } else if (curQ && Object.keys(opts).length === 0) {
      curQ += " " + line;
    }
  }
  flush();
  return questions;
}
function registerAdminQuestionBulkRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  upload: upload2,
  PDFParse: PDFParse2
}) {
  app2.post("/api/admin/questions/bulk-text", requireAdmin, async (req, res) => {
    try {
      const { testId, text, defaultMarks, defaultNegativeMarks, save } = req.body;
      if (!testId || !text) {
        return res.status(400).json({ message: "testId and text are required" });
      }
      const parsed = parseQuestionsFromText(text);
      if (parsed.length === 0) {
        return res.status(400).json({ message: "No questions could be parsed from the provided text" });
      }
      if (save) {
        const maxOrderResult = await db2.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
        let idx = maxOrderResult.rows[0]?.max_order || 0;
        for (const q of parsed) {
          idx++;
          await db2.query(
            `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption, q.explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx]
          );
        }
        await db2.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      }
      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to parse and add questions" });
    }
  });
  app2.post("/api/admin/questions/bulk-pdf", requireAdmin, upload2.single("pdf"), async (req, res) => {
    try {
      const testId = req.body.testId;
      const defaultMarks = parseInt(req.body.defaultMarks) || 4;
      const defaultNegativeMarks = parseFloat(req.body.defaultNegativeMarks) || 1;
      console.log("[bulk-pdf] testId:", testId, "file:", req.file?.originalname, "size:", req.file?.size);
      if (!testId || !req.file) {
        return res.status(400).json({ message: !testId ? "testId is required" : "PDF file is required \u2014 make sure you selected a .pdf file" });
      }
      const parser = new PDFParse2({ data: req.file.buffer });
      const result = await parser.getText();
      const text = result.text;
      console.log("[bulk-pdf] extracted text length:", text.length, "preview:", text.substring(0, 200));
      const parsed = parseQuestionsFromText(text);
      console.log("[bulk-pdf] parsed questions:", parsed.length);
      if (parsed.length === 0) {
        return res.status(400).json({
          message: "No questions could be parsed from the PDF. Make sure questions are numbered (Q1, 1., etc.) with options labeled A, B, C, D.",
          rawTextPreview: text.substring(0, 500)
        });
      }
      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error("[bulk-pdf] error:", err);
      res.status(500).json({ message: `Failed to parse PDF: ${err?.message || "unknown error"}` });
    }
  });
  app2.post("/api/admin/questions/bulk-save", requireAdmin, async (req, res) => {
    try {
      const { testId, questions, defaultMarks, defaultNegativeMarks } = req.body;
      if (!testId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "testId and questions array are required" });
      }
      const maxOrderResult = await db2.query("SELECT COALESCE(MAX(order_index), 0) as max_order FROM questions WHERE test_id = $1", [testId]);
      let idx = maxOrderResult.rows[0]?.max_order || 0;
      for (const q of questions) {
        idx++;
        await db2.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [testId, q.questionText, q.optionA, q.optionB, q.optionC, q.optionD, q.correctOption || "A", q.explanation || "", "medium", defaultMarks || 4, defaultNegativeMarks || 1, idx, q.imageUrl || null, q.solutionImageUrl || null]
        );
      }
      await db2.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
      res.json({ success: true, count: questions.length });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to save questions" });
    }
  });
}
var init_admin_question_bulk_routes = __esm({
  "server/admin-question-bulk-routes.ts"() {
    "use strict";
  }
});

// server/admin-users-and-content-routes.ts
function registerAdminUsersAndContentRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  deleteDownloadsForUser: deleteDownloadsForUser2
}) {
  app2.post("/api/admin/study-materials", requireAdmin, async (req, res) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle, downloadAllowed } = req.body;
      const normalizedTitle = typeof title === "string" ? title.trim() : "";
      const normalizedFileUrl = typeof fileUrl === "string" ? fileUrl.trim() : "";
      const parsedCourseId = courseId == null ? null : Number(courseId);
      if (!normalizedTitle) return res.status(400).json({ message: "Material title is required" });
      if (!normalizedFileUrl) return res.status(400).json({ message: "File URL is required" });
      if (parsedCourseId != null && (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (parsedCourseId != null) {
        const courseCheck = await db2.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
        if (courseCheck.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      }
      const result = await db2.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          normalizedTitle,
          description || "",
          normalizedFileUrl,
          fileType || "pdf",
          parsedCourseId,
          parsedCourseId ? false : isFree !== false,
          sectionTitle || null,
          downloadAllowed || false,
          Date.now()
        ]
      );
      if (parsedCourseId) {
        await db2.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[AdminMaterials] create failed", {
        body: {
          courseId: req.body?.courseId,
          title: req.body?.title,
          fileType: req.body?.fileType,
          hasFileUrl: !!req.body?.fileUrl
        },
        error: err instanceof Error ? err.message : err
      });
      res.status(500).json({ message: "Failed to add material", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });
  app2.post("/api/admin/live-classes", requireAdmin, async (req, res) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount } = req.body;
      const result = await db2.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [title, description, courseId || null, youtubeUrl || null, scheduledAt, isLive || false, isPublic || false, notifyEmail || false, notifyBell || false, isFreePreview || false, streamType || "rtmp", chatMode || "public", showViewerCount !== false, Date.now()]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive}`);
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to add live class" });
    }
  });
  app2.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(
        `SELECT id, name, email, phone, role, created_at,
                COALESCE(is_blocked, FALSE) AS is_blocked,
                last_active_at
         FROM users ORDER BY created_at DESC NULLS LAST`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Admin users error:", err);
      try {
        const result = await db2.query("SELECT id, name, email, phone, role, created_at, FALSE AS is_blocked, NULL AS last_active_at FROM users ORDER BY id DESC");
        res.json(result.rows);
      } catch {
        res.status(500).json({ message: "Failed to fetch users" });
      }
    }
  });
  app2.put("/api/admin/users/:id/block", requireAdmin, async (req, res) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        await db2.query("UPDATE users SET is_blocked = TRUE, session_token = NULL WHERE id = $1", [req.params.id]);
        const userId = req.params.id;
        await deleteDownloadsForUser2(parseInt(Array.isArray(userId) ? userId[0] : userId));
      } else {
        await db2.query("UPDATE users SET is_blocked = FALSE WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update user" });
    }
  });
  app2.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = req.params.id;
      await db2.query("DELETE FROM test_attempts WHERE user_id = $1", [userId]);
      await db2.query("DELETE FROM enrollments WHERE user_id = $1", [userId]);
      await db2.query("DELETE FROM notifications WHERE user_id = $1", [userId]);
      await db2.query("DELETE FROM payments WHERE user_id = $1", [userId]);
      await db2.query("DELETE FROM book_purchases WHERE user_id = $1", [userId]);
      await db2.query("DELETE FROM folder_purchases WHERE user_id = $1", [userId]).catch(() => {
      });
      await db2.query("DELETE FROM support_messages WHERE user_id = $1", [userId]).catch(() => {
      });
      await db2.query("DELETE FROM mission_attempts WHERE user_id = $1", [userId]).catch(() => {
      });
      await db2.query("DELETE FROM users WHERE id = $1", [userId]);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete user error:", err);
      res.status(500).json({ message: "Failed to delete user" });
    }
  });
}
var init_admin_users_and_content_routes = __esm({
  "server/admin-users-and-content-routes.ts"() {
    "use strict";
  }
});

// server/admin-test-management-routes.ts
function registerAdminTestManagementRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  updateCourseTestCounts: updateCourseTestCounts2
}) {
  app2.get("/api/admin/tests/:id/questions", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index ASC, id ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  });
  app2.put("/api/admin/questions/:id", requireAdmin, async (req, res) => {
    try {
      const { questionText, optionA, optionB, optionC, optionD, correctOption, explanation, topic, marks, negativeMarks, difficulty, imageUrl, solutionImageUrl } = req.body;
      await db2.query(
        `UPDATE questions SET question_text=$1, option_a=$2, option_b=$3, option_c=$4, option_d=$5, correct_option=$6, explanation=$7, topic=$8, marks=$9, negative_marks=$10, difficulty=$11, image_url=$12, solution_image_url=$13 WHERE id=$14`,
        [questionText, optionA, optionB, optionC, optionD, correctOption, explanation || "", topic || "", parseFloat(marks) || 1, parseFloat(negativeMarks) || 0, difficulty || "moderate", imageUrl || null, solutionImageUrl || null, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update question" });
    }
  });
  app2.delete("/api/admin/questions/:id", requireAdmin, async (req, res) => {
    try {
      const q = await db2.query("SELECT test_id FROM questions WHERE id = $1", [req.params.id]);
      await db2.query("DELETE FROM questions WHERE id = $1", [req.params.id]);
      if (q.rows.length > 0) {
        await db2.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [q.rows[0].test_id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete question" });
    }
  });
  app2.put("/api/admin/tests/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, durationMinutes, totalMarks, testType, folderName, difficulty, scheduledAt, passingMarks, courseId, price } = req.body;
      const priceVal = price !== void 0 ? parseFloat(price) || 0 : null;
      if (courseId !== void 0) {
        await db2.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9, course_id=$10${priceVal !== null ? ", price=$12" : ""} WHERE id=$11`,
          priceVal !== null ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id, priceVal] : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id]
        );
        if (courseId) await updateCourseTestCounts2(courseId);
      } else {
        await db2.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9${priceVal !== null ? ", price=$11" : ""} WHERE id=$10`,
          priceVal !== null ? [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id, priceVal] : [title, description || "", parseInt(durationMinutes) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id]
        );
        const existing = await db2.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
        if (existing.rows[0]?.course_id) await updateCourseTestCounts2(existing.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update test" });
    }
  });
  app2.delete("/api/admin/tests/:id", requireAdmin, async (req, res) => {
    try {
      const testRow = await db2.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
      const courseId = testRow.rows[0]?.course_id;
      await db2.query("DELETE FROM test_attempts WHERE test_id = $1", [req.params.id]);
      await db2.query("DELETE FROM questions WHERE test_id = $1", [req.params.id]);
      await db2.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      if (courseId) await updateCourseTestCounts2(courseId);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete test error:", err);
      res.status(500).json({ message: "Failed to delete test" });
    }
  });
}
var init_admin_test_management_routes = __esm({
  "server/admin-test-management-routes.ts"() {
    "use strict";
  }
});

// server/admin-daily-mission-routes.ts
function registerAdminDailyMissionRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  app2.post("/api/admin/daily-missions", requireAdmin, async (req, res) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId } = req.body;
      if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Title and questions are required" });
      }
      const result = await db2.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [title, description || "", JSON.stringify(questions), missionDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0], xpReward || 50, missionType || "daily_drill", courseId || null]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create daily mission" });
    }
  });
  app2.put("/api/admin/daily-missions/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId } = req.body;
      await db2.query(
        `UPDATE daily_missions SET title=$1, description=$2, questions=$3, mission_date=$4, xp_reward=$5, mission_type=$6, course_id=$7 WHERE id=$8`,
        [title, description || "", JSON.stringify(questions), missionDate, xpReward || 50, missionType, courseId || null, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update mission" });
    }
  });
  app2.delete("/api/admin/daily-missions/:id", requireAdmin, async (req, res) => {
    try {
      await db2.query("DELETE FROM daily_missions WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete mission" });
    }
  });
  app2.get("/api/admin/daily-missions", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query("SELECT * FROM daily_missions ORDER BY mission_date DESC LIMIT 50");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch missions" });
    }
  });
  app2.get("/api/admin/daily-missions/:id/attempts", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query(
        `
        SELECT um.user_id, um.score, COALESCE(um.time_taken, 0) as time_taken,
               COALESCE(um.incorrect, 0) as incorrect, COALESCE(um.skipped, 0) as skipped,
               um.completed_at, um.answers,
               u.name, u.phone, u.email,
               dm.questions
        FROM user_missions um
        JOIN users u ON u.id = um.user_id
        JOIN daily_missions dm ON dm.id = um.mission_id
        WHERE um.mission_id = $1 AND um.is_completed = TRUE
        ORDER BY um.score DESC, COALESCE(um.time_taken, 0) ASC
      `,
        [req.params.id]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("Failed to fetch mission attempts:", err);
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });
}
var init_admin_daily_mission_routes = __esm({
  "server/admin-daily-mission-routes.ts"() {
    "use strict";
  }
});

// server/admin-notification-routes.ts
function registerAdminNotificationRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  app2.post("/api/admin/notifications/send", requireAdmin, async (req, res) => {
    try {
      const { userId, title, message, type, target, courseId, imageUrl, expiresAfterHours } = req.body;
      let userIds = [];
      if (userId) {
        userIds = [userId];
      } else if (target === "enrolled" && courseId) {
        const result = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]);
        userIds = result.rows.map((r) => r.user_id);
      } else if (target === "enrolled") {
        const result = await db2.query("SELECT DISTINCT user_id FROM enrollments");
        userIds = result.rows.map((r) => r.user_id);
      } else {
        const result = await db2.query("SELECT id FROM users WHERE role = 'student'");
        userIds = result.rows.map((r) => r.id);
      }
      const now = Date.now();
      const expiresAt = expiresAfterHours ? now + parseFloat(expiresAfterHours) * 36e5 : null;
      const insertResult = await db2.query(
        "INSERT INTO admin_notifications (title, message, target, course_id, sent_count, image_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [title, message, target || "all", courseId || null, userIds.length, imageUrl || null, now]
      );
      const adminNotifId = insertResult.rows[0]?.id || null;
      for (const uid of userIds) {
        await db2.query(
          "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, admin_notif_id, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
          [uid, title, message, type || "info", now, expiresAt, adminNotifId, imageUrl || null]
        );
      }
      res.json({ success: true, sent: userIds.length });
    } catch (err) {
      console.error("[NotifSend] error:", err);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });
  app2.get("/api/admin/notifications/history", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(
        "SELECT an.*, c.title as course_title FROM admin_notifications an LEFT JOIN courses c ON c.id = an.course_id ORDER BY an.created_at DESC LIMIT 100"
      );
      console.log(`[NotifHistory] returning ${result.rows.length} records`);
      res.json(result.rows);
    } catch (err) {
      console.error("[NotifHistory] error:", err);
      res.status(500).json({ message: "Failed to fetch notification history" });
    }
  });
  app2.put("/api/admin/notifications/:id", requireAdmin, async (req, res) => {
    try {
      const { title, message } = req.body;
      const anId = parseInt(String(req.params.id));
      await db2.query("UPDATE admin_notifications SET title = $1, message = $2 WHERE id = $3", [title, message, anId]);
      await db2.query("UPDATE notifications SET title = $1, message = $2 WHERE admin_notif_id = $3", [title, message, anId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });
  app2.put("/api/admin/notifications/:id/hide", requireAdmin, async (req, res) => {
    try {
      const { hidden } = req.body;
      const anId = parseInt(String(req.params.id));
      const an = await db2.query("UPDATE admin_notifications SET is_hidden = $1 WHERE id = $2 RETURNING title", [hidden, anId]);
      await db2.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id = $2", [hidden, anId]);
      if (an.rows.length > 0 && an.rows[0].title) {
        await db2.query("UPDATE notifications SET is_hidden = $1 WHERE admin_notif_id IS NULL AND TRIM(title) = TRIM($2)", [hidden, an.rows[0].title]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });
  app2.delete("/api/admin/notifications/:id", requireAdmin, async (req, res) => {
    try {
      const anId = parseInt(String(req.params.id));
      const r1 = await db2.query("DELETE FROM notifications WHERE admin_notif_id = $1", [anId]);
      console.log("[NotifDelete] deleted " + (r1.rowCount || 0) + " student notifications for admin_notif_id=" + anId);
      await db2.query("DELETE FROM admin_notifications WHERE id = $1", [anId]);
      res.json({ success: true });
    } catch (err) {
      console.error("[NotifDelete] error:", err);
      res.status(500).json({ message: "Failed to delete notification" });
    }
  });
}
var init_admin_notification_routes = __esm({
  "server/admin-notification-routes.ts"() {
    "use strict";
  }
});

// server/admin-course-crud-routes.ts
function registerAdminCourseCrudRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  cacheInvalidate: cacheInvalidate2
}) {
  app2.post("/api/admin/courses", requireAdmin, async (req, res) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, startDate, endDate, validityMonths, thumbnail, coverColor } = req.body;
      const COVER_COLORS = ["#1A56DB", "#7C3AED", "#DC2626", "#059669", "#D97706", "#0891B2", "#DB2777", "#EA580C"];
      const autoColor = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
      const result = await db2.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, start_date, end_date, validity_months, thumbnail, cover_color, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, TRUE, $17) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, category || "Mathematics", isFree || false, level || "Beginner", durationHours || 0, courseType || "live", subject || "", startDate || null, endDate || null, vm, thumbnail || null, coverColor || autoColor, Date.now()]
      );
      cacheInvalidate2("courses:");
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Create course error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create course" });
    }
  });
  app2.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, validityMonths, thumbnail, coverColor } = req.body;
      const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
      await db2.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), course_type=COALESCE($13, course_type), start_date=COALESCE($14, start_date), end_date=COALESCE($15, end_date), validity_months=COALESCE($16, validity_months), thumbnail=COALESCE($17, thumbnail), cover_color=COALESCE($18, cover_color) WHERE id=$19`,
        [title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, courseType, startDate, endDate, vm, thumbnail ?? null, coverColor ?? null, req.params.id]
      );
      cacheInvalidate2("courses:");
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update course" });
    }
  });
}
var init_admin_course_crud_routes = __esm({
  "server/admin-course-crud-routes.ts"() {
    "use strict";
  }
});

// server/book-routes.ts
function registerBookRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  getAuthUser: getAuthUser2,
  getRazorpay: getRazorpay2,
  verifyPaymentSignature: verifyPaymentSignature2
}) {
  app2.get("/api/books", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const isAdmin = user?.role === "admin";
      const result = await db2.query(
        isAdmin ? "SELECT * FROM books ORDER BY created_at DESC" : "SELECT * FROM books WHERE is_published = TRUE AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at DESC"
      );
      const books = result.rows;
      if (user) {
        const purchased = await db2.query("SELECT book_id FROM book_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchased.rows.map((r) => r.book_id));
        books.forEach((b) => {
          b.isPurchased = purchasedIds.has(b.id);
        });
      }
      res.json(books);
    } catch {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });
  app2.get("/api/my-books", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT b.*, bp.purchased_at FROM books b
         JOIN book_purchases bp ON b.id = bp.book_id
         WHERE bp.user_id = $1 ORDER BY bp.purchased_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch purchased books" });
    }
  });
  app2.get("/api/admin/books", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query("SELECT * FROM books ORDER BY created_at DESC");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });
  app2.post("/api/admin/books", requireAdmin, async (req, res) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      if (!title) return res.status(400).json({ message: "Title is required" });
      const result = await db2.query(
        `INSERT INTO books (title, description, author, price, original_price, cover_url, file_url, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description || "", author || "", price || 0, originalPrice || 0, coverUrl || null, fileUrl || null, isPublished !== false, Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create book" });
    }
  });
  app2.put("/api/admin/books/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished } = req.body;
      await db2.query(
        `UPDATE books SET title=$1, description=$2, author=$3, price=$4, original_price=$5, cover_url=$6, file_url=$7, is_published=$8 WHERE id=$9`,
        [title, description, author, price, originalPrice, coverUrl, fileUrl, isPublished, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update book" });
    }
  });
  app2.put("/api/admin/books/:id/hide", requireAdmin, async (req, res) => {
    try {
      const { hidden } = req.body;
      await db2.query("UPDATE books SET is_hidden = $1 WHERE id = $2", [hidden, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update book" });
    }
  });
  app2.delete("/api/admin/books/:id", requireAdmin, async (req, res) => {
    try {
      await db2.query("DELETE FROM book_purchases WHERE book_id = $1", [req.params.id]);
      await db2.query("DELETE FROM book_click_tracking WHERE book_id = $1", [req.params.id]).catch(() => {
      });
      await db2.query("DELETE FROM books WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete book" });
    }
  });
  app2.post("/api/books/track-click", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ ok: true });
      const { bookId } = req.body;
      if (!bookId) return res.json({ ok: true });
      const purchased = await db2.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (purchased.rows.length > 0) return res.json({ ok: true });
      const result = await db2.query(
        `
        INSERT INTO book_click_tracking (user_id, book_id, click_count, created_at)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (user_id, book_id) DO UPDATE SET click_count = book_click_tracking.click_count + 1
        RETURNING click_count
      `,
        [user.id, bookId, Date.now()]
      );
      console.log(`[BookClick] user=${user.id} book=${bookId} count=${result.rows[0]?.click_count}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("[BookBuyNow] track-click error:", err);
      res.json({ ok: true });
    }
  });
  app2.post("/api/books/create-order", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId } = req.body;
      if (!bookId) return res.status(400).json({ message: "Book ID required" });
      console.log(`[BookOrder] user=${user.id} bookId=${bookId}`);
      const bookResult = await db2.query("SELECT * FROM books WHERE id = $1", [bookId]);
      if (bookResult.rows.length === 0) return res.status(404).json({ message: "Book not found" });
      const book = bookResult.rows[0];
      if (parseFloat(book.price) === 0) return res.status(400).json({ message: "This book is free" });
      const alreadyPurchased = await db2.query("SELECT id FROM book_purchases WHERE user_id = $1 AND book_id = $2", [user.id, bookId]);
      if (alreadyPurchased.rows.length > 0) return res.status(400).json({ message: "Already purchased" });
      const amount = Math.round(parseFloat(book.price) * 100);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `book_${bookId}_user_${user.id}_${Date.now()}`,
        notes: {
          bookId: String(bookId),
          userId: String(user.id),
          bookTitle: book.title,
          kind: "book"
        }
      });
      console.log(`[BookOrder] created orderId=${order.id} amount=${amount}`);
      res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, bookTitle: book.title, bookId });
    } catch (err) {
      console.error("Book create-order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });
  app2.post("/api/books/verify-redirect", async (req, res) => {
    const frontendBase = process.env.FRONTEND_URL || "https://3ilearning.in";
    const fail = `${frontendBase}/store?payment=failed`;
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.redirect(fail);
      }
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.redirect(fail);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.fetch(razorpay_order_id);
      const n = order.notes || {};
      if (n.kind !== "book") return res.redirect(fail);
      const bookId = parseInt(n.bookId || "0", 10);
      const userId = parseInt(n.userId || "0", 10);
      if (!bookId || !userId) return res.redirect(fail);
      await db2.query(
        "INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING",
        [userId, bookId, Date.now()]
      );
      await db2.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [userId, bookId]).catch(() => {
      });
      return res.redirect(`${frontendBase}/store?payment=success&bookId=${bookId}`);
    } catch (err) {
      console.error("Book verify-redirect error:", err);
      return res.redirect(fail);
    }
  });
  app2.post("/api/books/verify-payment", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { bookId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
      const isValid = verifyPaymentSignature2(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await db2.query("INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING", [user.id, bookId, Date.now()]);
      await db2.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [user.id, bookId]).catch(() => {
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Book verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });
}
var init_book_routes = __esm({
  "server/book-routes.ts"() {
    "use strict";
  }
});

// server/standalone-folder-routes.ts
function normalizeStandaloneFolderName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}
function registerStandaloneFolderRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  app2.get("/api/admin/standalone-folders", requireAdmin, async (req, res) => {
    try {
      const { type } = req.query;
      let q = "SELECT * FROM standalone_folders";
      const params = [];
      if (type) {
        params.push(type);
        q += ` WHERE type = $1`;
      }
      q += " ORDER BY created_at ASC";
      const result = await db2.query(q, params);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.post("/api/admin/standalone-folders", requireAdmin, async (req, res) => {
    try {
      const { name, type, category, price, originalPrice, isFree, description, validityMonths } = req.body;
      const normalizedName = normalizeStandaloneFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!STANDALONE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });
      const existing = await db2.query(
        "SELECT * FROM standalone_folders WHERE type = $1 AND LOWER(name) = LOWER($2) LIMIT 1",
        [normalizedType, normalizedName]
      );
      if (existing.rows.length > 0) {
        const revived = await db2.query(
          "UPDATE standalone_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *",
          [existing.rows[0].id]
        );
        return res.json(revived.rows[0]);
      }
      if (normalizedType === "test") {
        const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
        const result2 = await db2.query(
          "INSERT INTO standalone_folders (name, type, category, price, original_price, is_free, description, validity_months) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
          [normalizedName, normalizedType, category || null, parseFloat(price) || 0, parseFloat(originalPrice) || 0, isFree !== false, description || null, vm]
        );
        return res.json(result2.rows[0]);
      }
      const result = await db2.query(
        "INSERT INTO standalone_folders (name, type) VALUES ($1, $2) RETURNING *",
        [normalizedName, normalizedType]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });
  app2.put("/api/admin/standalone-folders/:id", requireAdmin, async (req, res) => {
    try {
      const { name, isHidden, category, price, originalPrice, isFree, description, validityMonths } = req.body;
      if (name !== void 0) {
        const normalizedName = normalizeStandaloneFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
        const current = await db2.query("SELECT id, type FROM standalone_folders WHERE id = $1", [req.params.id]);
        if (current.rows.length > 0) {
          const folderType = current.rows[0].type;
          const dup = await db2.query(
            "SELECT id FROM standalone_folders WHERE type = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1",
            [folderType, normalizedName, req.params.id]
          );
          if (dup.rows.length > 0) {
            return res.status(409).json({ message: "A folder with this name already exists for this type" });
          }
        }
        await db2.query(
          `WITH target AS (
             SELECT id, name, type
             FROM standalone_folders
             WHERE id = $1
           ),
           renamed AS (
             UPDATE standalone_folders sf
             SET name = $2
             FROM target t
             WHERE sf.id = t.id
             RETURNING t.name AS old_name, t.type AS folder_type
           ),
           upd_tests AS (
             UPDATE tests tt
             SET folder_name = $2
             FROM renamed r
             WHERE r.folder_type = 'test' AND tt.folder_name = r.old_name AND tt.course_id IS NULL
             RETURNING tt.id
           )
           UPDATE study_materials sm
           SET section_title = $2
           FROM renamed r
           WHERE r.folder_type = 'material' AND sm.section_title = r.old_name AND sm.course_id IS NULL`,
          [req.params.id, normalizedName]
        );
      } else if (isHidden !== void 0) {
        await db2.query("UPDATE standalone_folders SET is_hidden = $1 WHERE id = $2", [isHidden, req.params.id]);
      }
      if (category !== void 0) await db2.query("UPDATE standalone_folders SET category = $1 WHERE id = $2", [category, req.params.id]);
      if (price !== void 0) await db2.query("UPDATE standalone_folders SET price = $1 WHERE id = $2", [parseFloat(price) || 0, req.params.id]);
      if (originalPrice !== void 0) await db2.query("UPDATE standalone_folders SET original_price = $1 WHERE id = $2", [parseFloat(originalPrice) || 0, req.params.id]);
      if (isFree !== void 0) await db2.query("UPDATE standalone_folders SET is_free = $1 WHERE id = $2", [isFree, req.params.id]);
      if (description !== void 0) await db2.query("UPDATE standalone_folders SET description = $1 WHERE id = $2", [description || null, req.params.id]);
      if (validityMonths !== void 0) {
        const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
        await db2.query("UPDATE standalone_folders SET validity_months = $1 WHERE id = $2", [vm, req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });
  app2.delete("/api/admin/standalone-folders/:id", requireAdmin, async (req, res) => {
    try {
      await db2.query(
        `WITH target AS (
           SELECT id, name, type
           FROM standalone_folders
           WHERE id = $1
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.folder_name = t.name AND tt.course_id IS NULL
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.section_title = t.name AND sm.course_id IS NULL
           RETURNING sm.id
         )
         DELETE FROM standalone_folders sf
         USING target t
         WHERE sf.id = t.id`,
        [req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}
var STANDALONE_FOLDER_TYPES, MAX_STANDALONE_FOLDER_NAME_LENGTH;
var init_standalone_folder_routes = __esm({
  "server/standalone-folder-routes.ts"() {
    "use strict";
    STANDALONE_FOLDER_TYPES = /* @__PURE__ */ new Set(["test", "material", "mini_course"]);
    MAX_STANDALONE_FOLDER_NAME_LENGTH = 120;
  }
});

// server/doubt-notification-routes.ts
function registerDoubtNotificationRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  generateAIAnswer: generateAIAnswer2
}) {
  app2.post("/api/doubts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { question, topic } = req.body;
      const aiAnswer = await generateAIAnswer2(question, topic);
      const result = await db2.query(
        "INSERT INTO doubts (user_id, question, answer, topic, status, created_at) VALUES ($1, $2, $3, $4, 'answered', $5) RETURNING *",
        [user.id, question, aiAnswer, topic, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to submit doubt" });
    }
  });
  app2.get("/api/doubts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query("SELECT * FROM doubts WHERE user_id = $1 ORDER BY created_at DESC", [user.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch doubts" });
    }
  });
  app2.get("/api/notifications", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const result = await db2.query(
        `SELECT * FROM notifications WHERE user_id = $1
         AND (source IS NULL OR source != 'support')
         AND (is_hidden IS NOT TRUE)
         AND (is_read IS NOT TRUE)
         AND (expires_at IS NULL OR expires_at > $2)
         AND title NOT ILIKE 'New message from%'
         AND title NOT ILIKE 'New reply from Support%'
         ORDER BY created_at DESC LIMIT 50`,
        [user.id, now]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch notifications" });
    }
  });
  app2.put("/api/notifications/:id/read", async (req, res) => {
    try {
      await db2.query("UPDATE notifications SET is_read = TRUE WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
}
var init_doubt_notification_routes = __esm({
  "server/doubt-notification-routes.ts"() {
    "use strict";
  }
});

// server/student-mission-material-routes.ts
function registerStudentMissionMaterialRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
  app2.get("/api/daily-missions", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const { type } = req.query;
      let query = "SELECT * FROM daily_missions WHERE mission_date <= CURRENT_DATE";
      const params = [];
      if (type && type !== "all") {
        params.push(type);
        query += ` AND mission_type = $${params.length}`;
      }
      query += " ORDER BY mission_date DESC LIMIT 20";
      const result = await db2.query(query, params);
      if (user) {
        const userEnrollments = await db2.query("SELECT course_id FROM enrollments WHERE user_id = $1", [user.id]);
        const enrolledCourseIds = new Set(userEnrollments.rows.map((e) => e.course_id));
        for (const mission of result.rows) {
          const um = await db2.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
          mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
          mission.userScore = um.rows[0]?.score || 0;
          mission.userTimeTaken = um.rows[0]?.time_taken || 0;
          mission.userAnswers = um.rows[0]?.answers || {};
          mission.userIncorrect = um.rows[0]?.incorrect || 0;
          mission.userSkipped = um.rows[0]?.skipped || 0;
          mission.isAccessible = mission.mission_type === "free_practice" || (mission.course_id ? enrolledCourseIds.has(mission.course_id) : enrolledCourseIds.size > 0);
        }
      } else {
        for (const mission of result.rows) mission.isAccessible = mission.mission_type === "free_practice";
      }
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch daily missions" });
    }
  });
  app2.get("/api/daily-mission", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const result = await db2.query("SELECT * FROM daily_missions WHERE mission_date = CURRENT_DATE AND mission_type = 'daily_drill' LIMIT 1");
      if (result.rows.length === 0) return res.json(null);
      const mission = result.rows[0];
      if (user) {
        const um = await db2.query("SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2", [user.id, mission.id]);
        mission.isCompleted = um.rows.length > 0 && um.rows[0].is_completed;
        mission.userScore = um.rows[0]?.score || 0;
        mission.userTimeTaken = um.rows[0]?.time_taken || 0;
        mission.userAnswers = um.rows[0]?.answers || {};
        mission.userIncorrect = um.rows[0]?.incorrect || 0;
        mission.userSkipped = um.rows[0]?.skipped || 0;
      }
      res.json(mission);
    } catch {
      res.status(500).json({ message: "Failed to fetch daily mission" });
    }
  });
  app2.post("/api/daily-mission/:id/complete", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { score, timeTaken, answers, incorrect, skipped } = req.body;
      await db2.query(
        `INSERT INTO user_missions (user_id, mission_id, is_completed, score, completed_at, time_taken, answers, incorrect, skipped) 
         VALUES ($1, $2, TRUE, $3, $4, $5, $6, $7, $8) 
         ON CONFLICT (user_id, mission_id) DO UPDATE SET is_completed = TRUE, score = $3, completed_at = $4, time_taken = $5, answers = $6, incorrect = $7, skipped = $8`,
        [user.id, req.params.id, score, Date.now(), timeTaken || 0, JSON.stringify(answers || {}), incorrect || 0, skipped || 0]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[Mission Complete] Error:", err);
      res.status(500).json({ message: "Failed to complete mission" });
    }
  });
  app2.get("/api/study-materials", async (req, res) => {
    try {
      const { free } = req.query;
      let query = "SELECT * FROM study_materials";
      const params = [];
      if (free === "true") query += " WHERE is_free = TRUE";
      query += " ORDER BY created_at DESC";
      const result = await db2.query(query, params);
      let folders = [];
      if (free === "true") {
        const foldersResult = await db2.query("SELECT * FROM standalone_folders WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at ASC");
        folders = foldersResult.rows;
      }
      res.set("Cache-Control", "private, no-store");
      res.json({ materials: result.rows, folders });
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });
  app2.get("/api/study-materials/folder/:folderName", async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM study_materials WHERE section_title = $1 AND course_id IS NULL ORDER BY created_at DESC", [
        decodeURIComponent(String(req.params.folderName))
      ]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folder materials" });
    }
  });
  app2.get("/api/study-materials/:id", async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM study_materials WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Material not found" });
      const m = result.rows[0];
      if (m.course_id) {
        const user = await getAuthUser2(req);
        if (!user) return res.status(401).json({ message: "Not authenticated" });
        if (user.role !== "admin" && !m.is_free) {
          const e = await db2.query(
            "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, m.course_id]
          );
          if (e.rows.length === 0 || isEnrollmentExpired(e.rows[0])) {
            return res.status(403).json({ message: "Access denied" });
          }
        }
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to fetch material" });
    }
  });
}
var init_student_mission_material_routes = __esm({
  "server/student-mission-material-routes.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/lecture-routes.ts
function registerLectureRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  updateCourseProgress: updateCourseProgress2
}) {
  app2.get("/api/lectures/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT l.*, c.is_free AS course_is_free
         FROM lectures l
         LEFT JOIN courses c ON l.course_id = c.id
         WHERE l.id = $1`,
        [req.params.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Lecture not found" });
      const lecture = result.rows[0];
      if (user.role !== "admin" && !lecture.is_free_preview) {
        if (lecture.course_id) {
          const enrolled = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, lecture.course_id]);
          if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
            return res.status(403).json({ message: "Enrollment required to access this lecture" });
          }
        }
      }
      res.json(lecture);
    } catch {
      res.status(500).json({ message: "Failed to fetch lecture" });
    }
  });
  app2.get("/api/lectures/:id/progress", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ is_completed: false });
      const result = await db2.query("SELECT is_completed, watch_percent FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2", [user.id, req.params.id]);
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0 });
      res.json(result.rows[0]);
    } catch {
      res.json({ is_completed: false });
    }
  });
  app2.post("/api/lectures/:id/progress", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { courseId, watchPercent, isCompleted } = req.body;
      await db2.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET watch_percent = $3, is_completed = $4, completed_at = $5`,
        [user.id, req.params.id, watchPercent, isCompleted, isCompleted ? Date.now() : null]
      );
      if (courseId && isCompleted) {
        await updateCourseProgress2(user.id, courseId);
        await db2.query("UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3", [req.params.id, user.id, courseId]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });
}
var init_lecture_routes = __esm({
  "server/lecture-routes.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/test-folder-routes.ts
function registerTestFolderRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
  app2.get("/api/test-folders", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const result = await db2.query(
        "SELECT sf.*, (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = sf.id) as total_tests FROM standalone_folders sf WHERE sf.type = 'mini_course' AND (sf.is_hidden = FALSE OR sf.is_hidden IS NULL) ORDER BY sf.created_at DESC"
      );
      const folders = result.rows.map((f) => ({ ...f, is_purchased: false }));
      if (user) {
        const purchases = await db2.query("SELECT folder_id FROM folder_purchases WHERE user_id = $1", [user.id]);
        const purchasedIds = new Set(purchases.rows.map((p) => p.folder_id));
        for (const f of folders) f.is_purchased = f.is_free || purchasedIds.has(f.id);
      } else {
        for (const f of folders) f.is_purchased = f.is_free;
      }
      res.json(folders);
    } catch (err) {
      console.error("Test folders error:", err);
      res.status(500).json({ message: "Failed to fetch test folders" });
    }
  });
  app2.get("/api/test-folders/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const folder = await db2.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      const f = folder.rows[0];
      const tests = await db2.query("SELECT t.*, t.folder_name as sub_folder FROM tests t WHERE t.mini_course_id = $1 ORDER BY t.folder_name ASC NULLS LAST, t.created_at ASC", [f.id]);
      let isPurchased = f.is_free;
      const attempts = {};
      if (user) {
        const purchase = await db2.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, f.id]);
        if (purchase.rows.length > 0) isPurchased = true;
        if (tests.rows.length > 0) {
          const attemptsResult = await db2.query(
            "SELECT test_id, score, total_marks, completed_at FROM test_attempts WHERE user_id = $1 AND test_id = ANY($2) AND completed_at IS NOT NULL ORDER BY score DESC",
            [user.id, tests.rows.map((t) => t.id)]
          );
          for (const a of attemptsResult.rows) {
            if (!attempts[a.test_id]) attempts[a.test_id] = a;
          }
        }
      }
      res.json({ ...f, is_purchased: isPurchased, tests: tests.rows, attempts });
    } catch (err) {
      console.error("Test folder detail error:", err);
      res.status(500).json({ message: "Failed to fetch folder" });
    }
  });
  app2.post("/api/test-folders/:id/enroll", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folder = await db2.query("SELECT * FROM standalone_folders WHERE id = $1 AND type = 'mini_course'", [req.params.id]);
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      if (!folder.rows[0].is_free) return res.status(400).json({ message: "This folder requires payment" });
      await db2.query("INSERT INTO folder_purchases (user_id, folder_id, amount) VALUES ($1, $2, 0) ON CONFLICT (user_id, folder_id) DO NOTHING", [user.id, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to enroll" });
    }
  });
}
var init_test_folder_routes = __esm({
  "server/test-folder-routes.ts"() {
    "use strict";
  }
});

// server/test-access-guards.ts
async function assertTestAccess(db2, user, test, testId) {
  if (user.role === "admin") return { ok: true };
  if (test.course_id) {
    if (test.course_is_free) return { ok: true };
    const enrolled = await db2.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, test.course_id]
    );
    if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
      return { ok: false, message: "Enrollment required for this test" };
    }
    return { ok: true };
  }
  if (test.mini_course_id && !test.folder_is_free) {
    const purchased = await db2.query("SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2", [user.id, test.mini_course_id]);
    if (purchased.rows.length === 0) return { ok: false, message: "Purchase required to access this test" };
    return { ok: true };
  }
  if (test.price && parseFloat(String(test.price)) > 0) {
    const purchased = await db2.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
    if (purchased.rows.length === 0) return { ok: false, message: "Purchase required to access this test" };
  }
  return { ok: true };
}
var init_test_access_guards = __esm({
  "server/test-access-guards.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/test-core-routes.ts
function registerTestCoreRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  updateCourseProgress: updateCourseProgress2
}) {
  app2.get("/api/tests", async (req, res) => {
    try {
      const { courseId, type } = req.query;
      let query = `SELECT t.*, c.is_free AS course_is_free, c.price AS course_price, c.title AS course_title, c.id AS course_id_ref FROM tests t LEFT JOIN courses c ON t.course_id = c.id WHERE TRUE`;
      const params = [];
      if (courseId) {
        params.push(courseId);
        query += ` AND course_id = $${params.length}`;
      } else {
        query += ` AND course_id IS NULL`;
      }
      if (type) {
        params.push(type);
        query += ` AND test_type = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      const user = await getAuthUser2(req);
      const result = await db2.query(query, params);
      let tests = result.rows;
      if (user) {
        const enrollResult = await db2.query("SELECT course_id, valid_until FROM enrollments WHERE user_id = $1", [user.id]);
        const courseUnlocked = /* @__PURE__ */ new Set();
        for (const e of enrollResult.rows) {
          if (!isEnrollmentExpired(e)) courseUnlocked.add(Number(e.course_id));
        }
        tests = tests.map((t) => ({
          ...t,
          isLocked: !!(t.course_id && !t.course_is_free && !courseUnlocked.has(Number(t.course_id)))
        }));
      } else {
        tests = tests.map((t) => ({
          ...t,
          isLocked: !!(t.course_id && !t.course_is_free)
        }));
      }
      res.set("Cache-Control", "private, no-store");
      res.json(tests);
    } catch (err) {
      console.error("[api/tests] list error:", err);
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });
  app2.get("/api/tests/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const testResult = await db2.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      if (user.role !== "admin") {
        const a = await assertTestAccess(db2, user, test, String(req.params.id));
        if (!a.ok) return res.status(403).json({ message: a.message });
      }
      const questionsResult = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      res.json({ ...test, questions: questionsResult.rows });
    } catch {
      res.status(500).json({ message: "Failed to fetch test" });
    }
  });
  app2.post("/api/tests/:id/attempt", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { answers, timeTakenSeconds, questionTimes } = req.body;
      const timeTaken = parseInt(String(timeTakenSeconds || "0")) || 0;
      console.log(`[Attempt] test=${req.params.id} user=${user.id} answers=${JSON.stringify(answers)?.slice(0, 100)} timeTaken=${timeTaken}`);
      const testResult = await db2.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      if (user.role !== "admin") {
        const a = await assertTestAccess(db2, user, test, String(req.params.id));
        if (!a.ok) return res.status(403).json({ message: a.message });
      }
      const questionsResult = await db2.query("SELECT * FROM questions WHERE test_id = $1", [req.params.id]);
      const questions = questionsResult.rows;
      let score = 0;
      let correctCount = 0;
      let incorrectCount = 0;
      let attemptedCount = 0;
      const topicErrors = {};
      const answersMap = typeof answers === "string" ? JSON.parse(answers) : answers || {};
      questions.forEach((q) => {
        const userAnswer = answersMap[String(q.id)] || answersMap[q.id];
        if (userAnswer) attemptedCount++;
        if (userAnswer === q.correct_option) {
          score += q.marks;
          correctCount++;
        } else if (userAnswer) {
          score -= parseFloat(q.negative_marks) || 0;
          incorrectCount++;
          const topic = q.topic || "General";
          topicErrors[topic] = (topicErrors[topic] || 0) + 1;
        }
      });
      const percentage = test.total_marks > 0 ? (score / test.total_marks * 100).toFixed(2) : 0;
      let attemptResult;
      try {
        attemptResult = await db2.query(
          `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, question_times, status, started_at, completed_at) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed', $12, $13) RETURNING id`,
          [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, questionTimes ? JSON.stringify(questionTimes) : null, Date.now() - timeTaken * 1e3, Date.now()]
        );
      } catch (_e1) {
        try {
          attemptResult = await db2.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, correct, incorrect, attempted, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'completed', $11, $12) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, correctCount, incorrectCount, attemptedCount, Date.now() - timeTaken * 1e3, Date.now()]
          );
        } catch (_e2) {
          attemptResult = await db2.query(
            `INSERT INTO test_attempts (user_id, test_id, answers, score, total_marks, percentage, time_taken_seconds, status, started_at, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9) RETURNING id`,
            [user.id, req.params.id, JSON.stringify(answers), Math.max(0, Math.round(score * 100) / 100), test.total_marks, percentage, timeTaken, Date.now() - timeTaken * 1e3, Date.now()]
          );
        }
      }
      const weakTopics = Object.entries(topicErrors).sort(([, a], [, b]) => b - a).slice(0, 3).map(([topic]) => topic);
      if (test.course_id) {
        try {
          await updateCourseProgress2(user.id, test.course_id);
        } catch (_pe) {
        }
      }
      res.json({
        attemptId: attemptResult.rows[0].id,
        score: Math.max(0, Math.round(score * 100) / 100),
        totalMarks: test.total_marks,
        percentage,
        correct: correctCount,
        incorrect: incorrectCount,
        attempted: attemptedCount,
        testType: test.test_type,
        weakTopics,
        passed: score >= (test.passing_marks || 0),
        questions: questions.map((q) => ({
          ...q,
          userAnswer: answersMap[String(q.id)] || answersMap[q.id] || null,
          isCorrect: (answersMap[String(q.id)] || answersMap[q.id]) === q.correct_option
        }))
      });
    } catch (err) {
      console.error("[Attempt] Submit error:", err);
      res.status(500).json({ message: "Failed to submit test", detail: String(err) });
    }
  });
}
var init_test_core_routes = __esm({
  "server/test-core-routes.ts"() {
    "use strict";
    init_test_access_guards();
    init_course_access_utils();
  }
});

// server/test-attempt-routes.ts
function registerTestAttemptRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
  app2.get("/api/tests/:id/my-attempts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });
  app2.get("/api/tests/:id/my_attempts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT ta.id, ta.score, ta.total_marks, ta.percentage, ta.correct, ta.incorrect,
                ta.attempted, ta.time_taken_seconds, ta.completed_at, ta.status
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.test_id = $2 AND ta.status = 'completed'
         ORDER BY ta.completed_at DESC`,
        [user.id, req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });
  app2.get("/api/tests/:id/analysis/:attemptId", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const attemptRes = await db2.query("SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2", [req.params.attemptId, user.id]);
      if (attemptRes.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const attempt = attemptRes.rows[0];
      const answers = typeof attempt.answers === "string" ? JSON.parse(attempt.answers) : attempt.answers || {};
      const questionsRes = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [req.params.id]);
      const questions = questionsRes.rows;
      const topicMap = {};
      questions.forEach((q, idx) => {
        const topic = q.topic || "Uncategorized";
        if (!topicMap[topic]) topicMap[topic] = { total: 0, correct: 0, wrong: 0, skipped: 0, qNums: [] };
        const ua = answers[String(q.id)] || answers[q.id];
        topicMap[topic].total++;
        topicMap[topic].qNums.push(idx + 1);
        if (!ua) topicMap[topic].skipped++;
        else if (ua === q.correct_option) topicMap[topic].correct++;
        else topicMap[topic].wrong++;
      });
      const topics = Object.entries(topicMap).map(([name, data]) => ({
        name,
        total: data.total,
        correct: data.correct,
        wrong: data.wrong,
        skipped: data.skipped,
        correctPct: data.total > 0 ? Math.round(data.correct / data.total * 100) : 0,
        qNums: data.qNums,
        isWeak: data.total > 0 && data.correct / data.total < 0.5
      }));
      const topperRes = await db2.query(
        `SELECT DISTINCT ON (user_id) score, total_marks, percentage, correct, incorrect, attempted, time_taken_seconds
         FROM test_attempts WHERE test_id = $1 AND status = 'completed'
         ORDER BY user_id, score DESC, time_taken_seconds ASC`,
        [req.params.id]
      );
      const allAttempts = topperRes.rows;
      const topper = allAttempts.sort((a, b) => parseFloat(b.score) - parseFloat(a.score))[0];
      const avgRes = await db2.query(
        `SELECT AVG(score::numeric) as avg_score, AVG(percentage::numeric) as avg_pct,
                AVG(correct) as avg_correct, AVG(incorrect) as avg_incorrect,
                AVG(time_taken_seconds) as avg_time
         FROM (
           SELECT DISTINCT ON (user_id) score, percentage, correct, incorrect, time_taken_seconds
           FROM test_attempts WHERE test_id = $1 AND status = 'completed'
           ORDER BY user_id, score DESC
         ) sub`,
        [req.params.id]
      );
      const avg = avgRes.rows[0];
      let youCorrect = attempt.correct != null ? parseInt(attempt.correct) : null;
      let youIncorrect = attempt.incorrect != null ? parseInt(attempt.incorrect) : null;
      if (youCorrect === null || youIncorrect === null) {
        let c = 0, w = 0;
        questions.forEach((q) => {
          const ua = answers[String(q.id)] || answers[q.id];
          if (ua === q.correct_option) c++;
          else if (ua) w++;
        });
        youCorrect = c;
        youIncorrect = w;
      }
      res.json({
        topics,
        topper: topper ? {
          score: parseFloat(topper.score),
          totalMarks: topper.total_marks,
          percentage: parseFloat(topper.percentage),
          correct: topper.correct != null ? topper.correct : null,
          incorrect: topper.incorrect != null ? topper.incorrect : null,
          timeTaken: topper.time_taken_seconds || 0
        } : null,
        avg: avg ? {
          score: parseFloat(avg.avg_score) || 0,
          percentage: parseFloat(avg.avg_pct) || 0,
          correct: avg.avg_correct != null ? Math.round(parseFloat(avg.avg_correct)) : null,
          incorrect: avg.avg_incorrect != null ? Math.round(parseFloat(avg.avg_incorrect)) : null,
          timeTaken: Math.round(parseFloat(avg.avg_time) || 0)
        } : null,
        you: {
          score: parseFloat(attempt.score),
          totalMarks: attempt.total_marks,
          percentage: parseFloat(attempt.percentage),
          correct: youCorrect,
          incorrect: youIncorrect,
          timeTaken: attempt.time_taken_seconds || 0
        }
      });
    } catch (err) {
      console.error("[Analysis]", err);
      res.status(500).json({ message: "Failed to fetch analysis" });
    }
  });
  app2.get("/api/tests/:id/leaderboard", async (req, res) => {
    try {
      const testResult = await db2.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [req.params.id]
      );
      if (testResult.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testResult.rows[0];
      const user = await getAuthUser2(req);
      if (user?.role !== "admin") {
        const needsGate = !!test.course_id || !!test.mini_course_id && !test.folder_is_free || test.price && parseFloat(String(test.price)) > 0;
        if (needsGate) {
          if (!user) return res.status(401).json({ message: "Not authenticated" });
          const a = await assertTestAccess(db2, user, test, String(req.params.id));
          if (!a.ok) return res.status(403).json({ message: a.message });
        }
      }
      const result = await db2.query(
        `SELECT DISTINCT ON (ta.user_id)
           ta.score, ta.percentage, ta.time_taken_seconds, u.name, u.id as user_id
         FROM test_attempts ta JOIN users u ON ta.user_id = u.id 
         WHERE ta.test_id = $1 AND ta.status = 'completed' 
         ORDER BY ta.user_id, ta.score DESC, ta.time_taken_seconds ASC`,
        [req.params.id]
      );
      const sorted = result.rows.sort((a, b) => {
        const scoreDiff = parseFloat(b.score) - parseFloat(a.score);
        if (scoreDiff !== 0) return scoreDiff;
        return (a.time_taken_seconds || 0) - (b.time_taken_seconds || 0);
      });
      const leaderboard = sorted.slice(0, 20).map((r, i) => ({ ...r, rank: i + 1 }));
      res.json(leaderboard);
    } catch {
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });
  app2.get("/api/my-attempts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT ta.*, t.title, t.total_marks, t.test_type FROM test_attempts ta 
         JOIN tests t ON ta.test_id = t.id 
         WHERE ta.user_id = $1 AND ta.status = 'completed'
           AND (t.course_id IS NULL OR t.course_id IN (SELECT id FROM courses WHERE course_type = 'test_series'))
         ORDER BY ta.completed_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempts" });
    }
  });
  app2.get("/api/my-attempts/summary", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT DISTINCT ON (ta.test_id)
           ta.test_id, ta.id AS attempt_id, ta.score, ta.total_marks, ta.percentage,
           ta.correct, ta.incorrect, ta.attempted, ta.time_taken_seconds, ta.completed_at
         FROM test_attempts ta
         WHERE ta.user_id = $1 AND ta.status = 'completed'
         ORDER BY ta.test_id, ta.completed_at ASC`,
        [user.id]
      );
      const summary = {};
      result.rows.forEach((row) => {
        summary[row.test_id] = row;
      });
      res.json(summary);
    } catch {
      res.status(500).json({ message: "Failed to fetch attempt summary" });
    }
  });
  app2.get("/api/attempts/:attemptId/detail", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const attempt = await db2.query("SELECT * FROM test_attempts WHERE id = $1 AND user_id = $2", [req.params.attemptId, user.id]);
      if (attempt.rows.length === 0) return res.status(404).json({ message: "Attempt not found" });
      const att = attempt.rows[0];
      const questions = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index", [att.test_id]);
      const answers = typeof att.answers === "string" ? JSON.parse(att.answers) : att.answers || {};
      const qTimes = att.question_times ? typeof att.question_times === "string" ? JSON.parse(att.question_times) : att.question_times : {};
      res.json({
        attemptId: att.id,
        testId: att.test_id,
        score: att.score,
        totalMarks: att.total_marks,
        timeTakenSeconds: att.time_taken_seconds,
        questions: questions.rows.map((q) => ({
          ...q,
          userAnswer: answers[q.id] || null,
          isCorrect: answers[q.id] === q.correct_option,
          timeTaken: qTimes[q.id] || null
        }))
      });
    } catch {
      res.status(500).json({ message: "Failed to fetch attempt detail" });
    }
  });
  app2.post("/api/questions/:id/report", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { reason, details } = req.body;
      await db2.query(
        `INSERT INTO question_reports (question_id, user_id, reason, details, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (question_id, user_id) DO UPDATE SET reason=$3, details=$4, created_at=$5`,
        [req.params.id, user.id, reason, details || null, Date.now()]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to submit report" });
    }
  });
}
var init_test_attempt_routes = __esm({
  "server/test-attempt-routes.ts"() {
    "use strict";
    init_test_access_guards();
  }
});

// server/live-class-routes.ts
function registerLiveClassRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
  app2.get("/api/live-classes", async (req, res) => {
    try {
      const { courseId, admin: admin2 } = req.query;
      const user = await getAuthUser2(req);
      const cid = courseId ? String(courseId) : null;
      if (admin2 === "true" && user?.role === "admin") {
        if (cid) {
          const result3 = await db2.query(
            "SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id WHERE lc.course_id = $1 ORDER BY lc.scheduled_at DESC",
            [cid]
          );
          res.set("Cache-Control", "private, no-store");
          return res.json(result3.rows);
        }
        const result2 = await db2.query("SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id ORDER BY lc.scheduled_at DESC");
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows);
      }
      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1)
           AND (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND (
                (lc.course_id = $1 AND (lc.is_free_preview = TRUE OR ${ex23}))
             ))
             OR (lc.is_live = TRUE AND (
                 OR (lc.course_id = $1 AND (lc.is_free_preview = TRUE OR ${ex23}))
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 OR (lc.course_id = $1 AND (lc.is_free_preview = TRUE OR ${ex23}))
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid, user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows);
      }
      if (cid) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (lc.course_id = $1)
           AND (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND (
                (lc.course_id = $1 AND lc.is_free_preview = TRUE)
             ))
             OR (lc.is_live = TRUE AND (
                 OR (lc.course_id = $1 AND lc.is_free_preview = TRUE)
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 OR (lc.course_id = $1 AND lc.is_free_preview = TRUE)
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [cid]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows);
      }
      const ex12 = sqlEnrollmentExistsForLiveList(1, 2);
      if (user) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex12} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (
             (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             ))
             OR (lc.is_live = TRUE AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             ))
             OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                 (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                 OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             ))
           )
           ORDER BY lc.scheduled_at DESC`,
          [user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows);
      }
      const result = await db2.query(
        `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
         FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
         WHERE (
           (lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND (
                (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           ))
           OR (lc.is_live = TRUE AND (
                (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           ))
           OR (lc.is_completed = TRUE AND (lc.recording_url IS NOT NULL OR lc.cf_playback_hls IS NOT NULL) AND (
                (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
                OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           ))
         )
         ORDER BY lc.scheduled_at DESC`
      );
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch (err) {
      console.error("[LiveClasses] list error:", err);
      res.set("Cache-Control", "private, no-store");
      res.json([]);
    }
  });
  app2.get("/api/upcoming-classes", async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
        FROM live_classes lc
        LEFT JOIN courses c ON c.id = lc.course_id
        WHERE lc.is_completed IS NOT TRUE
        ORDER BY 
          lc.is_live DESC,
          lc.scheduled_at ASC NULLS LAST
        LIMIT 50
      `);
      console.log(`[UpcomingClasses] returning ${result.rows.length} classes`);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.set("Cache-Control", "private, no-store");
      res.json([]);
    }
  });
  app2.get("/api/live-classes/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const result = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const lc = result.rows[0];
      let isEnrolled = false;
      if (user && lc.course_id) {
        const enroll = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, lc.course_id]);
        isEnrolled = enroll.rows.length > 0 && !isEnrollmentExpired(enroll.rows[0]);
      }
      const hasAccess = await userCanAccessLiveClassContent(db2, user, lc);
      res.set("Cache-Control", "private, no-store");
      res.json({ ...lc, is_enrolled: isEnrolled, has_access: hasAccess });
    } catch {
      res.status(500).json({ message: "Failed to fetch live class" });
    }
  });
}
var init_live_class_routes = __esm({
  "server/live-class-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_live_class_access();
  }
});

// server/admin-live-class-manage-routes.ts
function registerAdminLiveClassManageRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  getR2Client
}) {
  app2.post("/api/admin/live-classes/cleanup", requireAdmin, async (_req, res) => {
    try {
      console.log("[Cleanup] Starting live class cleanup...");
      const findResult = await db2.query(`
        SELECT id, title FROM live_classes WHERE is_live = true ORDER BY scheduled_at DESC
      `);
      if (findResult.rows.length === 0) {
        return res.json({ success: true, message: "No cleanup needed", cleaned: 0, classes: [] });
      }
      const updateResult = await db2.query(`
        UPDATE live_classes SET is_live = false, is_completed = true
        WHERE is_live = true RETURNING id, title
      `);
      console.log(`[Cleanup] Marked ${updateResult.rows.length} live classes as completed`);
      res.json({ success: true, message: `Marked ${updateResult.rows.length} live classes as completed`, cleaned: updateResult.rows.length, classes: updateResult.rows });
    } catch (err) {
      console.error("[Cleanup] Error:", err);
      res.status(500).json({ message: "Failed to cleanup live classes" });
    }
  });
  app2.put("/api/admin/live-classes/:id", requireAdmin, async (req, res) => {
    try {
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid } = req.body;
      const updates = [];
      const params = [];
      const add = (col, val) => {
        params.push(val);
        updates.push(col + " = $" + params.length);
      };
      if (isLive !== void 0) add("is_live", isLive);
      if (isCompleted !== void 0) add("is_completed", isCompleted);
      if (isLive === true) add("started_at", Date.now());
      if (isCompleted === true || isLive === false) add("ended_at", Date.now());
      if (youtubeUrl !== void 0) add("youtube_url", youtubeUrl);
      if (title !== void 0) add("title", title);
      if (description !== void 0) add("description", description);
      if (scheduledAt !== void 0) add("scheduled_at", scheduledAt);
      if (notifyEmail !== void 0) add("notify_email", notifyEmail);
      if (notifyBell !== void 0) add("notify_bell", notifyBell);
      if (isFreePreview !== void 0) add("is_free_preview", isFreePreview);
      if (streamType !== void 0) add("stream_type", streamType);
      if (chatMode !== void 0) add("chat_mode", chatMode);
      if (showViewerCount !== void 0) add("show_viewer_count", showViewerCount);
      if (recordingUrl !== void 0) add("recording_url", recordingUrl);
      if (cfStreamUid !== void 0) add("cf_stream_uid", cfStreamUid);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== void 0) add("is_public", isPublicVal);
      if (updates.length === 0) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const whereIdx = "$" + params.length;
      const sql = "UPDATE live_classes SET " + updates.join(", ") + " WHERE id = " + whereIdx + " RETURNING *";
      const result = await db2.query(sql, params);
      const liveClass = result.rows[0];
      if (isLive === true && liveClass.course_id) {
        const recipients = liveClass.is_free_preview === true || liveClass.is_public === true ? await db2.query("SELECT id AS user_id FROM users WHERE role = 'student'") : await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = Date.now() + 6 * 36e5;
        for (const e of recipients.rows) {
          await db2.query("INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
            e.user_id,
            "\u{1F534} Live Class Started!",
            '"' + liveClass.title + '" is live now. Join now!',
            "info",
            Date.now(),
            expiresAt
          ]);
        }
        console.log("[GoLive] Notification sent for '" + liveClass.title + "' to " + recipients.rows.length + " students");
      }
      if (isLive === true) {
        const syncUpdates = [];
        const syncParams = [];
        const syncAdd = (col, val) => {
          syncParams.push(val);
          syncUpdates.push(col + " = $" + syncParams.length);
        };
        syncAdd("is_live", true);
        syncAdd("started_at", Date.now());
        if (youtubeUrl !== void 0) syncAdd("youtube_url", youtubeUrl);
        if (streamType !== void 0) syncAdd("stream_type", streamType);
        if (chatMode !== void 0) syncAdd("chat_mode", chatMode);
        if (showViewerCount !== void 0) syncAdd("show_viewer_count", showViewerCount);
        if (cfStreamUid !== void 0) syncAdd("cf_stream_uid", cfStreamUid);
        const cfStreamKey = req.body.cfStreamKey;
        const cfStreamRtmpUrl = req.body.cfStreamRtmpUrl;
        const cfPlaybackHls = req.body.cfPlaybackHls;
        if (cfStreamKey !== void 0) syncAdd("cf_stream_key", cfStreamKey);
        if (cfStreamRtmpUrl !== void 0) syncAdd("cf_stream_rtmp_url", cfStreamRtmpUrl);
        if (cfPlaybackHls !== void 0) syncAdd("cf_playback_hls", cfPlaybackHls);
        syncParams.push(req.params.id);
        syncParams.push(liveClass.title);
        await db2.query(
          `UPDATE live_classes SET ${syncUpdates.join(", ")} 
           WHERE id != $${syncParams.length - 1} 
             AND title = $${syncParams.length}
             AND is_completed IS NOT TRUE`,
          syncParams
        ).catch(() => {
        });
        const otherClasses = await db2.query("SELECT course_id FROM live_classes WHERE id != $1 AND title = $2 AND is_completed IS NOT TRUE AND course_id IS NOT NULL", [req.params.id, liveClass.title]).catch(() => ({ rows: [] }));
        const expiresAt = Date.now() + 12 * 36e5;
        for (const other of otherClasses.rows) {
          const enrolled = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [other.course_id]).catch(() => ({ rows: [] }));
          for (const e of enrolled.rows) {
            await db2.query("INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING", [
              e.user_id,
              "\u{1F534} Live Class Started!",
              '"' + liveClass.title + '" is live now. Join now!',
              "info",
              Date.now(),
              expiresAt
            ]).catch(() => {
            });
          }
        }
      }
      if (isCompleted && convertToLecture && liveClass.youtube_url && liveClass.course_id) {
        await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClass.title + "%"]).catch(() => {
        });
        const maxOrder = await db2.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [liveClass.course_id]);
        await db2.query(
          "INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [liveClass.course_id, liveClass.title, liveClass.description || "", liveClass.youtube_url, "youtube", 0, maxOrder.rows[0].next_order, false, sectionTitle || "Live Class Recordings", Date.now()]
        );
        await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [liveClass.course_id]);
      }
      if (isCompleted && !convertToLecture && liveClass.title) {
        await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClass.title + "%"]).catch(() => {
        });
      }
      if (isCompleted === true || isLive === false) {
        await db2.query(
          `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live IS NOT TRUE 
             AND is_completed IS NOT TRUE
             AND title = $2`,
          [req.params.id, liveClass.title]
        ).catch(() => {
        });
        await db2.query(
          `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live = TRUE
             AND title = $2`,
          [req.params.id, liveClass.title]
        ).catch(() => {
        });
      }
      res.json(liveClass);
    } catch (err) {
      console.error("Update live class error:", err);
      res.status(500).json({ message: "Failed to update live class" });
    }
  });
  app2.delete("/api/admin/live-classes/:id", requireAdmin, async (req, res) => {
    try {
      await db2.query("DELETE FROM live_classes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete live class" });
    }
  });
  app2.put("/api/admin/study-materials/:id", requireAdmin, async (req, res) => {
    try {
      const { title, description, fileUrl, fileType, isFree, sectionTitle, downloadAllowed } = req.body;
      await db2.query(`UPDATE study_materials SET title=$1, description=$2, file_url=$3, file_type=$4, is_free=$5, section_title=$6, download_allowed=$7 WHERE id=$8`, [
        title,
        description || "",
        fileUrl,
        fileType || "pdf",
        isFree || false,
        sectionTitle || null,
        downloadAllowed || false,
        req.params.id
      ]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update material" });
    }
  });
  app2.delete("/api/admin/study-materials/:id", requireAdmin, async (req, res) => {
    try {
      const material = await db2.query("SELECT file_url, course_id FROM study_materials WHERE id = $1", [req.params.id]);
      if (material.rows.length > 0 && material.rows[0].file_url) {
        try {
          const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
          const r2 = await getR2Client();
          let r2Key = material.rows[0].file_url;
          if (r2Key.startsWith("http")) {
            try {
              const url = new URL(r2Key);
              r2Key = url.pathname.substring(1);
            } catch (_e) {
            }
          }
          const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: r2Key
          });
          await r2.send(deleteCommand);
          console.log(`[R2] Deleted study material file: ${r2Key}`);
        } catch (r2Err) {
          console.error("[R2] Failed to delete study material file:", r2Err);
        }
      }
      const courseId = material.rows[0]?.course_id;
      await db2.query("DELETE FROM study_materials WHERE id = $1", [req.params.id]);
      if (courseId) {
        await db2.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [courseId]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete study material error:", err);
      res.status(500).json({ message: "Failed to delete material" });
    }
  });
}
var init_admin_live_class_manage_routes = __esm({
  "server/admin-live-class-manage-routes.ts"() {
    "use strict";
  }
});

// server/course-access-routes.ts
function registerCourseAccessRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  generateSecureToken: generateSecureToken2,
  cacheInvalidate: cacheInvalidate2,
  getR2Client
}) {
  app2.post("/api/media-token", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { fileKey } = req.body;
      if (!fileKey || typeof fileKey !== "string") return res.status(400).json({ message: "fileKey required" });
      const token = generateSecureToken2();
      const expiresAt = Date.now() + 10 * 60 * 1e3;
      await db2.query("INSERT INTO media_tokens (token, user_id, file_key, expires_at) VALUES ($1, $2, $3, $4)", [token, user.id, fileKey, expiresAt]);
      db2.query("DELETE FROM media_tokens WHERE expires_at < $1", [Date.now()]).catch(() => {
      });
      res.json({ token, expiresAt });
    } catch {
      res.status(500).json({ message: "Failed to generate token" });
    }
  });
  app2.get("/api/courses", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      console.log(`[Courses] auth user=${user?.id || "none"}`);
      const { category, search } = req.query;
      let query = user?.role === "admin" ? "SELECT c.*, (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials FROM courses c WHERE 1=1" : "SELECT c.*, (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials FROM courses c WHERE c.is_published = TRUE";
      const params = [];
      if (search) {
        params.push(`%${search}%`);
        query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
      }
      if (category && category !== "All") {
        params.push(category);
        query += ` AND category = $${params.length}`;
      }
      query += " ORDER BY created_at DESC";
      const result = await db2.query(query, params);
      let courses = result.rows;
      if (user) {
        const enrollResult = await db2.query("SELECT course_id, progress_percent FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL)", [user.id]);
        const enrollMap = /* @__PURE__ */ new Map();
        enrollResult.rows.forEach((e) => {
          enrollMap.set(Number(e.course_id), Number(e.progress_percent) || 0);
        });
        courses = courses.map((c) => ({
          ...c,
          isEnrolled: enrollMap.has(Number(c.id)),
          progress: enrollMap.get(Number(c.id)) ?? 0
        }));
        console.log(`[Courses] user ${user.id} progress map:`, JSON.stringify(Object.fromEntries(enrollMap)));
      }
      res.set("Cache-Control", "private, no-store");
      if (user) {
        const enrolledCourses = courses.filter((c) => c.isEnrolled);
        void enrolledCourses;
      }
      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });
  app2.get("/api/courses/:id/folders", async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM course_folders WHERE course_id = $1 AND is_hidden = FALSE ORDER BY created_at ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.get("/api/courses/:id", async (req, res) => {
    try {
      let user = await getAuthUser2(req);
      if (!user && req.query._uid) {
        const uid = parseInt(String(req.query._uid));
        if (uid > 0) {
          try {
            const r = await db2.query("SELECT id, name, email, phone, role FROM users WHERE id = $1", [uid]);
            if (r.rows.length > 0) user = r.rows[0];
          } catch (_e) {
          }
        }
      }
      const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const course = courseResult.rows[0];
      const endTs = course.end_date != null && String(course.end_date).trim() !== "" ? Date.parse(String(course.end_date).trim()) : null;
      if (Number.isFinite(endTs) && endTs < Date.now()) {
        course.courseEnded = true;
      } else {
        course.courseEnded = false;
      }
      const lecturesResult = await db2.query("SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index", [req.params.id]);
      const testsResult = await db2.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE ORDER BY created_at DESC, id DESC", [req.params.id]);
      const materialsResult = await db2.query("SELECT * FROM study_materials WHERE course_id = $1", [req.params.id]);
      if (user) {
        const enroll = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, req.params.id]);
        const row = enroll.rows[0];
        const accessExpired = row && isEnrollmentExpired(row);
        course.isEnrolled = enroll.rows.length > 0 && !accessExpired;
        course.accessExpired = accessExpired || false;
        course.enrollmentValidUntil = row && row.valid_until != null ? row.valid_until : null;
        course.progress = row && !accessExpired ? row?.progress_percent || 0 : 0;
        course.lastLectureId = row && !accessExpired ? row?.last_lecture_id : null;
        if (course.isEnrolled) {
          const lpResult = await db2.query("SELECT * FROM lecture_progress WHERE user_id = $1", [user.id]);
          const lpMap = {};
          lpResult.rows.forEach((lp) => {
            lpMap[lp.lecture_id] = lp.is_completed;
          });
          lecturesResult.rows.forEach((l) => {
            l.isCompleted = lpMap[l.id] || false;
          });
        }
      }
      res.set("Cache-Control", "private, no-store");
      res.json({
        ...course,
        total_materials: materialsResult.rows.length,
        lectures: lecturesResult.rows,
        tests: testsResult.rows,
        materials: materialsResult.rows
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch course" });
    }
  });
  app2.post("/api/courses/:id/enroll", async (req, res) => {
    try {
      const requester = await getAuthUser2(req);
      let user = requester;
      if (!user && req.body.userId) {
        const uid = parseInt(req.body.userId);
        if (uid > 0) {
          const r = await db2.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
          if (r.rows.length > 0) user = r.rows[0];
        }
      }
      const isAdminGrant = requester?.role === "admin" && req.body.userId && requester.id !== parseInt(req.body.userId);
      if (isAdminGrant) {
        const uid = parseInt(req.body.userId);
        const r = await db2.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
        if (r.rows.length > 0) user = r.rows[0];
      } else if (user && req.body.userId && user.id !== parseInt(req.body.userId)) {
        const uid = parseInt(req.body.userId);
        if (uid > 0) {
          const r = await db2.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
          if (r.rows.length > 0) {
            console.log(`[Enroll] Token user ${user.id} != body userId ${uid}, using body userId`);
            user = r.rows[0];
          }
        }
      }
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [req.params.id]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const courseRow = courseResult.rows[0];
      if (!courseRow.is_free && !isAdminGrant) return res.status(403).json({ message: "This course requires payment" });
      const existing = await db2.query("SELECT id, status FROM enrollments WHERE user_id = $1 AND course_id = $2", [user.id, req.params.id]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].status === "inactive" && isAdminGrant) {
          await db2.query("UPDATE enrollments SET status = 'active' WHERE id = $1", [existing.rows[0].id]);
          return res.json({ success: true, reactivated: true });
        }
        return res.json({ success: true, alreadyEnrolled: true });
      }
      const at = Date.now();
      const vu = computeEnrollmentValidUntil(courseRow, at);
      await db2.query("INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until) VALUES ($1, $2, $3, $4)", [user.id, req.params.id, at, vu]);
      await db2.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [req.params.id]);
      cacheInvalidate2("courses:");
      res.json({ success: true });
    } catch (err) {
      console.error("Enroll error:", err);
      res.status(500).json({ message: "Failed to enroll" });
    }
  });
  app2.get("/api/my-courses", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT c.*, e.progress_percent, e.enrolled_at FROM courses c 
         JOIN enrollments e ON c.id = e.course_id 
         WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrolled courses" });
    }
  });
  app2.get("/api/my-downloads", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const materialsResult = await db2.query(
        `SELECT sm.id, sm.title, sm.file_url, sm.file_type, sm.section_title, sm.download_allowed,
                c.title AS course_title, 'material' AS type, ud.downloaded_at, ud.local_filename
         FROM user_downloads ud
         JOIN study_materials sm ON ud.item_id = sm.id
         LEFT JOIN courses c ON sm.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'material' AND sm.download_allowed = TRUE
         AND (e.valid_until IS NULL OR e.valid_until > $2 OR c.id IS NULL)
         ORDER BY ud.downloaded_at DESC`,
        [user.id, Date.now()]
      );
      const lecturesResult = await db2.query(
        `SELECT l.id, l.title, COALESCE(l.video_url, l.pdf_url) AS file_url,
                CASE WHEN l.video_url IS NOT NULL AND l.video_url != '' THEN 'video' ELSE 'pdf' END AS file_type,
                l.section_title,
                c.title AS course_title, 'lecture' AS type, ud.downloaded_at, ud.local_filename
         FROM user_downloads ud
         JOIN lectures l ON ud.item_id = l.id
         JOIN courses c ON l.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'lecture' AND l.download_allowed = TRUE
         AND (e.valid_until IS NULL OR e.valid_until > $2)
         ORDER BY ud.downloaded_at DESC`,
        [user.id, Date.now()]
      );
      res.json({
        materials: Array.isArray(materialsResult.rows) ? materialsResult.rows : [],
        lectures: Array.isArray(lecturesResult.rows) ? lecturesResult.rows : []
      });
    } catch (err) {
      console.error("[Downloads] fetch error:", err);
      res.json({ materials: [], lectures: [] });
    }
  });
  app2.post("/api/my-downloads", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId, localFilename } = req.body;
      if (!itemType || !itemId) return res.status(400).json({ message: "itemType and itemId required" });
      await db2.query(
        "INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET downloaded_at = EXTRACT(EPOCH FROM NOW()) * 1000, local_filename = EXCLUDED.local_filename",
        [user.id, itemType, itemId, localFilename || null]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to track download" });
    }
  });
  app2.delete("/api/my-downloads/:itemType/:itemId", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { itemType, itemId } = req.params;
      const result = await db2.query("DELETE FROM user_downloads WHERE user_id = $1 AND item_type = $2 AND item_id = $3", [user.id, itemType, itemId]);
      if ((result.rowCount || 0) === 0) return res.status(404).json({ message: "Download record not found" });
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete download" });
    }
  });
  app2.get("/api/download-url", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user || user.role !== "student") {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { itemType, itemId } = req.query;
      if (!itemType || !itemId || !["lecture", "material"].includes(String(itemType))) {
        return res.status(400).json({ message: "Valid itemType (lecture|material) and itemId required" });
      }
      const id = parseInt(String(itemId));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid itemId" });
      let courseId = null;
      let downloadAllowed = false;
      let r2Key = null;
      if (itemType === "lecture") {
        const lectureResult = await db2.query("SELECT course_id, download_allowed, video_url FROM lectures WHERE id = $1", [id]);
        if (lectureResult.rows.length === 0) {
          return res.status(404).json({ message: "Lecture not found" });
        }
        const lecture = lectureResult.rows[0];
        courseId = lecture.course_id;
        downloadAllowed = lecture.download_allowed;
        r2Key = lecture.video_url;
      } else if (itemType === "material") {
        const materialResult = await db2.query("SELECT course_id, download_allowed, file_url FROM study_materials WHERE id = $1", [id]);
        if (materialResult.rows.length === 0) {
          return res.status(404).json({ message: "Material not found" });
        }
        const material = materialResult.rows[0];
        courseId = material.course_id;
        downloadAllowed = material.download_allowed;
        r2Key = material.file_url;
      }
      if (!downloadAllowed) {
        return res.status(403).json({ message: "Download not allowed for this item" });
      }
      if (!r2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }
      if (courseId) {
        const enrollmentResult = await db2.query(
          "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
          [user.id, courseId]
        );
        if (enrollmentResult.rows.length === 0) {
          return res.status(403).json({ message: "Not enrolled in this course" });
        }
        const enrollment = enrollmentResult.rows[0];
        if (enrollment.valid_until && enrollment.valid_until < Date.now()) {
          return res.status(403).json({ message: "Course access has expired" });
        }
      }
      let cleanR2Key = r2Key;
      if (r2Key.startsWith("http")) {
        try {
          const url = new URL(r2Key);
          cleanR2Key = url.pathname.substring(1);
        } catch (_e) {
          cleanR2Key = r2Key;
        }
      }
      const { randomUUID } = await import("crypto");
      const token = randomUUID();
      const createdAt = Date.now();
      const expiresAt = createdAt + 3e4;
      await db2.query("INSERT INTO download_tokens (token, user_id, item_type, item_id, r2_key, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        token,
        user.id,
        itemType,
        id,
        cleanR2Key,
        createdAt,
        expiresAt
      ]);
      res.json({ token, expiresAt });
    } catch (err) {
      console.error("[download-url] Error:", err);
      res.status(500).json({ message: "Failed to generate download token" });
    }
  });
  app2.get("/api/download-proxy", async (req, res) => {
    try {
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token required" });
      }
      const tokenResult = await db2.query("SELECT * FROM download_tokens WHERE token = $1 AND used = FALSE AND expires_at > $2", [token, Date.now()]);
      if (tokenResult.rows.length === 0) {
        return res.status(403).json({ message: "Token invalid, expired, or already used" });
      }
      const tokenData = tokenResult.rows[0];
      await db2.query("UPDATE download_tokens SET used = TRUE WHERE token = $1", [token]);
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const command = new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: tokenData.r2_key
      });
      const r2Response = await r2.send(command);
      if (!r2Response.Body) {
        return res.status(404).json({ message: "File not found in storage" });
      }
      const { createHmac: createHmac2 } = await import("crypto");
      const timestamp = Date.now();
      const watermarkData = `${tokenData.user_id}:${timestamp}`;
      const hmac = createHmac2("sha256", process.env.SESSION_SECRET || "default-secret").update(watermarkData).digest("hex");
      const watermarkToken = `${watermarkData}:${hmac}`;
      res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("X-Watermark-Token", watermarkToken);
      if (r2Response.ContentLength) {
        res.setHeader("Content-Length", r2Response.ContentLength);
      }
      const stream = r2Response.Body;
      stream.pipe(res);
      stream.on("error", (err) => {
        console.error("[download-proxy] Stream error:", err);
        if (!res.headersSent) {
          res.status(500).json({ message: "Stream error" });
        }
      });
    } catch (err) {
      console.error("[download-proxy] Error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to download file" });
      }
    }
  });
  app2.get("/api/my-payments", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT p.id, p.amount, p.currency, p.status, p.created_at,
                c.title AS course_title, c.price AS course_price
         FROM payments p
         JOIN courses c ON p.course_id = c.id
         WHERE p.user_id = $1 AND p.status = 'paid'
         ORDER BY p.created_at DESC`,
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch payments" });
    }
  });
}
var init_course_access_routes = __esm({
  "server/course-access-routes.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/upload-routes.ts
function registerUploadRoutes({
  app: app2,
  requireAdmin,
  getAuthUser: getAuthUser2,
  getR2Client,
  uploadLarge: uploadLarge2
}) {
  app2.post("/api/upload/presign-profile", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { filename, contentType } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      if (!contentType.startsWith("image/")) return res.status(400).json({ message: "Only image uploads allowed" });
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const ext = filename.split(".").pop() || "jpg";
      const key = `images/profile-${user.id}-${Date.now()}.${ext}`;
      const command = new PutObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, ContentType: contentType });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      const publicUrl = key;
      res.json({ uploadUrl, publicUrl, key });
    } catch (err) {
      console.error("[R2] Profile presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });
  app2.post("/api/upload/presign", requireAdmin, async (req, res) => {
    try {
      const { filename, contentType, folder = "uploads" } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured. Check .env file." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const ext = filename.split(".").pop() || "";
      const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType
      });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5e3}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });
  app2.post("/api/upload/to-r2", requireAdmin, uploadLarge2.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const file = req.file;
      const folder = req.body.folder || "uploads";
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const ext = file.originalname.split(".").pop() || "";
      const key = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype
        })
      );
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5e3}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Server upload complete: ${key} (${file.size} bytes)`);
      res.json({ publicUrl, key });
    } catch (err) {
      console.error("[R2] Server upload error:", err?.message || err);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });
  app2.delete("/api/upload/file", requireAdmin, async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ message: "key required" });
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
      res.json({ success: true });
    } catch (err) {
      console.error("[R2] Delete error:", err);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });
}
var init_upload_routes = __esm({
  "server/upload-routes.ts"() {
    "use strict";
  }
});

// server/media-stream-routes.ts
function registerMediaStreamRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  getR2Client
}) {
  app2.get("/api/media/:folder/:filename", async (req, res) => {
    try {
      const key = `${req.params.folder}/${req.params.filename}`;
      if (!key || key === "/") return res.status(400).json({ message: "No file key" });
      const mediaToken = req.query.token;
      let userId = null;
      let userRole = "student";
      if (mediaToken) {
        const tokenResult = await db2.query("SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [mediaToken, Date.now(), key]);
        if (tokenResult.rows.length === 0) return res.status(401).json({ message: "Token expired or invalid" });
        userId = tokenResult.rows[0].user_id;
        const userResult = await db2.query("SELECT role FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length > 0) userRole = userResult.rows[0].role;
      } else {
        const user = await getAuthUser2(req);
        if (!user) return res.status(401).json({ message: "Unauthorized" });
        userId = user.id;
        userRole = user.role;
      }
      if (userRole !== "admin") {
        const matResult = await db2.query("SELECT course_id, is_free FROM study_materials WHERE file_url LIKE $1", [`%${key}%`]);
        if (matResult.rows.length > 0) {
          const mat = matResult.rows[0];
          if (mat.course_id && !mat.is_free) {
            const enrolled = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [userId, mat.course_id]);
            if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) return res.status(403).json({ message: "Enrollment required" });
          }
        } else {
          const lecResult = await db2.query("SELECT course_id, is_free_preview FROM lectures WHERE video_url LIKE $1 OR pdf_url LIKE $1", [`%${key}%`]);
          if (lecResult.rows.length > 0) {
            const lec = lecResult.rows[0];
            if (lec.course_id && !lec.is_free_preview) {
              const enrolled = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [userId, lec.course_id]);
              if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) return res.status(403).json({ message: "Enrollment required" });
            }
          }
        }
      }
      const { GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const head = await r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
        const totalSize = head.ContentLength || 0;
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;
        const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key, Range: `bytes=${start}-${end}` });
        const obj = await r2.send(command);
        if (!obj.Body) return res.status(404).json({ message: "File not found" });
        res.status(206);
        res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Content-Length", String(chunkSize));
        if (head.ContentType) res.setHeader("Content-Type", head.ContentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Content-Disposition", "inline");
        const stream = obj.Body;
        if (typeof stream.pipe === "function") stream.pipe(res);
        else if (stream.transformToByteArray) {
          const bytes = await stream.transformToByteArray();
          res.end(Buffer.from(bytes));
        } else res.status(500).json({ message: "Cannot stream file" });
      } else {
        const command = new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key });
        const obj = await r2.send(command);
        if (!obj.Body) return res.status(404).json({ message: "File not found" });
        if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
        if (obj.ContentLength) res.setHeader("Content-Length", String(obj.ContentLength));
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("Content-Disposition", "inline");
        const stream = obj.Body;
        if (typeof stream.pipe === "function") stream.pipe(res);
        else if (stream.transformToByteArray) {
          const bytes = await stream.transformToByteArray();
          res.end(Buffer.from(bytes));
        } else res.status(500).json({ message: "Cannot stream file" });
      }
    } catch (err) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      res.status(500).json({ message: "Failed to fetch file" });
    }
  });
}
var init_media_stream_routes = __esm({
  "server/media-stream-routes.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// server/routes.ts
var routes_exports = {};
__export(routes_exports, {
  registerRoutes: () => registerRoutes
});
import { createServer } from "node:http";
import { Pool } from "pg";
import multer from "multer";
import { createRequire as createRequire2 } from "module";
function normalizeDatabaseUrl(raw) {
  try {
    const parsed = new URL(raw);
    const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    if (!sslMode || sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}
async function dbQuery(text, params) {
  const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || "300");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await pool.query(text, params);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= slowQueryThresholdMs) {
        const compactSql = text.replace(/\s+/g, " ").trim().slice(0, 220);
        console.warn("[DB] Slow query", { elapsedMs, attempt, sql: compactSql });
      }
      return result;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const isTransient = err.message?.includes("Connection terminated") || err.message?.includes("connection timeout") || err.code === "ECONNRESET" || err.code === "ECONNREFUSED";
      if (isTransient && attempt < 3) {
        console.warn("[DB] Transient error on attempt " + attempt + ", retrying...");
        await new Promise((r) => setTimeout(r, 200 * attempt));
        continue;
      }
      console.error("[DB] Query failed", {
        elapsedMs,
        attempt,
        code: err?.code,
        message: err?.message
      });
      throw err;
    }
  }
}
function cacheInvalidate(pattern) {
  for (const key of cache.keys()) {
    if (key.startsWith(pattern)) cache.delete(key);
  }
}
function generateOTP() {
  return Math.floor(1e5 + Math.random() * 9e5).toString();
}
async function getAuthUser(req) {
  return getAuthUserFromRequest(req, db);
}
async function sendOTPviaSMS(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.log(`[SMS] No FAST2SMS_API_KEY set for ${phone}`);
    return false;
  }
  try {
    console.log(`[SMS] Sending OTP via Quick SMS route to ${phone}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15e3);
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        route: "q",
        message: `Your 3i Learning verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
        numbers: phone,
        flash: "0"
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    console.log(`[SMS] Quick SMS response:`, JSON.stringify(data));
    if (data.return === true) {
      console.log(`[SMS] OTP sent successfully to ${phone}`);
      return true;
    }
    console.error(`[SMS] Quick SMS failed:`, data.message || JSON.stringify(data));
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[SMS] Quick SMS timeout for ${phone}`);
    } else {
      console.error(`[SMS] Quick SMS error:`, err);
    }
  }
  try {
    console.log(`[SMS] Trying OTP route as fallback for ${phone}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15e3);
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(phone)}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    console.log(`[SMS] OTP route response:`, JSON.stringify(data));
    if (data.return === true) {
      console.log(`[SMS] OTP route sent successfully to ${phone}`);
      return true;
    }
    console.error(`[SMS] OTP route failed:`, data.message || JSON.stringify(data));
  } catch (err) {
    if (err.name === "AbortError") {
      console.error(`[SMS] OTP route timeout for ${phone}`);
    } else {
      console.error(`[SMS] OTP route error:`, err);
    }
  }
  return false;
}
async function updateCourseTestCounts(courseId) {
  const id = String(courseId);
  await db.query(`
    UPDATE courses SET
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'pyq'),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'mock'),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1 AND test_type = 'practice')
    WHERE id = $1
  `, [id]);
}
async function updateCourseProgress(userId, courseId) {
  const cid = String(courseId);
  try {
    const totalLec = await db.query("SELECT COUNT(*) FROM lectures WHERE course_id = $1", [cid]);
    const totalTests = await db.query("SELECT COUNT(*) FROM tests WHERE course_id = $1 AND is_published = TRUE", [cid]);
    const totalLive = await db.query("SELECT COUNT(*) FROM live_classes WHERE course_id = $1 AND is_completed = TRUE", [cid]);
    const completedLec = await db.query(
      `SELECT COUNT(*) FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id 
       WHERE lp.user_id = $1 AND l.course_id = $2 AND lp.is_completed = TRUE`,
      [userId, cid]
    );
    const completedTests = await db.query(
      `SELECT COUNT(DISTINCT test_id) FROM test_attempts 
       WHERE user_id = $1 AND test_id IN (SELECT id FROM tests WHERE course_id = $2) AND status = 'completed'`,
      [userId, cid]
    );
    const total = parseInt(totalLec.rows[0].count) + parseInt(totalTests.rows[0].count);
    const completed = parseInt(completedLec.rows[0].count) + parseInt(completedTests.rows[0].count);
    const progress = total > 0 ? Math.round(completed / total * 100) : 0;
    await db.query(
      "UPDATE enrollments SET progress_percent = $1 WHERE user_id = $2 AND course_id = $3",
      [progress, userId, cid]
    );
  } catch (err) {
    console.error("[Progress] Failed to update:", err);
  }
}
async function deleteDownloadsForUser(userId, courseId) {
  try {
    if (courseId) {
      await db.query(
        `DELETE FROM user_downloads 
         WHERE user_id = $1 
         AND (
           (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $2))
           OR
           (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $2))
         )`,
        [userId, courseId]
      );
      console.log(`[Cleanup] Deleted downloads for user ${userId} in course ${courseId}`);
    } else {
      await db.query("DELETE FROM user_downloads WHERE user_id = $1", [userId]);
      console.log(`[Cleanup] Deleted all downloads for user ${userId}`);
    }
  } catch (err) {
    console.error("[Cleanup] Failed to delete downloads:", err);
  }
}
async function deleteDownloadsForCourse(courseId) {
  try {
    await db.query(
      `DELETE FROM user_downloads 
       WHERE (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $1))
       OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $1))`,
      [courseId]
    );
    console.log(`[Cleanup] Deleted all downloads for course ${courseId}`);
  } catch (err) {
    console.error("[Cleanup] Failed to delete course downloads:", err);
  }
}
async function generateAIAnswer(question, topic) {
  const topicContext = topic ? `Topic: ${topic}. ` : "";
  const answers = {
    default: `${topicContext}Great question! Here's a step-by-step explanation:

1. First, identify what's being asked
2. Apply the relevant mathematical concepts
3. Work through the solution systematically

For "${question.slice(0, 50)}...", the key is to understand the underlying mathematical principles. Practice similar problems to strengthen your understanding. If you need more clarity, try revisiting the concept notes or watching the related lecture video.`
  };
  const lowerQ = question.toLowerCase();
  if (lowerQ.includes("quadratic")) {
    return "For quadratic equations: use factorisation, quadratic formula x=(-b\xB1\u221A(b\xB2-4ac))/2a, or completing the square. Check discriminant: D>0 two roots, D=0 equal roots, D<0 no real roots.";
  }
  if (lowerQ.includes("trigon")) {
    return "Trigonometry: sin=P/H, cos=B/H, tan=P/B. Key identity: sin\xB2\u03B8+cos\xB2\u03B8=1. Standard values: sin30=1/2, sin45=1/\u221A2, sin60=\u221A3/2.";
  }
  if (lowerQ.includes("calculus") || lowerQ.includes("derivative") || lowerQ.includes("integral")) {
    return "Calculus: d/dx(x\u207F)=nx\u207F\u207B\xB9, d/dx(sinx)=cosx, d/dx(cosx)=-sinx. Integration is reverse of differentiation: \u222Bx\u207F dx=x\u207F\u207A\xB9/(n+1)+C.";
  }
  return answers.default;
}
async function ensureCoreLearningSchemaColumns() {
  const requiredStatements = [
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT FALSE",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Mathematics'",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Beginner'",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS duration_hours DECIMAL(5, 1) DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_lectures INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_tests INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS original_price DECIMAL(10, 2) DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8, 2) DEFAULT NULL",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS course_type TEXT DEFAULT 'live'",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS subject TEXT DEFAULT ''",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_date TEXT",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_date TEXT",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_students INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS total_materials INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS pyq_count INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS mock_count INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS practice_count INTEGER DEFAULT 0",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail TEXT",
    "ALTER TABLE courses ADD COLUMN IF NOT EXISTS cover_color TEXT",
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'",
    "ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT",
    "ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE lectures ADD COLUMN IF NOT EXISTS section_title TEXT",
    "ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE",
    "ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS section_title TEXT",
    "ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT"
  ];
  for (const statement of requiredStatements) {
    await db.query(statement).catch(() => {
    });
  }
}
async function ensureCoreLearningPerformanceIndexes() {
  const indexStatements = [
    "CREATE INDEX IF NOT EXISTS idx_enrollments_user_course_status_valid_until ON enrollments(user_id, course_id, status, valid_until)",
    "CREATE INDEX IF NOT EXISTS idx_lectures_course_section ON lectures(course_id, section_title)",
    "CREATE INDEX IF NOT EXISTS idx_materials_course_section ON study_materials(course_id, section_title)",
    "CREATE INDEX IF NOT EXISTS idx_live_classes_course_scheduled ON live_classes(course_id, scheduled_at)",
    "CREATE INDEX IF NOT EXISTS idx_download_tokens_token_used_expires ON download_tokens(token, used, expires_at)"
  ];
  for (const statement of indexStatements) {
    await db.query(statement).catch(() => {
    });
  }
}
async function registerRoutes(app2) {
  try {
    await ensureCoreLearningSchemaColumns();
    await ensureCoreLearningPerformanceIndexes();
    console.log("[DB] courses + enrollments columns ensured (admin + live APIs)");
  } catch (err) {
    console.error("[DB] CRITICAL: could not ensure course/enrollment columns. Run SQL in Neon (same branch as DATABASE_URL). Error:", err);
  }
  const allowRuntimeSchemaSync = process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true";
  if (allowRuntimeSchemaSync) {
    try {
      await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        email TEXT UNIQUE,
        phone TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'student',
        device_id TEXT,
        session_token TEXT,
        otp TEXT,
        otp_expires_at BIGINT,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        teacher_name TEXT NOT NULL DEFAULT '3i Learning',
        price DECIMAL(10, 2) DEFAULT 0,
        original_price DECIMAL(10, 2) DEFAULT 0,
        validity_months NUMERIC(8, 2) DEFAULT NULL,
        category TEXT DEFAULT 'Mathematics',
        thumbnail TEXT,
        is_free BOOLEAN DEFAULT FALSE,
        total_lectures INTEGER DEFAULT 0,
        total_tests INTEGER DEFAULT 0,
        total_students INTEGER DEFAULT 0,
        level TEXT DEFAULT 'Beginner',
        duration_hours DECIMAL(5, 1) DEFAULT 0,
        is_published BOOLEAN DEFAULT TRUE,
        course_type TEXT DEFAULT 'standard',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS lectures (
        id SERIAL PRIMARY KEY,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        video_url TEXT,
        video_type TEXT DEFAULT 'youtube',
        pdf_url TEXT,
        duration_minutes INTEGER DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        is_free_preview BOOLEAN DEFAULT FALSE,
        section_title TEXT,
        download_allowed BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        progress_percent INTEGER DEFAULT 0,
        last_lecture_id INTEGER,
        enrolled_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        UNIQUE(user_id, course_id)
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS lecture_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
        is_completed BOOLEAN DEFAULT FALSE,
        watch_percent INTEGER DEFAULT 0,
        completed_at BIGINT,
        UNIQUE(user_id, lecture_id)
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS study_materials (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        file_url TEXT,
        file_type TEXT DEFAULT 'pdf',
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        is_free BOOLEAN DEFAULT TRUE,
        section_title TEXT,
        download_allowed BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS tests (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        duration_minutes INTEGER DEFAULT 60,
        total_questions INTEGER DEFAULT 0,
        total_marks INTEGER DEFAULT 100,
        passing_marks INTEGER DEFAULT 35,
        test_type TEXT DEFAULT 'practice',
        folder_name TEXT,
        is_published BOOLEAN DEFAULT TRUE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS questions (
        id SERIAL PRIMARY KEY,
        test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
        question_text TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        option_c TEXT NOT NULL,
        option_d TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        explanation TEXT,
        topic TEXT,
        difficulty TEXT DEFAULT 'medium',
        marks INTEGER DEFAULT 4,
        negative_marks DECIMAL(3, 1) DEFAULT 1,
        order_index INTEGER DEFAULT 0
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS test_attempts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
        answers JSONB DEFAULT '{}',
        score INTEGER DEFAULT 0,
        total_marks INTEGER DEFAULT 0,
        percentage DECIMAL(5, 2) DEFAULT 0,
        time_taken_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'in_progress',
        started_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        completed_at BIGINT
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        is_read BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS live_classes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        youtube_url TEXT,
        recording_url TEXT,
        scheduled_at BIGINT,
        is_live BOOLEAN DEFAULT FALSE,
        is_completed BOOLEAN DEFAULT FALSE,
        is_public BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS live_chat_messages (
        id SERIAL PRIMARY KEY,
        live_class_id INTEGER REFERENCES live_classes(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        message TEXT NOT NULL,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS doubts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT,
        topic TEXT,
        status TEXT DEFAULT 'pending',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount DECIMAL(10, 2),
        currency TEXT DEFAULT 'INR',
        status TEXT DEFAULT 'created',
        created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS daily_missions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        questions JSONB DEFAULT '[]',
        mission_date DATE,
        xp_reward INTEGER DEFAULT 50,
        mission_type TEXT DEFAULT 'daily_drill',
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS user_missions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        mission_id INTEGER REFERENCES daily_missions(id) ON DELETE CASCADE,
        is_completed BOOLEAN DEFAULT FALSE,
        score INTEGER DEFAULT 0,
        completed_at BIGINT,
        UNIQUE(user_id, mission_id)
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS download_tokens (
        id SERIAL PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
        item_id INTEGER NOT NULL,
        r2_key TEXT NOT NULL,
        used BOOLEAN NOT NULL DEFAULT FALSE,
        created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        expires_at BIGINT NOT NULL
      )
    `);
      await db.query(`
      CREATE TABLE IF NOT EXISTS user_downloads (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
        item_id INTEGER NOT NULL,
        local_filename TEXT,
        downloaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
        UNIQUE(user_id, item_type, item_id)
      )
    `);
      console.log("[DB] Base tables ensured");
    } catch (err) {
      console.error("[DB] Failed to create base tables:", err);
    }
    try {
      await db.query("CREATE INDEX IF NOT EXISTS idx_tests_course_id ON tests(course_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_enrollments_user_id ON enrollments(user_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_enrollments_course_id ON enrollments(course_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_test_attempts_user_test ON test_attempts(user_id, test_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_test_attempts_test_id ON test_attempts(test_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_lecture_progress_user ON lecture_progress(user_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_questions_test_id ON questions(test_id)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_token ON download_tokens(token)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_expires ON download_tokens(expires_at)");
      await db.query(`CREATE TABLE IF NOT EXISTS media_tokens (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      file_key TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`).catch(() => {
      });
      await db.query("CREATE INDEX IF NOT EXISTS idx_media_tokens_expires ON media_tokens(expires_at)").catch(() => {
      });
      console.log("[DB] Indexes ensured");
    } catch (err) {
      console.error("[DB] Failed to create indexes:", err);
    }
    try {
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TEXT");
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT");
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT FALSE");
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE");
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at BIGINT");
      await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT");
      await ensureCoreLearningSchemaColumns();
      await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS difficulty TEXT DEFAULT 'moderate'");
      await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS scheduled_at BIGINT");
      await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE");
      await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS mini_course_id INTEGER").catch(() => {
      });
      await db.query("ALTER TABLE tests ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0").catch(() => {
      });
      await db.query("ALTER TABLE lectures ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE study_materials ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS test_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, test_id)
    )`).catch(() => {
      });
      await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT");
      await db.query("ALTER TABLE questions ADD COLUMN IF NOT EXISTS solution_image_url TEXT");
      await db.query(`CREATE TABLE IF NOT EXISTS course_folders (
      id SERIAL PRIMARY KEY,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_hidden BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(course_id, name, type)
    )`);
      await db.query(`CREATE TABLE IF NOT EXISTS standalone_folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_hidden BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(name, type)
    )`);
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS category TEXT").catch(() => {
      });
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS price NUMERIC(10,2) DEFAULT 0").catch(() => {
      });
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS original_price NUMERIC(10,2) DEFAULT 0").catch(() => {
      });
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT TRUE").catch(() => {
      });
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS description TEXT").catch(() => {
      });
      await db.query("ALTER TABLE standalone_folders ADD COLUMN IF NOT EXISTS validity_months NUMERIC(8,2) DEFAULT NULL").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS folder_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      folder_id INTEGER REFERENCES standalone_folders(id) ON DELETE CASCADE,
      amount NUMERIC(10,2),
      payment_id TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, folder_id)
    )`).catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'created',
      click_count INTEGER DEFAULT 1,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, course_id)
    )`);
      await db.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'created'").catch(() => {
      });
      await db.query("ALTER TABLE payments ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 1").catch(() => {
      });
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS payments_user_course_unique ON payments(user_id, course_id)").catch(() => {
      });
      await db.query("UPDATE payments SET status = 'created' WHERE status IS NULL").catch(() => {
      });
      await db.query("UPDATE payments SET click_count = 1 WHERE click_count IS NULL").catch(() => {
      });
      await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS correct INTEGER DEFAULT 0");
      await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS incorrect INTEGER DEFAULT 0");
      await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS attempted INTEGER DEFAULT 0");
      await db.query("ALTER TABLE test_attempts ADD COLUMN IF NOT EXISTS question_times JSONB");
      await db.query("ALTER TABLE test_attempts ALTER COLUMN score TYPE NUMERIC USING score::NUMERIC").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS question_reports (
      id SERIAL PRIMARY KEY,
      question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      details TEXT,
      created_at BIGINT,
      UNIQUE(question_id, user_id)
    )`);
      await db.query(`CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      author TEXT,
      price NUMERIC DEFAULT 0,
      original_price NUMERIC DEFAULT 0,
      cover_url TEXT,
      file_url TEXT,
      is_published BOOLEAN DEFAULT TRUE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
      await db.query(`CREATE TABLE IF NOT EXISTS book_purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      book_id INTEGER REFERENCES books(id),
      purchased_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, book_id)
    )`);
      await db.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS book_click_tracking (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
      click_count INTEGER DEFAULT 1,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, book_id)
    )`);
      console.log("[DB] book_click_tracking table ensured");
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_email BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS notify_bell BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_free_preview BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS stream_type TEXT DEFAULT 'rtmp'").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS chat_mode TEXT DEFAULT 'public'").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS recording_url TEXT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS show_viewer_count BOOLEAN DEFAULT TRUE").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS started_at BIGINT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS ended_at BIGINT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_uid TEXT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_key TEXT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_stream_rtmp_url TEXT").catch(() => {
      });
      await db.query("ALTER TABLE live_classes ADD COLUMN IF NOT EXISTS cf_playback_hls TEXT").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS live_class_viewers (
      id SERIAL PRIMARY KEY,
      live_class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      last_heartbeat BIGINT NOT NULL,
      UNIQUE(live_class_id, user_id)
    )`).catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS live_class_hand_raises (
      id SERIAL PRIMARY KEY,
      live_class_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      raised_at BIGINT NOT NULL,
      UNIQUE(live_class_id, user_id)
    )`).catch(() => {
      });
      await db.query("UPDATE live_classes SET is_completed = TRUE WHERE is_completed IS NOT TRUE AND is_live IS NOT TRUE AND notify_bell IS NULL AND notify_email IS NULL AND created_at < 1743465600000").catch(() => {
      });
      await db.query("UPDATE users SET profile_complete = FALSE WHERE profile_complete IS NULL");
      await db.query(
        "UPDATE users SET profile_complete = FALSE WHERE role = 'student' AND (date_of_birth IS NULL OR date_of_birth = '')"
      );
      await db.query(
        "UPDATE users SET profile_complete = TRUE WHERE profile_complete = FALSE AND role = 'student' AND email IS NOT NULL AND date_of_birth IS NOT NULL AND name IS NOT NULL AND name NOT LIKE 'Student%'"
      );
      console.log("[DB] Schema columns ensured");
      await db.query(`CREATE TABLE IF NOT EXISTS user_downloads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('material', 'lecture')),
      item_id INTEGER NOT NULL,
      downloaded_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      UNIQUE(user_id, item_type, item_id)
    )`).catch(() => {
      });
      await db.query("ALTER TABLE user_downloads ADD COLUMN IF NOT EXISTS local_filename TEXT").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS download_tokens (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_type TEXT NOT NULL CHECK (item_type IN ('lecture', 'material')),
      item_id INTEGER NOT NULL,
      r2_key TEXT NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
      expires_at BIGINT NOT NULL
    )`).catch(() => {
      });
      await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_token ON download_tokens(token)").catch(() => {
      });
      await db.query("CREATE INDEX IF NOT EXISTS idx_download_tokens_expires ON download_tokens(expires_at)").catch(() => {
      });
      await db.query("ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS valid_until BIGINT").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS lecture_progress (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
      watch_percent INTEGER DEFAULT 0,
      is_completed BOOLEAN DEFAULT FALSE,
      completed_at BIGINT,
      UNIQUE(user_id, lecture_id)
    )`).catch(() => {
      });
      await db.query("CREATE UNIQUE INDEX IF NOT EXISTS lecture_progress_user_lecture ON lecture_progress(user_id, lecture_id)").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT
    )`);
      await db.query(`CREATE TABLE IF NOT EXISTS support_messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK (sender IN ('user', 'admin')),
      message TEXT NOT NULL,
      is_read BOOLEAN DEFAULT FALSE,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
      await db.query("CREATE INDEX IF NOT EXISTS idx_support_messages_user_id ON support_messages(user_id)");
      await db.query(`
      DELETE FROM notifications 
      WHERE title ILIKE 'New message from%' 
         OR title ILIKE 'New reply from Support%'
         OR title ILIKE '%support%'
         OR source = 'support'
    `).catch(() => {
      });
      await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system'").catch(() => {
      });
      await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS expires_at BIGINT").catch(() => {
      });
      await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE").catch(() => {
      });
      await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS admin_notif_id INTEGER").catch(() => {
      });
      await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS image_url TEXT").catch(() => {
      });
      await db.query(`CREATE TABLE IF NOT EXISTS admin_notifications (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT 'all',
      course_id INTEGER,
      sent_count INTEGER DEFAULT 0,
      is_hidden BOOLEAN DEFAULT FALSE,
      image_url TEXT,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )`);
      await db.query("ALTER TABLE admin_notifications ADD COLUMN IF NOT EXISTS image_url TEXT").catch(() => {
      });
      const anCount = await db.query("SELECT COUNT(*) as cnt FROM admin_notifications");
      if (parseInt(anCount.rows[0]?.cnt || "0") === 0) {
        await db.query(`
        INSERT INTO admin_notifications (title, message, target, sent_count, created_at)
        SELECT title, message, 'all', COUNT(*), MIN(created_at)
        FROM notifications
        WHERE title NOT ILIKE 'New message from%'
          AND title NOT ILIKE 'New reply from Support%'
          AND title IS NOT NULL AND message IS NOT NULL
        GROUP BY title, message
      `).catch((e) => console.error("[DB] Backfill admin_notifications failed:", e));
      }
      console.log("[DB] admin_notifications ready");
      await db.query(`
      UPDATE notifications n SET admin_notif_id = an.id
      FROM admin_notifications an
      WHERE n.admin_notif_id IS NULL AND n.title = an.title AND n.message = an.message
    `).catch((e) => console.error("[DB] Backfill admin_notif_id failed:", e));
      console.log("[DB] admin_notif_id backfill done");
      await db.query(`
      UPDATE notifications n SET image_url = an.image_url
      FROM admin_notifications an
      WHERE n.admin_notif_id = an.id AND n.image_url IS NULL AND an.image_url IS NOT NULL
    `).catch(() => {
      });
      await db.query(`
      DELETE FROM notifications 
      WHERE admin_notif_id IS NOT NULL 
      AND admin_notif_id NOT IN (SELECT id FROM admin_notifications)
    `).catch(() => {
      });
      await db.query(`
      DELETE FROM notifications 
      WHERE admin_notif_id IS NULL 
      AND source IS DISTINCT FROM 'support'
      AND title NOT ILIKE 'New message from%'
      AND title NOT ILIKE 'New reply from%'
      AND title NOT ILIKE '%Live Class%'
      AND title NOT IN (SELECT title FROM admin_notifications)
    `).catch(() => {
      });
      console.log("[DB] Orphaned notifications cleaned up");
    } catch (err) {
      console.error("[DB] Failed to add columns:", err);
    }
    try {
      await db.query(`
      UPDATE courses c SET
        total_tests    = sub.total,
        pyq_count      = sub.pyq,
        mock_count     = sub.mock,
        practice_count = sub.practice
      FROM (
        SELECT course_id,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE test_type = 'pyq') AS pyq,
          COUNT(*) FILTER (WHERE test_type = 'mock') AS mock,
          COUNT(*) FILTER (WHERE test_type = 'practice') AS practice
        FROM tests
        GROUP BY course_id
      ) sub
      WHERE c.id = sub.course_id
    `);
      await db.query(`
      UPDATE courses SET total_tests=0, pyq_count=0, mock_count=0, practice_count=0
      WHERE id NOT IN (SELECT DISTINCT course_id FROM tests WHERE course_id IS NOT NULL)
    `);
      console.log("[DB] Course test counts backfilled");
    } catch (err) {
      console.error("[DB] Failed to backfill test counts:", err);
    }
    try {
      await db.query(`
      UPDATE enrollments e SET progress_percent = sub.pct
      FROM (
        SELECT 
          e2.user_id,
          e2.course_id,
          ROUND(
            (COALESCE(lp_done.cnt, 0) + COALESCE(ta_done.cnt, 0))::numeric /
            NULLIF(COALESCE(lec_total.cnt, 0) + COALESCE(test_total.cnt, 0), 0) * 100
          ) AS pct
        FROM enrollments e2
        LEFT JOIN (
          SELECT l.course_id, lp.user_id, COUNT(*) AS cnt
          FROM lecture_progress lp JOIN lectures l ON lp.lecture_id = l.id
          WHERE lp.is_completed = TRUE
          GROUP BY l.course_id, lp.user_id
        ) lp_done ON lp_done.course_id = e2.course_id AND lp_done.user_id = e2.user_id
        LEFT JOIN (
          SELECT t.course_id, ta.user_id, COUNT(DISTINCT ta.test_id) AS cnt
          FROM test_attempts ta JOIN tests t ON ta.test_id = t.id
          WHERE ta.status = 'completed' AND t.course_id IS NOT NULL
          GROUP BY t.course_id, ta.user_id
        ) ta_done ON ta_done.course_id = e2.course_id AND ta_done.user_id = e2.user_id
        LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM lectures GROUP BY course_id) lec_total ON lec_total.course_id = e2.course_id
        LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM tests WHERE is_published = TRUE GROUP BY course_id) test_total ON test_total.course_id = e2.course_id
        WHERE (COALESCE(lp_done.cnt, 0) + COALESCE(ta_done.cnt, 0)) > 0
      ) sub
      WHERE e.user_id = sub.user_id AND e.course_id = sub.course_id
    `);
      console.log("[DB] Enrollment progress backfilled (lectures + tests)");
    } catch (err) {
      console.error("[DB] Failed to backfill enrollment progress:", err);
    }
  } else {
    console.log("[DB] Runtime schema sync skipped (ALLOW_RUNTIME_SCHEMA_SYNC != true)");
  }
  const sentNotifications = /* @__PURE__ */ new Set();
  setInterval(async () => {
    try {
      const now = Date.now();
      const thirtyMinFromNow = now + 30 * 60 * 1e3;
      const classes = await db.query(
        "SELECT lc.id, lc.title, lc.course_id, lc.scheduled_at, lc.notify_bell, lc.is_free_preview, lc.is_public FROM live_classes lc WHERE lc.is_completed IS NOT TRUE AND lc.is_live IS NOT TRUE AND lc.notify_bell = TRUE AND lc.scheduled_at IS NOT NULL"
      );
      for (const lc of classes.rows) {
        const scheduledAt = parseInt(lc.scheduled_at);
        if (isNaN(scheduledAt)) continue;
        const diff = scheduledAt - now;
        const recipients = !lc.course_id || lc.is_free_preview === true || lc.is_public === true ? await db.query("SELECT id AS user_id FROM users WHERE role = 'student'") : await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [lc.course_id]);
        const expiresAt = now + 6 * 36e5;
        const key30 = `30min_${lc.id}`;
        if (diff > 0 && diff <= 31 * 60 * 1e3 && diff >= 29 * 60 * 1e3 && !sentNotifications.has(key30)) {
          sentNotifications.add(key30);
          for (const e of recipients.rows) {
            await db.query(
              "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
              [e.user_id, "\u23F0 Live Class in 30 minutes!", `"${lc.title}" starts in 30 minutes. Get ready!`, "info", now, expiresAt]
            );
          }
          console.log(`[LiveNotif] 30min reminder sent for "${lc.title}" to ${recipients.rows.length} students`);
        }
        const keyStart = `start_${lc.id}`;
        if (diff <= 0 && diff >= -2 * 60 * 1e3 && !sentNotifications.has(keyStart)) {
          sentNotifications.add(keyStart);
          for (const e of recipients.rows) {
            await db.query(
              "INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)",
              [e.user_id, "\u{1F534} Live Class Starting Now!", `"${lc.title}" is about to start. Join now!`, "info", now, expiresAt]
            );
          }
          console.log(`[LiveNotif] Start reminder sent for "${lc.title}" to ${recipients.rows.length} students`);
        }
      }
      if (sentNotifications.size > 500) sentNotifications.clear();
    } catch (err) {
      console.error("[LiveNotif] Scheduler error:", err);
    }
  }, 60 * 1e3);
  console.log("[LiveNotif] Scheduler started \u2014 checks every 60s");
  setInterval(async () => {
    try {
      const result = await db.query(
        "DELETE FROM download_tokens WHERE expires_at < $1 AND used = TRUE",
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[TokenCleanup] Deleted ${result.rowCount} expired tokens`);
      }
    } catch (err) {
      console.error("[TokenCleanup] Error:", err);
    }
  }, 5 * 60 * 1e3);
  console.log("[TokenCleanup] Scheduler started \u2014 runs every 5 minutes");
  app2.use("/api", async (req, res, next) => {
    try {
      const authUser = await getAuthUser(req);
      const userId = authUser?.id || null;
      if (userId && userId > 0) {
        db.query("UPDATE users SET last_active_at = $1 WHERE id = $2", [Date.now(), userId]).catch(() => {
        });
      }
      next();
    } catch (_e) {
      next();
    }
  });
  registerAuthRoutes({
    app: app2,
    db,
    getAuthUser,
    generateOTP,
    hashOtpValue,
    verifyOtpValue,
    generateSecureToken: () => generateSecureToken(),
    sendOTPviaSMS,
    verifyFirebaseToken,
    adminEmails: ADMIN_EMAILS,
    adminPhones: ADMIN_PHONES
  });
  registerPaymentRoutes({
    app: app2,
    db,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature,
    cacheInvalidate
  });
  registerSupportRoutes({
    app: app2,
    db,
    getAuthUser,
    requireAdmin
  });
  registerBookRoutes({
    app: app2,
    db,
    requireAdmin,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature
  });
  registerLectureRoutes({
    app: app2,
    db,
    getAuthUser,
    updateCourseProgress
  });
  registerTestFolderRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerTestCoreRoutes({
    app: app2,
    db,
    getAuthUser,
    updateCourseProgress
  });
  registerTestAttemptRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerStudentMissionMaterialRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerLiveClassRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerDoubtNotificationRoutes({
    app: app2,
    db,
    getAuthUser,
    generateAIAnswer
  });
  async function requireAuth(req, res, next) {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ message: "Login required" });
    }
    req.user = user;
    next();
  }
  registerStandaloneFolderRoutes({
    app: app2,
    db,
    requireAdmin
  });
  async function requireAdmin(req, res, next) {
    const user = await getAuthUser(req);
    if (!user || user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    req.user = user;
    next();
  }
  let r2Client = null;
  const getR2Client = async () => {
    if (r2Client) return r2Client;
    const { S3Client } = await import("@aws-sdk/client-s3");
    r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
    return r2Client;
  };
  registerAdminLiveClassManageRoutes({
    app: app2,
    db,
    requireAdmin,
    getR2Client
  });
  registerCourseAccessRoutes({
    app: app2,
    db,
    getAuthUser,
    generateSecureToken,
    cacheInvalidate: (prefix) => cacheInvalidate(prefix ?? ""),
    getR2Client
  });
  registerUploadRoutes({
    app: app2,
    requireAdmin,
    getAuthUser,
    getR2Client,
    uploadLarge
  });
  registerMediaStreamRoutes({
    app: app2,
    db,
    getAuthUser,
    getR2Client
  });
  registerSiteSettingsRoutes({
    app: app2,
    db,
    requireAdmin
  });
  registerAdminCourseCrudRoutes({
    app: app2,
    db,
    requireAdmin,
    cacheInvalidate
  });
  registerAdminCourseImportRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts
  });
  registerAdminCourseManagementRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts
  });
  registerAdminAnalyticsRoutes({
    app: app2,
    db,
    requireAdmin
  });
  registerAdminEnrollmentRoutes({
    app: app2,
    db,
    requireAdmin,
    cacheInvalidate,
    deleteDownloadsForUser,
    deleteDownloadsForCourse
  });
  registerAdminLectureRoutes({
    app: app2,
    db,
    requireAdmin,
    getR2Client
  });
  registerAdminTestRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts
  });
  registerAdminQuestionBulkRoutes({
    app: app2,
    db,
    requireAdmin,
    upload,
    PDFParse
  });
  registerAdminUsersAndContentRoutes({
    app: app2,
    db,
    requireAdmin,
    deleteDownloadsForUser
  });
  registerAdminNotificationRoutes({
    app: app2,
    db,
    requireAdmin
  });
  registerAdminTestManagementRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts
  });
  registerAdminDailyMissionRoutes({
    app: app2,
    db,
    requireAdmin
  });
  registerLiveChatRoutes({
    app: app2,
    db,
    getAuthUser,
    requireAuth,
    requireAdmin
  });
  registerLiveClassEngagementRoutes({
    app: app2,
    db,
    requireAuth,
    requireAdmin
  });
  registerLiveStreamRoutes({
    app: app2,
    db,
    requireAdmin
  });
  registerPdfRoutes({ app: app2, db });
  const httpServer = createServer(app2);
  return httpServer;
}
var require3, PDFParse, upload, uploadLarge, databaseUrlRaw, databaseUrl, pool, db, cache, ADMIN_EMAILS, ADMIN_PHONES;
var init_routes = __esm({
  "server/routes.ts"() {
    "use strict";
    init_firebase();
    init_razorpay();
    init_security_utils();
    init_auth_utils();
    init_auth_routes();
    init_pdf_routes();
    init_payment_routes();
    init_support_routes();
    init_live_chat_routes();
    init_live_class_engagement_routes();
    init_live_stream_routes();
    init_site_settings_routes();
    init_admin_course_import_routes();
    init_admin_course_management_routes();
    init_admin_analytics_routes();
    init_admin_enrollment_routes();
    init_admin_lecture_routes();
    init_admin_test_routes();
    init_admin_question_bulk_routes();
    init_admin_users_and_content_routes();
    init_admin_test_management_routes();
    init_admin_daily_mission_routes();
    init_admin_notification_routes();
    init_admin_course_crud_routes();
    init_book_routes();
    init_standalone_folder_routes();
    init_doubt_notification_routes();
    init_student_mission_material_routes();
    init_lecture_routes();
    init_test_folder_routes();
    init_test_core_routes();
    init_test_attempt_routes();
    init_live_class_routes();
    init_admin_live_class_manage_routes();
    init_course_access_routes();
    init_upload_routes();
    init_media_stream_routes();
    require3 = createRequire2(import.meta.url);
    ({ PDFParse } = require3("pdf-parse"));
    upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
    databaseUrlRaw = process.env.DATABASE_URL;
    databaseUrl = databaseUrlRaw ? normalizeDatabaseUrl(databaseUrlRaw) : void 0;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL must be set");
    }
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false
      },
      max: 10,
      min: 1,
      connectionTimeoutMillis: 1e4,
      idleTimeoutMillis: 1e4,
      // release idle connections quickly (Neon closes them anyway)
      statement_timeout: 25e3
    });
    pool.on("error", (err) => {
      console.error("[Pool] Idle client error (connection dropped by Neon):", err.message);
    });
    db = {
      query: (text, params) => dbQuery(text, params)
    };
    cache = /* @__PURE__ */ new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of cache.entries()) {
        if (now > entry.expiresAt) cache.delete(key);
      }
    }, 5 * 60 * 1e3);
    ADMIN_EMAILS = ["3ilearningofficial@gmail.com"];
    ADMIN_PHONES = ["9997198068"];
  }
});

// server/index.ts
import dotenv from "dotenv";
import * as path from "path";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import * as fs from "fs";
import cors from "cors";
dotenv.config({
  path: path.resolve(process.cwd(), ".env")
});
var app = express();
var log = console.log;
function normalizeDatabaseUrl2(raw) {
  try {
    const parsed = new URL(raw);
    const sslMode = (parsed.searchParams.get("sslmode") || "").toLowerCase();
    if (!sslMode || sslMode === "require" || sslMode === "prefer" || sslMode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}
function setupCors(app2) {
  const normalizeOrigin = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return new URL(trimmed).origin.toLowerCase();
    } catch {
      return trimmed.replace(/\/+$/, "").toLowerCase();
    }
  };
  const originMatchesPattern = (origin, pattern) => {
    if (!pattern.includes("*")) return origin === pattern;
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(origin);
  };
  const defaultAllowedOrigins = [
    "https://3ilearning.in",
    // Keep www variant for compatibility.
    "https://www.3ilearning.in",
    // Razorpay Standard Checkout: redirect/callback POSTs to our API from these origins.
    "https://api.razorpay.com",
    "https://checkout.razorpay.com"
  ];
  const envOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => normalizeOrigin(s)).filter(Boolean);
  const allowedOriginPatterns = [
    ...defaultAllowedOrigins.map((origin) => normalizeOrigin(origin)),
    ...envOrigins
  ];
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (allowedOriginPatterns.some((pattern) => originMatchesPattern(normalizedOrigin, pattern))) {
        return callback(null, true);
      }
      console.warn(`[CORS] blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
  };
  app2.use(cors(corsOptions));
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      limit: "10mb",
      // allow base64 image uploads in notification payloads
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false, limit: "10mb" }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      if (duration > 500 || res.statusCode >= 500) {
        log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
      }
    });
    next();
  });
}
function setupApiResponseFormat(app2) {
  app2.use("/api", (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      const statusCode = res.statusCode || 200;
      if (payload && typeof payload === "object" && typeof payload.success === "boolean" && ("data" in payload || "message" in payload || "error" in payload)) {
        return originalJson(payload);
      }
      if (statusCode >= 400) {
        const fallback = typeof payload === "string" ? payload : payload?.error || payload?.message || "Request failed";
        return originalJson({
          success: false,
          error: String(fallback),
          message: typeof payload?.message === "string" ? payload.message : void 0,
          data: payload && typeof payload === "object" && payload.data !== void 0 ? payload.data : void 0
        });
      }
      if (payload === void 0 || payload === null) {
        return originalJson({ success: true });
      }
      if (typeof payload === "object" && !Array.isArray(payload)) {
        if (Object.keys(payload).length === 1 && typeof payload.message === "string") {
          return originalJson({ success: true, message: payload.message });
        }
        return originalJson({ success: true, data: payload });
      }
      return originalJson({ success: true, data: payload });
    };
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function getBackendVersion() {
  return {
    service: "backend",
    env: process.env.NODE_ENV || "development",
    commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA || "unknown",
    version: process.env.npm_package_version || "unknown",
    now: Date.now()
  };
}
function serveExpoManifest(platform, res) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function configureExpoAndLanding(app2) {
  const templatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path === "/" || req.path === "/app" || req.path.startsWith("/app/")) {
      const webBuildPath = path.resolve(
        process.cwd(),
        "dist",
        "index.html"
      );
      if (fs.existsSync(webBuildPath)) {
        return res.sendFile(webBuildPath);
      }
    }
    if (req.path === "/manifest") {
      const platform = req.header("expo-platform");
      if (platform === "ios" || platform === "android") {
        return serveExpoManifest(platform, res);
      }
    }
    next();
  });
  app2.use(express.static(path.resolve(process.cwd(), "static-build", "web")));
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app2.use(express.static(path.resolve(process.cwd(), "static-build")));
  const expoRoutes = ["/login", "/otp", "/profile", "/courses", "/settings", "/admin", "/material", "/test", "/ai-tutor", "/missions", "/live-class"];
  app2.get(expoRoutes, (req, res, next) => {
    const webBuildPath = path.resolve(process.cwd(), "static-build", "web", "index.html");
    if (fs.existsSync(webBuildPath)) {
      return res.sendFile(webBuildPath);
    }
    next();
  });
  app2.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/_expo") || req.path.startsWith("/assets") || req.path.startsWith("/firebase-phone-auth") || req.path.includes(".")) {
      return next();
    }
    const webBuildPath = path.resolve(process.cwd(), "static-build", "web", "index.html");
    if (fs.existsSync(webBuildPath)) {
      return res.sendFile(webBuildPath);
    }
    next();
  });
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
(async () => {
  const { registerRoutes: registerRoutes2 } = await Promise.resolve().then(() => (init_routes(), routes_exports));
  setupCors(app);
  setupBodyParsing(app);
  setupApiResponseFormat(app);
  app.use(compression());
  setupRequestLogging(app);
  const isProduction = process.env.NODE_ENV === "production";
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    const p = req.path || "";
    const allowEmbed = p.startsWith("/api/pdf-viewer") || p.startsWith("/api/media");
    if (allowEmbed) {
      res.setHeader("Content-Security-Policy", "frame-ancestors *");
    } else {
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
    }
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (isProduction) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  const sessionConfig = {
    secret: process.env.SESSION_SECRET || (isProduction ? (() => {
      throw new Error("SESSION_SECRET must be set in production");
    })() : "dev-secret-not-for-production"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      // HTTPS only in production
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      // "none" required for cross-origin with credentials
      maxAge: 7 * 24 * 60 * 60 * 1e3
    }
  };
  if (isProduction && process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionConfig.store = new PgSession({
      conString: normalizeDatabaseUrl2(process.env.DATABASE_URL),
      tableName: "session",
      createTableIfMissing: true
    });
  }
  app.use(session(sessionConfig));
  app.get("/api/health/version", (_req, res) => {
    res.json(getBackendVersion());
  });
  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 200,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return `${ipKeyGenerator(req.ip || "")}:${req.body?.identifier || "global"}`;
    }
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 300,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return `${ipKeyGenerator(req.ip || "")}:${req.body?.identifier || "global"}`;
    }
  });
  app.use("/api/auth/send-otp", otpSendLimiter);
  app.use("/api/auth/verify-otp", otpVerifyLimiter);
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 300,
    // 300 req/min per IP — plenty for normal use
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/send-otp") || req.path.startsWith("/api/auth/verify-otp")
  });
  app.use("/api", globalApiLimiter);
  const server = await registerRoutes2(app);
  app.get("/firebase-phone-auth", (_req, res) => {
    const firebaseAuthPath = path.resolve(process.cwd(), "server", "templates", "firebase-phone-auth.html");
    if (fs.existsSync(firebaseAuthPath)) {
      return res.type("html").sendFile(firebaseAuthPath);
    }
    res.status(404).send("Not found");
  });
  configureExpoAndLanding(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  try {
    const { networkInterfaces } = await import("os");
    const nets = networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const net of iface || []) {
        if (net.family === "IPv4" && !net.internal) {
          log(`Mobile access: http://${net.address}:${port}`);
        }
      }
    }
  } catch (_e) {
  }
  server.listen(port, "0.0.0.0", () => {
    log(`express server running on http://localhost:${port}`);
  });
})();
