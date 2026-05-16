var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/pg-rate-limit-store.ts
async function takeSupportPostSlotPg(pool2, userId, windowMs, max) {
  const key = `support_post:user:${userId}`;
  const store = new PgRateLimitStore(pool2);
  store.init({ windowMs });
  const { totalHits, resetTime } = await store.increment(key);
  if (totalHits > max) {
    await store.decrement(key);
    const retryAfterSec = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1e3));
    return { ok: false, retryAfterSec };
  }
  return { ok: true };
}
var PgRateLimitStore;
var init_pg_rate_limit_store = __esm({
  "server/pg-rate-limit-store.ts"() {
    "use strict";
    PgRateLimitStore = class {
      constructor(pool2) {
        this.pool = pool2;
      }
      pool;
      windowMs = 6e4;
      /** Marks this store as shared across instances (express-rate-limit contract). */
      localKeys = false;
      init(options) {
        this.windowMs = options.windowMs;
      }
      async get(key) {
        try {
          const r = await this.pool.query(
            `SELECT total_hits, reset_time_ms FROM express_rate_limit WHERE bucket_key = $1`,
            [key]
          );
          if (r.rows.length === 0) return void 0;
          const row = r.rows[0];
          return {
            totalHits: Number(row.total_hits),
            resetTime: new Date(Number(row.reset_time_ms))
          };
        } catch (err) {
          console.error("[RateLimitStore] get failed:", err);
          return void 0;
        }
      }
      async increment(key) {
        const now = Date.now();
        const win = this.windowMs;
        try {
          const ins = await this.pool.query(
            `INSERT INTO express_rate_limit (bucket_key, total_hits, reset_time_ms)
         VALUES ($1, 1, $2 + $3::bigint)
         ON CONFLICT (bucket_key) DO UPDATE SET
           total_hits = CASE
             WHEN express_rate_limit.reset_time_ms <= $2::bigint THEN 1
             ELSE express_rate_limit.total_hits + 1
           END,
           reset_time_ms = CASE
             WHEN express_rate_limit.reset_time_ms <= $2::bigint THEN $2::bigint + $3::bigint
             ELSE express_rate_limit.reset_time_ms
           END
         RETURNING total_hits, reset_time_ms`,
            [key, now, win]
          );
          const row = ins.rows[0];
          return {
            totalHits: Number(row.total_hits),
            resetTime: new Date(Number(row.reset_time_ms))
          };
        } catch (err) {
          console.error("[RateLimitStore] increment failed:", err);
          return { totalHits: 1, resetTime: new Date(now + win) };
        }
      }
      async decrement(key) {
        try {
          await this.pool.query(
            `UPDATE express_rate_limit SET total_hits = GREATEST(0, total_hits - 1) WHERE bucket_key = $1`,
            [key]
          );
        } catch (err) {
          console.error("[RateLimitStore] decrement failed:", err);
        }
      }
      async resetKey(key) {
        try {
          await this.pool.query(`DELETE FROM express_rate_limit WHERE bucket_key = $1`, [key]);
        } catch (err) {
          console.error("[RateLimitStore] resetKey failed:", err);
        }
      }
      async resetAll() {
        try {
          await this.pool.query(`DELETE FROM express_rate_limit`);
        } catch (err) {
          console.error("[RateLimitStore] resetAll failed:", err);
        }
      }
      shutdown() {
      }
    };
  }
});

// server/ai-tutor-service.ts
function getAiProviderMode() {
  const raw = (process.env.AI_PROVIDER || "auto").trim().toLowerCase();
  if (raw === "openai" || raw === "gemini" || raw === "auto") return raw;
  return "auto";
}
function getAiTutorHealthSnapshot() {
  const geminiConfigured = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)?.trim();
  const openaiConfigured = !!process.env.OPENAI_API_KEY?.trim();
  const openaiModel = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  const aiProvider = getAiProviderMode();
  let resolvedOrder = [];
  if (aiProvider === "openai") {
    resolvedOrder = openaiConfigured ? ["openai"] : [];
  } else if (aiProvider === "gemini") {
    resolvedOrder = geminiConfigured ? ["gemini"] : [];
  } else {
    if (geminiConfigured) resolvedOrder.push("gemini");
    if (openaiConfigured) resolvedOrder.push("openai");
  }
  return { geminiConfigured, openaiConfigured, openaiModel, aiProvider, resolvedOrder };
}
function createGenerateAIAnswer(db2) {
  return async function generateAIAnswer2(question, topic, userId) {
    const q = String(question || "").trim();
    const t = String(topic || "").trim();
    if (!q) return "Please share your full question so I can help step by step.";
    const tokenize = (text) => text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const stop = /* @__PURE__ */ new Set([
      "the",
      "and",
      "for",
      "with",
      "that",
      "this",
      "from",
      "what",
      "when",
      "where",
      "which",
      "into",
      "about",
      "have",
      "has",
      "had",
      "how",
      "why",
      "are",
      "can",
      "could",
      "would",
      "should",
      "your",
      "you",
      "our",
      "their",
      "there",
      "then",
      "than",
      "also",
      "just",
      "some",
      "solve",
      "find",
      "show",
      "math",
      "question",
      "doubt",
      "topic"
    ]);
    const keywords = Array.from(new Set([...tokenize(q), ...tokenize(t)].filter((w) => !stop.has(w))));
    const scoreSnippet = (text) => {
      if (!keywords.length) return 0;
      const lower = text.toLowerCase();
      let score = 0;
      for (const k of keywords) {
        if (lower.includes(k)) score += 1;
      }
      return score;
    };
    const snippets = [];
    try {
      if (userId) {
        const lectures = await db2.query(
          `SELECT l.title, COALESCE(l.description, '') AS description, COALESCE(l.transcript, '') AS transcript,
                  COALESCE(c.title, '') AS course_title
           FROM lectures l
           JOIN enrollments e ON e.course_id = l.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = l.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY l.created_at DESC
           LIMIT 120`,
          [userId]
        );
        for (const row of lectures.rows) {
          const transcriptPart = String(row.transcript || "").trim();
          const transcriptChunk = transcriptPart ? transcriptPart.slice(0, TRANSCRIPT_CONTEXT_CHARS) : "";
          const text = [String(row.title || "").trim(), String(row.description || "").trim(), transcriptChunk].filter(Boolean).join(". ");
          snippets.push({
            source: "lecture",
            title: `${row.course_title || "Course"} - ${row.title || "Lecture"}`,
            text: text || String(row.title || ""),
            score: scoreSnippet(text)
          });
        }
        const materials = await db2.query(
          `SELECT sm.title, COALESCE(sm.description, '') AS description, COALESCE(c.title, '') AS course_title
           FROM study_materials sm
           JOIN enrollments e ON e.course_id = sm.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = sm.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY sm.created_at DESC
           LIMIT 120`,
          [userId]
        );
        for (const row of materials.rows) {
          const text = `${row.title}. ${row.description}`.trim();
          snippets.push({
            source: "material",
            title: `${row.course_title || "Course"} - ${row.title || "Material"}`,
            text,
            score: scoreSnippet(text)
          });
        }
        const questions = await db2.query(
          `SELECT q.question_text, COALESCE(q.explanation, '') AS explanation, COALESCE(q.topic, '') AS topic,
                  COALESCE(t.title, '') AS test_title, COALESCE(c.title, '') AS course_title
           FROM questions q
           JOIN tests t ON t.id = q.test_id
           JOIN enrollments e ON e.course_id = t.course_id AND e.user_id = $1
           LEFT JOIN courses c ON c.id = t.course_id
           WHERE (e.status = 'active' OR e.status IS NULL)
           ORDER BY q.id DESC
           LIMIT 150`,
          [userId]
        );
        for (const row of questions.rows) {
          const text = `${row.topic}. ${row.question_text}. ${row.explanation}`.trim();
          snippets.push({
            source: "question",
            title: `${row.course_title || "Course"} - ${row.test_title || "Test"} question`,
            text,
            score: scoreSnippet(text)
          });
        }
      }
    } catch (err) {
      console.warn("[AI Tutor] context fetch failed:", err);
    }
    const selected = snippets.sort((a, b) => b.score - a.score).slice(0, 8).map((s, i) => `[${i + 1}] ${s.title} (${s.source})
${s.text.slice(0, 450)}`);
    const contextBlock = selected.length ? selected.join("\n\n") : "No specific class snippet found. Use general mathematics reasoning.";
    const systemPrompt = "You are a rigorous math tutor for Indian competitive exam students. Give accurate, step-by-step solutions. If relevant context exists, use it. If context is insufficient, still solve using correct math methods. Do not fabricate references. Keep answer clear and practical.";
    const userPrompt = `Student topic: ${t || "General"}
Student question: ${q}

Course context snippets:
${contextBlock}

Answer format:
1) Short concept summary
2) Step-by-step solution
3) Final answer
4) One similar practice question`;
    const logLlmHttpFailure = (provider, status, bodyPreview) => {
      console.warn(`[AI Tutor] ${provider} HTTP ${status}`, bodyPreview.slice(0, 500));
    };
    const callGemini = async () => {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey?.trim()) return null;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18e3);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { temperature: 0.25, maxOutputTokens: 900 }
            })
          }
        );
        if (!res.ok) {
          let preview = "";
          try {
            preview = JSON.stringify(await res.json());
          } catch {
            preview = await res.text().catch(() => "");
          }
          logLlmHttpFailure("Gemini", res.status, preview);
          return null;
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("\n").trim();
        return text || null;
      } catch (e) {
        console.warn("[AI Tutor] Gemini request failed:", e instanceof Error ? e.message : e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    const callOpenAI = async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey?.trim()) return null;
      const model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 18e3);
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            temperature: 0.25,
            max_tokens: 900,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ]
          })
        });
        if (!res.ok) {
          let preview = "";
          try {
            preview = JSON.stringify(await res.json());
          } catch {
            preview = await res.text().catch(() => "");
          }
          logLlmHttpFailure("OpenAI", res.status, preview);
          return null;
        }
        const data = await res.json();
        return data?.choices?.[0]?.message?.content?.trim() || null;
      } catch (e) {
        console.warn("[AI Tutor] OpenAI request failed:", e instanceof Error ? e.message : e);
        return null;
      } finally {
        clearTimeout(timer);
      }
    };
    const mode = getAiProviderMode();
    let llmAnswer = null;
    if (mode === "openai") {
      llmAnswer = await callOpenAI();
    } else if (mode === "gemini") {
      llmAnswer = await callGemini();
    } else {
      llmAnswer = await callGemini() || await callOpenAI();
    }
    if (llmAnswer) return llmAnswer;
    const topicContext = t ? `Topic: ${t}. ` : "";
    return `${topicContext}I could not reach the AI model right now, but here is a structured way to solve it:

1. Identify the known values and what is asked.
2. Write the core formula/concept used in this chapter.
3. Substitute carefully and simplify step by step.
4. Recheck units/signs and verify the final value.

Question focus: "${q.slice(0, 80)}".`;
  };
}
var TRANSCRIPT_CONTEXT_CHARS;
var init_ai_tutor_service = __esm({
  "server/ai-tutor-service.ts"() {
    "use strict";
    TRANSCRIPT_CONTEXT_CHARS = 8e3;
  }
});

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

// server/user-sessions.ts
async function resolveUserBySessionToken(db2, token) {
  const minCreatedAt = Date.now() - SESSION_MAX_AGE_MS;
  const primary = await db2.query(
    "SELECT * FROM users WHERE session_token = $1 AND COALESCE(is_blocked, FALSE) = FALSE AND (last_active_at IS NULL OR last_active_at >= $2)",
    [token, minCreatedAt]
  );
  if (primary.rows.length > 0) {
    return { row: primary.rows[0], matchedVia: "primary" };
  }
  const extra = await db2.query(
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
async function userHasSessionToken(db2, userId, token) {
  if (!token) return false;
  const minCreatedAt = Date.now() - SESSION_MAX_AGE_MS;
  const u = await db2.query("SELECT session_token, role, last_active_at FROM users WHERE id = $1", [userId]);
  if (u.rows.length === 0) return false;
  if (u.rows[0].session_token === token) {
    const la = Number(u.rows[0].last_active_at || 0);
    if (!la || la >= minCreatedAt) return true;
  }
  if (u.rows[0].role !== "admin") return false;
  const s = await db2.query(
    "SELECT 1 FROM user_sessions WHERE user_id = $1 AND session_token = $2 AND created_at >= $3",
    [userId, token, minCreatedAt]
  );
  return s.rows.length > 0;
}
async function persistLoginSession(db2, user, token, deviceId, opts) {
  const isAdmin = user.role === "admin";
  const now = Date.now();
  if (isAdmin) {
    await db2.query("INSERT INTO user_sessions (user_id, session_token, created_at) VALUES ($1, $2, $3)", [
      user.id,
      token,
      now
    ]);
    const urow = await db2.query("SELECT session_token FROM users WHERE id = $1", [user.id]);
    const hasPrimary = !!urow.rows[0]?.session_token;
    if (!hasPrimary) {
      await db2.query(
        "UPDATE users SET session_token = $1, last_active_at = $2, device_id = COALESCE($3, device_id) WHERE id = $4",
        [token, now, deviceId, user.id]
      );
    } else if (opts.clearOtp) {
      await db2.query(
        "UPDATE users SET otp = NULL, otp_expires_at = NULL, otp_failed_attempts = 0, otp_locked_until = NULL, last_active_at = $1, device_id = COALESCE($2, device_id) WHERE id = $3",
        [now, deviceId, user.id]
      );
    } else {
      await db2.query(
        "UPDATE users SET last_active_at = $1, device_id = COALESCE($2, device_id) WHERE id = $3",
        [now, deviceId, user.id]
      );
    }
    return;
  }
  await db2.query("DELETE FROM user_sessions WHERE user_id = $1", [user.id]);
  const otpClause = opts.clearOtp !== false ? "otp = NULL, otp_expires_at = NULL, otp_failed_attempts = 0, otp_locked_until = NULL, " : "";
  await db2.query(
    `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4`,
    [deviceId || null, token, now, user.id]
  );
}
async function revokeSessionTokenForUser(db2, userId, token) {
  if (!token) return;
  await db2.query("DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2", [userId, token]);
  await db2.query("UPDATE users SET session_token = NULL WHERE id = $1 AND session_token = $2", [userId, token]);
}
var SESSION_MAX_AGE_MS;
var init_user_sessions = __esm({
  "server/user-sessions.ts"() {
    "use strict";
    SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
  }
});

// server/auth-utils.ts
function rowsToAuthUser(u, sessionTokenOverride) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    sessionToken: sessionTokenOverride ?? u.session_token,
    profileComplete: !!u.profile_complete || false
  };
}
async function getAuthUserFromRequest(req, db2) {
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const bearerToken = bearerRaw && bearerRaw !== "null" && bearerRaw !== "undefined" ? bearerRaw : "";
  if (bearerToken) {
    const token = bearerToken;
    try {
      const resolved = await resolveUserBySessionToken(db2, token);
      if (!resolved) {
        req.session.user = null;
        return null;
      }
      const u = resolved.row;
      if (u.is_blocked) {
        req.session.user = null;
        return null;
      }
      const authUser = rowsToAuthUser(u, token);
      req.session.user = authUser;
      return authUser;
    } catch (e) {
      console.error("[Auth] Bearer token lookup error:", e);
      return null;
    }
  }
  const sessionUser = req.session.user;
  if (!sessionUser?.id) return null;
  try {
    const result = await db2.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE id = $1",
      [sessionUser.id]
    );
    if (result.rows.length === 0) {
      req.session.user = null;
      return null;
    }
    const row = result.rows[0];
    if (row.is_blocked) {
      req.session.user = null;
      return null;
    }
    const cookieTok = sessionUser.sessionToken;
    if (cookieTok && !await userHasSessionToken(db2, sessionUser.id, cookieTok)) {
      req.session.user = null;
      return null;
    }
    if (row.session_token && !sessionUser.sessionToken) {
      req.session.user = null;
      return null;
    }
    const authUser = rowsToAuthUser(row, cookieTok || row.session_token);
    req.session.user = authUser;
    return authUser;
  } catch (e) {
    console.error("[Auth] Session user lookup error:", e);
    return null;
  }
}
var init_auth_utils = __esm({
  "server/auth-utils.ts"() {
    "use strict";
    init_user_sessions();
  }
});

// server/native-device-binding.ts
function getInstallationIdFromRequest(req) {
  const raw = (req.get("x-app-device-id") || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return raw;
}
function getClientPlatform(req) {
  const p = (req.get("x-client-platform") || "").trim().toLowerCase();
  if (p === "ios" || p === "android" || p === "web") return p;
  return null;
}
function getWebFormFactorFromRequest(req) {
  const raw = (req.get("x-web-form-factor") || "").trim().toLowerCase();
  if (raw === "phone" || raw === "mobile") return "phone";
  if (raw === "desktop" || raw === "laptop") return "desktop";
  const ua = (req.get("user-agent") || "").toLowerCase();
  if (/ipad/i.test(ua) && !/mobile/i.test(ua)) return "desktop";
  if (/mobile|android|iphone|ipod|webos|blackberry|iemobile|opera mini/i.test(ua)) return "phone";
  return "desktop";
}
async function insertBlockEvent(db2, row) {
  await db2.query(
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
      Date.now()
    ]
  );
}
async function logWrongInstallationAttempt(db2, req, userId, boundId, attemptedId, meta, reason = "wrong_device_login_denied") {
  await insertBlockEvent(db2, {
    userId,
    attempted: attemptedId,
    bound: boundId,
    phone: meta.phone ?? null,
    email: meta.email ?? null,
    platform: getClientPlatform(req) ?? void 0,
    reason
  });
}
async function assertNativePaidPurchaseInstallation(db2, userId, req) {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return { ok: true };
  const plat = getClientPlatform(req);
  const r = await db2.query(
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
      web_device_id_desktop: row.wdk
    },
    req,
    inst,
    plat
  );
  if (!ok) {
    return {
      ok: false,
      message: "Purchases must be completed on the same device/browser installation registered for this account."
    };
  }
  return { ok: true };
}
async function finalizeStudentWebSlotsAfterAuth(db2, userId, role, req) {
  if (role === "admin") return;
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  if (getClientPlatform(req) !== "web") return;
  const factor = getWebFormFactorFromRequest(req);
  const slot = factor === "phone" ? "phone" : "desktop";
  await db2.query(
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
async function finalizeInstallationBindAfterPurchase(db2, userId, req) {
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  const ur = await db2.query("SELECT role FROM users WHERE id = $1", [userId]);
  const role = ur.rows[0]?.role;
  await finalizeStudentWebSlotsAfterAuth(db2, userId, role, req);
  await db2.query("UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND app_bound_device_id IS NULL", [inst, userId]);
}
async function bindDeviceForNativeFirstLogin(db2, userId, role, req) {
  if (role === "admin") return;
  const plat = getClientPlatform(req);
  if (plat !== "ios" && plat !== "android") return;
  const inst = getInstallationIdFromRequest(req);
  if (!inst || inst === "web_anon") return;
  await db2.query(
    "UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND (app_bound_device_id IS NULL OR app_bound_device_id = '')",
    [inst, userId]
  );
}
function studentInstallationMatchesActiveSession(row, req, cand, plat) {
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
async function enforceInstallationBinding(db2, req, userId, role) {
  if (role === "admin") return true;
  const r = await db2.query(
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
async function assertLoginAllowedForInstallation(db2, req, opts) {
  if (opts.role === "admin") return { ok: true };
  const ur = await db2.query(
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
  const bodyId = opts.bodyDeviceId && String(opts.bodyDeviceId).trim() || "";
  const attempted = attemptHeader || bodyId || null;
  const plat = getClientPlatform(req);
  const appb = row.app_bound_device_id ? String(row.app_bound_device_id).trim() : "";
  const wph = String(row.wph ?? "").trim();
  const wdk = String(row.wdk ?? "").trim();
  if (plat === "ios" || plat === "android") {
    if (!appb) return { ok: true };
    if (!attempted || attempted !== appb) {
      await logWrongInstallationAttempt(db2, req, opts.userId, appb, attempted, {
        phone: opts.phone ?? null,
        email: opts.email ?? null
      });
      return {
        ok: false,
        httpStatus: 403,
        message: "Access denied: this account is linked to another device/browser installation. Use the original installation or ask admin to clear the device lock."
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
        message: "Enable cookies/storage for this site and retry sign-in so your browser installation can be verified."
      };
    }
    if (attempted === wph || attempted === wdk) return { ok: true };
    if (!wph && factor === "phone") return { ok: true };
    if (!wdk && factor === "desktop") return { ok: true };
    if (!wph && !wdk && appb && attempted === appb) return { ok: true };
    if (!wph && !wdk && !appb) return { ok: true };
    await logWrongInstallationAttempt(
      db2,
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
      message: "Access denied: this account is already signed in on another phone web and/or laptop web browser. Use those browsers or ask admin to clear the web device lock."
    };
  }
  if (!appb) return { ok: true };
  if (!attempted || attempted !== appb) {
    await logWrongInstallationAttempt(db2, req, opts.userId, appb, attempted, {
      phone: opts.phone ?? null,
      email: opts.email ?? null
    });
    return {
      ok: false,
      httpStatus: 403,
      message: "Access denied: this account is linked to another device/browser installation. Use the original installation or ask admin to clear the device lock."
    };
  }
  return { ok: true };
}
var init_native_device_binding = __esm({
  "server/native-device-binding.ts"() {
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

// server/user-account-purge.ts
async function purgeStudentAccountById(db2, userId) {
  const id = userId;
  let spSeq = 0;
  const withSavepoint = async (label, fn) => {
    const spName = `purge_sp_${spSeq++}`;
    await db2.query(`SAVEPOINT ${spName}`);
    try {
      const out = await fn();
      await db2.query(`RELEASE SAVEPOINT ${spName}`);
      return out;
    } catch (err) {
      await db2.query(`ROLLBACK TO SAVEPOINT ${spName}`).catch(() => {
      });
      await db2.query(`RELEASE SAVEPOINT ${spName}`).catch(() => {
      });
      err.purgeStep = label;
      throw err;
    }
  };
  const safeDeleteByUser = async (tableName) => {
    try {
      await withSavepoint(tableName, async () => {
        await db2.query(`DELETE FROM ${tableName} WHERE user_id = $1`, [id]);
      });
    } catch (err) {
      const code = String(err?.code || "");
      if (code === "42P01" || code === "42703") return;
      throw new Error(
        `[purge:${tableName}] code=${code || "unknown"} constraint=${String(err?.constraint || "")} detail=${String(err?.detail || err?.message || "")}`
      );
    }
  };
  try {
    const discovered = await db2.query(
      `SELECT DISTINCT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name = 'user_id'
         AND table_name <> 'users'`
    );
    for (const row of discovered.rows) {
      const tableName = String(row.table_name || "");
      if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) continue;
      await safeDeleteByUser(tableName);
    }
  } catch {
  }
  await safeDeleteByUser("user_push_tokens");
  await safeDeleteByUser("user_sessions");
  await safeDeleteByUser("lecture_progress");
  await safeDeleteByUser("live_class_recording_progress");
  await safeDeleteByUser("live_chat_messages");
  await safeDeleteByUser("live_class_hand_raises");
  await safeDeleteByUser("live_class_viewers");
  await safeDeleteByUser("device_block_events");
  await safeDeleteByUser("user_missions");
  await safeDeleteByUser("doubts");
  await safeDeleteByUser("media_tokens");
  await safeDeleteByUser("download_tokens");
  await safeDeleteByUser("test_attempts");
  await safeDeleteByUser("test_purchases");
  await safeDeleteByUser("question_reports");
  await safeDeleteByUser("enrollments");
  await safeDeleteByUser("notifications");
  await safeDeleteByUser("payments");
  await safeDeleteByUser("book_purchases");
  await safeDeleteByUser("book_click_tracking");
  await safeDeleteByUser("folder_purchases");
  await safeDeleteByUser("support_messages");
  await safeDeleteByUser("user_downloads");
  await safeDeleteByUser("mission_attempts");
  await withSavepoint("users", async () => {
    await db2.query("DELETE FROM users WHERE id = $1", [id]);
  }).catch((err) => {
    const code = String(err?.code || "");
    throw new Error(
      `[purge:users] code=${code || "unknown"} constraint=${String(err?.constraint || "")} detail=${String(err?.detail || err?.message || "")}`
    );
  });
}
var init_user_account_purge = __esm({
  "server/user-account-purge.ts"() {
    "use strict";
  }
});

// server/auth-routes.ts
import { createHmac as createHmac2, timingSafeEqual as timingSafeEqual3 } from "node:crypto";
function getTokenSecret() {
  return process.env.OTP_HMAC_SECRET || process.env.SESSION_SECRET || "dev-otp-secret";
}
function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - input.length % 4);
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function signRegistrationToken(payload) {
  const body = { ...payload, exp: Date.now() + REGISTRATION_TOKEN_TTL_MS };
  const b64 = toBase64Url(Buffer.from(JSON.stringify(body), "utf8"));
  const sig = toBase64Url(createHmac2("sha256", getTokenSecret()).update(b64).digest());
  return `${b64}.${sig}`;
}
function verifyRegistrationToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = toBase64Url(createHmac2("sha256", getTokenSecret()).update(b64).digest());
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual3(sigBuf, expBuf)) return null;
  try {
    const json = fromBase64Url(b64).toString("utf8");
    const obj = JSON.parse(json);
    if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
    if (obj.type !== "phone" && obj.type !== "email") return null;
    if (typeof obj.identifier !== "string" || !obj.identifier) return null;
    return obj;
  } catch {
    return null;
  }
}
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
function regenerateSession(req) {
  return new Promise((resolve2, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve2();
    });
  });
}
function destroySession(req) {
  return new Promise((resolve2, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve2();
    });
  });
}
function normalizePhone(input) {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}
function normalizeEmail(input) {
  return String(input || "").trim().toLowerCase();
}
function evaluateOtpSendThrottle(snap, now) {
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
  runInTransaction: runInTransaction2
}) {
  const finalizeAuthenticatedSession = async (req, user, deviceId, clearOtp) => {
    const sessionToken = generateSecureToken2();
    const normalizedDeviceId = deviceId || null;
    await persistLoginSession(db2, user, sessionToken, normalizedDeviceId, { clearOtp });
    await finalizeStudentWebSlotsAfterAuth(db2, Number(user.id), String(user.role), req);
    await bindDeviceForNativeFirstLogin(db2, Number(user.id), String(user.role), req);
    const sessionUser = buildSessionUserFromRow(user, { sessionToken, deviceId: normalizedDeviceId });
    await regenerateSession(req);
    req.session.user = sessionUser;
    return { success: true, user: sessionUser };
  };
  const registrationTokenPayloadResponse = (identifier, tokenType) => {
    const registrationToken = signRegistrationToken({
      identifier,
      type: tokenType,
      phone: tokenType === "phone" ? identifier : void 0,
      email: tokenType === "email" ? identifier : void 0
    });
    return {
      success: true,
      registrationToken,
      profileComplete: false,
      identifier,
      type: tokenType
    };
  };
  app2.post("/api/auth/send-otp", async (req, res) => {
    try {
      const { identifier, type } = req.body;
      if (!identifier || !type) {
        return res.status(400).json({ message: "Identifier and type are required" });
      }
      const isPhone = type === "phone";
      let normalizedIdentifier;
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
      const otp = generateOTP2();
      const otpHash = hashOtpValue2(otp);
      const otpExpires = now + 10 * 60 * 1e3;
      const isDev = process.env.NODE_ENV !== "production";
      let lockedUntilForClient = null;
      const userRow = isPhone ? await db2.query(
        "SELECT id, otp_send_count, otp_send_window_start, otp_send_locked_until FROM users WHERE phone = $1",
        [normalizedIdentifier]
      ) : await db2.query(
        "SELECT id, otp_send_count, otp_send_window_start, otp_send_locked_until FROM users WHERE LOWER(email) = LOWER($1)",
        [normalizedIdentifier]
      );
      if (userRow.rows.length > 0) {
        const u = userRow.rows[0];
        let locked = u.otp_send_locked_until != null ? Number(u.otp_send_locked_until) : null;
        let count = Number(u.otp_send_count || 0);
        let lastSend = u.otp_send_window_start != null ? Number(u.otp_send_window_start) : null;
        if (locked != null && locked <= now) {
          await db2.query(
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
            send_locked_until: locked
          },
          now
        );
        if (!decision.ok) {
          const msg = decision.reason === "cooldown" ? OTP_COOLDOWN_MESSAGE : OTP_LOCKOUT_MESSAGE;
          return res.status(429).json({
            message: msg,
            lockedUntil: decision.lockedUntil,
            reason: decision.reason
          });
        }
        await db2.query(
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
        const challengeRow = await db2.query(
          "SELECT send_count, send_window_start, send_locked_until FROM otp_challenges WHERE identifier = $1",
          [normalizedIdentifier]
        );
        let locked = null;
        let count = 0;
        let lastSend = null;
        if (challengeRow.rows.length > 0) {
          const r = challengeRow.rows[0];
          locked = r.send_locked_until != null ? Number(r.send_locked_until) : null;
          count = Number(r.send_count || 0);
          lastSend = r.send_window_start != null ? Number(r.send_window_start) : null;
          if (locked != null && locked <= now) {
            await db2.query(
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
            send_locked_until: locked
          },
          now
        );
        if (!decision.ok) {
          const msg = decision.reason === "cooldown" ? OTP_COOLDOWN_MESSAGE : OTP_LOCKOUT_MESSAGE;
          return res.status(429).json({
            message: msg,
            lockedUntil: decision.lockedUntil,
            reason: decision.reason
          });
        }
        await db2.query(
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
            now
          ]
        );
        lockedUntilForClient = decision.newSendLockedUntil;
      }
      let smsSent = false;
      if (isPhone) {
        try {
          smsSent = await sendOTPviaSMS2(normalizedIdentifier, otp);
        } catch (smsErr) {
          console.error("[OTP] SMS sending threw error:", smsErr);
        }
        if (!smsSent) {
          console.log("[OTP] SMS delivery failed, OTP stored in DB");
        }
      }
      return res.json({
        success: true,
        message: isPhone ? smsSent ? "OTP sent to your phone" : "OTP sent. If SMS is delayed, please wait 30 seconds and try again." : "OTP sent successfully",
        smsSent,
        devOtp: isDev ? otp : "",
        method: isPhone ? void 0 : "server",
        lockedUntil: lockedUntilForClient
      });
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
      const isPhone = type !== "email";
      const normalizedIdentifier = isPhone ? normalizePhone(identifier) : normalizeEmail(identifier);
      if (!normalizedIdentifier) {
        return res.status(400).json({ message: "Identifier and OTP are required" });
      }
      const result = isPhone ? await db2.query("SELECT * FROM users WHERE phone = $1", [normalizedIdentifier]) : await db2.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [normalizedIdentifier]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        if (user.is_blocked) return res.status(401).json({ message: GENERIC_OTP_ERROR });
        const lockedUntil = user.otp_locked_until != null ? Number(user.otp_locked_until) : 0;
        if (lockedUntil > Date.now()) {
          return res.status(429).json({ message: "Too many attempts. Please try again later." });
        }
        if (!verifyOtpValue2(user.otp, otp)) {
          const lockMs = Date.now() + 15 * 60 * 1e3;
          await db2.query(
            `UPDATE users SET
               otp_failed_attempts = LEAST(COALESCE(otp_failed_attempts, 0) + 1, 99),
               otp_locked_until = CASE WHEN COALESCE(otp_failed_attempts, 0) + 1 >= 5 THEN $1 ELSE otp_locked_until END
             WHERE id = $2`,
            [lockMs, user.id]
          );
          return res.status(401).json({ message: GENERIC_OTP_ERROR });
        }
        if (Date.now() > Number(user.otp_expires_at)) return res.status(401).json({ message: GENERIC_OTP_ERROR });
        const loginGate = await assertLoginAllowedForInstallation(db2, req, {
          userId: user.id,
          role: user.role,
          bodyDeviceId: deviceId || null,
          phone: user.phone,
          email: user.email
        });
        if (!loginGate.ok) {
          return res.status(loginGate.httpStatus).json({ message: loginGate.message });
        }
        const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, true);
        return res.json(finalized);
      }
      const chRow = await db2.query(
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
      if (!verifyOtpValue2(ch.otp_hash, otp) || nowMs > Number(ch.otp_expires_at || 0)) {
        const failCount = Number(ch.verify_failed_attempts || 0) + 1;
        const lockUntil = failCount >= 5 ? nowMs + 15 * 60 * 1e3 : null;
        await db2.query(
          `UPDATE otp_challenges SET
             verify_failed_attempts = $1,
             verify_locked_until = COALESCE($2, verify_locked_until),
             updated_at = $3
           WHERE identifier = $4`,
          [failCount, lockUntil, nowMs, normalizedIdentifier]
        );
        return res.status(401).json({ message: GENERIC_OTP_ERROR });
      }
      await db2.query(
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
  app2.post("/api/auth/verify-firebase", async (req, res) => {
    try {
      const { idToken, phone: phoneNumber, deviceId } = req.body;
      if (!idToken || !phoneNumber) {
        return res.status(400).json({ message: "ID token and phone are required" });
      }
      const decoded = await verifyFirebaseToken2(idToken);
      const claimedPhone = normalizePhone(phoneNumber);
      const tokenPhone = normalizePhone(decoded.phone_number);
      if (!tokenPhone || !claimedPhone || tokenPhone !== claimedPhone) {
        return res.status(400).json({ message: "Phone number mismatch" });
      }
      const result = await db2.query("SELECT * FROM users WHERE phone = $1", [claimedPhone]);
      if (result.rows.length === 0) {
        return res.json(registrationTokenPayloadResponse(claimedPhone, "phone"));
      }
      const user = result.rows[0];
      const loginGate = await assertLoginAllowedForInstallation(db2, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: deviceId || null,
        phone: user.phone,
        email: user.email
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
  app2.get("/api/auth/me", async (req, res) => {
    const sessionUser = req.session.user;
    if (!sessionUser) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        try {
          const resolved = await resolveUserBySessionToken(db2, token);
          if (resolved) {
            const row = resolved.row;
            if (row.is_blocked) return res.status(403).json({ message: "account_blocked" });
            const fresh = {
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              role: row.role,
              sessionToken: token,
              profileComplete: !!row.profile_complete,
              date_of_birth: row.date_of_birth,
              photo_url: row.photo_url
            };
            const bindBearer = await enforceInstallationBinding(db2, req, row.id, row.role);
            if (!bindBearer) {
              req.session.user = null;
              return res.status(401).json({ message: "device_binding_mismatch" });
            }
            await finalizeStudentWebSlotsAfterAuth(db2, row.id, row.role, req);
            req.session.user = fresh;
            return res.json(fresh);
          }
        } catch {
        }
        return res.status(401).json({ message: "Not authenticated" });
      }
      return res.status(200).json({});
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
      const tok = sessionUser.sessionToken;
      if (tok && !await userHasSessionToken(db2, sessionUser.id, tok)) {
        req.session.user = null;
        return res.status(401).json({ message: "logged_in_elsewhere" });
      }
      const bindSes = await enforceInstallationBinding(db2, req, sessionUser.id, row.role);
      if (!bindSes) {
        req.session.user = null;
        return res.status(401).json({ message: "device_binding_mismatch" });
      }
      await finalizeStudentWebSlotsAfterAuth(db2, sessionUser.id, row.role, req);
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
      const result = await db2.query("SELECT * FROM users WHERE phone = $1", [phone]);
      if (result.rows.length === 0) {
        return res.json(registrationTokenPayloadResponse(phone, "phone"));
      }
      const user = result.rows[0];
      const loginGate = await assertLoginAllowedForInstallation(db2, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: deviceId || null,
        phone: user.phone,
        email: user.email
      });
      if (!loginGate.ok) {
        return res.status(loginGate.httpStatus).json({ message: loginGate.message });
      }
      const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, false);
      res.json(finalized);
    } catch (err) {
      console.error("Firebase login error:", err);
      if (err.code === "auth/id-token-expired") {
        return res.status(401).json({ message: "Token expired, please try again" });
      }
      res.status(500).json({ message: "Authentication failed" });
    }
  });
  app2.post("/api/auth/logout", async (req, res) => {
    const cookie = req.session?.cookie;
    const sessionUser = req.session?.user;
    let revokeUserId = sessionUser?.id ? Number(sessionUser.id) : null;
    let revokeToken = sessionUser?.sessionToken || null;
    if (!revokeToken) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) revokeToken = authHeader.slice(7).trim();
    }
    if (!revokeUserId && revokeToken) {
      const resolved = await resolveUserBySessionToken(db2, revokeToken).catch(() => null);
      if (resolved?.row?.id) revokeUserId = Number(resolved.row.id);
    }
    if (revokeUserId && revokeToken) {
      await revokeSessionTokenForUser(db2, revokeUserId, revokeToken).catch(() => {
      });
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
        sameSite: cookie.sameSite,
        domain: cookie.domain
      });
    } else {
      res.clearCookie("connect.sid", { path: "/" });
    }
    res.json({ success: true });
  });
  app2.delete("/api/auth/account", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user?.id) return res.status(401).json({ message: "Not authenticated" });
      if (user.role === "admin") {
        return res.status(403).json({ message: "Admin accounts cannot be deleted here. Contact support." });
      }
      await runInTransaction2((tx) => purgeStudentAccountById(tx, user.id));
      const cookie = req.session?.cookie;
      try {
        await destroySession(req);
      } catch {
        req.session.user = null;
      }
      if (cookie) {
        res.clearCookie("connect.sid", {
          path: cookie.path || "/",
          httpOnly: cookie.httpOnly !== false,
          secure: !!cookie.secure,
          sameSite: cookie.sameSite,
          domain: cookie.domain
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete account error:", err);
      res.status(500).json({ message: "Failed to delete account" });
    }
  });
  app2.post("/api/auth/email-login", async (req, res) => {
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
        result = await db2.query("SELECT * FROM users WHERE phone = $1", [identifier]);
      } else {
        result = await db2.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1)", [identifier]);
      }
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "register_first" });
      }
      const user = result.rows[0];
      if (user.is_blocked) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      if (!user.profile_complete) {
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
            await db2.query("UPDATE users SET password_hash = $1 WHERE id = $2", [migratedHash, user.id]);
          }
        }
      } catch (verifyErr) {
        console.warn("[Auth] email-login: password verification failed with malformed hash/user data", {
          userId: user.id,
          error: verifyErr instanceof Error ? verifyErr.message : "unknown_error"
        });
        return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      }
      if (!matched) return res.status(401).json({ message: GENERIC_LOGIN_ERROR });
      console.log("[Auth] email-login: device gate start", { userId: user.id });
      const gate = await assertLoginAllowedForInstallation(db2, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: typeof deviceId === "string" ? deviceId : null,
        phone: user.phone,
        email: user.email
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
  app2.post("/api/auth/register-complete", async (req, res) => {
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
      const existingByIdentifier = phone ? await db2.query("SELECT id FROM users WHERE phone = $1", [phone]) : await db2.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [tokenEmail]);
      if (existingByIdentifier.rows.length > 0) {
        return res.status(409).json({ message: "Account already exists for this phone/email. Please sign in." });
      }
      const finalEmail = typeof email === "string" && email.trim().length > 0 ? email.trim().toLowerCase() : tokenEmail;
      if (finalEmail) {
        const conflict = await db2.query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [finalEmail]);
        if (conflict.rows.length > 0) {
          return res.status(409).json({ message: "This email is already in use. Use a different email or sign in." });
        }
      }
      const passwordHash = password ? await hashPassword(password) : null;
      const photo = typeof photoUrl === "string" && photoUrl.length > 0 ? photoUrl : null;
      const dob = typeof dateOfBirth === "string" && dateOfBirth.length > 0 ? dateOfBirth : null;
      const now = Date.now();
      const inserted = await db2.query(
        `INSERT INTO users
          (name, email, phone, role, profile_complete, date_of_birth, photo_url, password_hash, created_at, last_active_at)
         VALUES ($1, $2, $3, 'student', TRUE, $4, $5, $6, $7, $7)
         RETURNING *`,
        [normalizedName, finalEmail, phone, dob, photo, passwordHash, now]
      );
      const user = inserted.rows[0];
      await db2.query("DELETE FROM otp_challenges WHERE identifier = $1", [payload.identifier]).catch(() => {
      });
      const gate = await assertLoginAllowedForInstallation(db2, req, {
        userId: user.id,
        role: user.role,
        bodyDeviceId: typeof deviceId === "string" ? deviceId : null,
        phone: user.phone,
        email: user.email
      });
      if (!gate.ok) {
        return res.status(gate.httpStatus).json({ message: gate.message });
      }
      const dev = typeof deviceId === "string" ? deviceId : null;
      const finalized = await finalizeAuthenticatedSession(req, user, dev, true);
      const refreshed = await db2.query(
        "SELECT id, name, email, phone, role, session_token, profile_complete, date_of_birth, photo_url FROM users WHERE id = $1",
        [user.id]
      );
      const row = refreshed.rows[0] || user;
      const responseUser = {
        ...finalized.user,
        name: row.name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        profileComplete: !!row.profile_complete,
        date_of_birth: row.date_of_birth ?? null,
        photo_url: row.photo_url ?? null
      };
      req.session.user = responseUser;
      res.json({ success: true, user: responseUser });
    } catch (err) {
      console.error("Register-complete error:", err);
      res.status(500).json({ message: "Failed to complete registration" });
    }
  });
  app2.put("/api/auth/profile", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { name, dateOfBirth, email, photoUrl, password } = req.body;
      const normalizedName = typeof name === "string" ? name.trim() : void 0;
      if (name !== void 0 && !normalizedName) return res.status(400).json({ message: "Name is required" });
      if (normalizedName === void 0 && dateOfBirth === void 0 && email === void 0 && photoUrl === void 0 && !password) {
        return res.status(400).json({ message: "No profile fields provided" });
      }
      let passwordHash = null;
      if (password) {
        passwordHash = await hashPassword(password);
      }
      const updates = [];
      const params = [];
      if (normalizedName !== void 0) {
        params.push(normalizedName);
        updates.push(`name = $${params.length}`);
      }
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
      const keepTok = user.sessionToken || row.session_token;
      const updated = buildSessionUserFromRow(row, {
        sessionToken: keepTok,
        deviceId: user.deviceId
      });
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
      const storedHash = dbUser.rows[0].password_hash;
      if (storedHash && !oldPassword) {
        return res.status(400).json({ message: "Current password is required" });
      }
      if (oldPassword && storedHash) {
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
var GENERIC_LOGIN_ERROR, GENERIC_OTP_ERROR, OTP_RESEND_COOLDOWN_MS, OTP_SENDS_PER_CYCLE, OTP_SEND_LOCK_MS, OTP_LOCKOUT_MESSAGE, OTP_COOLDOWN_MESSAGE, REGISTRATION_TOKEN_TTL_MS;
var init_auth_routes = __esm({
  "server/auth-routes.ts"() {
    "use strict";
    init_password_utils();
    init_native_device_binding();
    init_user_sessions();
    init_user_account_purge();
    GENERIC_LOGIN_ERROR = "Invalid credentials";
    GENERIC_OTP_ERROR = "Invalid or expired OTP";
    OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1e3;
    OTP_SENDS_PER_CYCLE = 3;
    OTP_SEND_LOCK_MS = 24 * 60 * 60 * 1e3;
    OTP_LOCKOUT_MESSAGE = "Too many OTP attempts. Please try again after 24 hours.";
    OTP_COOLDOWN_MESSAGE = "Please wait before requesting another OTP.";
    REGISTRATION_TOKEN_TTL_MS = 15 * 60 * 1e3;
  }
});

// server/media-key-utils.ts
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function stripHostIfUrl(raw) {
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const path2 = `${parsed.pathname || ""}${parsed.search || ""}${parsed.hash || ""}`;
    return path2 || raw;
  } catch {
    return raw;
  }
}
function normalizeSlashes(value) {
  return value.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
}
function removeSearchAndHash(value) {
  const noHash = value.split("#")[0] || "";
  return noHash.split("?")[0] || "";
}
function canonicalMediaKey(raw) {
  let key = String(raw || "").trim();
  if (!key) return "";
  key = stripHostIfUrl(key);
  key = removeSearchAndHash(key);
  key = normalizeSlashes(key).replace(/^\/+/, "");
  key = safeDecode(key);
  key = normalizeSlashes(key).replace(/^\/+/, "");
  const lower = key.toLowerCase();
  if (lower.startsWith(MEDIA_PROXY_PREFIX)) {
    key = key.slice(MEDIA_PROXY_PREFIX.length);
  }
  key = key.replace(/^\/+/, "").replace(/\/+$/g, "");
  if (!key || key.includes("..")) return "";
  return key;
}
function mediaKeyMatchVariants(raw) {
  const canonical = canonicalMediaKey(raw);
  if (!canonical) return [];
  const decoded = safeDecode(canonical);
  const encoded = encodeURI(canonical);
  const values = /* @__PURE__ */ new Set([
    canonical,
    decoded,
    encoded,
    `api/media/${canonical}`,
    `/api/media/${canonical}`,
    `api/media/${decoded}`,
    `/api/media/${decoded}`,
    `api/media/${encoded}`,
    `/api/media/${encoded}`
  ]);
  return [...values].filter(Boolean);
}
var MEDIA_PROXY_PREFIX;
var init_media_key_utils = __esm({
  "server/media-key-utils.ts"() {
    "use strict";
    MEDIA_PROXY_PREFIX = "api/media/";
  }
});

// server/r2-presign-read.ts
async function presignR2GetObject(getR2Client, objectKey, expiresInSeconds) {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  if (!bucket || !objectKey) return null;
  try {
    const r2 = await getR2Client();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    return await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: Math.min(Math.max(60, expiresInSeconds), 7 * 24 * 60 * 60) }
    );
  } catch (err) {
    console.warn("[r2-presign-read] failed:", err?.message || err);
    return null;
  }
}
var init_r2_presign_read = __esm({
  "server/r2-presign-read.ts"() {
    "use strict";
  }
});

// server/pdf-routes.ts
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
function isPrivateOrLocalHost(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".local")) return true;
  const ipVersion = isIP(lower);
  if (!ipVersion) return false;
  if (ipVersion === 4) {
    const [a, b] = lower.split(".").map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
}
async function resolveToPublicAddress(hostname) {
  try {
    const resolved = await lookup(hostname, { all: true });
    if (!resolved.length) return false;
    return resolved.every((entry) => !isPrivateOrLocalHost(entry.address));
  } catch {
    return false;
  }
}
function publicApiBaseUrl() {
  const raw = String(process.env.PUBLIC_API_BASE_URL || process.env.API_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (raw) return raw;
  return "https://api.3ilearning.in";
}
function mediaProxyUrl(publicBase, fileKey, token) {
  const encPath = fileKey.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return `${publicBase}/api/media/${encPath}?token=${encodeURIComponent(token)}`;
}
function registerPdfRoutes({ app: app2, db: db2, getAuthUser: getAuthUser2, getR2Client }) {
  app2.get("/api/pdf-viewer", async (req, res) => {
    const { token, key } = req.query;
    if (!token || !key || typeof token !== "string" || typeof key !== "string") {
      return res.status(400).send("Missing token or key");
    }
    const fileKey = canonicalMediaKey(key);
    if (!fileKey) {
      return res.status(400).send("Invalid key");
    }
    const tokenResult = await db2.query("SELECT user_id, expires_at FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [
      token,
      Date.now(),
      fileKey
    ]).catch(() => ({ rows: [] }));
    if (!tokenResult.rows.length) {
      return res.status(401).send("Token expired or invalid");
    }
    const expiresAt = Number(tokenResult.rows[0].expires_at);
    const expMs = Number.isFinite(expiresAt) ? expiresAt : Date.now() + 10 * 60 * 1e3;
    const ttlSec = Math.max(60, Math.floor((expMs - Date.now()) / 1e3));
    const readUrl = await presignR2GetObject(getR2Client, fileKey, ttlSec);
    const publicBase = publicApiBaseUrl();
    const pdfUrl = readUrl || mediaProxyUrl(publicBase, fileKey, token);
    const withCredentials = !readUrl;
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
.error button{margin-top:8px;padding:10px 18px;background:#1A56DB;border:none;border-radius:8px;color:#fff;font-size:13px;cursor:pointer}
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
  var withCredentials=${JSON.stringify(withCredentials)};
  function renderPdf(url){
    return pdfjsLib.getDocument({url:url,withCredentials:withCredentials}).promise.then(function(pdf){
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
  function showError(canRetry){
    var loading=document.getElementById('loading');if(loading)loading.style.display='none';
    var existing=document.querySelector('.error');if(existing)existing.remove();
    var d=document.createElement('div');d.className='error';
    var h=document.createElement('h3');h.textContent='Unable to load PDF';d.appendChild(h);
    var p=document.createElement('p');p.textContent='The file is taking longer than expected. Check your connection and try again.';d.appendChild(p);
    if(canRetry){
      var b=document.createElement('button');b.type='button';b.textContent='Try again';
      b.addEventListener('click',function(){d.remove();var l=document.getElementById('loading');if(l)l.style.display='flex';attempt(0);});
      d.appendChild(b);
    }
    document.body.appendChild(d);
  }
  function attempt(retryCount){
    renderPdf(pdfUrl).catch(function(){
      // One automatic retry \u2014 most R2 timeouts are transient cold-read stalls.
      if(retryCount<1){
        setTimeout(function(){attempt(retryCount+1);},1500);
        return;
      }
      showError(true);
    });
  }
  attempt(0);
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
    (async () => {
      const user = await getAuthUser2(req);
      if (!user) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const { url } = req.query;
      if (!url || typeof url !== "string") {
        return res.status(400).json({ message: "URL is required" });
      }
      let currentUrl = url;
      for (let redirectCount = 0; redirectCount <= MAX_PDF_PROXY_REDIRECTS; redirectCount += 1) {
        let parsedUrl;
        try {
          parsedUrl = new URL(currentUrl);
        } catch {
          return res.status(400).json({ message: "Invalid URL" });
        }
        if (parsedUrl.protocol !== "https:") {
          return res.status(400).json({ message: "Only HTTPS PDF URLs are allowed" });
        }
        if (isPrivateOrLocalHost(parsedUrl.hostname)) {
          return res.status(403).json({ message: "Blocked host" });
        }
        const hostname = parsedUrl.hostname.toLowerCase();
        const isAllowedHost = PDF_PROXY_ALLOWED_HOSTS.has(hostname);
        const isGoogleDrive = hostname.includes("drive.google.com") || hostname.includes("docs.google.com");
        if (!isAllowedHost) {
          return res.status(400).json({ message: "Only trusted hosts are allowed" });
        }
        const dnsSafe = await resolveToPublicAddress(parsedUrl.hostname);
        if (!dnsSafe) {
          return res.status(403).json({ message: "Blocked host" });
        }
        if (isGoogleDrive) {
          const fileIdMatch = currentUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
          if (fileIdMatch) {
            currentUrl = `https://drive.google.com/uc?export=download&id=${fileIdMatch[1]}`;
            continue;
          }
        }
        const upstream = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: {
            "User-Agent": "3i-learning-pdf-proxy/1.0",
            Accept: "application/pdf,*/*"
          },
          signal: AbortSignal.timeout(3e4)
        });
        if (upstream.status >= 300 && upstream.status < 400) {
          const location = upstream.headers.get("location");
          if (!location) return res.status(502).json({ message: "Invalid redirect from source" });
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        if (!upstream.ok || !upstream.body) {
          return res.status(502).json({ message: "Failed to fetch PDF" });
        }
        const contentLength = Number(upstream.headers.get("content-length") || "0");
        if (Number.isFinite(contentLength) && contentLength > MAX_PDF_PROXY_BYTES) {
          return res.status(413).json({ message: "PDF too large" });
        }
        const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
        if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream")) {
          return res.status(400).json({ message: "Source is not a PDF" });
        }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Cache-Control", "private, no-store");
        if (contentLength > 0) {
          res.setHeader("Content-Length", String(contentLength));
        }
        const { Readable } = await import("stream");
        Readable.fromWeb(upstream.body).pipe(res);
        return;
      }
      return res.status(400).json({ message: "Too many redirects" });
    })().catch((err) => {
      console.error("[PDF-Proxy] Request error:", err?.message || err);
      if (!res.headersSent) {
        res.status(502).json({ message: "Failed to fetch PDF" });
      }
    });
  });
}
var MAX_PDF_PROXY_BYTES, MAX_PDF_PROXY_REDIRECTS, PDF_PROXY_ALLOWED_HOSTS;
var init_pdf_routes = __esm({
  "server/pdf-routes.ts"() {
    "use strict";
    init_media_key_utils();
    init_r2_presign_read();
    MAX_PDF_PROXY_BYTES = 30 * 1024 * 1024;
    MAX_PDF_PROXY_REDIRECTS = 2;
    PDF_PROXY_ALLOWED_HOSTS = /* @__PURE__ */ new Set([
      "drive.google.com",
      "docs.google.com",
      "lh3.googleusercontent.com"
    ]);
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
function httpStatusForCourseVerifyError(message) {
  switch (message) {
    case "Invalid payment signature":
      return 400;
    case "Payment order not found":
      return 404;
    case "Payment does not belong to this user":
      return 403;
    case "Course mismatch":
      return 400;
    case "This course has ended":
      return 410;
    case "Course not found":
      return 404;
    case "Payment kind mismatch":
    case "Payment user mismatch":
    case "Payment course mismatch":
      return 400;
    default:
      return 500;
  }
}
function registerPaymentRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  getRazorpay: getRazorpay2,
  verifyPaymentSignature: verifyPaymentSignature2,
  runInTransaction: runInTransaction2
}) {
  db2.query(
    `CREATE TABLE IF NOT EXISTS payment_failures (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      course_id INTEGER,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      source TEXT,
      reason TEXT,
      raw_error TEXT,
      created_at BIGINT NOT NULL
    )`
  ).catch((err) => {
    console.error("[Payments] failed to ensure payment_failures table:", err);
  });
  const logPaymentFailure = async (payload) => {
    try {
      await db2.query(
        `INSERT INTO payment_failures
         (user_id, course_id, razorpay_order_id, razorpay_payment_id, source, reason, raw_error, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          payload.userId ?? null,
          payload.courseId ?? null,
          payload.orderId ?? null,
          payload.paymentId ?? null,
          payload.source,
          payload.reason ?? null,
          payload.rawError == null ? null : JSON.stringify(payload.rawError),
          Date.now()
        ]
      );
    } catch (err) {
      console.error("[Payments] failed to log payment failure:", err);
    }
  };
  const verifyOrderOwnershipAndAmount = async ({
    orderId,
    expectedKind,
    expectedUserId,
    expectedItemId,
    expectedAmount
  }) => {
    const razorpay = getRazorpay2();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const orderAmount = Number(order.amount || 0);
    const noteKind = String(notes.kind || "");
    const noteUserId = Number(notes.userId || 0);
    const noteTestId = Number(notes.testId || 0);
    const noteBookId = Number(notes.bookId || 0);
    const noteItemId = expectedKind === "test" ? noteTestId : noteBookId;
    if (noteKind !== expectedKind) throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== expectedUserId) throw new Error("Payment user mismatch");
    if (!noteItemId || noteItemId !== expectedItemId) throw new Error("Payment item mismatch");
    if (!orderAmount || orderAmount !== expectedAmount) throw new Error("Payment amount mismatch");
  };
  const verifyCourseOrderOwnership = async ({
    orderId,
    expectedUserId,
    expectedCourseId
  }) => {
    const razorpay = getRazorpay2();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const noteUserId = Number(notes.userId || 0);
    const noteCourseId = Number(notes.courseId || 0);
    const noteKind = String(notes.kind || "");
    if (noteKind && noteKind !== "course") throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== expectedUserId) throw new Error("Payment user mismatch");
    if (!noteCourseId || noteCourseId !== expectedCourseId) throw new Error("Payment course mismatch");
  };
  const ensureCourseEnrollment = async (exec, paymentRow) => {
    const paidCourseResult = await exec.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
    const paidCourse = paidCourseResult.rows[0];
    if (!paidCourse) throw new Error("Course not found");
    const at = Date.now();
    const vu = computeEnrollmentValidUntil(paidCourse, at);
    const existing = await exec.query(
      "SELECT id, valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2 FOR UPDATE",
      [paymentRow.user_id, paymentRow.course_id]
    );
    if (existing.rows.length === 0) {
      await exec.query(
        `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [paymentRow.user_id, paymentRow.course_id, at, vu]
      );
      await exec.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [
        paymentRow.course_id
      ]);
    } else {
      await exec.query(
        `UPDATE enrollments SET enrolled_at = $1, valid_until = $2, status = 'active'
         WHERE user_id = $3 AND course_id = $4`,
        [at, vu, paymentRow.user_id, paymentRow.course_id]
      );
    }
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
    const result = await runInTransaction2(async (tx) => {
      const paymentRecord = await tx.query(
        "SELECT * FROM payments WHERE razorpay_order_id = $1 FOR UPDATE",
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
        const paidCourseResult = await tx.query("SELECT * FROM courses WHERE id = $1", [paymentRow.course_id]);
        const paidCourse = paidCourseResult.rows[0];
        if (!paidCourse) throw new Error("Course not found");
        const endTsPaid = paidCourse.end_date != null && String(paidCourse.end_date).trim() !== "" ? Date.parse(String(paidCourse.end_date).trim()) : null;
        if (Number.isFinite(endTsPaid) && endTsPaid < Date.now()) {
          throw new Error("This course has ended");
        }
        await tx.query(
          "UPDATE payments SET razorpay_payment_id = $1, razorpay_signature = $2, status = $3 WHERE razorpay_order_id = $4",
          [paymentId, signature, "paid", orderId]
        );
      }
      await ensureCourseEnrollment(tx, paymentRow);
      return { userId: paymentRow.user_id, courseId: paymentRow.course_id };
    });
    return result;
  };
  app2.post("/api/payments/track-click", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ ok: true });
      const { courseId } = req.body;
      if (!courseId) return res.json({ ok: true });
      const course = await db2.query("SELECT price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;
      const pricePaisa = Math.round(parseFloat(String(price)) * 100);
      const now = Date.now();
      const updated = await db2.query(
        `UPDATE payments AS p
         SET click_count = COALESCE(p.click_count, 1) + 1,
             status = 'created'
         FROM (
           SELECT id FROM payments
           WHERE user_id = $1 AND course_id = $2
             AND (status = 'created' OR status IS NULL)
             AND (razorpay_order_id IS NULL OR btrim(razorpay_order_id) = '')
           ORDER BY created_at DESC
           LIMIT 1
         ) AS sub
         WHERE p.id = sub.id
         RETURNING p.id`,
        [user.id, courseId]
      );
      if (updated.rows.length === 0) {
        const paid = await db2.query(
          "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' LIMIT 1",
          [user.id, courseId]
        );
        if (paid.rows.length === 0) {
          await db2.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at)
             VALUES ($1, $2, $3, 'created', 1, $4)`,
            [user.id, courseId, pricePaisa, now]
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
      const existingEnrollment = await db2.query(
        "SELECT valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1",
        [user.id, courseId]
      );
      if (existingEnrollment.rows.length > 0) {
        const er = existingEnrollment.rows[0];
        const statusOk = er.status == null || String(er.status).toLowerCase() === "active";
        if (statusOk && !isEnrollmentExpired(er)) {
          return res.status(400).json({ message: "Already enrolled" });
        }
      }
      const amount = Math.round(parseFloat(course.price) * 100);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `course_${courseId}_user_${user.id}_${Date.now()}`,
        notes: { courseId: courseId.toString(), userId: user.id.toString(), courseTitle: course.title, kind: "course" }
      });
      console.log("[Payments] create-order success");
      try {
        await db2.query(
          "INSERT INTO payments (user_id, course_id, razorpay_order_id, amount, status, click_count, created_at) VALUES ($1, $2, $3, $4, 'created', 1, $5)",
          [user.id, courseId, order.id, amount, Date.now()]
        );
      } catch (insertErr) {
        if (insertErr?.code === "23505") {
          return res.status(409).json({ message: "Duplicate payment order; try again" });
        }
        throw insertErr;
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
    let authUserId = null;
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      authUserId = Number(user.id) || null;
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }
      const preBind = await assertNativePaidPurchaseInstallation(db2, user.id, req);
      if (!preBind.ok) {
        return res.status(403).json({ message: preBind.message });
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        expectedUserId: user.id,
        expectedCourseId: courseId
      });
      await finalizeInstallationBindAfterPurchase(db2, result.userId, req);
      console.log("[Payments] verify success");
      res.json({ success: true, message: "Payment verified and enrolled successfully" });
    } catch (err) {
      console.error("Verify payment error:", err);
      const msg = err instanceof Error ? err.message : "";
      await logPaymentFailure({
        userId: authUserId,
        courseId: Number(req.body?.courseId) || null,
        orderId: req.body?.razorpay_order_id || null,
        paymentId: req.body?.razorpay_payment_id || null,
        source: "verify",
        reason: msg || "Payment verification failed",
        rawError: err instanceof Error ? { message: err.message, stack: err.stack } : err
      });
      const status = httpStatusForCourseVerifyError(msg);
      if (status === 500) {
        return res.status(500).json({ message: "Payment verification failed" });
      }
      return res.status(status).json({ message: msg || "Payment verification failed" });
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
      await ensureCourseEnrollment(db2, pay.rows[0]);
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
        await logPaymentFailure({
          orderId: razorpay_order_id || null,
          paymentId: razorpay_payment_id || null,
          source: "verify_redirect",
          reason: "Missing redirect payment fields",
          rawError: req.body || null
        });
        return res.redirect(fail);
      }
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) {
        await logPaymentFailure({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: "Invalid payment signature"
        });
        return res.redirect(fail);
      }
      const paymentRecord = await db2.query("SELECT * FROM payments WHERE razorpay_order_id = $1", [razorpay_order_id]);
      if (paymentRecord.rows.length === 0) {
        await logPaymentFailure({
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: "Payment order not found"
        });
        return res.redirect(fail);
      }
      const paymentRow = paymentRecord.rows[0];
      await verifyCourseOrderOwnership({
        orderId: razorpay_order_id,
        expectedUserId: paymentRow.user_id,
        expectedCourseId: paymentRow.course_id
      });
      const preBind = await assertNativePaidPurchaseInstallation(db2, paymentRow.user_id, req);
      if (!preBind.ok) {
        await logPaymentFailure({
          userId: paymentRow.user_id,
          courseId: paymentRow.course_id,
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          source: "verify_redirect",
          reason: preBind.message || "device_binding_mismatch"
        });
        return res.redirect(fail);
      }
      const result = await completeCoursePaymentByOrder({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature
      });
      await finalizeInstallationBindAfterPurchase(db2, result.userId, req);
      return res.redirect(`${frontendBase}/course/${result.courseId}?payment=success`);
    } catch (err) {
      console.error("[Payments] redirect verify failed:", err);
      await logPaymentFailure({
        orderId: req.body?.razorpay_order_id || null,
        paymentId: req.body?.razorpay_payment_id || null,
        source: "verify_redirect",
        reason: "Redirect verification failed",
        rawError: err instanceof Error ? { message: err.message, stack: err.stack } : err
      });
      return res.redirect(fail);
    }
  });
  app2.post("/api/payments/track-failure", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const body = req.body || {};
      await logPaymentFailure({
        userId: user?.id ?? null,
        courseId: Number(body.courseId) || null,
        orderId: typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : null,
        paymentId: typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : null,
        source: "client_callback",
        reason: typeof body.reason === "string" ? body.reason : "Client payment failed callback",
        rawError: body.error ?? null
      });
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
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
      const testResult = await db2.query("SELECT id, price FROM tests WHERE id = $1", [testId]);
      if (!testResult.rows.length) return res.redirect(fail);
      const expectedAmount = Math.round(parseFloat(String(testResult.rows[0].price || "0")) * 100);
      await verifyOrderOwnershipAndAmount({
        orderId: razorpay_order_id,
        expectedKind: "test",
        expectedUserId: userId,
        expectedItemId: testId,
        expectedAmount
      });
      const preTest = await assertNativePaidPurchaseInstallation(db2, userId, req);
      if (!preTest.ok) return res.redirect(fail);
      await db2.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [userId, testId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db2, userId, req);
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
      const parsedTestId = Number(testId);
      if (!parsedTestId) return res.status(400).json({ message: "testId is required" });
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      const testResult = await db2.query("SELECT id, price FROM tests WHERE id = $1", [parsedTestId]);
      if (!testResult.rows.length) return res.status(404).json({ message: "Test not found" });
      const expectedAmount = Math.round(parseFloat(String(testResult.rows[0].price || "0")) * 100);
      await verifyOrderOwnershipAndAmount({
        orderId: razorpay_order_id,
        expectedKind: "test",
        expectedUserId: user.id,
        expectedItemId: parsedTestId,
        expectedAmount
      });
      const preTest = await assertNativePaidPurchaseInstallation(db2, user.id, req);
      if (!preTest.ok) {
        return res.status(403).json({ message: preTest.message });
      }
      await db2.query(
        "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
        [user.id, parsedTestId, razorpay_order_id, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db2, user.id, req);
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
    init_native_device_binding();
  }
});

// server/sse-listen-budget.ts
function sseListenCapFromPoolMax(poolMax) {
  const poolClamp = Math.max(5, poolMax);
  const fromEnv = parseInt(process.env.PG_LISTEN_SSE_MAX_CONCURRENT || "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(fromEnv, poolClamp);
  }
  return poolClamp;
}
function tryAcquireSseListen(poolMax) {
  const cap = sseListenCapFromPoolMax(poolMax);
  if (activeListenStreams >= cap) return false;
  activeListenStreams += 1;
  return true;
}
function releaseSseListen() {
  activeListenStreams = Math.max(0, activeListenStreams - 1);
}
var activeListenStreams;
var init_sse_listen_budget = __esm({
  "server/sse-listen-budget.ts"() {
    "use strict";
    activeListenStreams = 0;
  }
});

// server/support-routes.ts
function registerSupportRoutes({
  app: app2,
  db: db2,
  pool: pool2,
  listenPool: listenPool2,
  getAuthUser: getAuthUser2,
  requireAuth,
  requireAdmin
}) {
  const listenPoolMax = listenPool2.options.max ?? 32;
  app2.get("/api/support/messages", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });
  app2.get("/api/support/messages/stream", requireAuth, async (req, res) => {
    const user = req.user;
    const myUserId = Number(user?.id);
    if (!Number.isFinite(myUserId)) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }
    let closed = false;
    let listenClient = null;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      releaseSseListen();
      const c = listenClient;
      listenClient = null;
      if (!c) return;
      try {
        c.removeAllListeners("notification");
        await c.query("UNLISTEN support_chat");
      } catch {
      }
      try {
        c.release();
      } catch {
      }
    };
    try {
      listenClient = await listenPool2.connect();
    } catch (e) {
      console.error("[Support SSE] listen pool connect failed", e);
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const onNotify = (msg) => {
      if (closed) return;
      void (async () => {
        try {
          const payload = JSON.parse(String(msg.payload || "{}"));
          if (Number(payload.userId) !== myUserId) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db2.query("SELECT * FROM support_messages WHERE id = $1 AND user_id = $2 LIMIT 1", [mid, myUserId]);
          if (row.rows.length === 0) return;
          res.write(`data: ${JSON.stringify(row.rows[0])}

`);
        } catch {
        }
      })();
    };
    const conn = listenClient;
    if (!conn) {
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    conn.on("notification", onNotify);
    try {
      await conn.query("LISTEN support_chat");
    } catch (e) {
      console.error("[Support SSE] LISTEN failed", e);
      await cleanup();
      try {
        res.write(`event: error
data: ${JSON.stringify({ message: "Realtime unavailable" })}

`);
      } catch {
      }
      res.end();
      return;
    }
    const ping = setInterval(() => {
      if (closed) return;
      try {
        res.write(`: ping ${Date.now()}

`);
      } catch {
      }
    }, 25e3);
    req.on("close", () => {
      clearInterval(ping);
      void cleanup();
    });
    try {
      res.write(": stream ok\n\n");
    } catch {
      void cleanup();
    }
  });
  app2.post("/api/support/messages/mark-read", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db2.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE",
        [user.id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to mark messages read" });
    }
  });
  app2.post("/api/support/messages", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const slot = await takeSupportPostSlotPg(pool2, user.id, SUPPORT_POST_WINDOW_MS, SUPPORT_POST_MAX);
      if (!slot.ok) {
        return res.status(429).json({
          message: `Too many messages. Try again in about ${slot.retryAfterSec} seconds.`
        });
      }
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
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });
  app2.get("/api/admin/support/messages/:userId/stream", requireAdmin, async (req, res) => {
    const threadUserId = Number(req.params.userId);
    if (!Number.isFinite(threadUserId) || threadUserId <= 0) {
      return res.status(400).json({ message: "Invalid user" });
    }
    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }
    let closed = false;
    let listenClient = null;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      releaseSseListen();
      const c = listenClient;
      listenClient = null;
      if (!c) return;
      try {
        c.removeAllListeners("notification");
        await c.query("UNLISTEN support_chat");
      } catch {
      }
      try {
        c.release();
      } catch {
      }
    };
    try {
      listenClient = await listenPool2.connect();
    } catch (e) {
      console.error("[SupportAdmin SSE] listen pool connect failed", e);
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const onNotify = (msg) => {
      if (closed) return;
      void (async () => {
        try {
          const payload = JSON.parse(String(msg.payload || "{}"));
          if (Number(payload.userId) !== threadUserId) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db2.query("SELECT * FROM support_messages WHERE id = $1 AND user_id = $2 LIMIT 1", [mid, threadUserId]);
          if (row.rows.length === 0) return;
          res.write(`data: ${JSON.stringify(row.rows[0])}

`);
        } catch {
        }
      })();
    };
    const adminConn = listenClient;
    if (!adminConn) {
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    adminConn.on("notification", onNotify);
    try {
      await adminConn.query("LISTEN support_chat");
    } catch (e) {
      console.error("[SupportAdmin SSE] LISTEN failed", e);
      await cleanup();
      try {
        res.write(`event: error
data: ${JSON.stringify({ message: "Realtime unavailable" })}

`);
      } catch {
      }
      res.end();
      return;
    }
    const ping = setInterval(() => {
      if (closed) return;
      try {
        res.write(`: ping ${Date.now()}

`);
      } catch {
      }
    }, 25e3);
    req.on("close", () => {
      clearInterval(ping);
      void cleanup();
    });
    try {
      res.write(": stream ok\n\n");
    } catch {
      void cleanup();
    }
  });
  app2.post("/api/admin/support/messages/:userId/mark-read", requireAdmin, async (req, res) => {
    try {
      await db2.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE",
        [req.params.userId]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to mark messages read" });
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
var SUPPORT_POST_WINDOW_MS, SUPPORT_POST_MAX;
var init_support_routes = __esm({
  "server/support-routes.ts"() {
    "use strict";
    init_pg_rate_limit_store();
    init_sse_listen_budget();
    SUPPORT_POST_WINDOW_MS = 10 * 60 * 1e3;
    SUPPORT_POST_MAX = 20;
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
  listenPool: listenPool2,
  getAuthUser: getAuthUser2,
  requireAuth,
  requireAdmin
}) {
  const listenPoolMax = listenPool2.options.max ?? 32;
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
  app2.get("/api/live-classes/:id/chat/stream", requireAuth, async (req, res) => {
    const hasAccess = await checkLiveClassAccess(req, res, db2, getAuthUser2, req.params.id);
    if (!hasAccess) return;
    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }
    const liveClassIdStr = String(req.params.id);
    let closed = false;
    let listenClient = null;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      releaseSseListen();
      const c = listenClient;
      listenClient = null;
      if (!c) return;
      try {
        c.removeAllListeners("notification");
        await c.query("UNLISTEN live_chat");
      } catch {
      }
      try {
        c.release();
      } catch {
      }
    };
    try {
      listenClient = await listenPool2.connect();
    } catch (e) {
      console.error("[LiveChat SSE] listen pool connect failed", e);
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const onNotify = (msg) => {
      if (closed) return;
      void (async () => {
        try {
          const payload = JSON.parse(String(msg.payload || "{}"));
          if (String(payload.liveClassId ?? "") !== liveClassIdStr) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db2.query(
            "SELECT * FROM live_chat_messages WHERE id = $1 AND live_class_id = $2 LIMIT 1",
            [mid, liveClassIdStr]
          );
          if (row.rows.length === 0) return;
          res.write(`data: ${JSON.stringify(row.rows[0])}

`);
        } catch {
        }
      })();
    };
    const conn = listenClient;
    if (!conn) {
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    conn.on("notification", onNotify);
    try {
      await conn.query("LISTEN live_chat");
    } catch (e) {
      console.error("[LiveChat SSE] LISTEN failed", e);
      await cleanup();
      try {
        res.write(`event: error
data: ${JSON.stringify({ message: "Realtime unavailable" })}

`);
      } catch {
      }
      res.end();
      return;
    }
    const ping = setInterval(() => {
      if (closed) return;
      try {
        res.write(`: ping ${Date.now()}

`);
      } catch {
      }
    }, 25e3);
    req.on("close", () => {
      clearInterval(ping);
      void cleanup();
    });
    try {
      res.write(": stream ok\n\n");
    } catch {
      void cleanup();
    }
  });
  app2.post("/api/live-classes/:id/chat", requireAuth, async (req, res) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db2, getAuthUser2, req.params.id);
      if (!hasAccess) return;
      const user = req.user;
      const lc = await db2.query("SELECT is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      const liveClass = lc.rows[0];
      if (user?.role !== "admin" && (!liveClass?.is_live || liveClass?.is_completed)) {
        return res.status(403).json({ message: "Chat is available only during live class." });
      }
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });
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
    init_sse_listen_budget();
  }
});

// server/listen-pool.ts
import { Pool } from "pg";
function createListenPool(connectionString) {
  const defaultMax = process.env.NODE_ENV === "production" ? 12 : 20;
  const parsedMax = parseInt(process.env.PG_LISTEN_POOL_MAX || String(defaultMax), 10) || defaultMax;
  const max = Math.min(40, Math.max(2, parsedMax));
  return new Pool({
    connectionString,
    ssl: process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
    max,
    min: 0,
    connectionTimeoutMillis: 15e3,
    idleTimeoutMillis: 12e4
  });
}
var init_listen_pool = __esm({
  "server/listen-pool.ts"() {
    "use strict";
  }
});

// server/live-class-engagement-routes.ts
function registerLiveClassEngagementRoutes({
  app: app2,
  db: db2,
  requireAuth,
  requireAdmin
}) {
  app2.post("/api/live-classes/:id/recording-progress", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query(
        "SELECT id, course_id, is_free_preview, is_completed, recording_url FROM live_classes WHERE id = $1",
        [req.params.id]
      );
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const lc = lcResult.rows[0];
      if (!await userCanAccessLiveClassContent(db2, user, lc)) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lc.is_completed || !String(lc.recording_url || "").trim()) {
        return res.status(400).json({ message: "Recording not available for this class" });
      }
      const body = req.body || {};
      const openSession = Boolean(body.openSession);
      const watchPercentRaw = body.watchPercent != null ? Number(body.watchPercent) : null;
      const now = Date.now();
      const debounceMs = 8 * 60 * 1e3;
      if (watchPercentRaw != null && Number.isFinite(watchPercentRaw)) {
        const wp = Math.max(0, Math.min(100, Math.round(watchPercentRaw)));
        await db2.query(
          `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at)
           VALUES ($1, $2, $3, 0, NULL, $4)
           ON CONFLICT (user_id, live_class_id) DO UPDATE SET
             watch_percent = GREATEST(live_class_recording_progress.watch_percent, EXCLUDED.watch_percent),
             updated_at = EXCLUDED.updated_at`,
          [user.id, req.params.id, wp, now]
        );
      }
      if (openSession) {
        const prev = await db2.query(
          "SELECT playback_sessions, last_session_ping_at FROM live_class_recording_progress WHERE user_id = $1 AND live_class_id = $2",
          [user.id, req.params.id]
        );
        const row = prev.rows[0];
        const canBump = !row?.last_session_ping_at || now - Number(row.last_session_ping_at) >= debounceMs;
        if (!row) {
          await db2.query(
            `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at)
             VALUES ($1, $2, 0, 1, $3, $3)`,
            [user.id, req.params.id, now]
          );
        } else if (canBump) {
          await db2.query(
            `UPDATE live_class_recording_progress SET
               playback_sessions = COALESCE(playback_sessions, 0) + 1,
               last_session_ping_at = $3,
               updated_at = $3
             WHERE user_id = $1 AND live_class_id = $2`,
            [user.id, req.params.id, now]
          );
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Recording progress error:", err);
      res.status(500).json({ message: "Failed to save recording progress" });
    }
  });
  app2.post("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Class is not live" });
      }
      const now = Date.now();
      await db2.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET
           last_heartbeat = EXCLUDED.last_heartbeat,
           user_name = COALESCE(EXCLUDED.user_name, live_class_viewers.user_name)
         WHERE live_class_viewers.last_heartbeat IS NULL
            OR EXCLUDED.last_heartbeat - live_class_viewers.last_heartbeat >= 8000`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", now]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });
  app2.get("/api/live-classes/:id/viewers", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcAccess = await db2.query("SELECT course_id, is_free_preview, show_viewer_count, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcAccess.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcAccess.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcAccess.rows[0].is_live || lcAccess.rows[0].is_completed) {
        const visible2 = lcAccess.rows[0]?.show_viewer_count ?? true;
        return res.json({ viewers: [], count: 0, visible: visible2 });
      }
      const cutoff = Date.now() - 6e4;
      const result = await db2.query(
        `SELECT user_name FROM live_class_viewers
         WHERE live_class_id = $1 AND last_heartbeat > $2
         ORDER BY user_name ASC`,
        [req.params.id, cutoff]
      );
      const visible = lcAccess.rows[0]?.show_viewer_count ?? true;
      res.json({ viewers: result.rows, count: result.rows.length, visible });
    } catch (err) {
      console.error("Viewer list error:", err);
      res.status(500).json({ message: "Failed to fetch viewers" });
    }
  });
  app2.post("/api/live-classes/:id/raise-hand", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const lcResult = await db2.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Hand raise is available only during live class" });
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
      const lcResult = await db2.query("SELECT course_id, is_free_preview, is_live, is_completed FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lcResult.rows[0])) {
        return res.status(403).json({ message: "Access denied" });
      }
      if (!lcResult.rows[0].is_live || lcResult.rows[0].is_completed) {
        return res.status(409).json({ message: "Hand raise is available only during live class" });
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

// server/recordingSection.ts
function buildRecordingLectureSectionTitle(main, sub, bodyOverride) {
  if (bodyOverride != null && String(bodyOverride).trim() !== "") {
    return String(bodyOverride).trim();
  }
  const m = main != null && String(main).trim() !== "" ? String(main).trim() : DEFAULT_LIVE_RECORDING_SECTION;
  const s = sub != null && String(sub).trim() !== "" ? String(sub).trim() : "";
  return s ? `${m} / ${s}` : m;
}
var DEFAULT_LIVE_RECORDING_SECTION;
var init_recordingSection = __esm({
  "server/recordingSection.ts"() {
    "use strict";
    DEFAULT_LIVE_RECORDING_SECTION = "Live Class Recordings";
  }
});

// server/live-stream-routes.ts
function registerLiveStreamRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2,
  getR2Client
}) {
  const archiveRetryState = /* @__PURE__ */ new Map();
  const inferVideoType = (url) => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };
  const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
  const extractCloudflareRecordingUid = (url) => {
    const m = String(url || "").match(/videodelivery\.net\/([^/]+)\/manifest\/video\.m3u8/i);
    return m?.[1] ? String(m[1]) : null;
  };
  const toMediaApiPath = (key) => `/api/media/${key}`;
  const archiveCloudflareRecordingToR2 = async (recordingUid) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return null;
      const now = Date.now();
      const retryState = archiveRetryState.get(recordingUid);
      if (retryState && retryState.nextAttemptAt > now) {
        return null;
      }
      const configuredDownloadBase = String(process.env.CF_STREAM_DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");
      const candidateUrls = [
        `https://videodelivery.net/${recordingUid}/downloads/default.mp4`,
        configuredDownloadBase ? `${configuredDownloadBase}/${recordingUid}/downloads/default.mp4` : ""
      ].filter(Boolean);
      let source = null;
      let matchedUrl = "";
      for (const candidateUrl of candidateUrls) {
        const resp = await fetch(candidateUrl);
        if (resp.ok && resp.body) {
          source = resp;
          matchedUrl = candidateUrl;
          archiveRetryState.delete(recordingUid);
          break;
        }
        const prev = archiveRetryState.get(recordingUid) || { attempts: 0, nextAttemptAt: 0, lastStatus: null };
        const attempts = prev.attempts + 1;
        const backoffMs = Math.min(6 * 60 * 60 * 1e3, Math.max(2 * 60 * 1e3, attempts * 10 * 60 * 1e3));
        archiveRetryState.set(recordingUid, {
          attempts,
          nextAttemptAt: Date.now() + backoffMs,
          lastStatus: resp.status
        });
        if (attempts === 1 || attempts % 10 === 0) {
          console.warn(
            `[CF Stream] MP4 not ready uid=${recordingUid} status=${resp.status} attempt=${attempts} nextRetryInMs=${backoffMs}`
          );
        }
      }
      if (!source || !source.body) return null;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { Readable } = await import("stream");
      const r2 = await getR2Client();
      const key = `live-class-recording/cloudflare/${Date.now()}-${recordingUid}.mp4`;
      const contentLengthHeader = source.headers.get("content-length");
      const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
      const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength > 0 ? parsedContentLength : void 0;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: Readable.fromWeb(source.body),
          ContentType: "video/mp4",
          ...contentLength ? { ContentLength: contentLength } : {}
        })
      );
      console.log(`[CF Stream] Archived recording uid=${recordingUid} to R2 from ${matchedUrl || "unknown-source"}`);
      return toMediaApiPath(key);
    } catch (err) {
      console.warn("[CF Stream] Failed to archive recording to R2:", err);
      return null;
    }
  };
  const normalizeCfVideoItems = (payload) => {
    const raw = payload?.result;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.videos)) return raw.videos;
    if (Array.isArray(payload?.videos)) return payload.videos;
    return [];
  };
  const pickBestCfRecording = (items, excludeUid) => {
    if (!items.length) return null;
    const filtered = items.filter((v) => {
      const id = String(v?.uid || v?.id || "");
      return id && (!excludeUid || id !== excludeUid);
    });
    const pool2 = filtered.length ? filtered : items;
    const statusRank = (s) => {
      const x = String(s || "").toLowerCase();
      if (x === "ready") return 0;
      if (x.includes("progress") || x === "queued" || x === "downloading") return 1;
      return 2;
    };
    const sorted = [...pool2].sort((a, b) => {
      const ra = statusRank(a?.status);
      const rb = statusRank(b?.status);
      if (ra !== rb) return ra - rb;
      const ta = Number(a?.modified || a?.created || 0);
      const tb = Number(b?.modified || b?.created || 0);
      return tb - ta;
    });
    const ready = sorted.find((v) => String(v?.status || "").toLowerCase() === "ready") || sorted[0];
    const recordingUid = String(ready?.uid || ready?.id || "").trim();
    if (!recordingUid || recordingUid === excludeUid) return null;
    return {
      manifestUrl: `https://videodelivery.net/${recordingUid}/manifest/video.m3u8`,
      recordingUid
    };
  };
  const getLatestRecordingForLiveInput = async (accountId, apiToken, liveInputUid) => {
    try {
      const videosRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${liveInputUid}/videos`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      if (!videosRes.ok) {
        const txt = await videosRes.text().catch(() => "");
        console.warn("[CF Stream] live_inputs/.../videos HTTP", videosRes.status, txt.slice(0, 280));
        return null;
      }
      const videosData = await videosRes.json();
      const items = normalizeCfVideoItems(videosData);
      if (!items.length) return null;
      return pickBestCfRecording(items, liveInputUid);
    } catch {
      return null;
    }
  };
  const findRecordingViaStreamSearch = async (accountId, apiToken, liveClassTitle, excludeLiveInputUid) => {
    const q = String(liveClassTitle || "").trim();
    if (q.length < 2) return null;
    try {
      const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`);
      u.searchParams.set("search", q);
      u.searchParams.set("limit", "40");
      const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!res.ok) return null;
      const data = await res.json();
      const items = normalizeCfVideoItems(data);
      const qLow = q.toLowerCase();
      const matched = items.filter((v) => {
        const id = String(v?.uid || v?.id || "");
        if (!id || id === excludeLiveInputUid) return false;
        const metaName = String(v?.meta?.name || "").trim().toLowerCase();
        const nameField = String(v?.name || "").trim().toLowerCase();
        if (metaName && metaName === qLow) return true;
        if (nameField && nameField === qLow) return true;
        return metaName.includes(qLow) || nameField.includes(qLow);
      });
      const pool2 = matched.length ? matched : items.filter((v) => String(v?.uid || "") && String(v.uid) !== excludeLiveInputUid);
      return pickBestCfRecording(pool2, excludeLiveInputUid);
    } catch {
      return null;
    }
  };
  const saveRecordingForClassAndPeers = async (liveClassId, recordingUrl, sectionTitle) => {
    const lcResult = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
    if (lcResult.rows.length === 0) {
      throw new Error("Live class not found");
    }
    const liveClass = lcResult.rows[0];
    if (liveClass.recording_deleted_at) {
      return { lectureId: null, lectureIds: [] };
    }
    const title = liveClass.title;
    const peers = await db2.query("SELECT * FROM live_classes WHERE title = $1 ORDER BY id", [title]);
    const lectureIds = [];
    for (const row of peers.rows) {
      if (row.recording_deleted_at) continue;
      const endedAt = Number(row.ended_at || Date.now());
      const durationMins = row.started_at ? Math.max(1, Math.round((endedAt - Number(row.started_at)) / 6e4)) : 0;
      await db2.query(
        `UPDATE live_classes 
         SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2,
             duration_minutes = CASE 
               WHEN started_at IS NOT NULL 
               THEN GREATEST(1, ROUND(($2::bigint - started_at) / 60000.0)::INTEGER)
               ELSE 0
             END
         WHERE id = $3`,
        [recordingUrl, endedAt, row.id]
      );
      if (!row.course_id) continue;
      const maxOrder = await db2.query(
        "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
        [row.course_id]
      );
      const recordSection = buildRecordingLectureSectionTitle(
        row.lecture_section_title,
        row.lecture_subfolder_title,
        sectionTitle
      );
      const lectureResult = await db2.query(
        `INSERT INTO lectures (
           course_id,
           title,
           description,
           video_url,
           video_type,
           duration_minutes,
           order_index,
           is_free_preview,
           section_title,
           live_class_id,
           live_class_finalized,
           created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
         ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
         DO UPDATE SET
           course_id = EXCLUDED.course_id,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           video_url = EXCLUDED.video_url,
           video_type = EXCLUDED.video_type,
           duration_minutes = EXCLUDED.duration_minutes,
           section_title = EXCLUDED.section_title,
           live_class_finalized = TRUE
         RETURNING id`,
        [
          row.course_id,
          row.title,
          row.description || "",
          recordingUrl,
          inferVideoType(recordingUrl),
          durationMins,
          maxOrder.rows[0].next_order,
          false,
          recordSection,
          row.id,
          Date.now()
        ]
      );
      lectureIds.push(Number(lectureResult.rows[0]?.id));
      await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
        row.course_id
      ]);
      await recomputeAllEnrollmentsProgressForCourse2(row.course_id);
    }
    return { lectureId: lectureIds[0] ?? null, lectureIds };
  };
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
          // Lower timeout keeps very short classes from lingering too long as "live" after stop.
          recording: { mode: "automatic", timeoutSeconds: 20 }
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
      const lcResult = await db2.query(
        "SELECT id, title, cf_stream_uid, is_completed, recording_url, recording_deleted_at FROM live_classes WHERE id = $1",
        [req.params.id]
      );
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const current = lcResult.rows[0];
      const uid = current?.cf_stream_uid;
      const liveTitle = String(current?.title || "").trim();
      const existingRecordingUrl = String(current?.recording_url || "").trim();
      if (current?.recording_deleted_at) {
        return res.json({ success: true, alreadyEnded: true, recordingDeleted: true });
      }
      if (current?.is_completed === true && !!existingRecordingUrl) {
        return res.json({ success: true, alreadyEnded: true, recordingUrl: existingRecordingUrl });
      }
      const endedAtNow = Date.now();
      await db2.query(
        "UPDATE live_classes SET is_live = FALSE, ended_at = COALESCE(ended_at, $1), is_completed = TRUE WHERE id = $2",
        [endedAtNow, req.params.id]
      ).catch(() => {
      });
      if (!uid) return res.json({ success: true });
      res.json({ success: true, recordingPending: true });
      const getLatestRecording = async () => getLatestRecordingForLiveInput(accountId, apiToken, uid);
      void (async () => {
        try {
          let recordingUrl = null;
          const maxPolls = Number(process.env.CF_STREAM_END_MAX_POLLS || 48);
          const pollMs = Number(process.env.CF_STREAM_END_POLL_MS || 5e3);
          for (let i = 0; i < maxPolls; i += 1) {
            const latest = await getLatestRecording();
            if (latest) {
              const archived = await archiveCloudflareRecordingToR2(latest.recordingUid);
              recordingUrl = archived || latest.manifestUrl;
              break;
            }
            await new Promise((resolve2) => setTimeout(resolve2, pollMs));
          }
          if (!recordingUrl && liveTitle) {
            const viaSearch = await findRecordingViaStreamSearch(accountId, apiToken, liveTitle, uid);
            if (viaSearch) {
              const archived = await archiveCloudflareRecordingToR2(viaSearch.recordingUid);
              recordingUrl = archived || viaSearch.manifestUrl;
              console.log(`[CF Stream] Resolved recording via stream search title="${liveTitle.slice(0, 60)}"`);
            }
          }
          if (recordingUrl) {
            try {
              await saveRecordingForClassAndPeers(String(req.params.id), recordingUrl);
            } catch (saveErr) {
              console.warn("[CF Stream] recording save after stream end failed:", saveErr);
            }
          } else {
            console.warn(
              `[CF Stream] No recording URL after end for live_class=${req.params.id} live_input_uid=${uid}. Leaving live_input in place for retry/archive sweep.`
            );
          }
          if (recordingUrl) {
            await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
              method: "DELETE",
              headers: { Authorization: `Bearer ${apiToken}` }
            }).catch(() => {
            });
          }
          console.log(`[CF Stream] Ended live input uid=${uid} saved=${Boolean(recordingUrl)}`);
        } catch (err) {
          console.error("[CF Stream] End background finalize error:", err);
        }
      })();
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
      const { lectureId, lectureIds } = await saveRecordingForClassAndPeers(
        String(req.params.id),
        String(recordingUrl),
        sectionTitle
      );
      res.json({ success: true, lectureId, lectureIds });
    } catch (err) {
      console.error("Recording completion error:", err);
      res.status(500).json({ message: "Failed to save recording" });
    }
  });
  let isArchiveSweepRunning = false;
  const runArchiveSweep = async () => {
    if (isArchiveSweepRunning) return;
    isArchiveSweepRunning = true;
    try {
      const pending = await db2.query(
        `SELECT id, title, description, course_id, started_at, lecture_section_title, lecture_subfolder_title, recording_url, cf_stream_uid, recording_deleted_at
         FROM live_classes
         WHERE stream_type = 'cloudflare'
           AND is_completed = TRUE
           AND ended_at IS NOT NULL
           AND ended_at > (EXTRACT(EPOCH FROM NOW()) * 1000 - 14 * 24 * 60 * 60 * 1000)
           AND recording_deleted_at IS NULL
           AND (recording_url IS NULL OR recording_url ILIKE 'https://videodelivery.net/%/manifest/video.m3u8')
         ORDER BY ended_at DESC NULLS LAST
         LIMIT 8`
      );
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      for (const row of pending.rows) {
        const currentUrl = String(row.recording_url || "").trim();
        let recordingUid = extractCloudflareRecordingUid(currentUrl);
        if (!recordingUid && accountId && apiToken && row.cf_stream_uid) {
          const latest = await getLatestRecordingForLiveInput(accountId, apiToken, String(row.cf_stream_uid));
          recordingUid = latest?.recordingUid || null;
        }
        if (recordingUid && currentUrl) {
          const head = await fetch(`https://videodelivery.net/${recordingUid}/manifest/video.m3u8`, { method: "HEAD" }).catch(() => null);
          if (!head || !head.ok) {
            if (accountId && apiToken && row.cf_stream_uid) {
              const latest = await getLatestRecordingForLiveInput(accountId, apiToken, String(row.cf_stream_uid));
              recordingUid = latest?.recordingUid || recordingUid;
            }
          }
        }
        if (!recordingUid) continue;
        const archivedUrl = await archiveCloudflareRecordingToR2(recordingUid);
        if (!archivedUrl) continue;
        await db2.query("UPDATE live_classes SET recording_url = $1 WHERE id = $2", [archivedUrl, row.id]);
        const patchedLecture = await db2.query(
          "UPDATE lectures SET video_url = $1, video_type = 'r2', live_class_finalized = TRUE WHERE live_class_id = $2 RETURNING id",
          [archivedUrl, row.id]
        ).catch(() => {
        });
        if (row.course_id) {
          const updatedRows = Array.isArray(patchedLecture?.rows) ? patchedLecture.rows.length : 0;
          if (updatedRows === 0) {
            const maxOrder = await db2.query(
              "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
              [row.course_id]
            );
            const durationMins = row.started_at ? Math.max(1, Math.round((Date.now() - Number(row.started_at)) / 6e4)) : 0;
            const sectionTitle = buildRecordingLectureSectionTitle(
              row.lecture_section_title,
              row.lecture_subfolder_title,
              void 0
            );
            await db2.query(
              `INSERT INTO lectures (
                 course_id,
                 title,
                 description,
                 video_url,
                 video_type,
                 duration_minutes,
                 order_index,
                 is_free_preview,
                 section_title,
                 live_class_id,
                 live_class_finalized,
                 created_at
               )
               VALUES ($1, $2, $3, $4, 'r2', $5, $6, FALSE, $7, $8, TRUE, $9)
               ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
               DO UPDATE SET
                 video_url = EXCLUDED.video_url,
                 video_type = EXCLUDED.video_type,
                 duration_minutes = EXCLUDED.duration_minutes,
                 section_title = EXCLUDED.section_title,
                 live_class_finalized = TRUE`,
              [
                row.course_id,
                row.title,
                row.description || "",
                archivedUrl,
                durationMins,
                maxOrder.rows[0].next_order,
                sectionTitle,
                row.id,
                Date.now()
              ]
            );
            await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
              row.course_id
            ]).catch(() => {
            });
            await recomputeAllEnrollmentsProgressForCourse2(row.course_id).catch(() => {
            });
          }
        }
        console.log(`[CF Stream] Archived fallback recording to R2 for live class ${row.id}`);
        await sleep(250);
      }
    } catch (err) {
      console.warn("[CF Stream] Archive sweep error:", err);
    } finally {
      isArchiveSweepRunning = false;
    }
  };
  const runArchiveSweepWorker = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";
  if (runArchiveSweepWorker) {
    const sweepIntervalMs = Math.max(3e4, Number(process.env.CF_ARCHIVE_SWEEP_MS || 12e4));
    void runArchiveSweep();
    setInterval(() => {
      void runArchiveSweep();
    }, sweepIntervalMs);
    console.log(`[CF Stream] Archive sweep started \u2014 every ${sweepIntervalMs}ms`);
  } else {
    console.log("[CF Stream] Archive sweep disabled (RUN_BACKGROUND_SCHEDULERS=false)");
  }
}
var init_live_stream_routes = __esm({
  "server/live-stream-routes.ts"() {
    "use strict";
    init_recordingSection();
  }
});

// server/site-settings-routes.ts
function registerSiteSettingsRoutes({
  app: app2,
  db: db2,
  requireAdmin
}) {
  let lastSettingsCache = null;
  let lastSettingsCacheAt = 0;
  const cacheTtlMs = Math.max(5e3, Number(process.env.SITE_SETTINGS_CACHE_MS || "15000"));
  app2.get("/api/site-settings", async (_req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      const now = Date.now();
      if (lastSettingsCache && now - lastSettingsCacheAt <= cacheTtlMs) {
        return res.json(lastSettingsCache);
      }
      const result = await db2.query("SELECT key, value FROM site_settings");
      const settings = {};
      for (const row of result.rows) settings[row.key] = row.value;
      lastSettingsCache = settings;
      lastSettingsCacheAt = now;
      res.json(settings);
    } catch (err) {
      console.error("[SiteSettings] Fetch error:", err);
      if (lastSettingsCache) return res.json(lastSettingsCache);
      res.json({});
    }
  });
  app2.put("/api/admin/site-settings", requireAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== "object") return res.status(400).json({ message: "Settings object required" });
      for (const [key, value] of Object.entries(settings)) {
        await db2.query(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3",
          [key, String(value), Date.now()]
        );
      }
      lastSettingsCache = null;
      lastSettingsCacheAt = 0;
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
  updateCourseTestCounts: updateCourseTestCounts2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
}) {
  app2.post("/api/admin/courses/:id/import-lectures", requireAdmin, async (req, res) => {
    try {
      const targetCourseId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
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
      await recomputeAllEnrollmentsProgressForCourse2(targetCourseId);
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
      const failedWhere = range ? " WHERE pf.created_at >= $1 AND pf.created_at < $2" : "";
      const enrollWhere = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      const bookWhere = range ? " AND bp.purchased_at >= $1 AND bp.purchased_at < $2" : "";
      const enrollJoin = range ? " AND e.enrolled_at >= $1 AND e.enrolled_at < $2" : "";
      const safeRows = async (query, fallbackRows = []) => {
        try {
          const result = await query;
          return result.rows;
        } catch {
          return fallbackRows;
        }
      };
      const [
        revenueRows,
        enrollRows,
        lifetimeRows,
        lifetimeEnrollRows,
        courseBreakdownRows,
        recentPurchasesRows,
        failedTransactionRows,
        abandonedRows,
        bookPurchaseRows,
        lifetimeBookRevenueRows,
        bookAbandonedRows,
        testPurchaseRows,
        lifetimeTestRevenueRows
      ] = await Promise.all([
        safeRows(
          db2.query(
            `SELECT COALESCE(SUM(
              (CASE
                WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                  AND p.amount::numeric = c.price::numeric
                THEN (ROUND(c.price::numeric * 100))::integer
                ELSE p.amount
              END)
            ), 0) / 100.0 as total_revenue
           FROM payments p
           JOIN courses c ON c.id = p.course_id
           WHERE p.status = 'paid'${paymentWhere}`,
            rangeParams
          ),
          [{ total_revenue: "0" }]
        ),
        safeRows(db2.query(`SELECT COUNT(*) as total_enrollments FROM enrollments e WHERE 1=1${enrollWhere}`, rangeParams), [{ total_enrollments: "0" }]),
        safeRows(db2.query(
          `SELECT COALESCE(SUM(
              (CASE
                WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                  AND p.amount::numeric = c.price::numeric
                THEN (ROUND(c.price::numeric * 100))::integer
                ELSE p.amount
              END)
            ), 0) / 100.0 as lifetime_revenue
           FROM payments p
           JOIN courses c ON c.id = p.course_id
           WHERE p.status = 'paid'`
        ), [{ lifetime_revenue: "0" }]),
        safeRows(db2.query(`SELECT COUNT(*) as cnt FROM enrollments`), [{ cnt: "0" }]),
        safeRows(db2.query(`
          SELECT c.id, c.title, c.category, c.price, c.is_free, c.course_type,
                 COUNT(DISTINCT e.id) as enrollment_count,
                 (COALESCE((
                    SELECT SUM(
                      (CASE
                        WHEN p2.amount IS NOT NULL AND c2.price IS NOT NULL
                          AND p2.amount::numeric = c2.price::numeric
                        THEN (ROUND(c2.price::numeric * 100))::integer
                        ELSE p2.amount
                      END)
                    ) FROM payments p2
                    JOIN courses c2 ON c2.id = p2.course_id
                    WHERE p2.course_id = c.id AND p2.status = 'paid'${range ? " AND p2.created_at >= $1 AND p2.created_at < $2" : ""}
                 ), 0) / 100.0) as revenue
          FROM courses c
          LEFT JOIN enrollments e ON e.course_id = c.id${enrollJoin}
          GROUP BY c.id, c.title, c.category, c.price, c.is_free, c.course_type
          ORDER BY enrollment_count DESC
        `, range ? rangeParams : [])),
        safeRows(db2.query(`
          SELECT p.id, p.created_at,
                 (CASE
                    WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                      AND p.amount::numeric = c.price::numeric
                    THEN (ROUND(c.price::numeric * 100))::integer
                    ELSE p.amount
                  END) / 100.0 as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 c.title as course_title, c.category
          FROM payments p
          JOIN users u ON u.id = p.user_id
          JOIN courses c ON c.id = p.course_id
          WHERE p.status = 'paid'${paymentWhere}
          ORDER BY p.created_at DESC LIMIT 20
        `, rangeParams)),
        safeRows(db2.query(`
          SELECT pf.id,
                 pf.created_at,
                 pf.source,
                 pf.reason,
                 pf.razorpay_order_id,
                 pf.razorpay_payment_id,
                 pf.course_id,
                 COALESCE(pf.user_id, p.user_id) AS user_id,
                 COALESCE(pf.course_id, p.course_id) AS effective_course_id,
                 COALESCE(
                   (CASE
                      WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                        AND p.amount::numeric = c.price::numeric
                      THEN (ROUND(c.price::numeric * 100))::integer
                      ELSE p.amount
                    END) / 100.0,
                   c.price::numeric,
                   0
                 ) AS amount,
                 u.name AS user_name,
                 u.phone AS user_phone,
                 u.email AS user_email,
                 c.title AS course_title,
                 c.category
          FROM payment_failures pf
          LEFT JOIN payments p ON p.razorpay_order_id = pf.razorpay_order_id
          LEFT JOIN users u ON u.id = COALESCE(pf.user_id, p.user_id)
          LEFT JOIN courses c ON c.id = COALESCE(pf.course_id, p.course_id)${failedWhere}
          ORDER BY pf.created_at DESC LIMIT 100
        `, rangeParams)),
        safeRows(db2.query(`
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
        `)),
        safeRows(db2.query(`
          SELECT bp.id, bp.purchased_at as created_at, b.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.cover_url
          FROM book_purchases bp
          JOIN users u ON u.id = bp.user_id
          JOIN books b ON b.id = bp.book_id
          WHERE 1=1${bookWhere}
          ORDER BY bp.purchased_at DESC LIMIT 100
        `, rangeParams)),
        safeRows(db2.query(`SELECT COALESCE(SUM(b.price), 0) as total FROM book_purchases bp JOIN books b ON b.id = bp.book_id`), [{ total: "0" }]),
        safeRows(db2.query(`
          SELECT bct.id, bct.created_at, bct.click_count,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 b.title as book_title, b.author, b.price
          FROM book_click_tracking bct
          JOIN users u ON u.id = bct.user_id
          JOIN books b ON b.id = bct.book_id
          ORDER BY bct.click_count DESC, bct.created_at DESC LIMIT 100
        `)),
        safeRows(db2.query(`
          SELECT tp.id, tp.created_at, t.price as amount,
                 u.name as user_name, u.phone as user_phone, u.email as user_email,
                 t.title as test_title, t.test_type
          FROM test_purchases tp
          JOIN users u ON u.id = tp.user_id
          JOIN tests t ON t.id = tp.test_id
          ORDER BY tp.created_at DESC LIMIT 100
        `)),
        safeRows(db2.query(`SELECT COALESCE(SUM(t.price), 0) as total FROM test_purchases tp JOIN tests t ON t.id = tp.test_id`), [{ total: "0" }])
      ]);
      res.json({
        totalEnrollments: parseInt(enrollRows[0]?.total_enrollments || "0"),
        totalRevenue: parseFloat(revenueRows[0]?.total_revenue || "0"),
        lifetimeRevenue: parseFloat(lifetimeRows[0]?.lifetime_revenue || "0"),
        lifetimeEnrollments: parseInt(lifetimeEnrollRows[0]?.cnt || "0"),
        lifetimeBookRevenue: parseFloat(lifetimeBookRevenueRows[0]?.total || "0"),
        lifetimeTestRevenue: parseFloat(lifetimeTestRevenueRows[0]?.total || "0"),
        courseBreakdown: courseBreakdownRows,
        recentPurchases: recentPurchasesRows,
        failedTransactions: failedTransactionRows,
        abandonedCheckouts: abandonedRows,
        bookPurchases: bookPurchaseRows,
        bookAbandonedCheckouts: bookAbandonedRows,
        testPurchases: testPurchaseRows
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });
  app2.post("/api/admin/analytics/reset-abandoned", requireAdmin, async (_req, res) => {
    try {
      await Promise.all([
        db2.query("UPDATE payments SET status = 'reset' WHERE status = 'created' OR status IS NULL"),
        db2.query("DELETE FROM book_click_tracking")
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Reset abandoned analytics error:", err);
      res.status(500).json({ message: "Failed to reset abandoned analytics data" });
    }
  });
  app2.get("/api/admin/courses/:id/enrollments", requireAdmin, async (req, res) => {
    try {
      const result = await db2.query(
        `SELECT
           e.id,
           e.user_id,
           u.name AS user_name,
           u.phone AS user_phone,
           u.email AS user_email,
           e.enrolled_at,
           COALESCE(e.status, 'active') AS status,
           CASE
             WHEN (COALESCE(tl.total_lectures, 0) + COALESCE(tt.total_tests, 0)) <= 0 THEN 0
             ELSE LEAST(
               100,
               GREATEST(
                 0,
                 ROUND(
                   100.0 * (COALESCE(lp.lecture_points, 0) + COALESCE(tp.completed_tests, 0))
                   / NULLIF(COALESCE(tl.total_lectures, 0) + COALESCE(tt.total_tests, 0), 0)
                 )
               )
             )::integer
           END AS progress_percent
         FROM enrollments e
         JOIN users u ON e.user_id = u.id
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::numeric AS total_lectures
           FROM lectures l
           WHERE l.course_id = $1
         ) tl
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::numeric AS total_tests
           FROM tests t
           WHERE t.course_id = $1
             AND COALESCE(t.is_published, true) = true
         ) tt
         LEFT JOIN LATERAL (
           SELECT
             COALESCE(
               SUM(
                 LEAST(
                   1.0,
                   GREATEST(
                     CASE
                       WHEN COALESCE(lp2.is_completed, false) THEN 1.0
                       ELSE GREATEST(0.0, LEAST(100.0, COALESCE(lp2.watch_percent, 0)::numeric)) / 100.0
                     END,
                     CASE
                       WHEN COALESCE(lp2.playback_sessions, 0) > 0 THEN 0.10
                       ELSE 0.0
                     END
                   )
                 )
               ),
               0
             ) AS lecture_points
           FROM lecture_progress lp2
           JOIN lectures l2 ON l2.id = lp2.lecture_id
           WHERE lp2.user_id = e.user_id
             AND l2.course_id = $1
         ) lp ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT ta.test_id)::numeric AS completed_tests
           FROM test_attempts ta
           JOIN tests t2 ON t2.id = ta.test_id
           WHERE ta.user_id = e.user_id
             AND ta.status = 'completed'
             AND t2.course_id = $1
             AND COALESCE(t2.is_published, true) = true
         ) tp ON true
         WHERE e.course_id = $1
         ORDER BY e.enrolled_at DESC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });
  app2.get("/api/admin/courses/:courseId/enrollments/:userId/detail", requireAdmin, async (req, res) => {
    try {
      const courseId = parseInt(String(req.params.courseId), 10);
      const userId = parseInt(String(req.params.userId), 10);
      if (!Number.isFinite(courseId) || !Number.isFinite(userId)) {
        return res.status(400).json({ message: "Invalid course or user id" });
      }
      const enr = await db2.query(
        "SELECT e.id, u.id AS user_id, u.name AS user_name, u.email AS user_email, u.phone AS user_phone, e.progress_percent, e.enrolled_at, COALESCE(e.status, 'active') AS status FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 AND e.user_id = $2",
        [courseId, userId]
      );
      if (enr.rows.length === 0) return res.status(404).json({ message: "Enrollment not found" });
      const student = enr.rows[0];
      const lectures = await db2.query(
        `SELECT l.id AS lecture_id, l.title, l.order_index, l.section_title,
                COALESCE(lp.watch_percent, 0) AS watch_percent,
                COALESCE(lp.is_completed, false) AS is_completed,
                COALESCE(lp.playback_sessions, 0) AS playback_sessions
         FROM lectures l
         LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.user_id = $2
         WHERE l.course_id = $1
         ORDER BY l.order_index ASC NULLS LAST, l.id ASC`,
        [courseId, userId]
      );
      const liveClasses = await db2.query(
        `SELECT lc.id AS live_class_id, lc.title, lc.scheduled_at, lc.is_completed, lc.is_live,
                (CASE WHEN v.user_id IS NOT NULL THEN true ELSE false END) AS present_during_live,
                COALESCE(rp.watch_percent, 0) AS recording_watch_percent,
                COALESCE(rp.playback_sessions, 0) AS recording_playback_sessions,
                (CASE WHEN lc.recording_url IS NOT NULL AND LENGTH(BTRIM(COALESCE(lc.recording_url, ''))) > 0 THEN true ELSE false END) AS has_recording
         FROM live_classes lc
         LEFT JOIN live_class_viewers v ON v.live_class_id = lc.id AND v.user_id = $2
         LEFT JOIN live_class_recording_progress rp ON rp.live_class_id = lc.id AND rp.user_id = $2
         WHERE lc.course_id = $1
         ORDER BY lc.scheduled_at DESC NULLS LAST, lc.id DESC`,
        [courseId, userId]
      );
      const tests = await db2.query(
        `SELECT t.id AS test_id, t.title, t.total_questions,
                ta.id AS attempt_id, ta.status AS attempt_status,
                ta.correct, ta.incorrect, ta.attempted,
                ta.completed_at, ta.score, ta.total_marks
         FROM tests t
         LEFT JOIN LATERAL (
           SELECT ta2.id, ta2.status, ta2.correct, ta2.incorrect, ta2.attempted, ta2.completed_at, ta2.score, ta2.total_marks
           FROM test_attempts ta2
           WHERE ta2.test_id = t.id AND ta2.user_id = $2
           ORDER BY CASE WHEN ta2.status = 'completed' THEN 0 ELSE 1 END, ta2.completed_at DESC NULLS LAST, ta2.id DESC
           LIMIT 1
         ) ta ON true
         WHERE t.course_id = $1 AND COALESCE(t.is_published, true) = true
         ORDER BY t.folder_name NULLS LAST, t.id ASC`,
        [courseId, userId]
      );
      const missions = await db2.query(
        `SELECT dm.id AS mission_id, dm.title, dm.mission_date::text AS mission_date,
                CASE
                  WHEN dm.questions IS NULL THEN 0
                  ELSE GREATEST(0, COALESCE(jsonb_array_length(dm.questions::jsonb), 0))
                END AS total_questions,
                COALESCE(um.is_completed, false) AS is_completed,
                COALESCE(um.score, 0) AS correct,
                COALESCE(um.incorrect, 0) AS incorrect,
                COALESCE(um.skipped, 0) AS skipped
         FROM daily_missions dm
         LEFT JOIN user_missions um ON um.mission_id = dm.id AND um.user_id = $2
         WHERE dm.course_id = $1
         ORDER BY dm.mission_date DESC NULLS LAST, dm.id DESC`,
        [courseId, userId]
      );
      res.json({
        student,
        lectures: lectures.rows,
        liveClasses: liveClasses.rows,
        tests: tests.rows,
        missions: missions.rows
      });
    } catch (err) {
      console.error("Enrollment detail error:", err);
      res.status(500).json({ message: "Failed to fetch student progress" });
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
  deleteDownloadsForUser: deleteDownloadsForUser2,
  deleteDownloadsForCourse: deleteDownloadsForCourse2,
  runInTransaction: runInTransaction2
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
      await runInTransaction2(async (tx) => {
        await tx.query("DELETE FROM test_attempts WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
        await tx.query("DELETE FROM questions WHERE test_id IN (SELECT id FROM tests WHERE course_id = $1)", [courseId]);
        await tx.query("DELETE FROM tests WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM lectures WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM enrollments WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM payments WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM study_materials WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM live_classes WHERE course_id = $1", [courseId]);
        await tx.query("DELETE FROM courses WHERE id = $1", [courseId]);
      });
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

// server/async-utils.ts
async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function isTimeoutError(err) {
  return /timed out/i.test(String(err?.message ?? ""));
}
var init_async_utils = __esm({
  "server/async-utils.ts"() {
    "use strict";
  }
});

// server/admin-lecture-routes.ts
function registerAdminLectureRoutes({
  app: app2,
  db: db2,
  requireAdmin,
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
}) {
  const normalizeSectionSegments = (value) => String(value || "").split("/").map((s) => s.trim()).filter(Boolean);
  const resolveLectureSectionTitle = (sectionTitle, subfolderTitle) => {
    const mainSeg = normalizeSectionSegments(sectionTitle);
    const subSeg = normalizeSectionSegments(subfolderTitle);
    if (!mainSeg.length && !subSeg.length) return null;
    if (!subSeg.length) return mainSeg.join(" / ") || null;
    if (!mainSeg.length) return subSeg.join(" / ");
    const mainTail = mainSeg.slice(-subSeg.length).join(" / ");
    const subPath = subSeg.join(" / ");
    if (mainTail === subPath) return mainSeg.join(" / ");
    const subHead = subSeg.slice(0, mainSeg.length).join(" / ");
    if (subHead === mainSeg.join(" / ")) return subSeg.join(" / ");
    return [...mainSeg, ...subSeg].join(" / ");
  };
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
      const { courseId, title, description, transcript, videoUrl, fileUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed } = req.body;
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
      const normalizedSectionTitle = resolveLectureSectionTitle(
        sectionTitle,
        lectureSubfolderTitle
      );
      const transcriptText = transcript != null ? String(transcript) : "";
      const result = await db2.query(
        `INSERT INTO lectures (course_id, title, description, transcript, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
        [
          parsedCourseId,
          String(title).trim(),
          description || "",
          transcriptText,
          normalizedVideoUrl || null,
          effectiveVideoType,
          normalizedPdfUrl || null,
          Number(durationMinutes) || 0,
          Number(orderIndex) || 0,
          isFreePreview || false,
          normalizedSectionTitle,
          downloadAllowed || false,
          Date.now()
        ]
      );
      await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      await recomputeAllEnrollmentsProgressForCourse2(parsedCourseId);
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
      const { title, description, transcript, videoUrl, videoType, durationMinutes, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed } = req.body;
      const normalizedSectionTitle = resolveLectureSectionTitle(
        sectionTitle,
        lectureSubfolderTitle
      );
      const patchTranscript = Object.prototype.hasOwnProperty.call(req.body, "transcript");
      const transcriptVal = patchTranscript ? String(transcript ?? "") : "";
      await db2.query(
        `UPDATE lectures SET title=$1, description=$2, transcript = CASE WHEN $11::boolean THEN $3::text ELSE transcript END, video_url=$4, video_type=$5, duration_minutes=$6, order_index=$7, is_free_preview=$8, section_title=$9, download_allowed=$10 WHERE id=$12`,
        [
          title,
          description || "",
          transcriptVal,
          videoUrl,
          videoType || "youtube",
          parseInt(durationMinutes) || 0,
          parseInt(orderIndex) || 0,
          isFreePreview || false,
          normalizedSectionTitle,
          downloadAllowed || false,
          patchTranscript,
          req.params.id
        ]
      );
      const row = await db2.query("SELECT course_id FROM lectures WHERE id = $1 LIMIT 1", [req.params.id]);
      if (row.rows[0]?.course_id) {
        await recomputeAllEnrollmentsProgressForCourse2(row.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update lecture" });
    }
  });
  app2.delete("/api/admin/lectures/:id", requireAdmin, async (req, res) => {
    try {
      let lec;
      try {
        lec = await db2.query(
          "SELECT course_id, video_url, live_class_id FROM lectures WHERE id = $1",
          [req.params.id]
        );
      } catch (_err) {
        lec = await db2.query(
          "SELECT course_id, video_url FROM lectures WHERE id = $1",
          [req.params.id]
        );
      }
      if (lec.rows.length === 0) {
        return res.json({ success: true });
      }
      const lecture = lec.rows[0];
      await db2.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
      await db2.query(
        "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
        [lecture.course_id]
      );
      await recomputeAllEnrollmentsProgressForCourse2(lecture.course_id);
      if (lecture.live_class_id) {
        try {
          await db2.query(
            "UPDATE live_classes SET recording_deleted_at = $1 WHERE id = $2",
            [Date.now(), lecture.live_class_id]
          );
        } catch (markErr) {
          console.warn(
            "[AdminLectures] could not mark live_classes.recording_deleted_at:",
            markErr instanceof Error ? markErr.message : markErr
          );
        }
      }
      res.json({ success: true });
      if (lecture.video_url && typeof lecture.video_url === "string") {
        void (async () => {
          try {
            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const r2 = await getR2Client();
            let r2Key = lecture.video_url;
            if (r2Key.startsWith("http")) {
              try {
                const url = new URL(r2Key);
                r2Key = url.pathname.replace(/^\/+/, "");
              } catch (_e) {
              }
            }
            const deleteCommand = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key
            });
            await withTimeout(r2.send(deleteCommand), 4e3, "R2 delete timed out");
            console.log(`[R2] Deleted lecture file: ${r2Key}`);
          } catch (r2Err) {
            console.error(
              "[R2] Failed to delete lecture file (non-fatal):",
              r2Err instanceof Error ? r2Err.message : r2Err
            );
          }
        })();
      }
    } catch (err) {
      console.error("Delete lecture error:", err);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to delete lecture" });
      }
    }
  });
}
var init_admin_lecture_routes = __esm({
  "server/admin-lecture-routes.ts"() {
    "use strict";
    init_async_utils();
  }
});

// server/push-notifications.ts
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function registerPushToken(db2, userId, token, platform) {
  const now = Date.now();
  await db2.query(
    `INSERT INTO user_push_tokens (user_id, expo_push_token, platform, is_active, created_at, last_seen_at)
     VALUES ($1, $2, $3, TRUE, $4, $4)
     ON CONFLICT (expo_push_token)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       platform = EXCLUDED.platform,
       is_active = TRUE,
       last_seen_at = EXCLUDED.last_seen_at`,
    [userId, token, platform || "unknown", now]
  );
}
async function unregisterPushToken(db2, userId, token) {
  await db2.query(
    "UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2 AND expo_push_token = $3",
    [Date.now(), userId, token]
  );
}
async function unregisterAllPushTokens(db2, userId) {
  await db2.query("UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2", [
    Date.now(),
    userId
  ]);
}
async function sendPushToUsers(db2, userIds, payload) {
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, tokens: 0 };
  const tokenResult = await db2.query(
    "SELECT expo_push_token FROM user_push_tokens WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  const tokens = [...new Set(tokenResult.rows.map((r) => String(r.expo_push_token || "").trim()).filter(Boolean))];
  if (!tokens.length) return { sent: 0, tokens: 0 };
  const messages = tokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
    priority: "high"
  }));
  const chunks = chunkArray(messages, 100);
  let sent = 0;
  const invalidTokens = [];
  for (const chunk of chunks) {
    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Accept-encoding": "gzip, deflate",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(chunk)
      });
      const json = await res.json().catch(() => null);
      const results = Array.isArray(json?.data) ? json.data : [];
      sent += results.filter((r) => r?.status === "ok").length;
      results.forEach((r, idx) => {
        if (r?.status === "error" && r?.details?.error === "DeviceNotRegistered" && chunk[idx]?.to) {
          invalidTokens.push(chunk[idx].to);
        }
      });
    } catch (err) {
      console.error("[Push] send chunk failed:", err);
    }
  }
  if (invalidTokens.length > 0) {
    await db2.query("UPDATE user_push_tokens SET is_active = FALSE, last_seen_at = $1 WHERE expo_push_token = ANY($2::text[])", [
      Date.now(),
      [...new Set(invalidTokens)]
    ]).catch(() => {
    });
  }
  return { sent, tokens: tokens.length };
}
var init_push_notifications = __esm({
  "server/push-notifications.ts"() {
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
      if (courseId) {
        await updateCourseTestCounts2(courseId);
        const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [courseId]).catch(() => ({ rows: [] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]).catch(() => ({ rows: [] }));
        const recipientIds = recipients.rows.map((r) => Number(r.user_id));
        const notifTitle = "\u{1F4DD} New Test Added";
        const notifMessage = `"${title}" has been added in ${courseTitle}.`;
        const now = Date.now();
        if (recipientIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint
               FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, "info", now]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_test_added", testId: result.rows[0]?.id, courseId: Number(courseId) }
        });
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create test" });
    }
  });
  app2.post("/api/admin/questions", requireAdmin, async (req, res) => {
    try {
      const rawList = Array.isArray(req.body) ? req.body : [req.body];
      const testId = rawList[0]?.testId;
      if (!testId) {
        return res.status(400).json({ message: "testId is required" });
      }
      async function assignNextOrderInsert(q) {
        const insertAfter = q.insertAfterQuestionId ?? q.afterQuestionId;
        const parsedAfter = insertAfter !== void 0 && insertAfter !== null && insertAfter !== "" ? parseInt(String(insertAfter), 10) : NaN;
        if (Number.isFinite(parsedAfter)) {
          const ref = await db2.query(
            `SELECT order_index FROM questions WHERE id = $1 AND test_id = $2`,
            [parsedAfter, testId]
          );
          if (ref.rows.length > 0) {
            const k = Number(ref.rows[0].order_index ?? 0);
            await db2.query(
              `UPDATE questions SET order_index = order_index + 1 WHERE test_id = $1 AND order_index > $2`,
              [testId, k]
            );
            return k + 1;
          }
        }
        const maxRow = await db2.query(`SELECT COALESCE(MAX(order_index), 0)::numeric AS m FROM questions WHERE test_id = $1`, [testId]);
        const max = Number(maxRow.rows[0]?.m ?? 0);
        return max + 1;
      }
      for (const q of rawList) {
        const { insertAfterQuestionId: _a, afterQuestionId: _b, orderIndex: _ignoredOrder, ...rest } = q;
        const orderIndex = await assignNextOrderInsert(q);
        await db2.query(
          `INSERT INTO questions (test_id, question_text, option_a, option_b, option_c, option_d, correct_option, explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            rest.testId,
            rest.questionText,
            rest.optionA,
            rest.optionB,
            rest.optionC,
            rest.optionD,
            rest.correctOption,
            rest.explanation,
            rest.topic,
            rest.difficulty || "medium",
            rest.marks ?? 4,
            rest.negativeMarks ?? 1,
            orderIndex,
            rest.imageUrl || null,
            rest.solutionImageUrl || null
          ]
        );
      }
      await db2.query("UPDATE tests SET total_questions = (SELECT COUNT(*) FROM questions WHERE test_id = $1) WHERE id = $1", [testId]);
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
    init_push_notifications();
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
      console.log("[bulk-pdf] upload received", { testId, fileName: req.file?.originalname, size: req.file?.size });
      if (!testId || !req.file) {
        return res.status(400).json({ message: !testId ? "testId is required" : "PDF file is required \u2014 make sure you selected a .pdf file" });
      }
      if (!/application\/pdf/i.test(String(req.file.mimetype || ""))) {
        return res.status(400).json({
          success: false,
          error: "Only PDF files are allowed for bulk upload",
          message: "Please select a valid .pdf file"
        });
      }
      const parser = new PDFParse2({ data: req.file.buffer });
      const result = await parser.getText();
      const text = result.text;
      console.log("[bulk-pdf] extracted text length:", text.length);
      const parsed = parseQuestionsFromText(text);
      console.log("[bulk-pdf] parsed questions:", parsed.length);
      if (parsed.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No questions could be parsed from this PDF",
          message: "Make sure questions are numbered (Q1, 1., etc.) with options labeled A, B, C, D.",
          data: { rawTextPreview: text.substring(0, 500) }
        });
      }
      res.json({ success: true, data: { count: parsed.length, questions: parsed } });
    } catch (err) {
      console.error("[bulk-pdf] error:", err);
      res.status(500).json({
        success: false,
        error: "Failed to parse PDF",
        message: `Failed to parse PDF: ${err?.message || "unknown error"}`
      });
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
  deleteDownloadsForUser: deleteDownloadsForUser2,
  runInTransaction: runInTransaction2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
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
        await recomputeAllEnrollmentsProgressForCourse2(parsedCourseId);
        const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
        const recipientIds = recipients.rows.map((r) => Number(r.user_id));
        const notifTitle = "\u{1F4D8} New Material Added";
        const notifMessage = `"${normalizedTitle}" has been added in ${courseTitle}.`;
        const now = Date.now();
        if (recipientIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint
               FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, "info", now]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_material_added", materialId: result.rows[0]?.id, courseId: parsedCourseId }
        });
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
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle } = req.body;
      const mainSec = typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() !== "" ? lectureSectionTitle.trim() : null;
      const subSec = typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() !== "" ? lectureSubfolderTitle.trim() : null;
      const result = await db2.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          youtubeUrl || null,
          scheduledAt,
          isLive || false,
          isPublic || false,
          notifyEmail || false,
          notifyBell || false,
          isFreePreview || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          mainSec,
          subSec,
          Date.now()
        ]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive}`);
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[LiveClass] create failed", err);
      res.status(500).json({ message: "Failed to add live class" });
    }
  });
  app2.get("/api/admin/device-block-events", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(
        `SELECT e.id, e.user_id, e.attempted_device_id, e.bound_device_id, e.phone, e.email, e.platform, e.reason, e.created_at,
                u.name AS user_name
         FROM device_block_events e
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.created_at DESC NULLS LAST
         LIMIT 300`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[Admin] device-block-events:", err);
      res.status(500).json({ message: "Failed to load device block events" });
    }
  });
  app2.get("/api/admin/device-denied-users", requireAdmin, async (_req, res) => {
    try {
      const result = await db2.query(
        `SELECT u.id AS user_id,
                u.name AS user_name,
                u.phone,
                u.email,
                MAX(e.created_at) AS latest_at,
                COUNT(*)::int AS event_count,
                (ARRAY_AGG(e.reason ORDER BY e.created_at DESC))[1] AS latest_reason,
                (ARRAY_AGG(e.platform ORDER BY e.created_at DESC))[1] AS latest_platform
         FROM device_block_events e
         INNER JOIN users u ON u.id = e.user_id
         WHERE e.reason IN ('wrong_web_browser_login_denied', 'wrong_device_login_denied')
           AND COALESCE(u.role, '') <> 'admin'
         GROUP BY u.id, u.name, u.phone, u.email
         ORDER BY MAX(e.created_at) DESC NULLS LAST
         LIMIT 200`
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[Admin] device-denied-users:", err);
      res.status(500).json({ message: "Failed to load device-denied users" });
    }
  });
  app2.post("/api/admin/users/:id/reset-device-binding", requireAdmin, async (req, res) => {
    try {
      const uid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(uid)) return res.status(400).json({ message: "Invalid user id" });
      await db2.query(
        "UPDATE users SET app_bound_device_id = NULL, web_device_id_phone = NULL, web_device_id_desktop = NULL WHERE id = $1",
        [uid]
      );
      await db2.query(
        "DELETE FROM device_block_events WHERE user_id = $1 AND reason IN ('wrong_web_browser_login_denied', 'wrong_device_login_denied')",
        [uid]
      ).catch(() => {
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[Admin] reset-device-binding:", err);
      res.status(500).json({ message: "Failed to reset device binding" });
    }
  });
  app2.post("/api/admin/users/cleanup-pending", requireAdmin, async (_req, res) => {
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1e3;
      const candidates = await db2.query(
        `SELECT u.id
         FROM users u
         WHERE COALESCE(u.role, 'student') = 'student'
           AND COALESCE(u.profile_complete, FALSE) = FALSE
           AND COALESCE(u.created_at, 0) < $1
           AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM lecture_progress lp WHERE lp.user_id = u.id)
           AND NOT EXISTS (SELECT 1 FROM test_attempts ta WHERE ta.user_id = u.id)
         LIMIT 1000`,
        [cutoff]
      );
      const ids = candidates.rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n));
      const deleted = [];
      const failed = [];
      for (const id of ids) {
        try {
          await runInTransaction2((tx) => purgeStudentAccountById(tx, id));
          deleted.push(id);
        } catch (err) {
          failed.push({ id, error: String(err?.message || err) });
        }
      }
      await db2.query("DELETE FROM otp_challenges WHERE updated_at < $1", [cutoff]).catch(() => {
      });
      res.json({ success: true, deleted: deleted.length, ids: deleted, failed });
    } catch (err) {
      console.error("[Admin] cleanup-pending:", err);
      res.status(500).json({ message: "Failed to clean up pending signups" });
    }
  });
  app2.get("/api/admin/users", requireAdmin, async (_req, res) => {
    try {
      const colsResult = await db2.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'"
      );
      const cols = new Set(colsResult.rows.map((r) => String(r.column_name)));
      if (!cols.has("id")) return res.status(500).json({ message: "Users table missing id column" });
      const field = (name, fallbackSql) => cols.has(name) ? name : `${fallbackSql} AS ${name}`;
      const selectSql = [
        "id",
        field("name", "NULL"),
        field("email", "NULL"),
        field("phone", "NULL"),
        field("role", "'student'"),
        field("created_at", "NULL"),
        field("is_blocked", "FALSE"),
        field("last_active_at", "NULL")
      ].join(", ");
      const orderSql = cols.has("created_at") ? "created_at DESC NULLS LAST" : "id DESC";
      const result = await db2.query(`SELECT ${selectSql} FROM users ORDER BY ${orderSql}`);
      res.json(
        result.rows.map((r) => ({
          id: r.id,
          name: r.name ?? `User${r.id}`,
          email: r.email ?? null,
          phone: r.phone ?? null,
          role: r.role ?? "student",
          created_at: r.created_at ?? null,
          is_blocked: !!r.is_blocked,
          last_active_at: r.last_active_at ?? null
        }))
      );
    } catch (err) {
      console.error("Admin users error:", err);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });
  app2.get("/api/admin/users/:id/enrollments", requireAdmin, async (req, res) => {
    try {
      const userId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });
      const result = await db2.query(
        `SELECT course_id
         FROM enrollments
         WHERE user_id = $1`,
        [userId]
      );
      const courseIds = result.rows.map((r) => Number(r.course_id)).filter((n) => Number.isFinite(n));
      res.json({ courseIds });
    } catch (err) {
      console.error("Admin user enrollments error:", err);
      res.status(500).json({ message: "Failed to fetch user enrollments" });
    }
  });
  app2.put("/api/admin/users/:id/block", requireAdmin, async (req, res) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        await db2.query("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]);
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
      const userId = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(userId)) return res.status(400).json({ message: "Invalid user id" });
      const requester = req.user;
      if (requester?.id && Number(requester.id) === userId) {
        return res.status(400).json({ message: "You cannot remove your own admin account" });
      }
      const userRow = await db2.query("SELECT id, role FROM users WHERE id = $1 LIMIT 1", [userId]);
      if (userRow.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }
      if (String(userRow.rows[0].role || "").toLowerCase() === "admin") {
        return res.status(400).json({ message: "Admin accounts cannot be removed from this action" });
      }
      await deleteDownloadsForUser2(userId);
      await runInTransaction2((tx) => purgeStudentAccountById(tx, userId));
      res.json({ success: true });
    } catch (err) {
      console.error("Delete user error:", err);
      const e = err;
      res.status(500).json({ message: "Failed to delete user", code: e?.code || null, detail: e?.message || null });
    }
  });
}
var init_admin_users_and_content_routes = __esm({
  "server/admin-users-and-content-routes.ts"() {
    "use strict";
    init_push_notifications();
    init_user_account_purge();
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
      const row = result.rows[0];
      const cid = courseId != null && courseId !== "" ? String(courseId) : "";
      if (cid && row?.id != null) {
        try {
          const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [cid]).catch(() => ({ rows: [] }));
          const courseTitle = String(courseInfo.rows[0]?.title || "your course");
          const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [cid]).catch(() => ({ rows: [] }));
          const recipientIds = recipients.rows.map((r) => Number(r.user_id)).filter((id) => Number.isFinite(id));
          const notifTitle = "\u{1F3AF} New Daily Mission";
          const notifMessage = `"${title}" has been added to ${courseTitle}.`;
          const now = Date.now();
          if (recipientIds.length > 0) {
            await db2.query(
              `INSERT INTO notifications (user_id, title, message, type, created_at)
                 SELECT u, $2::text, $3::text, $4::text, $5::bigint
                 FROM unnest($1::int[]) AS u`,
              [recipientIds, notifTitle, notifMessage, "info", now]
            ).catch(() => {
            });
          }
          await sendPushToUsers(db2, recipientIds, {
            title: notifTitle,
            body: notifMessage,
            data: { type: "course_mission_added", missionId: Number(row.id), courseId: Number(cid) }
          });
        } catch (e) {
          console.error("Course mission notify:", e);
        }
      }
      res.json(row);
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
    init_push_notifications();
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
      if (userIds.length > 0) {
        await db2.query(
          `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, admin_notif_id, image_url)
           SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7, $8::text
           FROM unnest($1::int[]) AS u`,
          [userIds, title, message, type || "info", now, expiresAt, adminNotifId, imageUrl || null]
        );
      }
      await sendPushToUsers(db2, userIds.map((id) => Number(id)), {
        title: String(title || "Notification"),
        body: String(message || ""),
        data: { type: "admin_notification", adminNotifId, courseId: courseId || null }
      });
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
    init_push_notifications();
  }
});

// server/admin-course-crud-routes.ts
function registerAdminCourseCrudRoutes({
  app: app2,
  db: db2,
  requireAdmin
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
  const verifyBookOrder = async (orderId, userId, bookId) => {
    const bookResult = await db2.query("SELECT id, price FROM books WHERE id = $1", [bookId]);
    if (!bookResult.rows.length) throw new Error("Book not found");
    const expectedAmount = Math.round(parseFloat(String(bookResult.rows[0].price || "0")) * 100);
    const razorpay = getRazorpay2();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const noteKind = String(notes.kind || "");
    const noteUserId = Number(notes.userId || 0);
    const noteBookId = Number(notes.bookId || 0);
    const amount = Number(order.amount || 0);
    if (noteKind !== "book") throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== userId) throw new Error("Payment user mismatch");
    if (!noteBookId || noteBookId !== bookId) throw new Error("Payment book mismatch");
    if (!amount || amount !== expectedAmount) throw new Error("Payment amount mismatch");
  };
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
      console.log("[BookClick] tracked");
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
      console.log("[BookOrder] creating order");
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
      console.log("[BookOrder] created");
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
      await verifyBookOrder(razorpay_order_id, userId, bookId);
      const preBk = await assertNativePaidPurchaseInstallation(db2, userId, req);
      if (!preBk.ok) return res.redirect(fail);
      await db2.query(
        "INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING",
        [userId, bookId, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db2, userId, req);
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
      const parsedBookId = Number(bookId);
      if (!parsedBookId) return res.status(400).json({ message: "bookId is required" });
      const isValid = verifyPaymentSignature2(razorpayOrderId, razorpayPaymentId, razorpaySignature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await verifyBookOrder(razorpayOrderId, user.id, parsedBookId);
      const preBk = await assertNativePaidPurchaseInstallation(db2, user.id, req);
      if (!preBk.ok) {
        return res.status(403).json({ message: preBk.message });
      }
      await db2.query("INSERT INTO book_purchases (user_id, book_id, purchased_at) VALUES ($1, $2, $3) ON CONFLICT (user_id, book_id) DO NOTHING", [user.id, parsedBookId, Date.now()]);
      await finalizeInstallationBindAfterPurchase(db2, user.id, req);
      await db2.query("DELETE FROM book_click_tracking WHERE user_id = $1 AND book_id = $2", [user.id, parsedBookId]).catch(() => {
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
    init_native_device_binding();
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
  requireAdmin,
  generateAIAnswer: generateAIAnswer2
}) {
  const buildAdminDoubtFilter = ({
    daysRaw,
    topicFilter,
    studentQuery
  }) => {
    const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
    const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1e3 : 0;
    const where = [];
    const params = [];
    if (sinceTs > 0) {
      params.push(sinceTs);
      where.push(`d.created_at >= $${params.length}`);
    }
    if (topicFilter) {
      params.push(topicFilter);
      where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
    }
    if (studentQuery) {
      params.push(`%${studentQuery}%`);
      const textParamIdx = params.length;
      const digitOnly = studentQuery.replace(/\D/g, "");
      let digitClause = "";
      if (digitOnly.length >= 4) {
        params.push(`%${digitOnly}%`);
        const digitParamIdx = params.length;
        digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${digitParamIdx}`;
      }
      where.push(`(
        COALESCE(u.name, '') ILIKE $${textParamIdx}
        OR COALESCE(u.phone, '') ILIKE $${textParamIdx}
        OR COALESCE(u.email, '') ILIKE $${textParamIdx}
        OR COALESCE(d.question, '') ILIKE $${textParamIdx}
        ${digitClause}
      )`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    return { whereSql, params };
  };
  app2.post("/api/doubts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { question, topic } = req.body;
      const aiAnswer = await generateAIAnswer2(question, topic, user.id);
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
  app2.get("/api/admin/doubts", requireAdmin, async (req, res) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const studentQuery = String(req.query.student || "").trim();
      const { whereSql, params } = buildAdminDoubtFilter({ daysRaw, topicFilter, studentQuery });
      const baseSelect = `SELECT d.*, u.name as user_name, u.phone as user_phone, u.email as user_email
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id`;
      const result = await db2.query(
        `${baseSelect}
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 500`,
        params
      );
      let rows = result.rows || [];
      if (rows.length === 0 && studentQuery) {
        const relaxedParams = [];
        relaxedParams.push(`%${studentQuery}%`);
        const textParamIdx = relaxedParams.length;
        const digitOnly = studentQuery.replace(/\D/g, "");
        let digitClause = "";
        if (digitOnly.length >= 4) {
          relaxedParams.push(`%${digitOnly}%`);
          const digitParamIdx = relaxedParams.length;
          digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${digitParamIdx}`;
        }
        const relaxedWhere = `WHERE (
          COALESCE(u.name, '') ILIKE $${textParamIdx}
          OR COALESCE(u.phone, '') ILIKE $${textParamIdx}
          OR COALESCE(u.email, '') ILIKE $${textParamIdx}
          OR COALESCE(d.question, '') ILIKE $${textParamIdx}
          ${digitClause}
        )`;
        const relaxed = await db2.query(
          `${baseSelect}
           ${relaxedWhere}
           ORDER BY d.created_at DESC
           LIMIT 500`,
          relaxedParams
        );
        rows = relaxed.rows || [];
      }
      const topicCounts = {};
      for (const r of rows) {
        const k = String(r.topic || "General").trim() || "General";
        topicCounts[k] = (topicCounts[k] || 0) + 1;
      }
      const topTopics = Object.entries(topicCounts).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 10);
      const normalizeQuestion = (input) => String(input || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(please|plz|sir|mam|maam|kindly|can|could|would|help|me|with|solve|question)\b/g, " ").replace(/\s+/g, " ").trim();
      const patternCounts = {};
      for (const r of rows) {
        const normalized = normalizeQuestion(String(r.question || ""));
        if (!normalized) continue;
        const existing = patternCounts[normalized];
        if (!existing) {
          patternCounts[normalized] = {
            questionPattern: normalized,
            count: 1,
            latestAt: Number(r.created_at || 0),
            sampleQuestion: String(r.question || "")
          };
        } else {
          existing.count += 1;
          if (Number(r.created_at || 0) > existing.latestAt) {
            existing.latestAt = Number(r.created_at || 0);
            existing.sampleQuestion = String(r.question || existing.sampleQuestion);
          }
        }
      }
      const repeatedPatterns = Object.values(patternCounts).filter((p) => p.count >= 2).sort((a, b) => b.count - a.count || b.latestAt - a.latestAt).slice(0, 12);
      const studentMap = {};
      const perStudentTopicCounts = {};
      for (const r of rows) {
        const idKey = String(r.user_id || 0);
        if (!studentMap[idKey]) {
          studentMap[idKey] = {
            user_id: Number(r.user_id || 0),
            name: String(r.user_name || ""),
            phone: String(r.user_phone || ""),
            email: String(r.user_email || ""),
            doubtCount: 0,
            lastAskedAt: 0,
            topTopic: "General"
          };
          perStudentTopicCounts[idKey] = {};
        }
        const s = studentMap[idKey];
        s.doubtCount += 1;
        s.lastAskedAt = Math.max(s.lastAskedAt, Number(r.created_at || 0));
        const topic = String(r.topic || "General").trim() || "General";
        perStudentTopicCounts[idKey][topic] = (perStudentTopicCounts[idKey][topic] || 0) + 1;
      }
      const studentInsights = Object.values(studentMap).map((s) => {
        const topicCounter = perStudentTopicCounts[String(s.user_id)] || {};
        const topTopicEntry = Object.entries(topicCounter).sort((a, b) => b[1] - a[1])[0];
        return { ...s, topTopic: topTopicEntry?.[0] || "General" };
      }).sort((a, b) => b.doubtCount - a.doubtCount || b.lastAskedAt - a.lastAskedAt).slice(0, 20);
      res.json({ doubts: rows, topTopics, repeatedPatterns, studentInsights, total: rows.length });
    } catch {
      res.status(500).json({ message: "Failed to fetch admin doubts" });
    }
  });
  app2.delete("/api/admin/doubts", requireAdmin, async (req, res) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const studentQuery = String(req.query.student || "").trim();
      const { whereSql, params } = buildAdminDoubtFilter({ daysRaw, topicFilter, studentQuery });
      const target = await db2.query(
        `SELECT d.id
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 10000`,
        params
      );
      const ids = (target.rows || []).map((r) => Number(r.id)).filter((id) => Number.isFinite(id));
      if (!ids.length) {
        return res.json({ success: true, deletedCount: 0 });
      }
      const deleted = await db2.query(
        `DELETE FROM doubts
         WHERE id = ANY($1::int[])
         RETURNING id`,
        [ids]
      );
      return res.json({ success: true, deletedCount: deleted.rows.length || 0 });
    } catch (err) {
      console.error("[Admin Doubts] delete failed:", err);
      res.status(500).json({ message: "Failed to clear doubts" });
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
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db2.query("UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
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
  const hasActiveCourseEnrollment = async (userId, courseId) => {
    const e = await db2.query(
      "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
      [userId, courseId]
    );
    if (e.rows.length === 0) return false;
    return !isEnrollmentExpired(e.rows[0]);
  };
  const canAccessMission = async (user, mission) => {
    if (mission?.mission_type === "free_practice") return true;
    if (!user?.id) return false;
    if (user.role === "admin") return true;
    if (!mission?.course_id) return false;
    return hasActiveCourseEnrollment(Number(user.id), Number(mission.course_id));
  };
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
        const missionIds = result.rows.map((m) => Number(m.id)).filter((id) => Number.isFinite(id));
        const userMissionMap = /* @__PURE__ */ new Map();
        if (missionIds.length > 0) {
          const umBatch = await db2.query(
            "SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = ANY($2::int[])",
            [user.id, missionIds]
          );
          umBatch.rows.forEach((um) => {
            userMissionMap.set(Number(um.mission_id), um);
          });
        }
        const enrolledCourseIds = /* @__PURE__ */ new Set();
        if (user.role !== "admin") {
          const courseIds = [
            ...new Set(
              result.rows.map((m) => Number(m.course_id)).filter((cid) => Number.isFinite(cid) && cid > 0)
            )
          ];
          if (courseIds.length > 0) {
            const enr = await db2.query(
              `SELECT course_id, valid_until FROM enrollments
               WHERE user_id = $1 AND course_id = ANY($2::int[])
                 AND (status = 'active' OR status IS NULL)`,
              [user.id, courseIds]
            );
            for (const row of enr.rows) {
              if (!isEnrollmentExpired(row)) enrolledCourseIds.add(Number(row.course_id));
            }
          }
        }
        const missionAccessible = (mission) => {
          if (mission?.mission_type === "free_practice") return true;
          if (user.role === "admin") return true;
          const cid = Number(mission?.course_id);
          if (!Number.isFinite(cid) || cid <= 0) return false;
          return enrolledCourseIds.has(cid);
        };
        for (const mission of result.rows) {
          mission.isAccessible = missionAccessible(mission);
          if (!mission.isAccessible && user.role !== "admin") continue;
          const um = userMissionMap.get(Number(mission.id));
          mission.isCompleted = !!um?.is_completed;
          mission.userScore = um?.score || 0;
          mission.userTimeTaken = um?.time_taken || 0;
          mission.userAnswers = um?.answers || {};
          mission.userIncorrect = um?.incorrect || 0;
          mission.userSkipped = um?.skipped || 0;
        }
        if (user.role !== "admin") {
          result.rows = result.rows.filter((m) => !!m.isAccessible);
        }
      } else {
        for (const mission of result.rows) mission.isAccessible = mission.mission_type === "free_practice";
        result.rows = result.rows.filter((m) => !!m.isAccessible);
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
      const missionRes = await db2.query("SELECT * FROM daily_missions WHERE id = $1 LIMIT 1", [req.params.id]);
      if (missionRes.rows.length === 0) return res.status(404).json({ message: "Mission not found" });
      const mission = missionRes.rows[0];
      const allowed = await canAccessMission(user, mission);
      if (!allowed) return res.status(403).json({ message: "Access denied" });
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
      const user = await getAuthUser2(req);
      const { free } = req.query;
      const now = Date.now();
      const loadFolders = async () => {
        if (free !== "true") return [];
        const foldersResult = await db2.query(
          "SELECT * FROM standalone_folders WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL) ORDER BY created_at ASC"
        );
        return foldersResult.rows;
      };
      if (user?.role === "admin") {
        let query = "SELECT * FROM study_materials";
        if (free === "true") query += " WHERE is_free = TRUE";
        query += " ORDER BY created_at DESC";
        const result2 = await db2.query(query, []);
        const folders2 = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result2.rows, folders: folders2 });
      }
      if (!user) {
        const result2 = await db2.query(
          "SELECT id, title, description, file_type, course_id, is_free, section_title, download_allowed, created_at, file_url FROM study_materials WHERE is_free = TRUE ORDER BY created_at DESC"
        );
        const folders2 = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result2.rows, folders: folders2 });
      }
      const result = await db2.query(
        `SELECT sm.*
         FROM study_materials sm
         WHERE sm.is_free = TRUE
           OR (sm.course_id IS NULL AND sm.is_free = TRUE)
            OR EXISTS (
              SELECT 1 FROM enrollments e
              WHERE e.user_id = $1
                AND e.course_id = sm.course_id
                AND (e.status = 'active' OR e.status IS NULL)
                AND (e.valid_until IS NULL OR e.valid_until > $2)
            )
         ORDER BY sm.created_at DESC`,
        [user.id, now]
      );
      const folders = await loadFolders();
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

// server/lecture-payload-utils.ts
function sanitizeLectureRowForClient(row) {
  if (!row || typeof row !== "object") return row;
  const { transcript: _omit, ...rest } = row;
  return rest;
}
var init_lecture_payload_utils = __esm({
  "server/lecture-payload-utils.ts"() {
    "use strict";
  }
});

// server/lecture-routes.ts
function registerLectureRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  updateCourseProgress: updateCourseProgress2
}) {
  const canAccessLecture = async (user, lectureId) => {
    const result = await db2.query(
      `SELECT l.*, c.is_free AS course_is_free
       FROM lectures l
       LEFT JOIN courses c ON l.course_id = c.id
       WHERE l.id = $1`,
      [lectureId]
    );
    if (result.rows.length === 0) return { allowed: false };
    const lecture = result.rows[0];
    if (user?.role === "admin" || lecture.is_free_preview) return { allowed: true, lecture };
    if (!lecture.course_id) return { allowed: true, lecture };
    const enrolled = await db2.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, lecture.course_id]
    );
    if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) return { allowed: false, lecture };
    return { allowed: true, lecture };
  };
  app2.get("/api/lectures/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Enrollment required to access this lecture" });
      const lecture = access.lecture;
      res.json(sanitizeLectureRowForClient(lecture));
    } catch {
      res.status(500).json({ message: "Failed to fetch lecture" });
    }
  });
  app2.get("/api/lectures/:id/progress", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
      const result = await db2.query(
        "SELECT is_completed, watch_percent, COALESCE(playback_sessions, 0) AS playback_sessions FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
      res.json(result.rows[0]);
    } catch {
      res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0 });
    }
  });
  app2.post("/api/lectures/:id/progress/session", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Access denied for this lecture" });
      const debounceMs = 8 * 60 * 1e3;
      const now = Date.now();
      const prev = await db2.query(
        "SELECT last_session_ping_at FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, lectureId]
      );
      const row = prev.rows[0];
      const canBump = !row?.last_session_ping_at || now - Number(row.last_session_ping_at) >= debounceMs;
      if (!row) {
        await db2.query(
          `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, playback_sessions, last_session_ping_at, completed_at)
           VALUES ($1, $2, 0, false, 1, $3, NULL)`,
          [user.id, lectureId, now]
        );
      } else if (canBump) {
        await db2.query(
          `UPDATE lecture_progress SET
             playback_sessions = COALESCE(playback_sessions, 0) + 1,
             last_session_ping_at = $3
           WHERE user_id = $1 AND lecture_id = $2`,
          [user.id, lectureId, now]
        );
      }
      res.json({ success: true, bumped: canBump || !row });
    } catch {
      res.status(500).json({ message: "Failed to record session" });
    }
  });
  app2.post("/api/lectures/:id/progress", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const lectureId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { watchPercent, isCompleted } = req.body;
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Access denied for this lecture" });
      const lecture = access.lecture;
      const courseId = lecture.course_id ? Number(lecture.course_id) : null;
      const normalizedWatchPercent = Math.max(0, Math.min(100, Number(watchPercent) || 0));
      await db2.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at) 
         VALUES ($1, $2, $3, $4, $5) 
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET watch_percent = $3, is_completed = $4, completed_at = $5`,
        [user.id, lectureId, normalizedWatchPercent, Boolean(isCompleted), isCompleted ? Date.now() : null]
      );
      if (courseId && isCompleted) {
        await updateCourseProgress2(user.id, Number(courseId));
        await db2.query("UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3", [lectureId, user.id, courseId]);
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
    init_lecture_payload_utils();
  }
});

// server/test-folder-routes.ts
function registerTestFolderRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  getRazorpay: getRazorpay2,
  verifyPaymentSignature: verifyPaymentSignature2
}) {
  const verifyFolderOrder = async (orderId, userId, folderId) => {
    const folderResult = await db2.query(
      "SELECT id, price, is_free FROM standalone_folders WHERE id = $1 AND type = 'mini_course'",
      [folderId]
    );
    if (!folderResult.rows.length) throw new Error("Folder not found");
    const folder = folderResult.rows[0];
    if (folder.is_free || parseFloat(String(folder.price || "0")) <= 0) {
      throw new Error("This folder is free");
    }
    const expectedAmount = Math.round(parseFloat(String(folder.price || "0")) * 100);
    const razorpay = getRazorpay2();
    const order = await razorpay.orders.fetch(orderId);
    const notes = order.notes || {};
    const noteKind = String(notes.kind || "");
    const noteUserId = Number(notes.userId || 0);
    const noteFolderId = Number(notes.folderId || 0);
    const amount = Number(order.amount || 0);
    if (noteKind !== "test_folder") throw new Error("Payment kind mismatch");
    if (!noteUserId || noteUserId !== userId) throw new Error("Payment user mismatch");
    if (!noteFolderId || noteFolderId !== folderId) throw new Error("Payment folder mismatch");
    if (!amount || amount !== expectedAmount) throw new Error("Payment amount mismatch");
  };
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
  app2.post("/api/test-folders/create-order", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const folderId = Number(req.body.folderId);
      if (!folderId) return res.status(400).json({ message: "Folder ID required" });
      const folderResult = await db2.query(
        "SELECT id, name, price, is_free FROM standalone_folders WHERE id = $1 AND type = 'mini_course'",
        [folderId]
      );
      if (!folderResult.rows.length) return res.status(404).json({ message: "Folder not found" });
      const folder = folderResult.rows[0];
      if (folder.is_free || parseFloat(String(folder.price || "0")) <= 0) {
        return res.status(400).json({ message: "This folder is free" });
      }
      const existing = await db2.query(
        "SELECT id FROM folder_purchases WHERE user_id = $1 AND folder_id = $2",
        [user.id, folderId]
      );
      if (existing.rows.length > 0) return res.json({ alreadyPurchased: true });
      const amount = Math.round(parseFloat(String(folder.price || "0")) * 100);
      const razorpay = getRazorpay2();
      const order = await razorpay.orders.create({
        amount,
        currency: "INR",
        receipt: `folder_${folderId}_user_${user.id}_${Date.now()}`,
        notes: {
          folderId: String(folderId),
          userId: String(user.id),
          folderName: folder.name,
          kind: "test_folder"
        }
      });
      return res.json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        folderName: folder.name
      });
    } catch (err) {
      console.error("Test folder create-order error:", err);
      return res.status(500).json({ message: "Failed to create payment order" });
    }
  });
  app2.post("/api/test-folders/verify-payment", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { folderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
      const parsedFolderId = Number(folderId);
      if (!parsedFolderId) return res.status(400).json({ message: "folderId is required" });
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ message: "Payment details are required" });
      }
      const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
      if (!isValid) return res.status(400).json({ message: "Invalid payment signature" });
      await verifyFolderOrder(razorpay_order_id, user.id, parsedFolderId);
      const pre = await assertNativePaidPurchaseInstallation(db2, user.id, req);
      if (!pre.ok) return res.status(403).json({ message: pre.message });
      await db2.query(
        "INSERT INTO folder_purchases (user_id, folder_id, amount, payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, folder_id) DO NOTHING",
        [user.id, parsedFolderId, null, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db2, user.id, req);
      return res.json({ success: true });
    } catch (err) {
      console.error("Test folder verify-payment error:", err);
      return res.status(500).json({ message: "Failed to verify payment" });
    }
  });
  app2.post("/api/test-folders/verify-redirect", async (req, res) => {
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
      const notes = order.notes || {};
      if (String(notes.kind || "") !== "test_folder") return res.redirect(fail);
      const folderId = Number(notes.folderId || 0);
      const userId = Number(notes.userId || 0);
      if (!folderId || !userId) return res.redirect(fail);
      await verifyFolderOrder(razorpay_order_id, userId, folderId);
      const pre = await assertNativePaidPurchaseInstallation(db2, userId, req);
      if (!pre.ok) return res.redirect(fail);
      await db2.query(
        "INSERT INTO folder_purchases (user_id, folder_id, amount, payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, folder_id) DO NOTHING",
        [userId, folderId, null, razorpay_payment_id, Date.now()]
      );
      await finalizeInstallationBindAfterPurchase(db2, userId, req);
      return res.redirect(`${frontendBase}/test-folder/${folderId}?payment=success`);
    } catch (err) {
      console.error("Test folder verify-redirect error:", err);
      return res.redirect(fail);
    }
  });
}
var init_test_folder_routes = __esm({
  "server/test-folder-routes.ts"() {
    "use strict";
    init_native_device_binding();
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
function sanitizeQuestionsForClient(rows, isAdmin) {
  if (isAdmin) return rows;
  return rows.map((q) => {
    const { correct_option: _c, explanation: _e, solution_image_url: _s, ...rest } = q;
    return rest;
  });
}
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
      const isAdmin = user.role === "admin";
      res.json({ ...test, questions: sanitizeQuestionsForClient(questionsResult.rows, isAdmin) });
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
      const answerCount = answers && typeof answers === "object" ? Object.keys(answers).length : 0;
      console.log(`[Attempt] submit started test=${req.params.id} user=${user.id} answers=${answerCount} timeTaken=${timeTaken}`);
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
      res.status(500).json({ message: "Failed to submit test" });
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
      const requestedTestId = Number(req.params.id);
      if (!Number.isFinite(requestedTestId) || Number(attempt.test_id) !== requestedTestId) {
        return res.status(403).json({ message: "Attempt does not belong to this test" });
      }
      const testRes = await db2.query(
        `SELECT t.*, c.is_free AS course_is_free, sf.is_free AS folder_is_free
         FROM tests t
         LEFT JOIN courses c ON t.course_id = c.id
         LEFT JOIN standalone_folders sf ON t.mini_course_id = sf.id
         WHERE t.id = $1`,
        [requestedTestId]
      );
      if (testRes.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      if (user.role !== "admin") {
        const access = await assertTestAccess(db2, user, testRes.rows[0], String(requestedTestId));
        if (!access.ok) return res.status(403).json({ message: access.message });
      }
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
         ORDER BY ta.test_id, ta.completed_at DESC`,
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
  let upcomingCache = [];
  let upcomingCacheAt = 0;
  const upcomingCacheTtlMs = Math.max(1e4, Number(process.env.UPCOMING_CLASSES_CACHE_MS || "30000"));
  const sanitizeLiveClass = (row) => {
    if (!row || typeof row !== "object") return row;
    const { cf_stream_key, cf_stream_rtmp_url, ...safe } = row;
    void cf_stream_key;
    void cf_stream_rtmp_url;
    return safe;
  };
  const stripPublicPlaybackFields = (row) => {
    if (!row || typeof row !== "object") return row;
    const {
      recording_url,
      cf_playback_hls,
      youtube_url,
      cf_stream_uid,
      stream_url,
      meeting_url,
      join_url,
      zoom_meeting_id,
      google_meet_link,
      ...rest
    } = row;
    void recording_url;
    void cf_playback_hls;
    void youtube_url;
    void cf_stream_uid;
    void stream_url;
    void meeting_url;
    void join_url;
    void zoom_meeting_id;
    void google_meet_link;
    return rest;
  };
  const toPublicUpcomingDto = (row) => stripPublicPlaybackFields(sanitizeLiveClass(row));
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
          return res.json(result3.rows.map(sanitizeLiveClass));
        }
        const result2 = await db2.query("SELECT lc.*, c.title as course_title FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id ORDER BY lc.scheduled_at DESC");
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows.map(sanitizeLiveClass));
      }
      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND (lc.is_free_preview = TRUE OR ${ex23})
           ORDER BY lc.scheduled_at DESC`,
          [cid, user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows.map(sanitizeLiveClass));
      }
      if (cid) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND lc.is_free_preview = TRUE
           ORDER BY lc.scheduled_at DESC`,
          [cid]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows.map(sanitizeLiveClass));
      }
      const ex12 = sqlEnrollmentExistsForLiveList(1, 2);
      if (user) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex12} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE (
             lc.is_completed IS NOT TRUE
             OR (
               lc.recording_url IS NOT NULL
               OR lc.cf_playback_hls IS NOT NULL
               OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
             )
           )
             AND (
               (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
               OR (lc.course_id IS NOT NULL AND (lc.is_free_preview = TRUE OR ${ex12}))
             )
           ORDER BY lc.scheduled_at DESC`,
          [user.id, now]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows.map(sanitizeLiveClass));
      }
      const result = await db2.query(
        `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
         FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
         WHERE (
           lc.is_completed IS NOT TRUE
           OR (
             lc.recording_url IS NOT NULL
             OR lc.cf_playback_hls IS NOT NULL
             OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
           )
         )
           AND (
             (lc.course_id IS NULL AND (lc.is_public = TRUE OR lc.is_free_preview = TRUE))
             OR (lc.course_id IS NOT NULL AND lc.is_free_preview = TRUE)
           )
         ORDER BY lc.scheduled_at DESC`
      );
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows.map(sanitizeLiveClass));
    } catch (err) {
      console.error("[LiveClasses] list error:", err);
      res.set("Cache-Control", "private, no-store");
      res.json([]);
    }
  });
  app2.get("/api/upcoming-classes", async (_req, res) => {
    try {
      const now = Date.now();
      if (upcomingCache.length > 0 && now - upcomingCacheAt <= upcomingCacheTtlMs) {
        res.set("Cache-Control", "private, no-store");
        return res.json(upcomingCache);
      }
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
      const payload = result.rows.map(toPublicUpcomingDto);
      upcomingCache = payload;
      upcomingCacheAt = now;
      res.json(payload);
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.set("Cache-Control", "private, no-store");
      if (upcomingCache.length > 0) return res.json(upcomingCache);
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
      const canViewStreamSecrets = user?.role === "admin";
      const base = canViewStreamSecrets ? lc : sanitizeLiveClass(lc);
      const payload = canViewStreamSecrets || hasAccess ? base : stripPublicPlaybackFields(base);
      res.set("Cache-Control", "private, no-store");
      res.json({ ...payload, is_enrolled: isEnrolled, has_access: hasAccess });
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
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
}) {
  const inferVideoType = (url) => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };
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
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid, lectureSectionTitle, lectureSubfolderTitle } = req.body;
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
      if (lectureSectionTitle !== void 0) add("lecture_section_title", typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() === "" ? null : lectureSectionTitle);
      if (lectureSubfolderTitle !== void 0) add("lecture_subfolder_title", typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() === "" ? null : lectureSubfolderTitle);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== void 0) add("is_public", isPublicVal);
      if (updates.length === 0) {
        if (convertToLecture === true) {
          const only = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
          if (only.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
          const liveClassOnly = only.rows[0];
          const st = sectionTitle;
          const canConvert = liveClassOnly.is_completed === true && !!(liveClassOnly.youtube_url || liveClassOnly.recording_url || liveClassOnly.cf_playback_hls);
          if (!canConvert) {
            return res.status(400).json({ message: "Class must be completed with a YouTube, Cloudflare, or R2 recording URL to save as a lecture." });
          }
          await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClassOnly.title + "%"]).catch(() => {
          });
          const sameTitle = await db2.query("SELECT * FROM live_classes WHERE title = $1", [liveClassOnly.title]);
          for (const peer of sameTitle.rows) {
            if (!peer.course_id) continue;
            const urlForPeer = String(
              peer.recording_url || peer.cf_playback_hls || peer.youtube_url || liveClassOnly.recording_url || liveClassOnly.cf_playback_hls || liveClassOnly.youtube_url || ""
            ).trim();
            if (!urlForPeer) continue;
            const vType = inferVideoType(urlForPeer);
            const maxOrder = await db2.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [peer.course_id]);
            const durationMins = peer.started_at && peer.ended_at ? Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 6e4)) : peer.duration_minutes != null ? Number(peer.duration_minutes) : liveClassOnly.duration_minutes != null ? Number(liveClassOnly.duration_minutes) : 0;
            const sectionForLecture = buildRecordingLectureSectionTitle(
              peer.lecture_section_title,
              peer.lecture_subfolder_title,
              st
            );
            await db2.query(
              `INSERT INTO lectures (
                 course_id, title, description, video_url, video_type, duration_minutes,
                 order_index, is_free_preview, section_title, live_class_id, live_class_finalized, created_at
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
               ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
               DO UPDATE SET
                 video_url = EXCLUDED.video_url,
                 video_type = EXCLUDED.video_type,
                 duration_minutes = EXCLUDED.duration_minutes,
                 section_title = EXCLUDED.section_title,
                 live_class_finalized = TRUE`,
              [
                peer.course_id,
                peer.title,
                peer.description || "",
                urlForPeer,
                vType,
                durationMins,
                maxOrder.rows[0].next_order,
                false,
                sectionForLecture,
                peer.id,
                Date.now()
              ]
            );
            await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [peer.course_id]);
            await recomputeAllEnrollmentsProgressForCourse2(peer.course_id);
          }
          return res.json(liveClassOnly);
        }
        return res.status(400).json({ message: "No fields to update" });
      }
      params.push(req.params.id);
      const whereIdx = "$" + params.length;
      const sql = "UPDATE live_classes SET " + updates.join(", ") + " WHERE id = " + whereIdx + " RETURNING *";
      const result = await db2.query(sql, params);
      const liveClass = result.rows[0];
      if (isLive === true && liveClass.course_id) {
        const recipients = liveClass.is_free_preview === true || liveClass.is_public === true ? await db2.query("SELECT id AS user_id FROM users WHERE role = 'student'") : await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = Date.now() + 6 * 36e5;
        const recipientIds = recipients.rows.map((e) => Number(e.user_id));
        const notifTitle = "\u{1F534} Live Class Started!";
        const notifMessage = '"' + liveClass.title + '" is live now. Join now!';
        const now = Date.now();
        if (recipientIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
               FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, now, expiresAt]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, recipientIds, {
          title: "\u{1F534} Live Class Started!",
          body: `"${liveClass.title}" is live now. Join now!`,
          data: { type: "live_class_started", liveClassId: liveClass.id, courseId: liveClass.course_id || null }
        });
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
        const peerExpiresAt = Date.now() + 12 * 36e5;
        const extraRecipients = /* @__PURE__ */ new Set();
        for (const other of otherClasses.rows) {
          const enrolled = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [other.course_id]).catch(() => ({ rows: [] }));
          for (const e of enrolled.rows) {
            extraRecipients.add(Number(e.user_id));
          }
        }
        const peerNotifTitle = "\u{1F534} Live Class Started!";
        const peerNotifMessage = '"' + liveClass.title + '" is live now. Join now!';
        const peerNow = Date.now();
        if (extraRecipients.size > 0) {
          const peerIds = [...extraRecipients];
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
               FROM unnest($1::int[]) AS u`,
            [peerIds, peerNotifTitle, peerNotifMessage, peerNow, peerExpiresAt]
          ).catch(() => {
          });
          await sendPushToUsers(db2, peerIds, {
            title: "\u{1F534} Live Class Started!",
            body: `"${liveClass.title}" is live now. Join now!`,
            data: { type: "live_class_started", liveClassId: liveClass.id, courseId: liveClass.course_id || null }
          });
        }
      }
      const shouldConvertToLecture = convertToLecture === true && (isCompleted === true || liveClass.is_completed === true) && !liveClass.recording_deleted_at && (liveClass.youtube_url || liveClass.recording_url || liveClass.cf_playback_hls);
      if (shouldConvertToLecture) {
        await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClass.title + "%"]).catch(() => {
        });
        const sameTitle = await db2.query("SELECT * FROM live_classes WHERE title = $1", [liveClass.title]);
        for (const peer of sameTitle.rows) {
          if (!peer.course_id) continue;
          const urlForPeer = String(
            peer.recording_url || peer.cf_playback_hls || peer.youtube_url || liveClass.recording_url || liveClass.cf_playback_hls || liveClass.youtube_url || ""
          ).trim();
          if (!urlForPeer) continue;
          const vType = inferVideoType(urlForPeer);
          const maxOrder = await db2.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [peer.course_id]);
          const durationMins = peer.started_at && peer.ended_at ? Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 6e4)) : peer.duration_minutes != null ? Number(peer.duration_minutes) : liveClass.duration_minutes != null ? Number(liveClass.duration_minutes) : 0;
          const targetSection = buildRecordingLectureSectionTitle(
            peer.lecture_section_title,
            peer.lecture_subfolder_title,
            sectionTitle
          );
          await db2.query(
            `INSERT INTO lectures (
               course_id, title, description, video_url, video_type, duration_minutes,
               order_index, is_free_preview, section_title, live_class_id, live_class_finalized, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
             ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
             DO UPDATE SET
               video_url = EXCLUDED.video_url,
               video_type = EXCLUDED.video_type,
               duration_minutes = EXCLUDED.duration_minutes,
               section_title = EXCLUDED.section_title,
               live_class_finalized = TRUE`,
            [
              peer.course_id,
              peer.title,
              peer.description || "",
              urlForPeer,
              vType,
              durationMins,
              maxOrder.rows[0].next_order,
              false,
              targetSection,
              peer.id,
              Date.now()
            ]
          );
          await db2.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [peer.course_id]);
          await recomputeAllEnrollmentsProgressForCourse2(peer.course_id);
        }
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
      const existing = await db2.query("SELECT course_id FROM study_materials WHERE id = $1 LIMIT 1", [req.params.id]);
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
      if (existing.rows[0]?.course_id) {
        await recomputeAllEnrollmentsProgressForCourse2(existing.rows[0].course_id);
      }
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
        await recomputeAllEnrollmentsProgressForCourse2(courseId);
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
    init_recordingSection();
    init_push_notifications();
  }
});

// server/classroom-routes.ts
import { AccessToken } from "livekit-server-sdk";
function getLiveKitConfig() {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}
function classroomRoomName(liveClassId) {
  return `lc-${liveClassId}`;
}
async function loadLiveClass(db2, id) {
  const result = await db2.query("SELECT * FROM live_classes WHERE id = $1", [id]);
  return result.rows[0] || null;
}
function registerClassroomRoutes({
  app: app2,
  db: db2,
  requireAuth,
  requireAdmin,
  getAuthUser: getAuthUser2
}) {
  app2.get("/api/live-classes/:id/classroom/config", requireAuth, async (req, res) => {
    const cfg = getLiveKitConfig();
    res.json({
      livekitConfigured: !!cfg,
      syncPath: "/classroom-sync"
    });
  });
  app2.post("/api/live-classes/:id/classroom/token", requireAuth, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const lc = await loadLiveClass(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "This class is not a classroom stream" });
      }
      const canAccess = await userCanAccessLiveClassContent(db2, user, lc);
      if (!canAccess) return res.status(403).json({ message: "Access denied" });
      const isAdmin = user.role === "admin";
      if (!isAdmin && (!lc.is_live || lc.is_completed)) {
        return res.status(403).json({ message: "Class is not live" });
      }
      const cfg = getLiveKitConfig();
      if (!cfg) {
        return res.status(503).json({
          message: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET."
        });
      }
      const roomName = classroomRoomName(liveClassId);
      if (!lc.classroom_room_name) {
        await db2.query("UPDATE live_classes SET classroom_room_name = $1 WHERE id = $2", [
          roomName,
          liveClassId
        ]);
      }
      const identity = `user-${user.id}`;
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: user.name || identity,
        ttl: "6h"
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: isAdmin,
        canSubscribe: true,
        canPublishData: true
      });
      const token = await at.toJwt();
      res.json({
        token,
        url: cfg.url,
        roomName,
        canPublish: isAdmin
      });
    } catch (err) {
      console.error("[Classroom] token error:", err?.message || err);
      res.status(500).json({ message: "Failed to create classroom token" });
    }
  });
  app2.put("/api/admin/live-classes/:id/classroom/board-snapshot", requireAdmin, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const { boardSnapshotUrl, recordingUrl } = req.body || {};
      const url = String(boardSnapshotUrl || recordingUrl || "").trim();
      if (!url) return res.status(400).json({ message: "boardSnapshotUrl required" });
      const lc = await loadLiveClass(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      await db2.query(
        "UPDATE live_classes SET board_snapshot_url = $1, recording_url = COALESCE(recording_url, $1) WHERE id = $2",
        [url, liveClassId]
      );
      res.json({ ok: true, boardSnapshotUrl: url });
    } catch (err) {
      console.error("[Classroom] board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to save board snapshot" });
    }
  });
  app2.get("/api/live-classes/:id/classroom/board-snapshot", requireAuth, async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const lc = await loadLiveClass(db2, String(req.params.id));
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      const canAccess = await userCanAccessLiveClassContent(db2, user, lc);
      if (!canAccess) return res.status(403).json({ message: "Access denied" });
      res.json({
        boardSnapshotUrl: lc.board_snapshot_url || null,
        classroomRoomName: lc.classroom_room_name || null
      });
    } catch (err) {
      console.error("[Classroom] get board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to load board snapshot" });
    }
  });
}
var init_classroom_routes = __esm({
  "server/classroom-routes.ts"() {
    "use strict";
    init_live_class_access();
  }
});

// server/classroom-sync.ts
import { URL as URL2 } from "node:url";
import { createRequire as createRequire2 } from "node:module";
import { TLSocketRoom, InMemorySyncStorage } from "@tldraw/sync-core";
function sanitizeRoomId(roomId) {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
function makeOrLoadRoom(roomId) {
  const id = sanitizeRoomId(roomId);
  const existing = rooms.get(id);
  if (existing && !existing.isClosed()) return existing;
  const storage = new InMemorySyncStorage();
  const room = new TLSocketRoom({
    storage,
    onSessionRemoved(roomInstance, args) {
      if (args.numSessionsRemaining === 0) {
        roomInstance.close();
        rooms.delete(id);
      }
    }
  });
  rooms.set(id, room);
  return room;
}
function parseSessionId(url) {
  const sid = url.searchParams.get("sessionId");
  if (sid && sid.trim()) return sid.trim().slice(0, 128);
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
async function authenticateClassroomSocket(db2, req, roomId) {
  const url = new URL2(req.url || "", "http://localhost");
  const token = url.searchParams.get("access_token") || url.searchParams.get("token") || "";
  const fakeReq = {
    headers: {
      ...token ? { authorization: `Bearer ${token}` } : {},
      cookie: req.headers.cookie
    },
    session: req.session
  };
  const user = await getAuthUserFromRequest(fakeReq, db2);
  if (!user) return { ok: false, status: 401, message: "Unauthorized" };
  const liveClassId = roomId.replace(/^lc-/, "").replace(/-preview$/, "");
  const lcResult = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  const lc = lcResult.rows[0];
  if (!lc) return { ok: false, status: 404, message: "Live class not found" };
  if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
    return { ok: false, status: 400, message: "Not a classroom stream" };
  }
  const canAccess = await userCanAccessLiveClassContent(db2, user, lc);
  if (!canAccess) return { ok: false, status: 403, message: "Access denied" };
  const isPreview = roomId.endsWith("-preview");
  const isAdmin = user.role === "admin";
  if (!isPreview && !isAdmin && (!lc.is_live || lc.is_completed)) {
    return { ok: false, status: 403, message: "Class is not live" };
  }
  return { ok: true, user: { id: user.id, role: user.role }, isReadonly: !isAdmin };
}
function attachClassroomSyncServer(httpServer, db2) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL2(req.url || "", "http://localhost");
    const match = url.pathname.match(/^\/classroom-sync\/([^/]+)$/);
    if (!match) return;
    wss.handleUpgrade(req, socket, head, (socketConn) => {
      void handleConnection(socketConn, req, match[1], db2);
    });
  });
}
async function handleConnection(ws, req, rawRoomId, db2) {
  const auth2 = await authenticateClassroomSocket(db2, req, rawRoomId);
  if (!auth2.ok) {
    ws.close(auth2.status === 401 ? 4401 : 4403, auth2.message);
    return;
  }
  const roomId = sanitizeRoomId(rawRoomId);
  const url = new URL2(req.url || "", "http://localhost");
  const sessionId = parseSessionId(url);
  const room = makeOrLoadRoom(roomId);
  const caughtMessages = [];
  const collect = (data) => {
    caughtMessages.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  ws.on("message", collect);
  room.handleSocketConnect({
    sessionId,
    socket: ws,
    isReadonly: auth2.isReadonly
  });
  ws.off("message", collect);
  for (const msg of caughtMessages) {
    ws.send(msg);
  }
}
var require3, WebSocketServer, rooms;
var init_classroom_sync = __esm({
  "server/classroom-sync.ts"() {
    "use strict";
    init_auth_utils();
    init_live_class_access();
    require3 = createRequire2(import.meta.url);
    WebSocketServer = require3("ws").Server;
    rooms = /* @__PURE__ */ new Map();
  }
});

// server/course-access-routes.ts
function registerCourseAccessRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  generateSecureToken: generateSecureToken2,
  getR2Client,
  updateCourseProgress: updateCourseProgress2
}) {
  const assertTrackDownloadAllowed = async (user, itemType, itemId) => {
    const roleNorm = String(user.role ?? "student").toLowerCase();
    if (roleNorm !== "student" && roleNorm !== "admin") {
      return { ok: false, status: 401, message: "Not authenticated" };
    }
    const bypass = roleNorm === "admin";
    if (itemType !== "lecture" && itemType !== "material") {
      return { ok: false, status: 400, message: "Invalid itemType" };
    }
    let courseId = null;
    let materialIsFree = false;
    let downloadAllowed = false;
    if (itemType === "lecture") {
      const lectureResult = await db2.query("SELECT course_id, download_allowed FROM lectures WHERE id = $1", [itemId]);
      if (lectureResult.rows.length === 0) return { ok: false, status: 404, message: "Lecture not found" };
      courseId = lectureResult.rows[0].course_id;
      downloadAllowed = !!lectureResult.rows[0].download_allowed;
    } else {
      const materialResult = await db2.query("SELECT course_id, download_allowed, is_free FROM study_materials WHERE id = $1", [itemId]);
      if (materialResult.rows.length === 0) return { ok: false, status: 404, message: "Material not found" };
      courseId = materialResult.rows[0].course_id;
      downloadAllowed = !!materialResult.rows[0].download_allowed;
      materialIsFree = !!materialResult.rows[0].is_free;
    }
    if (!downloadAllowed) return { ok: false, status: 403, message: "Download not allowed for this item" };
    const courseIdResolved = courseId == null ? null : Math.trunc(Number(courseId));
    if (itemType === "material" && courseIdResolved === null && !bypass && !materialIsFree) {
      return { ok: false, status: 403, message: "This material requires purchase" };
    }
    if (courseIdResolved !== null && !bypass) {
      const enrollmentResult = await db2.query(
        "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
        [user.id, courseIdResolved]
      );
      if (enrollmentResult.rows.length === 0) {
        return { ok: false, status: 403, message: "Not enrolled in this course" };
      }
      const row = enrollmentResult.rows[0];
      if (isEnrollmentExpired(row)) {
        return { ok: false, status: 403, message: "Course access has expired" };
      }
    }
    return { ok: true };
  };
  const toR2ObjectKey = (raw) => canonicalMediaKey(raw);
  const userCanMintMediaToken = async (user, requestedKeyRaw) => {
    const variants = mediaKeyMatchVariants(requestedKeyRaw);
    if (variants.length === 0) return { allowed: false, reason: "invalid_key" };
    const roleNorm = String(user.role ?? "").toLowerCase();
    if (roleNorm === "admin") {
      return { allowed: true, reason: "allowed" };
    }
    const lectureMatch = await db2.query(
      `SELECT l.course_id, l.is_free_preview
       FROM lectures l
       WHERE (
         (l.video_url IS NOT NULL AND (
           regexp_replace(regexp_replace(COALESCE(l.video_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($1::text[])
           OR regexp_replace(COALESCE(l.video_url, ''), '^https?://[^/]+/', '') = ANY($1::text[])
         ))
         OR
         (l.pdf_url IS NOT NULL AND (
           regexp_replace(regexp_replace(COALESCE(l.pdf_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($1::text[])
           OR regexp_replace(COALESCE(l.pdf_url, ''), '^https?://[^/]+/', '') = ANY($1::text[])
         ))
       )
       LIMIT 1`,
      [variants]
    );
    if (lectureMatch.rows.length > 0) {
      const row = lectureMatch.rows[0];
      if (!row.course_id || row.is_free_preview) return { allowed: true, reason: "allowed" };
      const enrollment = await db2.query(
        "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
        [user.id, row.course_id]
      );
      if (enrollment.rows.length === 0) return { allowed: false, reason: "not_enrolled" };
      if (isEnrollmentExpired(enrollment.rows[0])) {
        return { allowed: false, reason: "expired" };
      }
      return { allowed: true, reason: "allowed" };
    }
    const liveClassMatch = await db2.query(
      `SELECT lc.course_id, lc.is_free_preview
       FROM live_classes lc
       WHERE lc.recording_url IS NOT NULL
         AND (
           regexp_replace(regexp_replace(COALESCE(lc.recording_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($1::text[])
           OR regexp_replace(COALESCE(lc.recording_url, ''), '^https?://[^/]+/', '') = ANY($1::text[])
         )
       LIMIT 1`,
      [variants]
    );
    if (liveClassMatch.rows.length > 0) {
      const row = liveClassMatch.rows[0];
      if (!row.course_id || row.is_free_preview) return { allowed: true, reason: "allowed" };
      const enrollment = await db2.query(
        "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
        [user.id, row.course_id]
      );
      if (enrollment.rows.length === 0) return { allowed: false, reason: "not_enrolled" };
      if (isEnrollmentExpired(enrollment.rows[0])) {
        return { allowed: false, reason: "expired" };
      }
      return { allowed: true, reason: "allowed" };
    }
    const materialMatch = await db2.query(
      `SELECT sm.course_id, sm.is_free
       FROM study_materials sm
       WHERE sm.file_url IS NOT NULL
         AND (
           regexp_replace(regexp_replace(COALESCE(sm.file_url, ''), '^https?://[^/]+/', ''), '^/+', '') = ANY($1::text[])
           OR regexp_replace(COALESCE(sm.file_url, ''), '^https?://[^/]+/', '') = ANY($1::text[])
         )
       LIMIT 1`,
      [variants]
    );
    if (materialMatch.rows.length > 0) {
      const row = materialMatch.rows[0];
      if (!row.course_id || row.is_free) return { allowed: true, reason: "allowed" };
      const enrollment = await db2.query(
        "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
        [user.id, row.course_id]
      );
      if (enrollment.rows.length === 0) return { allowed: false, reason: "not_enrolled" };
      if (isEnrollmentExpired(enrollment.rows[0])) {
        return { allowed: false, reason: "expired" };
      }
      return { allowed: true, reason: "allowed" };
    }
    return { allowed: false, reason: "no_match" };
  };
  const canAccessCourseContent = async (user, courseId) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    const enroll = await db2.query(
      "SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
      [user.id, courseId]
    );
    if (enroll.rows.length === 0) return false;
    return !isEnrollmentExpired(enroll.rows[0]);
  };
  app2.post("/api/media-token", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { fileKey } = req.body;
      if (!fileKey || typeof fileKey !== "string") return res.status(400).json({ message: "fileKey required" });
      const decision = await userCanMintMediaToken(user, fileKey);
      if (!decision.allowed) {
        console.warn("[media-token] denied", { userId: user.id, reason: decision.reason });
        return res.status(403).json({ message: "You do not have access to this media file" });
      }
      const token = generateSecureToken2();
      const expiresAt = Date.now() + 10 * 60 * 1e3;
      const storedKey = canonicalMediaKey(fileKey);
      if (!storedKey) return res.status(400).json({ message: "Invalid media file key" });
      await db2.query("INSERT INTO media_tokens (token, user_id, file_key, expires_at) VALUES ($1, $2, $3, $4)", [token, user.id, storedKey, expiresAt]);
      db2.query("DELETE FROM media_tokens WHERE expires_at < $1", [Date.now()]).catch(() => {
      });
      const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1e3));
      const readUrl = await presignR2GetObject(getR2Client, storedKey, ttlSec);
      res.set("Cache-Control", "private, no-store");
      res.json(readUrl ? { token, expiresAt, readUrl } : { token, expiresAt });
    } catch {
      res.status(500).json({ message: "Failed to generate token" });
    }
  });
  app2.get("/api/courses", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const { category, search } = req.query;
      let query = user?.role === "admin" ? `SELECT c.*,
               (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS total_lectures,
               (SELECT COUNT(*) FROM tests t WHERE t.course_id = c.id AND t.is_published = TRUE) AS total_tests,
               (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials
             FROM courses c WHERE 1=1` : `SELECT c.*,
               (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS total_lectures,
               (SELECT COUNT(*) FROM tests t WHERE t.course_id = c.id AND t.is_published = TRUE) AS total_tests,
               (SELECT COUNT(*) FROM study_materials sm WHERE sm.course_id = c.id) AS total_materials
             FROM courses c WHERE c.is_published = TRUE`;
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
        const enrollResult = await db2.query(
          "SELECT course_id, progress_percent FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL) AND (valid_until IS NULL OR valid_until > $2)",
          [user.id, Date.now()]
        );
        const enrollMap = /* @__PURE__ */ new Map();
        enrollResult.rows.forEach((e) => {
          enrollMap.set(Number(e.course_id), Number(e.progress_percent) || 0);
        });
        courses = courses.map((c) => ({
          ...c,
          isEnrolled: enrollMap.has(Number(c.id)),
          progress: enrollMap.get(Number(c.id)) ?? 0
        }));
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
      const user = await getAuthUser2(req);
      const courseIdParam = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [courseIdParam]);
      if (courseResult.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const course = courseResult.rows[0];
      const endTs = course.end_date != null && String(course.end_date).trim() !== "" ? Date.parse(String(course.end_date).trim()) : null;
      if (Number.isFinite(endTs) && endTs < Date.now()) {
        course.courseEnded = true;
      } else {
        course.courseEnded = false;
      }
      const lecturesResult = await db2.query("SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index", [courseIdParam]);
      const testsResult = await db2.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE ORDER BY created_at DESC, id DESC", [courseIdParam]);
      const materialsResult = await db2.query("SELECT * FROM study_materials WHERE course_id = $1", [courseIdParam]);
      const fullLectures = lecturesResult.rows;
      const fullMaterials = materialsResult.rows;
      const responseLectures = fullLectures.map((row) => sanitizeLectureRowForClient(row));
      const responseMaterials = fullMaterials;
      if (user) {
        const enroll = await db2.query("SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [user.id, courseIdParam]);
        const row = enroll.rows[0];
        const accessExpired = row && isEnrollmentExpired(row);
        course.isEnrolled = enroll.rows.length > 0 && !accessExpired;
        course.accessExpired = accessExpired || false;
        course.enrollmentValidUntil = row && row.valid_until != null ? row.valid_until : null;
        const progressRow = row;
        course.progress = progressRow && !accessExpired ? progressRow?.progress_percent || 0 : 0;
        course.lastLectureId = progressRow && !accessExpired ? progressRow?.last_lecture_id : null;
        if (course.isEnrolled) {
          const lpResult = await db2.query(
            `SELECT lp.lecture_id, lp.is_completed
             FROM lecture_progress lp
             JOIN lectures l ON l.id = lp.lecture_id
             WHERE lp.user_id = $1 AND l.course_id = $2`,
            [user.id, courseIdParam]
          );
          const lpMap = {};
          lpResult.rows.forEach((lp) => {
            lpMap[lp.lecture_id] = lp.is_completed;
          });
          lecturesResult.rows.forEach((l) => {
            l.isCompleted = lpMap[l.id] || false;
          });
        }
      }
      const hasContentAccess = await canAccessCourseContent(user, courseIdParam);
      course.hasContentAccess = hasContentAccess;
      res.set("Cache-Control", "private, no-store");
      res.json({
        ...course,
        total_materials: responseMaterials.length,
        lectures: responseLectures,
        tests: testsResult.rows,
        materials: responseMaterials
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch course" });
    }
  });
  app2.post("/api/courses/:id/enroll", async (req, res) => {
    try {
      const requester = await getAuthUser2(req);
      if (!requester) return res.status(401).json({ message: "Not authenticated" });
      let user = requester;
      const isAdminGrant = requester?.role === "admin" && req.body.userId && requester.id !== parseInt(req.body.userId);
      if (isAdminGrant) {
        const uid = parseInt(req.body.userId);
        const r = await db2.query("SELECT id, name, role FROM users WHERE id = $1", [uid]);
        if (r.rows.length > 0) user = r.rows[0];
      } else if (req.body.userId && user.id !== parseInt(req.body.userId)) {
        return res.status(403).json({ message: "Cannot enroll another user" });
      }
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
      const ins = await db2.query(
        `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
         VALUES ($1, $2, $3, $4, 'active')
         ON CONFLICT (user_id, course_id) DO NOTHING
         RETURNING id`,
        [user.id, req.params.id, at, vu]
      );
      if (ins.rows.length > 0) {
        await db2.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [req.params.id]);
      }
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
         AND (
           c.id IS NULL
           OR (
             (e.status = 'active' OR e.status IS NULL)
             AND (e.valid_until IS NULL OR e.valid_until > $2)
           )
         )
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
         LEFT JOIN courses c ON l.course_id = c.id
         LEFT JOIN enrollments e ON e.user_id = ud.user_id AND e.course_id = c.id
         WHERE ud.user_id = $1 AND ud.item_type = 'lecture' AND l.download_allowed = TRUE
         AND (
           c.id IS NULL
           OR (
             (e.status = 'active' OR e.status IS NULL)
             AND (e.valid_until IS NULL OR e.valid_until > $2)
           )
         )
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
      const idNum = parseInt(String(itemId), 10);
      if (!Number.isFinite(idNum)) return res.status(400).json({ message: "Invalid itemId" });
      const gate = await assertTrackDownloadAllowed(user, String(itemType), idNum);
      if (!gate.ok) return res.status(gate.status).json({ message: gate.message });
      await db2.query(
        "INSERT INTO user_downloads (user_id, item_type, item_id, local_filename) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET downloaded_at = EXTRACT(EPOCH FROM NOW()) * 1000, local_filename = EXCLUDED.local_filename",
        [user.id, itemType, idNum, localFilename || null]
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
      const roleNorm = String(user?.role ?? "student").toLowerCase();
      if (!user || roleNorm !== "student" && roleNorm !== "admin") {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const bypassEnrollment = roleNorm === "admin";
      const { itemType, itemId } = req.query;
      if (!itemType || !itemId || !["lecture", "material"].includes(String(itemType))) {
        return res.status(400).json({ message: "Valid itemType (lecture|material) and itemId required" });
      }
      const id = parseInt(String(itemId));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid itemId" });
      let courseId = null;
      let materialIsFree = false;
      let downloadAllowed = false;
      let r2Key = null;
      if (itemType === "lecture") {
        const lectureResult = await db2.query(
          "SELECT course_id, download_allowed, video_url, pdf_url FROM lectures WHERE id = $1",
          [id]
        );
        if (lectureResult.rows.length === 0) {
          return res.status(404).json({ message: "Lecture not found" });
        }
        const lecture = lectureResult.rows[0];
        courseId = lecture.course_id;
        downloadAllowed = lecture.download_allowed;
        const vu = lecture.video_url != null ? String(lecture.video_url).trim() : "";
        const pu = lecture.pdf_url != null ? String(lecture.pdf_url).trim() : "";
        r2Key = vu || pu || null;
      } else if (itemType === "material") {
        const materialResult = await db2.query("SELECT course_id, download_allowed, file_url, is_free FROM study_materials WHERE id = $1", [id]);
        if (materialResult.rows.length === 0) {
          return res.status(404).json({ message: "Material not found" });
        }
        const material = materialResult.rows[0];
        courseId = material.course_id;
        downloadAllowed = material.download_allowed;
        r2Key = material.file_url;
        materialIsFree = !!material.is_free;
      }
      const courseIdNumeric = courseId == null ? null : Number(courseId);
      const courseIdResolved = courseIdNumeric != null && Number.isFinite(courseIdNumeric) ? Math.trunc(courseIdNumeric) : null;
      if (!downloadAllowed) {
        return res.status(403).json({ message: "Download not allowed for this item" });
      }
      if (!r2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }
      if (itemType === "material" && courseIdResolved === null && !bypassEnrollment && !materialIsFree) {
        return res.status(403).json({ message: "This material requires purchase" });
      }
      if (courseIdResolved !== null && !bypassEnrollment) {
        const enrollmentResult = await db2.query(
          "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
          [user.id, courseIdResolved]
        );
        if (enrollmentResult.rows.length === 0) {
          return res.status(403).json({ message: "Not enrolled in this course" });
        }
        const enrollment = enrollmentResult.rows[0];
        if (enrollment.valid_until && enrollment.valid_until < Date.now()) {
          return res.status(403).json({ message: "Course access has expired" });
        }
      }
      const cleanR2Key = toR2ObjectKey(String(r2Key));
      if (!cleanR2Key) {
        return res.status(404).json({ message: "File URL not found" });
      }
      const { randomUUID } = await import("crypto");
      const token = randomUUID();
      const createdAt = Date.now();
      const expiresAt = createdAt + 5 * 60 * 1e3;
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
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token required" });
      }
      const tokenResult = await db2.query(
        "DELETE FROM download_tokens WHERE token = $1 AND expires_at > $2 RETURNING *",
        [token, Date.now()]
      );
      if (tokenResult.rows.length === 0) {
        return res.status(403).json({ message: "Token invalid or expired" });
      }
      const tokenData = tokenResult.rows[0];
      if (Number(tokenData.user_id) !== Number(user.id)) {
        return res.status(403).json({ message: "Token does not belong to this user" });
      }
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
      const { createHmac: createHmac3 } = await import("crypto");
      const timestamp = Date.now();
      const watermarkData = `${tokenData.user_id}:${timestamp}`;
      const hmac = createHmac3("sha256", process.env.SESSION_SECRET || "default-secret").update(watermarkData).digest("hex");
      const watermarkToken = `${watermarkData}:${hmac}`;
      res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
      res.setHeader("Content-Disposition", "attachment");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Pragma", "no-cache");
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
      const name = err && typeof err === "object" && "name" in err ? String(err.name) : "";
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[download-proxy] Error:", name || msg, msg);
      if ((name === "NoSuchKey" || msg.includes("NoSuchKey")) && !res.headersSent) {
        res.status(404).json({ message: "File not found in storage" });
        return;
      }
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
        `SELECT p.id,
                (CASE
                  WHEN p.amount IS NOT NULL AND c.price IS NOT NULL
                    AND p.amount::numeric = c.price::numeric
                  THEN (ROUND(c.price::numeric * 100))::integer
                  ELSE p.amount
                END) AS amount,
                p.currency, p.status, p.created_at,
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
    init_media_key_utils();
    init_r2_presign_read();
    init_lecture_payload_utils();
  }
});

// server/r2-path-utils.ts
function sanitizeLiveRecordingSubfolder(input) {
  if (input === void 0 || input === null) return null;
  const s = String(input).trim();
  if (s.length === 0) return null;
  if (s.length > SUBFOLDER_MAX) return null;
  if (s.includes("..") || s.includes("/") || s.includes("\\")) return null;
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug || slug.length < 1) return null;
  if (slug.length > SUBFOLDER_MAX) return null;
  if (slug === ".." || slug === ".") return null;
  return slug;
}
var LIVE_CLASS_RECORDING_ROOT, SUBFOLDER_MAX;
var init_r2_path_utils = __esm({
  "server/r2-path-utils.ts"() {
    "use strict";
    LIVE_CLASS_RECORDING_ROOT = "live-class-recording";
    SUBFOLDER_MAX = 80;
  }
});

// server/upload-routes.ts
function getPublicApiBaseUrl(req) {
  const configured = String(process.env.PUBLIC_API_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5e3}`;
  return `${protocol}://${host}`;
}
function buildPresignedObjectKey(body) {
  const { filename, folder: rawFolder = "uploads", subfolder: rawSub } = body;
  if (!filename) return { error: "filename required" };
  const ext = String(filename).split(".").pop() || "";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  if (String(rawFolder) === LIVE_CLASS_RECORDING_ROOT) {
    const hasSub = rawSub !== void 0 && rawSub !== null && String(rawSub).trim() !== "";
    const sub = hasSub ? sanitizeLiveRecordingSubfolder(rawSub) : null;
    if (hasSub && !sub) return { error: "Invalid recording subfolder" };
    const key = sub ? `${LIVE_CLASS_RECORDING_ROOT}/${sub}/${unique}` : `${LIVE_CLASS_RECORDING_ROOT}/${unique}`;
    return { key };
  }
  if (String(rawFolder).includes("/") || String(rawFolder).includes("..")) {
    return { error: "Invalid folder" };
  }
  return { key: `${rawFolder}/${unique}` };
}
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
  app2.get("/api/admin/upload/live-class-recording-folders", requireAdmin, async (req, res) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return res.status(500).json({ message: "R2 not configured" });
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const prefix = `${LIVE_CLASS_RECORDING_ROOT}/`;
      const out = await withTimeout(
        r2.send(
          new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: prefix,
            Delimiter: "/",
            MaxKeys: 1e3
          })
        ),
        6e3,
        "R2 list folders timed out"
      );
      const fromPrefixes = (out.CommonPrefixes || []).map((c) => c.Prefix?.replace(prefix, "").replace(/\/$/, "") || "").filter(Boolean);
      const fromKeys = (out.Contents || []).map((c) => c.Key).filter((k) => !!k).map((k) => {
        const rest = k.replace(prefix, "");
        const i = rest.indexOf("/");
        if (i <= 0) return null;
        return rest.slice(0, i);
      }).filter((x) => !!x);
      const names = [.../* @__PURE__ */ new Set([...fromPrefixes, ...fromKeys])].sort();
      res.json({ folders: names });
    } catch (err) {
      if (isTimeoutError(err)) {
        console.warn("[R2] List subfolders timed out, returning empty list");
        return res.json({ folders: [], degraded: true });
      }
      console.error("[R2] List subfolders error:", err);
      res.status(500).json({ message: "Failed to list folders" });
    }
  });
  app2.post("/api/admin/upload/live-class-recording-folders", requireAdmin, async (req, res) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return res.status(500).json({ message: "R2 not configured" });
      const name = sanitizeLiveRecordingSubfolder(req.body.name);
      if (!name) return res.status(400).json({ message: "Invalid folder name" });
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const key = `${LIVE_CLASS_RECORDING_ROOT}/${name}/.keep`;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: new Uint8Array(0),
          ContentType: "text/plain; charset=utf-8"
        })
      );
      res.json({ success: true, name });
    } catch (err) {
      console.error("[R2] Create subfolder error:", err);
      res.status(500).json({ message: "Failed to create folder" });
    }
  });
  app2.post("/api/upload/presign", requireAdmin, async (req, res) => {
    try {
      const { filename, contentType, folder, subfolder } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured. Check .env file." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const keyResult = buildPresignedObjectKey({ filename, folder, subfolder });
      if ("error" in keyResult) {
        return res.status(400).json({ message: keyResult.error });
      }
      const { key } = keyResult;
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType
      });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      const publicUrl = `${getPublicApiBaseUrl(req)}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });
  app2.post("/api/upload/to-r2", requireAdmin, uploadLarge2.single("file"), async (req, res) => {
    try {
      if (process.env.ALLOW_SERVER_BUFFER_UPLOAD !== "true") {
        return res.status(403).json({
          message: "Direct buffered upload is disabled. Use /api/upload/presign and upload from client instead."
        });
      }
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const file = req.file;
      const folder = req.body.folder || "uploads";
      const subfolder = req.body.subfolder;
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const keyResult = buildPresignedObjectKey({ filename: file.originalname, folder, subfolder });
      if ("error" in keyResult) {
        return res.status(400).json({ message: keyResult.error });
      }
      const { key } = keyResult;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype
        })
      );
      const publicUrl = `${getPublicApiBaseUrl(req)}/api/media/${key}`;
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
    init_r2_path_utils();
    init_async_utils();
  }
});

// server/media-stream-routes.ts
function r2HeadMetaGet(key) {
  const row = r2HeadMetaLru.get(key);
  if (!row) return null;
  if (Date.now() - row.storedAt > R2_HEAD_META_TTL_MS) {
    r2HeadMetaLru.delete(key);
    return null;
  }
  return row;
}
function r2HeadMetaSet(key, contentLength, contentType) {
  if (r2HeadMetaLru.size >= R2_HEAD_META_MAX) {
    const oldest = r2HeadMetaLru.keys().next().value;
    if (oldest) r2HeadMetaLru.delete(oldest);
  }
  r2HeadMetaLru.set(key, { contentLength, contentType, storedAt: Date.now() });
}
async function r2GetWithRetry(send, label) {
  try {
    return await withTimeout(send(), R2_GET_TIMEOUT_MS, label);
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    await new Promise((r) => setTimeout(r, 250));
    return await withTimeout(send(), R2_GET_TIMEOUT_MS, label);
  }
}
async function streamMediaGet(req, res, db2, getAuthUser2, getR2Client, key) {
  const canonicalKey = canonicalMediaKey(key);
  if (!canonicalKey || canonicalKey === "/") {
    res.status(400).json({ message: "No file key" });
    return;
  }
  const mediaToken = req.query.token;
  let userId = null;
  let userRole = "student";
  let authenticatedViaMediaToken = false;
  if (mediaToken) {
    const tokenResult = await db2.query("SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [mediaToken, Date.now(), canonicalKey]);
    if (tokenResult.rows.length === 0) {
      res.status(401).json({ message: "Token expired or invalid" });
      return;
    }
    const tokenUserId = tokenResult.rows[0].user_id;
    const sessionUser = await getAuthUser2(req);
    if (sessionUser && sessionUser.id !== tokenUserId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    userId = tokenUserId;
    if (sessionUser && sessionUser.id === tokenUserId) {
      userRole = sessionUser.role;
    } else {
      const roleRow = await db2.query("SELECT role FROM users WHERE id = $1 LIMIT 1", [tokenUserId]);
      userRole = String(roleRow.rows[0]?.role ?? "student");
    }
    authenticatedViaMediaToken = true;
  } else {
    const user = await getAuthUser2(req);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    userId = user.id;
    userRole = user.role;
  }
  if (!authenticatedViaMediaToken && userRole !== "admin") {
    const keyVariants = mediaKeyMatchVariants(canonicalKey);
    const matResult = await db2.query(
      `SELECT course_id, is_free
       FROM study_materials
       WHERE file_url = ANY($1::text[])
          OR regexp_replace(file_url, '^https?://[^/]+/', '') = ANY($1::text[])
          OR regexp_replace(file_url, '^https?://[^/]+', '') = ANY($1::text[])
       LIMIT 1`,
      [keyVariants]
    );
    if (matResult.rows.length > 0) {
      const mat = matResult.rows[0];
      if (mat.course_id && !mat.is_free) {
        const enrolled = await db2.query(
          "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
          [userId, mat.course_id]
        );
        if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
          res.status(403).json({ message: "Enrollment required" });
          return;
        }
      }
    } else {
      const lecResult = await db2.query(
        `SELECT course_id, is_free_preview
         FROM lectures
         WHERE video_url = ANY($1::text[])
            OR pdf_url = ANY($1::text[])
            OR regexp_replace(video_url, '^https?://[^/]+/', '') = ANY($1::text[])
            OR regexp_replace(video_url, '^https?://[^/]+', '') = ANY($1::text[])
            OR regexp_replace(pdf_url, '^https?://[^/]+/', '') = ANY($1::text[])
            OR regexp_replace(pdf_url, '^https?://[^/]+', '') = ANY($1::text[])
         LIMIT 1`,
        [keyVariants]
      );
      if (lecResult.rows.length > 0) {
        const lec = lecResult.rows[0];
        if (lec.course_id && !lec.is_free_preview) {
          const enrolled = await db2.query(
            "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
            [userId, lec.course_id]
          );
          if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
            res.status(403).json({ message: "Enrollment required" });
            return;
          }
        }
      } else {
        const lcResult = await db2.query(
          `SELECT course_id, is_free_preview
           FROM live_classes
           WHERE recording_url = ANY($1::text[])
              OR regexp_replace(recording_url, '^https?://[^/]+/', '') = ANY($1::text[])
              OR regexp_replace(recording_url, '^https?://[^/]+', '') = ANY($1::text[])
           LIMIT 1`,
          [keyVariants]
        );
        if (lcResult.rows.length > 0) {
          const lc = lcResult.rows[0];
          if (lc.course_id && !lc.is_free_preview) {
            const enrolled = await db2.query(
              "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
              [userId, lc.course_id]
            );
            if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
              res.status(403).json({ message: "Enrollment required" });
              return;
            }
          }
        } else {
          res.status(403).json({ message: "Forbidden" });
          return;
        }
      }
    }
  }
  const { GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = await getR2Client();
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const cachedHead = r2HeadMetaGet(canonicalKey);
    let totalSize;
    let headContentType;
    if (cachedHead) {
      totalSize = cachedHead.contentLength;
      headContentType = cachedHead.contentType;
    } else {
      const head = await withTimeout(
        r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey })),
        R2_HEAD_TIMEOUT_MS,
        "R2 head request timed out"
      );
      totalSize = head.ContentLength || 0;
      headContentType = head.ContentType;
      if (totalSize > 0) r2HeadMetaSet(canonicalKey, totalSize, headContentType);
    }
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!m || totalSize <= 0) {
      res.status(416);
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      res.json({ message: "Invalid range" });
      return;
    }
    const startRaw = m[1];
    const endRaw = m[2];
    let start = 0;
    let end = totalSize - 1;
    if (startRaw === "" && endRaw !== "") {
      const suffix = Number.parseInt(endRaw, 10);
      if (!Number.isFinite(suffix) || suffix <= 0) {
        res.status(416);
        res.setHeader("Content-Range", `bytes */${totalSize}`);
        res.json({ message: "Invalid range" });
        return;
      }
      start = Math.max(totalSize - suffix, 0);
    } else {
      start = Number.parseInt(startRaw, 10);
      end = endRaw ? Number.parseInt(endRaw, 10) : totalSize - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalSize || end < start) {
      res.status(416);
      res.setHeader("Content-Range", `bytes */${totalSize}`);
      res.json({ message: "Invalid range" });
      return;
    }
    if (end >= totalSize) end = totalSize - 1;
    const chunkSize = end - start + 1;
    const obj = await r2GetWithRetry(
      () => r2.send(
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey, Range: `bytes=${start}-${end}` })
      ),
      "R2 media range request timed out"
    );
    if (!obj.Body) {
      res.status(404).json({ message: "File not found" });
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${totalSize}`);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Length", String(chunkSize));
    if (headContentType) res.setHeader("Content-Type", headContentType);
    const isPdf = typeof headContentType === "string" && /pdf/i.test(headContentType);
    res.setHeader("Cache-Control", isPdf ? "private, max-age=300" : "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    const stream = obj.Body;
    if (typeof stream.pipe === "function") stream.pipe(res);
    else if (stream.transformToByteArray) {
      const bytes = await stream.transformToByteArray();
      res.end(Buffer.from(bytes));
    } else res.status(500).json({ message: "Cannot stream file" });
  } else {
    const obj = await r2GetWithRetry(
      () => r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey })),
      "R2 media request timed out"
    );
    if (!obj.Body) {
      res.status(404).json({ message: "File not found" });
      return;
    }
    const fullLen = Number(obj.ContentLength);
    if (Number.isFinite(fullLen) && fullLen > 0) r2HeadMetaSet(canonicalKey, fullLen, obj.ContentType);
    if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
    if (obj.ContentLength) res.setHeader("Content-Length", String(obj.ContentLength));
    res.setHeader("Accept-Ranges", "bytes");
    const isPdf = typeof obj.ContentType === "string" && /pdf/i.test(obj.ContentType);
    res.setHeader("Cache-Control", isPdf ? "private, max-age=300" : "private, no-store");
    res.setHeader("Content-Disposition", "inline");
    const stream = obj.Body;
    if (typeof stream.pipe === "function") stream.pipe(res);
    else if (stream.transformToByteArray) {
      const bytes = await stream.transformToByteArray();
      res.end(Buffer.from(bytes));
    } else res.status(500).json({ message: "Cannot stream file" });
  }
}
function registerMediaStreamRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  getR2Client
}) {
  app2.get("/api/media/:a/:b/:c", async (req, res) => {
    try {
      const key = `${req.params.a}/${req.params.b}/${req.params.c}`;
      await streamMediaGet(req, res, db2, getAuthUser2, getR2Client, key);
    } catch (err) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });
  app2.get("/api/media/:folder/:filename", async (req, res) => {
    try {
      const key = `${req.params.folder}/${req.params.filename}`;
      await streamMediaGet(req, res, db2, getAuthUser2, getR2Client, key);
    } catch (err) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });
  app2.get(/^\/api\/media\/(.+)$/, async (req, res) => {
    try {
      const key = String(req.params?.[0] || "").replace(/^\/+/, "");
      await streamMediaGet(req, res, db2, getAuthUser2, getR2Client, key);
    } catch (err) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });
}
var R2_HEAD_TIMEOUT_MS, R2_GET_TIMEOUT_MS, R2_HEAD_META_TTL_MS, R2_HEAD_META_MAX, r2HeadMetaLru;
var init_media_stream_routes = __esm({
  "server/media-stream-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_media_key_utils();
    init_async_utils();
    R2_HEAD_TIMEOUT_MS = 15e3;
    R2_GET_TIMEOUT_MS = 3e4;
    R2_HEAD_META_TTL_MS = 5 * 60 * 1e3;
    R2_HEAD_META_MAX = 400;
    r2HeadMetaLru = /* @__PURE__ */ new Map();
  }
});

// server/schema-readiness-contract.ts
var REQUIRED_TABLES, REQUIRED_COLUMNS, REQUIRED_UNIQUE_INDEX_SPECS;
var init_schema_readiness_contract = __esm({
  "server/schema-readiness-contract.ts"() {
    "use strict";
    REQUIRED_TABLES = [
      "users",
      "courses",
      "lectures",
      "enrollments",
      "tests",
      "questions",
      "test_attempts",
      "study_materials",
      "notifications",
      "live_classes",
      "download_tokens",
      "user_downloads",
      "media_tokens",
      "device_block_events",
      "live_class_viewers",
      "live_class_hand_raises",
      "support_messages",
      "admin_notifications",
      "books",
      "book_purchases",
      "book_click_tracking",
      "course_folders",
      "standalone_folders",
      "folder_purchases",
      "test_purchases",
      "site_settings",
      "question_reports",
      "user_sessions",
      "live_class_recording_progress",
      "user_push_tokens",
      "session",
      "express_rate_limit",
      "otp_challenges"
    ];
    REQUIRED_COLUMNS = {
      users: [
        "password_hash",
        "session_token",
        "app_bound_device_id",
        "web_device_id_phone",
        "web_device_id_desktop",
        "profile_complete",
        "is_blocked",
        "last_active_at",
        "otp_send_count",
        "otp_send_window_start",
        "otp_send_locked_until"
      ],
      enrollments: ["status", "valid_until"],
      live_classes: [
        "recording_url",
        "stream_type",
        "show_viewer_count",
        "notify_email",
        "notify_bell",
        "chat_mode",
        "cf_stream_uid",
        "cf_playback_hls",
        "lecture_section_title",
        "lecture_subfolder_title",
        "recording_deleted_at",
        "classroom_room_name",
        "board_snapshot_url"
      ],
      notifications: ["source", "expires_at", "is_hidden", "admin_notif_id", "image_url"],
      courses: ["subject", "cover_color", "pyq_count", "mock_count", "practice_count"],
      lectures: ["download_allowed", "section_title", "live_class_id", "live_class_finalized", "transcript"],
      study_materials: ["download_allowed", "section_title"],
      tests: ["difficulty", "scheduled_at", "price", "mini_course_id"],
      questions: ["image_url", "solution_image_url"],
      lecture_progress: ["playback_sessions", "last_session_ping_at"],
      standalone_folders: ["category", "price", "original_price", "is_free", "description", "validity_months"]
    };
    REQUIRED_UNIQUE_INDEX_SPECS = [
      { table: "enrollments", columns: ["user_id", "course_id"] },
      { table: "user_downloads", columns: ["user_id", "item_type", "item_id"] },
      { table: "user_missions", columns: ["user_id", "mission_id"] },
      { table: "payments", columns: ["razorpay_order_id"] },
      { table: "lecture_progress", columns: ["user_id", "lecture_id"] },
      { table: "live_class_viewers", columns: ["live_class_id", "user_id"] },
      { table: "live_class_hand_raises", columns: ["live_class_id", "user_id"] },
      { table: "book_purchases", columns: ["user_id", "book_id"] },
      { table: "folder_purchases", columns: ["user_id", "folder_id"] },
      { table: "test_purchases", columns: ["user_id", "test_id"] },
      { table: "question_reports", columns: ["question_id", "user_id"] },
      { table: "book_click_tracking", columns: ["user_id", "book_id"] },
      { table: "site_settings", columns: ["key"] },
      { table: "user_push_tokens", columns: ["expo_push_token"] },
      { table: "users", columns: ["phone"] },
      { table: "users", columns: ["email"] }
    ];
  }
});

// server/db-readiness.ts
function parseIndexColumns(value) {
  if (Array.isArray(value)) {
    return value.map((c) => String(c));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const inner = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
    if (!inner) return [];
    return inner.split(",").map((part) => part.replace(/^"+|"+$/g, "").trim()).filter(Boolean);
  }
  return [];
}
async function checkDatabaseReadiness(db2) {
  await db2.query("SELECT 1");
  const tableRows = await db2.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'`
  );
  const presentTables = new Set(tableRows.rows.map((row) => String(row.table_name)));
  const missingTables = REQUIRED_TABLES.filter((table) => !presentTables.has(table));
  const columnRows = await db2.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const presentColumns = /* @__PURE__ */ new Map();
  for (const row of columnRows.rows) {
    const tableName = String(row.table_name);
    const columnName = String(row.column_name);
    if (!presentColumns.has(tableName)) presentColumns.set(tableName, /* @__PURE__ */ new Set());
    presentColumns.get(tableName).add(columnName);
  }
  const missingColumns = [];
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const set = presentColumns.get(table) ?? /* @__PURE__ */ new Set();
    for (const column of columns) {
      if (!set.has(column)) {
        missingColumns.push(`${table}.${column}`);
      }
    }
  }
  const indexRows = await db2.query(
    `SELECT
       t.relname AS table_name,
       i.indisunique AS is_unique,
       ARRAY_AGG(a.attname ORDER BY k.ordinality) AS cols
     FROM pg_index i
     JOIN pg_class t ON t.oid = i.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON TRUE
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
     WHERE n.nspname = 'public'
     GROUP BY t.relname, i.indisunique, i.indexrelid`
  );
  const presentUniqueKeys = /* @__PURE__ */ new Set();
  for (const row of indexRows.rows) {
    if (!row.is_unique) continue;
    const table = String(row.table_name);
    const cols = parseIndexColumns(row.cols);
    presentUniqueKeys.add(`${table}|${cols.join(",")}`);
  }
  const missingIndexes = REQUIRED_UNIQUE_INDEX_SPECS.map((s) => `${s.table}|${s.columns.join(",")}`).filter((sig) => !presentUniqueKeys.has(sig));
  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    checks: {
      db: true,
      tables: missingTables.length === 0,
      columns: missingColumns.length === 0,
      indexes: missingIndexes.length === 0
    },
    missingTables,
    missingColumns,
    missingIndexes
  };
}
var init_db_readiness = __esm({
  "server/db-readiness.ts"() {
    "use strict";
    init_schema_readiness_contract();
  }
});

// server/routes.ts
var routes_exports = {};
__export(routes_exports, {
  registerRoutes: () => registerRoutes
});
import { createServer } from "node:http";
import { Pool as Pool2 } from "pg";
import multer from "multer";
import { createRequire as createRequire3 } from "module";
import { randomInt } from "node:crypto";
function isTransientPgError(err) {
  const message = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();
  return message.includes("connection terminated") || message.includes("connection timeout") || message.includes("getaddrinfo eai_again") || message.includes("timeout exceeded when trying to connect") || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN" || code === "ETIMEDOUT" || code === "57P01" || // admin_shutdown
  code === "57P03";
}
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
async function runInTransaction(fn) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const exec = {
        query: async (text, params) => {
          const r = await client.query(text, params);
          return { rows: r.rows };
        }
      };
      const out = await fn(exec);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
      }
      if (isTransientPgError(e) && attempt < maxAttempts) {
        console.warn("[DB] Transient transaction error, retrying", { attempt, code: e?.code, message: e?.message });
        await new Promise((resolve2) => setTimeout(resolve2, 200 * attempt));
        continue;
      }
      throw e;
    } finally {
      client.release();
    }
  }
  throw new Error("Transaction failed after retries");
}
async function dbQuery(text, params, options) {
  const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || "300");
  const shouldLogSlow = options?.logSlow !== false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await pool.query(text, params);
      const elapsedMs = Date.now() - startedAt;
      if (shouldLogSlow && elapsedMs >= slowQueryThresholdMs) {
        const compactSql = text.replace(/\s+/g, " ").trim().slice(0, 220);
        console.warn("[DB] Slow query", { elapsedMs, attempt, sql: compactSql });
      }
      return result;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const isTransient = isTransientPgError(err);
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
function generateOTP() {
  return String(randomInt(1e5, 1e6));
}
async function getAuthUser(req) {
  const r = req;
  let p = r[authUserLazyKey];
  if (!p) {
    p = (async () => {
      const user = await getAuthUserFromRequest(req, db);
      if (!user) return null;
      const boundOk = await enforceInstallationBinding(db, req, user.id, user.role);
      if (!boundOk) {
        req.session.user = null;
        return null;
      }
      return user;
    })();
    r[authUserLazyKey] = p;
  }
  return p;
}
async function sendOTPviaSMS(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.log("[SMS] No FAST2SMS_API_KEY set");
    return false;
  }
  try {
    console.log("[SMS] Sending OTP via Quick SMS route");
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
    console.log("[SMS] Quick SMS response received");
    if (data.return === true) {
      console.log("[SMS] OTP sent successfully");
      return true;
    }
    console.error("[SMS] Quick SMS failed:", data.message || "provider_error");
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[SMS] Quick SMS timeout");
    } else {
      console.error(`[SMS] Quick SMS error:`, err);
    }
  }
  try {
    console.log("[SMS] Trying OTP route as fallback");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15e3);
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(phone)}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    console.log("[SMS] OTP route response received");
    if (data.return === true) {
      console.log("[SMS] OTP route sent successfully");
      return true;
    }
    console.error("[SMS] OTP route failed:", data.message || "provider_error");
  } catch (err) {
    if (err.name === "AbortError") {
      console.error("[SMS] OTP route timeout");
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
  await recomputeAllEnrollmentsProgressForCourse(id);
}
async function updateCourseProgress(userId, courseId) {
  const cid = String(courseId);
  try {
    const totalLec = await db.query("SELECT COUNT(*) FROM lectures WHERE course_id = $1", [cid]);
    const totalTests = await db.query("SELECT COUNT(*) FROM tests WHERE course_id = $1 AND is_published = TRUE", [cid]);
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
async function recomputeAllEnrollmentsProgressForCourse(courseId) {
  const cid = String(courseId);
  try {
    await db.query(
      `UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0)) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               (100.0 * (COALESCE(cl.done_lec, 0) + COALESCE(ct.done_tests, 0)))
               / NULLIF(COALESCE(tl.total_lec, 0) + COALESCE(tt.total_tests, 0), 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_lec FROM lectures WHERE course_id = $1
         ) tl
         CROSS JOIN LATERAL (
           SELECT COUNT(*)::bigint AS total_tests FROM tests WHERE course_id = $1 AND is_published = TRUE
         ) tt
         LEFT JOIN LATERAL (
           SELECT COUNT(*)::bigint AS done_lec
           FROM lecture_progress lp
           INNER JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1
           WHERE lp.user_id = en.user_id AND lp.is_completed = TRUE
         ) cl ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT test_id)::bigint AS done_tests
           FROM test_attempts ta
           WHERE ta.user_id = en.user_id
             AND ta.status = 'completed'
             AND ta.test_id IN (SELECT id FROM tests WHERE course_id = $1)
         ) ct ON TRUE
         WHERE en.course_id::text = $1 AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
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
async function registerRoutes(app2) {
  if (process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true" || process.env.ALLOW_STARTUP_SCHEMA_ENSURE === "true") {
    console.warn(
      "[DB] Legacy startup schema flags were requested, but runtime schema mutation is now disabled. Run SQL migrations before starting the server."
    );
  }
  try {
    const readiness = await checkDatabaseReadiness(db);
    if (!readiness.ok) {
      const missingTables = new Set((readiness.missingTables || []).map((v) => String(v).toLowerCase()));
      const missingColumns = new Set((readiness.missingColumns || []).map((v) => String(v).toLowerCase()));
      const authCriticalIssues = [];
      if (missingTables.has("user_sessions")) authCriticalIssues.push("missing table: user_sessions");
      if (missingTables.has("session")) authCriticalIssues.push("missing table: session");
      if (missingTables.has("express_rate_limit")) authCriticalIssues.push("missing table: express_rate_limit");
      if (missingColumns.has("users.password_hash")) authCriticalIssues.push("missing column: users.password_hash");
      if (authCriticalIssues.length > 0) {
        console.warn("[DB] Auth-critical readiness issues detected", {
          issues: authCriticalIssues
        });
      }
    }
  } catch (err) {
    console.warn("[DB] Startup readiness preflight failed:", err);
  }
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";
  if (runBackgroundSchedulers) {
    const sentNotifications = /* @__PURE__ */ new Set();
    setInterval(async () => {
      try {
        const now = Date.now();
        const minScheduleAt = now + 29 * 60 * 1e3;
        const maxScheduleAt = now + 31 * 60 * 1e3;
        const classes = await db.query(
          `SELECT lc.id, lc.title, lc.course_id, lc.is_free_preview, lc.is_public
           FROM live_classes lc
           WHERE lc.is_completed IS NOT TRUE
             AND lc.is_live IS NOT TRUE
             AND lc.notify_bell = TRUE
             AND lc.scheduled_at IS NOT NULL
             AND lc.scheduled_at BETWEEN $1 AND $2
           ORDER BY lc.scheduled_at ASC
           LIMIT 50`,
          [minScheduleAt, maxScheduleAt]
        );
        for (const lc of classes.rows) {
          const expiresAt = now + 6 * 36e5;
          const key30 = `30min_${lc.id}`;
          if (!sentNotifications.has(key30)) {
            sentNotifications.add(key30);
            const notifTitle = "\u23F0 Live Class in 30 minutes!";
            const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;
            if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
              const inserted = await db.query(
                `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
                 SELECT u.id, $1, $2, 'info', $3, $4
                 FROM users u
                 WHERE u.role = 'student'
                 RETURNING user_id`,
                [notifTitle, notifMessage, now, expiresAt]
              );
              await sendPushToUsers(
                db,
                inserted.rows.map((r) => Number(r.user_id)),
                {
                  title: notifTitle,
                  body: notifMessage,
                  data: { type: "live_class_reminder", liveClassId: lc.id }
                }
              );
              console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
            } else {
              const inserted = await db.query(
                `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
                 SELECT e.user_id, $1, $2, 'info', $3, $4
                 FROM enrollments e
                 WHERE e.course_id = $5
                 RETURNING user_id`,
                [notifTitle, notifMessage, now, expiresAt, lc.course_id]
              );
              await sendPushToUsers(
                db,
                inserted.rows.map((r) => Number(r.user_id)),
                {
                  title: notifTitle,
                  body: notifMessage,
                  data: { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id }
                }
              );
              console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${inserted.rows.length}`);
            }
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
          `DELETE FROM download_tokens
           WHERE id IN (
             SELECT id
             FROM download_tokens
             WHERE expires_at < $1 AND used = TRUE
             ORDER BY expires_at ASC
             LIMIT 2000
           )`,
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
  } else {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
  }
  app2.get("/api/health/ready", async (_req, res) => {
    try {
      const readiness = await checkDatabaseReadiness(db);
      if (!readiness.ok) {
        return res.status(503).json({
          ok: false,
          message: "Database schema is not fully migrated",
          checks: readiness.checks,
          missingTables: readiness.missingTables,
          missingColumns: readiness.missingColumns,
          missingIndexes: readiness.missingIndexes
        });
      }
      return res.json({
        ok: true,
        checks: readiness.checks
      });
    } catch (err) {
      return res.status(503).json({ ok: false, message: err?.message || "DB not ready" });
    }
  });
  async function requireAuth(req, res, next) {
    const user = await getAuthUser(req);
    if (!user) {
      return res.status(401).json({ message: "Login required" });
    }
    req.user = user;
    next();
  }
  registerSupportRoutes({
    app: app2,
    db,
    pool,
    listenPool,
    getAuthUser,
    requireAuth,
    requireAdmin
  });
  app2.use("/api", async (req, res, next) => {
    try {
      const authUser = await getAuthUser(req);
      const userId = authUser?.id || null;
      if (userId && userId > 0) {
        const now = Date.now();
        db.query(
          "UPDATE users SET last_active_at = $1 WHERE id = $2 AND (last_active_at IS NULL OR last_active_at < $3)",
          [now, userId, now - 5 * 60 * 1e3],
          { logSlow: false }
        ).catch(() => {
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
    runInTransaction
  });
  registerPaymentRoutes({
    app: app2,
    db,
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature,
    runInTransaction
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
    getAuthUser,
    getRazorpay,
    verifyPaymentSignature
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
    requireAdmin,
    generateAIAnswer
  });
  app2.post("/api/push/register", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const token = String(req.body?.token || "").trim();
      const platform = String(req.body?.platform || "").trim().toLowerCase();
      if (!token || !token.startsWith("ExponentPushToken[")) {
        return res.status(400).json({ message: "Valid Expo push token is required" });
      }
      await registerPushToken(db, Number(user.id), token, platform || "unknown");
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] register error:", err);
      return res.status(500).json({ message: "Failed to register push token" });
    }
  });
  app2.post("/api/push/unregister", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const token = String(req.body?.token || "").trim();
      if (!token) return res.status(400).json({ message: "Token is required" });
      await unregisterPushToken(db, Number(user.id), token);
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] unregister error:", err);
      return res.status(500).json({ message: "Failed to unregister push token" });
    }
  });
  app2.post("/api/push/unregister-all", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      await unregisterAllPushTokens(db, Number(user.id));
      return res.json({ success: true });
    } catch (err) {
      console.error("[Push] unregister-all error:", err);
      return res.status(500).json({ message: "Failed to unregister push tokens" });
    }
  });
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
  app2.get("/api/admin/push-tokens", requireAdmin, async (req, res) => {
    try {
      const userIdRaw = String(req.query.userId || "").trim();
      const activeOnlyRaw = String(req.query.activeOnly || "true").trim().toLowerCase();
      const activeOnly = activeOnlyRaw !== "false";
      if (userIdRaw) {
        const userId = Number(userIdRaw);
        if (!Number.isFinite(userId) || userId <= 0) {
          return res.status(400).json({ message: "Invalid userId" });
        }
        const detail = await db.query(
          `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.expo_push_token, t.platform, t.is_active, t.created_at, t.last_seen_at
           FROM user_push_tokens t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.user_id = $1
           ${activeOnly ? "AND t.is_active = TRUE" : ""}
           ORDER BY t.last_seen_at DESC`,
          [userId]
        );
        return res.json({
          summary: {
            userId,
            total: detail.rows.length,
            active: detail.rows.filter((r) => r.is_active === true).length
          },
          tokens: detail.rows
        });
      }
      const summary = await db.query(
        `SELECT
           COUNT(*)::int AS total_tokens,
           COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_tokens,
           COUNT(DISTINCT user_id)::int AS total_users,
           COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_tokens
         FROM user_push_tokens`
      );
      const recent = await db.query(
        `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.platform, t.is_active, t.last_seen_at
         FROM user_push_tokens t
         LEFT JOIN users u ON u.id = t.user_id
         ${activeOnly ? "WHERE t.is_active = TRUE" : ""}
         ORDER BY t.last_seen_at DESC
         LIMIT 200`
      );
      return res.json({
        summary: summary.rows[0] || {
          total_tokens: 0,
          active_tokens: 0,
          total_users: 0,
          users_with_active_tokens: 0
        },
        recentTokens: recent.rows
      });
    } catch (err) {
      console.error("[Push Debug] failed:", err);
      return res.status(500).json({ message: "Failed to fetch push token stats" });
    }
  });
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
    getR2Client,
    recomputeAllEnrollmentsProgressForCourse
  });
  registerCourseAccessRoutes({
    app: app2,
    db,
    getAuthUser,
    generateSecureToken,
    getR2Client,
    updateCourseProgress
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
    requireAdmin
  });
  registerAdminCourseImportRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts,
    recomputeAllEnrollmentsProgressForCourse
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
    deleteDownloadsForUser,
    deleteDownloadsForCourse,
    runInTransaction
  });
  registerAdminLectureRoutes({
    app: app2,
    db,
    requireAdmin,
    getR2Client,
    recomputeAllEnrollmentsProgressForCourse
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
    upload: uploadPdf,
    PDFParse
  });
  registerAdminUsersAndContentRoutes({
    app: app2,
    db,
    requireAdmin,
    deleteDownloadsForUser,
    runInTransaction,
    recomputeAllEnrollmentsProgressForCourse
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
    listenPool,
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
    requireAdmin,
    recomputeAllEnrollmentsProgressForCourse,
    getR2Client
  });
  registerClassroomRoutes({
    app: app2,
    db,
    requireAuth,
    requireAdmin,
    getAuthUser
  });
  registerPdfRoutes({ app: app2, db, getAuthUser, getR2Client });
  const httpServer = createServer(app2);
  attachClassroomSyncServer(httpServer, db);
  return httpServer;
}
var require4, PDFParse, upload, uploadPdf, uploadLarge, databaseUrlRaw, databaseUrl, pgPoolMax, pool, listenPool, db, generateAIAnswer, authUserLazyKey;
var init_routes = __esm({
  "server/routes.ts"() {
    "use strict";
    init_firebase();
    init_razorpay();
    init_security_utils();
    init_auth_utils();
    init_native_device_binding();
    init_auth_routes();
    init_pdf_routes();
    init_payment_routes();
    init_support_routes();
    init_live_chat_routes();
    init_listen_pool();
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
    init_classroom_routes();
    init_classroom_sync();
    init_course_access_routes();
    init_upload_routes();
    init_media_stream_routes();
    init_ai_tutor_service();
    init_db_readiness();
    init_push_notifications();
    require4 = createRequire3(import.meta.url);
    ({ PDFParse } = require4("pdf-parse"));
    upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
    uploadPdf = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const mimetype = String(file?.mimetype || "").toLowerCase();
        if (mimetype === "application/pdf") return cb(null, true);
        return cb(new Error("Only PDF files are allowed"));
      }
    });
    uploadLarge = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
    databaseUrlRaw = process.env.DATABASE_URL;
    databaseUrl = databaseUrlRaw ? normalizeDatabaseUrl(databaseUrlRaw) : void 0;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL must be set");
    }
    pgPoolMax = Math.min(50, Math.max(1, parseInt(process.env.PG_POOL_MAX || "10", 10) || 10));
    pool = new Pool2({
      connectionString: databaseUrl,
      ssl: process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
      max: pgPoolMax,
      min: 1,
      connectionTimeoutMillis: 1e4,
      idleTimeoutMillis: 1e4,
      // release idle connections quickly (Neon closes them anyway)
      statement_timeout: 25e3
    });
    console.log("[DB] Main pool configured", {
      max: pgPoolMax,
      nodeEnv: process.env.NODE_ENV || "development",
      sslNoVerify: process.env.PGSSL_NO_VERIFY === "true"
    });
    pool.on("error", (err) => {
      console.error("[Pool] Idle client error (connection dropped by Neon):", err.message);
    });
    listenPool = createListenPool(databaseUrl);
    console.log("[DB] Listen pool configured", {
      max: Math.min(
        40,
        Math.max(
          2,
          parseInt(
            process.env.PG_LISTEN_POOL_MAX || (process.env.NODE_ENV === "production" ? "12" : "20"),
            10
          ) || (process.env.NODE_ENV === "production" ? 12 : 20)
        )
      ),
      sseCap: Math.max(10, parseInt(process.env.PG_LISTEN_SSE_MAX_CONCURRENT || "100", 10) || 100)
    });
    listenPool.on("error", (err) => {
      console.error("[ListenPool] Idle client error:", err.message);
    });
    db = {
      query: (text, params, options) => dbQuery(text, params, options)
    };
    generateAIAnswer = createGenerateAIAnswer(db);
    authUserLazyKey = /* @__PURE__ */ Symbol("authUserLazy");
  }
});

// server/index.ts
init_pg_rate_limit_store();
init_ai_tutor_service();
import dotenv from "dotenv";
import * as path from "path";
import express from "express";
import * as Sentry from "@sentry/node";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import * as fs from "fs";
import pg from "pg";
import cors from "cors";
var envPath = path.resolve(process.cwd(), ".env");
if (process.env.NODE_ENV !== "production" || process.env.LOAD_DOTENV === "true") {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}
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
function normalizeOrigin(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, "").toLowerCase();
  }
}
function originMatchesPattern(origin, pattern) {
  if (!pattern.includes("*")) return origin === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(origin);
}
function isPrivateLocalOrigin(origin) {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname;
    const isLocalhost = host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
    if (isLocalhost) return true;
    const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  } catch {
    return false;
  }
}
function getAllowedOriginPatterns() {
  const defaultAllowedOrigins = [
    "https://3ilearning.in",
    "https://www.3ilearning.in",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
    "https://api.razorpay.com",
    "https://checkout.razorpay.com"
  ];
  const envOrigins = (process.env.CORS_ORIGINS || "").split(",").map((s) => normalizeOrigin(s)).filter(Boolean);
  return [...defaultAllowedOrigins.map((origin) => normalizeOrigin(origin)), ...envOrigins];
}
function getInboundHostname(req) {
  const xf = (req.get("x-forwarded-host") || "").split(",")[0].trim();
  if (xf) return xf.replace(/:\d+$/, "").toLowerCase();
  try {
    const h = typeof req.hostname === "string" ? req.hostname : "";
    if (h) return h.replace(/:\d+$/, "").toLowerCase();
  } catch {
  }
  const host = (req.get("host") || "").trim();
  return host.replace(/:\d+$/, "").toLowerCase();
}
function isTrustedOrigin(origin) {
  if (!origin) return false;
  const normalizedOrigin = normalizeOrigin(origin);
  if (process.env.NODE_ENV !== "production" && isPrivateLocalOrigin(normalizedOrigin)) {
    return true;
  }
  return getAllowedOriginPatterns().some((pattern) => originMatchesPattern(normalizedOrigin, pattern));
}
function setupCors(app2) {
  const allowedOriginPatterns = getAllowedOriginPatterns();
  const corsOptions = {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (process.env.NODE_ENV !== "production" && isPrivateLocalOrigin(normalizedOrigin)) {
        return callback(null, true);
      }
      if (allowedOriginPatterns.some((pattern) => originMatchesPattern(normalizedOrigin, pattern))) {
        return callback(null, true);
      }
      console.warn(`[CORS] blocked origin: ${origin}`);
      return callback(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-User-Id",
      "X-App-Device-Id",
      "X-Client-Platform",
      "X-Web-Form-Factor"
    ],
    credentials: true,
    exposedHeaders: ["Content-Length", "Content-Type", "Content-Disposition"],
    preflightContinue: false,
    optionsSuccessStatus: 204
  };
  app2.use(cors(corsOptions));
}
function setupApiOriginProtection(app2) {
  app2.use("/api", (req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    const hasBearer = typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ");
    const hasCookie = typeof req.headers.cookie === "string" && req.headers.cookie.length > 0;
    if (!hasCookie || hasBearer) return next();
    const origin = req.get("origin");
    const referer = req.get("referer");
    const clientPlatform = (req.get("x-client-platform") || "").trim().toLowerCase();
    const hasNativeAppHeader = clientPlatform === "android" || clientPlatform === "ios";
    const trustedOrigin = origin ? isTrustedOrigin(origin) : false;
    const trustedReferer = referer ? isTrustedOrigin(referer) : false;
    const missingBrowserHeaders = !origin && !referer;
    if (trustedOrigin || trustedReferer) return next();
    if (hasNativeAppHeader && missingBrowserHeaders) return next();
    return res.status(403).json({ message: "Cross-site request blocked" });
  });
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
function logProductionReleaseHints() {
  if (process.env.NODE_ENV !== "production") return;
  const schedulerRole = process.env.RUN_BACKGROUND_SCHEDULERS === "false" ? "api-only" : "scheduler-enabled";
  log(
    `[startup] production mode | scheduler_role=${schedulerRole} | health=/api/health/version,/api/health/ready,/api/health/ai-providers`
  );
  if (process.env.ALLOW_RUNTIME_SCHEMA_SYNC === "true" || process.env.ALLOW_STARTUP_SCHEMA_ENSURE === "true") {
    console.warn(
      "[startup] production should rely on migrations only; disable ALLOW_RUNTIME_SCHEMA_SYNC and ALLOW_STARTUP_SCHEMA_ENSURE"
    );
  }
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
  const apiNoMarketingHosts = getApiNoindexHosts();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const host = getInboundHostname(req);
    if (!apiNoMarketingHosts.has(host)) return next();
    const p = req.path || "";
    if (p.startsWith("/api") || p === "/manifest" || p.startsWith("/firebase-phone-auth") || p.startsWith("/_expo") || p.startsWith("/assets") || p.includes(".") && /\.[a-z0-9]+$/i.test(p)) {
      return next();
    }
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.setHeader("Cache-Control", "no-store");
    const body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="robots" content="noindex,nofollow,noarchive"/><title>API</title></head><body><p>This host serves the application API only.</p><p>Visit <a href="https://www.3ilearning.in">3i Learning</a> in your browser.</p></body></html>`;
    return res.status(200).type("html").send(body);
  });
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
  const staticAssetOptions = {
    setHeaders: (res, filePath) => {
      const normalized = filePath.replace(/\\/g, "/");
      const isHtml = normalized.endsWith(".html");
      const isVersionedBundle = normalized.includes("/static-build/") || normalized.includes("/_expo/static/") || normalized.includes("/assets/");
      if (isHtml) {
        res.setHeader("Cache-Control", "no-store");
      } else if (isVersionedBundle) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    }
  };
  app2.use(express.static(path.resolve(process.cwd(), "static-build", "web"), staticAssetOptions));
  app2.use("/assets", express.static(path.resolve(process.cwd(), "assets"), staticAssetOptions));
  app2.use(express.static(path.resolve(process.cwd(), "static-build"), staticAssetOptions));
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
function getApiNoindexHosts() {
  return new Set(
    (process.env.SEARCH_NOINDEX_HOSTNAMES || "api.3ilearning.in").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean)
  );
}
function setupApiHostSearchHints(app2) {
  const noindexHosts = getApiNoindexHosts();
  app2.use((req, res, next) => {
    const host = getInboundHostname(req);
    if (noindexHosts.has(host)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    }
    next();
  });
  app2.get("/robots.txt", (req, res, next) => {
    const host = getInboundHostname(req);
    if (noindexHosts.has(host)) {
      res.type("text/plain");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send("User-agent: *\nDisallow: /\n");
    }
    next();
  });
}
function setupErrorHandler(app2) {
  app2.use((err, req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = status >= 500 && process.env.NODE_ENV === "production" ? "Internal Server Error" : error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    const origin = req.get("origin");
    if (origin && isTrustedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    return res.status(status).json({ message });
  });
}
function normalizeOtpIdentifier(input) {
  const raw = String(input || "").trim().toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return `phone:${digits.slice(-10)}`;
  return `id:${raw || "global"}`;
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
      const frameAncestors = (process.env.FRAME_ANCESTORS || "https://3ilearning.in https://www.3ilearning.in").trim().replace(/\s+/g, " ");
      res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors}`);
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
  const sessionCookieDomain = (process.env.SESSION_COOKIE_DOMAIN || "").trim() || void 0;
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
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1e3,
      ...isProduction && sessionCookieDomain ? { domain: sessionCookieDomain } : {}
    }
  };
  if (isProduction && process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionConfig.store = new PgSession({
      conString: normalizeDatabaseUrl2(process.env.DATABASE_URL),
      tableName: "session",
      // Table is created by migrations/0011_distributed_rate_limits_and_session.sql
      createTableIfMissing: false
    });
    const sessionStoreWithEvents = sessionConfig.store;
    sessionStoreWithEvents.on?.("error", (err) => {
      console.error("[SessionStore] error:", err);
    });
  }
  app.use(session(sessionConfig));
  setupApiOriginProtection(app);
  setupApiHostSearchHints(app);
  app.get("/api/health/version", (_req, res) => {
    res.json(getBackendVersion());
  });
  app.get("/api/health/ai-providers", (_req, res) => {
    res.json({ ok: true, ...getAiTutorHealthSnapshot() });
  });
  const rateLimitPgSsl = process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
  const rateLimitPool = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0 ? new pg.Pool({
    connectionString: normalizeDatabaseUrl2(process.env.DATABASE_URL),
    max: 5,
    min: 0,
    connectionTimeoutMillis: 8e3,
    ssl: rateLimitPgSsl
  }) : null;
  if (rateLimitPool) {
    console.log("[DB] Rate-limit pool configured", {
      max: 5,
      nodeEnv: process.env.NODE_ENV || "development",
      sslNoVerify: process.env.PGSSL_NO_VERIFY === "true"
    });
    rateLimitPool.on("error", (err) => {
      console.error("[RateLimitPool] idle client error:", err.message);
    });
  }
  const otpSendStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : void 0;
  const otpVerifyStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : void 0;
  const globalApiStore = rateLimitPool ? new PgRateLimitStore(rateLimitPool) : void 0;
  const otpSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 20,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return `${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(req.body?.identifier)}`;
    },
    ...otpSendStore ? { store: otpSendStore } : {}
  });
  const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 30,
    message: { message: "Too many requests, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return `${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(req.body?.identifier)}`;
    },
    ...otpVerifyStore ? { store: otpVerifyStore } : {}
  });
  app.use("/api/auth/send-otp", otpSendLimiter);
  app.use("/api/auth/verify-otp", otpVerifyLimiter);
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 600,
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/send-otp") || req.path.startsWith("/api/auth/verify-otp"),
    ...globalApiStore ? { store: globalApiStore } : {}
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
  Sentry.setupExpressErrorHandler(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  logProductionReleaseHints();
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
