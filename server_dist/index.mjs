var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// backend/pg-rate-limit-store.ts
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
  "backend/pg-rate-limit-store.ts"() {
    "use strict";
    PgRateLimitStore = class {
      constructor(pool2, options = {}) {
        this.pool = pool2;
        this.options = options;
      }
      pool;
      options;
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
          if (this.options.failClosed) {
            return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(Date.now() + this.windowMs) };
          }
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
          if (this.options.failClosed) {
            return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now + win) };
          }
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

// backend/redis-client.ts
import { createClient } from "redis";
function redisUrl() {
  const raw = process.env.REDIS_URL?.trim();
  return raw && raw.length > 0 ? raw : null;
}
async function getRedisClient() {
  const url = redisUrl();
  if (!url) {
    if (!fallbackWarningLogged) {
      fallbackWarningLogged = true;
      console.warn(
        "[Redis] REDIS_URL not set \u2014 rate limiting and notification dedup are using PostgreSQL fallback. This increases DB write load under traffic. Set REDIS_URL in .env to resolve."
      );
    }
    return null;
  }
  if (client?.isOpen) return client;
  if (!connectPromise) {
    connectPromise = (async () => {
      try {
        const next = createClient({ url });
        next.on("error", (err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[Redis] client error:", message);
        });
        await next.connect();
        client = next;
        if (fallbackWarningLogged) {
          console.log("[Redis] reconnected \u2014 resuming Redis-backed rate limiting and dedup");
          fallbackWarningLogged = false;
        } else {
          console.log("[Redis] connected");
        }
        return next;
      } catch (err) {
        console.error("[Redis] connect failed \u2014 falling back to PostgreSQL for rate limiting and dedup:", err);
        if (!fallbackWarningLogged) {
          fallbackWarningLogged = true;
          console.warn(
            "[Redis] FALLBACK ACTIVE \u2014 all Redis-dependent features (rate limits, OTP dedup, notification dedup) are now using PostgreSQL. Check REDIS_URL and Upstash connectivity."
          );
        }
        client = null;
        return null;
      } finally {
        connectPromise = null;
      }
    })();
  }
  return connectPromise;
}
var client, connectPromise, fallbackWarningLogged;
var init_redis_client = __esm({
  "backend/redis-client.ts"() {
    "use strict";
    client = null;
    connectPromise = null;
    fallbackWarningLogged = false;
  }
});

// backend/redis-rate-limit-store.ts
async function checkDownloadUrlRateLimitRedis(redis, userId, windowMs, max) {
  try {
    const key = `download_url:user:${userId}`;
    const bucket = `ratelimit:${key}`;
    const now = Date.now();
    const script = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local existingReset = tonumber(redis.call('HGET', key, 'resetTimeMs') or '0')
local existingHits = tonumber(redis.call('HGET', key, 'totalHits') or '0')
local resetMs = existingReset
local totalHits = existingHits

if existingReset == 0 or existingReset <= nowMs then
  totalHits = 1
  resetMs = nowMs + windowMs
else
  totalHits = existingHits + 1
end

local ttlMs = resetMs - nowMs
if ttlMs < 1000 then ttlMs = 1000 end
redis.call('HSET', key, 'totalHits', tostring(totalHits), 'resetTimeMs', tostring(resetMs))
redis.call('PEXPIRE', key, ttlMs)
return { tostring(totalHits), tostring(resetMs) }
`;
    const out = await redis.eval(script, {
      keys: [bucket],
      arguments: [String(now), String(windowMs)]
    });
    const totalHits = Number(out?.[0] || 1);
    return totalHits <= max;
  } catch (err) {
    console.error("[Redis] download-url rate limit failed:", err);
    return null;
  }
}
var RedisRateLimitStore;
var init_redis_rate_limit_store = __esm({
  "backend/redis-rate-limit-store.ts"() {
    "use strict";
    RedisRateLimitStore = class {
      constructor(redis, bucketPrefix = "default", options = {}) {
        this.redis = redis;
        this.bucketPrefix = bucketPrefix;
        this.options = options;
      }
      redis;
      bucketPrefix;
      options;
      windowMs = 6e4;
      localKeys = false;
      init(options) {
        this.windowMs = options.windowMs;
      }
      bucketKey(key) {
        return `ratelimit:${this.bucketPrefix}:${key}`;
      }
      atomicIncrementScript = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local existingReset = tonumber(redis.call('HGET', key, 'resetTimeMs') or '0')
local existingHits = tonumber(redis.call('HGET', key, 'totalHits') or '0')
local resetMs = existingReset
local totalHits = existingHits

if existingReset == 0 or existingReset <= nowMs then
  totalHits = 1
  resetMs = nowMs + windowMs
else
  totalHits = existingHits + 1
end

local ttlMs = resetMs - nowMs
if ttlMs < 1000 then ttlMs = 1000 end
redis.call('HSET', key, 'totalHits', tostring(totalHits), 'resetTimeMs', tostring(resetMs))
redis.call('PEXPIRE', key, ttlMs)
return { tostring(totalHits), tostring(resetMs) }
`;
      async get(key) {
        try {
          const raw = await this.redis.hGetAll(this.bucketKey(key));
          if (!raw.totalHits) return void 0;
          return {
            totalHits: Number(raw.totalHits),
            resetTime: new Date(Number(raw.resetTimeMs))
          };
        } catch (err) {
          console.error("[RedisRateLimitStore] get failed:", err);
          if (this.options.failClosed) {
            return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(Date.now() + this.windowMs) };
          }
          return void 0;
        }
      }
      async increment(key) {
        const now = Date.now();
        const win = this.windowMs;
        const bucket = this.bucketKey(key);
        try {
          const out = await this.redis.eval(this.atomicIncrementScript, {
            keys: [bucket],
            arguments: [String(now), String(win)]
          });
          const totalHits = Number(out?.[0] || 1);
          const nextReset = Number(out?.[1] || now + win);
          return { totalHits, resetTime: new Date(nextReset) };
        } catch (err) {
          console.error("[RedisRateLimitStore] increment failed:", err);
          if (this.options.failClosed) {
            return { totalHits: Number.MAX_SAFE_INTEGER, resetTime: new Date(now + win) };
          }
          return { totalHits: 1, resetTime: new Date(now + win) };
        }
      }
      async decrement(key) {
        try {
          const bucket = this.bucketKey(key);
          const raw = await this.redis.hGetAll(bucket);
          if (raw?.totalHits) {
            const next = Math.max(0, Number(raw.totalHits) - 1);
            const resetMs = raw.resetTimeMs ? Number(raw.resetTimeMs) : Date.now() + this.windowMs;
            const ttlMs = Math.max(1e3, resetMs - Date.now());
            await this.redis.multi().hSet(bucket, "totalHits", String(next)).pExpire(bucket, ttlMs).exec();
          }
        } catch (err) {
          console.error("[RedisRateLimitStore] decrement failed:", err);
        }
      }
      async resetKey(key) {
        try {
          await this.redis.del(this.bucketKey(key));
        } catch (err) {
          console.error("[RedisRateLimitStore] resetKey failed:", err);
        }
      }
      async resetAll() {
        try {
          const pattern = `ratelimit:${this.bucketPrefix}:*`;
          let cursor = "0";
          do {
            const scan = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 200 });
            cursor = String(scan.cursor);
            const keys = scan.keys || [];
            if (keys.length) await this.redis.del(keys);
          } while (cursor !== "0");
        } catch (err) {
          console.error("[RedisRateLimitStore] resetAll failed:", err);
        }
      }
      shutdown() {
      }
    };
  }
});

// backend/ai-tutor-service.ts
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
    const BLOCKED_PATTERNS = [
      /\b(suicide|self.harm|self harm|kill (your|my)self)\b/i,
      /\b(make|build|create|synthesize).{0,30}(bomb|explosive|weapon|poison|drug)\b/i,
      /\b(porn|pornograph|nude|naked|sex video)\b/i,
      /\b(hack|crack|exploit|phish).{0,20}(password|account|system|server)\b/i
    ];
    const rawInput = `${q} ${t}`;
    if (BLOCKED_PATTERNS.some((re) => re.test(rawInput))) {
      console.warn(`[AI Tutor] Blocked input from userId=${userId ?? "anon"} (content guard)`);
      return "I can only help with academic study questions. Please ask something related to your course material.";
    }
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
  "backend/ai-tutor-service.ts"() {
    "use strict";
    TRANSCRIPT_CONTEXT_CHARS = 8e3;
  }
});

// backend/db-utils.ts
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
var init_db_utils = __esm({
  "backend/db-utils.ts"() {
    "use strict";
  }
});

// backend/feature-flags.ts
function parseBoolean(input) {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input === 1 ? true : input === 0 ? false : null;
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}
function getEnvFlag(name, fallback = false) {
  const parsed = parseBoolean(process.env[name]);
  return parsed == null ? fallback : parsed;
}
function listDefaultFlags() {
  return { ...DEFAULT_FLAGS };
}
var DEFAULT_FLAGS;
var init_feature_flags = __esm({
  "backend/feature-flags.ts"() {
    "use strict";
    DEFAULT_FLAGS = {
      fail_closed_auth_rate_limit: true,
      fail_closed_media_rate_limit: true,
      enable_cloudflare_stream_webhooks: false,
      enable_runtime_flags_api: true
    };
  }
});

// backend/observability.ts
function getBucket(key) {
  let b = routeMetrics.get(key);
  if (!b) {
    b = { count: 0, errorCount: 0, totalLatencyMs: 0 };
    routeMetrics.set(key, b);
  }
  return b;
}
function metricsMiddleware(req, res, next) {
  const capturedPath = req.path;
  const start = Date.now();
  res.on("finish", () => {
    const routePattern = req.route?.path;
    const key = `${req.method} ${routePattern || capturedPath}`;
    const b = getBucket(key);
    b.count += 1;
    b.totalLatencyMs += Date.now() - start;
    if (res.statusCode >= 500) b.errorCount += 1;
  });
  next();
}
function getMetricsSnapshot() {
  const routes = [];
  for (const [key, b] of routeMetrics) {
    routes.push({
      key,
      count: b.count,
      errorRate: b.count > 0 ? b.errorCount / b.count : 0,
      avgLatencyMs: b.count > 0 ? Math.round(b.totalLatencyMs / b.count) : 0
    });
  }
  return {
    collectedAt: Date.now(),
    routes: routes.sort((a, b) => b.count - a.count).slice(0, 300),
    counters: Object.fromEntries(counters.entries()),
    gauges: Object.fromEntries(gauges.entries())
  };
}
function incrementCounter(name, by = 1) {
  counters.set(name, (counters.get(name) || 0) + by);
}
function setGauge(name, value) {
  gauges.set(name, value);
}
var routeMetrics, counters, gauges;
var init_observability = __esm({
  "backend/observability.ts"() {
    "use strict";
    routeMetrics = /* @__PURE__ */ new Map();
    counters = /* @__PURE__ */ new Map();
    gauges = /* @__PURE__ */ new Map();
  }
});

// backend/upload-config.ts
import multer from "multer";
var upload, uploadPdf;
var init_upload_config = __esm({
  "backend/upload-config.ts"() {
    "use strict";
    upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }
    });
    uploadPdf = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const mimetype = String(file?.mimetype || "").toLowerCase();
        if (mimetype === "application/pdf") return cb(null, true);
        return cb(new Error("Only PDF files are allowed"));
      }
    });
  }
});

// backend/firebase.ts
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
  "backend/firebase.ts"() {
    "use strict";
    firebaseApp = null;
  }
});

// backend/razorpay.ts
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
  "backend/razorpay.ts"() {
    "use strict";
    require2 = createRequire(import.meta.url);
    Razorpay = require2("razorpay");
  }
});

// backend/security-utils.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
function generateSecureToken(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}
function hashOtpValue(otp) {
  const secret = process.env.OTP_HMAC_SECRET?.trim();
  if (!secret) {
    throw new Error("OTP_HMAC_SECRET must be set");
  }
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
    return false;
  }
  return false;
}
var init_security_utils = __esm({
  "backend/security-utils.ts"() {
    "use strict";
  }
});

// backend/staff-permissions.ts
function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}
function getDefaultPermissionsForRole(role) {
  if (role === "manager") {
    return {
      ...TEACHER_DEFAULTS,
      "analytics.view": true,
      "users.manage": false
    };
  }
  return { ...TEACHER_DEFAULTS };
}
function mergePermissionOverrides(role, overrides) {
  const base = getDefaultPermissionsForRole(role);
  for (const o of overrides) {
    const key = o.permission_key;
    if (key in base) base[key] = o.allowed;
  }
  return base;
}
var STAFF_PERMISSION_KEYS, TEACHER_DEFAULTS, STAFF_ROLES;
var init_staff_permissions = __esm({
  "backend/staff-permissions.ts"() {
    "use strict";
    STAFF_PERMISSION_KEYS = [
      "live.schedule",
      "live.start",
      "live.start_web_only",
      "tests.create",
      "tests.edit",
      "tests.delete",
      "materials.course.create",
      "materials.course.edit",
      "materials.course.delete",
      "materials.free.create",
      "materials.free.edit",
      "materials.free.delete",
      "materials.youtube",
      "folders.create",
      "folders.delete",
      "missions.create",
      "missions.edit",
      "missions.delete",
      "lectures.upload_recording",
      "course.settings.edit",
      "analytics.view",
      "users.manage"
    ];
    TEACHER_DEFAULTS = {
      "live.schedule": true,
      "live.start": true,
      "live.start_web_only": true,
      "tests.create": true,
      "tests.edit": true,
      "tests.delete": false,
      "materials.course.create": true,
      "materials.course.edit": true,
      "materials.course.delete": false,
      "materials.free.create": true,
      "materials.free.edit": true,
      "materials.free.delete": true,
      "materials.youtube": false,
      "folders.create": true,
      "folders.delete": false,
      "missions.create": true,
      "missions.edit": true,
      "missions.delete": false,
      "lectures.upload_recording": false,
      "course.settings.edit": false,
      "analytics.view": false,
      "users.manage": false
    };
    STAFF_ROLES = ["teacher", "manager"];
  }
});

// backend/session-policy.ts
function getClientPlatform(req) {
  const p = (req.get("x-client-platform") || "").trim().toLowerCase();
  if (p === "ios" || p === "android" || p === "web") return p;
  return null;
}
function getInstallationIdFromRequest(req) {
  const raw = (req.get("x-app-device-id") || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return raw;
}
function usesStaffDualSession(role) {
  return isStaffRole(String(role || ""));
}
function getWebFormFactor(req) {
  const header = (req.get("x-client-form-factor") || "").trim().toLowerCase();
  if (header === "phone" || header === "desktop") return header;
  const ua = (req.get("user-agent") || "").toLowerCase();
  if (/iphone|ipod|android.+mobile|mobile/.test(ua)) return "phone";
  return "desktop";
}
function getRegistrationSlot(req) {
  const plat = getClientPlatform(req);
  if (plat === "ios" || plat === "android") return "app_bound";
  if (plat === "web") {
    return getWebFormFactor(req) === "phone" ? "web_phone" : "web_desktop";
  }
  return null;
}
function trimId(value) {
  return String(value ?? "").trim();
}
function countRegisteredDevices(row) {
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);
  if (appb) {
    return 1 + (phone || desktop ? 1 : 0);
  }
  return (phone ? 1 : 0) + (desktop ? 1 : 0);
}
function getRegisteredInstallationIds(row) {
  const ids = [];
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);
  if (appb) ids.push(appb);
  if (phone) ids.push(phone);
  if (desktop) ids.push(desktop);
  return ids;
}
function isInstallationRegistered(row, installationId) {
  const cand = trimId(installationId);
  if (!cand || cand === "web_anon") return false;
  return getRegisteredInstallationIds(row).includes(cand);
}
function canRegisterNewDevice(row, slot) {
  const appb = trimId(row.app_bound_device_id);
  const phone = trimId(row.web_device_id_phone);
  const desktop = trimId(row.web_device_id_desktop);
  if (countRegisteredDevices(row) >= 2) return false;
  if (slot === "web_phone" && appb) return false;
  if (appb && (slot === "web_phone" || slot === "web_desktop")) {
    if (phone || desktop) return false;
  }
  return true;
}
function studentIsWebOnly(row) {
  return !trimId(row.app_bound_device_id);
}
function getAttemptedInstallationId(req, bodyDeviceId) {
  const header = getInstallationIdFromRequest(req);
  const bodyId = bodyDeviceId && String(bodyDeviceId).trim() || "";
  return header || bodyId || null;
}
var init_session_policy = __esm({
  "backend/session-policy.ts"() {
    "use strict";
    init_staff_permissions();
  }
});

// backend/native-device-binding.ts
function envFlagEnabled(name) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
function isStudentDeviceBindingDisabled(role) {
  return String(role || "").trim().toLowerCase() !== "admin" && envFlagEnabled("DISABLE_STUDENT_DEVICE_BINDING");
}
function getInstallationIdFromRequest2(req) {
  const raw = (req.get("x-app-device-id") || "").trim();
  if (!raw || raw === "null" || raw === "undefined") return null;
  return raw;
}
function getClientPlatform2(req) {
  const p = (req.get("x-client-platform") || "").trim().toLowerCase();
  if (p === "ios" || p === "android" || p === "web") return p;
  return null;
}
function getActiveSessionPlatformFamily(req) {
  const plat = getClientPlatform2(req);
  if (plat === "web") return "web";
  if (plat === "ios" || plat === "android") return "mobile";
  return null;
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
    platform: getClientPlatform2(req) ?? void 0,
    reason
  });
}
function studentDeviceRowFromDb(row) {
  return {
    app_bound_device_id: row.app_bound_device_id,
    web_device_id_phone: row.web_device_id_phone,
    web_device_id_desktop: row.web_device_id_desktop
  };
}
async function loadStudentDeviceRow(db2, userId) {
  const r = await db2.query(
    `SELECT app_bound_device_id, web_device_id_phone, web_device_id_desktop
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return null;
  return studentDeviceRowFromDb(r.rows[0]);
}
async function bindStudentDeviceOnLogin(db2, userId, req) {
  const plat = getClientPlatform2(req);
  const inst = getInstallationIdFromRequest2(req);
  if (!inst || inst === "web_anon") return;
  if (plat === "ios" || plat === "android") {
    await db2.query(
      "UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND (app_bound_device_id IS NULL OR app_bound_device_id = '')",
      [inst, userId]
    );
    return;
  }
  if (plat === "web") {
    const slot = getRegistrationSlot(req);
    if (slot === "web_phone") {
      await db2.query(
        "UPDATE users SET web_device_id_phone = $1 WHERE id = $2 AND (web_device_id_phone IS NULL OR web_device_id_phone = '')",
        [inst, userId]
      );
    } else if (slot === "web_desktop") {
      await db2.query(
        "UPDATE users SET web_device_id_desktop = $1 WHERE id = $2 AND (web_device_id_desktop IS NULL OR web_device_id_desktop = '')",
        [inst, userId]
      );
    }
  }
}
async function assertNativePaidPurchaseInstallation(db2, userId, req) {
  const inst = getInstallationIdFromRequest2(req);
  if (!inst || inst === "web_anon") return { ok: true };
  const plat = getClientPlatform2(req);
  if (plat === "web") return { ok: true };
  const r = await db2.query(`SELECT app_bound_device_id, role FROM users WHERE id = $1`, [userId]);
  if (r.rows.length === 0) return { ok: true };
  const row = r.rows[0];
  if (usesStaffDualSession(row.role) || isStudentDeviceBindingDisabled(row.role)) {
    return { ok: true };
  }
  const ok = studentInstallationMatchesActiveSession(
    { app_bound_device_id: row.app_bound_device_id },
    req,
    inst,
    plat
  );
  if (!ok) {
    return {
      ok: false,
      message: "Purchases must be completed on the same native device registered for this account."
    };
  }
  return { ok: true };
}
async function finalizeInstallationBindAfterPurchase(db2, userId, req) {
  const inst = getInstallationIdFromRequest2(req);
  if (!inst || inst === "web_anon") return;
  const plat = getClientPlatform2(req);
  if (plat !== "ios" && plat !== "android") return;
  const ur = await db2.query("SELECT role FROM users WHERE id = $1", [userId]);
  const role = ur.rows[0]?.role;
  if (usesStaffDualSession(role) || isStudentDeviceBindingDisabled(role)) return;
  await db2.query("UPDATE users SET app_bound_device_id = $1 WHERE id = $2 AND app_bound_device_id IS NULL", [inst, userId]);
}
async function bindDeviceForNativeFirstLogin(db2, userId, role, req) {
  if (role === "admin" || usesStaffDualSession(role)) return;
  if (isStudentDeviceBindingDisabled(role)) return;
  await bindStudentDeviceOnLogin(db2, userId, req);
}
function studentInstallationMatchesActiveSession(row, req, cand, plat) {
  if (!cand || cand === "web_anon") return false;
  const appb = String(row.app_bound_device_id ?? "").trim();
  if (plat === "ios" || plat === "android") {
    if (!appb) return true;
    return cand === appb;
  }
  if (!appb) return true;
  return cand === appb;
}
async function enforceInstallationBinding(db2, req, userId, role) {
  if (role === "admin" || usesStaffDualSession(role)) return { ok: true };
  if (isStudentDeviceBindingDisabled(role)) return { ok: true };
  const plat = getClientPlatform2(req);
  const cand = getInstallationIdFromRequest2(req);
  if (plat === "web") {
    const deviceRow = await loadStudentDeviceRow(db2, userId);
    if (!deviceRow || countRegisteredDevices(deviceRow) === 0) return { ok: true };
    if (!cand || cand === "web_anon") {
      return { ok: false, code: "device_id_missing" };
    }
    if (isInstallationRegistered(deviceRow, cand)) return { ok: true };
    return { ok: false, code: "device_binding_mismatch" };
  }
  const r = await db2.query(
    `SELECT COALESCE(app_bound_device_id, '') AS appb
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!r.rows.length) return { ok: true };
  const appb = String(r.rows[0].appb ?? "").trim();
  if (!appb) return { ok: true };
  if (!cand || cand === "web_anon") {
    return { ok: false, code: "device_id_missing" };
  }
  const matches = studentInstallationMatchesActiveSession(
    { app_bound_device_id: appb },
    req,
    cand,
    plat
  );
  return matches ? { ok: true } : { ok: false, code: "device_binding_mismatch" };
}
async function assertLoginAllowedForInstallation(db2, req, opts) {
  if (opts.role === "admin" || usesStaffDualSession(opts.role)) return { ok: true };
  const ur = await db2.query(
    `SELECT app_bound_device_id, web_device_id_phone, web_device_id_desktop,
            role, COALESCE(is_blocked,FALSE) AS blocked
     FROM users WHERE id = $1`,
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  const role = opts.role ?? row.role;
  if (row.blocked) {
    return { ok: false, httpStatus: 403, message: "Your account has been blocked. Please contact support." };
  }
  if (isStudentDeviceBindingDisabled(role)) return { ok: true };
  const deviceRow = studentDeviceRowFromDb(row);
  const attempted = getAttemptedInstallationId(req, opts.bodyDeviceId);
  const plat = getClientPlatform2(req);
  const slot = getRegistrationSlot(req);
  const meta = { phone: opts.phone ?? null, email: opts.email ?? null };
  if (plat === "ios" || plat === "android") {
    const appb2 = String(row.app_bound_device_id ?? "").trim();
    if (!appb2) return { ok: true };
    if (attempted && attempted === appb2) return { ok: true };
    if (attempted && isInstallationRegistered(deviceRow, attempted)) return { ok: true };
    if (attempted && canRegisterNewDevice(deviceRow, "app_bound")) return { ok: true };
    if (countRegisteredDevices(deviceRow) >= 2) {
      await logWrongInstallationAttempt(db2, req, opts.userId, appb2, attempted, meta, "max_devices_registered");
      return { ok: false, httpStatus: 403, message: MAX_DEVICES_MESSAGE, code: "max_devices_registered" };
    }
    await logWrongInstallationAttempt(db2, req, opts.userId, appb2, attempted, meta);
    return {
      ok: false,
      httpStatus: 403,
      message: "Access denied: this account is linked to another native device. Use the original device or ask admin to clear the device lock."
    };
  }
  if (plat === "web") {
    const appb2 = String(row.app_bound_device_id ?? "").trim();
    if (slot === "web_phone" && appb2) {
      await logWrongInstallationAttempt(db2, req, opts.userId, appb2, attempted, meta, "wrong_device_login_denied");
      return {
        ok: false,
        httpStatus: 403,
        message: "Phone web sign-in is not available for accounts registered on the mobile app. Use the app or your registered laptop browser."
      };
    }
    if (attempted && isInstallationRegistered(deviceRow, attempted)) return { ok: true };
    if (slot && canRegisterNewDevice(deviceRow, slot)) return { ok: true };
    if (countRegisteredDevices(deviceRow) >= 2) {
      const bound = getRegisteredInstallationIdsForLog(deviceRow);
      await logWrongInstallationAttempt(db2, req, opts.userId, bound, attempted, meta, "max_devices_registered");
      return { ok: false, httpStatus: 403, message: MAX_DEVICES_MESSAGE, code: "max_devices_registered" };
    }
    return { ok: true };
  }
  const appb = String(row.app_bound_device_id ?? "").trim();
  if (!appb) return { ok: true };
  if (!attempted || attempted !== appb) {
    await logWrongInstallationAttempt(db2, req, opts.userId, appb, attempted, meta);
    return {
      ok: false,
      httpStatus: 403,
      message: "Access denied: this account is linked to another native device. Use the original device or ask admin to clear the device lock."
    };
  }
  return { ok: true };
}
function getRegisteredInstallationIdsForLog(row) {
  const ids = [
    String(row.app_bound_device_id ?? "").trim(),
    String(row.web_device_id_phone ?? "").trim(),
    String(row.web_device_id_desktop ?? "").trim()
  ].filter(Boolean);
  return ids[0] ?? null;
}
async function assertSessionNotActivelyInUse(db2, req, opts) {
  if (opts.role === "admin" || usesStaffDualSession(opts.role)) return { ok: true };
  const ur = await db2.query(
    `SELECT session_token, last_active_at, role, device_id, phone, email,
            app_bound_device_id, web_device_id_phone, web_device_id_desktop
     FROM users WHERE id = $1`,
    [opts.userId]
  );
  if (ur.rows.length === 0) return { ok: true };
  const row = ur.rows[0];
  if (String(row.role ?? "") === "admin" || usesStaffDualSession(String(row.role ?? ""))) {
    return { ok: true };
  }
  const sessionToken = row.session_token ? String(row.session_token).trim() : "";
  if (!sessionToken) return { ok: true };
  const attempted = getAttemptedInstallationId(req, opts.bodyDeviceId);
  const storedDeviceId = row.device_id ? String(row.device_id).trim() : "";
  const deviceRow = studentDeviceRowFromDb(row);
  if (attempted && storedDeviceId && attempted === storedDeviceId) {
    return { ok: true };
  }
  if (attempted && isInstallationRegistered(deviceRow, attempted)) {
    return { ok: true };
  }
  if (attempted && countRegisteredDevices(deviceRow) < 2) {
    return { ok: true };
  }
  const lastActive = Number(row.last_active_at || 0);
  const plat = getClientPlatform2(req);
  const lockWindowMs = plat === "web" ? STUDENT_WEB_SESSION_LOCK_WINDOW_MS : 10 * 60 * 1e3;
  if (!lastActive || Date.now() - lastActive > lockWindowMs) {
    return { ok: true };
  }
  await logWrongInstallationAttempt(
    db2,
    req,
    opts.userId,
    storedDeviceId || getRegisteredInstallationIdsForLog(deviceRow),
    attempted,
    { phone: row.phone ?? null, email: row.email ?? null },
    "active_web_session_login_denied"
  );
  return {
    ok: false,
    httpStatus: 403,
    message: "This account is already logged in on another device. Sign in here to switch devices, or ask admin to unlock."
  };
}
async function assertActiveSessionPlatformMatches(db2, req, userId, role) {
  if (role === "admin" || usesStaffDualSession(role)) return { ok: true };
  const r = await db2.query(
    `SELECT COALESCE(active_session_platform, '') AS asp,
            app_bound_device_id
     FROM users WHERE id = $1`,
    [userId]
  );
  if (studentIsWebOnly({ app_bound_device_id: r.rows[0]?.app_bound_device_id })) {
    return { ok: true };
  }
  const active = String(r.rows[0]?.asp ?? "").trim();
  if (!active || active !== "web" && active !== "mobile") return { ok: true };
  const requestFamily = getActiveSessionPlatformFamily(req);
  if (!requestFamily || requestFamily === active) return { ok: true };
  return { ok: false, activePlatform: active };
}
var MAX_DEVICES_MESSAGE, STUDENT_WEB_SESSION_LOCK_WINDOW_MS;
var init_native_device_binding = __esm({
  "backend/native-device-binding.ts"() {
    "use strict";
    init_session_policy();
    MAX_DEVICES_MESSAGE = "You are not allowed to sign in. This account is already registered on the maximum number of devices (2). Contact support or ask admin to unlock.";
    STUDENT_WEB_SESSION_LOCK_WINDOW_MS = 7 * 24 * 60 * 60 * 1e3;
  }
});

// backend/user-sessions.ts
function envFlagEnabled2(name) {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
function isAdminDeviceBindingDisabled() {
  return envFlagEnabled2("DISABLE_ADMIN_DEVICE_BINDING");
}
function isMultiSessionRole(role) {
  const r = String(role || "");
  return r === "admin" || usesStaffDualSession(r);
}
function sessionMaxAgeMsForRow(row) {
  const role = String(row.role ?? "");
  if (role === "admin" || usesStaffDualSession(role)) return ADMIN_SESSION_MAX_AGE_MS;
  return STUDENT_SESSION_MAX_AGE_MS;
}
function sessionMinActiveAt(row) {
  return Date.now() - sessionMaxAgeMsForRow(row);
}
function isSessionLastActiveValid(row) {
  const la = Number(row.last_active_at || 0);
  if (!la) return true;
  return la >= sessionMinActiveAt(row);
}
async function resolveUserBySessionToken(db2, token, deviceId) {
  const primary = await db2.query(
    "SELECT * FROM users WHERE session_token = $1 AND COALESCE(is_blocked, FALSE) = FALSE",
    [token]
  );
  if (primary.rows.length > 0) {
    const row = primary.rows[0];
    if (isSessionLastActiveValid(row)) {
      return { row, matchedVia: "primary" };
    }
  }
  const minCreatedAt = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
  const extra = await db2.query(
    `SELECT u.*, s.device_id AS _session_device_id
     FROM users u
     INNER JOIN user_sessions s ON s.user_id = u.id AND s.session_token = $1
     WHERE u.role IN ('admin', 'teacher', 'manager')
       AND COALESCE(u.is_blocked, FALSE) = FALSE
       AND s.created_at >= $2`,
    [token, minCreatedAt]
  );
  if (extra.rows.length === 0) return null;
  const sessionRow = extra.rows[0];
  const boundDevice = sessionRow._session_device_id;
  const role = String(sessionRow.role ?? "");
  if (role === "admin" && !isAdminDeviceBindingDisabled() && boundDevice && deviceId && boundDevice !== deviceId) {
    console.warn(
      `[AdminSessionBinding] Device mismatch for user ${sessionRow.id}: bound=${boundDevice} attempted=${deviceId}`
    );
    return null;
  }
  const { _session_device_id: _discarded, ...userRow } = sessionRow;
  return { row: userRow, matchedVia: "extra" };
}
async function userHasSessionToken(db2, userId, token) {
  if (!token) return false;
  const u = await db2.query(
    "SELECT session_token, role, last_active_at FROM users WHERE id = $1",
    [userId]
  );
  if (u.rows.length === 0) return false;
  const row = u.rows[0];
  if (row.session_token === token) {
    if (isSessionLastActiveValid(row)) return true;
  }
  if (!isMultiSessionRole(row.role)) return false;
  const minCreatedAt = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
  const s = await db2.query(
    "SELECT 1 FROM user_sessions WHERE user_id = $1 AND session_token = $2 AND created_at >= $3",
    [userId, token, minCreatedAt]
  );
  return s.rows.length > 0;
}
async function persistStaffLoginSession(db2, user, token, deviceId, opts) {
  const now = Date.now();
  const platformFamily = opts.req ? getActiveSessionPlatformFamily(opts.req) || "web" : "web";
  await db2.query(
    `DELETE FROM user_sessions
     WHERE user_id = $1 AND platform_family = $2`,
    [user.id, platformFamily]
  );
  await db2.query(
    `INSERT INTO user_sessions (user_id, session_token, device_id, platform_family, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, token, deviceId ?? null, platformFamily, now]
  );
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
}
async function persistLoginSession(db2, user, token, deviceId, opts) {
  const isAdmin = user.role === "admin";
  const isStaff = usesStaffDualSession(user.role);
  const now = Date.now();
  const detectedPlatform = !isAdmin && !isStaff && opts.req ? getActiveSessionPlatformFamily(opts.req) : null;
  const platformFamily = isAdmin || isStaff ? null : detectedPlatform || "web";
  if (isStaff) {
    await persistStaffLoginSession(db2, user, token, deviceId, opts);
    return;
  }
  if (isAdmin) {
    const adminSessionDeviceId = isAdminDeviceBindingDisabled() ? null : deviceId ?? null;
    await db2.query(
      "INSERT INTO user_sessions (user_id, session_token, device_id, created_at) VALUES ($1, $2, $3, $4)",
      [user.id, token, adminSessionDeviceId, now]
    );
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
  if (platformFamily === "web" || platformFamily === "mobile") {
    await db2.query(
      `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3, active_session_platform = $4 WHERE id = $5`,
      [deviceId || null, token, now, platformFamily, user.id]
    );
  } else {
    await db2.query(
      `UPDATE users SET ${otpClause}device_id = $1, session_token = $2, last_active_at = $3 WHERE id = $4`,
      [deviceId || null, token, now, user.id]
    );
  }
}
async function revokeSessionTokenForUser(db2, userId, token) {
  if (!token) return;
  await db2.query("DELETE FROM user_sessions WHERE user_id = $1 AND session_token = $2", [userId, token]);
  const u = await db2.query("SELECT session_token FROM users WHERE id = $1", [userId]);
  if (u.rows[0]?.session_token === token) {
    await db2.query(
      "UPDATE users SET session_token = NULL, active_session_platform = NULL WHERE id = $1",
      [userId]
    );
  }
}
var ADMIN_SESSION_MAX_AGE_MS, STUDENT_SESSION_MAX_AGE_MS;
var init_user_sessions = __esm({
  "backend/user-sessions.ts"() {
    "use strict";
    init_native_device_binding();
    init_session_policy();
    ADMIN_SESSION_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1e3;
    STUDENT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  }
});

// backend/auth-utils.ts
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
function syncSessionUser(req, user) {
  const session2 = req.session;
  if (session2 && typeof session2 === "object") {
    session2.user = user;
  }
}
async function getAuthUserFromRequest(req, db2) {
  const cacheKey = "__auth_user_from_request_cache";
  if (Object.prototype.hasOwnProperty.call(req, cacheKey)) {
    return req[cacheKey];
  }
  const setCache = (val) => {
    req[cacheKey] = val;
    return val;
  };
  const authHeader = req.headers.authorization;
  const bearerRaw = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const bearerToken = bearerRaw && bearerRaw !== "null" && bearerRaw !== "undefined" ? bearerRaw : "";
  if (bearerToken) {
    const token = bearerToken;
    try {
      const requestDeviceId = getInstallationIdFromRequest2(req);
      const resolved = await resolveUserBySessionToken(db2, token, requestDeviceId);
      if (!resolved) {
        syncSessionUser(req, null);
        return null;
      }
      const u = resolved.row;
      if (u.is_blocked) {
        syncSessionUser(req, null);
        return setCache(null);
      }
      const authUser = rowsToAuthUser(u, token);
      syncSessionUser(req, authUser);
      return setCache(authUser);
    } catch (e) {
      console.error("[Auth] Bearer token lookup error:", e);
      return setCache(null);
    }
  }
  const sessionUser = req.session.user;
  if (!sessionUser?.id) return setCache(null);
  try {
    const result = await db2.query(
      "SELECT id, name, email, phone, role, session_token, profile_complete, is_blocked FROM users WHERE id = $1",
      [sessionUser.id]
    );
    if (result.rows.length === 0) {
      syncSessionUser(req, null);
      return setCache(null);
    }
    const row = result.rows[0];
    if (row.is_blocked) {
      syncSessionUser(req, null);
      return setCache(null);
    }
    const cookieTok = sessionUser.sessionToken;
    if (cookieTok && !await userHasSessionToken(db2, sessionUser.id, cookieTok)) {
      syncSessionUser(req, null);
      return setCache(null);
    }
    if (row.session_token && !sessionUser.sessionToken) {
      syncSessionUser(req, null);
      return setCache(null);
    }
    const authUser = rowsToAuthUser(row, cookieTok || row.session_token);
    syncSessionUser(req, authUser);
    return setCache(authUser);
  } catch (e) {
    console.error("[Auth] Session user lookup error:", e);
    return setCache(null);
  }
}
var init_auth_utils = __esm({
  "backend/auth-utils.ts"() {
    "use strict";
    init_user_sessions();
    init_native_device_binding();
  }
});

// backend/require-admin.ts
function createRequireAdmin(getAuthUser2) {
  return async function requireAdmin2(req, res, next) {
    const user = await getAuthUser2(req);
    if (!user || user.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    req.user = user;
    next();
  };
}
var init_require_admin = __esm({
  "backend/require-admin.ts"() {
    "use strict";
  }
});

// backend/require-staff.ts
function createRequireStaff(getAuthUser2) {
  return async function requireStaff2(req, res, next) {
    const user = await getAuthUser2(req);
    if (!user || !isStaffRole(user.role)) {
      res.status(403).json({ message: "Staff access required" });
      return;
    }
    req.user = user;
    next();
  };
}
var init_require_staff = __esm({
  "backend/require-staff.ts"() {
    "use strict";
    init_staff_permissions();
  }
});

// backend/staff-access-utils.ts
async function getStaffAssignments(db2, userId) {
  const res = await db2.query(
    `SELECT id, user_id, course_id, subject_key, assigned_at
     FROM staff_course_assignments
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY assigned_at DESC`,
    [userId]
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    course_id: Number(r.course_id),
    subject_key: r.subject_key != null && String(r.subject_key).trim() !== "" ? String(r.subject_key) : null,
    assigned_at: Number(r.assigned_at || 0)
  }));
}
function assignmentCoversSubject(a, subjectKey) {
  if (a.subject_key == null) return true;
  if (subjectKey == null || String(subjectKey).trim() === "") return false;
  return String(a.subject_key).toLowerCase() === String(subjectKey).toLowerCase();
}
function findAssignmentForCourse(assignments, courseId, subjectKey) {
  const matches = assignments.filter((a) => a.course_id === courseId);
  if (matches.length === 0) return null;
  if (subjectKey != null && String(subjectKey).trim() !== "") {
    const exact = matches.find((a) => assignmentCoversSubject(a, subjectKey));
    if (exact) return exact;
    return null;
  }
  return matches[0] ?? null;
}
async function getPermissionOverrides(db2, userId) {
  const res = await db2.query(
    `SELECT permission_key, allowed FROM staff_permission_overrides WHERE user_id = $1`,
    [userId]
  );
  return res.rows;
}
async function getEffectivePermissions(db2, userId, role) {
  const overrides = await getPermissionOverrides(db2, userId);
  return mergePermissionOverrides(role, overrides);
}
async function hasPermission(db2, userId, role, permission) {
  if (!isStaffRole(role)) return false;
  const perms = await getEffectivePermissions(db2, userId, role);
  return !!perms[permission];
}
async function assertCourseAssignment(db2, userId, courseId, opts) {
  const assignments = await getStaffAssignments(db2, userId);
  const assignment = findAssignmentForCourse(assignments, courseId, opts?.subjectKey);
  if (!assignment) {
    throw new StaffAccessError(403, "course_not_assigned", "You are not assigned to this course");
  }
  if (opts?.permission) {
    const roleRes = await db2.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const role = String(roleRes.rows[0]?.role || "");
    const ok = await hasPermission(db2, userId, role, opts.permission);
    if (!ok) {
      throw new StaffAccessError(403, "permission_denied", "Permission denied");
    }
  }
  return assignment;
}
function resolveSubjectKeyForWrite(assignment, requestedSubjectKey) {
  if (assignment.subject_key != null) return assignment.subject_key;
  if (requestedSubjectKey != null && String(requestedSubjectKey).trim() !== "") {
    return String(requestedSubjectKey).trim();
  }
  return null;
}
function getClientPlatform3(req) {
  const header = String(req.headers["x-app-platform"] || req.headers["x-platform"] || "").toLowerCase();
  if (header === "web" || header === "ios" || header === "android") return header;
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  if (ua.includes("expo") || ua.includes("okhttp") || ua.includes("cfnetwork")) {
    return "android";
  }
  return "web";
}
async function assertLiveStartAllowed(db2, userId, role, req) {
  const perms = await getEffectivePermissions(db2, userId, role);
  if (!perms["live.start"]) {
    throw new StaffAccessError(403, "permission_denied", "Live start not permitted");
  }
  if (perms["live.start_web_only"] && getClientPlatform3(req) !== "web") {
    throw new StaffAccessError(403, "live_web_only", "Start live classes from the web Teacher Portal");
  }
}
async function logStaffActivity(db2, opts) {
  try {
    const ip = opts.req ? String(opts.req.headers["x-forwarded-for"] || opts.req.socket?.remoteAddress || "") : "";
    const ua = opts.req ? String(opts.req.headers["user-agent"] || "") : "";
    await db2.query(
      `INSERT INTO staff_activity_log
        (user_id, action, entity_type, entity_id, course_id, subject_key, meta, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        opts.userId,
        opts.action,
        opts.entityType ?? null,
        opts.entityId != null ? String(opts.entityId) : null,
        opts.courseId ?? null,
        opts.subjectKey ?? null,
        JSON.stringify(opts.meta ?? {}),
        ip.slice(0, 128),
        ua.slice(0, 512),
        Date.now()
      ]
    );
  } catch {
  }
}
function filterRowsBySubjectKey(rows, assignment) {
  if (assignment.subject_key == null) return rows;
  const sk = assignment.subject_key.toLowerCase();
  return rows.filter((r) => String(r.subject_key || "").toLowerCase() === sk);
}
var StaffAccessError;
var init_staff_access_utils = __esm({
  "backend/staff-access-utils.ts"() {
    "use strict";
    init_staff_permissions();
    StaffAccessError = class extends Error {
      status;
      code;
      constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
      }
    };
  }
});

// backend/staff-profile-utils.ts
async function ensureStaffProfile(db2, userId) {
  await db2.query(
    `INSERT INTO staff_profiles (user_id, created_at, updated_at)
     VALUES ($1, $2, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, Date.now()]
  );
}
async function loadStaffProfileBundle(db2, userId) {
  const [userRes, profileRes, eduRes, expRes] = await Promise.all([
    db2.query(
      `SELECT id, name, email, phone, role, last_active_at, created_at FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    ),
    db2.query(`SELECT * FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [userId]),
    db2.query(
      `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
      [userId]
    ),
    db2.query(
      `SELECT * FROM staff_experience WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
      [userId]
    )
  ]);
  const user = userRes.rows[0];
  if (!user) return null;
  return {
    user,
    profile: profileRes.rows[0] || null,
    education: eduRes.rows,
    experience: expRes.rows
  };
}
function serializeStaffListRow(row) {
  return {
    id: Number(row.id),
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || "",
    role: row.role || "teacher",
    employeeId: row.employee_id || "",
    teacherId: row.teacher_id || "",
    status: row.status || "active",
    photoUrl: row.photo_url || "",
    courseCount: Number(row.course_count || 0),
    lastActiveAt: row.last_active_at != null ? Number(row.last_active_at) : null,
    createdAt: row.created_at != null ? Number(row.created_at) : null
  };
}
var init_staff_profile_utils = __esm({
  "backend/staff-profile-utils.ts"() {
    "use strict";
  }
});

// backend/staff-course-about-sync.ts
async function syncTeacherToCourseAbout(db2, userId, courseId) {
  try {
    const [profileRes, userRes, courseRes] = await Promise.all([
      db2.query(`SELECT photo_url, personal_json, teacher_id FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [userId]),
      db2.query(`SELECT name FROM users WHERE id = $1 LIMIT 1`, [userId]),
      db2.query(`SELECT teacher_details_json FROM courses WHERE id = $1 LIMIT 1`, [courseId])
    ]);
    const profile = profileRes.rows[0];
    const user = userRes.rows[0];
    const course = courseRes.rows[0];
    if (!profile || !user || !course) return;
    const personal = typeof profile.personal_json === "string" ? JSON.parse(profile.personal_json) : profile.personal_json || {};
    let details = [];
    try {
      details = Array.isArray(course.teacher_details_json) ? course.teacher_details_json : JSON.parse(course.teacher_details_json || "[]");
    } catch {
      details = [];
    }
    const entry = {
      name: user.name,
      photoUrl: profile.photo_url || "",
      teacherId: profile.teacher_id || "",
      bio: personal.bio || "",
      syncedFromStaffId: userId,
      syncedAt: Date.now()
    };
    const idx = details.findIndex((d) => d.syncedFromStaffId === userId);
    if (idx >= 0) details[idx] = { ...details[idx], ...entry };
    else details.push(entry);
    await db2.query(
      `UPDATE courses SET teacher_image_url = COALESCE($2, teacher_image_url), teacher_details_json = $3 WHERE id = $1`,
      [courseId, profile.photo_url || null, JSON.stringify(details)]
    );
  } catch (err) {
    console.warn("[StaffSync] course about sync failed:", err);
  }
}
async function parseAadharOcrPlaceholder(_fileUrl) {
  return {
    message: "OCR not configured. Enter details manually."
  };
}
var init_staff_course_about_sync = __esm({
  "backend/staff-course-about-sync.ts"() {
    "use strict";
  }
});

// backend/admin-staff-routes.ts
function parseUserId(raw) {
  const id = parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
function adminUserId(req) {
  const u = req.user;
  return u?.id ?? null;
}
function registerAdminStaffRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  runInTransaction: runInTransaction2
}) {
  app2.get("/api/admin/staff", requireAdmin2, async (req, res) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const roleFilter = String(req.query.role ?? "").trim().toLowerCase();
      const params = [];
      let where = `WHERE LOWER(COALESCE(u.role, '')) IN ('teacher', 'manager')`;
      if (roleFilter && STAFF_ROLES_LIST.includes(roleFilter)) {
        params.push(roleFilter);
        where += ` AND LOWER(u.role) = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where += ` AND (COALESCE(u.name,'') ILIKE ${p} OR COALESCE(u.phone,'') ILIKE ${p} OR COALESCE(u.email,'') ILIKE ${p})`;
      }
      const result = await db2.query(
        `SELECT u.id, u.name, u.email, u.phone, u.role, u.last_active_at, u.created_at,
                sp.employee_id, sp.teacher_id, sp.status, sp.photo_url,
                (SELECT COUNT(*)::int FROM staff_course_assignments a
                 WHERE a.user_id = u.id AND a.is_active = TRUE) AS course_count
         FROM users u
         LEFT JOIN staff_profiles sp ON sp.user_id = u.id
         ${where}
         ORDER BY u.name ASC, u.id ASC
         LIMIT 500`,
        params
      );
      res.json(result.rows.map(serializeStaffListRow));
    } catch (err) {
      console.error("[AdminStaff] list failed:", err);
      res.status(500).json({ message: "Failed to list staff" });
    }
  });
  app2.post("/api/admin/staff/create", requireAdmin2, async (req, res) => {
    try {
      const { name, phone, email, role, employeeId, teacherId, joiningDate, reportingManager } = req.body || {};
      const staffRole = String(role || "teacher").toLowerCase();
      if (!STAFF_ROLES_LIST.includes(staffRole)) {
        return res.status(400).json({ message: "Invalid staff role" });
      }
      const phoneNorm = String(phone || "").replace(/\D/g, "");
      if (phoneNorm.length < 10) return res.status(400).json({ message: "Valid phone required" });
      const existing = await db2.query(`SELECT id, role FROM users WHERE phone = $1 LIMIT 1`, [phoneNorm]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ message: "Phone already registered. Use promote instead.", userId: existing.rows[0].id });
      }
      const now = Date.now();
      const userRes = await db2.query(
        `INSERT INTO users (name, email, phone, role, profile_complete, created_at, last_active_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, $5) RETURNING id, name, email, phone, role`,
        [String(name || "").trim() || "Teacher", email || null, phoneNorm, staffRole, now]
      );
      const user = userRes.rows[0];
      await db2.query(
        `INSERT INTO staff_profiles (user_id, employee_id, teacher_id, joining_date, reporting_manager, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $6)`,
        [
          user.id,
          employeeId || null,
          teacherId || null,
          joiningDate ? Number(joiningDate) : null,
          reportingManager || null,
          now
        ]
      );
      await logStaffActivity(db2, {
        userId: Number(user.id),
        action: "staff.created",
        entityType: "user",
        entityId: user.id,
        meta: { byAdmin: adminUserId(req) },
        req
      });
      res.status(201).json(user);
    } catch (err) {
      console.error("[AdminStaff] create failed:", err);
      res.status(500).json({ message: "Failed to create staff" });
    }
  });
  app2.post("/api/admin/staff/:userId/promote", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const staffRole = String(req.body?.role || "teacher").toLowerCase();
      if (!STAFF_ROLES_LIST.includes(staffRole)) {
        return res.status(400).json({ message: "Invalid staff role" });
      }
      const userRes = await db2.query(`SELECT id, role FROM users WHERE id = $1 LIMIT 1`, [userId]);
      if (userRes.rows.length === 0) return res.status(404).json({ message: "User not found" });
      const currentRole = String(userRes.rows[0].role || "").toLowerCase();
      if (currentRole === "admin") return res.status(400).json({ message: "Cannot promote admin" });
      await db2.query(`UPDATE users SET role = $1 WHERE id = $2`, [staffRole, userId]);
      await ensureStaffProfile(db2, userId);
      const body = req.body || {};
      await db2.query(
        `UPDATE staff_profiles SET
           employee_id = COALESCE($2, employee_id),
           teacher_id = COALESCE($3, teacher_id),
           reporting_manager = COALESCE($4, reporting_manager),
           updated_at = $5
         WHERE user_id = $1`,
        [userId, body.employeeId || null, body.teacherId || null, body.reportingManager || null, Date.now()]
      );
      await logStaffActivity(db2, {
        userId,
        action: "staff.promoted",
        entityType: "user",
        entityId: userId,
        meta: { role: staffRole, byAdmin: adminUserId(req) },
        req
      });
      res.json({ success: true, userId, role: staffRole });
    } catch (err) {
      console.error("[AdminStaff] promote failed:", err);
      res.status(500).json({ message: "Failed to promote user" });
    }
  });
  app2.post("/api/admin/staff/:userId/demote", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      await db2.query(`UPDATE users SET role = 'student' WHERE id = $1 AND role IN ('teacher', 'manager')`, [userId]);
      await db2.query(`UPDATE staff_course_assignments SET is_active = FALSE WHERE user_id = $1`, [userId]);
      await db2.query(`UPDATE staff_profiles SET status = 'inactive', updated_at = $2 WHERE user_id = $1`, [
        userId,
        Date.now()
      ]);
      await logStaffActivity(db2, {
        userId,
        action: "staff.demoted",
        entityType: "user",
        entityId: userId,
        meta: { byAdmin: adminUserId(req) },
        req
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] demote failed:", err);
      res.status(500).json({ message: "Failed to demote staff" });
    }
  });
  app2.get("/api/admin/staff/:userId", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const bundle = await loadStaffProfileBundle(db2, userId);
      if (!bundle) return res.status(404).json({ message: "Staff not found" });
      const assignments = await getStaffAssignments(db2, userId);
      const permissions = await getEffectivePermissions(db2, userId, String(bundle.user.role));
      const overrides = await getPermissionOverrides(db2, userId);
      res.json({ ...bundle, assignments, permissions, permissionOverrides: overrides });
    } catch (err) {
      console.error("[AdminStaff] get detail failed:", err);
      res.status(500).json({ message: "Failed to load staff" });
    }
  });
  app2.put("/api/admin/staff/:userId", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      await ensureStaffProfile(db2, userId);
      const b = req.body || {};
      if (b.name != null) await db2.query(`UPDATE users SET name = $1 WHERE id = $2`, [String(b.name).trim(), userId]);
      if (b.email !== void 0) await db2.query(`UPDATE users SET email = $1 WHERE id = $2`, [b.email || null, userId]);
      if (b.phone !== void 0) {
        const phoneNorm = String(b.phone || "").replace(/\D/g, "");
        await db2.query(`UPDATE users SET phone = $1 WHERE id = $2`, [phoneNorm || null, userId]);
      }
      await db2.query(
        `UPDATE staff_profiles SET
           employee_id = COALESCE($2, employee_id),
           teacher_id = COALESCE($3, teacher_id),
           status = COALESCE($4, status),
           personal_json = COALESCE($5, personal_json),
           working_json = COALESCE($6, working_json),
           bank_json = COALESCE($7, bank_json),
           company_json = COALESCE($8, company_json),
           photo_url = COALESCE($9, photo_url),
           resume_url = COALESCE($10, resume_url),
           aadhar_number = COALESCE($11, aadhar_number),
           aadhar_front_url = COALESCE($12, aadhar_front_url),
           aadhar_back_url = COALESCE($13, aadhar_back_url),
           joining_date = COALESCE($14, joining_date),
           reporting_manager = COALESCE($15, reporting_manager),
           department = COALESCE($16, department),
           designation = COALESCE($17, designation),
           updated_at = $18
         WHERE user_id = $1`,
        [
          userId,
          b.employeeId ?? null,
          b.teacherId ?? null,
          b.status ?? null,
          b.personalJson != null ? JSON.stringify(b.personalJson) : null,
          b.workingJson != null ? JSON.stringify(b.workingJson) : null,
          b.bankJson != null ? JSON.stringify(b.bankJson) : null,
          b.companyJson != null ? JSON.stringify(b.companyJson) : null,
          b.photoUrl ?? null,
          b.resumeUrl ?? null,
          b.aadharNumber ?? null,
          b.aadharFrontUrl ?? null,
          b.aadharBackUrl ?? null,
          b.joiningDate != null ? Number(b.joiningDate) : null,
          b.reportingManager ?? null,
          b.department ?? null,
          b.designation ?? null,
          Date.now()
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] update failed:", err);
      res.status(500).json({ message: "Failed to update staff" });
    }
  });
  app2.get("/api/admin/staff/:userId/education", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db2.query(
        `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load education" });
    }
  });
  app2.put("/api/admin/staff/:userId/education", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const tx = runInTransaction2 || (async (fn) => fn(db2));
      await tx(async (txDb) => {
        await txDb.query(`DELETE FROM staff_education WHERE user_id = $1`, [userId]);
        for (let i = 0; i < items.length; i++) {
          const e = items[i] || {};
          await txDb.query(
            `INSERT INTO staff_education (user_id, degree, institute, board, university, passing_year, percentage, certificate_url, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              userId,
              e.degree || null,
              e.institute || null,
              e.board || null,
              e.university || null,
              e.passingYear || null,
              e.percentage || null,
              e.certificateUrl || null,
              i,
              Date.now()
            ]
          );
        }
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] education update failed:", err);
      res.status(500).json({ message: "Failed to update education" });
    }
  });
  app2.get("/api/admin/staff/:userId/experience", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db2.query(
        `SELECT * FROM staff_experience WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load experience" });
    }
  });
  app2.put("/api/admin/staff/:userId/experience", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const tx = runInTransaction2 || (async (fn) => fn(db2));
      await tx(async (txDb) => {
        await txDb.query(`DELETE FROM staff_experience WHERE user_id = $1`, [userId]);
        for (let i = 0; i < items.length; i++) {
          const e = items[i] || {};
          await txDb.query(
            `INSERT INTO staff_experience (user_id, institute_name, designation, subjects, years_experience, joining_date, leaving_date, experience_letter_url, sort_order, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              userId,
              e.instituteName || null,
              e.designation || null,
              e.subjects || null,
              e.yearsExperience || null,
              e.joiningDate || null,
              e.leavingDate || null,
              e.experienceLetterUrl || null,
              i,
              Date.now()
            ]
          );
        }
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] experience update failed:", err);
      res.status(500).json({ message: "Failed to update experience" });
    }
  });
  app2.get("/api/admin/staff/:userId/assignments", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db2.query(
        `SELECT a.*, c.title AS course_title
         FROM staff_course_assignments a
         JOIN courses c ON c.id = a.course_id
         WHERE a.user_id = $1 AND a.is_active = TRUE
         ORDER BY a.assigned_at DESC`,
        [userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load assignments" });
    }
  });
  app2.post("/api/admin/staff/:userId/assignments", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      const courseId = parseUserId(req.body?.courseId);
      if (!userId || !courseId) return res.status(400).json({ message: "Invalid user or course id" });
      const subjectKey = typeof req.body?.subjectKey === "string" && req.body.subjectKey.trim() ? req.body.subjectKey.trim().toLowerCase() : null;
      const adminId = adminUserId(req);
      await db2.query(
        `UPDATE staff_course_assignments SET is_active = FALSE
         WHERE user_id = $1 AND course_id = $2 AND COALESCE(subject_key, '') = COALESCE($3::text, '') AND is_active = TRUE`,
        [userId, courseId, subjectKey]
      );
      const result = await db2.query(
        `INSERT INTO staff_course_assignments (user_id, course_id, subject_key, assigned_by, assigned_at, is_active)
         VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
        [userId, courseId, subjectKey, adminId, Date.now()]
      );
      await syncTeacherToCourseAbout(db2, userId, courseId);
      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("[AdminStaff] assign failed:", err);
      res.status(500).json({ message: "Failed to assign course" });
    }
  });
  app2.delete("/api/admin/staff/:userId/assignments/:assignmentId", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      const assignmentId = parseUserId(req.params.assignmentId);
      if (!userId || !assignmentId) return res.status(400).json({ message: "Invalid id" });
      await db2.query(
        `UPDATE staff_course_assignments SET is_active = FALSE WHERE id = $1 AND user_id = $2`,
        [assignmentId, userId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to remove assignment" });
    }
  });
  app2.put("/api/admin/staff/:userId/permissions", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const overrides = req.body?.overrides;
      if (!Array.isArray(overrides)) return res.status(400).json({ message: "overrides array required" });
      const adminId = adminUserId(req);
      const tx = runInTransaction2 || (async (fn) => fn(db2));
      await tx(async (txDb) => {
        for (const o of overrides) {
          const key = String(o.permissionKey || o.permission_key || "");
          if (!STAFF_PERMISSION_KEYS.includes(key)) continue;
          await txDb.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
            [userId, key, !!o.allowed, adminId, Date.now()]
          );
        }
      });
      const permissions = await getEffectivePermissions(
        db2,
        userId,
        String((await db2.query(`SELECT role FROM users WHERE id = $1`, [userId])).rows[0]?.role || "teacher")
      );
      res.json({ permissions });
    } catch (err) {
      console.error("[AdminStaff] permissions failed:", err);
      res.status(500).json({ message: "Failed to update permissions" });
    }
  });
  app2.get("/api/admin/staff/:userId/activity", requireAdmin2, async (req, res) => {
    try {
      const userId = parseUserId(req.params.userId);
      if (!userId) return res.status(400).json({ message: "Invalid user id" });
      const result = await db2.query(
        `SELECT * FROM staff_activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load activity" });
    }
  });
  app2.get("/api/admin/staff/requests/list", requireAdmin2, async (req, res) => {
    try {
      const status = String(req.query.status || "").trim();
      const params = [];
      let where = "WHERE 1=1";
      if (status) {
        params.push(status);
        where += ` AND r.status = $${params.length}`;
      }
      const result = await db2.query(
        `SELECT r.*, u.name AS user_name, u.phone AS user_phone
         FROM staff_access_requests r
         JOIN users u ON u.id = r.user_id
         ${where}
         ORDER BY r.created_at DESC
         LIMIT 300`,
        params
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load requests" });
    }
  });
  app2.put("/api/admin/staff/requests/:requestId", requireAdmin2, async (req, res) => {
    try {
      const requestId = parseUserId(req.params.requestId);
      if (!requestId) return res.status(400).json({ message: "Invalid request id" });
      const status = String(req.body?.status || "").toLowerCase();
      if (!["approved", "rejected"].includes(status)) {
        return res.status(400).json({ message: "status must be approved or rejected" });
      }
      const reqRow = await db2.query(`SELECT * FROM staff_access_requests WHERE id = $1 LIMIT 1`, [requestId]);
      if (reqRow.rows.length === 0) return res.status(404).json({ message: "Request not found" });
      const row = reqRow.rows[0];
      const adminId = adminUserId(req);
      await db2.query(
        `UPDATE staff_access_requests SET status = $1, admin_note = $2, reviewed_by = $3, reviewed_at = $4 WHERE id = $5`,
        [status, req.body?.adminNote || null, adminId, Date.now(), requestId]
      );
      if (status === "approved") {
        const type = String(row.request_type || "");
        const userId = Number(row.user_id);
        if (type === "recording_upload") {
          await db2.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, 'lectures.upload_recording', TRUE, $2, $3)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = TRUE, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
            [userId, adminId, Date.now()]
          );
        } else if (type === "youtube_materials") {
          await db2.query(
            `INSERT INTO staff_permission_overrides (user_id, permission_key, allowed, updated_by, updated_at)
             VALUES ($1, 'materials.youtube', TRUE, $2, $3)
             ON CONFLICT (user_id, permission_key) DO UPDATE SET allowed = TRUE, updated_by = EXCLUDED.updated_at`,
            [userId, adminId, Date.now()]
          );
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[AdminStaff] request review failed:", err);
      res.status(500).json({ message: "Failed to review request" });
    }
  });
  app2.post("/api/admin/staff/ocr/aadhar", requireAdmin2, async (req, res) => {
    try {
      const fileUrl = String(req.body?.fileUrl || "");
      if (!fileUrl) return res.status(400).json({ message: "fileUrl required" });
      const parsed = await parseAadharOcrPlaceholder(fileUrl);
      res.json({ fields: parsed, verified: false });
    } catch {
      res.status(500).json({ message: "OCR failed" });
    }
  });
}
var STAFF_ROLES_LIST;
var init_admin_staff_routes = __esm({
  "backend/admin-staff-routes.ts"() {
    "use strict";
    init_staff_permissions();
    init_staff_access_utils();
    init_staff_profile_utils();
    init_staff_course_about_sync();
    STAFF_ROLES_LIST = ["teacher", "manager"];
  }
});

// backend/require-staff-permission.ts
function createRequireStaffPermission(db2) {
  return function requireStaffPermission(permission) {
    return async (req, res, next) => {
      const user = req.user;
      if (!user) {
        res.status(403).json({ message: "Staff access required" });
        return;
      }
      const ok = await hasPermission(db2, user.id, user.role, permission);
      if (!ok) {
        res.status(403).json({ message: "Permission denied", code: "permission_denied" });
        return;
      }
      next();
    };
  };
}
var init_require_staff_permission = __esm({
  "backend/require-staff-permission.ts"() {
    "use strict";
    init_staff_access_utils();
  }
});

// backend/auto-notification-expiry.ts
function autoNotificationExpiresAt(now = Date.now()) {
  return now + AUTO_NOTIFICATION_TTL_MS;
}
function computeAutoNotificationHideAfterAt(tappedAt, expiresAt) {
  if (expiresAt == null || !Number.isFinite(Number(expiresAt))) return null;
  const expiry = Number(expiresAt);
  if (tappedAt < expiry) return expiry;
  return tappedAt + AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS;
}
async function notifyEnrolledCourseStudents(db2, courseId, opts) {
  const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]).catch(() => ({ rows: [] }));
  const recipientIds = recipients.rows.map((r) => Number(r.user_id)).filter((id) => Number.isFinite(id));
  if (recipientIds.length === 0) return;
  const now = opts.now ?? Date.now();
  const expiresAt = autoNotificationExpiresAt(now);
  await db2.query(
    `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
       SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
       FROM unnest($1::int[]) AS u`,
    [recipientIds, opts.title, opts.message, opts.type ?? "info", now, expiresAt]
  ).catch(() => {
  });
  if (opts.sendPush) {
    await opts.sendPush(recipientIds, { title: opts.title, body: opts.message, data: opts.pushData }).catch(() => {
    });
  }
}
var AUTO_NOTIFICATION_TTL_MS, AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS;
var init_auto_notification_expiry = __esm({
  "backend/auto-notification-expiry.ts"() {
    "use strict";
    AUTO_NOTIFICATION_TTL_MS = 12 * 60 * 60 * 1e3;
    AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS = 60 * 60 * 1e3;
  }
});

// backend/redis-notification-dedup.ts
function dedupKey(classId, userId, type) {
  return `notif:sent:${classId}:${userId}:${type}`;
}
async function filterNewNotificationRecipientsRedis(redis, classId, userIds, type, batchSize = 500) {
  const accepted = [];
  try {
    for (let i = 0; i < userIds.length; i += batchSize) {
      const batch = userIds.slice(i, i + batchSize);
      const multi = redis.multi();
      for (const userId of batch) {
        multi.set(dedupKey(classId, userId, type), "1", { NX: true, EX: NOTIF_DEDUP_TTL_SEC });
      }
      const replies = await multi.exec();
      batch.forEach((userId, idx) => {
        const reply = replies?.[idx];
        if (reply != null) accepted.push(userId);
      });
    }
    return accepted;
  } catch (err) {
    console.error("[Redis] filterNewNotificationRecipientsRedis pipeline failed, falling back to PostgreSQL:", err);
    return null;
  }
}
var NOTIF_DEDUP_TTL_SEC;
var init_redis_notification_dedup = __esm({
  "backend/redis-notification-dedup.ts"() {
    "use strict";
    NOTIF_DEDUP_TTL_SEC = 24 * 60 * 60;
  }
});

// backend/scheduled-jobs.ts
function liveClassReminderRunAt(scheduledAt) {
  return scheduledAt - LIVE_CLASS_REMINDER_MS;
}
function shouldScheduleLiveClassReminder(lc, now = Date.now()) {
  if (lc.notify_bell !== true) return false;
  const scheduledAt = Number(lc.scheduled_at);
  if (!Number.isFinite(scheduledAt) || scheduledAt <= now) return false;
  if (lc.is_completed === true) return false;
  if (lc.is_live === true) return false;
  if (lc.is_recording_mode === true) return false;
  return true;
}
async function cancelLiveClassReminderJob(db2, liveClassId) {
  const now = Date.now();
  await db2.query(
    `UPDATE scheduled_jobs
     SET status = 'cancelled', updated_at = $3
     WHERE job_type = $1 AND ref_id = $2 AND status IN ('pending', 'running')`,
    [LIVE_CLASS_REMINDER_30MIN_JOB, liveClassId, now]
  );
}
async function syncLiveClassReminderJob(db2, liveClassId) {
  const result = await db2.query(
    `SELECT id, title, course_id, scheduled_at, notify_bell, is_completed, is_live,
            is_recording_mode, is_free_preview, is_public
     FROM live_classes WHERE id = $1 LIMIT 1`,
    [liveClassId]
  );
  if (!result.rows.length) {
    await cancelLiveClassReminderJob(db2, liveClassId);
    return;
  }
  await syncLiveClassReminderJobFromRow(db2, result.rows[0]);
}
async function syncLiveClassReminderJobFromRow(db2, lc) {
  const now = Date.now();
  const liveClassId = Number(lc.id);
  if (!Number.isFinite(liveClassId)) return;
  if (!shouldScheduleLiveClassReminder(lc, now)) {
    await cancelLiveClassReminderJob(db2, liveClassId);
    return;
  }
  const runAt = liveClassReminderRunAt(Number(lc.scheduled_at));
  await db2.query(
    `INSERT INTO scheduled_jobs (job_type, ref_id, run_at, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $4)
     ON CONFLICT (job_type, ref_id) DO UPDATE SET
       run_at = EXCLUDED.run_at,
       status = CASE
         WHEN scheduled_jobs.status = 'running' THEN 'running'
         WHEN scheduled_jobs.status = 'done' AND scheduled_jobs.run_at = EXCLUDED.run_at THEN 'done'
         ELSE 'pending'
       END,
       updated_at = EXCLUDED.updated_at`,
    [LIVE_CLASS_REMINDER_30MIN_JOB, liveClassId, runAt, now]
  );
}
async function getNextPendingScheduledJobRunAt(db2, now = Date.now()) {
  const result = await db2.query(
    `SELECT MIN(run_at) AS next_run_at
     FROM scheduled_jobs
     WHERE status = 'pending' AND run_at > $1`,
    [now]
  );
  const next = Number(result.rows[0]?.next_run_at);
  return Number.isFinite(next) ? next : null;
}
async function runWithAdvisoryLock(pool2, lockKey, job) {
  const client2 = await pool2.connect();
  let locked = false;
  try {
    const got = await client2.query("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
    locked = got.rows[0]?.acquired === true;
    if (!locked) return;
    await job();
  } finally {
    if (locked) {
      await client2.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => {
      });
    }
    client2.release();
  }
}
async function trimNotificationsSent(db2, now) {
  await db2.query("DELETE FROM notifications_sent WHERE sent_at < $1", [now - 24 * 60 * 60 * 1e3]);
}
async function sendLiveClassReminder30Min(db2, lc, sendPushToUsers2) {
  const now = Date.now();
  const expiresAt = autoNotificationExpiresAt(now);
  const notifTitle = "\u23F0 Live Class in 30 minutes!";
  const notifMessage = `"${lc.title}" starts in 30 minutes. Get ready!`;
  const PUSH_BATCH_SIZE = 500;
  const dedupType = LIVE_CLASS_REMINDER_30MIN_JOB;
  let recipientIds = [];
  const redis = await getRedisClient();
  let dedupHandled = false;
  if (redis) {
    const candidates = !lc.course_id || lc.is_free_preview === true || lc.is_public === true ? await db2.query(`SELECT u.id::int AS user_id FROM users u WHERE u.role = 'student' LIMIT 5000`, []) : await db2.query(
      `SELECT e.user_id::int AS user_id
             FROM enrollments e
             WHERE e.course_id = $1::int
               AND (e.status = 'active' OR e.status IS NULL)
               AND (e.valid_until IS NULL OR e.valid_until > $2::bigint)`,
      [lc.course_id, now]
    );
    const candidateIds = candidates.rows.map((r) => Number(r.user_id));
    const redisResult = await filterNewNotificationRecipientsRedis(redis, lc.id, candidateIds, dedupType);
    if (redisResult !== null) {
      dedupHandled = true;
      recipientIds = redisResult;
      if (recipientIds.length) {
        await db2.query(
          `INSERT INTO notifications_sent (class_id, user_id, type)
           SELECT $1::int, u_id::int, $2::text
           FROM unnest($3::int[]) AS u_id
           ON CONFLICT (class_id, user_id, type) DO NOTHING`,
          [lc.id, dedupType, recipientIds]
        );
      }
    }
  }
  if (!dedupHandled) {
    if (!lc.course_id || lc.is_free_preview === true || lc.is_public === true) {
      const inserted = await db2.query(
        `INSERT INTO notifications_sent (class_id, user_id, type)
         SELECT $1::int, u.id::int, $2::text
         FROM users u
         WHERE u.role = 'student'
         ON CONFLICT (class_id, user_id, type) DO NOTHING
         RETURNING user_id`,
        [lc.id, dedupType]
      );
      recipientIds = inserted.rows.map((r) => Number(r.user_id));
    } else {
      const inserted = await db2.query(
        `INSERT INTO notifications_sent (class_id, user_id, type)
         SELECT $1::int, e.user_id::int, $2::text
         FROM enrollments e
         WHERE e.course_id = $3::int
           AND (e.status = 'active' OR e.status IS NULL)
           AND (e.valid_until IS NULL OR e.valid_until > $4::bigint)
         ON CONFLICT (class_id, user_id, type) DO NOTHING
         RETURNING user_id`,
        [lc.id, dedupType, lc.course_id, now]
      );
      recipientIds = inserted.rows.map((r) => Number(r.user_id));
    }
  }
  if (!recipientIds.length) return 0;
  await db2.query(
    `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
     SELECT u_id::int, $1::text, $2::text, 'info', $3::bigint, $4::bigint
     FROM unnest($5::int[]) AS u_id`,
    [notifTitle, notifMessage, now, expiresAt, recipientIds]
  );
  for (let i = 0; i < recipientIds.length; i += PUSH_BATCH_SIZE) {
    const batch = recipientIds.slice(i, i + PUSH_BATCH_SIZE);
    await sendPushToUsers2(db2, batch, {
      title: notifTitle,
      body: notifMessage,
      data: !lc.course_id || lc.is_free_preview === true || lc.is_public === true ? { type: "live_class_reminder", liveClassId: lc.id } : { type: "live_class_reminder", liveClassId: lc.id, courseId: lc.course_id }
    });
    if (i + PUSH_BATCH_SIZE < recipientIds.length) {
      await new Promise((resolve2) => setTimeout(resolve2, 200));
    }
  }
  console.log(`[LiveNotif] 30min reminder sent for class=${lc.id} recipients=${recipientIds.length}`);
  return recipientIds.length;
}
async function processDueJob(db2, job, sendPushToUsers2) {
  const now = Date.now();
  const jobId = Number(job.id);
  const liveClassId = Number(job.ref_id);
  await db2.query(
    `UPDATE scheduled_jobs SET status = 'running', updated_at = $2 WHERE id = $1 AND status = 'pending'`,
    [jobId, now]
  );
  if (job.job_type !== LIVE_CLASS_REMINDER_30MIN_JOB) {
    await db2.query(
      `UPDATE scheduled_jobs SET status = 'cancelled', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
    return;
  }
  const lcResult = await db2.query(
    `SELECT id, title, course_id, scheduled_at, notify_bell, is_completed, is_live,
            is_recording_mode, is_free_preview, is_public
     FROM live_classes WHERE id = $1 LIMIT 1`,
    [liveClassId]
  );
  const lc = lcResult.rows[0];
  if (!lc || !shouldScheduleLiveClassReminder(lc, now)) {
    await db2.query(
      `UPDATE scheduled_jobs SET status = 'cancelled', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
    return;
  }
  try {
    await sendLiveClassReminder30Min(db2, lc, sendPushToUsers2);
    await db2.query(
      `UPDATE scheduled_jobs SET status = 'done', updated_at = $2 WHERE id = $1`,
      [jobId, now]
    );
  } catch (err) {
    console.error("[ScheduledJobs] live class reminder failed:", err);
    await db2.query(
      `UPDATE scheduled_jobs
       SET status = 'pending', updated_at = $2, run_at = $3
       WHERE id = $1`,
      [jobId, now, now + 60 * 1e3]
    );
  }
}
async function runDueScheduledJobs(db2, pool2, sendPushToUsers2, now = Date.now()) {
  await runWithAdvisoryLock(pool2, SCHEDULED_JOBS_ADVISORY_LOCK_KEY, async () => {
    await trimNotificationsSent(db2, now);
    const due = await db2.query(
      `SELECT id, job_type, ref_id
       FROM scheduled_jobs
       WHERE status = 'pending' AND run_at <= $1
       ORDER BY run_at ASC
       LIMIT 20`,
      [now]
    );
    for (const job of due.rows) {
      await processDueJob(db2, job, sendPushToUsers2);
    }
  });
}
var LIVE_CLASS_REMINDER_30MIN_JOB, LIVE_CLASS_REMINDER_MS, SCHEDULED_JOBS_ADVISORY_LOCK_KEY;
var init_scheduled_jobs = __esm({
  "backend/scheduled-jobs.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_redis_client();
    init_redis_notification_dedup();
    LIVE_CLASS_REMINDER_30MIN_JOB = "live_class_reminder_30min";
    LIVE_CLASS_REMINDER_MS = 30 * 60 * 1e3;
    SCHEDULED_JOBS_ADVISORY_LOCK_KEY = 31415926541;
  }
});

// backend/staff-routes.ts
function staffUser(req) {
  return req.user;
}
function handleStaffError(res, err) {
  if (err instanceof StaffAccessError) {
    res.status(err.status).json({ message: err.message, code: err.code });
    return;
  }
  console.error("[Staff]", err);
  res.status(500).json({ message: "Internal error" });
}
function parseId(raw) {
  const id = parseInt(String(raw), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
function registerStaffRoutes({
  app: app2,
  db: db2,
  requireStaff: requireStaff2,
  updateCourseTestCounts: updateCourseTestCounts3,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3
}) {
  const requireStaffPermission = createRequireStaffPermission(db2);
  app2.get("/api/staff/me", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db2, user.id);
      const permissions = await getEffectivePermissions(db2, user.id, user.role);
      const profileRes = await db2.query(`SELECT * FROM staff_profiles WHERE user_id = $1 LIMIT 1`, [user.id]);
      res.json({ user, assignments, permissions, profile: profileRes.rows[0] || null });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/assignments", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const result = await db2.query(
        `SELECT a.*, c.title, c.course_type, c.multi_subject_config
         FROM staff_course_assignments a
         JOIN courses c ON c.id = a.course_id
         WHERE a.user_id = $1 AND a.is_active = TRUE
         ORDER BY c.title ASC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/dashboard", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db2, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) {
        return res.json({ todayClasses: [], upcomingClasses: [], courses: [], pendingRequests: [], recentActivity: [] });
      }
      const now = Date.now();
      const dayStart = /* @__PURE__ */ new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 864e5;
      const liveRes = await db2.query(
        `SELECT lc.*, c.title AS course_title
         FROM live_classes lc
         LEFT JOIN courses c ON c.id = lc.course_id
         WHERE lc.course_id = ANY($1::int[])
           AND COALESCE(lc.is_completed, FALSE) = FALSE
         ORDER BY lc.scheduled_at ASC NULLS LAST
         LIMIT 50`,
        [courseIds]
      );
      const filteredLive = liveRes.rows.filter((lc) => {
        const a = findAssignmentForCourse(assignments, Number(lc.course_id), lc.subject_key);
        return !!a;
      });
      const todayClasses = filteredLive.filter(
        (lc) => lc.scheduled_at >= dayStart.getTime() && lc.scheduled_at < dayEnd
      );
      const upcomingClasses = filteredLive.filter((lc) => Number(lc.scheduled_at || 0) >= now).slice(0, 10);
      const coursesRes = await db2.query(
        `SELECT id, title, course_type, thumbnail FROM courses WHERE id = ANY($1::int[])`,
        [courseIds]
      );
      const pendingRes = await db2.query(
        `SELECT * FROM staff_access_requests WHERE user_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`,
        [user.id]
      );
      const activityRes = await db2.query(
        `SELECT * FROM staff_activity_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`,
        [user.id]
      );
      res.json({
        todayClasses,
        upcomingClasses,
        courses: coursesRes.rows,
        pendingRequests: pendingRes.rows,
        recentActivity: activityRes.rows
      });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/profile", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const bundle = await loadStaffProfileBundle(db2, user.id);
      res.json(bundle);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/profile", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      await ensureStaffProfile(db2, user.id);
      const b = req.body || {};
      if (b.name != null) await db2.query(`UPDATE users SET name = $1 WHERE id = $2`, [String(b.name).trim(), user.id]);
      await db2.query(
        `UPDATE staff_profiles SET
           personal_json = COALESCE($2, personal_json),
           bank_json = COALESCE($3, bank_json),
           photo_url = COALESCE($4, photo_url),
           resume_url = COALESCE($5, resume_url),
           aadhar_number = COALESCE($6, aadhar_number),
           aadhar_front_url = COALESCE($7, aadhar_front_url),
           aadhar_back_url = COALESCE($8, aadhar_back_url),
           updated_at = $9
         WHERE user_id = $1`,
        [
          user.id,
          b.personalJson != null ? JSON.stringify(b.personalJson) : null,
          b.bankJson != null ? JSON.stringify(b.bankJson) : null,
          b.photoUrl ?? null,
          b.resumeUrl ?? null,
          b.aadharNumber ?? null,
          b.aadharFrontUrl ?? null,
          b.aadharBackUrl ?? null,
          Date.now()
        ]
      );
      await logStaffActivity(db2, { userId: user.id, action: "profile.updated", req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/profile/education", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const result = await db2.query(
        `SELECT * FROM staff_education WHERE user_id = $1 ORDER BY sort_order ASC, id ASC`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/profile/education", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await db2.query(`DELETE FROM staff_education WHERE user_id = $1`, [user.id]);
      for (let i = 0; i < items.length; i++) {
        const e = items[i] || {};
        await db2.query(
          `INSERT INTO staff_education (user_id, degree, institute, board, university, passing_year, percentage, certificate_url, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            user.id,
            e.degree || null,
            e.institute || null,
            e.board || null,
            e.university || null,
            e.passingYear || null,
            e.percentage || null,
            e.certificateUrl || null,
            i,
            Date.now()
          ]
        );
      }
      await logStaffActivity(db2, { userId: user.id, action: "education.updated", req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/courses", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db2, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) return res.json([]);
      const result = await db2.query(`SELECT * FROM courses WHERE id = ANY($1::int[]) ORDER BY title ASC`, [courseIds]);
      res.json(
        result.rows.map((c) => ({
          ...c,
          assignments: assignments.filter((a) => a.course_id === c.id)
        }))
      );
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/courses/:id", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.params.id);
      if (!courseId) return res.status(400).json({ message: "Invalid course id" });
      const assignment = await assertCourseAssignment(db2, user.id, courseId);
      const courseRes = await db2.query(`SELECT * FROM courses WHERE id = $1 LIMIT 1`, [courseId]);
      if (courseRes.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const [lectures, tests, materials, liveClasses, missions, foldersRes] = await Promise.all([
        db2.query(`SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db2.query(`SELECT * FROM tests WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db2.query(`SELECT * FROM study_materials WHERE course_id = $1 ORDER BY order_index ASC, id ASC`, [courseId]),
        db2.query(`SELECT * FROM live_classes WHERE course_id = $1 ORDER BY scheduled_at DESC NULLS LAST`, [courseId]),
        db2.query(`SELECT * FROM daily_missions WHERE course_id = $1 ORDER BY id DESC`, [courseId]),
        db2.query(
          `SELECT id, course_id, name, full_name, type, parent_id, order_index, subject_key
           FROM course_folders WHERE course_id = $1 ORDER BY order_index ASC NULLS LAST, id ASC`,
          [courseId]
        )
      ]);
      res.json({
        course: courseRes.rows[0],
        assignment,
        lectures: filterRowsBySubjectKey(lectures.rows, assignment),
        tests: filterRowsBySubjectKey(tests.rows, assignment),
        materials: filterRowsBySubjectKey(materials.rows, assignment),
        liveClasses: filterRowsBySubjectKey(liveClasses.rows, assignment),
        missions: filterRowsBySubjectKey(missions.rows, assignment),
        folders: filterRowsBySubjectKey(foldersRes.rows, assignment)
      });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/live-classes", requireStaff2, requireStaffPermission("live.schedule"), async (req, res) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      if (!courseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db2, user.id, courseId, { permission: "live.schedule" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const { title, description, scheduledAt, isLive, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle } = req.body || {};
      if (req.body?.isRecordingMode === true) {
        return res.status(403).json({ message: "Recording sessions require admin approval" });
      }
      const result = await db2.query(
        `INSERT INTO live_classes (title, description, course_id, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, is_recording_mode, subject_key, created_at)
         VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, FALSE, FALSE, $6, $7, $8, $9, $10, FALSE, $11, $12) RETURNING *`,
        [
          title,
          description || "",
          courseId,
          scheduledAt,
          isLive || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          lectureSectionTitle || null,
          lectureSubfolderTitle || null,
          subjectKey,
          Date.now()
        ]
      );
      await logStaffActivity(db2, {
        userId: user.id,
        action: "live.scheduled",
        entityType: "live_class",
        entityId: result.rows[0]?.id,
        courseId,
        subjectKey,
        req
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/live-classes/:id", requireStaff2, requireStaffPermission("live.schedule"), async (req, res) => {
    try {
      const user = staffUser(req);
      const liveId = parseId(req.params.id);
      if (!liveId) return res.status(400).json({ message: "Invalid id" });
      const lc = await db2.query(`SELECT * FROM live_classes WHERE id = $1 LIMIT 1`, [liveId]);
      if (lc.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const courseId = Number(lc.rows[0].course_id);
      await assertCourseAssignment(db2, user.id, courseId, {
        subjectKey: lc.rows[0].subject_key,
        permission: "live.schedule"
      });
      const b = req.body || {};
      const result = await db2.query(
        `UPDATE live_classes SET title = COALESCE($2, title), description = COALESCE($3, description), scheduled_at = COALESCE($4, scheduled_at)
         WHERE id = $1 RETURNING *`,
        [liveId, b.title, b.description, b.scheduledAt]
      );
      await logStaffActivity(db2, { userId: user.id, action: "live.updated", entityType: "live_class", entityId: liveId, courseId, req });
      await syncLiveClassReminderJob(db2, liveId).catch(
        (err) => console.error("[StaffLiveClass] reminder job sync failed:", err)
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/live-classes/:id/stream/create", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      await assertLiveStartAllowed(db2, user.id, user.role, req);
      const liveId = parseId(req.params.id);
      if (!liveId) return res.status(400).json({ message: "Invalid id" });
      const lcResult = await db2.query(`SELECT * FROM live_classes WHERE id = $1`, [liveId]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const liveClass = lcResult.rows[0];
      await assertCourseAssignment(db2, user.id, Number(liveClass.course_id), {
        subjectKey: liveClass.subject_key,
        permission: "live.start"
      });
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured" });
      }
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
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ meta: { name: liveClass.title }, recording: { mode: "automatic", timeoutSeconds: 20 } })
      });
      if (!cfRes.ok) {
        const errBody = await cfRes.text();
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
        [uid, streamKey, rtmpUrl, playbackHls, liveId]
      );
      await logStaffActivity(db2, {
        userId: user.id,
        action: "live.stream_created",
        entityType: "live_class",
        entityId: liveId,
        courseId: Number(liveClass.course_id),
        req
      });
      res.json({ uid, rtmpUrl, streamKey, playbackHls });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/tests", requireStaff2, requireStaffPermission("tests.create"), async (req, res) => {
    try {
      const user = staffUser(req);
      const { title, description, courseId, durationMinutes: durationMinutes2, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, subjectKey } = req.body || {};
      const cid = courseId != null ? parseId(courseId) : null;
      let normalizedSubjectKey = null;
      if (cid) {
        const assignment = await assertCourseAssignment(db2, user.id, cid, { permission: "tests.create" });
        normalizedSubjectKey = resolveSubjectKeyForWrite(assignment, subjectKey);
      }
      const result = await db2.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, subject_key, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12) RETURNING *`,
        [
          title,
          description,
          cid,
          durationMinutes2 || 60,
          totalMarks || 100,
          passingMarks || 35,
          testType || "practice",
          folderName || null,
          difficulty || "moderate",
          scheduledAt ? new Date(scheduledAt).getTime() : null,
          normalizedSubjectKey,
          Date.now()
        ]
      );
      if (cid && updateCourseTestCounts3) await updateCourseTestCounts3(String(cid));
      await logStaffActivity(db2, {
        userId: user.id,
        action: "test.created",
        entityType: "test",
        entityId: result.rows[0]?.id,
        courseId: cid,
        subjectKey: normalizedSubjectKey,
        req
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/tests/:id", requireStaff2, requireStaffPermission("tests.edit"), async (req, res) => {
    try {
      const user = staffUser(req);
      const testId = parseId(req.params.id);
      if (!testId) return res.status(400).json({ message: "Invalid test id" });
      const testRes = await db2.query(`SELECT * FROM tests WHERE id = $1 LIMIT 1`, [testId]);
      if (testRes.rows.length === 0) return res.status(404).json({ message: "Test not found" });
      const test = testRes.rows[0];
      if (test.course_id) {
        await assertCourseAssignment(db2, user.id, Number(test.course_id), {
          subjectKey: test.subject_key,
          permission: "tests.edit"
        });
      }
      const b = req.body || {};
      const result = await db2.query(
        `UPDATE tests SET title = COALESCE($2, title), description = COALESCE($3, description), duration_minutes = COALESCE($4, duration_minutes),
         total_marks = COALESCE($5, total_marks), passing_marks = COALESCE($6, passing_marks), folder_name = COALESCE($7, folder_name)
         WHERE id = $1 RETURNING *`,
        [testId, b.title, b.description, b.durationMinutes, b.totalMarks, b.passingMarks, b.folderName]
      );
      await logStaffActivity(db2, { userId: user.id, action: "test.updated", entityType: "test", entityId: testId, req });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/tests", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db2, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      const standalone = await db2.query(
        `SELECT t.*, NULL AS course_title FROM tests t WHERE t.course_id IS NULL ORDER BY t.created_at DESC LIMIT 200`
      );
      let courseTests = [];
      if (courseIds.length > 0) {
        const ct = await db2.query(
          `SELECT t.*, c.title AS course_title FROM tests t JOIN courses c ON c.id = t.course_id WHERE t.course_id = ANY($1::int[])`,
          [courseIds]
        );
        courseTests = ct.rows.filter((t) => {
          const a = findAssignmentForCourse(assignments, Number(t.course_id), t.subject_key);
          return !!a;
        });
      }
      res.json([...standalone.rows, ...courseTests]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/study-materials", requireStaff2, requireStaffPermission("materials.course.create"), async (req, res) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      if (!courseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db2, user.id, courseId, { permission: "materials.course.create" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const { title, description, fileUrl, fileType, sectionTitle, downloadAllowed } = req.body || {};
      const result = await db2.query(
        `INSERT INTO study_materials (course_id, title, description, file_url, file_type, section_title, subject_key, download_allowed, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [courseId, title, description || "", fileUrl, fileType || "pdf", sectionTitle || null, subjectKey, downloadAllowed || false, Date.now()]
      );
      await logStaffActivity(db2, {
        userId: user.id,
        action: "material.created",
        entityType: "material",
        entityId: result.rows[0]?.id,
        courseId,
        subjectKey,
        req
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/study-materials/:id", requireStaff2, requireStaffPermission("materials.course.edit"), async (req, res) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      const mRes = await db2.query(`SELECT * FROM study_materials WHERE id = $1`, [materialId]);
      if (mRes.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const m = mRes.rows[0];
      await assertCourseAssignment(db2, user.id, Number(m.course_id), {
        subjectKey: m.subject_key,
        permission: "materials.course.edit"
      });
      const b = req.body || {};
      const result = await db2.query(
        `UPDATE study_materials SET title = COALESCE($2, title), description = COALESCE($3, description) WHERE id = $1 RETURNING *`,
        [materialId, b.title, b.description]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/daily-missions", requireStaff2, requireStaffPermission("missions.create"), async (req, res) => {
    try {
      const user = staffUser(req);
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName, subjectKey } = req.body || {};
      const parsedCourseId = parseId(courseId);
      if (!parsedCourseId) return res.status(400).json({ message: "courseId required" });
      const assignment = await assertCourseAssignment(db2, user.id, parsedCourseId, { permission: "missions.create" });
      const normalizedSubjectKey = resolveSubjectKeyForWrite(assignment, subjectKey);
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      const result = await db2.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name, subject_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          title,
          description || "",
          JSON.stringify(questions || []),
          missionDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          xpReward || 50,
          missionType || "daily_drill",
          parsedCourseId,
          folderNameNorm,
          normalizedSubjectKey
        ]
      );
      if (recomputeAllEnrollmentsProgressForCourse3) await recomputeAllEnrollmentsProgressForCourse3(parsedCourseId).catch(() => {
      });
      await logStaffActivity(db2, {
        userId: user.id,
        action: "mission.created",
        entityType: "mission",
        entityId: result.rows[0]?.id,
        courseId: parsedCourseId,
        subjectKey: normalizedSubjectKey,
        req
      });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/daily-missions/:id", requireStaff2, requireStaffPermission("missions.edit"), async (req, res) => {
    try {
      const user = staffUser(req);
      const missionId = parseId(req.params.id);
      if (!missionId) return res.status(400).json({ message: "Invalid id" });
      const mRes = await db2.query(`SELECT * FROM daily_missions WHERE id = $1`, [missionId]);
      if (mRes.rows.length === 0) return res.status(404).json({ message: "Not found" });
      const m = mRes.rows[0];
      await assertCourseAssignment(db2, user.id, Number(m.course_id), {
        subjectKey: m.subject_key,
        permission: "missions.edit"
      });
      const b = req.body || {};
      const result = await db2.query(
        `UPDATE daily_missions SET title = COALESCE($2, title), description = COALESCE($3, description),
         questions = COALESCE($4, questions) WHERE id = $1 RETURNING *`,
        [missionId, b.title, b.description, b.questions ? JSON.stringify(b.questions) : null]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/daily-missions", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const assignments = await getStaffAssignments(db2, user.id);
      const courseIds = [...new Set(assignments.map((a) => a.course_id))];
      if (courseIds.length === 0) return res.json([]);
      const result = await db2.query(`SELECT * FROM daily_missions WHERE course_id = ANY($1::int[]) ORDER BY id DESC`, [courseIds]);
      const filtered = result.rows.filter((m) => {
        const a = findAssignmentForCourse(assignments, Number(m.course_id), m.subject_key);
        return !!a;
      });
      res.json(filtered);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/materials/folders", requireStaff2, async (req, res) => {
    try {
      const result = await db2.query(
        `SELECT * FROM standalone_folders WHERE type = 'material' ORDER BY order_index ASC, id ASC`
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load folders" });
    }
  });
  app2.get("/api/staff/materials", requireStaff2, async (req, res) => {
    try {
      const result = await db2.query(
        `SELECT * FROM study_materials WHERE course_id IS NULL ORDER BY order_index ASC, id DESC LIMIT 500`
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to load materials" });
    }
  });
  app2.post("/api/staff/materials", requireStaff2, requireStaffPermission("materials.free.create"), async (req, res) => {
    try {
      const user = staffUser(req);
      const { title, description, fileUrl, fileType, folderName } = req.body || {};
      const fileTypeNorm = String(fileType || "pdf").toLowerCase();
      if (fileTypeNorm === "youtube") {
        const ok = await db2.query(`SELECT 1 FROM staff_permission_overrides WHERE user_id = $1 AND permission_key = 'materials.youtube' AND allowed = TRUE LIMIT 1`, [
          user.id
        ]);
        const perms = await getEffectivePermissions(db2, user.id, user.role);
        if (!perms["materials.youtube"] && ok.rows.length === 0) {
          return res.status(403).json({ message: "YouTube upload requires approval" });
        }
      }
      const result = await db2.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, section_title, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title, description || "", fileUrl, fileTypeNorm, folderName || null, Date.now()]
      );
      await logStaffActivity(db2, { userId: user.id, action: "free_material.created", entityType: "material", entityId: result.rows[0]?.id, req });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.put("/api/staff/materials/:id", requireStaff2, requireStaffPermission("materials.free.edit"), async (req, res) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      const b = req.body || {};
      const result = await db2.query(
        `UPDATE study_materials SET title = COALESCE($2, title), description = COALESCE($3, description)
         WHERE id = $1 AND course_id IS NULL RETURNING *`,
        [materialId, b.title, b.description]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.delete("/api/staff/materials/:id", requireStaff2, requireStaffPermission("materials.free.delete"), async (req, res) => {
    try {
      const user = staffUser(req);
      const materialId = parseId(req.params.id);
      if (!materialId) return res.status(400).json({ message: "Invalid id" });
      await db2.query(`DELETE FROM study_materials WHERE id = $1 AND course_id IS NULL`, [materialId]);
      await logStaffActivity(db2, { userId: user.id, action: "free_material.deleted", entityType: "material", entityId: materialId, req });
      res.json({ success: true });
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.get("/api/staff/requests", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const result = await db2.query(
        `SELECT * FROM staff_access_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [user.id]
      );
      res.json(result.rows);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/requests", requireStaff2, async (req, res) => {
    try {
      const user = staffUser(req);
      const requestType = String(req.body?.requestType || req.body?.type || "").trim();
      const allowed = ["recording_upload", "youtube_materials", "student_course_access", "new_subject"];
      if (!allowed.includes(requestType)) {
        return res.status(400).json({ message: "Invalid request type" });
      }
      const result = await db2.query(
        `INSERT INTO staff_access_requests (user_id, request_type, payload, status, created_at)
         VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
        [user.id, requestType, JSON.stringify(req.body?.payload || {}), Date.now()]
      );
      await logStaffActivity(db2, { userId: user.id, action: "request.submitted", entityType: "request", entityId: result.rows[0]?.id, req });
      res.status(201).json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
  app2.post("/api/staff/course-folders", requireStaff2, requireStaffPermission("folders.create"), async (req, res) => {
    try {
      const user = staffUser(req);
      const courseId = parseId(req.body?.courseId);
      const type = String(req.body?.type || "material");
      const name = String(req.body?.name || "").trim();
      if (!courseId || !name) return res.status(400).json({ message: "courseId and name required" });
      const assignment = await assertCourseAssignment(db2, user.id, courseId, { permission: "folders.create" });
      const subjectKey = resolveSubjectKeyForWrite(assignment, req.body?.subjectKey);
      const parentId = parseId(req.body?.parentId);
      const result = await db2.query(
        `INSERT INTO course_folders (course_id, type, name, parent_id, subject_key, order_index, created_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 0), $7) RETURNING *`,
        [courseId, type, name, parentId, subjectKey, req.body?.orderIndex ?? 0, Date.now()]
      );
      res.json(result.rows[0]);
    } catch (err) {
      handleStaffError(res, err);
    }
  });
}
var init_staff_routes = __esm({
  "backend/staff-routes.ts"() {
    "use strict";
    init_staff_access_utils();
    init_staff_profile_utils();
    init_require_staff_permission();
    init_scheduled_jobs();
  }
});

// backend/auth-failure-utils.ts
function setAuthFailure(req, failure) {
  const r = req;
  if (failure) {
    r[AUTH_FAILURE_KEY] = failure;
  } else {
    delete r[AUTH_FAILURE_KEY];
  }
}
function getAuthFailure(req) {
  const f = req[AUTH_FAILURE_KEY];
  if (!f || typeof f !== "object") return null;
  const row = f;
  return row.code ? row : null;
}
function respondAuthFailureIfAny(req, res) {
  const f = getAuthFailure(req);
  if (f?.code === "SESSION_PLATFORM_MISMATCH") {
    res.status(403).json({
      message: "Please log in again on this browser or app.",
      code: f.code,
      activePlatform: f.activePlatform
    });
    return true;
  }
  return false;
}
var AUTH_FAILURE_KEY;
var init_auth_failure_utils = __esm({
  "backend/auth-failure-utils.ts"() {
    "use strict";
    AUTH_FAILURE_KEY = "__auth_failure";
  }
});

// backend/push-notifications.ts
import webpush from "web-push";
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@3ilearning.com";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
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
async function registerWebPushSubscription(db2, userId, subscription, userAgent) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth2 = String(subscription?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth2) throw new Error("Invalid web push subscription");
  const now = Date.now();
  await db2.query(
    `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_active, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6)
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       is_active = TRUE,
       last_seen_at = EXCLUDED.last_seen_at`,
    [userId, endpoint, p256dh, auth2, userAgent || null, now]
  );
}
async function unregisterWebPushSubscription(db2, userId, endpoint) {
  await db2.query(
    "UPDATE web_push_subscriptions SET is_active = FALSE, last_seen_at = $1 WHERE user_id = $2 AND endpoint = $3",
    [Date.now(), userId, endpoint]
  );
}
async function sendWebPushToUsers(db2, userIds, payload) {
  if (!configureWebPush()) return { sent: 0, subscriptions: 0 };
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, subscriptions: 0 };
  const result = await db2.query(
    "SELECT id, endpoint, p256dh, auth FROM web_push_subscriptions WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  let sent = 0;
  const inactiveIds = [];
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data || {}
  });
  for (const row of result.rows) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth }
        },
        body
      );
      sent += 1;
    } catch (err) {
      if (err?.statusCode === 404 || err?.statusCode === 410) inactiveIds.push(Number(row.id));
      else console.error("[WebPush] send failed:", err?.statusCode || err?.message || err);
    }
  }
  if (inactiveIds.length > 0) {
    await db2.query("UPDATE web_push_subscriptions SET is_active = FALSE, last_seen_at = $1 WHERE id = ANY($2::int[])", [
      Date.now(),
      inactiveIds
    ]).catch(() => {
    });
  }
  return { sent, subscriptions: result.rows.length };
}
async function sendPushToUsers(db2, userIds, payload) {
  const uniqueUserIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!uniqueUserIds.length) return { sent: 0, tokens: 0, webSent: 0, webSubscriptions: 0 };
  const webResultPromise = sendWebPushToUsers(db2, uniqueUserIds, payload).catch(() => ({ sent: 0, subscriptions: 0 }));
  const tokenResult = await db2.query(
    "SELECT expo_push_token FROM user_push_tokens WHERE is_active = TRUE AND user_id = ANY($1::int[])",
    [uniqueUserIds]
  );
  const tokens = [...new Set(tokenResult.rows.map((r) => String(r.expo_push_token || "").trim()).filter(Boolean))];
  if (!tokens.length) {
    const webResult2 = await webResultPromise;
    if (webResult2.subscriptions === 0) {
      console.warn(`[Push] No active tokens for ${uniqueUserIds.length} user(s); in-app only`);
    }
    return { sent: 0, tokens: 0, webSent: webResult2.sent, webSubscriptions: webResult2.subscriptions };
  }
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
  const webResult = await webResultPromise;
  return { sent, tokens: tokens.length, webSent: webResult.sent, webSubscriptions: webResult.subscriptions };
}
var init_push_notifications = __esm({
  "backend/push-notifications.ts"() {
    "use strict";
  }
});

// backend/notification-utils.ts
function testNotificationCopy(testType, title, contextLabel) {
  const norm = String(testType || "practice").toLowerCase();
  const notifTitle = norm === "mock" ? "\u{1F4DD} New Mock Test Added" : norm === "pyq" ? "\u{1F4DD} New PYQ Added" : "\u{1F4DD} New Test Added";
  const notifMessage = `"${title}" has been added in ${contextLabel}.`;
  return { notifTitle, notifMessage };
}
async function getAllStudentIds(db2) {
  const result = await db2.query("SELECT id FROM users WHERE role = 'student'").catch(() => ({ rows: [] }));
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
}
async function getAdminIds(db2) {
  const result = await db2.query("SELECT id FROM users WHERE role = 'admin'").catch(() => ({ rows: [] }));
  return result.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
}
async function getFolderPurchaserIds(db2, folderId) {
  const result = await db2.query("SELECT DISTINCT user_id FROM folder_purchases WHERE folder_id = $1", [folderId]).catch(() => ({ rows: [] }));
  return result.rows.map((row) => Number(row.user_id)).filter((id) => Number.isFinite(id) && id > 0);
}
async function getMiniCourseNotificationRecipients(db2, miniCourseId) {
  const folder = await db2.query("SELECT id, is_free, name FROM standalone_folders WHERE id = $1 AND type = 'mini_course' LIMIT 1", [miniCourseId]).catch(() => ({ rows: [] }));
  if (!folder.rows.length) return getAllStudentIds(db2);
  if (folder.rows[0].is_free) return getAllStudentIds(db2);
  const purchasers = await getFolderPurchaserIds(db2, miniCourseId);
  return purchasers.length > 0 ? purchasers : getAllStudentIds(db2);
}
async function notifyUsersInAppAndPush(db2, userIds, opts) {
  const recipientIds = [...new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!recipientIds.length) return;
  const now = opts.now ?? Date.now();
  const expiresAt = opts.expiresAt === void 0 ? autoNotificationExpiresAt(now) : opts.expiresAt;
  const source = opts.source ?? null;
  await db2.query(
    `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, source)
       SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7::text
       FROM unnest($1::int[]) AS u`,
    [recipientIds, opts.title, opts.message, opts.type ?? "info", now, expiresAt, source]
  ).catch(() => {
  });
  await sendPushToUsers(db2, recipientIds, {
    title: opts.title,
    body: opts.message,
    data: opts.pushData || {}
  }).catch((err) => console.error("[Notify] push failed:", err));
}
async function notifyAdminsInAppAndPush(db2, opts) {
  const adminIds = await getAdminIds(db2);
  if (!adminIds.length) return;
  const now = Date.now();
  await db2.query(
    `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, source)
       SELECT u, $2::text, $3::text, 'info', $4::bigint, NULL::bigint, $5::text
       FROM unnest($1::int[]) AS u`,
    [adminIds, opts.title, opts.message, now, ADMIN_OPS_SOURCE]
  ).catch((err) => console.error("[AdminNotify] in-app insert failed:", err));
  const pushResult = await sendPushToUsers(db2, adminIds, {
    title: opts.title,
    body: opts.message,
    data: opts.pushData || {}
  }).catch((err) => {
    console.error("[AdminNotify] push failed:", err);
    return { sent: 0, tokens: 0, webSent: 0, webSubscriptions: 0 };
  });
  console.log(
    `[AdminNotify] "${opts.title}" \u2014 admins=${adminIds.length} expoSent=${pushResult.sent}/${pushResult.tokens} webSent=${pushResult.webSent}/${pushResult.webSubscriptions}`
  );
  if ((pushResult.webSubscriptions ?? 0) === 0) {
    console.warn("[AdminNotify] hint: no active web_push_subscriptions for admin(s); browser push skipped (in-app still delivered)");
  }
}
async function dedupAdminEvent(db2, dedupKey2, actorUserId) {
  const inserted = await db2.query(
    `INSERT INTO notifications_sent (class_id, user_id, type, sent_at)
       VALUES (0, $1, $2, $3)
       ON CONFLICT (class_id, user_id, type) DO NOTHING
       RETURNING user_id`,
    [actorUserId, dedupKey2, Date.now()]
  ).catch(() => ({ rows: [] }));
  return inserted.rows.length > 0;
}
async function notifyAdminsNewDeviceLogin(db2, opts) {
  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const platform = opts.platform?.trim() || "unknown";
  await notifyAdminsInAppAndPush(db2, {
    title: "\u{1F511} Student Login (New Device)",
    message: `${name} signed in from a new device (${platform}).`,
    pushData: { type: "student_login_new_device", userId: opts.userId }
  });
}
async function notifyAdminsPurchase(db2, opts) {
  const buyer = opts.buyerName.trim() || `Student #${opts.userId}`;
  const item = opts.itemTitle.trim() || "an item";
  const kindLabel = opts.kind === "course" ? "Course" : opts.kind === "book" ? "Book" : opts.kind === "folder" ? "Test Series Folder" : "Test";
  await notifyAdminsInAppAndPush(db2, {
    title: `\u{1F4B0} New ${kindLabel} Purchase`,
    message: `${buyer} purchased ${item}.`,
    pushData: { type: "new_purchase", purchaseKind: opts.kind, userId: opts.userId, itemId: opts.itemId }
  });
}
async function notifyAdminsBuyNowTap(db2, opts) {
  const dedupKey2 = `admin_buy_now_${opts.kind}_${opts.itemId}`;
  const isNew = await dedupAdminEvent(db2, dedupKey2, opts.userId);
  if (!isNew) return;
  const buyer = opts.buyerName.trim() || `Student #${opts.userId}`;
  const item = opts.itemTitle.trim() || "an item";
  await notifyAdminsInAppAndPush(db2, {
    title: "\u{1F6D2} Buy Now \u2014 Not Purchased",
    message: `${buyer} tapped Buy Now for ${item} but did not complete payment.`,
    pushData: { type: "buy_now_abandoned", purchaseKind: opts.kind, userId: opts.userId, itemId: opts.itemId }
  });
}
async function notifyAdminsAppInstall(db2, opts) {
  const dedupKey2 = `admin_app_install_${opts.platform}_${opts.isPwa ? "pwa" : "native"}`;
  const isNew = await dedupAdminEvent(db2, dedupKey2, opts.userId);
  if (!isNew) return;
  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const label = opts.isPwa ? "web app (home screen)" : "mobile app";
  await notifyAdminsInAppAndPush(db2, {
    title: "\u{1F4F2} New App Install",
    message: `${name} added the ${label} on ${opts.platform}.`,
    pushData: { type: "app_install", userId: opts.userId, platform: opts.platform, isPwa: !!opts.isPwa }
  });
}
async function notifyAdminsCaptureAttempt(db2, opts) {
  const now = Date.now();
  const last = captureAttemptLastAt.get(opts.userId) || 0;
  if (now - last < CAPTURE_ATTEMPT_COOLDOWN_MS) return;
  captureAttemptLastAt.set(opts.userId, now);
  const name = opts.userName.trim() || `Student #${opts.userId}`;
  const action = opts.kind === "recording" ? "screen recording" : "screenshot";
  const ctx = opts.context.trim() || "protected content";
  await notifyAdminsInAppAndPush(db2, {
    title: `\u26A0\uFE0F ${opts.kind === "recording" ? "Screen Recording" : "Screenshot"} Attempt`,
    message: `${name} may have tried ${action} during ${ctx}.`,
    pushData: { type: "capture_attempt", userId: opts.userId, kind: opts.kind }
  });
}
async function notifyAdminsLiveClassCompleted(db2, liveClass) {
  const liveClassId = Number(liveClass.id);
  if (!Number.isFinite(liveClassId) || liveClassId <= 0) return;
  const adminIds = await getAdminIds(db2);
  if (!adminIds.length) return;
  const newlyNotified = [];
  const now = Date.now();
  for (const adminId of adminIds) {
    const inserted = await db2.query(
      `INSERT INTO notifications_sent (class_id, user_id, type, sent_at)
         VALUES ($1::int, $2::int, 'admin_live_completed', $3::bigint)
         ON CONFLICT (class_id, user_id, type) DO NOTHING
         RETURNING user_id`,
      [liveClassId, adminId, now]
    ).catch(() => ({ rows: [] }));
    if (inserted.rows.length > 0) newlyNotified.push(adminId);
  }
  if (!newlyNotified.length) return;
  const title = String(liveClass.title || "Live class").trim();
  await notifyAdminsInAppAndPush(db2, {
    title: "\u2705 Live Class Completed",
    message: `"${title}" has ended.`,
    pushData: {
      type: "live_class_completed",
      liveClassId,
      courseId: liveClass.course_id != null ? Number(liveClass.course_id) : null
    }
  });
}
async function notifyStandaloneTestAdded(db2, opts) {
  let contextLabel = "Tests";
  let recipientIds = [];
  if (opts.miniCourseId) {
    const folder = await db2.query("SELECT name FROM standalone_folders WHERE id = $1 LIMIT 1", [opts.miniCourseId]).catch(() => ({ rows: [] }));
    contextLabel = String(folder.rows[0]?.name || "Mini Test Series");
    recipientIds = await getMiniCourseNotificationRecipients(db2, opts.miniCourseId);
  } else {
    recipientIds = await getAllStudentIds(db2);
  }
  const { notifTitle, notifMessage } = testNotificationCopy(opts.testType, opts.title, contextLabel);
  await notifyUsersInAppAndPush(db2, recipientIds, {
    title: notifTitle,
    message: notifMessage,
    pushData: {
      type: "new_test_added",
      testId: opts.testId,
      miniCourseId: opts.miniCourseId || null
    }
  });
}
async function notifyStandaloneMaterialAdded(db2, opts) {
  const contextLabel = opts.sectionTitle?.trim() || "Study Materials";
  const recipientIds = await getAllStudentIds(db2);
  await notifyUsersInAppAndPush(db2, recipientIds, {
    title: "\u{1F4D8} New Material Added",
    message: `"${opts.title}" has been added in ${contextLabel}.`,
    pushData: { type: "new_material_added", materialId: opts.materialId }
  });
}
async function notifyStandaloneMissionAdded(db2, opts) {
  const contextLabel = opts.folderName?.trim() || "Daily Missions";
  const recipientIds = await getAllStudentIds(db2);
  await notifyUsersInAppAndPush(db2, recipientIds, {
    title: "\u{1F3AF} New Daily Mission",
    message: `"${opts.title}" has been added to ${contextLabel}.`,
    pushData: { type: "standalone_mission_added", missionId: opts.missionId }
  });
}
async function maybeNotifyAdminsStudentNewDeviceLogin(db2, opts) {
  if (opts.role !== "student") return;
  const deviceId = String(opts.deviceId || "").trim();
  if (!deviceId) return;
  const prev = await db2.query("SELECT device_id FROM users WHERE id = $1", [opts.userId]).catch(() => ({ rows: [] }));
  const prevDevice = String(prev.rows[0]?.device_id || "").trim();
  if (!prevDevice || prevDevice === deviceId) return;
  await notifyAdminsNewDeviceLogin(db2, {
    userId: opts.userId,
    userName: opts.userName,
    deviceId,
    platform: opts.platform
  }).catch((err) => console.error("[Auth] admin new-device login notify failed:", err));
}
var ADMIN_OPS_SOURCE, captureAttemptLastAt, CAPTURE_ATTEMPT_COOLDOWN_MS;
var init_notification_utils = __esm({
  "backend/notification-utils.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_push_notifications();
    ADMIN_OPS_SOURCE = "admin_ops";
    captureAttemptLastAt = /* @__PURE__ */ new Map();
    CAPTURE_ATTEMPT_COOLDOWN_MS = 5 * 60 * 1e3;
  }
});

// backend/password-utils.ts
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
  "backend/password-utils.ts"() {
    "use strict";
    pbkdf2Async = promisify(pbkdf2Cb);
    PBKDF2_ITERATIONS = 21e4;
    KEY_LEN = 64;
  }
});

// backend/auth-service.ts
import { createHmac as createHmac2, timingSafeEqual as timingSafeEqual3 } from "node:crypto";
function getTokenSecret() {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret) {
    throw new Error("OTP_HMAC_SECRET must be set");
  }
  return secret;
}
function toBase64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - input.length % 4);
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
function signRegistrationToken(payload) {
  const body = {
    ...payload,
    exp: Date.now() + REGISTRATION_TOKEN_TTL_MS
  };
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
  const expected = toBase64Url(
    createHmac2("sha256", getTokenSecret()).update(b64).digest()
  );
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
    return {
      ok: false,
      lockedUntil: lastSend + OTP_RESEND_COOLDOWN_MS,
      reason: "cooldown"
    };
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
var REGISTRATION_TOKEN_TTL_MS, OTP_RESEND_COOLDOWN_MS, OTP_SENDS_PER_CYCLE, OTP_SEND_LOCK_MS, OTP_LOCKOUT_MESSAGE, OTP_COOLDOWN_MESSAGE, GENERIC_LOGIN_ERROR, GENERIC_OTP_ERROR;
var init_auth_service = __esm({
  "backend/auth-service.ts"() {
    "use strict";
    REGISTRATION_TOKEN_TTL_MS = 15 * 60 * 1e3;
    OTP_RESEND_COOLDOWN_MS = 2 * 60 * 1e3;
    OTP_SENDS_PER_CYCLE = 3;
    OTP_SEND_LOCK_MS = 24 * 60 * 60 * 1e3;
    OTP_LOCKOUT_MESSAGE = "Too many OTP attempts. Please try again after 24 hours.";
    OTP_COOLDOWN_MESSAGE = "Please wait before requesting another OTP.";
    GENERIC_LOGIN_ERROR = "Invalid credentials";
    GENERIC_OTP_ERROR = "Invalid or expired OTP";
  }
});

// backend/user-account-purge.ts
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
  "backend/user-account-purge.ts"() {
    "use strict";
  }
});

// backend/auth-routes.ts
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
    const activeGuard = await assertSessionNotActivelyInUse(db2, req, {
      userId: Number(user.id),
      role: user.role,
      bodyDeviceId: deviceId
    });
    if (!activeGuard.ok) {
      return { success: false, httpStatus: activeGuard.httpStatus, message: activeGuard.message };
    }
    const sessionToken = generateSecureToken2();
    const normalizedDeviceId = deviceId || null;
    await maybeNotifyAdminsStudentNewDeviceLogin(db2, {
      userId: Number(user.id),
      role: String(user.role || "student"),
      userName: String(user.name || user.phone || user.email || ""),
      deviceId: normalizedDeviceId,
      platform: req ? getClientPlatform2(req) ?? void 0 : void 0
    });
    await persistLoginSession(db2, user, sessionToken, normalizedDeviceId, {
      clearOtp,
      req
    });
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
      const isDev = process.env.NODE_ENV === "development" && process.env.EXPOSE_DEV_OTP === "true";
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
        if (Date.now() > Number(user.otp_expires_at)) {
          return res.status(401).json({ message: GENERIC_OTP_ERROR });
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
        const loginGate = await assertLoginAllowedForInstallation(db2, req, {
          userId: user.id,
          role: user.role,
          bodyDeviceId: deviceId || null,
          phone: user.phone,
          email: user.email
        });
        if (!loginGate.ok) {
          return res.status(loginGate.httpStatus).json({
            message: loginGate.code ?? loginGate.message
          });
        }
        const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, true);
        if (!finalized.success) {
          return res.status(finalized.httpStatus).json({ message: finalized.message });
        }
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
      const nowMs2 = Date.now();
      const verifyLockedUntil = ch.verify_locked_until != null ? Number(ch.verify_locked_until) : 0;
      if (verifyLockedUntil > nowMs2) {
        return res.status(429).json({ message: "Too many attempts. Please try again later." });
      }
      if (nowMs2 > Number(ch.otp_expires_at || 0)) {
        return res.status(401).json({ message: GENERIC_OTP_ERROR });
      }
      if (!verifyOtpValue2(ch.otp_hash, otp)) {
        const failCount = Number(ch.verify_failed_attempts || 0) + 1;
        const lockUntil = failCount >= 5 ? nowMs2 + 15 * 60 * 1e3 : null;
        await db2.query(
          `UPDATE otp_challenges SET
             verify_failed_attempts = $1,
             verify_locked_until = COALESCE($2, verify_locked_until),
             updated_at = $3
           WHERE identifier = $4`,
          [failCount, lockUntil, nowMs2, normalizedIdentifier]
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
        [nowMs2, normalizedIdentifier]
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
        return res.status(loginGate.httpStatus).json({
          message: loginGate.code ?? loginGate.message
        });
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
            if (!bindBearer.ok && bindBearer.code === "device_binding_mismatch") {
              req.session.user = null;
              return res.status(401).json({ message: bindBearer.code });
            }
            const platBearer = await assertActiveSessionPlatformMatches(db2, req, row.id, row.role);
            if (!platBearer.ok) {
              req.session.user = null;
              return res.status(401).json({
                message: "active_on_other_platform",
                activePlatform: platBearer.activePlatform
              });
            }
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
        `SELECT id, name, email, phone, role, session_token, profile_complete,
                date_of_birth, photo_url, is_blocked,
                last_active_at, app_bound_device_id
         FROM users WHERE id = $1`,
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
      if (tok) {
        const isActive = isSessionLastActiveValid(row);
        const primaryMatches = row.session_token === tok && isActive;
        if (!primaryMatches) {
          if (row.role === "admin" || usesStaffDualSession(String(row.role ?? ""))) {
            const minAge = Date.now() - ADMIN_SESSION_MAX_AGE_MS;
            const sess = await db2.query(
              "SELECT 1 FROM user_sessions WHERE user_id = $1 AND session_token = $2 AND created_at >= $3",
              [sessionUser.id, tok, minAge]
            );
            if (sess.rows.length === 0) {
              req.session.user = null;
              return res.status(401).json({ message: "logged_in_elsewhere" });
            }
          } else {
            req.session.user = null;
            return res.status(401).json({ message: "logged_in_elsewhere" });
          }
        }
      }
      const bindSes = await enforceInstallationBinding(db2, req, sessionUser.id, row.role);
      if (!bindSes.ok && bindSes.code === "device_binding_mismatch") {
        req.session.user = null;
        return res.status(401).json({ message: bindSes.code });
      }
      const platSes = await assertActiveSessionPlatformMatches(db2, req, sessionUser.id, row.role);
      if (!platSes.ok) {
        req.session.user = null;
        return res.status(401).json({
          message: "active_on_other_platform",
          activePlatform: platSes.activePlatform
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
        photo_url: row.photo_url
      };
      req.session.user = fresh;
      res.json(fresh);
    } catch (err) {
      console.error("[auth/me] session validation failed:", err);
      req.session.user = null;
      return res.status(503).json({ message: "Unable to validate session" });
    }
  });
  app2.post("/api/auth/firebase-login", async (req, res) => {
    try {
      const { idToken, deviceId } = req.body;
      if (!idToken) return res.status(400).json({ message: "Firebase ID token is required" });
      const decoded = await verifyFirebaseToken2(idToken);
      const phoneNumber = decoded.phone_number;
      if (!phoneNumber) return res.status(400).json({ message: "Phone number not found in token" });
      const phone = normalizePhone(phoneNumber);
      if (!phone || phone.length < 10) {
        return res.status(400).json({ message: "Invalid phone number in token" });
      }
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
        return res.status(loginGate.httpStatus).json({
          message: loginGate.code ?? loginGate.message
        });
      }
      const finalized = await finalizeAuthenticatedSession(req, user, deviceId || null, false);
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
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
    let preserveStudentWebLock = false;
    if (revokeUserId) {
      const roleResult = await db2.query("SELECT role FROM users WHERE id = $1", [revokeUserId]).catch(() => ({ rows: [] }));
      preserveStudentWebLock = String(roleResult.rows[0]?.role || "").toLowerCase() !== "admin" && getClientPlatform2(req) === "web";
    }
    if (revokeUserId && revokeToken && !preserveStudentWebLock) {
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
      const digitsOnly = identifier.replace(/\D/g, "");
      const phoneCandidate = !identifier.includes("@") && digitsOnly.length >= 10 && digitsOnly.length <= 13 ? digitsOnly.slice(-10) : "";
      const isPhone = phoneCandidate.length === 10;
      console.log("[Auth] email-login: lookup start", { identifierType: isPhone ? "phone" : "email" });
      let result;
      if (isPhone) {
        result = await db2.query("SELECT * FROM users WHERE phone = $1", [phoneCandidate]);
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
        return res.status(gate.httpStatus).json({
          message: gate.code ?? gate.message
        });
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
      if (typeof password === "string" && password.length > 0 && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
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
      await notifyAdminsInAppAndPush(db2, {
        title: "\u{1F464} New User Registered",
        message: `${user.name || "A student"} just created an account.`,
        pushData: { type: "new_user_registration", userId: Number(user.id) }
      }).catch((err) => console.error("[Auth] admin registration notify failed:", err));
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
        return res.status(gate.httpStatus).json({
          message: gate.code ?? gate.message
        });
      }
      const dev = typeof deviceId === "string" ? deviceId : null;
      let finalized;
      try {
        finalized = await finalizeAuthenticatedSession(req, user, dev, true);
      } catch (finalizeErr) {
        await db2.query("DELETE FROM otp_challenges WHERE identifier = $1", [payload.identifier]).catch(() => {
        });
        throw finalizeErr;
      }
      if (!finalized.success) {
        return res.status(finalized.httpStatus).json({ message: finalized.message });
      }
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
      if (email !== void 0 && email) {
        const normalizedNewEmail = String(email).trim().toLowerCase();
        const emailConflict = await db2.query(
          "SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2",
          [normalizedNewEmail, user.id]
        );
        if (emailConflict.rows.length > 0) {
          return res.status(409).json({ message: "This email is already in use by another account" });
        }
      }
      let passwordHash = null;
      if (typeof password === "string" && password.length > 0 && password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
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
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
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
var init_auth_routes = __esm({
  "backend/auth-routes.ts"() {
    "use strict";
    init_notification_utils();
    init_password_utils();
    init_auth_service();
    init_native_device_binding();
    init_user_sessions();
    init_session_policy();
    init_user_account_purge();
  }
});

// backend/media-key-utils.ts
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
  "backend/media-key-utils.ts"() {
    "use strict";
    MEDIA_PROXY_PREFIX = "api/media/";
  }
});

// backend/r2-presign-read.ts
async function presignR2GetObject(getR2Client, objectKey, expiresInSeconds, enrollmentValidUntilMs) {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  if (!bucket || !objectKey) return null;
  try {
    const r2 = await getR2Client();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const nowMs2 = Date.now();
    const baseExpiresInSeconds = Math.min(Math.max(60, expiresInSeconds), 7 * 24 * 60 * 60);
    let effectiveExpiresInSeconds = baseExpiresInSeconds;
    if (typeof enrollmentValidUntilMs === "number") {
      const capSeconds = Math.floor((enrollmentValidUntilMs - nowMs2) / 1e3);
      if (!Number.isFinite(capSeconds) || capSeconds <= 0) return null;
      effectiveExpiresInSeconds = Math.min(baseExpiresInSeconds, Math.max(1, capSeconds));
    }
    return await getSignedUrl(
      r2,
      new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      { expiresIn: effectiveExpiresInSeconds }
    );
  } catch (err) {
    console.warn("[r2-presign-read] failed:", err?.message || err);
    return null;
  }
}
var init_r2_presign_read = __esm({
  "backend/r2-presign-read.ts"() {
    "use strict";
  }
});

// backend/pdf-routes.ts
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
    if (!key || typeof key !== "string") {
      return res.status(400).send("Missing key");
    }
    const fileKey = canonicalMediaKey(key);
    if (!fileKey) {
      return res.status(400).send("Invalid key");
    }
    const variantsForDbMatch = mediaKeyMatchVariants(key);
    let expMs = null;
    let validToken = null;
    let enrollmentValidUntilMs = null;
    if (token && typeof token === "string") {
      const tokenResult = await db2.query("SELECT user_id, expires_at FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [
        token,
        Date.now(),
        fileKey
      ]).catch(() => ({ rows: [] }));
      if (tokenResult.rows.length > 0) {
        const tokenRow = tokenResult.rows[0];
        expMs = Number(tokenRow.expires_at);
        validToken = token;
        const userId = Number(tokenRow.user_id);
        const candidates = [];
        const lectureEnroll = await db2.query(
          `SELECT e.valid_until
           FROM lectures l
           JOIN enrollments e ON e.user_id = $1 AND e.course_id = l.course_id
           WHERE l.pdf_url_normalized = ANY($2::text[])
             AND (e.status = 'active' OR e.status IS NULL)
           LIMIT 1`,
          [userId, variantsForDbMatch]
        );
        const v1 = lectureEnroll.rows[0]?.valid_until;
        if (v1 != null) candidates.push(Number(v1));
        const materialEnroll = await db2.query(
          `SELECT e.valid_until
           FROM study_materials sm
           JOIN enrollments e ON e.user_id = $1 AND e.course_id = sm.course_id
           WHERE sm.file_url_normalized = ANY($2::text[])
             AND (e.status = 'active' OR e.status IS NULL)
           LIMIT 1`,
          [userId, variantsForDbMatch]
        );
        const v2 = materialEnroll.rows[0]?.valid_until;
        if (v2 != null) candidates.push(Number(v2));
        if (candidates.length > 0) enrollmentValidUntilMs = Math.min(...candidates);
        if (enrollmentValidUntilMs != null && enrollmentValidUntilMs <= Date.now()) {
          return res.status(401).send("Token expired or invalid");
        }
      }
    }
    if (expMs === null) {
      const freeCheck = await db2.query(
        `SELECT 1 FROM study_materials
           WHERE is_free = TRUE
             AND (
               regexp_replace(
                 regexp_replace(
                   regexp_replace(COALESCE(file_url,''), '^https?://[^/]+/', ''),
                   '^/?api/media/', ''
                 ),
                 '^/+', ''
               ) = $1
               OR regexp_replace(COALESCE(file_url_normalized,''), '^/?api/media/', '') = $1
             )
           LIMIT 1`,
        [fileKey]
      ).catch(() => ({ rows: [] }));
      if (!freeCheck.rows.length) {
        return res.status(401).send("Token expired or invalid");
      }
      expMs = Date.now() + 10 * 60 * 1e3;
    }
    const ttlSec = Math.max(60, Math.floor((expMs - Date.now()) / 1e3));
    const readUrl = await presignR2GetObject(getR2Client, fileKey, ttlSec, enrollmentValidUntilMs);
    const publicBase = publicApiBaseUrl();
    const pdfUrl = readUrl || (validToken && enrollmentValidUntilMs == null ? mediaProxyUrl(publicBase, fileKey, validToken) : null);
    if (!pdfUrl) {
      return res.status(500).send("Unable to generate access URL for this file");
    }
    const withCredentials = false;
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
  "backend/pdf-routes.ts"() {
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

// backend/course-access-utils.ts
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
function enrollmentAccessState(row) {
  if (!row) return "inactive";
  const status = String(row.status ?? "active").trim().toLowerCase();
  if (status === "inactive") return "inactive";
  if (isEnrollmentExpired(row)) return "expired";
  return "active";
}
async function repairCourseEnrollmentAccess(db2, userId, courseId) {
  const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [courseId]);
  if (courseResult.rows.length === 0) return { fixed: false, reason: "course_not_found" };
  const courseRow = courseResult.rows[0];
  const existing = await db2.query(
    "SELECT id, valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2",
    [userId, courseId]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (enrollmentAccessState(row) === "active") {
      return { fixed: false, reason: "already_active" };
    }
    const at2 = Date.now();
    const vu2 = computeEnrollmentValidUntil(courseRow, at2);
    await db2.query(
      `UPDATE enrollments SET status = 'active', enrolled_at = $1, valid_until = $2 WHERE id = $3`,
      [at2, vu2, row.id]
    );
    return { fixed: true, reason: row.status === "inactive" ? "reactivated" : "renewed" };
  }
  const pay = await db2.query(
    "SELECT id FROM payments WHERE user_id = $1 AND course_id = $2 AND status = 'paid' ORDER BY created_at DESC LIMIT 1",
    [userId, courseId]
  );
  if (pay.rows.length === 0) {
    return { fixed: false, reason: "no_enrollment_or_payment" };
  }
  const at = Date.now();
  const vu = computeEnrollmentValidUntil(courseRow, at);
  const ins = await db2.query(
    `INSERT INTO enrollments (user_id, course_id, enrolled_at, valid_until, status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (user_id, course_id) DO NOTHING
     RETURNING id`,
    [userId, courseId, at, vu]
  );
  if (ins.rows.length > 0) {
    await db2.query("UPDATE courses SET total_students = COALESCE(total_students, 0) + 1 WHERE id = $1", [courseId]);
  }
  return { fixed: true, reason: "paid_sync" };
}
var init_course_access_utils = __esm({
  "backend/course-access-utils.ts"() {
    "use strict";
  }
});

// backend/idempotency.ts
import crypto2 from "node:crypto";
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
}
function requestHash(req) {
  const body = stableJson(req.body ?? {});
  return crypto2.createHash("sha256").update(body).digest("hex");
}
function getIdempotencyKey(req) {
  const raw = String(req.get("idempotency-key") || req.get("x-idempotency-key") || "").trim();
  if (!raw) return null;
  if (raw.length > 128) return raw.slice(0, 128);
  return raw;
}
async function getCachedIdempotentResponse(db2, userId, scope, idempotencyKey, reqHash) {
  const result = await db2.query(
    `SELECT status_code, response_json, request_hash
     FROM api_idempotency_keys
     WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
     ORDER BY id DESC
     LIMIT 1`,
    [userId, scope, idempotencyKey]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (String(row.request_hash) !== reqHash) {
    throw new Error("Idempotency key reuse with different payload");
  }
  return {
    statusCode: Number(row.status_code) || 200,
    responseJson: row.response_json ?? {}
  };
}
async function saveIdempotentResponse(db2, userId, scope, idempotencyKey, reqHash, statusCode, responseJson) {
  await db2.query(
    `INSERT INTO api_idempotency_keys
       (user_id, scope, idempotency_key, request_hash, response_json, status_code, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (user_id, scope, idempotency_key)
     DO UPDATE SET
       request_hash = EXCLUDED.request_hash,
       response_json = EXCLUDED.response_json,
       status_code = EXCLUDED.status_code,
       created_at = EXCLUDED.created_at`,
    [userId, scope, idempotencyKey, reqHash, JSON.stringify(responseJson ?? {}), statusCode, Date.now()]
  );
}
var init_idempotency = __esm({
  "backend/idempotency.ts"() {
    "use strict";
  }
});

// backend/validation.ts
function requireNumericBodyFields(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const raw = req.body?.[field];
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        return res.status(400).json({ message: `${field} must be a positive number` });
      }
    }
    next();
  };
}
function requireStringBodyFields(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const raw = String(req.body?.[field] ?? "").trim();
      if (!raw) {
        return res.status(400).json({ message: `${field} is required` });
      }
    }
    next();
  };
}
var init_validation = __esm({
  "backend/validation.ts"() {
    "use strict";
  }
});

// backend/payment-routes.ts
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
  const withIdempotency = async (req, userId, scope, run) => {
    const idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey) {
      const out2 = await run();
      return { statusCode: out2.statusCode ?? 200, body: out2.body };
    }
    const reqHash = requestHash(req);
    const cached = await getCachedIdempotentResponse(db2, userId, scope, idempotencyKey, reqHash);
    if (cached) {
      return { statusCode: cached.statusCode, body: cached.responseJson };
    }
    const out = await run();
    const statusCode = out.statusCode ?? 200;
    await saveIdempotentResponse(db2, userId, scope, idempotencyKey, reqHash, statusCode, out.body);
    return { statusCode, body: out.body };
  };
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
      console.error("[Payment] Failed to log payment failure:", err);
      throw err;
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
      const course = await db2.query("SELECT title, price FROM courses WHERE id = $1", [courseId]);
      const price = course.rows[0]?.price || 0;
      const courseTitle = String(course.rows[0]?.title || "a course");
      const pricePaisa = Math.round(parseFloat(String(price)) * 100);
      const now = Date.now();
      let shouldNotifyBuyNow = false;
      await runInTransaction2(async (tx) => {
        const existing = await tx.query(
          `SELECT id, status FROM payments
           WHERE user_id = $1 AND course_id = $2
           ORDER BY created_at DESC
           LIMIT 1
           FOR UPDATE`,
          [user.id, courseId]
        );
        if (existing.rows.length > 0) {
          const row = existing.rows[0];
          if (row.status !== "paid") {
            await tx.query(
              `UPDATE payments
               SET click_count = COALESCE(click_count, 1) + 1,
                   status = 'created'
               WHERE id = $1`,
              [row.id]
            );
            shouldNotifyBuyNow = true;
          }
        } else {
          await tx.query(
            `INSERT INTO payments (user_id, course_id, amount, status, click_count, created_at)
             VALUES ($1, $2, $3, 'created', 1, $4)`,
            [user.id, courseId, pricePaisa, now]
          );
          shouldNotifyBuyNow = true;
        }
      });
      if (shouldNotifyBuyNow) {
        const buyerName = String(user.name || user.phone || user.email || "A student");
        await notifyAdminsBuyNowTap(db2, {
          kind: "course",
          buyerName,
          itemTitle: courseTitle,
          userId: Number(user.id),
          itemId: Number(courseId)
        }).catch((err) => console.error("[Payment] admin buy-now notify failed:", err));
      }
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
  app2.post("/api/payments/create-order", requireNumericBodyFields(["courseId"]), async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const out = await withIdempotency(req, user.id, "payments.create-order", async () => {
        const { courseId } = req.body;
        if (!courseId) return { statusCode: 400, body: { message: "Course ID is required" } };
        const courseResult = await db2.query("SELECT * FROM courses WHERE id = $1", [courseId]);
        if (courseResult.rows.length === 0) return { statusCode: 404, body: { message: "Course not found" } };
        const course = courseResult.rows[0];
        if (course.is_free) return { statusCode: 400, body: { message: "This course is free, no payment needed" } };
        const endTs = course.end_date != null && String(course.end_date).trim() !== "" ? Date.parse(String(course.end_date).trim()) : null;
        if (Number.isFinite(endTs) && endTs < Date.now()) {
          return { statusCode: 400, body: { message: "This course has ended" } };
        }
        const existingEnrollment = await db2.query(
          "SELECT valid_until, status FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1",
          [user.id, courseId]
        );
        if (existingEnrollment.rows.length > 0) {
          const er = existingEnrollment.rows[0];
          const statusOk = er.status == null || String(er.status).toLowerCase() === "active";
          if (statusOk && !isEnrollmentExpired(er)) {
            return { statusCode: 400, body: { message: "Already enrolled" } };
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
            return { statusCode: 409, body: { message: "Duplicate payment order; try again" } };
          }
          throw insertErr;
        }
        return {
          statusCode: 200,
          body: {
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: process.env.RAZORPAY_KEY_ID,
            courseName: course.title,
            courseId
          }
        };
      });
      return res.status(out.statusCode).json(out.body);
    } catch (err) {
      console.error("Create order error:", err);
      res.status(500).json({ message: "Failed to create payment order" });
    }
  });
  app2.post(
    "/api/payments/verify",
    requireStringBodyFields(["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]),
    async (req, res) => {
      let authUserId = null;
      try {
        const user = await getAuthUser2(req);
        if (!user) return res.status(401).json({ message: "Not authenticated" });
        authUserId = Number(user.id) || null;
        const out = await withIdempotency(req, user.id, "payments.verify", async () => {
          const { razorpay_order_id, razorpay_payment_id, razorpay_signature, courseId } = req.body;
          if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return { statusCode: 400, body: { message: "Payment details are required" } };
          }
          const preBind = await assertNativePaidPurchaseInstallation(db2, user.id, req);
          if (!preBind.ok) return { statusCode: 403, body: { message: preBind.message } };
          const result = await completeCoursePaymentByOrder({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
            expectedUserId: user.id,
            expectedCourseId: courseId
          });
          await finalizeInstallationBindAfterPurchase(db2, result.userId, req);
          const [courseInfo, userInfo] = await Promise.all([
            db2.query("SELECT title, price FROM courses WHERE id = $1", [result.courseId]).catch(() => ({ rows: [] })),
            db2.query("SELECT name, phone, email FROM users WHERE id = $1", [result.userId]).catch(() => ({ rows: [] }))
          ]);
          const courseTitle = String(courseInfo.rows[0]?.title || "a course");
          const buyerName = String(userInfo.rows[0]?.name || userInfo.rows[0]?.phone || userInfo.rows[0]?.email || "A student");
          await notifyAdminsPurchase(db2, {
            kind: "course",
            buyerName,
            itemTitle: courseTitle,
            userId: result.userId,
            itemId: result.courseId
          }).catch((err) => console.error("[Payment] admin purchase notify failed:", err));
          console.log("[Payments] verify success");
          return { statusCode: 200, body: { success: true, message: "Payment verified and enrolled successfully" } };
        });
        return res.status(out.statusCode).json(out.body);
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
    }
  );
  app2.post("/api/payments/sync-enrollment", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      if (respondAuthFailureIfAny(req, res)) return;
      const courseId = Number(req.body?.courseId);
      if (!Number.isFinite(courseId)) {
        return res.status(400).json({ message: "courseId is required" });
      }
      const result = await repairCourseEnrollmentAccess(db2, user.id, courseId);
      return res.json({
        ok: true,
        fixed: result.fixed,
        message: result.fixed ? "Enrollment synced" : result.reason
      });
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
  app2.post("/api/tests/create-order", requireNumericBodyFields(["testId"]), async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const out = await withIdempotency(req, user.id, "tests.create-order", async () => {
        const { testId } = req.body;
        const testResult = await db2.query("SELECT id, title, price FROM tests WHERE id = $1", [testId]);
        if (testResult.rows.length === 0) return { statusCode: 404, body: { message: "Test not found" } };
        const test = testResult.rows[0];
        if (!test.price || parseFloat(test.price) <= 0) return { statusCode: 400, body: { message: "This test is free" } };
        const existing = await db2.query("SELECT id FROM test_purchases WHERE user_id = $1 AND test_id = $2", [user.id, testId]);
        if (existing.rows.length > 0) return { statusCode: 200, body: { alreadyPurchased: true } };
        const amount = Math.round(parseFloat(test.price) * 100);
        const razorpay = getRazorpay2();
        const order = await razorpay.orders.create({
          amount,
          currency: "INR",
          receipt: `test_${testId}_user_${user.id}_${Date.now()}`,
          notes: { testId: String(testId), userId: String(user.id), kind: "test" }
        });
        const buyerName = String(user.name || user.phone || user.email || "A student");
        await notifyAdminsBuyNowTap(db2, {
          kind: "test",
          buyerName,
          itemTitle: String(test.title || "a test"),
          userId: Number(user.id),
          itemId: Number(testId)
        }).catch((err) => console.error("[Tests] admin buy-now notify failed:", err));
        return {
          statusCode: 200,
          body: { orderId: order.id, amount, currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, testName: test.title }
        };
      });
      return res.status(out.statusCode).json(out.body);
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
      const [testInfo, userInfo] = await Promise.all([
        db2.query("SELECT title FROM tests WHERE id = $1", [testId]).catch(() => ({ rows: [] })),
        db2.query("SELECT name, phone, email FROM users WHERE id = $1", [userId]).catch(() => ({ rows: [] }))
      ]);
      await notifyAdminsPurchase(db2, {
        kind: "test",
        buyerName: String(userInfo.rows[0]?.name || userInfo.rows[0]?.phone || userInfo.rows[0]?.email || "A student"),
        itemTitle: String(testInfo.rows[0]?.title || "a test"),
        userId,
        itemId: testId
      }).catch((err) => console.error("[Tests] admin purchase notify failed:", err));
      return res.redirect(`${frontendBase}/test-series?payment=success&testId=${testId}`);
    } catch (err) {
      console.error("[Tests] verify-redirect failed:", err);
      return res.redirect(fail);
    }
  });
  app2.post(
    "/api/tests/verify-payment",
    requireStringBodyFields(["razorpay_order_id", "razorpay_payment_id", "razorpay_signature"]),
    requireNumericBodyFields(["testId"]),
    async (req, res) => {
      try {
        const user = await getAuthUser2(req);
        if (!user) return res.status(401).json({ message: "Not authenticated" });
        const out = await withIdempotency(req, user.id, "tests.verify-payment", async () => {
          const { razorpay_order_id, razorpay_payment_id, razorpay_signature, testId } = req.body;
          const parsedTestId = Number(testId);
          if (!parsedTestId) return { statusCode: 400, body: { message: "testId is required" } };
          const isValid = verifyPaymentSignature2(razorpay_order_id, razorpay_payment_id, razorpay_signature);
          if (!isValid) return { statusCode: 400, body: { message: "Invalid payment signature" } };
          const testResult = await db2.query("SELECT id, price FROM tests WHERE id = $1", [parsedTestId]);
          if (!testResult.rows.length) return { statusCode: 404, body: { message: "Test not found" } };
          const expectedAmount = Math.round(parseFloat(String(testResult.rows[0].price || "0")) * 100);
          await verifyOrderOwnershipAndAmount({
            orderId: razorpay_order_id,
            expectedKind: "test",
            expectedUserId: user.id,
            expectedItemId: parsedTestId,
            expectedAmount
          });
          const preTest = await assertNativePaidPurchaseInstallation(db2, user.id, req);
          if (!preTest.ok) return { statusCode: 403, body: { message: preTest.message } };
          await db2.query(
            "INSERT INTO test_purchases (user_id, test_id, razorpay_order_id, razorpay_payment_id, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, test_id) DO NOTHING",
            [user.id, parsedTestId, razorpay_order_id, razorpay_payment_id, Date.now()]
          );
          await finalizeInstallationBindAfterPurchase(db2, user.id, req);
          const testTitle = String(testResult.rows[0]?.title || "a test");
          const buyerName = String(user.name || user.phone || user.email || "A student");
          await notifyAdminsPurchase(db2, {
            kind: "test",
            buyerName,
            itemTitle: testTitle,
            userId: Number(user.id),
            itemId: parsedTestId
          }).catch((err) => console.error("[Tests] admin purchase notify failed:", err));
          return { statusCode: 200, body: { success: true } };
        });
        return res.status(out.statusCode).json(out.body);
      } catch (err) {
        console.error("Test verify-payment error:", err);
        res.status(500).json({ message: "Failed to verify payment" });
      }
    }
  );
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
  "backend/payment-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_auth_failure_utils();
    init_notification_utils();
    init_native_device_binding();
    init_idempotency();
    init_validation();
  }
});

// backend/sse-listen-budget.ts
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
  "backend/sse-listen-budget.ts"() {
    "use strict";
    activeListenStreams = 0;
  }
});

// backend/support-routes.ts
function registerSupportRoutes({
  app: app2,
  db: db2,
  pool: pool2,
  listenPool: listenPool2,
  getAuthUser: getAuthUser2,
  requireAuth,
  requireAdmin: requireAdmin2
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
      await notifyAdminsInAppAndPush(db2, {
        title: "\u{1F4AC} New Support Message",
        message: `Student #${user.id}: ${message.trim().slice(0, 80)}`,
        pushData: { type: "support_message", userId: Number(user.id), messageId: result.rows[0]?.id }
      }).catch((err) => console.error("[Support] admin notify failed:", err));
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });
  app2.get("/api/admin/support/conversations", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/support/messages/:userId", requireAdmin2, async (req, res) => {
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
  app2.get("/api/admin/support/messages/:userId/stream", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/support/messages/:userId/mark-read", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/support/messages/:userId", requireAdmin2, async (req, res) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db2.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'admin', $2, $3) RETURNING *",
        [req.params.userId, message.trim().slice(0, 1e3), Date.now()]
      );
      const row = result.rows[0];
      try {
        await db2.query("SELECT pg_notify('support_chat', $1)", [
          JSON.stringify({ userId: Number(req.params.userId), id: row.id })
        ]);
      } catch (notifyErr) {
        console.error("[SupportAdmin] pg_notify failed for reply to userId=%s msgId=%s:", req.params.userId, row.id, notifyErr);
      }
      res.json(row);
    } catch {
      res.status(500).json({ message: "Failed to send reply" });
    }
  });
}
var SUPPORT_POST_WINDOW_MS, SUPPORT_POST_MAX;
var init_support_routes = __esm({
  "backend/support-routes.ts"() {
    "use strict";
    init_pg_rate_limit_store();
    init_notification_utils();
    init_sse_listen_budget();
    SUPPORT_POST_WINDOW_MS = 10 * 60 * 1e3;
    SUPPORT_POST_MAX = 20;
  }
});

// backend/live-class-access.ts
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
  "backend/live-class-access.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// backend/live-chat-routes.ts
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
  requireAdmin: requireAdmin2
}) {
  const listenPoolMax = listenPool2.options.max ?? 32;
  app2.get("/api/live-classes/:id/chat", async (req, res) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db2, getAuthUser2, req.params.id);
      if (!hasAccess) return;
      const { after, before } = req.query;
      const PAGE_SIZE = 50;
      let rows;
      if (after) {
        const result = await db2.query(
          "SELECT * FROM live_chat_messages WHERE live_class_id = $1 AND created_at > $2 ORDER BY created_at ASC LIMIT $3",
          [req.params.id, after, PAGE_SIZE]
        );
        rows = result.rows;
      } else if (before) {
        const result = await db2.query(
          "SELECT * FROM live_chat_messages WHERE live_class_id = $1 AND created_at < $2 ORDER BY created_at DESC LIMIT $3",
          [req.params.id, before, PAGE_SIZE]
        );
        rows = result.rows.reverse();
      } else {
        const result = await db2.query(
          "SELECT * FROM live_chat_messages WHERE live_class_id = $1 ORDER BY created_at DESC LIMIT $2",
          [req.params.id, PAGE_SIZE]
        );
        rows = result.rows.reverse();
      }
      res.set("Cache-Control", "private, no-store");
      res.json(rows);
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
  app2.delete("/api/admin/live-classes/:lcId/chat/:msgId", requireAdmin2, async (req, res) => {
    try {
      await db2.query("DELETE FROM live_chat_messages WHERE id = $1 AND live_class_id = $2", [req.params.msgId, req.params.lcId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });
}
var init_live_chat_routes = __esm({
  "backend/live-chat-routes.ts"() {
    "use strict";
    init_live_class_access();
    init_sse_listen_budget();
  }
});

// backend/listen-pool.ts
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
  "backend/listen-pool.ts"() {
    "use strict";
  }
});

// backend/live-class-engagement-routes.ts
function registerLiveClassEngagementRoutes({
  app: app2,
  db: db2,
  requireAuth,
  requireAdmin: requireAdmin2
}) {
  app2.get("/api/live-classes/:id/recording-progress", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const result = await db2.query(
        "SELECT watch_percent, COALESCE(last_position_seconds, 0) AS last_position_seconds FROM live_class_recording_progress WHERE user_id = $1 AND live_class_id = $2",
        [user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.json({ watch_percent: 0, last_position_seconds: 0 });
      res.json(result.rows[0]);
    } catch {
      res.json({ watch_percent: 0, last_position_seconds: 0 });
    }
  });
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
      const lastPositionSeconds = Math.max(0, Math.floor(Number(body.lastPositionSeconds) || 0));
      const now = Date.now();
      const debounceMs = 8 * 60 * 1e3;
      if (watchPercentRaw != null && Number.isFinite(watchPercentRaw)) {
        const wp = Math.max(0, Math.min(100, Math.round(watchPercentRaw)));
        await db2.query(
          `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at, last_position_seconds)
           VALUES ($1, $2, $3, 0, NULL, $4, $5)
           ON CONFLICT (user_id, live_class_id) DO UPDATE SET
             watch_percent = GREATEST(live_class_recording_progress.watch_percent, EXCLUDED.watch_percent),
             last_position_seconds = EXCLUDED.last_position_seconds,
             updated_at = EXCLUDED.updated_at`,
          [user.id, req.params.id, wp, now, lastPositionSeconds]
        );
      }
      if (openSession) {
        const prev = await db2.query(
          "SELECT playback_sessions, last_session_ping_at FROM live_class_recording_progress WHERE user_id = $1 AND live_class_id = $2",
          [user.id, req.params.id]
        );
        const row = prev.rows[0];
        const canBump = !row?.last_session_ping_at || now - Number(row.last_session_ping_at) >= debounceMs;
        if (!row || canBump) {
          await db2.query(
            `INSERT INTO live_class_recording_progress (user_id, live_class_id, watch_percent, playback_sessions, last_session_ping_at, updated_at)
             VALUES ($1, $2, 0, 1, $3, $3)
             ON CONFLICT (user_id, live_class_id) DO UPDATE SET
               playback_sessions = CASE
                 WHEN live_class_recording_progress.last_session_ping_at IS NULL OR $3 - live_class_recording_progress.last_session_ping_at >= $4
                 THEN COALESCE(live_class_recording_progress.playback_sessions, 0) + 1
                 ELSE COALESCE(live_class_recording_progress.playback_sessions, 0)
               END,
               last_session_ping_at = CASE
                 WHEN live_class_recording_progress.last_session_ping_at IS NULL OR $3 - live_class_recording_progress.last_session_ping_at >= $4
                 THEN $3
                 ELSE live_class_recording_progress.last_session_ping_at
               END,
               updated_at = $3`,
            [user.id, req.params.id, now, debounceMs]
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
      const hb = await db2.query(
        `INSERT INTO live_class_viewers (live_class_id, user_id, user_name, last_heartbeat)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (live_class_id, user_id) DO UPDATE SET
           last_heartbeat = EXCLUDED.last_heartbeat,
           user_name = COALESCE(EXCLUDED.user_name, live_class_viewers.user_name)
         WHERE live_class_viewers.last_heartbeat IS NULL
            OR EXCLUDED.last_heartbeat - live_class_viewers.last_heartbeat >= 8000
         RETURNING user_id`,
        [req.params.id, user.id, user.name || user.phone || "Anonymous", now]
      );
      if (hb.rows.length > 0) {
        try {
          await db2.query(`SELECT pg_notify('live_engagement', $1)`, [
            JSON.stringify({ type: "viewer", liveClassId: String(req.params.id) })
          ]);
        } catch {
        }
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer heartbeat error:", err);
      res.status(500).json({ message: "Failed to update heartbeat" });
    }
  });
  app2.delete("/api/live-classes/:id/viewers/heartbeat", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      await db2.query(
        `UPDATE live_class_viewers
         SET last_heartbeat = 0
         WHERE live_class_id = $1 AND user_id = $2`,
        [req.params.id, user.id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Viewer leave error:", err);
      res.status(500).json({ message: "Failed to update viewer leave" });
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
      const cutoff = Date.now() - 2e4;
      const result = await db2.query(
        `SELECT user_id, user_name FROM live_class_viewers
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
  app2.get("/api/admin/live-classes/:id/raised-hands", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/live-classes/:id/raised-hands/:userId/resolve", requireAdmin2, async (req, res) => {
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
  "backend/live-class-engagement-routes.ts"() {
    "use strict";
    init_live_class_access();
  }
});

// shared/recordingSection.ts
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
  "shared/recordingSection.ts"() {
    "use strict";
    DEFAULT_LIVE_RECORDING_SECTION = "Live Class Recordings";
  }
});

// backend/live-class-recording-save.ts
function inferVideoType(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
  return "r2";
}
async function saveRecordingForClassAndPeers(db2, liveClassId, recordingUrl, opts = {}) {
  const lcResult = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  if (lcResult.rows.length === 0) {
    throw new Error("Live class not found");
  }
  const liveClass = lcResult.rows[0];
  if (liveClass.recording_deleted_at) {
    return { lectureId: null, lectureIds: [] };
  }
  const lectureIds = [];
  const endedAt = Date.now();
  for (const row of [liveClass]) {
    if (row.recording_deleted_at) continue;
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
      opts.sectionTitle
    );
    const visibleAfterAt = row.is_recording_mode && row.visible_after_at ? Number(row.visible_after_at) : null;
    const lectureResult = await db2.query(
      `INSERT INTO lectures (
         course_id, title, description, video_url, video_type, duration_minutes,
         order_index, is_free_preview, section_title, live_class_id, live_class_finalized,
         visible_after_at, subject_key, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12, $13)
       ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
       DO UPDATE SET
         course_id = EXCLUDED.course_id,
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         video_url = CASE
           WHEN $4::text ~* '\\.(png|jpe?g|webp|gif)(\\?|$)' AND lectures.video_url IS NOT NULL
             AND lectures.video_url !~* '\\.(png|jpe?g|webp|gif)(\\?|$)'
           THEN lectures.video_url
           ELSE EXCLUDED.video_url
         END,
         video_type = CASE
           WHEN $4::text ~* '\\.(png|jpe?g|webp|gif)(\\?|$)' AND lectures.video_url IS NOT NULL
             AND lectures.video_url !~* '\\.(png|jpe?g|webp|gif)(\\?|$)'
           THEN lectures.video_type
           ELSE EXCLUDED.video_type
         END,
         duration_minutes = EXCLUDED.duration_minutes,
         section_title = EXCLUDED.section_title,
         visible_after_at = EXCLUDED.visible_after_at,
        subject_key = EXCLUDED.subject_key,
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
        visibleAfterAt,
        row.subject_key || null,
        Date.now()
      ]
    );
    lectureIds.push(Number(lectureResult.rows[0]?.id));
    if (opts.recomputeCourseProgress) {
      await opts.recomputeCourseProgress(row.course_id);
    }
    const visibleNow = !visibleAfterAt || Number(visibleAfterAt) <= Date.now();
    if (visibleNow) {
      const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [row.course_id]).catch(() => ({ rows: [] }));
      const courseTitle = String(courseInfo.rows[0]?.title || "your course");
      const notifTitle = "\u{1F4F9} Class Recording Available";
      const notifMessage = `"${row.title}" recording is now available in ${courseTitle}.`;
      await notifyEnrolledCourseStudents(db2, row.course_id, {
        title: notifTitle,
        message: notifMessage,
        pushData: {
          type: "class_recording_available",
          liveClassId: Number(row.id),
          courseId: Number(row.course_id)
        },
        sendPush: (userIds, payload) => sendPushToUsers(db2, userIds, payload)
      });
    }
  }
  return { lectureId: lectureIds[0] ?? null, lectureIds };
}
var init_live_class_recording_save = __esm({
  "backend/live-class-recording-save.ts"() {
    "use strict";
    init_recordingSection();
    init_auto_notification_expiry();
    init_push_notifications();
  }
});

// backend/cloudflare-stream-download.ts
function parseDefaultDownload(payload) {
  const def = payload?.result?.default;
  if (!def || typeof def !== "object") return null;
  const status = String(def.status || "").toLowerCase();
  if (status !== "ready" && status !== "inprogress" && status !== "error") return null;
  return {
    status,
    url: def.url ? String(def.url) : void 0,
    percentComplete: Number(def.percentComplete ?? def.percent_complete ?? 0)
  };
}
async function createCloudflareStreamDownload(accountId, apiToken, videoUid) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}/downloads`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` }
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    console.warn(
      `[CF Stream] POST downloads failed uid=${videoUid} status=${res.status} body=${JSON.stringify(data?.errors || data).slice(0, 200)}`
    );
    return null;
  }
  return parseDefaultDownload(data);
}
async function getCloudflareStreamDownload(accountId, apiToken, videoUid) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}/downloads`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) return null;
  return parseDefaultDownload(data);
}
async function ensureCloudflareMp4DownloadUrl(accountId, apiToken, videoUid, options) {
  const maxWaitMs = options?.maxWaitMs ?? Number(process.env.CF_STREAM_DOWNLOAD_MAX_WAIT_MS || 45 * 60 * 1e3);
  const pollMs = options?.pollMs ?? Number(process.env.CF_STREAM_DOWNLOAD_POLL_MS || 1e4);
  const created = await createCloudflareStreamDownload(accountId, apiToken, videoUid);
  if (created?.status === "ready" && created.url) {
    console.log(`[CF Stream] MP4 download already ready uid=${videoUid}`);
    return created.url;
  }
  if (created?.status === "inprogress") {
    console.log(
      `[CF Stream] MP4 download generation started uid=${videoUid} pct=${created.percentComplete ?? 0}`
    );
  } else if (created) {
    console.log(`[CF Stream] MP4 download create status=${created.status} uid=${videoUid}`);
  } else {
    console.log(`[CF Stream] MP4 download create pending (will poll) uid=${videoUid}`);
  }
  const deadline = Date.now() + maxWaitMs;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    const state = await getCloudflareStreamDownload(accountId, apiToken, videoUid);
    if (state?.status === "ready" && state.url) {
      console.log(`[CF Stream] MP4 download ready uid=${videoUid}`);
      return state.url;
    }
    if (state?.status === "error") {
      console.warn(`[CF Stream] MP4 download generation error uid=${videoUid}`);
      return null;
    }
    const now = Date.now();
    if (now - lastLogAt > 6e4) {
      lastLogAt = now;
      console.log(
        `[CF Stream] MP4 download in progress uid=${videoUid} pct=${state?.percentComplete ?? "?"}`
      );
    }
    await sleep(pollMs);
  }
  console.warn(`[CF Stream] MP4 download timed out uid=${videoUid} maxWaitMs=${maxWaitMs}`);
  return null;
}
function buildLegacyMp4CandidateUrls(recordingUid) {
  const configuredDownloadBase = String(process.env.CF_STREAM_DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");
  return [
    `https://videodelivery.net/${recordingUid}/downloads/default.mp4`,
    configuredDownloadBase ? `${configuredDownloadBase}/${recordingUid}/downloads/default.mp4` : ""
  ].filter(Boolean);
}
var sleep;
var init_cloudflare_stream_download = __esm({
  "backend/cloudflare-stream-download.ts"() {
    "use strict";
    sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
  }
});

// backend/cloudflare-stream-api.ts
function normalizeCfVideoItems(payload) {
  const raw = payload?.result;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.videos)) return raw.videos;
  if (Array.isArray(payload?.videos)) return payload.videos;
  return [];
}
function pickBestCfRecording(items, excludeUid) {
  if (!items.length) return null;
  const filtered = items.filter((v) => {
    const id = String(v?.uid || v?.id || "");
    return id && (!excludeUid || id !== excludeUid);
  });
  const pool2 = filtered.length ? filtered : items;
  const statusRank = (s) => {
    const x = String(s || "").toLowerCase();
    if (x === "ready") return 0;
    if (x === "inprogress" || x.includes("progress") || x === "queued" || x === "downloading") return 1;
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
  const best = sorted[0];
  const recordingUid = String(best?.uid || best?.id || "").trim();
  if (!recordingUid || recordingUid === excludeUid) return null;
  return {
    recordingUid,
    manifestUrl: `https://videodelivery.net/${recordingUid}/manifest/video.m3u8`,
    status: String(best?.status || "unknown")
  };
}
async function getLatestRecordingForLiveInput(accountId, apiToken, liveInputUid) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${liveInputUid}/videos`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) {
      console.warn("[CF Stream API] live_inputs videos HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const items = normalizeCfVideoItems(data);
    if (!items.length) return null;
    return pickBestCfRecording(items, liveInputUid);
  } catch {
    return null;
  }
}
async function getCfVideoByUid(accountId, apiToken, videoUid) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) {
      console.warn("[CF Stream API] get video HTTP", res.status, `uid=${videoUid}`);
      return null;
    }
    const data = await res.json();
    const vid = data?.result;
    const uid = String(vid?.uid || "").trim();
    if (!uid) return null;
    return {
      recordingUid: uid,
      manifestUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      status: String(vid?.status?.state || vid?.status || "unknown")
    };
  } catch {
    return null;
  }
}
async function findRecordingViaStreamSearch(accountId, apiToken, liveClassTitle, excludeLiveInputUid) {
  const q = String(liveClassTitle || "").trim();
  if (q.length < 2) return null;
  try {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`);
    u.searchParams.set("search", q);
    u.searchParams.set("limit", "40");
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiToken}` }
    });
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
}
var init_cloudflare_stream_api = __esm({
  "backend/cloudflare-stream-api.ts"() {
    "use strict";
  }
});

// backend/live-stream-routes.ts
function registerLiveStreamRoutes({
  app: app2,
  db: db2,
  pool: pool2,
  requireAdmin: requireAdmin2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3,
  getR2Client
}) {
  const archiveRetryState = /* @__PURE__ */ new Map();
  const MAX_ARCHIVE_ATTEMPTS = 48;
  const inferVideoType3 = (url) => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };
  const sleep2 = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
  const extractCloudflareRecordingUid = (url) => {
    const m = String(url || "").match(/videodelivery\.net\/([^/]+)\/manifest\/video\.m3u8/i);
    return m?.[1] ? String(m[1]) : null;
  };
  const toMediaApiPath = (key) => `/api/media/${key}`;
  const archiveCloudflareRecordingToR2 = async (recordingUid, cf) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return null;
      const now = Date.now();
      const retryState = archiveRetryState.get(recordingUid);
      if (retryState && retryState.nextAttemptAt > now) {
        return null;
      }
      const accountId = cf?.accountId || process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = cf?.apiToken || process.env.CF_STREAM_API_TOKEN;
      let mp4Url = null;
      if (accountId && apiToken) {
        mp4Url = await ensureCloudflareMp4DownloadUrl(String(accountId), String(apiToken), recordingUid);
      }
      const candidateUrls = mp4Url ? [mp4Url] : buildLegacyMp4CandidateUrls(recordingUid);
      let source = null;
      let matchedUrl = "";
      for (const candidateUrl of candidateUrls) {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 3e5);
        let resp;
        try {
          resp = await fetch(candidateUrl, { signal: controller.signal });
        } finally {
          clearTimeout(fetchTimeout);
        }
        if (resp.ok && resp.body) {
          source = resp;
          matchedUrl = candidateUrl;
          archiveRetryState.delete(recordingUid);
          break;
        }
        const prev = archiveRetryState.get(recordingUid) || { attempts: 0, nextAttemptAt: 0, lastStatus: null };
        const attempts = prev.attempts + 1;
        if (attempts >= MAX_ARCHIVE_ATTEMPTS) {
          archiveRetryState.delete(recordingUid);
          console.warn(
            `[CF Stream] MP4 fetch permanently abandoned uid=${recordingUid} status=${resp.status} after ${attempts} attempts`
          );
        } else {
          const backoffMs = Math.min(6 * 60 * 60 * 1e3, Math.max(2 * 60 * 1e3, attempts * 10 * 60 * 1e3));
          archiveRetryState.set(recordingUid, {
            attempts,
            nextAttemptAt: Date.now() + backoffMs,
            lastStatus: resp.status
          });
          if (attempts === 1 || attempts % 10 === 0) {
            console.warn(
              `[CF Stream] MP4 fetch not ready uid=${recordingUid} status=${resp.status} attempt=${attempts} nextRetryInMs=${backoffMs}`
            );
          }
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
  const normalizeCfVideoItems2 = (payload) => {
    const raw = payload?.result;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.videos)) return raw.videos;
    if (Array.isArray(payload?.videos)) return payload.videos;
    return [];
  };
  const pickBestCfRecording2 = (items, excludeUid) => {
    if (!items.length) return null;
    const filtered = items.filter((v) => {
      const id = String(v?.uid || v?.id || "");
      return id && (!excludeUid || id !== excludeUid);
    });
    const pool3 = filtered.length ? filtered : items;
    const statusRank = (s) => {
      const x = String(s || "").toLowerCase();
      if (x === "ready") return 0;
      if (x.includes("progress") || x === "queued" || x === "downloading") return 1;
      return 2;
    };
    const sorted = [...pool3].sort((a, b) => {
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
  const getLatestRecordingForLiveInput2 = getLatestRecordingForLiveInput;
  const findRecordingViaStreamSearch2 = findRecordingViaStreamSearch;
  const saveRecordingForClassAndPeers2 = (liveClassId, recordingUrl, sectionTitle) => saveRecordingForClassAndPeers(db2, liveClassId, recordingUrl, {
    sectionTitle,
    recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse3
  });
  app2.post("/api/admin/live-classes/:id/stream/create", requireAdmin2, async (req, res) => {
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
  app2.get("/api/admin/live-classes/:id/stream/status", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/live-classes/:id/stream/end", requireAdmin2, async (req, res) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) return res.status(500).json({ message: "CF Stream credentials not configured" });
      const lcResult = await db2.query(
        "SELECT id, title, cf_stream_uid, cf_recording_uid, is_completed, recording_url, recording_deleted_at FROM live_classes WHERE id = $1",
        [req.params.id]
      );
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const current = lcResult.rows[0];
      const uid = current?.cf_stream_uid;
      const liveTitle = String(current?.title || "").trim();
      const existingRecordingUrl = String(current?.recording_url || "").trim();
      const storedCfRecordingUid = current?.cf_recording_uid != null ? String(current.cf_recording_uid).trim() : "";
      if (current?.recording_deleted_at) {
        return res.json({ success: true, alreadyEnded: true, recordingDeleted: true });
      }
      if (current?.is_completed === true && !!existingRecordingUrl) {
        return res.json({ success: true, alreadyEnded: true, recordingUrl: existingRecordingUrl });
      }
      const endedAtNow = Date.now();
      const wasCompleted = current?.is_completed === true;
      await db2.query(
        "UPDATE live_classes SET is_live = FALSE, ended_at = COALESCE(ended_at, $1), is_completed = TRUE WHERE id = $2",
        [endedAtNow, req.params.id]
      ).catch(() => {
      });
      if (!wasCompleted) {
        await notifyAdminsLiveClassCompleted(db2, {
          id: req.params.id,
          title: liveTitle || current?.title,
          course_id: current?.course_id
        }).catch((err) => console.error("[CF Stream] admin completion notify failed:", err));
      }
      await db2.query(
        `INSERT INTO live_stream_finalize_jobs
           (live_class_id, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES ($1, 'pending', 0, $2, $2, $2)
         ON CONFLICT DO NOTHING`,
        [Number(req.params.id), endedAtNow]
      ).catch(() => {
      });
      if (!uid) return res.json({ success: true });
      res.json({ success: true, recordingPending: true });
      const getLatestRecording = async () => getLatestRecordingForLiveInput2(accountId, apiToken, uid);
      void (async () => {
        try {
          let recordingUrl = null;
          const maxPolls = Number(process.env.CF_STREAM_END_MAX_POLLS || 48);
          const pollMs = Number(process.env.CF_STREAM_END_POLL_MS || 5e3);
          for (let i = 0; i < maxPolls; i += 1) {
            const latest = await getLatestRecording();
            if (latest) {
              await db2.query(
                "UPDATE live_classes SET cf_recording_uid = $1 WHERE id = $2",
                [latest.recordingUid, req.params.id]
              ).catch(() => {
              });
              const archived = await archiveCloudflareRecordingToR2(latest.recordingUid, {
                accountId,
                apiToken
              });
              recordingUrl = archived || latest.manifestUrl;
              break;
            }
            await new Promise((resolve2) => setTimeout(resolve2, pollMs));
          }
          if (!recordingUrl) {
            if (storedCfRecordingUid) {
              const archived = await archiveCloudflareRecordingToR2(storedCfRecordingUid, {
                accountId,
                apiToken
              });
              recordingUrl = archived || null;
            }
            if (!recordingUrl && liveTitle) {
              const viaSearch = await findRecordingViaStreamSearch2(accountId, apiToken, liveTitle, uid);
              if (viaSearch) {
                await db2.query(
                  "UPDATE live_classes SET cf_recording_uid = $1 WHERE id = $2",
                  [viaSearch.recordingUid, req.params.id]
                ).catch(() => {
                });
                const archived = await archiveCloudflareRecordingToR2(viaSearch.recordingUid, {
                  accountId,
                  apiToken
                });
                recordingUrl = archived || viaSearch.manifestUrl;
                console.log(`[CF Stream] Resolved recording via stream search title="${liveTitle.slice(0, 60)}"`);
              }
            }
          }
          if (recordingUrl) {
            try {
              await saveRecordingForClassAndPeers2(String(req.params.id), recordingUrl);
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
  app2.post("/api/admin/live-classes/:id/recording", requireAdmin2, async (req, res) => {
    try {
      const { recordingUrl, sectionTitle } = req.body;
      if (!recordingUrl) {
        return res.status(400).json({ message: "recordingUrl is required" });
      }
      const { lectureId, lectureIds } = await saveRecordingForClassAndPeers2(
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
  const ARCHIVE_SWEEP_ADVISORY_LOCK_KEY = 7777777777;
  let isArchiveSweepRunning = false;
  const runArchiveSweep = async () => {
    if (isArchiveSweepRunning) return;
    let lockClient = null;
    let lockAcquired = false;
    if (pool2) {
      try {
        lockClient = await pool2.connect();
        const lockResult = await lockClient.query(
          "SELECT pg_try_advisory_lock($1) AS acquired",
          [ARCHIVE_SWEEP_ADVISORY_LOCK_KEY]
        );
        lockAcquired = lockResult.rows[0]?.acquired === true;
        if (!lockAcquired) {
          lockClient.release();
          return;
        }
      } catch (lockErr) {
        console.warn("[CF Stream] Archive sweep advisory lock error:", lockErr);
        if (lockClient) lockClient.release();
        return;
      }
    }
    isArchiveSweepRunning = true;
    try {
      const pending = await db2.query(
        `SELECT id, title, description, course_id, started_at, lecture_section_title, lecture_subfolder_title, recording_url, cf_stream_uid, recording_deleted_at, subject_key
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
          const latest = await getLatestRecordingForLiveInput2(accountId, apiToken, String(row.cf_stream_uid));
          recordingUid = latest?.recordingUid || null;
        }
        if (recordingUid && currentUrl) {
          const head = await fetch(`https://videodelivery.net/${recordingUid}/manifest/video.m3u8`, { method: "HEAD" }).catch(() => null);
          if (!head || !head.ok) {
            if (accountId && apiToken && row.cf_stream_uid) {
              const latest = await getLatestRecordingForLiveInput2(accountId, apiToken, String(row.cf_stream_uid));
              recordingUid = latest?.recordingUid || recordingUid;
            }
          }
        }
        if (!recordingUid) continue;
        const archivedUrl = await archiveCloudflareRecordingToR2(
          recordingUid,
          accountId && apiToken ? { accountId, apiToken } : void 0
        );
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
                 subject_key,
                 created_at
               )
               VALUES ($1, $2, $3, $4, 'r2', $5, $6, FALSE, $7, $8, TRUE, $9, $10)
               ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
               DO UPDATE SET
                 video_url = EXCLUDED.video_url,
                 video_type = EXCLUDED.video_type,
                 duration_minutes = EXCLUDED.duration_minutes,
                 section_title = EXCLUDED.section_title,
                 subject_key = EXCLUDED.subject_key,
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
                row.subject_key || null,
                Date.now()
              ]
            );
            await recomputeAllEnrollmentsProgressForCourse3(row.course_id).catch(() => {
            });
          }
        }
        console.log(`[CF Stream] Archived fallback recording to R2 for live class ${row.id}`);
        await sleep2(250);
      }
    } catch (err) {
      console.warn("[CF Stream] Archive sweep error:", err);
    } finally {
      isArchiveSweepRunning = false;
      if (lockClient) {
        if (lockAcquired) {
          try {
            await lockClient.query(
              "SELECT pg_advisory_unlock($1)",
              [ARCHIVE_SWEEP_ADVISORY_LOCK_KEY]
            );
          } catch (unlockErr) {
            console.warn("[CF Stream] Failed to release archive sweep advisory lock:", unlockErr);
          }
        }
        lockClient.release();
      }
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
  "backend/live-stream-routes.ts"() {
    "use strict";
    init_recordingSection();
    init_live_class_recording_save();
    init_notification_utils();
    init_cloudflare_stream_download();
    init_cloudflare_stream_api();
  }
});

// backend/site-settings-routes.ts
function registerSiteSettingsRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
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
  app2.put("/api/admin/site-settings", requireAdmin2, async (req, res) => {
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
  "backend/site-settings-routes.ts"() {
    "use strict";
  }
});

// backend/course-content-transfer.ts
function parseCourseId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
async function fetchContentImportPreview(db2, sourceCourseId) {
  const [lec, tst, mat, mis] = await Promise.all([
    db2.query("SELECT COUNT(*)::int AS c FROM lectures WHERE course_id = $1", [sourceCourseId]),
    db2.query("SELECT COUNT(*)::int AS c FROM tests WHERE course_id = $1", [sourceCourseId]),
    db2.query("SELECT COUNT(*)::int AS c FROM study_materials WHERE course_id = $1", [sourceCourseId]),
    db2.query("SELECT COUNT(*)::int AS c FROM daily_missions WHERE course_id = $1", [sourceCourseId])
  ]);
  return {
    lectures: Number(lec.rows[0]?.c || 0),
    tests: Number(tst.rows[0]?.c || 0),
    materials: Number(mat.rows[0]?.c || 0),
    missions: Number(mis.rows[0]?.c || 0)
  };
}
async function syncCourseFoldersFromSource(db2, targetCourseId, sourceCourseId) {
  const countRes = await db2.query(
    `SELECT COUNT(*)::int AS c FROM course_folders
     WHERE course_id = $1 AND type IN ('lecture', 'test', 'material')`,
    [sourceCourseId]
  );
  const folderCount = Number(countRes.rows[0]?.c || 0);
  if (folderCount === 0) return 0;
  const now = Date.now();
  await db2.query(
    `INSERT INTO course_folders (course_id, name, type, is_hidden, created_at)
     SELECT $1::int, cf.name, cf.type, cf.is_hidden, $2::bigint
     FROM course_folders cf
     WHERE cf.course_id = $3::int
       AND cf.type IN ('lecture', 'test', 'material')
     ON CONFLICT (course_id, name, type)
     DO UPDATE SET is_hidden = EXCLUDED.is_hidden`,
    [targetCourseId, now, sourceCourseId]
  );
  return folderCount;
}
async function nextLectureOrderBase(db2, targetCourseId) {
  const maxRow = await db2.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM lectures WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}
async function nextTestOrderBase(db2, targetCourseId) {
  const maxRow = await db2.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM tests WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}
async function nextMaterialOrderBase(db2, targetCourseId) {
  const maxRow = await db2.query(
    `SELECT COALESCE(MAX(order_index), -1)::int AS m FROM study_materials WHERE course_id = $1`,
    [targetCourseId]
  );
  return Number(maxRow.rows[0]?.m ?? -1) + 1;
}
async function importLectureRow(db2, targetCourseId, l, orderIndex) {
  const now = Date.now();
  await db2.query(
    `INSERT INTO lectures (
       course_id, title, description, transcript, video_url, video_type, pdf_url,
       duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      targetCourseId,
      l.title,
      l.description || "",
      l.transcript || "",
      l.video_url,
      l.video_type || "youtube",
      l.pdf_url || null,
      l.duration_minutes || 0,
      orderIndex,
      !!l.is_free_preview,
      l.section_title || null,
      !!l.download_allowed,
      l.created_at || now
    ]
  );
}
async function importLecturesByIds(db2, targetCourseId, lectureIds) {
  if (lectureIds.length === 0) return 0;
  const rows = await db2.query(
    `SELECT * FROM lectures WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [lectureIds]
  );
  let orderBase = await nextLectureOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const l of rows.rows) {
    const relOrder = Number(l.order_index ?? 0) - srcMin;
    await importLectureRow(db2, targetCourseId, l, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importAllLecturesFromCourse(db2, targetCourseId, sourceCourseId) {
  const rows = await db2.query(
    `SELECT * FROM lectures WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextLectureOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const l of rows.rows) {
    const relOrder = Number(l.order_index ?? 0) - srcMin;
    await importLectureRow(db2, targetCourseId, l, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importTestRow(db2, targetCourseId, t, orderIndex) {
  const now = Date.now();
  const newTest = await db2.query(
    `INSERT INTO tests (
       title, description, course_id, duration_minutes, total_marks, passing_marks,
       test_type, folder_name, total_questions, difficulty, order_index, is_published, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      t.title,
      t.description,
      targetCourseId,
      t.duration_minutes,
      t.total_marks,
      t.passing_marks ?? 35,
      t.test_type,
      t.folder_name || null,
      t.total_questions || 0,
      t.difficulty || "moderate",
      orderIndex,
      t.is_published !== false,
      t.created_at || now
    ]
  );
  const newTestId = newTest.rows[0].id;
  const questions = await db2.query(
    `SELECT * FROM questions WHERE test_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [t.id]
  );
  for (const q of questions.rows) {
    await db2.query(
      `INSERT INTO questions (
         test_id, question_text, option_a, option_b, option_c, option_d, correct_option,
         explanation, topic, difficulty, marks, negative_marks, order_index, image_url, solution_image_url
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        newTestId,
        q.question_text,
        q.option_a,
        q.option_b,
        q.option_c,
        q.option_d,
        q.correct_option,
        q.explanation,
        q.topic,
        q.difficulty,
        q.marks,
        q.negative_marks,
        q.order_index,
        q.image_url || null,
        q.solution_image_url || null
      ]
    );
  }
  return 1;
}
async function importTestsByIds(db2, targetCourseId, testIds) {
  if (testIds.length === 0) return 0;
  const rows = await db2.query(
    `SELECT * FROM tests WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [testIds]
  );
  let orderBase = await nextTestOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const t of rows.rows) {
    const relOrder = Number(t.order_index ?? 0) - srcMin;
    await importTestRow(db2, targetCourseId, t, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importAllTestsFromCourse(db2, targetCourseId, sourceCourseId) {
  const rows = await db2.query(
    `SELECT * FROM tests WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextTestOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const t of rows.rows) {
    const relOrder = Number(t.order_index ?? 0) - srcMin;
    await importTestRow(db2, targetCourseId, t, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importMaterialRow(db2, targetCourseId, m, orderIndex) {
  const now = Date.now();
  await db2.query(
    `INSERT INTO study_materials (
       title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, order_index, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      m.title,
      m.description || "",
      m.file_url,
      m.file_type || "pdf",
      targetCourseId,
      !!m.is_free,
      m.section_title || null,
      !!m.download_allowed,
      orderIndex,
      m.created_at || now
    ]
  );
}
async function importMaterialsByIds(db2, targetCourseId, materialIds) {
  if (materialIds.length === 0) return 0;
  const rows = await db2.query(
    `SELECT * FROM study_materials WHERE id = ANY($1::int[]) ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [materialIds]
  );
  let orderBase = await nextMaterialOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const m of rows.rows) {
    const relOrder = Number(m.order_index ?? 0) - srcMin;
    await importMaterialRow(db2, targetCourseId, m, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importAllMaterialsFromCourse(db2, targetCourseId, sourceCourseId) {
  const rows = await db2.query(
    `SELECT * FROM study_materials WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC`,
    [sourceCourseId]
  );
  let orderBase = await nextMaterialOrderBase(db2, targetCourseId);
  const srcMin = rows.rows.length ? Math.min(...rows.rows.map((r) => Number(r.order_index ?? 0))) : 0;
  let count = 0;
  for (const m of rows.rows) {
    const relOrder = Number(m.order_index ?? 0) - srcMin;
    await importMaterialRow(db2, targetCourseId, m, orderBase + relOrder);
    count++;
  }
  return count;
}
async function importAllMissionsFromCourse(db2, targetCourseId, sourceCourseId) {
  const rows = await db2.query(
    `SELECT * FROM daily_missions WHERE course_id = $1 ORDER BY mission_date DESC, id ASC`,
    [sourceCourseId]
  );
  let count = 0;
  for (const m of rows.rows) {
    const questionsPayload = typeof m.questions === "string" ? m.questions : JSON.stringify(m.questions ?? []);
    await db2.query(
      `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
      [
        m.title,
        m.description || "",
        questionsPayload,
        m.mission_date,
        m.xp_reward ?? 50,
        m.mission_type || "daily_drill",
        targetCourseId,
        m.folder_name || null
      ]
    );
    count++;
  }
  return count;
}
async function importCourseContent(db2, targetCourseId, sourceCourseId, options) {
  if (targetCourseId === sourceCourseId) {
    throw new Error("Source and target course must be different");
  }
  const targetExists = await db2.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [targetCourseId]);
  if (targetExists.rows.length === 0) throw new Error("Target course not found");
  const sourceExists = await db2.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [sourceCourseId]);
  if (sourceExists.rows.length === 0) throw new Error("Source course not found");
  const needsFolders = options.lectures || options.tests || options.materials;
  let foldersSynced = 0;
  if (needsFolders) {
    foldersSynced = await syncCourseFoldersFromSource(db2, targetCourseId, sourceCourseId);
  }
  const result = {
    lectures: 0,
    tests: 0,
    materials: 0,
    missions: 0,
    foldersSynced
  };
  if (options.lectures) {
    result.lectures = await importAllLecturesFromCourse(db2, targetCourseId, sourceCourseId);
  }
  if (options.tests) {
    result.tests = await importAllTestsFromCourse(db2, targetCourseId, sourceCourseId);
  }
  if (options.materials) {
    result.materials = await importAllMaterialsFromCourse(db2, targetCourseId, sourceCourseId);
  }
  if (options.missions) {
    result.missions = await importAllMissionsFromCourse(db2, targetCourseId, sourceCourseId);
  }
  return result;
}
function parseImportContentOptions(body) {
  const o = body?.options ?? body;
  const lectures = o?.lectures === true;
  const tests = o?.tests === true;
  const materials = o?.materials === true;
  const missions = o?.missions === true;
  if (!lectures && !tests && !materials && !missions) return null;
  return { lectures, tests, materials, missions };
}
var init_course_content_transfer = __esm({
  "backend/course-content-transfer.ts"() {
    "use strict";
  }
});

// backend/admin-course-import-routes.ts
async function finalizeTargetCourseStats(db2, targetCourseId, opts, updateCourseTestCounts3, recomputeAllEnrollmentsProgressForCourse3) {
  if (opts.lectures) {
    await recomputeAllEnrollmentsProgressForCourse3(targetCourseId);
  }
  if (opts.tests) {
    await updateCourseTestCounts3(targetCourseId);
  }
}
function registerAdminCourseImportRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  updateCourseTestCounts: updateCourseTestCounts3,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3,
  runInTransaction: runInTransaction2
}) {
  app2.get("/api/admin/courses/:id/import-content-preview", requireAdmin2, async (req, res) => {
    try {
      const sourceCourseId = parseCourseId(req.query.sourceCourseId);
      if (!sourceCourseId) {
        return res.status(400).json({ message: "sourceCourseId query param is required" });
      }
      const preview = await fetchContentImportPreview(db2, sourceCourseId);
      res.json(preview);
    } catch (err) {
      console.error("[Import] preview error:", err);
      res.status(500).json({ message: "Failed to load import preview" });
    }
  });
  app2.post("/api/admin/courses/:id/import-content", requireAdmin2, async (req, res) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const sourceCourseId = parseCourseId(req.body?.sourceCourseId);
      const options = parseImportContentOptions(req.body);
      if (!targetCourseId) return res.status(400).json({ message: "Invalid target course id" });
      if (!sourceCourseId) return res.status(400).json({ message: "sourceCourseId is required" });
      if (!options) {
        return res.status(400).json({ message: "Select at least one content type to import" });
      }
      const result = await runInTransaction2(
        (tx) => importCourseContent(tx, targetCourseId, sourceCourseId, options)
      );
      await finalizeTargetCourseStats(
        db2,
        String(targetCourseId),
        { lectures: options.lectures, tests: options.tests },
        updateCourseTestCounts3,
        recomputeAllEnrollmentsProgressForCourse3
      );
      res.json({ success: true, ...result });
    } catch (err) {
      console.error("[Import] import-content error:", err);
      const msg = err?.message || "Failed to import course content";
      const status = msg.includes("not found") || msg.includes("different") ? 400 : 500;
      res.status(status).json({ message: msg });
    }
  });
  app2.post("/api/admin/courses/:id/import-lectures", requireAdmin2, async (req, res) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { lectureIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!lectureIds || !Array.isArray(lectureIds) || lectureIds.length === 0) {
        return res.status(400).json({ message: "No lectures selected" });
      }
      const imported = await runInTransaction2(
        (tx) => importLecturesByIds(tx, targetCourseId, lectureIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      );
      await finalizeTargetCourseStats(
        db2,
        String(targetCourseId),
        { lectures: true, tests: false },
        updateCourseTestCounts3,
        recomputeAllEnrollmentsProgressForCourse3
      );
      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import lectures error:", err);
      res.status(500).json({ message: "Failed to import lectures" });
    }
  });
  app2.post("/api/admin/courses/:id/import-tests", requireAdmin2, async (req, res) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { testIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
        return res.status(400).json({ message: "No tests selected" });
      }
      const imported = await runInTransaction2(
        (tx) => importTestsByIds(tx, targetCourseId, testIds.map((id) => Number(id)).filter((id) => Number.isFinite(id)))
      );
      await finalizeTargetCourseStats(
        db2,
        String(targetCourseId),
        { lectures: false, tests: true },
        updateCourseTestCounts3,
        recomputeAllEnrollmentsProgressForCourse3
      );
      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import tests error:", err);
      res.status(500).json({ message: "Failed to import tests" });
    }
  });
  app2.post("/api/admin/courses/:id/import-materials", requireAdmin2, async (req, res) => {
    try {
      const targetCourseId = parseCourseId(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
      const { materialIds } = req.body;
      if (!targetCourseId) return res.status(400).json({ message: "Invalid course id" });
      if (!materialIds || !Array.isArray(materialIds) || materialIds.length === 0) {
        return res.status(400).json({ message: "No materials selected" });
      }
      const imported = await runInTransaction2(
        (tx) => importMaterialsByIds(
          tx,
          targetCourseId,
          materialIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        )
      );
      res.json({ success: true, imported });
    } catch (err) {
      console.error("Import materials error:", err);
      res.status(500).json({ message: "Failed to import materials" });
    }
  });
}
var init_admin_course_import_routes = __esm({
  "backend/admin-course-import-routes.ts"() {
    "use strict";
    init_course_content_transfer();
  }
});

// backend/progress-utils.ts
function progressTestWhere(courseType, alias = "") {
  const p = alias ? `${alias}.` : "";
  const pub = `${p}is_published = TRUE`;
  const real = alias ? REAL_TEST_T : REAL_TEST;
  if (String(courseType).toLowerCase() === "multi_subject") {
    return `${pub} AND ${real}`;
  }
  return `${pub} AND ${real} AND COALESCE(LOWER(${p}test_type), 'practice') <> 'pyq'`;
}
async function getCourseType(db2, courseId) {
  const r = await db2.query(
    `SELECT COALESCE(course_type, 'live') AS course_type FROM courses WHERE id = $1::int LIMIT 1`,
    [courseId]
  );
  return String(r.rows[0]?.course_type || "live").toLowerCase();
}
async function getCourseProgressBreakdown(db2, courseId) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const courseType = await getCourseType(db2, cid);
  const testWhere = progressTestWhere(courseType);
  const result = await db2.query(
    `SELECT
       (SELECT COUNT(*)::int FROM lectures WHERE course_id = $1::int AND ${VISIBLE_LECTURE}) AS lec,
       (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND ${testWhere}) AS tests_total,
       (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND is_published = TRUE AND COALESCE(LOWER(test_type), 'practice') = 'practice') AS tests_practice,
       (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND is_published = TRUE AND LOWER(test_type) = 'pyq') AS tests_pyq,
       (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND is_published = TRUE AND LOWER(test_type) = 'mock') AS tests_mock,
       (SELECT COUNT(*)::int FROM daily_missions WHERE course_id = $1::int AND ${REAL_MISSION}) AS missions,
       (SELECT COUNT(*)::int FROM daily_missions WHERE course_id = $1::int AND NOT (${REAL_MISSION})) AS mission_shells`,
    [cid]
  );
  const row = result.rows[0] || {};
  const lec = Number(row.lec || 0);
  const testsTotal = Number(row.tests_total || 0);
  const missions = Number(row.missions || 0);
  return {
    courseId: cid,
    courseType,
    lectures: { total: lec },
    tests: {
      total: testsTotal,
      practice: Number(row.tests_practice || 0),
      pyq: Number(row.tests_pyq || 0),
      mock: Number(row.tests_mock || 0)
    },
    missions: { total: missions, emptyShells: Number(row.mission_shells || 0) },
    totals: { items: lec + testsTotal + missions }
  };
}
async function updateCourseTestCounts(db2, courseId) {
  const id = Number(courseId);
  if (!Number.isFinite(id)) {
    console.warn("[Progress] updateCourseTestCounts skipped invalid courseId:", courseId);
    return;
  }
  await db2.query(
    `UPDATE courses SET
      total_tests    = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND is_published = TRUE),
      pyq_count      = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'pyq' AND is_published = TRUE),
      mock_count     = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'mock' AND is_published = TRUE),
      practice_count = (SELECT COUNT(*) FROM tests WHERE course_id = $1::int AND test_type = 'practice' AND is_published = TRUE)
    WHERE id = $1::int`,
    [id]
  );
  await recomputeAllEnrollmentsProgressForCourse(db2, id);
}
async function updateCourseProgress(db2, userId, courseId, runTx) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) {
    console.warn("[Progress] updateCourseProgress skipped invalid courseId:", courseId);
    return;
  }
  const doUpdate = async (client2) => {
    if (runTx) {
      await client2.query(
        "SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2::int FOR UPDATE",
        [userId, cid]
      );
    }
    const courseType = await getCourseType(client2, cid);
    const testWhere = progressTestWhere(courseType);
    const testWhereT = progressTestWhere(courseType, "t");
    const totals = await client2.query(
      `SELECT
         (SELECT COUNT(*)::int FROM lectures WHERE course_id = $1::int AND ${VISIBLE_LECTURE}) AS lec,
         (SELECT COUNT(*)::int FROM tests WHERE course_id = $1::int AND ${testWhere}) AS tests,
         (SELECT COUNT(*)::int FROM daily_missions WHERE course_id = $1::int AND ${REAL_MISSION}) AS missions`,
      [cid]
    );
    const done = await client2.query(
      `SELECT
         (SELECT COUNT(*)::int FROM lecture_progress lp
          JOIN lectures l ON lp.lecture_id = l.id
          WHERE lp.user_id = $2 AND l.course_id = $1::int AND lp.is_completed = TRUE AND ${VISIBLE_LECTURE_L}) AS lec,
         (SELECT COUNT(DISTINCT ta.test_id)::int FROM test_attempts ta
          JOIN tests t ON ta.test_id = t.id AND t.course_id = $1::int AND ${testWhereT}
          WHERE ta.user_id = $2 AND ta.status = 'completed') AS tests,
         (SELECT COUNT(*)::int FROM user_missions um
          JOIN daily_missions dm ON dm.id = um.mission_id AND dm.course_id = $1::int AND ${REAL_MISSION_DM}
          WHERE um.user_id = $2 AND um.is_completed = TRUE) AS missions`,
      [cid, userId]
    );
    const total = Number(totals.rows[0]?.lec || 0) + Number(totals.rows[0]?.tests || 0) + Number(totals.rows[0]?.missions || 0);
    const completed = Number(done.rows[0]?.lec || 0) + Number(done.rows[0]?.tests || 0) + Number(done.rows[0]?.missions || 0);
    const progress = total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0;
    await client2.query(
      "UPDATE enrollments SET progress_percent = $1 WHERE user_id = $2 AND course_id = $3::int",
      [progress, userId, cid]
    );
  };
  try {
    if (runTx) {
      await runTx((tx) => doUpdate(tx));
    } else {
      await doUpdate(db2);
    }
  } catch (err) {
    console.error("[Progress] Failed to update:", err);
  }
}
async function recomputeAllEnrollmentsProgressForCourse(db2, courseId) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) {
    console.warn("[Progress] recomputeAllEnrollmentsProgressForCourse skipped invalid courseId:", courseId);
    return;
  }
  try {
    const courseType = await getCourseType(db2, cid);
    const testWhere = progressTestWhere(courseType);
    const testWhereT = progressTestWhere(courseType, "t");
    await db2.query(
      `WITH
         total_lec AS (
           SELECT COUNT(*)::bigint AS n FROM lectures
           WHERE course_id = $1::int AND ${VISIBLE_LECTURE}
         ),
         total_tests AS (
           SELECT COUNT(*)::bigint AS n FROM tests
           WHERE course_id = $1::int AND ${testWhere}
         ),
         total_missions AS (
           SELECT COUNT(*)::bigint AS n FROM daily_missions WHERE course_id = $1::int AND ${REAL_MISSION}
         ),
         lec_done AS (
           SELECT lp.user_id, COUNT(*)::bigint AS n
           FROM lecture_progress lp
           JOIN lectures l ON lp.lecture_id = l.id AND l.course_id = $1::int
           WHERE lp.is_completed = TRUE AND ${VISIBLE_LECTURE_L}
           GROUP BY lp.user_id
         ),
         tests_done AS (
           SELECT ta.user_id, COUNT(DISTINCT ta.test_id)::bigint AS n
           FROM test_attempts ta
           JOIN tests t ON ta.test_id = t.id AND t.course_id = $1::int AND ${testWhereT}
           WHERE ta.status = 'completed'
           GROUP BY ta.user_id
         ),
         missions_done AS (
           SELECT um.user_id, COUNT(*)::bigint AS n
           FROM user_missions um
           JOIN daily_missions dm ON dm.id = um.mission_id AND dm.course_id = $1::int AND ${REAL_MISSION_DM}
           WHERE um.is_completed = TRUE
           GROUP BY um.user_id
         )
       UPDATE enrollments AS e
       SET progress_percent = calc.pct
       FROM (
         SELECT
           en.user_id,
           en.course_id,
           CASE
             WHEN (tl.n + tt.n + tm.n) <= 0 THEN 0
             ELSE LEAST(100, GREATEST(0, ROUND(
               100.0 * (COALESCE(ld.n, 0) + COALESCE(td.n, 0) + COALESCE(md.n, 0))
               / NULLIF(tl.n + tt.n + tm.n, 0)
             )))
           END::integer AS pct
         FROM enrollments en
         CROSS JOIN total_lec tl
         CROSS JOIN total_tests tt
         CROSS JOIN total_missions tm
         LEFT JOIN lec_done ld ON ld.user_id = en.user_id
         LEFT JOIN tests_done td ON td.user_id = en.user_id
         LEFT JOIN missions_done md ON md.user_id = en.user_id
         WHERE en.course_id = $1::int AND (en.status = 'active' OR en.status IS NULL)
       ) AS calc
       WHERE e.user_id = calc.user_id AND e.course_id = calc.course_id`,
      [cid]
    );
  } catch (err) {
    console.error("[Progress] recomputeAllEnrollmentsProgressForCourse failed:", err);
  }
}
var VISIBLE_LECTURE, VISIBLE_LECTURE_L, REAL_MISSION_SQL, REAL_MISSION, REAL_MISSION_DM, REAL_TEST, REAL_TEST_T;
var init_progress_utils = __esm({
  "backend/progress-utils.ts"() {
    "use strict";
    VISIBLE_LECTURE = `(visible_after_at IS NULL OR visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)`;
    VISIBLE_LECTURE_L = `(l.visible_after_at IS NULL OR l.visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)`;
    REAL_MISSION_SQL = `EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(questions, '[]'::jsonb)) q
  WHERE length(trim(COALESCE(q->>'question', ''))) > 0
)`;
    REAL_MISSION = REAL_MISSION_SQL;
    REAL_MISSION_DM = `EXISTS (
  SELECT 1 FROM jsonb_array_elements(COALESCE(dm.questions, '[]'::jsonb)) q
  WHERE length(trim(COALESCE(q->>'question', ''))) > 0
)`;
    REAL_TEST = `COALESCE(total_questions, 0) > 0`;
    REAL_TEST_T = `COALESCE(t.total_questions, 0) > 0`;
  }
});

// backend/admin-course-management-routes.ts
function normalizeFolderName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}
function parseParentId(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}
async function resolveCourseFolderFullName(db2, folderId, courseId) {
  const result = await db2.query(
    `${COURSE_FOLDER_SELECT}
     SELECT full_name
     FROM folder_tree
     WHERE id = $1 AND course_id = $2
     LIMIT 1`,
    [folderId, courseId]
  );
  return result.rows[0]?.full_name || null;
}
async function createCourseFolderPath(db2, courseId, type, rawName, rawParentId, rawSubjectKey) {
  const parts = rawName.split(/\s+\/\s+/).map((p) => normalizeFolderName(p)).filter(Boolean);
  const names = parts.length > 0 ? parts : [rawName];
  let parentId = parseParentId(rawParentId);
  const subjectKey = typeof rawSubjectKey === "string" && rawSubjectKey.trim() ? rawSubjectKey.trim().toLowerCase() : null;
  let current = null;
  for (const namePart of names) {
    const existing = await db2.query(
      `SELECT *
       FROM course_folders
       WHERE course_id = $1
         AND type = $2
         AND COALESCE(subject_key, '') = COALESCE($5::text, '')
         AND COALESCE(parent_id, 0) = COALESCE($3::int, 0)
         AND LOWER(name) = LOWER($4)
       LIMIT 1`,
      [courseId, type, parentId, namePart, subjectKey]
    );
    if (existing.rows.length > 0) {
      current = existing.rows[0];
      if (current.is_hidden) {
        const revived = await db2.query("UPDATE course_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *", [current.id]);
        current = revived.rows[0];
      }
    } else {
      const inserted = await db2.query(
        "INSERT INTO course_folders (course_id, name, type, parent_id, subject_key) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [courseId, namePart, type, parentId, subjectKey]
      );
      current = inserted.rows[0];
    }
    parentId = Number(current.id);
  }
  return current;
}
function registerAdminCourseManagementRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  updateCourseTestCounts: updateCourseTestCounts3
}) {
  app2.get("/api/admin/all-materials", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/all-lectures", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/all-tests", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/courses/:id/progress-breakdown", requireAdmin2, async (req, res) => {
    try {
      const courseId = Number(req.params.id);
      if (!Number.isFinite(courseId) || courseId <= 0) {
        return res.status(400).json({ message: "Invalid course id" });
      }
      const courseCheck = await db2.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [courseId]);
      if (courseCheck.rows.length === 0) return res.status(404).json({ message: "Course not found" });
      const breakdown = await getCourseProgressBreakdown(db2, courseId);
      if (!breakdown) return res.status(400).json({ message: "Invalid course id" });
      res.json(breakdown);
    } catch (err) {
      console.error("[Progress] breakdown failed:", err);
      res.status(500).json({ message: "Failed to fetch progress breakdown" });
    }
  });
  app2.get("/api/admin/courses/:id/folders", requireAdmin2, async (req, res) => {
    try {
      const result = await db2.query(
        `${COURSE_FOLDER_SELECT}
         SELECT *
         FROM folder_tree
         WHERE course_id = $1
         ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`,
        [req.params.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.post("/api/admin/courses/:id/folders", requireAdmin2, async (req, res) => {
    try {
      const { name, type, parentId, subjectKey } = req.body;
      const normalizedName = normalizeFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!COURSE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });
      const normalizedParentId = parseParentId(parentId);
      if (normalizedParentId) {
        const parent = await db2.query(
          "SELECT id FROM course_folders WHERE id = $1 AND course_id = $2 AND type = $3 AND COALESCE(subject_key, '') = COALESCE($4::text, '') LIMIT 1",
          [normalizedParentId, req.params.id, normalizedType, typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null]
        );
        if (parent.rows.length === 0) return res.status(400).json({ message: "Parent folder not found" });
      }
      const folder = await createCourseFolderPath(db2, req.params.id, normalizedType, normalizedName, normalizedParentId, subjectKey);
      const fullName = await resolveCourseFolderFullName(db2, folder?.id, req.params.id);
      res.json({ ...folder, full_name: fullName || folder?.name });
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });
  app2.put("/api/admin/courses/:id/folders/:folderId", requireAdmin2, async (req, res) => {
    try {
      const { isHidden, name } = req.body;
      if (name !== void 0) {
        const normalizedName = normalizeFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
        const oldFullName = await resolveCourseFolderFullName(db2, req.params.folderId, req.params.id);
        if (!oldFullName) return res.status(404).json({ message: "Folder not found" });
        const dup = await db2.query(
          `SELECT id
           FROM course_folders
           WHERE course_id = $1
             AND type = (SELECT type FROM course_folders WHERE id = $2 AND course_id = $1)
             AND COALESCE(subject_key, '') = COALESCE((SELECT subject_key FROM course_folders WHERE id = $2 AND course_id = $1), '')
             AND COALESCE(parent_id, 0) = COALESCE((SELECT parent_id FROM course_folders WHERE id = $2 AND course_id = $1), 0)
             AND LOWER(name) = LOWER($3)
             AND id <> $2
           LIMIT 1`,
          [req.params.id, req.params.folderId, normalizedName]
        );
        if (dup.rows.length > 0) {
          return res.status(409).json({ message: "A folder with this name already exists in this parent" });
        }
        await db2.query("UPDATE course_folders SET name = $1 WHERE id = $2 AND course_id = $3", [normalizedName, req.params.folderId, req.params.id]);
        const newFullName = await resolveCourseFolderFullName(db2, req.params.folderId, req.params.id);
        if (newFullName) {
          await db2.query(
            `WITH target AS (
               SELECT type AS folder_type FROM course_folders WHERE id = $1 AND course_id = $2
             ),
             upd_lectures AS (
               UPDATE lectures l
               SET section_title = CASE
                 WHEN l.section_title = $3 THEN $4
                 ELSE $4 || substring(l.section_title from length($3) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'lecture' AND l.course_id = $2 AND (l.section_title = $3 OR l.section_title LIKE $3 || ' / %')
               RETURNING l.id
             ),
             upd_materials AS (
               UPDATE study_materials sm
               SET section_title = CASE
                 WHEN sm.section_title = $3 THEN $4
                 ELSE $4 || substring(sm.section_title from length($3) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'material' AND sm.course_id = $2 AND (sm.section_title = $3 OR sm.section_title LIKE $3 || ' / %')
               RETURNING sm.id
             )
             UPDATE tests tt
             SET folder_name = CASE
               WHEN tt.folder_name = $3 THEN $4
               ELSE $4 || substring(tt.folder_name from length($3) + 1)
             END
             FROM target t
             WHERE t.folder_type = 'test' AND tt.course_id = $2 AND (tt.folder_name = $3 OR tt.folder_name LIKE $3 || ' / %')`,
            [req.params.folderId, req.params.id, oldFullName, newFullName]
          );
        }
      } else if (isHidden !== void 0) {
        await db2.query(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM course_folders WHERE id = $1 AND course_id = $2
             UNION ALL
             SELECT cf.id FROM course_folders cf JOIN descendants d ON cf.parent_id = d.id
           )
           UPDATE course_folders SET is_hidden = $3 WHERE id IN (SELECT id FROM descendants)`,
          [req.params.folderId, req.params.id, isHidden]
        );
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update folder" });
    }
  });
  app2.patch("/api/admin/courses/:id/reorder", requireAdmin2, async (req, res) => {
    try {
      const courseId = Number(req.params.id);
      if (!Number.isFinite(courseId) || courseId <= 0) {
        return res.status(400).json({ message: "Invalid course id" });
      }
      const { itemType, items } = req.body;
      const TABLE_BY_TYPE = {
        test: "tests",
        material: "study_materials",
        lecture: "lectures",
        folder: "course_folders"
      };
      const table = TABLE_BY_TYPE[itemType];
      if (!table) {
        return res.status(400).json({ message: "itemType must be one of: test, material, lecture, folder" });
      }
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items must be a non-empty array" });
      }
      const ids = [];
      const orders = [];
      for (const item of items) {
        const itemId = Number(item.id);
        const orderIdx = Number(item.orderIndex);
        if (!Number.isFinite(itemId) || !Number.isFinite(orderIdx)) continue;
        ids.push(itemId);
        orders.push(orderIdx);
      }
      if (ids.length === 0) return res.json({ success: true, updated: 0 });
      await db2.query(
        `UPDATE ${table} SET order_index = v.order_index
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS order_index) v
         WHERE ${table}.id = v.id AND ${table}.course_id = $3`,
        [ids, orders, courseId]
      );
      res.json({ success: true, updated: ids.length });
    } catch (err) {
      console.error("[reorder] error:", err);
      res.status(500).json({ message: "Failed to reorder items" });
    }
  });
  app2.delete("/api/admin/courses/:id/folders/:folderId", requireAdmin2, async (req, res) => {
    try {
      const fullName = await resolveCourseFolderFullName(db2, req.params.folderId, req.params.id);
      if (!fullName) return res.status(404).json({ message: "Folder not found" });
      await db2.query(
        `WITH RECURSIVE target AS (
           SELECT id, name, type
           FROM course_folders
           WHERE id = $1 AND course_id = $2
           UNION ALL
           SELECT cf.id, cf.name, cf.type
           FROM course_folders cf
           JOIN target t ON cf.parent_id = t.id
         ),
         del_lectures AS (
           DELETE FROM lectures l
           USING target t
           WHERE t.type = 'lecture' AND l.course_id = $2 AND (l.section_title = $3 OR l.section_title LIKE $3 || ' / %')
           RETURNING l.id
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.course_id = $2 AND (tt.folder_name = $3 OR tt.folder_name LIKE $3 || ' / %')
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.course_id = $2 AND (sm.section_title = $3 OR sm.section_title LIKE $3 || ' / %')
           RETURNING sm.id
         )
         DELETE FROM course_folders cf
         USING target t
         WHERE cf.id = t.id`,
        [req.params.folderId, req.params.id, fullName]
      );
      await updateCourseTestCounts3(String(req.params.id));
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}
var COURSE_FOLDER_TYPES, MAX_FOLDER_NAME_LENGTH, COURSE_FOLDER_SELECT;
var init_admin_course_management_routes = __esm({
  "backend/admin-course-management-routes.ts"() {
    "use strict";
    init_progress_utils();
    COURSE_FOLDER_TYPES = /* @__PURE__ */ new Set(["lecture", "material", "test"]);
    MAX_FOLDER_NAME_LENGTH = 120;
    COURSE_FOLDER_SELECT = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      cf.*,
      cf.name::text AS full_name,
      ARRAY[cf.id] AS path_ids
    FROM course_folders cf
    WHERE cf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM course_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;
  }
});

// backend/admin-analytics-range.ts
function toSafeTs(value) {
  const ts = new Date(String(value)).getTime();
  return Number.isFinite(ts) ? ts : null;
}
function buildAnalyticsRange(input) {
  const period = String(input.period || "").trim();
  const now = input.now ?? Date.now();
  if (period === "lifetime" || period === "all") return null;
  if (period === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { start: start.getTime(), endExclusive: start.getTime() + DAY_MS };
  }
  if (period === "yesterday") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 1);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    return { start: start.getTime(), endExclusive: end.getTime() };
  }
  if (period === "7days") return { start: now - 7 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "15days") return { start: now - 15 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "30days") return { start: now - 30 * DAY_MS, endExclusive: now + DAY_MS };
  if (period === "custom" && input.startDate && input.endDate) {
    const s = toSafeTs(input.startDate);
    const e = toSafeTs(input.endDate);
    if (s !== null && e !== null) return { start: s, endExclusive: e + DAY_MS };
  }
  return null;
}
var DAY_MS;
var init_admin_analytics_range = __esm({
  "backend/admin-analytics-range.ts"() {
    "use strict";
    DAY_MS = 864e5;
  }
});

// backend/admin-analytics-routes.ts
function registerAdminAnalyticsRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
}) {
  app2.get("/api/admin/analytics", requireAdmin2, async (req, res) => {
    try {
      const { period, startDate, endDate } = req.query;
      const cacheKey = `analytics:${String(period || "all")}:${String(startDate || "")}:${String(endDate || "")}`;
      try {
        const redis = await getRedisClient();
        if (redis) {
          const cached = await redis.get(cacheKey);
          if (cached) {
            res.setHeader("X-Cache", "HIT");
            return res.json(JSON.parse(cached));
          }
        }
      } catch {
      }
      const now = Date.now();
      const range = buildAnalyticsRange({
        period: String(period || ""),
        startDate: startDate ? String(startDate) : null,
        endDate: endDate ? String(endDate) : null,
        now
      });
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
        } catch (err) {
          console.error(
            "[Analytics] Query failed, using fallback data:",
            err instanceof Error ? err.message : String(err)
          );
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
      const analyticsResult = {
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
      };
      try {
        const redis = await getRedisClient();
        if (redis) {
          await redis.set(cacheKey, JSON.stringify(analyticsResult), { EX: ANALYTICS_CACHE_TTL_SEC });
        }
      } catch {
      }
      res.setHeader("X-Cache", "MISS");
      res.json(analyticsResult);
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });
  app2.post("/api/admin/analytics/reset-abandoned", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/courses/:id/enrollments", requireAdmin2, async (req, res) => {
    try {
      const nowMs2 = Date.now();
      const result = await db2.query(
        `SELECT
           e.id,
           e.user_id,
           u.name AS user_name,
           u.phone AS user_phone,
           u.email AS user_email,
           e.enrolled_at,
           e.valid_until,
           COALESCE(e.status, 'active') AS status,
           CASE
             WHEN COALESCE(e.status, 'active') = 'inactive' THEN 'inactive'
             WHEN e.valid_until IS NOT NULL AND e.valid_until < $2 THEN 'expired'
             ELSE 'active'
           END AS access_state,
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
        [req.params.id, nowMs2]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch enrollments" });
    }
  });
  app2.get("/api/admin/courses/:courseId/enrollments/:userId/detail", requireAdmin2, async (req, res) => {
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
var ANALYTICS_CACHE_TTL_SEC;
var init_admin_analytics_routes = __esm({
  "backend/admin-analytics-routes.ts"() {
    "use strict";
    init_admin_analytics_range();
    init_redis_client();
    ANALYTICS_CACHE_TTL_SEC = 60;
  }
});

// backend/download-access-utils.ts
async function purgeUserDownloadsForItem(db2, itemType, itemId) {
  await db2.query("DELETE FROM user_downloads WHERE item_type = $1 AND item_id = $2", [
    itemType,
    itemId
  ]);
}
function isEnrollmentAccessRevoked(status, validUntil, nowMs2 = Date.now()) {
  const s = String(status ?? "").toLowerCase();
  if (s === "inactive" || s === "revoked" || s === "cancelled") return true;
  const vu = validUntil != null ? Number(validUntil) : null;
  if (vu != null && Number.isFinite(vu) && vu < nowMs2) return true;
  return false;
}
var init_download_access_utils = __esm({
  "backend/download-access-utils.ts"() {
    "use strict";
  }
});

// backend/admin-enrollment-routes.ts
async function txQueryOptional(tx, savepoint, sql, params) {
  const sp = `sp_${savepoint}`;
  await tx.query(`SAVEPOINT ${sp}`);
  try {
    await tx.query(sql, params);
    await tx.query(`RELEASE SAVEPOINT ${sp}`);
  } catch (err) {
    await tx.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await tx.query(`RELEASE SAVEPOINT ${sp}`);
    console.warn(`[EnrollmentDelete] optional step skipped (${savepoint}):`, err);
  }
}
async function writeEnrollmentAuditLog(db2, adminUserId2, action, enrollmentId, meta) {
  try {
    await db2.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, meta, created_at)
       VALUES ($1, $2, 'enrollment', $3, $4, $5)`,
      [adminUserId2, action, enrollmentId, JSON.stringify(meta), Date.now()]
    );
  } catch {
  }
}
async function purgeEnrollmentRelatedRows(tx, userId, courseId, enrollmentId) {
  await tx.query(
    `DELETE FROM user_downloads
     WHERE user_id = $1
       AND (
         (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $2))
         OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $2))
       )`,
    [userId, courseId]
  );
  await txQueryOptional(
    tx,
    "download_tokens",
    `DELETE FROM download_tokens WHERE user_id = $1 AND course_id = $2`,
    [userId, courseId]
  );
  await tx.query(
    `DELETE FROM media_tokens
     WHERE user_id = $1
       AND file_key IN (
         SELECT file_url FROM study_materials WHERE course_id = $2 AND file_url IS NOT NULL
         UNION ALL
         SELECT video_url FROM lectures WHERE course_id = $2 AND video_url IS NOT NULL
         UNION ALL
         SELECT pdf_url FROM lectures WHERE course_id = $2 AND pdf_url IS NOT NULL
         UNION ALL
         SELECT recording_url FROM live_classes WHERE course_id = $2 AND recording_url IS NOT NULL
       )`,
    [userId, courseId]
  );
  await tx.query(
    `DELETE FROM lecture_progress
     WHERE user_id = $1
       AND lecture_id IN (SELECT id FROM lectures WHERE course_id = $2)`,
    [userId, courseId]
  );
  await txQueryOptional(
    tx,
    "live_recording_progress",
    `DELETE FROM live_class_recording_progress
     WHERE user_id = $1
       AND live_class_id IN (SELECT id FROM live_classes WHERE course_id = $2)`,
    [userId, courseId]
  );
  await txQueryOptional(
    tx,
    "live_class_viewers",
    `DELETE FROM live_class_viewers
     WHERE user_id = $1
       AND live_class_id IN (SELECT id FROM live_classes WHERE course_id = $2)`,
    [userId, courseId]
  );
  await tx.query(
    `DELETE FROM test_attempts
     WHERE user_id = $1
       AND test_id IN (SELECT id FROM tests WHERE course_id = $2)`,
    [userId, courseId]
  );
  await txQueryOptional(
    tx,
    "user_missions",
    `DELETE FROM user_missions
     WHERE user_id = $1
       AND mission_id IN (SELECT id FROM daily_missions WHERE course_id = $2)`,
    [userId, courseId]
  );
  await tx.query(`DELETE FROM enrollments WHERE id = $1`, [enrollmentId]);
  await tx.query(
    `UPDATE courses SET total_students = GREATEST(0, COALESCE(total_students, 0) - 1) WHERE id = $1`,
    [courseId]
  );
}
function registerAdminEnrollmentRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  deleteDownloadsForUser: deleteDownloadsForUser3,
  deleteDownloadsForCourse: deleteDownloadsForCourse3,
  runInTransaction: runInTransaction2
}) {
  app2.put("/api/admin/enrollments/:id", requireAdmin2, async (req, res) => {
    try {
      const adminUserId2 = Number(req.user?.id) || null;
      const { status, valid_until } = req.body;
      const updates = [];
      const params = [];
      const before = await db2.query(
        "SELECT user_id, course_id, status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      ).catch(() => ({ rows: [] }));
      const oldRow = before.rows[0] || {};
      let nextStatus = oldRow.status;
      let nextValidUntil = oldRow.valid_until;
      if (status !== void 0) {
        const statusNorm = String(status).trim().toLowerCase();
        if (statusNorm && statusNorm !== "active" && statusNorm !== "inactive") {
          return res.status(400).json({ message: "Invalid status" });
        }
        nextStatus = statusNorm === "" ? null : statusNorm || null;
        params.push(nextStatus);
        updates.push(`status = $${params.length}`);
      }
      if (valid_until !== void 0) {
        const vu = valid_until === null || valid_until === "" ? null : Number(valid_until);
        if (vu !== null && (!Number.isFinite(vu) || vu < 0)) {
          return res.status(400).json({ message: "Invalid valid_until" });
        }
        nextValidUntil = vu;
        params.push(vu);
        updates.push(`valid_until = $${params.length}`);
      }
      const willRevoke = isEnrollmentAccessRevoked(nextStatus, nextValidUntil);
      if (updates.length > 0) {
        params.push(req.params.id);
        await db2.query(`UPDATE enrollments SET ${updates.join(", ")} WHERE id = $${params.length}`, params);
      }
      if (willRevoke && oldRow.user_id && oldRow.course_id) {
        await db2.query(
          "UPDATE enrollments SET download_cleanup_pending = TRUE WHERE id = $1",
          [req.params.id]
        );
        try {
          await deleteDownloadsForUser3(Number(oldRow.user_id), Number(oldRow.course_id));
          await db2.query("UPDATE enrollments SET download_cleanup_pending = FALSE WHERE id = $1", [
            req.params.id
          ]);
        } catch (cleanupErr) {
          console.warn("[Cleanup] enrollment PUT download cleanup failed; will retry", {
            enrollmentId: req.params.id,
            cleanupErr
          });
        }
      }
      void writeEnrollmentAuditLog(db2, adminUserId2, "updated", String(req.params.id), {
        old_status: oldRow.status,
        new_status: status,
        old_valid_until: oldRow.valid_until,
        new_valid_until: valid_until
      });
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update enrollment" });
    }
  });
  app2.delete("/api/admin/enrollments/:id", requireAdmin2, async (req, res) => {
    try {
      const adminUserId2 = Number(req.user?.id) || null;
      const enrollment = await db2.query(
        "SELECT id, user_id, course_id, status, valid_until FROM enrollments WHERE id = $1",
        [req.params.id]
      );
      if (enrollment.rows.length === 0) {
        return res.json({ success: true });
      }
      const { user_id, course_id } = enrollment.rows[0];
      const enrollmentId = String(req.params.id);
      try {
        await deleteDownloadsForUser3(Number(user_id), Number(course_id));
      } catch (cleanupErr) {
        console.warn("[Cleanup] download cleanup failed:", cleanupErr);
      }
      await runInTransaction2(async (tx) => {
        await purgeEnrollmentRelatedRows(tx, Number(user_id), Number(course_id), enrollmentId);
      });
      void writeEnrollmentAuditLog(db2, adminUserId2, "deleted", enrollmentId, {
        user_id,
        course_id,
        hard_delete: true,
        status_before: enrollment.rows[0].status,
        valid_until_before: enrollment.rows[0].valid_until
      });
      res.json({ success: true });
    } catch (err) {
      console.error("Remove from course error:", err);
      res.status(500).json({ message: "Failed to remove enrollment" });
    }
  });
  app2.delete("/api/admin/courses/:id", requireAdmin2, async (req, res) => {
    try {
      const courseId = req.params.id;
      await deleteDownloadsForCourse3(parseInt(Array.isArray(courseId) ? courseId[0] : courseId));
      await runInTransaction2(async (tx) => {
        await tx.query(
          `DELETE FROM media_tokens
           WHERE file_key IN (
             SELECT file_url FROM study_materials WHERE course_id = $1 AND file_url IS NOT NULL
             UNION ALL
             SELECT video_url FROM lectures WHERE course_id = $1 AND video_url IS NOT NULL
             UNION ALL
             SELECT pdf_url FROM lectures WHERE course_id = $1 AND pdf_url IS NOT NULL
             UNION ALL
             SELECT recording_url FROM live_classes WHERE course_id = $1 AND recording_url IS NOT NULL
           )`,
          [courseId]
        );
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
  "backend/admin-enrollment-routes.ts"() {
    "use strict";
    init_download_access_utils();
  }
});

// backend/async-utils.ts
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
  "backend/async-utils.ts"() {
    "use strict";
  }
});

// backend/admin-lecture-routes.ts
function registerAdminLectureRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3,
  runInTransaction: runInTransaction2
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
  app2.post("/api/admin/lectures", requireAdmin2, async (req, res) => {
    try {
      const { courseId, title, description, transcript, videoUrl, fileUrl, videoType, pdfUrl, durationMinutes: durationMinutes2, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed, subjectKey } = req.body;
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
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db2.query(
        `INSERT INTO lectures (course_id, title, description, transcript, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, download_allowed, subject_key, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
        [
          parsedCourseId,
          String(title).trim(),
          description || "",
          transcriptText,
          normalizedVideoUrl || null,
          effectiveVideoType,
          normalizedPdfUrl || null,
          Number(durationMinutes2) || 0,
          Number(orderIndex) || 0,
          isFreePreview || false,
          normalizedSectionTitle,
          downloadAllowed || false,
          normalizedSubjectKey,
          Date.now()
        ]
      );
      await recomputeAllEnrollmentsProgressForCourse3(parsedCourseId);
      const lectureTitle = String(title).trim();
      const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
      const courseTitle = String(courseInfo.rows[0]?.title || "your course");
      const notifTitle = "\u{1F4F9} New Lecture Added";
      const notifMessage = `"${lectureTitle}" has been added in ${courseTitle}.`;
      await notifyEnrolledCourseStudents(db2, parsedCourseId, {
        title: notifTitle,
        message: notifMessage,
        pushData: {
          type: "new_lecture_added",
          lectureId: result.rows[0]?.id,
          courseId: parsedCourseId
        },
        sendPush: (userIds, payload) => sendPushToUsers(db2, userIds, payload)
      });
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
  app2.post("/api/admin/lectures/bulk", requireAdmin2, async (req, res) => {
    try {
      const { courseId, subjectKey, items } = req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ message: "items must contain 1\u201350 lectures" });
      }
      const courseCheck = await db2.query("SELECT id, title FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
      if (courseCheck.rows.length === 0) {
        return res.status(404).json({ message: "Course not found" });
      }
      const courseTitle = String(courseCheck.rows[0]?.title || "your course");
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const titles = [];
      const videoUrls = [];
      const videoTypes = [];
      const durations = [];
      const orderIndexes = [];
      const sectionTitles = [];
      const freeFlags = [];
      const downloadFlags = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const title = String(item.title || "").trim();
        const videoUrl = String(item.videoUrl || "").trim();
        if (!title || !videoUrl) {
          return res.status(400).json({ message: `Item ${i + 1}: title and videoUrl are required` });
        }
        const duration = Number(item.durationMinutes);
        if (!Number.isFinite(duration) || duration <= 0) {
          return res.status(400).json({ message: `Item ${i + 1}: durationMinutes must be > 0` });
        }
        titles.push(title);
        videoUrls.push(videoUrl);
        videoTypes.push(String(item.videoType || "").trim() || inferLectureVideoType(videoUrl));
        durations.push(Math.round(duration));
        orderIndexes.push(Number(item.orderIndex) || 0);
        const section = item.sectionTitle != null ? String(item.sectionTitle).trim() : "";
        sectionTitles.push(section || null);
        freeFlags.push(!!item.isFreePreview);
        downloadFlags.push(!!item.downloadAllowed);
      }
      const now = Date.now();
      const inserted = await runInTransaction2(async (tx) => {
        const result = await tx.query(
          `INSERT INTO lectures (
             course_id, title, description, transcript, video_url, video_type, pdf_url,
             duration_minutes, order_index, is_free_preview, section_title, download_allowed, subject_key, created_at
           )
           SELECT
             $1::int,
             t.title,
             ''::text,
             ''::text,
             t.video_url,
             t.video_type,
             NULL::text,
             t.duration_minutes,
             t.order_index,
             t.is_free_preview,
             t.section_title,
             t.download_allowed,
             $2::text,
             $3::bigint
           FROM unnest(
             $4::text[],
             $5::text[],
             $6::text[],
             $7::int[],
             $8::int[],
             $9::text[],
             $10::boolean[],
             $11::boolean[]
           ) AS t(
             title, video_url, video_type, duration_minutes, order_index,
             section_title, is_free_preview, download_allowed
           )
           RETURNING *`,
          [
            parsedCourseId,
            normalizedSubjectKey,
            now,
            titles,
            videoUrls,
            videoTypes,
            durations,
            orderIndexes,
            sectionTitles,
            freeFlags,
            downloadFlags
          ]
        );
        return result.rows;
      });
      await recomputeAllEnrollmentsProgressForCourse3(parsedCourseId);
      const count = inserted.length;
      const notifTitle = count === 1 ? "\u{1F4F9} New Lecture Added" : `\u{1F4F9} ${count} new lectures added`;
      const notifMessage = count === 1 ? `"${titles[0]}" has been added in ${courseTitle}.` : `${count} new lectures have been added in ${courseTitle}.`;
      await notifyEnrolledCourseStudents(db2, parsedCourseId, {
        title: notifTitle,
        message: notifMessage,
        pushData: {
          type: "new_lecture_added",
          courseId: parsedCourseId,
          count
        },
        sendPush: (userIds, payload) => sendPushToUsers(db2, userIds, payload)
      });
      res.json({ inserted, count });
    } catch (err) {
      console.error("[AdminLectures] bulk create failed", {
        courseId: req.body?.courseId,
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
        error: err instanceof Error ? err.message : err
      });
      res.status(500).json({ message: "Failed to bulk add lectures", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });
  app2.put("/api/admin/lectures/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, description, transcript, videoUrl, videoType, durationMinutes: durationMinutes2, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed, subjectKey } = req.body;
      const normalizedSectionTitle = resolveLectureSectionTitle(
        sectionTitle,
        lectureSubfolderTitle
      );
      const patchTranscript = Object.prototype.hasOwnProperty.call(req.body, "transcript");
      const transcriptVal = patchTranscript ? String(transcript ?? "") : "";
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      await db2.query(
        `UPDATE lectures SET title=$1, description=$2, transcript = CASE WHEN $11::boolean THEN $3::text ELSE transcript END, video_url=$4, video_type=$5, duration_minutes=$6, order_index=$7, is_free_preview=$8, section_title=$9, download_allowed=$10, subject_key=$13 WHERE id=$12`,
        [
          title,
          description || "",
          transcriptVal,
          videoUrl,
          videoType || "youtube",
          parseInt(durationMinutes2) || 0,
          parseInt(orderIndex) || 0,
          isFreePreview || false,
          normalizedSectionTitle,
          downloadAllowed || false,
          patchTranscript,
          req.params.id,
          normalizedSubjectKey
        ]
      );
      if (downloadAllowed === false) {
        await purgeUserDownloadsForItem(db2, "lecture", Number(req.params.id));
      }
      const row = await db2.query("SELECT course_id FROM lectures WHERE id = $1 LIMIT 1", [req.params.id]);
      if (row.rows[0]?.course_id) {
        await recomputeAllEnrollmentsProgressForCourse3(row.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update lecture" });
    }
  });
  app2.delete("/api/admin/lectures/:id", requireAdmin2, async (req, res) => {
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
      await recomputeAllEnrollmentsProgressForCourse3(lecture.course_id);
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
  "backend/admin-lecture-routes.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_download_access_utils();
    init_async_utils();
    init_push_notifications();
  }
});

// backend/admin-test-routes.ts
function registerAdminTestRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  updateCourseTestCounts: updateCourseTestCounts3
}) {
  app2.get("/api/admin/tests", requireAdmin2, async (_req, res) => {
    try {
      const result = await db2.query(`
        SELECT t.*, c.title as course_title 
        FROM tests t 
        LEFT JOIN courses c ON t.course_id = c.id 
        WHERE t.course_id IS NULL
        ORDER BY COALESCE(t.order_index, 0) ASC, t.created_at DESC
      `);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch tests" });
    }
  });
  app2.get("/api/admin/tests/:id/attempts", requireAdmin2, async (req, res) => {
    try {
      const testId = Number(req.params.id);
      if (!Number.isFinite(testId) || testId <= 0) {
        return res.status(400).json({ message: "Invalid test id" });
      }
      const [testResult, questionsResult, attemptsResult] = await Promise.all([
        db2.query(
          `SELECT t.*, c.title AS course_title, sf.name AS mini_course_title
           FROM tests t
           LEFT JOIN courses c ON c.id = t.course_id
           LEFT JOIN standalone_folders sf ON sf.id = t.mini_course_id
           WHERE t.id = $1`,
          [testId]
        ),
        db2.query(
          `SELECT id, question_text, option_a, option_b, option_c, option_d,
                  correct_option, explanation, topic, difficulty, marks,
                  negative_marks, image_url, solution_image_url, order_index
           FROM questions
           WHERE test_id = $1
           ORDER BY order_index ASC, id ASC`,
          [testId]
        ),
        db2.query(
          `SELECT DISTINCT ON (ta.user_id)
                  ta.id AS attempt_id,
                  ta.user_id,
                  ta.score,
                  ta.total_marks,
                  ta.percentage,
                  ta.correct,
                  ta.incorrect,
                  ta.attempted,
                  ta.time_taken_seconds,
                  ta.completed_at,
                  ta.answers,
                  ta.question_times,
                  u.name,
                  u.phone,
                  u.email
           FROM test_attempts ta
           JOIN users u ON u.id = ta.user_id
           WHERE ta.test_id = $1 AND ta.status = 'completed'
           ORDER BY ta.user_id, ta.completed_at DESC`,
          [testId]
        )
      ]);
      if (testResult.rows.length === 0) {
        return res.status(404).json({ message: "Test not found" });
      }
      const attempts = attemptsResult.rows.map((row) => ({
        ...row,
        score: Number(row.score || 0),
        total_marks: Number(row.total_marks || 0),
        percentage: Number(row.percentage || 0),
        correct: Number(row.correct || 0),
        incorrect: Number(row.incorrect || 0),
        attempted: Number(row.attempted || 0),
        time_taken_seconds: Number(row.time_taken_seconds || 0),
        answers: typeof row.answers === "string" ? JSON.parse(row.answers || "{}") : row.answers || {},
        question_times: typeof row.question_times === "string" ? JSON.parse(row.question_times || "{}") : row.question_times || {}
      })).sort((a, b) => {
        const scoreDiff = Number(b.score || 0) - Number(a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return Number(a.time_taken_seconds || 0) - Number(b.time_taken_seconds || 0);
      });
      res.json({
        test: testResult.rows[0],
        questions: questionsResult.rows,
        attempts
      });
    } catch (err) {
      console.error("[AdminTests] Failed to fetch test attempts:", err);
      res.status(500).json({ message: "Failed to fetch test attempts" });
    }
  });
  app2.post("/api/admin/tests", requireAdmin2, async (req, res) => {
    try {
      const { title, description, courseId, durationMinutes: durationMinutes2, totalMarks, passingMarks, testType, folderName, difficulty, scheduledAt, miniCourseId, price, subjectKey } = req.body;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db2.query(
        `INSERT INTO tests (title, description, course_id, duration_minutes, total_marks, passing_marks, test_type, folder_name, difficulty, scheduled_at, mini_course_id, price, subject_key, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, TRUE, $14) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          durationMinutes2 || 60,
          totalMarks || 100,
          passingMarks || 35,
          testType || "practice",
          folderName || null,
          difficulty || "moderate",
          scheduledAt ? new Date(scheduledAt).getTime() : null,
          miniCourseId || null,
          parseFloat(price) || 0,
          normalizedSubjectKey,
          Date.now()
        ]
      );
      if (courseId) {
        await updateCourseTestCounts3(courseId);
        const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [courseId]).catch(() => ({ rows: [] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [courseId]).catch(() => ({ rows: [] }));
        const recipientIds = recipients.rows.map((r) => Number(r.user_id));
        const testTypeNorm = String(testType || "practice").toLowerCase();
        const { notifTitle, notifMessage } = testNotificationCopy(testTypeNorm, title, courseTitle);
        const now = Date.now();
        const expiresAt = autoNotificationExpiresAt(now);
        if (recipientIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
               FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, "info", now, expiresAt]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_test_added", testId: result.rows[0]?.id, courseId: Number(courseId) }
        });
      } else {
        const miniId = miniCourseId != null && miniCourseId !== "" ? Number(miniCourseId) : null;
        await notifyStandaloneTestAdded(db2, {
          testId: Number(result.rows[0]?.id),
          title: String(title),
          testType,
          miniCourseId: Number.isFinite(miniId) && miniId > 0 ? miniId : null
        }).catch((err) => console.error("[AdminTests] standalone notify failed:", err));
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to create test" });
    }
  });
  app2.post("/api/admin/questions", requireAdmin2, async (req, res) => {
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
  "backend/admin-test-routes.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_notification_utils();
    init_push_notifications();
  }
});

// backend/admin-question-bulk-routes.ts
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
  requireAdmin: requireAdmin2,
  upload: upload3,
  PDFParse: PDFParse2
}) {
  app2.post("/api/admin/questions/bulk-text", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/questions/bulk-pdf", requireAdmin2, upload3.single("pdf"), async (req, res) => {
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
  app2.post("/api/admin/questions/parse-pdf", requireAdmin2, upload3.single("pdf"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "PDF file is required" });
      }
      if (!/application\/pdf/i.test(String(req.file.mimetype || ""))) {
        return res.status(400).json({ message: "Only PDF files are allowed" });
      }
      const parser = new PDFParse2({ data: req.file.buffer });
      const result = await parser.getText();
      const parsed = parseQuestionsFromText(result.text);
      if (parsed.length === 0) {
        return res.status(400).json({
          message: "No questions could be parsed from this PDF",
          data: { rawTextPreview: result.text.substring(0, 500) }
        });
      }
      res.json({ success: true, count: parsed.length, questions: parsed });
    } catch (err) {
      console.error("[parse-pdf] error:", err);
      res.status(500).json({ message: `Failed to parse PDF: ${err?.message || "unknown error"}` });
    }
  });
  app2.post("/api/admin/questions/bulk-save", requireAdmin2, async (req, res) => {
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
  "backend/admin-question-bulk-routes.ts"() {
    "use strict";
  }
});

// backend/admin-users-and-content-routes.ts
function registerAdminUsersAndContentRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  deleteDownloadsForUser: deleteDownloadsForUser3,
  runInTransaction: runInTransaction2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3
}) {
  app2.post("/api/admin/study-materials", requireAdmin2, async (req, res) => {
    try {
      const { title, description, fileUrl, fileType, courseId, isFree, sectionTitle, downloadAllowed, subjectKey } = req.body;
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
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db2.query(
        `INSERT INTO study_materials (title, description, file_url, file_type, course_id, is_free, section_title, download_allowed, subject_key, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          normalizedTitle,
          description || "",
          normalizedFileUrl,
          fileType || "pdf",
          parsedCourseId,
          parsedCourseId ? false : isFree !== false,
          sectionTitle || null,
          downloadAllowed || false,
          normalizedSubjectKey,
          Date.now()
        ]
      );
      if (parsedCourseId) {
        await db2.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
        await recomputeAllEnrollmentsProgressForCourse3(parsedCourseId);
        const courseInfo = await db2.query("SELECT title FROM courses WHERE id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
        const courseTitle = String(courseInfo.rows[0]?.title || "your course");
        const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
        const recipientIds = recipients.rows.map((r) => Number(r.user_id));
        const notifTitle = "\u{1F4D8} New Material Added";
        const notifMessage = `"${normalizedTitle}" has been added in ${courseTitle}.`;
        const now = Date.now();
        const expiresAt = autoNotificationExpiresAt(now);
        if (recipientIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
               FROM unnest($1::int[]) AS u`,
            [recipientIds, notifTitle, notifMessage, "info", now, expiresAt]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, recipientIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_material_added", materialId: result.rows[0]?.id, courseId: parsedCourseId }
        });
      } else {
        await notifyStandaloneMaterialAdded(db2, {
          materialId: Number(result.rows[0]?.id),
          title: normalizedTitle,
          sectionTitle: sectionTitle || null
        }).catch((err) => console.error("[AdminMaterials] standalone notify failed:", err));
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
  app2.post("/api/admin/study-materials/bulk", requireAdmin2, async (req, res) => {
    try {
      const { courseId, subjectKey, items } = req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ message: "items must contain 1\u201350 materials" });
      }
      const courseCheck = await db2.query("SELECT id, title FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
      if (courseCheck.rows.length === 0) {
        return res.status(404).json({ message: "Course not found" });
      }
      const courseTitle = String(courseCheck.rows[0]?.title || "your course");
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const titles = [];
      const fileUrls = [];
      const fileTypes = [];
      const orderIndexes = [];
      const sectionTitles = [];
      const downloadFlags = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const title = String(item.title || "").trim();
        const fileUrl = String(item.fileUrl || "").trim();
        if (!title || !fileUrl) {
          return res.status(400).json({ message: `Item ${i + 1}: title and fileUrl are required` });
        }
        titles.push(title);
        fileUrls.push(fileUrl);
        fileTypes.push(String(item.fileType || "pdf").trim() || "pdf");
        orderIndexes.push(Number(item.orderIndex) || 0);
        const section = item.sectionTitle != null ? String(item.sectionTitle).trim() : "";
        sectionTitles.push(section || null);
        downloadFlags.push(!!item.downloadAllowed);
      }
      const now = Date.now();
      const inserted = await runInTransaction2(async (tx) => {
        const result = await tx.query(
          `INSERT INTO study_materials (
             title, description, file_url, file_type, course_id, is_free,
             section_title, download_allowed, subject_key, order_index, created_at
           )
           SELECT
             t.title,
             ''::text,
             t.file_url,
             t.file_type,
             $1::int,
             false,
             t.section_title,
             t.download_allowed,
             $2::text,
             t.order_index,
             $3::bigint
           FROM unnest(
             $4::text[],
             $5::text[],
             $6::text[],
             $7::int[],
             $8::text[],
             $9::boolean[]
           ) AS t(title, file_url, file_type, order_index, section_title, download_allowed)
           RETURNING *`,
          [
            parsedCourseId,
            normalizedSubjectKey,
            now,
            titles,
            fileUrls,
            fileTypes,
            orderIndexes,
            sectionTitles,
            downloadFlags
          ]
        );
        return result.rows;
      });
      await db2.query(
        "UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1",
        [parsedCourseId]
      );
      await recomputeAllEnrollmentsProgressForCourse3(parsedCourseId);
      const count = inserted.length;
      const recipients = await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [parsedCourseId]).catch(() => ({ rows: [] }));
      const recipientIds = recipients.rows.map((r) => Number(r.user_id));
      const notifTitle = count === 1 ? "\u{1F4D8} New Material Added" : `\u{1F4D8} ${count} new materials added`;
      const notifMessage = count === 1 ? `"${titles[0]}" has been added in ${courseTitle}.` : `${count} new materials have been added in ${courseTitle}.`;
      const expiresAt = autoNotificationExpiresAt(now);
      if (recipientIds.length > 0) {
        await db2.query(
          `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
             SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint
             FROM unnest($1::int[]) AS u`,
          [recipientIds, notifTitle, notifMessage, "info", now, expiresAt]
        ).catch(() => {
        });
      }
      await sendPushToUsers(db2, recipientIds, {
        title: notifTitle,
        body: notifMessage,
        data: { type: "new_material_added", courseId: parsedCourseId, count }
      });
      res.json({ inserted, count });
    } catch (err) {
      console.error("[AdminMaterials] bulk create failed", {
        courseId: req.body?.courseId,
        itemCount: Array.isArray(req.body?.items) ? req.body.items.length : 0,
        error: err instanceof Error ? err.message : err
      });
      res.status(500).json({ message: "Failed to bulk add materials", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });
  app2.post("/api/admin/live-classes", requireAdmin2, async (req, res) => {
    try {
      const { title, description, courseId, youtubeUrl, scheduledAt, isLive, isPublic, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, lectureSectionTitle, lectureSubfolderTitle, isRecordingMode, visibleAfterAt, subjectKey } = req.body;
      const mainSec = typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() !== "" ? lectureSectionTitle.trim() : null;
      const subSec = typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() !== "" ? lectureSubfolderTitle.trim() : null;
      const recMode = isRecordingMode === true;
      const visAfter = recMode && visibleAfterAt && Number.isFinite(Number(visibleAfterAt)) ? Number(visibleAfterAt) : null;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const result = await db2.query(
        `INSERT INTO live_classes (title, description, course_id, youtube_url, scheduled_at, is_live, is_public, notify_email, notify_bell, is_free_preview, stream_type, chat_mode, show_viewer_count, lecture_section_title, lecture_subfolder_title, is_recording_mode, visible_after_at, subject_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
        [
          title,
          description,
          courseId || null,
          youtubeUrl || null,
          scheduledAt,
          isLive || false,
          recMode ? false : isPublic || false,
          // recording sessions are never public
          recMode ? false : notifyEmail || false,
          recMode ? false : notifyBell || false,
          isFreePreview || false,
          streamType || "rtmp",
          chatMode || "public",
          showViewerCount !== false,
          mainSec,
          subSec,
          recMode,
          visAfter,
          normalizedSubjectKey,
          Date.now()
        ]
      );
      console.log(`[LiveClass] created id=${result.rows[0]?.id} title="${title}" courseId=${courseId} scheduledAt=${scheduledAt} isLive=${isLive} isRecordingMode=${recMode}`);
      await syncLiveClassReminderJob(db2, Number(result.rows[0]?.id)).catch(
        (err) => console.error("[LiveClass] reminder job sync failed:", err)
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[LiveClass] create failed", err);
      res.status(500).json({ message: "Failed to add live class" });
    }
  });
  app2.get("/api/admin/device-block-events", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/device-denied-users", requireAdmin2, async (_req, res) => {
    try {
      const activeWebLockCutoff = Date.now() - 7 * 24 * 60 * 60 * 1e3;
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
         WHERE e.reason IN ('wrong_device_login_denied', 'active_web_session_login_denied', 'max_devices_registered')
           AND (
             e.reason <> 'active_web_session_login_denied'
             OR (
               u.session_token IS NOT NULL
               AND COALESCE(u.last_active_at, 0) >= $1
             )
           )
           AND COALESCE(u.role, '') <> 'admin'
         GROUP BY u.id, u.name, u.phone, u.email
         ORDER BY MAX(e.created_at) DESC NULLS LAST
         LIMIT 200`,
        [activeWebLockCutoff]
      );
      res.json(result.rows);
    } catch (err) {
      console.error("[Admin] device-denied-users:", err);
      res.status(500).json({ message: "Failed to load device-denied users" });
    }
  });
  app2.post("/api/admin/users/:id/reset-device-binding", requireAdmin2, async (req, res) => {
    try {
      const uid = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(uid)) return res.status(400).json({ message: "Invalid user id" });
      await db2.query(
        "UPDATE users SET app_bound_device_id = NULL, session_token = NULL, device_id = NULL, active_session_platform = NULL, web_device_id_phone = NULL, web_device_id_desktop = NULL WHERE id = $1",
        [uid]
      );
      await db2.query("DELETE FROM user_sessions WHERE user_id = $1", [uid]).catch(() => {
      });
      await db2.query(
        "DELETE FROM device_block_events WHERE user_id = $1 AND reason IN ('wrong_device_login_denied', 'active_web_session_login_denied', 'max_devices_registered')",
        [uid]
      ).catch(() => {
      });
      res.json({ success: true });
    } catch (err) {
      console.error("[Admin] reset-device-binding:", err);
      res.status(500).json({ message: "Failed to reset device binding" });
    }
  });
  app2.post("/api/admin/users/cleanup-pending", requireAdmin2, async (_req, res) => {
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
  app2.get("/api/admin/users", requireAdmin2, async (req, res) => {
    try {
      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
      const search = String(req.query.search ?? "").trim();
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
      const where = [];
      const params = [];
      if (search) {
        params.push(`%${search}%`);
        const p = `$${params.length}`;
        where.push(
          `(COALESCE(name,'') ILIKE ${p} OR COALESCE(email,'') ILIKE ${p} OR COALESCE(phone,'') ILIKE ${p})`
        );
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const countResult = await db2.query(
        `SELECT COUNT(*)::int AS total FROM users ${whereSql}`,
        params
      );
      const total = Number(countResult.rows[0]?.total ?? 0);
      params.push(limit, offset);
      const result = await db2.query(
        `SELECT ${selectSql} FROM users ${whereSql} ORDER BY ${orderSql} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      res.setHeader("X-Total-Count", String(total));
      res.setHeader("X-Has-More", String(offset + result.rows.length < total));
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
  app2.get("/api/admin/users/:id/enrollments", requireAdmin2, async (req, res) => {
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
  app2.put("/api/admin/users/:id/block", requireAdmin2, async (req, res) => {
    try {
      const { blocked } = req.body;
      if (blocked) {
        await db2.query("DELETE FROM user_sessions WHERE user_id = $1", [req.params.id]);
        await db2.query("UPDATE users SET is_blocked = TRUE, session_token = NULL WHERE id = $1", [req.params.id]);
        const userId = req.params.id;
        await deleteDownloadsForUser3(parseInt(Array.isArray(userId) ? userId[0] : userId));
      } else {
        await db2.query("UPDATE users SET is_blocked = FALSE WHERE id = $1", [req.params.id]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update user" });
    }
  });
  app2.delete("/api/admin/users/:id", requireAdmin2, async (req, res) => {
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
      await deleteDownloadsForUser3(userId);
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
  "backend/admin-users-and-content-routes.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_notification_utils();
    init_push_notifications();
    init_scheduled_jobs();
    init_user_account_purge();
  }
});

// backend/admin-test-management-routes.ts
function registerAdminTestManagementRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  updateCourseTestCounts: updateCourseTestCounts3
}) {
  app2.get("/api/admin/tests/:id/questions", requireAdmin2, async (req, res) => {
    try {
      const result = await db2.query("SELECT * FROM questions WHERE test_id = $1 ORDER BY order_index ASC, id ASC", [req.params.id]);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch questions" });
    }
  });
  app2.put("/api/admin/questions/:id", requireAdmin2, async (req, res) => {
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
  app2.delete("/api/admin/questions/:id", requireAdmin2, async (req, res) => {
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
  app2.put("/api/admin/tests/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, description, durationMinutes: durationMinutes2, totalMarks, testType, folderName, difficulty, scheduledAt, passingMarks, courseId, price, subjectKey } = req.body;
      const priceVal = price !== void 0 ? parseFloat(price) || 0 : null;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      if (courseId !== void 0) {
        await db2.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9, course_id=$10, subject_key=$12${priceVal !== null ? ", price=$13" : ""} WHERE id=$11`,
          priceVal !== null ? [title, description || "", parseInt(durationMinutes2) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id, normalizedSubjectKey, priceVal] : [title, description || "", parseInt(durationMinutes2) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, courseId || null, req.params.id, normalizedSubjectKey]
        );
        if (courseId) await updateCourseTestCounts3(courseId);
      } else {
        await db2.query(
          `UPDATE tests SET title=$1, description=$2, duration_minutes=$3, total_marks=$4, test_type=$5, folder_name=$6, difficulty=$7, scheduled_at=$8, passing_marks=$9, subject_key=$11${priceVal !== null ? ", price=$12" : ""} WHERE id=$10`,
          priceVal !== null ? [title, description || "", parseInt(durationMinutes2) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id, normalizedSubjectKey, priceVal] : [title, description || "", parseInt(durationMinutes2) || 60, parseInt(totalMarks) || 100, testType, folderName || null, difficulty || "moderate", scheduledAt || null, parseInt(passingMarks) || 35, req.params.id, normalizedSubjectKey]
        );
        const existing = await db2.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
        if (existing.rows[0]?.course_id) await updateCourseTestCounts3(existing.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update test" });
    }
  });
  app2.delete("/api/admin/tests/:id", requireAdmin2, async (req, res) => {
    try {
      const testRow = await db2.query("SELECT course_id FROM tests WHERE id = $1", [req.params.id]);
      const courseId = testRow.rows[0]?.course_id;
      await db2.query("DELETE FROM test_attempts WHERE test_id = $1", [req.params.id]);
      await db2.query("DELETE FROM questions WHERE test_id = $1", [req.params.id]);
      await db2.query("DELETE FROM tests WHERE id = $1", [req.params.id]);
      if (courseId) await updateCourseTestCounts3(courseId);
      res.json({ success: true });
    } catch (err) {
      console.error("Delete test error:", err);
      res.status(500).json({ message: "Failed to delete test" });
    }
  });
}
var init_admin_test_management_routes = __esm({
  "backend/admin-test-management-routes.ts"() {
    "use strict";
  }
});

// backend/admin-daily-mission-routes.ts
async function recomputeMissionCourseProgress(db2, recompute, courseId) {
  if (!recompute) return;
  const cid = courseId != null && courseId !== "" ? Number(courseId) : NaN;
  if (!Number.isFinite(cid) || cid <= 0) return;
  await recompute(cid).catch(() => {
  });
}
function registerAdminDailyMissionRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3
}) {
  app2.post("/api/admin/daily-missions", requireAdmin2, async (req, res) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName, subjectKey } = req.body;
      if (!title || !questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ message: "Title and questions are required" });
      }
      const parsedCourseId = courseId != null && courseId !== "" ? Number(courseId) : null;
      let normalizedSubjectKey = null;
      if (typeof subjectKey === "string" && subjectKey.trim()) {
        normalizedSubjectKey = subjectKey.trim().toLowerCase();
      }
      if (parsedCourseId && Number.isFinite(parsedCourseId)) {
        const courseRow = await db2.query(
          `SELECT COALESCE(course_type, 'live') AS course_type FROM courses WHERE id = $1 LIMIT 1`,
          [parsedCourseId]
        );
        const courseType = String(courseRow.rows[0]?.course_type || "").toLowerCase();
        if (courseType === "multi_subject" && !normalizedSubjectKey) {
          return res.status(400).json({ message: "Subject is required for multisubject course missions" });
        }
      }
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      const result = await db2.query(
        `INSERT INTO daily_missions (title, description, questions, mission_date, xp_reward, mission_type, course_id, folder_name, subject_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, description || "", JSON.stringify(questions), missionDate || (/* @__PURE__ */ new Date()).toISOString().split("T")[0], xpReward || 50, missionType || "daily_drill", parsedCourseId, folderNameNorm, normalizedSubjectKey]
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
      } else if (row?.id != null) {
        await notifyStandaloneMissionAdded(db2, {
          missionId: Number(row.id),
          title: String(title),
          folderName: folderNameNorm
        }).catch((err) => console.error("[AdminMissions] standalone notify failed:", err));
      }
      await recomputeMissionCourseProgress(db2, recomputeAllEnrollmentsProgressForCourse3, courseId);
      res.json(row);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to create daily mission" });
    }
  });
  app2.put("/api/admin/daily-missions/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, description, questions, missionDate, xpReward, missionType, courseId, folderName, subjectKey } = req.body;
      const folderNameNorm = typeof folderName === "string" && folderName.trim() ? folderName.trim() : null;
      const parsedCourseId = courseId != null && courseId !== "" ? Number(courseId) : null;
      let normalizedSubjectKey = null;
      if (typeof subjectKey === "string" && subjectKey.trim()) {
        normalizedSubjectKey = subjectKey.trim().toLowerCase();
      }
      if (parsedCourseId && Number.isFinite(parsedCourseId)) {
        const courseRow = await db2.query(
          `SELECT COALESCE(course_type, 'live') AS course_type FROM courses WHERE id = $1 LIMIT 1`,
          [parsedCourseId]
        );
        const courseType = String(courseRow.rows[0]?.course_type || "").toLowerCase();
        if (courseType === "multi_subject" && !normalizedSubjectKey) {
          return res.status(400).json({ message: "Subject is required for multisubject course missions" });
        }
      }
      await db2.query(
        `UPDATE daily_missions SET title=$1, description=$2, questions=$3, mission_date=$4, xp_reward=$5, mission_type=$6, course_id=$7, folder_name=$8, subject_key=$9 WHERE id=$10`,
        [title, description || "", JSON.stringify(questions), missionDate, xpReward || 50, missionType, parsedCourseId, folderNameNorm, normalizedSubjectKey, req.params.id]
      );
      await recomputeMissionCourseProgress(db2, recomputeAllEnrollmentsProgressForCourse3, courseId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update mission" });
    }
  });
  app2.delete("/api/admin/daily-missions/:id", requireAdmin2, async (req, res) => {
    try {
      const prev = await db2.query("SELECT course_id FROM daily_missions WHERE id = $1 LIMIT 1", [req.params.id]);
      await db2.query("DELETE FROM daily_missions WHERE id = $1", [req.params.id]);
      await recomputeMissionCourseProgress(db2, recomputeAllEnrollmentsProgressForCourse3, prev.rows[0]?.course_id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete mission" });
    }
  });
  app2.get("/api/admin/daily-missions", requireAdmin2, async (_req, res) => {
    try {
      const result = await db2.query("SELECT * FROM daily_missions ORDER BY COALESCE(order_index, 0) ASC, mission_date DESC LIMIT 50");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch missions" });
    }
  });
  app2.get("/api/admin/daily-missions/:id/attempts", requireAdmin2, async (req, res) => {
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
  "backend/admin-daily-mission-routes.ts"() {
    "use strict";
    init_notification_utils();
    init_push_notifications();
  }
});

// backend/admin-content-export-routes.ts
function safeFilename(raw, fallback) {
  const base = String(raw || fallback).replace(/[^\w.\- ()[\]]+/g, "_").slice(0, 120);
  return base || fallback;
}
async function buildQuestionsPdfBuffer(title, subtitle, questions) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  let y = margin;
  const lineHeight = 14;
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  const addLine = (text, opts) => {
    const size = opts?.size ?? 11;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(String(line), margin, y);
      y += lineHeight + (size > 11 ? 4 : 0);
    }
  };
  addLine(title || "Export", { bold: true, size: 16 });
  y += 8;
  if (subtitle) addLine(subtitle);
  y += 12;
  questions.forEach((q, idx) => {
    addLine(`Q${idx + 1}. ${q.question_text || ""}`, { bold: true });
    ["A", "B", "C", "D"].forEach((letter) => {
      const key = `option_${letter.toLowerCase()}`;
      const val = q[key];
      if (val) addLine(`(${letter}) ${val}`);
    });
    if (q.correct_option) addLine(`Answer: ${q.correct_option}`);
    if (q.explanation) addLine(`Explanation: ${q.explanation}`);
    y += 10;
  });
  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
function normalizeMissionQuestions(raw) {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((q) => {
    const options = Array.isArray(q?.options) ? q.options : [];
    return {
      question_text: String(q?.question || q?.question_text || "").trim(),
      option_a: String(options[0] ?? q?.option_a ?? "").trim(),
      option_b: String(options[1] ?? q?.option_b ?? "").trim(),
      option_c: String(options[2] ?? q?.option_c ?? "").trim(),
      option_d: String(options[3] ?? q?.option_d ?? "").trim(),
      correct_option: String(q?.correct || q?.correct_option || "").trim(),
      explanation: String(q?.solution || q?.explanation || "").trim()
    };
  });
}
function guessDownloadExtension(key, contentType, fallback = "") {
  const fromKey = key.match(/(\.[a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (fromKey) return fromKey;
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("pdf")) return ".pdf";
  if (ct.includes("mp4")) return ".mp4";
  if (ct.includes("mpeg")) return ".mp3";
  return fallback;
}
async function streamR2FileToResponse(getR2Client, res, key, downloadName) {
  const bucket = String(process.env.R2_BUCKET_NAME || "").trim();
  if (!bucket) {
    res.status(500).json({ message: "Storage not configured" });
    return;
  }
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = await getR2Client();
  const r2Response = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!r2Response.Body) {
    res.status(404).json({ message: "File not found in storage" });
    return;
  }
  const ext = guessDownloadExtension(key, r2Response.ContentType);
  const baseName = safeFilename(downloadName, "download");
  const filename = baseName.toLowerCase().endsWith(ext) || !ext ? baseName : `${baseName}${ext}`;
  res.setHeader("Content-Type", r2Response.ContentType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Pragma", "no-cache");
  if (r2Response.ContentLength != null) {
    res.setHeader("Content-Length", String(r2Response.ContentLength));
  }
  const stream = r2Response.Body;
  if (typeof stream.pipe !== "function") {
    res.status(500).json({ message: "Could not stream file" });
    return;
  }
  stream.pipe(res);
  stream.on?.("error", (err) => {
    console.error("[admin-export] stream error:", err);
    if (!res.headersSent) res.status(500).json({ message: "Stream error" });
  });
}
function registerAdminContentExportRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  getR2Client
}) {
  app2.get("/api/admin/export/test/:id.pdf", requireAdmin2, async (req, res) => {
    try {
      const testId = Number(req.params.id);
      if (!Number.isFinite(testId)) return res.status(400).json({ message: "Invalid test id" });
      const testRes = await db2.query("SELECT * FROM tests WHERE id = $1 LIMIT 1", [testId]);
      if (!testRes.rows.length) return res.status(404).json({ message: "Test not found" });
      const test = testRes.rows[0];
      const qRes = await db2.query(
        "SELECT * FROM questions WHERE test_id = $1 ORDER BY COALESCE(order_index, 0) ASC, id ASC",
        [testId]
      );
      const pdf = await buildQuestionsPdfBuffer(
        test.title || "Test",
        `Type: ${test.test_type || "practice"} \xB7 Questions: ${qRes.rows.length}`,
        qRes.rows
      );
      const filename = safeFilename(test.title, `test-${testId}`) + ".pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      console.error("[admin-export] test pdf:", err);
      res.status(500).json({ message: "Failed to export test PDF" });
    }
  });
  app2.get("/api/admin/export/material/:id", requireAdmin2, async (req, res) => {
    try {
      const materialId = Number(req.params.id);
      if (!Number.isFinite(materialId)) return res.status(400).json({ message: "Invalid material id" });
      const matRes = await db2.query("SELECT * FROM study_materials WHERE id = $1 LIMIT 1", [materialId]);
      if (!matRes.rows.length) return res.status(404).json({ message: "Material not found" });
      const mat = matRes.rows[0];
      const key = canonicalMediaKey(mat.file_url || "");
      if (!key) return res.status(400).json({ message: "Material has no file" });
      await streamR2FileToResponse(getR2Client, res, key, safeFilename(mat.title, `material-${materialId}`));
    } catch (err) {
      console.error("[admin-export] material:", err);
      res.status(500).json({ message: "Failed to export material" });
    }
  });
  app2.get("/api/admin/export/mission/:id.pdf", requireAdmin2, async (req, res) => {
    try {
      const missionId = Number(String(req.params.id).replace(/\.pdf$/i, ""));
      if (!Number.isFinite(missionId)) return res.status(400).json({ message: "Invalid mission id" });
      const missionRes = await db2.query("SELECT * FROM daily_missions WHERE id = $1 LIMIT 1", [missionId]);
      if (!missionRes.rows.length) return res.status(404).json({ message: "Mission not found" });
      const mission = missionRes.rows[0];
      const questions = normalizeMissionQuestions(mission.questions);
      if (!questions.length) return res.status(400).json({ message: "Mission has no questions" });
      const pdf = await buildQuestionsPdfBuffer(
        mission.title || "Mission",
        `Type: ${mission.mission_type || "daily_drill"} \xB7 Questions: ${questions.length}`,
        questions
      );
      const filename = safeFilename(mission.title, `mission-${missionId}`) + ".pdf";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err) {
      console.error("[admin-export] mission pdf:", err);
      res.status(500).json({ message: "Failed to export mission PDF" });
    }
  });
  app2.get("/api/admin/export/lecture/:id.mp4", requireAdmin2, async (req, res) => {
    try {
      const lectureId = Number(String(req.params.id).replace(/\.mp4$/i, ""));
      if (!Number.isFinite(lectureId)) return res.status(400).json({ message: "Invalid lecture id" });
      const lecRes = await db2.query("SELECT * FROM lectures WHERE id = $1 LIMIT 1", [lectureId]);
      if (!lecRes.rows.length) return res.status(404).json({ message: "Lecture not found" });
      const lec = lecRes.rows[0];
      const key = canonicalMediaKey(lec.video_url || "");
      if (!key) return res.status(400).json({ message: "Lecture has no video file" });
      await streamR2FileToResponse(getR2Client, res, key, safeFilename(lec.title, `lecture-${lectureId}`));
    } catch (err) {
      console.error("[admin-export] lecture mp4:", err);
      res.status(500).json({ message: "Failed to export lecture video" });
    }
  });
}
var init_admin_content_export_routes = __esm({
  "backend/admin-content-export-routes.ts"() {
    "use strict";
    init_media_key_utils();
  }
});

// backend/admin-ops-routes.ts
function registerAdminOpsRoutes({ app: app2, db: db2, getAuthUser: getAuthUser2 }) {
  app2.post("/api/analytics/app-install", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ ok: true });
      if (String(user.role || "") !== "student") return res.json({ ok: true });
      const platform = String(req.body?.platform || "unknown").trim().slice(0, 32);
      const isPwa = req.body?.isPwa === true || req.body?.isPwa === "true";
      const userName = String(user.name || user.phone || user.email || `Student #${user.id}`);
      await notifyAdminsAppInstall(db2, {
        userId: Number(user.id),
        userName,
        platform,
        isPwa
      }).catch((err) => console.error("[AppInstall] admin notify failed:", err));
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
  app2.post("/api/security/capture-attempt", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.json({ ok: true });
      if (String(user.role || "") === "admin") return res.json({ ok: true });
      const kind = req.body?.kind === "recording" ? "recording" : "screenshot";
      const context = String(req.body?.context || "protected content").trim().slice(0, 120);
      const userName = String(user.name || user.phone || user.email || `Student #${user.id}`);
      await notifyAdminsCaptureAttempt(db2, {
        userId: Number(user.id),
        userName,
        context,
        kind
      }).catch((err) => console.error("[CaptureAttempt] admin notify failed:", err));
      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
}
var init_admin_ops_routes = __esm({
  "backend/admin-ops-routes.ts"() {
    "use strict";
    init_notification_utils();
  }
});

// shared/notificationImageUrl.ts
function normalizeNotificationImageUrl(raw) {
  let u = raw.trim().replace(/\s/g, "");
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://")) return `https://${u.slice(7)}`;
  return u;
}
function isGoogleDriveUrl(url) {
  return url.includes("drive.google.com") || url.includes("docs.google.com");
}
function getGoogleDriveFileId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const idParam = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return null;
}
function resolveNotificationImageUrl(raw) {
  const normalized = normalizeNotificationImageUrl(raw);
  if (!normalized) return "";
  if (isGoogleDriveUrl(normalized)) {
    const fileId = getGoogleDriveFileId(normalized);
    if (fileId) return `https://drive.google.com/uc?export=view&id=${fileId}`;
  }
  return normalized;
}
var init_notificationImageUrl = __esm({
  "shared/notificationImageUrl.ts"() {
    "use strict";
  }
});

// backend/admin-notification-routes.ts
function parseNotificationContent(body) {
  const title = String(body.title ?? "").trim();
  const message = String(body.message ?? "").trim();
  const rawImage = String(body.imageUrl ?? "").trim();
  const imageUrl = rawImage ? resolveNotificationImageUrl(rawImage) : "";
  return { title, message, imageUrl };
}
function hasNotificationContent({ title, message, imageUrl }) {
  return !!(title || message || imageUrl);
}
function registerAdminNotificationRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
}) {
  app2.post("/api/admin/notifications/send", requireAdmin2, async (req, res) => {
    try {
      const { userId, type, target, courseId } = req.body;
      const { title, message, imageUrl } = parseNotificationContent(req.body);
      if (!hasNotificationContent({ title, message, imageUrl })) {
        return res.status(400).json({ message: "Provide at least a title, message, or image" });
      }
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
      const expiresAt = null;
      const insertResult = await db2.query(
        "INSERT INTO admin_notifications (title, message, target, course_id, sent_count, image_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        [title || null, message || null, target || "all", courseId || null, userIds.length, imageUrl || null, now]
      );
      const adminNotifId = insertResult.rows[0]?.id || null;
      if (userIds.length > 0) {
        await db2.query(
          `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at, admin_notif_id, image_url)
           SELECT u, $2::text, $3::text, $4::text, $5::bigint, $6::bigint, $7, $8::text
           FROM unnest($1::int[]) AS u`,
          [userIds, title || null, message || null, type || "info", now, expiresAt, adminNotifId, imageUrl || null]
        );
      }
      await sendPushToUsers(db2, userIds.map((id) => Number(id)), {
        title: title || "Notification",
        body: message || "",
        data: { type: "admin_notification", adminNotifId, courseId: courseId || null }
      });
      res.json({ success: true, sent: userIds.length });
    } catch (err) {
      console.error("[NotifSend] error:", err);
      res.status(500).json({ message: "Failed to send notification" });
    }
  });
  app2.get("/api/admin/notifications/history", requireAdmin2, async (_req, res) => {
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
  app2.put("/api/admin/notifications/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, message, imageUrl } = parseNotificationContent(req.body);
      if (!hasNotificationContent({ title, message, imageUrl })) {
        return res.status(400).json({ message: "Provide at least a title, message, or image" });
      }
      const anId = parseInt(String(req.params.id));
      await db2.query(
        "UPDATE admin_notifications SET title = $1, message = $2, image_url = $3 WHERE id = $4",
        [title || null, message || null, imageUrl || null, anId]
      );
      await db2.query(
        "UPDATE notifications SET title = $1, message = $2, image_url = $3 WHERE admin_notif_id = $4",
        [title || null, message || null, imageUrl || null, anId]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update notification" });
    }
  });
  app2.put("/api/admin/notifications/:id/hide", requireAdmin2, async (req, res) => {
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
  app2.delete("/api/admin/notifications/:id", requireAdmin2, async (req, res) => {
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
  "backend/admin-notification-routes.ts"() {
    "use strict";
    init_push_notifications();
    init_notificationImageUrl();
  }
});

// backend/admin-course-crud-routes.ts
function normalizeJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
function normalizeJsonValue(value, fallback = []) {
  if (value === void 0) return fallback;
  if (Array.isArray(value) || value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && (Array.isArray(parsed) || typeof parsed === "object") ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
function normalizeBatchStatus(value) {
  const status = String(value || "").toLowerCase();
  return status === "recorded" || status === "completed" ? "recorded" : "live";
}
function resolveCourseCategory(category, courseType) {
  if (courseType === "test_series") return "Test Series";
  const trimmed = category != null ? String(category).trim() : "";
  return trimmed || "Mathematics";
}
function registerAdminCourseCrudRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
}) {
  app2.post("/api/admin/courses", requireAdmin2, async (req, res) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, courseType, subject, exam, startDate, endDate, validityMonths, thumbnail, coverColor, teacherBio, teacherImageUrl, teacherDetailsJson, multiSubjectConfig, courseLanguage, batchStatus } = req.body;
      const COVER_COLORS = ["#1A56DB", "#7C3AED", "#DC2626", "#059669", "#D97706", "#0891B2", "#DB2777", "#EA580C"];
      const autoColor = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)];
      const normalizedCourseType = courseType || "live";
      const resolvedCoverColor = normalizedCourseType === "multi_subject" ? coverColor || autoColor : null;
      const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
      const subjects = normalizeJsonArray(multiSubjectConfig, [
        { key: "maths", label: "Maths", icon: "calculator" },
        { key: "english", label: "English", icon: "book" },
        { key: "science", label: "Science", icon: "flask" },
        { key: "gk", label: "G.K", icon: "earth" }
      ]);
      const teacherDetails = normalizeJsonValue(teacherDetailsJson, []);
      const resolvedCategory = resolveCourseCategory(category, normalizedCourseType);
      const result = await db2.query(
        `INSERT INTO courses (title, description, teacher_name, price, original_price, category, is_free, level, duration_hours, course_type, subject, exam, start_date, end_date, validity_months, thumbnail, cover_color, teacher_bio, teacher_image_url, teacher_details_json, multi_subject_config, course_language, batch_status, is_published, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22, $23, TRUE, $24) RETURNING *`,
        [title, description, teacherName || "3i Learning", price || 0, originalPrice || 0, resolvedCategory, isFree || false, level || "Beginner", durationHours || 0, normalizedCourseType, subject || "", exam || "", startDate || null, endDate || null, vm, thumbnail || null, resolvedCoverColor, teacherBio || null, teacherImageUrl || null, JSON.stringify(teacherDetails), JSON.stringify(normalizedCourseType === "multi_subject" ? subjects : normalizeJsonArray(multiSubjectConfig)), courseLanguage || "HINGLISH", normalizedCourseType === "multi_subject" ? normalizeBatchStatus(batchStatus) : null, Date.now()]
      );
      if (normalizedCourseType !== "test_series") {
        const course = result.rows[0];
        const students = await db2.query("SELECT id FROM users WHERE role = 'student'").catch(() => ({ rows: [] }));
        const studentIds = students.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
        const notifTitle = "\u{1F4DA} New Course Added";
        const notifMessage = `"${course.title}" is now available.`;
        const courseNotifNow = Date.now();
        const courseNotifExpiresAt = autoNotificationExpiresAt(courseNotifNow);
        if (studentIds.length > 0) {
          await db2.query(
            `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
             SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
             FROM unnest($1::int[]) AS u`,
            [studentIds, notifTitle, notifMessage, courseNotifNow, courseNotifExpiresAt]
          ).catch(() => {
          });
        }
        await sendPushToUsers(db2, studentIds, {
          title: notifTitle,
          body: notifMessage,
          data: { type: "new_course_added", courseId: Number(course.id) }
        }).catch((err) => console.error("[CourseNotify] new course push failed:", err));
      }
      res.json(result.rows[0]);
    } catch (err) {
      console.error("Create course error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to create course" });
    }
  });
  app2.put("/api/admin/courses/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, description, teacherName, price, originalPrice, category, isFree, level, durationHours, isPublished, totalTests, subject, exam, courseType, startDate, endDate, validityMonths, thumbnail, coverColor, teacherBio, teacherImageUrl, teacherDetailsJson, multiSubjectConfig, courseLanguage, batchStatus } = req.body;
      const vm = validityMonths != null && String(validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(validityMonths)) || 0) || null : null;
      const teacherDetails = normalizeJsonValue(teacherDetailsJson, []);
      const subjects = normalizeJsonArray(multiSubjectConfig);
      const existing = await db2.query("SELECT course_type FROM courses WHERE id = $1", [req.params.id]);
      const effectiveCourseType = String(courseType || existing.rows[0]?.course_type || "live");
      const resolvedCategory = resolveCourseCategory(category, effectiveCourseType);
      await db2.query(
        `UPDATE courses SET title=$1, description=$2, teacher_name=$3, price=$4, original_price=$5, category=$6, is_free=$7, level=$8, duration_hours=$9, is_published=$10, total_tests=COALESCE($11, total_tests), subject=COALESCE($12, subject), exam=COALESCE($13, exam), course_type=COALESCE($14, course_type), start_date=COALESCE($15, start_date), end_date=COALESCE($16, end_date), validity_months=COALESCE($17, validity_months), thumbnail=COALESCE($18, thumbnail), cover_color=COALESCE($19, cover_color), teacher_bio=COALESCE($20, teacher_bio), teacher_image_url=COALESCE($21, teacher_image_url), teacher_details_json=COALESCE($22::jsonb, teacher_details_json), multi_subject_config=COALESCE($23::jsonb, multi_subject_config), course_language=COALESCE($24, course_language), batch_status=COALESCE($25, batch_status) WHERE id=$26`,
        [title, description, teacherName, price, originalPrice, resolvedCategory, isFree, level, durationHours, isPublished, totalTests, subject, exam, courseType, startDate, endDate, vm, thumbnail ?? null, coverColor ?? null, teacherBio ?? null, teacherImageUrl ?? null, teacherDetailsJson !== void 0 ? JSON.stringify(teacherDetails) : null, multiSubjectConfig !== void 0 ? JSON.stringify(subjects) : null, courseLanguage ?? null, batchStatus !== void 0 ? normalizeBatchStatus(batchStatus) : null, req.params.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update course" });
    }
  });
}
var init_admin_course_crud_routes = __esm({
  "backend/admin-course-crud-routes.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_push_notifications();
  }
});

// backend/book-routes.ts
function registerBookRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
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
  app2.get("/api/admin/books", requireAdmin2, async (_req, res) => {
    try {
      const result = await db2.query("SELECT * FROM books ORDER BY created_at DESC");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch books" });
    }
  });
  app2.post("/api/admin/books", requireAdmin2, async (req, res) => {
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
  app2.put("/api/admin/books/:id", requireAdmin2, async (req, res) => {
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
  app2.put("/api/admin/books/:id/hide", requireAdmin2, async (req, res) => {
    try {
      const { hidden } = req.body;
      await db2.query("UPDATE books SET is_hidden = $1 WHERE id = $2", [hidden, req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update book" });
    }
  });
  app2.delete("/api/admin/books/:id", requireAdmin2, async (req, res) => {
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
      await db2.query(
        `
        INSERT INTO book_click_tracking (user_id, book_id, click_count, created_at)
        VALUES ($1, $2, 1, $3)
        ON CONFLICT (user_id, book_id) DO UPDATE SET click_count = book_click_tracking.click_count + 1
        RETURNING click_count
      `,
        [user.id, bookId, Date.now()]
      );
      const bookInfo = await db2.query("SELECT title FROM books WHERE id = $1", [bookId]).catch(() => ({ rows: [] }));
      const buyerName = String(user.name || user.phone || user.email || "A student");
      await notifyAdminsBuyNowTap(db2, {
        kind: "book",
        buyerName,
        itemTitle: String(bookInfo.rows[0]?.title || "a book"),
        userId: Number(user.id),
        itemId: Number(bookId)
      }).catch((err) => console.error("[Book] admin buy-now notify failed:", err));
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
      const [bookInfo, userInfo] = await Promise.all([
        db2.query("SELECT title FROM books WHERE id = $1", [bookId]).catch(() => ({ rows: [] })),
        db2.query("SELECT name, phone, email FROM users WHERE id = $1", [userId]).catch(() => ({ rows: [] }))
      ]);
      await notifyAdminsPurchase(db2, {
        kind: "book",
        buyerName: String(userInfo.rows[0]?.name || userInfo.rows[0]?.phone || userInfo.rows[0]?.email || "A student"),
        itemTitle: String(bookInfo.rows[0]?.title || "a book"),
        userId,
        itemId: bookId
      }).catch((err) => console.error("[Book] admin purchase notify failed:", err));
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
      const bookInfo = await db2.query("SELECT title FROM books WHERE id = $1", [parsedBookId]).catch(() => ({ rows: [] }));
      const buyerName = String(user.name || user.phone || user.email || "A student");
      await notifyAdminsPurchase(db2, {
        kind: "book",
        buyerName,
        itemTitle: String(bookInfo.rows[0]?.title || "a book"),
        userId: Number(user.id),
        itemId: parsedBookId
      }).catch((err) => console.error("[Book] admin purchase notify failed:", err));
      res.json({ success: true });
    } catch (err) {
      console.error("Book verify-payment error:", err);
      res.status(500).json({ message: "Failed to verify payment" });
    }
  });
}
var init_book_routes = __esm({
  "backend/book-routes.ts"() {
    "use strict";
    init_native_device_binding();
    init_notification_utils();
  }
});

// backend/standalone-folder-routes.ts
function normalizeStandaloneFolderName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}
function parseParentId2(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}
async function resolveStandaloneFolderFullName(db2, folderId) {
  const result = await db2.query(
    `${STANDALONE_FOLDER_SELECT}
     SELECT full_name
     FROM folder_tree
     WHERE id = $1
     LIMIT 1`,
    [folderId]
  );
  return result.rows[0]?.full_name || null;
}
async function createStandaloneFolderPath(db2, type, rawName, rawParentId, extras) {
  const parts = rawName.split(/\s+\/\s+/).map((p) => normalizeStandaloneFolderName(p)).filter(Boolean);
  const names = parts.length > 0 ? parts : [rawName];
  let parentId = parseParentId2(rawParentId);
  let current = null;
  for (let index = 0; index < names.length; index++) {
    const namePart = names[index];
    const existing = await db2.query(
      `SELECT *
       FROM standalone_folders
       WHERE type = $1
         AND COALESCE(parent_id, 0) = COALESCE($2::int, 0)
         AND LOWER(name) = LOWER($3)
       LIMIT 1`,
      [type, parentId, namePart]
    );
    if (existing.rows.length > 0) {
      current = existing.rows[0];
      if (current.is_hidden) {
        const revived = await db2.query("UPDATE standalone_folders SET is_hidden = FALSE WHERE id = $1 RETURNING *", [current.id]);
        current = revived.rows[0];
      }
    } else if (type === "test" && index === names.length - 1) {
      const vm = extras.validityMonths != null && String(extras.validityMonths).trim() !== "" ? Math.max(0, parseFloat(String(extras.validityMonths)) || 0) || null : null;
      const inserted = await db2.query(
        "INSERT INTO standalone_folders (name, type, parent_id, category, price, original_price, is_free, description, validity_months) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        [namePart, type, parentId, extras.category || null, parseFloat(String(extras.price)) || 0, parseFloat(String(extras.originalPrice)) || 0, extras.isFree !== false, extras.description || null, vm]
      );
      current = inserted.rows[0];
    } else {
      const inserted = await db2.query(
        "INSERT INTO standalone_folders (name, type, parent_id) VALUES ($1, $2, $3) RETURNING *",
        [namePart, type, parentId]
      );
      current = inserted.rows[0];
    }
    parentId = Number(current.id);
  }
  return current;
}
function registerStandaloneFolderRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
}) {
  app2.get("/api/admin/standalone-folders", requireAdmin2, async (req, res) => {
    try {
      const { type } = req.query;
      let q = `${STANDALONE_FOLDER_SELECT} SELECT * FROM folder_tree`;
      const params = [];
      if (type) {
        params.push(type);
        q += ` WHERE type = $1`;
      }
      q += " ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC";
      const result = await db2.query(q, params);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.patch("/api/admin/standalone/reorder", requireAdmin2, async (req, res) => {
    try {
      const { itemType, items } = req.body;
      const TABLE_BY_TYPE = {
        test: { table: "tests", nonCourse: true },
        material: { table: "study_materials", nonCourse: true },
        mission: { table: "daily_missions", nonCourse: false },
        folder: { table: "standalone_folders", nonCourse: false }
      };
      const target = TABLE_BY_TYPE[itemType];
      if (!target) {
        return res.status(400).json({ message: "itemType must be one of: test, material, mission, folder" });
      }
      if (!Array.isArray(items)) {
        return res.status(400).json({ message: "items must be an array" });
      }
      const ids = [];
      const orders = [];
      for (const it of items) {
        const idNum = Number(it?.id);
        const orderNum = Number(it?.orderIndex);
        if (!Number.isFinite(idNum) || idNum <= 0 || !Number.isFinite(orderNum)) continue;
        ids.push(idNum);
        orders.push(orderNum);
      }
      if (ids.length === 0) return res.json({ success: true, updated: 0 });
      const courseScope = target.nonCourse ? ` AND ${target.table}.course_id IS NULL` : "";
      await db2.query(
        `UPDATE ${target.table} SET order_index = v.order_index
         FROM (SELECT unnest($1::int[]) AS id, unnest($2::int[]) AS order_index) v
         WHERE ${target.table}.id = v.id${courseScope}`,
        [ids, orders]
      );
      res.json({ success: true, updated: ids.length });
    } catch (err) {
      console.error("[standalone-reorder] error:", err);
      res.status(500).json({ message: "Failed to reorder items" });
    }
  });
  app2.post("/api/admin/standalone-folders", requireAdmin2, async (req, res) => {
    try {
      const { name, type, parentId, category, price, originalPrice, isFree, description, validityMonths } = req.body;
      const normalizedName = normalizeStandaloneFolderName(name);
      const normalizedType = typeof type === "string" ? type.trim().toLowerCase() : "";
      if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
      if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
      if (!STANDALONE_FOLDER_TYPES.has(normalizedType)) return res.status(400).json({ message: "Invalid folder type" });
      const normalizedParentId = parseParentId2(parentId);
      if (normalizedParentId) {
        const parent = await db2.query(
          "SELECT id FROM standalone_folders WHERE id = $1 AND type = $2 LIMIT 1",
          [normalizedParentId, normalizedType]
        );
        if (parent.rows.length === 0) return res.status(400).json({ message: "Parent folder not found" });
      }
      const folder = await createStandaloneFolderPath(db2, normalizedType, normalizedName, normalizedParentId, {
        category,
        price,
        originalPrice,
        isFree,
        description,
        validityMonths
      });
      const fullName = await resolveStandaloneFolderFullName(db2, folder?.id);
      res.json({ ...folder, full_name: fullName || folder?.name });
    } catch {
      res.status(500).json({ message: "Failed to create folder" });
    }
  });
  app2.put("/api/admin/standalone-folders/:id", requireAdmin2, async (req, res) => {
    try {
      const { name, isHidden, category, price, originalPrice, isFree, description, validityMonths } = req.body;
      if (name !== void 0) {
        const normalizedName = normalizeStandaloneFolderName(name);
        if (!normalizedName) return res.status(400).json({ message: "Folder name is required" });
        if (normalizedName.length > MAX_STANDALONE_FOLDER_NAME_LENGTH) return res.status(400).json({ message: "Folder name is too long" });
        const oldFullName = await resolveStandaloneFolderFullName(db2, req.params.id);
        const current = await db2.query("SELECT id, type FROM standalone_folders WHERE id = $1", [req.params.id]);
        if (current.rows.length > 0) {
          const folderType = current.rows[0].type;
          const dup = await db2.query(
            `SELECT id
             FROM standalone_folders
             WHERE type = $1
               AND COALESCE(parent_id, 0) = COALESCE((SELECT parent_id FROM standalone_folders WHERE id = $3), 0)
               AND LOWER(name) = LOWER($2)
               AND id <> $3
             LIMIT 1`,
            [folderType, normalizedName, req.params.id]
          );
          if (dup.rows.length > 0) {
            return res.status(409).json({ message: "A folder with this name already exists for this type" });
          }
        }
        if (!oldFullName) return res.status(404).json({ message: "Folder not found" });
        await db2.query("UPDATE standalone_folders SET name = $1 WHERE id = $2", [normalizedName, req.params.id]);
        const newFullName = await resolveStandaloneFolderFullName(db2, req.params.id);
        if (newFullName) {
          await db2.query(
            `WITH target AS (
               SELECT type AS folder_type FROM standalone_folders WHERE id = $1
             ),
             upd_tests AS (
               UPDATE tests tt
               SET folder_name = CASE
                 WHEN tt.folder_name = $2 THEN $3
                 ELSE $3 || substring(tt.folder_name from length($2) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'test' AND tt.course_id IS NULL AND (tt.folder_name = $2 OR tt.folder_name LIKE $2 || ' / %')
               RETURNING tt.id
             ),
             upd_missions AS (
               UPDATE daily_missions dm
               SET folder_name = CASE
                 WHEN dm.folder_name = $2 THEN $3
                 ELSE $3 || substring(dm.folder_name from length($2) + 1)
               END
               FROM target t
               WHERE t.folder_type = 'mission' AND (dm.folder_name = $2 OR dm.folder_name LIKE $2 || ' / %')
               RETURNING dm.id
             )
             UPDATE study_materials sm
             SET section_title = CASE
               WHEN sm.section_title = $2 THEN $3
               ELSE $3 || substring(sm.section_title from length($2) + 1)
             END
             FROM target t
             WHERE t.folder_type = 'material' AND sm.course_id IS NULL AND (sm.section_title = $2 OR sm.section_title LIKE $2 || ' / %')`,
            [req.params.id, oldFullName, newFullName]
          );
        }
      } else if (isHidden !== void 0) {
        await db2.query(
          `WITH RECURSIVE descendants AS (
             SELECT id FROM standalone_folders WHERE id = $1
             UNION ALL
             SELECT sf.id FROM standalone_folders sf JOIN descendants d ON sf.parent_id = d.id
           )
           UPDATE standalone_folders SET is_hidden = $2 WHERE id IN (SELECT id FROM descendants)`,
          [req.params.id, isHidden]
        );
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
  app2.delete("/api/admin/standalone-folders/:id", requireAdmin2, async (req, res) => {
    try {
      const fullName = await resolveStandaloneFolderFullName(db2, req.params.id);
      if (!fullName) return res.status(404).json({ message: "Folder not found" });
      await db2.query(
        `WITH RECURSIVE target AS (
           SELECT id, name, type
           FROM standalone_folders
           WHERE id = $1
           UNION ALL
           SELECT sf.id, sf.name, sf.type
           FROM standalone_folders sf
           JOIN target t ON sf.parent_id = t.id
         ),
         del_tests AS (
           DELETE FROM tests tt
           USING target t
           WHERE t.type = 'test' AND tt.course_id IS NULL AND (tt.folder_name = $2 OR tt.folder_name LIKE $2 || ' / %')
           RETURNING tt.id
         ),
         del_materials AS (
           DELETE FROM study_materials sm
           USING target t
           WHERE t.type = 'material' AND sm.course_id IS NULL AND (sm.section_title = $2 OR sm.section_title LIKE $2 || ' / %')
           RETURNING sm.id
         ),
         del_missions AS (
           DELETE FROM daily_missions dm
           USING target t
           WHERE t.type = 'mission' AND (dm.folder_name = $2 OR dm.folder_name LIKE $2 || ' / %')
           RETURNING dm.id
         )
         DELETE FROM standalone_folders sf
         USING target t
         WHERE sf.id = t.id`,
        [req.params.id, fullName]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete folder" });
    }
  });
}
var STANDALONE_FOLDER_TYPES, MAX_STANDALONE_FOLDER_NAME_LENGTH, STANDALONE_FOLDER_SELECT;
var init_standalone_folder_routes = __esm({
  "backend/standalone-folder-routes.ts"() {
    "use strict";
    STANDALONE_FOLDER_TYPES = /* @__PURE__ */ new Set(["test", "material", "mini_course", "mission"]);
    MAX_STANDALONE_FOLDER_NAME_LENGTH = 120;
    STANDALONE_FOLDER_SELECT = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      sf.*,
      sf.name::text AS full_name,
      ARRAY[sf.id] AS path_ids
    FROM standalone_folders sf
    WHERE sf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM standalone_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;
  }
});

// backend/doubt-notification-routes.ts
function normalizeQuestionPattern(input) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\b(please|plz|sir|mam|maam|kindly|can|could|would|help|me|with|solve|question)\b/g, " ").replace(/\s+/g, " ").trim();
}
function parseLimitOffset(rawLimit, rawOffset, fallbackLimit, maxLimit = 100) {
  const limit = Math.max(1, Math.min(maxLimit, Number(rawLimit) || fallbackLimit));
  const offset = Math.max(0, Number(rawOffset) || 0);
  return { limit, offset };
}
function registerDoubtNotificationRoutes({
  app: app2,
  db: db2,
  pool: pool2,
  getAuthUser: getAuthUser2,
  requireAdmin: requireAdmin2,
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
      const slot = await takeSupportPostSlotPg(pool2, user.id, AI_TUTOR_RATE_WINDOW_MS, AI_TUTOR_RATE_MAX);
      if (!slot.ok) {
        return res.status(429).json({
          message: `Too many AI tutor requests. Try again in about ${slot.retryAfterSec} seconds.`
        });
      }
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
  app2.delete("/api/doubts", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const deleted = await db2.query("DELETE FROM doubts WHERE user_id = $1 RETURNING id", [user.id]);
      res.json({ success: true, deletedCount: deleted.rows.length || 0 });
    } catch {
      res.status(500).json({ message: "Failed to clear doubt history" });
    }
  });
  app2.get("/api/admin/doubts", requireAdmin2, async (req, res) => {
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
      const patternCounts = {};
      for (const r of rows) {
        const normalized = normalizeQuestionPattern(String(r.question || ""));
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
  app2.delete("/api/admin/doubts", requireAdmin2, async (req, res) => {
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
  app2.get("/api/admin/doubts/students", requireAdmin2, async (req, res) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1e3 : 0;
      const where = [];
      const params = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (topicFilter && topicFilter !== "all") {
        params.push(topicFilter);
        where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        const qIdx = params.length;
        const digitOnly = q.replace(/\D/g, "");
        let digitClause = "";
        if (digitOnly.length >= 4) {
          params.push(`%${digitOnly}%`);
          digitClause = ` OR regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE $${params.length}`;
        }
        where.push(`(
          COALESCE(u.name, '') ILIKE $${qIdx}
          OR COALESCE(u.phone, '') ILIKE $${qIdx}
          OR COALESCE(u.email, '') ILIKE $${qIdx}
          OR COALESCE(d.question, '') ILIKE $${qIdx}
          ${digitClause}
        )`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const summary = await db2.query(
        `SELECT d.user_id,
                COALESCE(u.name, '') AS user_name,
                COALESCE(u.phone, '') AS user_phone,
                COALESCE(u.email, '') AS user_email,
                COUNT(*)::int AS doubt_count,
                MAX(d.created_at)::bigint AS last_asked_at
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         GROUP BY d.user_id, u.name, u.phone, u.email
         ORDER BY COUNT(*) DESC, MAX(d.created_at) DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const totalRows = await db2.query(
        `SELECT COUNT(*)::int AS total
         FROM (
           SELECT d.user_id
           FROM doubts d
           LEFT JOIN users u ON u.id = d.user_id
           ${whereSql}
           GROUP BY d.user_id
         ) s`,
        params
      );
      res.json({
        rows: summary.rows,
        total: Number(totalRows.rows[0]?.total || 0),
        limit,
        offset
      });
    } catch (err) {
      console.error("[Admin Doubts] students list failed:", err);
      res.status(500).json({ message: "Failed to fetch student doubt history" });
    }
  });
  app2.get("/api/admin/doubts/student/:userId", requireAdmin2, async (req, res) => {
    try {
      const userId = Number(req.params.userId);
      if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ message: "Invalid user id" });
      const daysRaw = String(req.query.days || "").trim();
      const topicFilter = String(req.query.topic || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 50, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1e3 : 0;
      const where = ["d.user_id = $1"];
      const params = [userId];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (topicFilter && topicFilter !== "all") {
        params.push(topicFilter);
        where.push(`COALESCE(d.topic, 'General') = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`(COALESCE(d.question, '') ILIKE $${params.length} OR COALESCE(d.answer, '') ILIKE $${params.length})`);
      }
      const whereSql = `WHERE ${where.join(" AND ")}`;
      const rows = await db2.query(
        `SELECT d.*, COALESCE(u.name, '') AS user_name, COALESCE(u.phone, '') AS user_phone, COALESCE(u.email, '') AS user_email
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );
      const totalRes = await db2.query(
        `SELECT COUNT(*)::int AS total
         FROM doubts d
         ${whereSql}`,
        params
      );
      res.json({
        rows: rows.rows,
        total: Number(totalRes.rows[0]?.total || 0),
        limit,
        offset
      });
    } catch (err) {
      console.error("[Admin Doubts] student details failed:", err);
      res.status(500).json({ message: "Failed to fetch student doubts" });
    }
  });
  app2.get("/api/admin/doubts/frequent", requireAdmin2, async (req, res) => {
    try {
      const daysRaw = String(req.query.days || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1e3 : 0;
      const where = [];
      const params = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        where.push(`d.created_at >= $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        where.push(`COALESCE(d.question, '') ILIKE $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const baseRows = await db2.query(
        `SELECT d.question, d.created_at
         FROM doubts d
         ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 5000`,
        params
      );
      const patternCounts = {};
      for (const r of baseRows.rows) {
        const normalized = normalizeQuestionPattern(String(r.question || ""));
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
      const all = Object.values(patternCounts).sort((a, b) => b.count - a.count || b.latestAt - a.latestAt);
      res.json({
        rows: all.slice(offset, offset + limit),
        total: all.length,
        limit,
        offset
      });
    } catch (err) {
      console.error("[Admin Doubts] frequent list failed:", err);
      res.status(500).json({ message: "Failed to fetch frequent questions" });
    }
  });
  app2.get("/api/admin/doubts/frequent/students", requireAdmin2, async (req, res) => {
    try {
      const pattern = normalizeQuestionPattern(String(req.query.pattern || ""));
      if (!pattern) return res.status(400).json({ message: "Pattern is required" });
      const daysRaw = String(req.query.days || "").trim();
      const q = String(req.query.q || "").trim();
      const { limit, offset } = parseLimitOffset(req.query.limit, req.query.offset, 30, 200);
      const days = daysRaw === "7" || daysRaw === "30" ? Number(daysRaw) : 0;
      const sinceTs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1e3 : 0;
      const filterWhere = [];
      const params = [];
      if (sinceTs > 0) {
        params.push(sinceTs);
        filterWhere.push(`d.created_at >= $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        filterWhere.push(`(
          COALESCE(u.name, '') ILIKE $${params.length}
          OR COALESCE(u.phone, '') ILIKE $${params.length}
          OR COALESCE(u.email, '') ILIKE $${params.length}
          OR COALESCE(d.question, '') ILIKE $${params.length}
        )`);
      }
      const whereSql = filterWhere.length ? `AND ${filterWhere.join(" AND ")}` : "";
      const raw = await db2.query(
        `SELECT d.user_id,
                COALESCE(u.name, '') AS user_name,
                COALESCE(u.phone, '') AS user_phone,
                COALESCE(u.email, '') AS user_email,
                d.question,
                d.created_at
         FROM doubts d
         LEFT JOIN users u ON u.id = d.user_id
         WHERE TRUE ${whereSql}
         ORDER BY d.created_at DESC
         LIMIT 6000`,
        params
      );
      const matched = raw.rows.filter((r) => normalizeQuestionPattern(String(r.question || "")) === pattern);
      const grouped = /* @__PURE__ */ new Map();
      for (const r of matched) {
        const id = Number(r.user_id || 0);
        if (!grouped.has(id)) {
          grouped.set(id, {
            user_id: id,
            user_name: String(r.user_name || ""),
            user_phone: String(r.user_phone || ""),
            user_email: String(r.user_email || ""),
            doubt_count: 0,
            last_asked_at: 0
          });
        }
        const g = grouped.get(id);
        g.doubt_count += 1;
        g.last_asked_at = Math.max(g.last_asked_at, Number(r.created_at || 0));
      }
      const rows = [...grouped.values()].sort((a, b) => b.doubt_count - a.doubt_count || b.last_asked_at - a.last_asked_at);
      res.json({
        rows: rows.slice(offset, offset + limit),
        total: rows.length,
        limit,
        offset
      });
    } catch (err) {
      console.error("[Admin Doubts] frequent students failed:", err);
      res.status(500).json({ message: "Failed to fetch students for frequent question" });
    }
  });
  app2.get("/api/notifications", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const now = Date.now();
      const isAdmin = String(user.role || "") === "admin";
      const result = isAdmin ? await db2.query(
        `SELECT * FROM notifications WHERE user_id = $1
             AND source = 'admin_ops'
             AND (is_hidden IS NOT TRUE)
             ORDER BY created_at DESC LIMIT 100`,
        [user.id]
      ) : await db2.query(
        `SELECT * FROM notifications WHERE user_id = $1
             AND (source IS NULL OR source != 'support')
             AND (is_hidden IS NOT TRUE)
             AND (
               admin_notif_id IS NOT NULL
               OR is_read IS NOT TRUE
               OR (hide_after_at IS NOT NULL AND hide_after_at > $2)
             )
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
      const now = Date.now();
      const existing = await db2.query(
        "SELECT id, admin_notif_id, expires_at, is_read, source FROM notifications WHERE id = $1 AND user_id = $2",
        [req.params.id, user.id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ message: "Notification not found" });
      }
      const row = existing.rows[0];
      const isAdminOps = row.source === "admin_ops";
      const hideAfterAt = isAdminOps ? null : row.admin_notif_id != null ? null : computeAutoNotificationHideAfterAt(now, row.expires_at != null ? Number(row.expires_at) : null);
      await db2.query(
        `UPDATE notifications
         SET is_read = TRUE,
             hide_after_at = CASE
               WHEN source = 'admin_ops' THEN hide_after_at
               WHEN admin_notif_id IS NOT NULL THEN hide_after_at
               WHEN $3::bigint IS NOT NULL THEN $3::bigint
               ELSE hide_after_at
             END
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id, hideAfterAt]
      );
      res.json({ success: true, hide_after_at: hideAfterAt });
    } catch {
      res.status(500).json({ message: "Failed to mark as read" });
    }
  });
}
var AI_TUTOR_RATE_WINDOW_MS, AI_TUTOR_RATE_MAX;
var init_doubt_notification_routes = __esm({
  "backend/doubt-notification-routes.ts"() {
    "use strict";
    init_auto_notification_expiry();
    init_pg_rate_limit_store();
    AI_TUTOR_RATE_WINDOW_MS = 60 * 60 * 1e3;
    AI_TUTOR_RATE_MAX = 20;
  }
});

// backend/standalone-entitlement-service.ts
async function hasActiveStandaloneEntitlement(db2, userId, materialId) {
  const now = Date.now();
  const ent = await db2.query(
    `SELECT id
     FROM standalone_material_entitlements
     WHERE user_id = $1
       AND material_id = $2
       AND is_active = TRUE
       AND (expires_at IS NULL OR expires_at > $3)
     LIMIT 1`,
    [userId, materialId, now]
  );
  return ent.rows.length > 0;
}
var init_standalone_entitlement_service = __esm({
  "backend/standalone-entitlement-service.ts"() {
    "use strict";
  }
});

// backend/student-mission-material-routes.ts
function registerStudentMissionMaterialRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  updateCourseProgress: updateCourseProgress3
}) {
  const canAccessStandaloneMaterial = async (user, material) => {
    if (material?.is_free) return true;
    if (user?.role === "admin") return true;
    if (!user?.id || !material?.id) return false;
    return hasActiveStandaloneEntitlement(db2, Number(user.id), Number(material.id));
  };
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
  const listAccessibleDailyMissions = async (user, opts) => {
    const { type, folderName } = opts;
    let query = `SELECT dm.*, c.title AS course_title
      FROM daily_missions dm
      LEFT JOIN courses c ON c.id = dm.course_id
      WHERE 1=1`;
    if (!folderName) {
      query += ` AND dm.mission_date <= CURRENT_DATE`;
    }
    const params = [];
    if (type && type !== "all") {
      params.push(type);
      query += ` AND dm.mission_type = $${params.length}`;
    }
    if (folderName) {
      params.push(folderName);
      query += ` AND dm.folder_name = $${params.length}`;
    }
    query += " ORDER BY COALESCE(dm.order_index, 0) ASC, dm.mission_date ASC LIMIT 200";
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
      const freeFolderNames = /* @__PURE__ */ new Set();
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
        const folderNamesInResult = [
          ...new Set(
            result.rows.map((m) => m.folder_name).filter((n) => typeof n === "string" && n.length > 0)
          )
        ];
        if (folderNamesInResult.length > 0) {
          const freeRows = await db2.query(
            `${STANDALONE_FOLDER_SELECT2}
             SELECT full_name
             FROM folder_tree
             WHERE type = 'mission' AND is_free = TRUE AND full_name = ANY($1::text[])`,
            [folderNamesInResult]
          );
          for (const row of freeRows.rows) freeFolderNames.add(String(row.full_name));
        }
      }
      const missionAccessible = (mission) => {
        if (mission?.mission_type === "free_practice") return true;
        if (user.role === "admin") return true;
        if (mission?.folder_name && freeFolderNames.has(String(mission.folder_name))) return true;
        const cid = Number(mission?.course_id);
        if (!Number.isFinite(cid) || cid <= 0) return false;
        return enrolledCourseIds.has(cid);
      };
      for (const mission of result.rows) {
        mission.isAccessible = missionAccessible(mission);
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
    return result.rows;
  };
  app2.get("/api/daily-missions", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const { type } = req.query;
      const rows = await listAccessibleDailyMissions(user, { type: String(type || "all") });
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch daily missions" });
    }
  });
  app2.get("/api/daily-missions/folder/:folderName", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const { type } = req.query;
      const folderName = decodeURIComponent(String(req.params.folderName || "")).trim();
      if (!folderName) return res.status(400).json({ message: "Folder name required" });
      const rows = await listAccessibleDailyMissions(user, {
        type: String(type || "all"),
        folderName
      });
      res.set("Cache-Control", "private, no-store");
      res.json(rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch folder missions" });
    }
  });
  app2.get("/api/mission-folders", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `${STANDALONE_FOLDER_SELECT2}
         SELECT
           id,
           name,
           parent_id,
           full_name,
           category,
           validity_months,
           is_free,
           description,
           created_at
         FROM folder_tree
         WHERE type = 'mission'
           AND (is_hidden = FALSE OR is_hidden IS NULL)
         ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`
      );
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch (err) {
      console.error("[MissionFolders] error:", err);
      res.status(500).json({ message: "Failed to fetch mission folders" });
    }
  });
  app2.get("/api/daily-missions/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const missionId = Number(req.params.id);
      if (!Number.isFinite(missionId) || missionId <= 0) {
        return res.status(400).json({ message: "Invalid mission id" });
      }
      const result = await db2.query(
        `SELECT dm.*, c.title AS course_title
         FROM daily_missions dm
         LEFT JOIN courses c ON c.id = dm.course_id
         WHERE dm.id = $1
         LIMIT 1`,
        [missionId]
      );
      if (result.rows.length === 0) return res.status(404).json({ message: "Mission not found" });
      const mission = result.rows[0];
      if (user) {
        const um = await db2.query(
          "SELECT * FROM user_missions WHERE user_id = $1 AND mission_id = $2 LIMIT 1",
          [user.id, missionId]
        );
        const row = um.rows[0];
        mission.isCompleted = !!row?.is_completed;
        mission.userScore = row?.score || 0;
        mission.userTimeTaken = row?.time_taken || 0;
        mission.userAnswers = row?.answers || {};
        mission.userIncorrect = row?.incorrect || 0;
        mission.userSkipped = row?.skipped || 0;
        let isAccessible = mission.mission_type === "free_practice" || user.role === "admin";
        if (!isAccessible && mission.folder_name) {
          const freeRows = await db2.query(
            `${STANDALONE_FOLDER_SELECT2}
             SELECT full_name FROM folder_tree
             WHERE type = 'mission' AND is_free = TRUE AND full_name = $1
             LIMIT 1`,
            [String(mission.folder_name)]
          );
          if (freeRows.rows.length > 0) isAccessible = true;
        }
        if (!isAccessible) {
          isAccessible = await canAccessMission(user, mission);
        }
        mission.isAccessible = isAccessible;
        if (user.role !== "admin" && !isAccessible) {
          return res.status(403).json({ message: "Access denied" });
        }
      } else {
        mission.isAccessible = mission.mission_type === "free_practice";
        if (!mission.isAccessible) return res.status(401).json({ message: "Not authenticated" });
      }
      res.set("Cache-Control", "private, no-store");
      res.json(mission);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch mission" });
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
      const courseId = mission.course_id != null ? Number(mission.course_id) : NaN;
      if (updateCourseProgress3 && Number.isFinite(courseId) && courseId > 0) {
        await updateCourseProgress3(user.id, courseId).catch(() => {
        });
      }
      res.json({ success: true });
    } catch (err) {
      console.error("[Mission Complete] Error:", err);
      res.status(500).json({ message: "Failed to complete mission" });
    }
  });
  const STANDALONE_HOME_ORDER = " ORDER BY COALESCE(order_index, 0) ASC, created_at DESC";
  const queryStandaloneMaterialsForHome = async (user) => {
    if (user?.role === "admin") {
      const result2 = await db2.query(
        `SELECT * FROM study_materials WHERE course_id IS NULL AND is_free = TRUE${STANDALONE_HOME_ORDER}`,
        []
      );
      return result2.rows;
    }
    if (!user) {
      const result2 = await db2.query(
        `SELECT id, title, description, file_type, course_id, is_free, section_title, download_allowed, created_at, file_url
         FROM study_materials
         WHERE course_id IS NULL AND is_free = TRUE${STANDALONE_HOME_ORDER}`,
        []
      );
      return result2.rows;
    }
    const result = await db2.query(
      `SELECT * FROM study_materials
       WHERE course_id IS NULL AND is_free = TRUE${STANDALONE_HOME_ORDER}`,
      []
    );
    return result.rows;
  };
  app2.get("/api/study-materials", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const { free } = req.query;
      const now = Date.now();
      const loadFolders = async () => {
        if (free !== "true") return [];
        const foldersResult = await db2.query(
          `${STANDALONE_FOLDER_SELECT2}
           SELECT *
           FROM folder_tree
           WHERE type = 'material' AND (is_hidden = FALSE OR is_hidden IS NULL)
           ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`
        );
        return foldersResult.rows;
      };
      if (free === "true") {
        const materials = await queryStandaloneMaterialsForHome(user);
        const folders = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials, folders });
      }
      if (user?.role === "admin") {
        const result2 = await db2.query(`SELECT * FROM study_materials${STANDALONE_HOME_ORDER}`, []);
        const folders = await loadFolders();
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result2.rows, folders });
      }
      if (!user) {
        const result2 = await db2.query(
          `SELECT id, title, description, file_type, course_id, is_free, section_title, download_allowed, created_at, file_url
           FROM study_materials
           WHERE is_free = TRUE${STANDALONE_HOME_ORDER}`,
          []
        );
        res.set("Cache-Control", "private, no-store");
        return res.json({ materials: result2.rows, folders: [] });
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
         ORDER BY COALESCE(sm.order_index, 0) ASC, sm.created_at DESC`,
        [user.id, now]
      );
      const filteredRows = [];
      for (const row of result.rows) {
        if (!row.course_id) {
          if (await canAccessStandaloneMaterial(user, row)) filteredRows.push(row);
          continue;
        }
        filteredRows.push(row);
      }
      res.set("Cache-Control", "private, no-store");
      res.json({ materials: filteredRows, folders: [] });
    } catch {
      res.status(500).json({ message: "Failed to fetch materials" });
    }
  });
  app2.get("/api/study-materials/folder/:folderName", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const folderName = decodeURIComponent(String(req.params.folderName));
      const result = await db2.query(
        `SELECT *
         FROM study_materials
         WHERE course_id IS NULL
           AND (section_title = $1 OR section_title LIKE $1 || ' / %')
         ORDER BY COALESCE(order_index, 0) ASC, created_at DESC`,
        [folderName]
      );
      const safeRows = [];
      for (const row of result.rows) {
        if (await canAccessStandaloneMaterial(user, row)) safeRows.push(row);
      }
      res.json(safeRows);
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
      } else {
        const user = await getAuthUser2(req);
        const allowed = await canAccessStandaloneMaterial(user, m);
        if (!allowed) return res.status(403).json({ message: "Access denied" });
      }
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to fetch material" });
    }
  });
}
var STANDALONE_FOLDER_SELECT2;
var init_student_mission_material_routes = __esm({
  "backend/student-mission-material-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_standalone_entitlement_service();
    STANDALONE_FOLDER_SELECT2 = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      sf.*,
      sf.name::text AS full_name,
      ARRAY[sf.id] AS path_ids
    FROM standalone_folders sf
    WHERE sf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM standalone_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;
  }
});

// backend/lecture-payload-utils.ts
function sanitizeLectureRowForClient(row) {
  if (!row || typeof row !== "object") return row;
  const { transcript: _omit, ...rest } = row;
  return rest;
}
var init_lecture_payload_utils = __esm({
  "backend/lecture-payload-utils.ts"() {
    "use strict";
  }
});

// backend/lecture-routes.ts
function registerLectureRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  updateCourseProgress: updateCourseProgress3
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
        "SELECT is_completed, watch_percent, COALESCE(playback_sessions, 0) AS playback_sessions, COALESCE(last_position_seconds, 0) AS last_position_seconds FROM lecture_progress WHERE user_id = $1 AND lecture_id = $2",
        [user.id, req.params.id]
      );
      if (result.rows.length === 0) return res.json({ is_completed: false, watch_percent: 0, playback_sessions: 0, last_position_seconds: 0 });
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
      if (canBump || !row) {
        await db2.query(
          `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, playback_sessions, last_session_ping_at, completed_at)
           VALUES ($1, $2, 0, false, 1, $3, NULL)
           ON CONFLICT (user_id, lecture_id) DO UPDATE SET
             playback_sessions = CASE
               WHEN lecture_progress.last_session_ping_at IS NULL OR $3 - lecture_progress.last_session_ping_at >= $4
               THEN COALESCE(lecture_progress.playback_sessions, 0) + 1
               ELSE COALESCE(lecture_progress.playback_sessions, 0)
             END,
             last_session_ping_at = CASE
               WHEN lecture_progress.last_session_ping_at IS NULL OR $3 - lecture_progress.last_session_ping_at >= $4
               THEN $3
               ELSE lecture_progress.last_session_ping_at
             END`,
          [user.id, lectureId, now, debounceMs]
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
      const { watchPercent, isCompleted, lastPositionSeconds } = req.body;
      const access = await canAccessLecture(user, lectureId);
      if (!access.lecture) return res.status(404).json({ message: "Lecture not found" });
      if (!access.allowed) return res.status(403).json({ message: "Access denied for this lecture" });
      const lecture = access.lecture;
      const courseId = lecture.course_id ? Number(lecture.course_id) : null;
      const normalizedWatchPercent = Math.max(0, Math.min(100, Number(watchPercent) || 0));
      const normalizedPosition = Math.max(0, Math.floor(Number(lastPositionSeconds) || 0));
      await db2.query(
        `INSERT INTO lecture_progress (user_id, lecture_id, watch_percent, is_completed, completed_at, last_position_seconds)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, lecture_id) DO UPDATE SET
           watch_percent          = GREATEST(lecture_progress.watch_percent, EXCLUDED.watch_percent),
           is_completed           = lecture_progress.is_completed OR EXCLUDED.is_completed,
           last_position_seconds  = EXCLUDED.last_position_seconds,
           completed_at           = CASE
             WHEN EXCLUDED.is_completed AND NOT lecture_progress.is_completed THEN EXCLUDED.completed_at
             ELSE lecture_progress.completed_at
           END`,
        [user.id, lectureId, normalizedWatchPercent, Boolean(isCompleted), isCompleted ? Date.now() : null, normalizedPosition]
      );
      if (courseId && isCompleted) {
        await updateCourseProgress3(user.id, Number(courseId));
        await db2.query("UPDATE enrollments SET last_lecture_id = $1 WHERE user_id = $2 AND course_id = $3", [lectureId, user.id, courseId]);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update progress" });
    }
  });
}
var init_lecture_routes = __esm({
  "backend/lecture-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_lecture_payload_utils();
  }
});

// backend/test-folder-routes.ts
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
        `${STANDALONE_FOLDER_SELECT3}
         SELECT
           folder_tree.*,
           (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = folder_tree.id) as total_tests
         FROM folder_tree
         WHERE type = 'mini_course'
           AND parent_id IS NULL
           AND (is_hidden = FALSE OR is_hidden IS NULL)
         ORDER BY created_at DESC`
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
      const folder = await db2.query(
        `${STANDALONE_FOLDER_SELECT3}
         SELECT *
         FROM folder_tree
         WHERE id = $1 AND type = 'mini_course'`,
        [req.params.id]
      );
      if (folder.rows.length === 0) return res.status(404).json({ message: "Folder not found" });
      const f = folder.rows[0];
      const tests = await db2.query("SELECT t.*, t.folder_name as sub_folder FROM tests t WHERE t.mini_course_id = $1 ORDER BY t.folder_name ASC NULLS LAST, t.created_at ASC", [f.id]);
      const childFolders = await db2.query(
        `${STANDALONE_FOLDER_SELECT3}
         SELECT
           folder_tree.*,
           (SELECT COUNT(*) FROM tests t WHERE t.mini_course_id = folder_tree.id) as total_tests
         FROM folder_tree
         WHERE type = 'mini_course'
           AND parent_id = $1
           AND (is_hidden = FALSE OR is_hidden IS NULL)
         ORDER BY order_index ASC, created_at ASC`,
        [f.id]
      );
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
      res.json({ ...f, is_purchased: isPurchased, child_folders: childFolders.rows, tests: tests.rows, attempts });
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
      const buyerName = String(user.name || user.phone || user.email || "A student");
      await notifyAdminsBuyNowTap(db2, {
        kind: "folder",
        buyerName,
        itemTitle: String(folder.name || "a test series folder"),
        userId: Number(user.id),
        itemId: folderId
      }).catch((err) => console.error("[TestFolder] admin buy-now notify failed:", err));
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
      const [folderInfo, userInfo] = await Promise.all([
        db2.query("SELECT name FROM standalone_folders WHERE id = $1", [parsedFolderId]).catch(() => ({ rows: [] })),
        db2.query("SELECT name, phone, email FROM users WHERE id = $1", [user.id]).catch(() => ({ rows: [] }))
      ]);
      await notifyAdminsPurchase(db2, {
        kind: "folder",
        buyerName: String(userInfo.rows[0]?.name || userInfo.rows[0]?.phone || userInfo.rows[0]?.email || "A student"),
        itemTitle: String(folderInfo.rows[0]?.name || "a test series folder"),
        userId: Number(user.id),
        itemId: parsedFolderId
      }).catch((err) => console.error("[TestFolder] admin purchase notify failed:", err));
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
      const [folderInfo, userInfo] = await Promise.all([
        db2.query("SELECT name FROM standalone_folders WHERE id = $1", [folderId]).catch(() => ({ rows: [] })),
        db2.query("SELECT name, phone, email FROM users WHERE id = $1", [userId]).catch(() => ({ rows: [] }))
      ]);
      await notifyAdminsPurchase(db2, {
        kind: "folder",
        buyerName: String(userInfo.rows[0]?.name || userInfo.rows[0]?.phone || userInfo.rows[0]?.email || "A student"),
        itemTitle: String(folderInfo.rows[0]?.name || "a test series folder"),
        userId,
        itemId: folderId
      }).catch((err) => console.error("[TestFolder] admin purchase notify failed:", err));
      return res.redirect(`${frontendBase}/test-folder/${folderId}?payment=success`);
    } catch (err) {
      console.error("Test folder verify-redirect error:", err);
      return res.redirect(fail);
    }
  });
}
var STANDALONE_FOLDER_SELECT3;
var init_test_folder_routes = __esm({
  "backend/test-folder-routes.ts"() {
    "use strict";
    init_native_device_binding();
    init_notification_utils();
    STANDALONE_FOLDER_SELECT3 = `
  WITH RECURSIVE folder_tree AS (
    SELECT
      sf.*,
      sf.name::text AS full_name,
      ARRAY[sf.id] AS path_ids
    FROM standalone_folders sf
    WHERE sf.parent_id IS NULL
    UNION ALL
    SELECT
      child.*,
      (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
      folder_tree.path_ids || child.id AS path_ids
    FROM standalone_folders child
    JOIN folder_tree ON child.parent_id = folder_tree.id
    WHERE NOT child.id = ANY(folder_tree.path_ids)
  )
`;
  }
});

// backend/test-access-guards.ts
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
  "backend/test-access-guards.ts"() {
    "use strict";
    init_course_access_utils();
  }
});

// backend/test-core-routes.ts
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
  updateCourseProgress: updateCourseProgress3
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
      query += " ORDER BY COALESCE(t.order_index, 0) ASC, t.created_at DESC";
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
          await updateCourseProgress3(user.id, test.course_id);
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
  "backend/test-core-routes.ts"() {
    "use strict";
    init_test_access_guards();
    init_course_access_utils();
  }
});

// backend/test-attempt-routes.ts
function registerTestAttemptRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
  const handleMyAttempts = async (req, res) => {
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
  };
  app2.get("/api/tests/:id/my-attempts", handleMyAttempts);
  app2.get("/api/tests/:id/my_attempts", handleMyAttempts);
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
  "backend/test-attempt-routes.ts"() {
    "use strict";
    init_test_access_guards();
  }
});

// backend/live-class-routes.ts
function registerLiveClassRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2
}) {
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
            `SELECT lc.*, c.title as course_title
             FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
             WHERE lc.course_id = $1
             ORDER BY lc.scheduled_at DESC
             LIMIT 500`,
            [cid]
          );
          res.set("Cache-Control", "private, no-store");
          return res.json(result3.rows.map(sanitizeLiveClass));
        }
        const rawLimit = parseInt(String(req.query.limit || "200"), 10);
        const rawOffset = parseInt(String(req.query.offset || "0"), 10);
        const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;
        const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           ORDER BY lc.scheduled_at DESC
           LIMIT $1 OFFSET $2`,
          [safeLimit, safeOffset]
        );
        res.set("Cache-Control", "private, no-store");
        return res.json(result2.rows.map(sanitizeLiveClass));
      }
      const ex23 = sqlEnrollmentExistsForLiveList(2, 3);
      const now = Date.now();
      if (cid && user) {
        const rawLimit = parseInt(String(req.query.limit || "20"), 10);
        const rawOffset = parseInt(String(req.query.offset || "0"), 10);
        const safeLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 20;
        const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
        const safeLimitPlusOne = safeLimit + 1;
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free,
            ${ex23} as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
             AND (
               lc.is_completed IS NOT TRUE
               OR (
                 lc.recording_url IS NOT NULL
                 OR lc.cf_playback_hls IS NOT NULL
                 OR (lc.youtube_url IS NOT NULL AND TRIM(lc.youtube_url) != '')
               )
             )
             AND (lc.is_free_preview = TRUE OR ${ex23})
           ORDER BY lc.scheduled_at DESC
           LIMIT $4 OFFSET $5`,
          [cid, user.id, now, safeLimitPlusOne, safeOffset]
        );
        const hasMore = result2.rows.length > safeLimit;
        const rowsToSend = hasMore ? result2.rows.slice(0, safeLimit) : result2.rows;
        res.set("Cache-Control", "private, no-store");
        res.set("X-Has-More", hasMore ? "true" : "false");
        return res.json(rowsToSend.map(sanitizeLiveClass));
      }
      if (cid) {
        const result2 = await db2.query(
          `SELECT lc.*, c.title as course_title, c.is_free as course_is_free, FALSE as is_enrolled
           FROM live_classes lc LEFT JOIN courses c ON c.id = lc.course_id
           WHERE lc.course_id = $1
             AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
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
           WHERE COALESCE(lc.is_recording_mode, FALSE) = FALSE
             AND (
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
         WHERE COALESCE(lc.is_recording_mode, FALSE) = FALSE
           AND (
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
  app2.get("/api/upcoming-classes", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      const isAdmin = user?.role === "admin";
      let result;
      if (isAdmin) {
        result = await db2.query(`
          SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
          FROM live_classes lc
          LEFT JOIN courses c ON c.id = lc.course_id
          WHERE lc.is_completed IS NOT TRUE
          ORDER BY
            lc.is_live DESC,
            lc.scheduled_at ASC NULLS LAST
          LIMIT 200
        `);
        console.log(`[UpcomingClasses] admin: returning ${result.rows.length} classes`);
        res.set("Cache-Control", "private, no-store");
        return res.json(result.rows.map(sanitizeLiveClass));
      }
      result = await db2.query(`
        SELECT lc.*, c.title as course_title, c.is_free as course_is_free, c.category as course_category
        FROM live_classes lc
        LEFT JOIN courses c ON c.id = lc.course_id
        WHERE lc.is_completed IS NOT TRUE
          AND COALESCE(lc.is_recording_mode, FALSE) = FALSE
          AND (
            lc.course_id IS NULL
            OR lc.is_public = TRUE
            OR lc.is_free_preview = TRUE
            OR c.is_free = TRUE
          )
        ORDER BY
          lc.is_live DESC,
          lc.scheduled_at ASC NULLS LAST
        LIMIT 50
      `);
      console.log(`[UpcomingClasses] public: returning ${result.rows.length} classes`);
      res.set("Cache-Control", "private, max-age=30");
      res.json(result.rows.map(toPublicUpcomingDto));
    } catch (err) {
      console.error("[UpcomingClasses] error:", err);
      res.set("Cache-Control", "private, max-age=30");
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
  "backend/live-class-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_live_class_access();
  }
});

// shared/classroomPipPosition.ts
function normalizePipPosition(value) {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (VALID.has(s)) return s;
  return DEFAULT_PIP_POSITION;
}
var DEFAULT_PIP_POSITION, VALID;
var init_classroomPipPosition = __esm({
  "shared/classroomPipPosition.ts"() {
    "use strict";
    DEFAULT_PIP_POSITION = "bottom-left";
    VALID = /* @__PURE__ */ new Set(["top-right", "bottom-right", "top-left", "bottom-left"]);
  }
});

// shared/recordingUrl.ts
function isBoardSnapshotImageUrl(url) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(String(url || "").trim());
}
function isVideoRecordingUrl(url) {
  const lower = String(url || "").trim().toLowerCase();
  if (!lower) return false;
  if (isBoardSnapshotImageUrl(lower)) return false;
  if (/\.(mp4|webm|mov|mkv|avi|m3u8)(\?|$)/.test(lower)) return true;
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return true;
  if (lower.includes("videodelivery.net")) return true;
  return lower.includes("/api/media/");
}
function pickVideoRecordingUrlFromRow(row, fallback) {
  const candidates = (r) => [r.recording_url, r.cf_playback_hls, r.youtube_url].map((u) => String(u || "").trim());
  for (const url of candidates(row)) {
    if (isVideoRecordingUrl(url)) return url;
  }
  if (fallback) {
    for (const url of candidates(fallback)) {
      if (isVideoRecordingUrl(url)) return url;
    }
  }
  return "";
}
var init_recordingUrl = __esm({
  "shared/recordingUrl.ts"() {
    "use strict";
  }
});

// backend/live-class-lecture-convert.ts
function inferVideoType2(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
  return "r2";
}
function pickRecordingUrl(row, fallback) {
  return pickVideoRecordingUrlFromRow(row, fallback);
}
function durationMinutes(peer, anchor) {
  if (peer.started_at && peer.ended_at) {
    return Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 6e4));
  }
  if (peer.duration_minutes != null) return Number(peer.duration_minutes);
  if (anchor.duration_minutes != null) return Number(anchor.duration_minutes);
  return 0;
}
async function convertLiveClassTitlePeersToLectures(db2, anchor, opts = {}) {
  if (anchor.recording_deleted_at) return [];
  const title = String(anchor.title || "").trim();
  if (!title) return [];
  const sameTitle = await db2.query("SELECT * FROM live_classes WHERE title = $1 ORDER BY id", [title]);
  const lectureIds = [];
  for (const peer of sameTitle.rows) {
    if (!peer.course_id || peer.recording_deleted_at) continue;
    const urlForPeer = pickRecordingUrl(peer, anchor);
    const targetSection = buildRecordingLectureSectionTitle(
      peer.lecture_section_title,
      peer.lecture_subfolder_title,
      opts.sectionTitleOverride
    );
    const maxOrder = await db2.query(
      "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
      [peer.course_id]
    );
    const description = String(peer.description || anchor.description || "").trim() || (urlForPeer ? "" : "Interactive classroom session (whiteboard). Upload a video recording to replace this placeholder.");
    const lectureResult = await db2.query(
      `INSERT INTO lectures (
         course_id, title, description, video_url, video_type, duration_minutes,
         order_index, is_free_preview, section_title, live_class_id, subject_key, live_class_finalized, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, TRUE, $12)
       ON CONFLICT (live_class_id) WHERE live_class_id IS NOT NULL
       DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         video_url = CASE
           WHEN NULLIF(EXCLUDED.video_url, '') IS NOT NULL THEN EXCLUDED.video_url
           ELSE lectures.video_url
         END,
         video_type = EXCLUDED.video_type,
         duration_minutes = EXCLUDED.duration_minutes,
         section_title = EXCLUDED.section_title,
        subject_key = EXCLUDED.subject_key,
         live_class_finalized = TRUE
       RETURNING id`,
      [
        peer.course_id,
        peer.title,
        description,
        urlForPeer,
        urlForPeer ? inferVideoType2(urlForPeer) : "r2",
        durationMinutes(peer, anchor),
        maxOrder.rows[0].next_order,
        false,
        targetSection,
        peer.id,
        peer.subject_key || null,
        Date.now()
      ]
    );
    lectureIds.push(Number(lectureResult.rows[0]?.id));
    if (opts.recomputeCourseProgress) {
      await opts.recomputeCourseProgress(peer.course_id);
    }
  }
  return lectureIds;
}
function liveClassHasConvertibleRecording(row) {
  return !!pickRecordingUrl(row);
}
var init_live_class_lecture_convert = __esm({
  "backend/live-class-lecture-convert.ts"() {
    "use strict";
    init_recordingSection();
    init_recordingUrl();
  }
});

// backend/admin-live-class-manage-routes.ts
function registerAdminLiveClassManageRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2,
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3
}) {
  const inferVideoType3 = (url) => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };
  app2.post("/api/admin/live-classes/cleanup", requireAdmin2, async (_req, res) => {
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
      const completedIds = updateResult.rows.map((r) => r.id);
      if (completedIds.length > 0) {
        await db2.query("DELETE FROM live_class_viewers WHERE live_class_id = ANY($1::int[])", [completedIds]).catch(() => {
        });
        await db2.query("DELETE FROM live_class_hand_raises WHERE live_class_id = ANY($1::int[])", [completedIds]).catch(() => {
        });
      }
      res.json({ success: true, message: `Marked ${updateResult.rows.length} live classes as completed`, cleaned: updateResult.rows.length, classes: updateResult.rows });
    } catch (err) {
      console.error("[Cleanup] Error:", err);
      res.status(500).json({ message: "Failed to cleanup live classes" });
    }
  });
  app2.put("/api/admin/live-classes/:id", requireAdmin2, async (req, res) => {
    try {
      const prevRow = await db2.query("SELECT id, title, course_id, is_completed, is_live FROM live_classes WHERE id = $1", [req.params.id]);
      const wasCompleted = prevRow.rows[0]?.is_completed === true;
      const wasLive = prevRow.rows[0]?.is_live === true;
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid, lectureSectionTitle, lectureSubfolderTitle, pipPosition, subjectKey } = req.body;
      const classEnding = isCompleted === true || isLive === false && wasLive;
      const normalizedPipPosition = pipPosition === void 0 ? void 0 : normalizePipPosition(pipPosition);
      const updates = [];
      const params = [];
      const add = (col, val) => {
        params.push(val);
        updates.push(col + " = $" + params.length);
      };
      if (isLive !== void 0) add("is_live", isLive);
      if (isCompleted !== void 0) add("is_completed", isCompleted);
      if (isLive === true) {
        add("started_at", Date.now());
        add("is_completed", false);
        add("ended_at", null);
      }
      if (classEnding) add("ended_at", Date.now());
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
      if (normalizedPipPosition !== void 0) add("pip_position", normalizedPipPosition);
      if (recordingUrl !== void 0) add("recording_url", recordingUrl);
      if (cfStreamUid !== void 0) add("cf_stream_uid", cfStreamUid);
      if (lectureSectionTitle !== void 0) add("lecture_section_title", typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() === "" ? null : lectureSectionTitle);
      if (lectureSubfolderTitle !== void 0) add("lecture_subfolder_title", typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() === "" ? null : lectureSubfolderTitle);
      if (subjectKey !== void 0) add("subject_key", typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== void 0) add("is_public", isPublicVal);
      if (updates.length === 0) {
        if (convertToLecture === true) {
          const only = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
          if (only.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
          const liveClassOnly = only.rows[0];
          const st = sectionTitle;
          const isClassroom = String(liveClassOnly.stream_type || "").toLowerCase() === "classroom";
          const canConvert = liveClassOnly.is_completed === true && (liveClassHasConvertibleRecording(liveClassOnly) || isClassroom);
          if (!canConvert) {
            return res.status(400).json({
              message: "Class must be completed with a recording URL, or be an interactive classroom session, to save as a lecture."
            });
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
            const vType = inferVideoType3(urlForPeer);
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
            await recomputeAllEnrollmentsProgressForCourse3(peer.course_id);
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
      const isRecordingMode = liveClass?.is_recording_mode === true;
      if (isLive === true && !isRecordingMode && liveClass.course_id) {
        const recipients = liveClass.is_free_preview === true || liveClass.is_public === true ? await db2.query("SELECT id AS user_id FROM users WHERE role = 'student'") : await db2.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = autoNotificationExpiresAt(Date.now());
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
        syncAdd("is_completed", false);
        syncAdd("ended_at", null);
        if (youtubeUrl !== void 0) syncAdd("youtube_url", youtubeUrl);
        if (streamType !== void 0) syncAdd("stream_type", streamType);
        if (chatMode !== void 0) syncAdd("chat_mode", chatMode);
        if (showViewerCount !== void 0) syncAdd("show_viewer_count", showViewerCount);
        if (normalizedPipPosition !== void 0) syncAdd("pip_position", normalizedPipPosition);
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
        if (!isRecordingMode) {
          const otherClasses = await db2.query("SELECT course_id FROM live_classes WHERE id != $1 AND title = $2 AND is_completed IS NOT TRUE AND course_id IS NOT NULL", [req.params.id, liveClass.title]).catch(() => ({ rows: [] }));
          const peerExpiresAt = autoNotificationExpiresAt(Date.now());
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
      }
      const isClassroomStream = String(liveClass.stream_type || "").toLowerCase() === "classroom";
      const shouldConvertToLecture = convertToLecture === true && (isCompleted === true || liveClass.is_completed === true) && !liveClass.recording_deleted_at && (liveClass.youtube_url || liveClass.recording_url || liveClass.cf_playback_hls || liveClass.board_snapshot_url || isClassroomStream);
      if (shouldConvertToLecture) {
        await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClass.title + "%"]).catch(() => {
        });
        await convertLiveClassTitlePeersToLectures(db2, liveClass, {
          sectionTitleOverride: sectionTitle,
          recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse3
        });
      }
      if (isCompleted && !convertToLecture && liveClass.title) {
        await db2.query("DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1", ["%" + liveClass.title + "%"]).catch(() => {
        });
      }
      if (classEnding) {
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
      if (isCompleted === true && convertToLecture !== true) {
        const refreshed = await db2.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
        const updated = refreshed.rows[0] || liveClass;
        const autoClassroom = String(updated.stream_type || "").toLowerCase() === "classroom";
        const autoHasRecording = liveClassHasConvertibleRecording(updated);
        if (autoClassroom || autoHasRecording) {
          await db2.query(
            "DELETE FROM notifications WHERE title IN ('\u{1F534} Live Class Started!', '\u{1F534} Live Class Starting Now!', '\u23F0 Live Class in 30 minutes!') AND message ILIKE $1",
            ["%" + updated.title + "%"]
          ).catch(() => {
          });
          await convertLiveClassTitlePeersToLectures(db2, updated, {
            sectionTitleOverride: sectionTitle,
            recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse3
          });
        }
      }
      if (classEnding) {
        await db2.query("DELETE FROM live_class_viewers WHERE live_class_id = $1", [req.params.id]).catch(() => {
        });
        await db2.query("DELETE FROM live_class_hand_raises WHERE live_class_id = $1", [req.params.id]).catch(() => {
        });
      }
      if (classEnding && !wasCompleted && liveClass) {
        await notifyAdminsLiveClassCompleted(db2, liveClass).catch(
          (err) => console.error("[GoLive] admin completion notify failed:", err)
        );
      }
      await syncLiveClassReminderJob(db2, Number(liveClass?.id ?? req.params.id)).catch(
        (err) => console.error("[LiveClass] reminder job sync failed:", err)
      );
      res.json(liveClass);
    } catch (err) {
      console.error("Update live class error:", err);
      res.status(500).json({ message: "Failed to update live class" });
    }
  });
  app2.delete("/api/admin/live-classes/:id", requireAdmin2, async (req, res) => {
    try {
      await cancelLiveClassReminderJob(db2, Number(req.params.id)).catch(() => {
      });
      await db2.query("DELETE FROM live_classes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete live class" });
    }
  });
  app2.put("/api/admin/study-materials/:id", requireAdmin2, async (req, res) => {
    try {
      const { title, description, fileUrl, fileType, isFree, sectionTitle, downloadAllowed, subjectKey } = req.body;
      const normalizedSubjectKey = typeof subjectKey === "string" && subjectKey.trim() ? subjectKey.trim().toLowerCase() : null;
      const existing = await db2.query("SELECT course_id FROM study_materials WHERE id = $1 LIMIT 1", [req.params.id]);
      await db2.query(`UPDATE study_materials SET title=$1, description=$2, file_url=$3, file_type=$4, is_free=$5, section_title=$6, download_allowed=$7, subject_key=$8 WHERE id=$9`, [
        title,
        description || "",
        fileUrl,
        fileType || "pdf",
        isFree || false,
        sectionTitle || null,
        downloadAllowed || false,
        normalizedSubjectKey,
        req.params.id
      ]);
      if (downloadAllowed === false) {
        await purgeUserDownloadsForItem(db2, "material", Number(req.params.id));
      }
      if (existing.rows[0]?.course_id) {
        await recomputeAllEnrollmentsProgressForCourse3(existing.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update material" });
    }
  });
  app2.delete("/api/admin/study-materials/:id", requireAdmin2, async (req, res) => {
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
        await recomputeAllEnrollmentsProgressForCourse3(courseId);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete study material error:", err);
      res.status(500).json({ message: "Failed to delete material" });
    }
  });
}
var init_admin_live_class_manage_routes = __esm({
  "backend/admin-live-class-manage-routes.ts"() {
    "use strict";
    init_download_access_utils();
    init_recordingSection();
    init_classroomPipPosition();
    init_auto_notification_expiry();
    init_notification_utils();
    init_scheduled_jobs();
    init_push_notifications();
    init_live_class_lecture_convert();
  }
});

// backend/livekit-sdk.ts
function getLiveKitConfig() {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}
function isLiveKitWebhookConfigured() {
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  return !!(apiKey && apiSecret);
}
async function loadLiveKitSdk() {
  if (cachedSdk !== void 0) return cachedSdk;
  try {
    const mod = await import("livekit-server-sdk");
    cachedSdk = mod;
    return mod;
  } catch (err) {
    console.error("[LiveKit] Failed to load livekit-server-sdk:", err);
    cachedSdk = null;
    return null;
  }
}
function resolveWebhookReceiverClass(mod) {
  const ctor = mod.WebhookReceiver;
  if (typeof ctor === "function") return ctor;
  console.error("[LiveKit] livekit-server-sdk WebhookReceiver export is missing or invalid");
  return null;
}
function resolveAccessTokenClass(mod) {
  const ctor = mod.AccessToken;
  if (typeof ctor === "function") return ctor;
  return null;
}
async function getWebhookReceiver() {
  if (cachedWebhookReceiver !== void 0) return cachedWebhookReceiver;
  if (webhookReceiverLoadFailed) return null;
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!apiKey || !apiSecret) {
    cachedWebhookReceiver = null;
    return null;
  }
  const mod = await loadLiveKitSdk();
  if (!mod) {
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }
  const WebhookReceiver = resolveWebhookReceiverClass(mod);
  if (!WebhookReceiver) {
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }
  try {
    cachedWebhookReceiver = new WebhookReceiver(apiKey, apiSecret);
    return cachedWebhookReceiver;
  } catch (err) {
    console.error("[LiveKit] Failed to create WebhookReceiver:", err);
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }
}
async function createAccessToken(apiKey, apiSecret, options) {
  const mod = await loadLiveKitSdk();
  if (!mod) {
    throw new Error("livekit-server-sdk failed to load");
  }
  const AccessToken = resolveAccessTokenClass(mod);
  if (!AccessToken) {
    throw new Error("livekit-server-sdk AccessToken export is missing or invalid");
  }
  return new AccessToken(apiKey, apiSecret, options);
}
var cachedSdk, cachedWebhookReceiver, webhookReceiverLoadFailed;
var init_livekit_sdk = __esm({
  "backend/livekit-sdk.ts"() {
    "use strict";
    webhookReceiverLoadFailed = false;
  }
});

// backend/classroom-sync.ts
import { URL as URL2 } from "node:url";
import { createRequire as createRequire2 } from "node:module";
import {
  TLSocketRoom,
  InMemorySyncStorage,
  TLSyncErrorCloseEventCode,
  TLSyncErrorCloseEventReason
} from "@tldraw/sync-core";
import { createHmac as createHmac3, timingSafeEqual as timingSafeEqual4 } from "node:crypto";
function syncB64Url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function classroomSyncSecret() {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s) throw new Error("OTP_HMAC_SECRET must be set");
  return s;
}
function signClassroomSyncToken(userId, liveClassId) {
  const body = syncB64Url(Buffer.from(JSON.stringify({ uid: userId, lc: String(liveClassId), exp: Date.now() + CLASSROOM_SYNC_TOKEN_TTL_MS }), "utf8"));
  const sig = syncB64Url(createHmac3("sha256", classroomSyncSecret()).update(body).digest());
  return body + "." + sig;
}
function verifyClassroomSyncToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = syncB64Url(createHmac3("sha256", classroomSyncSecret()).update(body).digest());
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual4(a, b)) return null;
  try {
    const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - body.length % 4);
    const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
    const obj = JSON.parse(json);
    if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
    if (typeof obj.uid !== "number" || !Number.isFinite(obj.uid)) return null;
    return { uid: obj.uid, lc: String(obj.lc) };
  } catch {
    return null;
  }
}
function sanitizeRoomId(roomId) {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}
function parseLiveClassIdFromRoomId(roomId) {
  return roomId.replace(/^lc-/, "").replace(/-preview$/, "");
}
function isPreviewRoom(roomId) {
  return roomId.endsWith("-preview");
}
function isR2Configured() {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME);
}
async function fetchSnapshotFromR2(getR2Client, objectKey) {
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r2 = await getR2Client();
    const bucket = String(process.env.R2_BUCKET_NAME || "");
    const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!result.Body) return null;
    const chunks = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    }
    const json = Buffer.concat(chunks).toString("utf-8");
    return JSON.parse(json);
  } catch (err) {
    console.warn("[classroom-checkpoint] R2 GET failed:", err?.message || String(err));
    return null;
  }
}
async function uploadSnapshotToR2(getR2Client, objectKey, snapshot) {
  try {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const r2 = await getR2Client();
    const bucket = String(process.env.R2_BUCKET_NAME || "");
    const body = Buffer.from(JSON.stringify(snapshot), "utf-8");
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentType: "application/json"
      })
    );
    return true;
  } catch (err) {
    console.warn("[classroom-checkpoint] R2 PUT failed:", err?.message || String(err));
    return false;
  }
}
async function fetchSnapshotFromHttp(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[classroom-checkpoint] HTTP GET failed:", err?.message || String(err));
    return null;
  }
}
function resolveR2ObjectKey(stored) {
  const s = stored.trim();
  if (!s) return null;
  if (s.startsWith(AUTO_CHECKPOINT_KEY_PREFIX)) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const pathname = decodeURIComponent(new URL2(s).pathname);
      const markerIdx = pathname.indexOf(AUTO_CHECKPOINT_KEY_PREFIX);
      if (markerIdx >= 0) {
        return pathname.slice(markerIdx).replace(/^\//, "");
      }
      const base = pathname.replace(/^\//, "");
      if (base.endsWith(".json")) return base;
    } catch {
      return null;
    }
  }
  return null;
}
async function loadAutoCheckpointSnapshot(db2, liveClassId, getR2Client) {
  if (!isR2Configured()) return null;
  try {
    const result = await db2.query(
      `SELECT board_sync_checkpoint_url, board_checkpoint_at,
              board_client_checkpoint_url, board_client_checkpoint_at
       FROM live_classes WHERE id = $1`,
      [liveClassId]
    );
    const row = result.rows[0];
    if (!row) return null;
    const serverUrl = String(row.board_sync_checkpoint_url || "");
    const clientUrl = String(row.board_client_checkpoint_url || "");
    const serverAt = Number(row.board_checkpoint_at) || 0;
    const clientAt = Number(row.board_client_checkpoint_at) || 0;
    const useClient = clientUrl && clientAt >= serverAt;
    if (useClient) {
      console.log(`[classroom-checkpoint] Restoring class=${liveClassId} client url`);
      const fromHttp = await fetchSnapshotFromHttp(clientUrl);
      if (fromHttp) {
        console.log(
          `[classroom-checkpoint] Restored class=${liveClassId} docs=${fromHttp.documents?.length ?? 0}`
        );
        return fromHttp;
      }
      const clientKey = resolveR2ObjectKey(clientUrl);
      if (clientKey) {
        const fromR2 = await fetchSnapshotFromR2(getR2Client, clientKey);
        if (fromR2) return fromR2;
      }
    }
    if (serverUrl) {
      const serverKey = resolveR2ObjectKey(serverUrl);
      if (serverKey) {
        console.log(`[classroom-checkpoint] Restoring class=${liveClassId} key=${serverKey}`);
        const snapshot = await fetchSnapshotFromR2(getR2Client, serverKey);
        if (snapshot) {
          console.log(
            `[classroom-checkpoint] Restored class=${liveClassId} docs=${snapshot.documents?.length ?? 0}`
          );
          return snapshot;
        }
      }
    }
    if (!useClient && clientUrl) {
      const fromHttp = await fetchSnapshotFromHttp(clientUrl);
      if (fromHttp) return fromHttp;
    }
    return null;
  } catch (err) {
    console.warn("[classroom-checkpoint] Load error:", err?.message || String(err));
    return null;
  }
}
async function runCheckpoint(roomId, liveClassId, room, db2, getR2Client) {
  const state = checkpointStates.get(roomId);
  if (!state || state.saving || room.isClosed() || !isR2Configured()) return;
  const currentClock = room.getCurrentDocumentClock();
  if (currentClock === state.lastSavedClock) return;
  state.saving = true;
  try {
    const snapshot = room.getCurrentSnapshot();
    const timestamp = Date.now();
    const key = `${AUTO_CHECKPOINT_KEY_PREFIX}lc-${liveClassId}-${timestamp}.json`;
    const ok = await uploadSnapshotToR2(getR2Client, key, snapshot);
    if (!ok) return;
    await db2.query(
      "UPDATE live_classes SET board_sync_checkpoint_url = $1, board_checkpoint_at = $2 WHERE id = $3",
      [key, timestamp, liveClassId]
    );
    state.lastSavedClock = currentClock;
    console.log(
      `[classroom-checkpoint] Saved class=${liveClassId} clock=${currentClock} key=${key}`
    );
  } catch (err) {
    console.warn("[classroom-checkpoint] Save error:", err?.message || String(err));
  } finally {
    state.saving = false;
  }
}
function scheduleCheckpoint(roomId, liveClassId, room, db2, getR2Client) {
  const state = checkpointStates.get(roomId);
  if (!state || state.timer !== null) return;
  if (isPreviewRoom(roomId)) return;
  state.timer = setTimeout(() => {
    state.timer = null;
    void runCheckpoint(roomId, liveClassId, room, db2, getR2Client);
  }, AUTO_CHECKPOINT_INTERVAL_MS);
}
async function makeOrLoadRoom(roomId, liveClassId, db2, getR2Client) {
  const id = sanitizeRoomId(roomId);
  const existing = rooms.get(id);
  if (existing && !existing.isClosed()) return existing;
  const pending = roomLoadingPromises.get(id);
  if (pending) return pending;
  const loadPromise = (async () => {
    try {
      let snapshot = null;
      if (!isPreviewRoom(id)) {
        snapshot = await Promise.race([
          loadAutoCheckpointSnapshot(db2, liveClassId, getR2Client),
          new Promise(
            (resolve2) => setTimeout(() => resolve2(null), AUTO_CHECKPOINT_LOAD_TIMEOUT_MS)
          )
        ]);
      }
      const storage = snapshot ? new InMemorySyncStorage({ snapshot }) : new InMemorySyncStorage();
      const cpState = {
        timer: null,
        lastSavedClock: storage.getClock(),
        saving: false
      };
      checkpointStates.set(id, cpState);
      const room = new TLSocketRoom({
        storage,
        onSessionRemoved(roomInstance, args) {
          if (args.numSessionsRemaining === 0) {
            void teardownRoomIfAllowed(id, liveClassId, roomInstance, db2, getR2Client);
          }
        }
      });
      if (!isPreviewRoom(id) && isR2Configured()) {
        let lastPageCount = room.getCurrentSnapshot().documents?.length ?? 0;
        let pageChangeTimer = null;
        storage.onChange(() => {
          scheduleCheckpoint(id, liveClassId, room, db2, getR2Client);
          try {
            const pageCount = room.getCurrentSnapshot().documents?.length ?? 0;
            if (pageCount !== lastPageCount) {
              lastPageCount = pageCount;
              if (pageChangeTimer) clearTimeout(pageChangeTimer);
              pageChangeTimer = setTimeout(() => {
                pageChangeTimer = null;
                void runCheckpoint(id, liveClassId, room, db2, getR2Client);
              }, PAGE_CHANGE_CHECKPOINT_DEBOUNCE_MS);
            }
          } catch {
          }
        });
      }
      rooms.set(id, room);
      return room;
    } finally {
      roomLoadingPromises.delete(id);
    }
  })();
  roomLoadingPromises.set(id, loadPromise);
  return loadPromise;
}
function cleanupCheckpointState(roomId) {
  const state = checkpointStates.get(roomId);
  if (state?.timer !== null && state?.timer !== void 0) {
    clearTimeout(state.timer);
  }
  checkpointStates.delete(roomId);
}
async function teardownRoomIfAllowed(roomId, liveClassId, roomInstance, db2, getR2Client) {
  if (roomId.endsWith("-preview")) {
    roomInstance.close();
    rooms.delete(roomId);
    cleanupCheckpointState(roomId);
    return;
  }
  try {
    const r = await db2.query(
      "SELECT is_live, is_completed FROM live_classes WHERE id = $1",
      [liveClassId]
    );
    const lc = r.rows[0];
    if (lc && Boolean(lc.is_live) && !Boolean(lc.is_completed)) {
      const state2 = checkpointStates.get(roomId);
      if (state2) {
        if (state2.timer !== null) {
          clearTimeout(state2.timer);
          state2.timer = null;
        }
        try {
          await Promise.race([
            runCheckpoint(roomId, liveClassId, roomInstance, db2, getR2Client),
            new Promise(
              (resolve2) => setTimeout(resolve2, AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS)
            )
          ]);
        } catch {
        }
      }
      return;
    }
  } catch (e) {
    console.warn("[classroom-sync] could not check live status before teardown:", e);
  }
  const state = checkpointStates.get(roomId);
  if (state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    try {
      await Promise.race([
        runCheckpoint(roomId, liveClassId, roomInstance, db2, getR2Client),
        new Promise(
          (resolve2) => setTimeout(resolve2, AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS)
        )
      ]);
    } catch {
    }
  }
  roomInstance.close();
  rooms.delete(roomId);
  cleanupCheckpointState(roomId);
}
function parseSessionId(url) {
  const sid = url.searchParams.get("syncClientId") || url.searchParams.get("sessionId");
  if (sid && sid.trim()) return sid.trim().slice(0, 128);
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
async function authenticateClassroomSocket(db2, req, roomId, pathToken) {
  const url = new URL2(req.url || "", "http://localhost");
  const liveClassId = roomId.replace(/^lc-/, "").replace(/-preview$/, "");
  let user = null;
  const verified = verifyClassroomSyncToken(pathToken);
  if (verified && verified.lc === liveClassId) {
    const r = await db2.query(
      "SELECT id, role, COALESCE(is_blocked, FALSE) AS is_blocked FROM users WHERE id = $1",
      [verified.uid]
    );
    const row = r.rows[0];
    if (row && !row.is_blocked) user = { id: Number(row.id), role: String(row.role) };
  }
  if (!user) {
    const token = url.searchParams.get("access_token") || url.searchParams.get("token") || "";
    const fakeReq = {
      headers: {
        ...token ? { authorization: `Bearer ${token}` } : {},
        cookie: req.headers.cookie
      },
      session: req.session ?? {}
    };
    const resolved = await getAuthUserFromRequest(fakeReq, db2);
    if (resolved) user = { id: resolved.id, role: resolved.role };
  }
  if (!user) return { ok: false, status: 401, message: "Unauthorized" };
  const lcResult = await db2.query(
    "SELECT * FROM live_classes WHERE id = $1",
    [liveClassId]
  );
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
  const isReadonly = user.role !== "admin";
  return { ok: true, user: { id: user.id, role: user.role }, isReadonly };
}
function syncCloseReason(status) {
  if (status === 401) return TLSyncErrorCloseEventReason.NOT_AUTHENTICATED;
  if (status === 404) return TLSyncErrorCloseEventReason.NOT_FOUND;
  return TLSyncErrorCloseEventReason.FORBIDDEN;
}
function attachClassroomSyncServer(httpServer, db2, getR2Client) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL2(req.url || "", "http://localhost");
    const match = url.pathname.match(/^\/classroom-sync\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return;
    wss.handleUpgrade(req, socket, head, (socketConn) => {
      const pathToken = match[2] ? decodeURIComponent(match[2]) : null;
      void handleConnection(socketConn, req, match[1], db2, getR2Client, pathToken);
    });
  });
}
async function handleConnection(ws, req, rawRoomId, db2, getR2Client, pathToken = null) {
  const caughtMessages = [];
  const collect = (data) => {
    caughtMessages.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  ws.on("message", collect);
  const auth2 = await authenticateClassroomSocket(db2, req, rawRoomId, pathToken);
  if (!auth2.ok) {
    ws.off("message", collect);
    ws.close(TLSyncErrorCloseEventCode, syncCloseReason(auth2.status));
    return;
  }
  const roomId = sanitizeRoomId(rawRoomId);
  const liveClassId = parseLiveClassIdFromRoomId(roomId);
  const url = new URL2(req.url || "", "http://localhost");
  const sessionId = parseSessionId(url);
  const room = await makeOrLoadRoom(roomId, liveClassId, db2, getR2Client);
  room.handleSocketConnect({
    sessionId,
    socket: ws,
    isReadonly: auth2.isReadonly
  });
  ws.off("message", collect);
  for (const msg of caughtMessages) {
    ws.emit(
      "message",
      msg
    );
  }
}
var require3, WebSocketServer, CLASSROOM_SYNC_TOKEN_TTL_MS, rooms, roomLoadingPromises, checkpointStates, AUTO_CHECKPOINT_INTERVAL_MS, PAGE_CHANGE_CHECKPOINT_DEBOUNCE_MS, AUTO_CHECKPOINT_KEY_PREFIX, AUTO_CHECKPOINT_LOAD_TIMEOUT_MS, AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS, CHECKPOINT_CLEANUP_INTERVAL_MS;
var init_classroom_sync = __esm({
  "backend/classroom-sync.ts"() {
    "use strict";
    init_auth_utils();
    init_live_class_access();
    require3 = createRequire2(import.meta.url);
    WebSocketServer = require3("ws").Server;
    CLASSROOM_SYNC_TOKEN_TTL_MS = 2 * 60 * 1e3;
    rooms = /* @__PURE__ */ new Map();
    roomLoadingPromises = /* @__PURE__ */ new Map();
    checkpointStates = /* @__PURE__ */ new Map();
    AUTO_CHECKPOINT_INTERVAL_MS = Math.max(
      6e4,
      Number(process.env.BOARD_CHECKPOINT_INTERVAL_MS || "120000")
    );
    PAGE_CHANGE_CHECKPOINT_DEBOUNCE_MS = 5e3;
    AUTO_CHECKPOINT_KEY_PREFIX = "board-checkpoints/";
    AUTO_CHECKPOINT_LOAD_TIMEOUT_MS = 8e3;
    AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS = 5e3;
    CHECKPOINT_CLEANUP_INTERVAL_MS = 10 * 60 * 1e3;
    setInterval(() => {
      for (const roomId of checkpointStates.keys()) {
        const room = rooms.get(roomId);
        if (!room || room.isClosed()) {
          cleanupCheckpointState(roomId);
        }
      }
    }, CHECKPOINT_CLEANUP_INTERVAL_MS);
  }
});

// backend/classroom-routes.ts
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
  requireAdmin: requireAdmin2,
  getAuthUser: getAuthUser2,
  recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse3,
  getR2Client
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
      const at = await createAccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: user.name || identity,
        ttl: "6h"
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: isAdmin,
        canSubscribe: true,
        canPublishData: true,
        canUpdateOwnMetadata: isAdmin
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
  app2.get("/api/live-classes/:id/classroom/sync-token", requireAuth, async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const lc = await loadLiveClass(db2, String(req.params.id));
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "Not a classroom stream" });
      }
      const token = signClassroomSyncToken(user.id, String(req.params.id));
      res.set("Cache-Control", "no-store");
      res.json({ token });
    } catch (err) {
      console.error("[Classroom] sync-token error:", err);
      res.status(500).json({ message: "Failed to get sync token" });
    }
  });
  app2.get(
    "/api/admin/live-classes/:id/classroom/board-checkpoint",
    requireAdmin2,
    async (req, res) => {
      try {
        const lc = await loadLiveClass(db2, String(req.params.id));
        if (!lc) return res.status(404).json({ message: "Live class not found" });
        const clientUrl = String(lc.board_client_checkpoint_url || "").trim();
        const serverUrl = String(lc.board_sync_checkpoint_url || "").trim();
        const clientAt = Number(lc.board_client_checkpoint_at) || 0;
        const serverAt = Number(lc.board_checkpoint_at) || 0;
        const useClient = clientUrl && clientAt >= serverAt;
        res.json({
          checkpointUrl: useClient ? clientUrl : serverUrl || clientUrl || null,
          checkpointAt: useClient ? clientAt : serverAt || clientAt || null
        });
      } catch (err) {
        console.error("[Classroom] get checkpoint error:", err?.message || err);
        res.status(500).json({ message: "Failed to load board checkpoint" });
      }
    }
  );
  app2.get(
    "/api/admin/live-classes/:id/classroom/board-checkpoint/snapshot",
    requireAdmin2,
    async (req, res) => {
      try {
        const liveClassId = String(req.params.id);
        const lc = await loadLiveClass(db2, liveClassId);
        if (!lc) return res.status(404).json({ message: "Live class not found" });
        const snapshot = await loadAutoCheckpointSnapshot(db2, liveClassId, getR2Client);
        if (!snapshot) return res.status(404).json({ message: "No board checkpoint snapshot" });
        res.set("Cache-Control", "no-store");
        res.json(snapshot);
      } catch (err) {
        console.error("[Classroom] checkpoint snapshot error:", err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to load board checkpoint snapshot" });
      }
    }
  );
  app2.put(
    "/api/admin/live-classes/:id/classroom/board-checkpoint",
    requireAdmin2,
    async (req, res) => {
      try {
        const liveClassId = String(req.params.id);
        const checkpointUrl = String(req.body?.checkpointUrl || "").trim();
        if (!checkpointUrl) return res.status(400).json({ message: "checkpointUrl required" });
        const lc = await loadLiveClass(db2, liveClassId);
        if (!lc) return res.status(404).json({ message: "Live class not found" });
        const t = Date.now();
        await db2.query(
          `UPDATE live_classes SET board_client_checkpoint_url = $1, board_client_checkpoint_at = $2 WHERE id = $3`,
          [checkpointUrl, t, liveClassId]
        );
        res.json({ ok: true, checkpointUrl, checkpointAt: t });
      } catch (err) {
        console.error("[Classroom] put checkpoint error:", err?.message || err);
        res.status(500).json({ message: "Failed to save board checkpoint" });
      }
    }
  );
  app2.put("/api/admin/live-classes/:id/classroom/board-snapshot", requireAdmin2, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const { boardSnapshotUrl, recordingUrl } = req.body || {};
      const url = String(boardSnapshotUrl || recordingUrl || "").trim();
      if (!url) return res.status(400).json({ message: "boardSnapshotUrl required" });
      const lc = await loadLiveClass(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      await db2.query("UPDATE live_classes SET board_snapshot_url = $1 WHERE id = $2", [url, liveClassId]);
      res.json({ ok: true, boardSnapshotUrl: url });
    } catch (err) {
      console.error("[Classroom] board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to save board snapshot" });
    }
  });
  app2.post("/api/admin/live-classes/:id/classroom/finalize", requireAdmin2, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const lc = await loadLiveClass(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "Not a classroom stream" });
      }
      const body = req.body || {};
      const recordingUrl = String(body.recordingUrl || "").trim();
      const boardSnapshotUrl = String(body.boardSnapshotUrl || "").trim();
      const boardPdfUrl = String(body.boardPdfUrl || "").trim();
      const boardPagesRaw = body.boardPages;
      const boardSyncCheckpointUrl = String(body.boardSyncCheckpointUrl || "").trim();
      const sectionTitle = buildRecordingLectureSectionTitle(
        lc.lecture_section_title,
        lc.lecture_subfolder_title,
        body.sectionTitle
      );
      const isImageUrl = (u) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u);
      let lectureIds = [];
      if (recordingUrl && !isImageUrl(recordingUrl)) {
        const saved = await saveRecordingForClassAndPeers(db2, liveClassId, recordingUrl, {
          sectionTitle,
          recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse3
        });
        lectureIds = saved.lectureIds;
      }
      if (boardSnapshotUrl) {
        await db2.query(
          "UPDATE live_classes SET board_snapshot_url = COALESCE(board_snapshot_url, $1) WHERE id = $2",
          [boardSnapshotUrl, liveClassId]
        );
      }
      const archiveFields = [];
      const archiveParams = [];
      let p = 1;
      if (boardPdfUrl) {
        archiveFields.push(`board_pdf_url = $${p++}`);
        archiveParams.push(boardPdfUrl);
      }
      if (Array.isArray(boardPagesRaw) && boardPagesRaw.length > 0) {
        archiveFields.push(`board_pages_json = $${p++}`);
        archiveParams.push(JSON.stringify(boardPagesRaw));
      }
      if (boardSyncCheckpointUrl) {
        archiveFields.push(`board_sync_checkpoint_url = $${p++}`);
        archiveParams.push(boardSyncCheckpointUrl);
        archiveFields.push(`board_checkpoint_at = $${p++}`);
        archiveParams.push(Date.now());
      }
      if (archiveFields.length > 0) {
        archiveParams.push(liveClassId);
        await db2.query(
          `UPDATE live_classes SET ${archiveFields.join(", ")} WHERE id = $${p}`,
          archiveParams
        );
      }
      if (!recordingUrl || isImageUrl(recordingUrl)) {
        const wasCompleted = lc.is_completed === true;
        const endedAt = Date.now();
        await db2.query(
          `UPDATE live_classes 
           SET is_live = FALSE, is_completed = TRUE, ended_at = COALESCE(ended_at, $1)
           WHERE id = $2`,
          [endedAt, liveClassId]
        );
        const refreshed2 = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
        if (!wasCompleted) {
          await notifyAdminsLiveClassCompleted(db2, refreshed2.rows[0] || lc).catch(
            (err) => console.error("[Classroom] admin completion notify failed:", err)
          );
        }
        lectureIds = await convertLiveClassTitlePeersToLectures(db2, refreshed2.rows[0] || lc, {
          sectionTitleOverride: sectionTitle,
          recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse3
        });
      }
      const refreshed = await db2.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
      const row = refreshed.rows[0] || lc;
      res.json({
        success: true,
        recordingUrl: recordingUrl && !isImageUrl(recordingUrl) ? recordingUrl : null,
        boardSnapshotUrl: boardSnapshotUrl || row.board_snapshot_url || null,
        boardPdfUrl: row.board_pdf_url || boardPdfUrl || null,
        lectureIds,
        sectionTitle
      });
    } catch (err) {
      console.error("[Classroom] finalize error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to finalize classroom session" });
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
  "backend/classroom-routes.ts"() {
    "use strict";
    init_livekit_sdk();
    init_live_class_access();
    init_recordingSection();
    init_live_class_recording_save();
    init_live_class_lecture_convert();
    init_notification_utils();
    init_classroom_sync();
  }
});

// backend/live-class-poll-routes.ts
import { createHmac as createHmac4, timingSafeEqual as timingSafeEqual5 } from "crypto";
async function checkEngagementStreamAccess(req, res, db2, getAuthUser2, liveClassId) {
  const lc = await loadLiveClass2(db2, liveClassId);
  if (!lc) {
    res.status(404).json({ message: "Live class not found" });
    return false;
  }
  const user = await getAuthUser2(req);
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return false;
  }
  if (!await userCanAccessLiveClassContent(db2, user, lc)) {
    res.status(403).json({ message: "Access denied" });
    return false;
  }
  return true;
}
function nowMs() {
  return Date.now();
}
function getEngagementSseSecret() {
  return process.env.SESSION_SECRET || process.env.OTP_HMAC_SECRET || "dev-engagement-sse-secret";
}
function encodeBase64Url(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}
function signEngagementSsePayload(payloadBase64) {
  return createHmac4("sha256", getEngagementSseSecret()).update(payloadBase64).digest("base64url");
}
function issueEngagementSseToken(payload) {
  const payloadBase64 = encodeBase64Url(JSON.stringify(payload));
  return `${payloadBase64}.${signEngagementSsePayload(payloadBase64)}`;
}
function verifyEngagementSseToken(token, liveClassId) {
  const [payloadBase64, sig] = token.split(".");
  if (!payloadBase64 || !sig) return null;
  const expected = signEngagementSsePayload(payloadBase64);
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length || !timingSafeEqual5(expectedBuf, sigBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
    if (String(payload.liveClassId) !== String(liveClassId)) return null;
    if (!Number.isFinite(Number(payload.userId)) || !String(payload.role || "").trim()) return null;
    if (Number(payload.exp) <= nowMs()) return null;
    return payload;
  } catch {
    return null;
  }
}
async function loadLiveClass2(db2, id) {
  const r = await db2.query("SELECT * FROM live_classes WHERE id = $1", [id]);
  return r.rows[0] || null;
}
async function finalizeExpiredPolls(db2, liveClassId) {
  const t = nowMs();
  await db2.query(
    `UPDATE live_class_polls SET ended_at = $1 WHERE live_class_id = $2 AND ended_at IS NULL AND ends_at <= $3`,
    [t, liveClassId, t]
  );
}
async function finalizeExpiredTimers(db2, liveClassId) {
  const t = nowMs();
  await db2.query(
    `UPDATE live_class_activity_timers SET ended_at = $1 WHERE live_class_id = $2 AND ended_at IS NULL AND ends_at <= $3`,
    [t, liveClassId, t]
  );
}
function registerLiveClassPollRoutes({
  app: app2,
  db: db2,
  listenPool: listenPool2,
  requireAuth,
  requireAdmin: requireAdmin2,
  getAuthUser: getAuthUser2
}) {
  const listenPoolMax = listenPool2.options.max ?? 32;
  app2.get("/api/live-classes/:id/engagement/sse-token", requireAuth, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const lc = await loadLiveClass2(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Login required" });
      if (!await userCanAccessLiveClassContent(db2, user, lc)) {
        return res.status(403).json({ message: "Access denied" });
      }
      const expiresInSeconds = 90;
      const expiresAt = nowMs() + expiresInSeconds * 1e3;
      const token = issueEngagementSseToken({
        userId: user.id,
        role: user.role,
        liveClassId,
        exp: expiresAt
      });
      res.json({ token, expiresAt, expiresInSeconds });
    } catch (err) {
      console.error("[Engagement SSE] token issue error:", err?.message || err);
      res.status(500).json({ message: "Failed to issue stream token" });
    }
  });
  app2.post("/api/admin/live-classes/:id/polls", requireAdmin2, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser2(req);
      const { kind, question, options, durationSeconds, correctOptionIndex } = req.body || {};
      if (kind !== "poll" && kind !== "quiz") {
        return res.status(400).json({ message: "kind must be poll or quiz" });
      }
      const q = String(question || "").trim();
      if (!q) return res.status(400).json({ message: "question required" });
      const opts = Array.isArray(options) ? options.map((o) => String(o || "").trim()).filter(Boolean) : [];
      if (opts.length < 2) return res.status(400).json({ message: "At least 2 options required" });
      const duration = Number(durationSeconds);
      if (!Number.isFinite(duration) || duration < 5 || duration > 600) {
        return res.status(400).json({ message: "durationSeconds must be 5\u2013600" });
      }
      const started = nowMs();
      const ends = started + duration * 1e3;
      await finalizeExpiredPolls(db2, liveClassId);
      const pollRes = await db2.query(
        `INSERT INTO live_class_polls (live_class_id, kind, question, duration_seconds, started_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [liveClassId, kind, q, duration, started, ends, user?.id || null]
      );
      const poll = pollRes.rows[0];
      const optionRows = [];
      for (let i = 0; i < opts.length; i += 1) {
        const o = await db2.query(
          `INSERT INTO live_class_poll_options (poll_id, label, sort_order) VALUES ($1, $2, $3) RETURNING id, label, sort_order`,
          [poll.id, opts[i], i]
        );
        optionRows.push(o.rows[0]);
      }
      let correctOptionId = null;
      if (kind === "quiz") {
        const idx = Number(correctOptionIndex);
        if (!Number.isInteger(idx) || idx < 0 || idx >= optionRows.length) {
          return res.status(400).json({ message: "correctOptionIndex required for quiz" });
        }
        correctOptionId = optionRows[idx].id;
        await db2.query("UPDATE live_class_polls SET correct_option_id = $1 WHERE id = $2", [
          correctOptionId,
          poll.id
        ]);
        poll.correct_option_id = correctOptionId;
      }
      res.json({
        poll: { ...poll, correct_option_id: correctOptionId, options: optionRows }
      });
    } catch (err) {
      console.error("[Poll] create error:", err?.message || err);
      res.status(500).json({ message: "Failed to create poll" });
    }
  });
  app2.post("/api/admin/live-classes/:id/polls/:pollId/end", requireAdmin2, async (req, res) => {
    try {
      const t = nowMs();
      await db2.query(
        "UPDATE live_class_polls SET ended_at = $1 WHERE id = $2 AND live_class_id = $3",
        [t, req.params.pollId, req.params.id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to end poll" });
    }
  });
  app2.get("/api/admin/live-classes/:id/polls/session", requireAdmin2, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      await finalizeExpiredPolls(db2, liveClassId);
      const pollsRes = await db2.query(
        `SELECT p.id, p.kind, p.question, p.started_at, p.ends_at, p.ended_at,
                COALESCE(v.total_votes, 0)::int AS total_votes
         FROM live_class_polls p
         LEFT JOIN (
           SELECT poll_id, COUNT(*)::int AS total_votes
           FROM live_class_poll_votes
           GROUP BY poll_id
         ) v ON v.poll_id = p.id
         WHERE p.live_class_id = $1
         ORDER BY p.started_at DESC`,
        [liveClassId]
      );
      const t = nowMs();
      const polls = pollsRes.rows.map((p) => ({
        id: p.id,
        kind: p.kind,
        question: p.question,
        started_at: p.started_at,
        ends_at: p.ends_at,
        ended_at: p.ended_at,
        total_votes: Number(p.total_votes || 0),
        is_active: !p.ended_at && Number(p.ends_at) > t
      }));
      res.json({ polls });
    } catch {
      res.status(500).json({ message: "Failed to load session polls" });
    }
  });
  app2.get("/api/admin/live-classes/:id/polls/:pollId/results", requireAdmin2, async (req, res) => {
    try {
      const pollId = Number(req.params.pollId);
      const pollRes = await db2.query("SELECT * FROM live_class_polls WHERE id = $1 AND live_class_id = $2", [
        pollId,
        req.params.id
      ]);
      if (!pollRes.rows[0]) return res.status(404).json({ message: "Poll not found" });
      const options = await db2.query(
        "SELECT id, label, sort_order FROM live_class_poll_options WHERE poll_id = $1 ORDER BY sort_order",
        [pollId]
      );
      const votes = await db2.query(
        `SELECT option_id, COUNT(*)::int AS count FROM live_class_poll_votes WHERE poll_id = $1 GROUP BY option_id`,
        [pollId]
      );
      const total = votes.rows.reduce((s, r) => s + Number(r.count), 0);
      const results = options.rows.map((o) => {
        const row = votes.rows.find((v) => Number(v.option_id) === Number(o.id));
        const count = Number(row?.count || 0);
        return {
          ...o,
          count,
          percent: total > 0 ? Math.round(count / total * 100) : 0
        };
      });
      res.json({ poll: pollRes.rows[0], results, totalVotes: total });
    } catch {
      res.status(500).json({ message: "Failed to load poll results" });
    }
  });
  app2.get("/api/live-classes/:id/polls/active", requireAuth, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser2(req);
      const lc = await loadLiveClass2(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lc)) {
        return res.status(403).json({ message: "Access denied" });
      }
      await finalizeExpiredPolls(db2, liveClassId);
      const t = nowMs();
      const pollRes = await db2.query(
        `SELECT * FROM live_class_polls
         WHERE live_class_id = $1 AND ended_at IS NULL AND ends_at > $2
         ORDER BY started_at DESC LIMIT 1`,
        [liveClassId, t]
      );
      const poll = pollRes.rows[0];
      if (!poll) return res.json({ poll: null });
      const options = await db2.query(
        "SELECT id, label, sort_order FROM live_class_poll_options WHERE poll_id = $1 ORDER BY sort_order",
        [poll.id]
      );
      let myVote = null;
      if (user) {
        const v = await db2.query(
          "SELECT option_id FROM live_class_poll_votes WHERE poll_id = $1 AND user_id = $2",
          [poll.id, user.id]
        );
        myVote = v.rows[0]?.option_id ?? null;
      }
      const ended = Number(poll.ends_at) <= t;
      res.json({
        poll: { ...poll, options: options.rows, ended, myVoteOptionId: myVote }
      });
    } catch {
      res.status(500).json({ message: "Failed to load poll" });
    }
  });
  app2.post("/api/live-classes/:id/polls/:pollId/vote", requireAuth, async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const pollId = Number(req.params.pollId);
      const optionId = Number(req.body?.optionId);
      if (!Number.isFinite(optionId)) return res.status(400).json({ message: "optionId required" });
      const pollRes = await db2.query(
        "SELECT * FROM live_class_polls WHERE id = $1 AND live_class_id = $2",
        [pollId, req.params.id]
      );
      const poll = pollRes.rows[0];
      if (!poll) return res.status(404).json({ message: "Poll not found" });
      const t = nowMs();
      if (poll.ended_at || Number(poll.ends_at) <= t) {
        return res.status(400).json({ message: "Poll has ended" });
      }
      const opt = await db2.query(
        "SELECT id FROM live_class_poll_options WHERE id = $1 AND poll_id = $2",
        [optionId, pollId]
      );
      if (!opt.rows[0]) return res.status(400).json({ message: "Invalid option" });
      await db2.query(
        `INSERT INTO live_class_poll_votes (poll_id, user_id, option_id, voted_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (poll_id, user_id) DO UPDATE SET option_id = EXCLUDED.option_id, voted_at = EXCLUDED.voted_at`,
        [pollId, user.id, optionId, t]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to vote" });
    }
  });
  app2.post("/api/admin/live-classes/:id/activity-timer", requireAdmin2, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser2(req);
      const label = String(req.body?.label || "Timer").trim();
      const duration = Number(req.body?.durationSeconds);
      if (!Number.isFinite(duration) || duration < 5 || duration > 3600) {
        return res.status(400).json({ message: "durationSeconds must be 5\u20133600" });
      }
      const started = nowMs();
      const ends = started + duration * 1e3;
      await finalizeExpiredTimers(db2, liveClassId);
      const r = await db2.query(
        `INSERT INTO live_class_activity_timers (live_class_id, label, duration_seconds, started_at, ends_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [liveClassId, label, duration, started, ends, user?.id || null]
      );
      res.json({ timer: r.rows[0] });
    } catch {
      res.status(500).json({ message: "Failed to start timer" });
    }
  });
  app2.get("/api/live-classes/:id/activity-timer/active", requireAuth, async (req, res) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser2(req);
      const lc = await loadLiveClass2(db2, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (!await userCanAccessLiveClassContent(db2, user, lc)) {
        return res.status(403).json({ message: "Access denied" });
      }
      await finalizeExpiredTimers(db2, liveClassId);
      const t = nowMs();
      const r = await db2.query(
        `SELECT * FROM live_class_activity_timers
         WHERE live_class_id = $1 AND ended_at IS NULL AND ends_at > $2
         ORDER BY started_at DESC LIMIT 1`,
        [liveClassId, t]
      );
      const timer = r.rows[0];
      if (!timer) return res.json({ timer: null });
      res.json({
        timer: {
          ...timer,
          remainingSeconds: Math.max(0, Math.ceil((Number(timer.ends_at) - t) / 1e3)),
          overlay_x_pct: Number(timer.overlay_x_pct ?? 85),
          overlay_y_pct: Number(timer.overlay_y_pct ?? 8)
        }
      });
    } catch {
      res.status(500).json({ message: "Failed to load timer" });
    }
  });
  app2.patch(
    "/api/admin/live-classes/:id/activity-timer/overlay-position",
    requireAdmin2,
    async (req, res) => {
      try {
        const liveClassId = String(req.params.id);
        const xPct = Number(req.body?.xPct);
        const yPct = Number(req.body?.yPct);
        if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) {
          return res.status(400).json({ message: "xPct and yPct required" });
        }
        const x = Math.min(95, Math.max(2, xPct));
        const y = Math.min(90, Math.max(2, yPct));
        await finalizeExpiredTimers(db2, liveClassId);
        const t = nowMs();
        const r = await db2.query(
          `UPDATE live_class_activity_timers
           SET overlay_x_pct = $1, overlay_y_pct = $2
           WHERE live_class_id = $3 AND ended_at IS NULL AND ends_at > $4
           RETURNING id`,
          [x, y, liveClassId, t]
        );
        if (!r.rows[0]) return res.status(404).json({ message: "No active timer" });
        res.json({ ok: true, overlay_x_pct: x, overlay_y_pct: y });
      } catch {
        res.status(500).json({ message: "Failed to update timer position" });
      }
    }
  );
  app2.get(
    "/api/live-classes/:id/engagement/stream",
    async (req, res, next) => {
      const scopedToken = String(req.query.sse_token || "").trim();
      if (scopedToken) {
        const payload = verifyEngagementSseToken(scopedToken, String(req.params.id));
        if (!payload) {
          return res.status(401).json({ message: "Stream token expired or invalid" });
        }
        const authUser = {
          id: Number(payload.userId),
          name: "",
          role: String(payload.role)
        };
        req.user = authUser;
        req.__auth_user_from_request_cache = authUser;
        return next();
      }
      const qToken = String(req.query.access_token || "").trim();
      if (qToken && !req.headers.authorization) {
        req.headers = { ...req.headers, authorization: `Bearer ${qToken}` };
      }
      return requireAuth(req, res, next);
    },
    async (req, res) => {
      const liveClassIdStr = String(req.params.id);
      const hasAccess = await checkEngagementStreamAccess(req, res, db2, getAuthUser2, liveClassIdStr);
      if (!hasAccess) return;
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
          await c.query("UNLISTEN live_engagement");
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
        console.error("[Engagement SSE] listen pool connect failed", e);
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
        try {
          const payload = JSON.parse(String(msg.payload || "{}"));
          if (String(payload.liveClassId ?? "") !== liveClassIdStr) return;
          if (!payload.type) return;
          res.write(`data: ${JSON.stringify({ type: payload.type })}

`);
        } catch {
        }
      };
      const conn = listenClient;
      if (!conn) {
        releaseSseListen();
        return res.status(503).json({ message: "Realtime unavailable" });
      }
      conn.on("notification", onNotify);
      try {
        await conn.query("LISTEN live_engagement");
      } catch (e) {
        console.error("[Engagement SSE] LISTEN failed", e);
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
    }
  );
}
var init_live_class_poll_routes = __esm({
  "backend/live-class-poll-routes.ts"() {
    "use strict";
    init_live_class_access();
    init_sse_listen_budget();
  }
});

// backend/course-access-routes.ts
import crypto3 from "node:crypto";
async function checkDownloadUrlRateLimit(db2, userId) {
  const redis = await getRedisClient();
  if (redis) {
    const allowed = await checkDownloadUrlRateLimitRedis(
      redis,
      userId,
      DOWNLOAD_URL_RATE_WINDOW_MS,
      DOWNLOAD_URL_RATE_MAX
    );
    if (allowed !== null) return allowed;
  }
  return checkDownloadUrlRateLimitPg(db2, userId);
}
async function assertDownloadProxyEntitlement(db2, userId, itemType, itemId) {
  if (itemType === "lecture") {
    const r = await db2.query(
      `SELECT l.download_allowed, l.course_id, l.is_free_preview
       FROM lectures l WHERE l.id = $1 LIMIT 1`,
      [itemId]
    );
    if (r.rows.length === 0) return { ok: false, status: 404, message: "Item not found" };
    const row = r.rows[0];
    if (!row.download_allowed) {
      return { ok: false, status: 403, message: "Download not allowed" };
    }
    if (!row.course_id || row.is_free_preview) return { ok: true };
    const en = await db2.query(
      `SELECT valid_until FROM enrollments
       WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1`,
      [userId, row.course_id]
    );
    if (en.rows.length === 0 || isEnrollmentExpired(en.rows[0])) {
      return { ok: false, status: 403, message: "Enrollment required" };
    }
    return { ok: true };
  }
  if (itemType === "material") {
    const r = await db2.query(
      `SELECT sm.download_allowed, sm.course_id, sm.is_free
       FROM study_materials sm WHERE sm.id = $1 LIMIT 1`,
      [itemId]
    );
    if (r.rows.length === 0) return { ok: false, status: 404, message: "Item not found" };
    const row = r.rows[0];
    if (!row.download_allowed) {
      return { ok: false, status: 403, message: "Download not allowed" };
    }
    if (!row.course_id || row.is_free) return { ok: true };
    const en = await db2.query(
      `SELECT valid_until FROM enrollments
       WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1`,
      [userId, row.course_id]
    );
    if (en.rows.length === 0 || isEnrollmentExpired(en.rows[0])) {
      return { ok: false, status: 403, message: "Enrollment required" };
    }
    return { ok: true };
  }
  return { ok: false, status: 400, message: "Invalid item type" };
}
async function checkDownloadUrlRateLimitPg(db2, userId) {
  const now = Date.now();
  const win = DOWNLOAD_URL_RATE_WINDOW_MS;
  const key = `download_url:user:${userId}`;
  const r = await db2.query(
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
     RETURNING total_hits`,
    [key, now, win]
  );
  const totalHits = Number(r.rows[0]?.total_hits ?? 1);
  return totalHits <= DOWNLOAD_URL_RATE_MAX;
}
function registerCourseAccessRoutes({
  app: app2,
  db: db2,
  getAuthUser: getAuthUser2,
  generateSecureToken: generateSecureToken2,
  getR2Client,
  updateCourseProgress: updateCourseProgress3
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
         (l.video_url IS NOT NULL AND l.video_url_normalized = ANY($1::text[]))
         OR
         (l.pdf_url IS NOT NULL AND l.pdf_url_normalized = ANY($1::text[]))
       )
       AND (l.visible_after_at IS NULL OR l.visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)
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
      const validUntilMs = enrollment.rows[0].valid_until != null ? Number(enrollment.rows[0].valid_until) : null;
      return { allowed: true, reason: "allowed", enrollmentValidUntilMs: validUntilMs };
    }
    const liveClassMatch = await db2.query(
      `SELECT lc.course_id, lc.is_free_preview
       FROM live_classes lc
       WHERE lc.recording_url IS NOT NULL
         AND lc.recording_url_normalized = ANY($1::text[])
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
      const validUntilMs = enrollment.rows[0].valid_until != null ? Number(enrollment.rows[0].valid_until) : null;
      return { allowed: true, reason: "allowed", enrollmentValidUntilMs: validUntilMs };
    }
    const materialMatch = await db2.query(
      `SELECT sm.course_id, sm.is_free
       FROM study_materials sm
       WHERE sm.file_url IS NOT NULL
         AND sm.file_url_normalized = ANY($1::text[])
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
      const validUntilMs = enrollment.rows[0].valid_until != null ? Number(enrollment.rows[0].valid_until) : null;
      return { allowed: true, reason: "allowed", enrollmentValidUntilMs: validUntilMs };
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
      const expiresAt = Date.now() + 30 * 60 * 1e3;
      const storedKey = canonicalMediaKey(fileKey);
      if (!storedKey) return res.status(400).json({ message: "Invalid media file key" });
      await db2.query("INSERT INTO media_tokens (token, user_id, file_key, expires_at) VALUES ($1, $2, $3, $4)", [token, user.id, storedKey, expiresAt]);
      db2.query("DELETE FROM media_tokens WHERE expires_at < $1", [Date.now()]).catch(() => {
      });
      const ttlSec = Math.max(60, Math.floor((expiresAt - Date.now()) / 1e3));
      const readUrl = await presignR2GetObject(getR2Client, storedKey, ttlSec, decision.enrollmentValidUntilMs ?? null);
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
               COALESCE(t_agg.cnt, 0) AS total_tests,
               COALESCE(m_agg.cnt, 0) AS total_materials,
               COALESCE(dm_agg.cnt, 0) AS daily_mission_count
             FROM courses c
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM tests WHERE is_published = TRUE GROUP BY 1) t_agg ON t_agg.course_id = c.id
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM study_materials GROUP BY 1) m_agg ON m_agg.course_id = c.id
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM daily_missions WHERE course_id IS NOT NULL AND ${REAL_MISSION_SQL} GROUP BY 1) dm_agg ON dm_agg.course_id = c.id
             WHERE 1=1` : `SELECT c.*,
               COALESCE(t_agg.cnt, 0) AS total_tests,
               COALESCE(m_agg.cnt, 0) AS total_materials,
               COALESCE(dm_agg.cnt, 0) AS daily_mission_count
             FROM courses c
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM tests WHERE is_published = TRUE GROUP BY 1) t_agg ON t_agg.course_id = c.id
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM study_materials GROUP BY 1) m_agg ON m_agg.course_id = c.id
             LEFT JOIN (SELECT course_id, COUNT(*) AS cnt FROM daily_missions WHERE course_id IS NOT NULL AND ${REAL_MISSION_SQL} GROUP BY 1) dm_agg ON dm_agg.course_id = c.id
             WHERE c.is_published = TRUE`;
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
          "SELECT course_id, progress_percent, valid_until FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL) AND (valid_until IS NULL OR valid_until > $2)",
          [user.id, Date.now()]
        );
        await Promise.all(
          enrollResult.rows.map(
            (e) => updateCourseProgress3(user.id, Number(e.course_id)).catch(() => {
            })
          )
        );
        const refreshedEnroll = enrollResult.rows.length > 0 ? await db2.query(
          "SELECT course_id, progress_percent, valid_until FROM enrollments WHERE user_id = $1 AND (status = 'active' OR status IS NULL) AND (valid_until IS NULL OR valid_until > $2)",
          [user.id, Date.now()]
        ) : enrollResult;
        const enrollMap = /* @__PURE__ */ new Map();
        refreshedEnroll.rows.forEach((e) => {
          enrollMap.set(Number(e.course_id), {
            progress: Number(e.progress_percent) || 0,
            validUntil: e.valid_until != null ? Number(e.valid_until) : null
          });
        });
        courses = courses.map((c) => ({
          ...c,
          isEnrolled: enrollMap.has(Number(c.id)),
          progress: enrollMap.get(Number(c.id))?.progress ?? 0,
          enrollmentValidUntil: enrollMap.get(Number(c.id))?.validUntil ?? null
        }));
      }
      if (user) {
        res.set("Cache-Control", "private, no-store");
      } else {
        res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
      }
      res.json(courses);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to fetch courses" });
    }
  });
  app2.get("/api/courses/:id/folders", async (req, res) => {
    try {
      const result = await db2.query(
        `WITH RECURSIVE folder_tree AS (
           SELECT
             cf.*,
             cf.name::text AS full_name,
             ARRAY[cf.id] AS path_ids
           FROM course_folders cf
           WHERE cf.parent_id IS NULL
           UNION ALL
           SELECT
             child.*,
             (folder_tree.full_name || ' / ' || child.name)::text AS full_name,
             folder_tree.path_ids || child.id AS path_ids
           FROM course_folders child
           JOIN folder_tree ON child.parent_id = folder_tree.id
           WHERE NOT child.id = ANY(folder_tree.path_ids)
         )
         SELECT *
         FROM folder_tree
         WHERE course_id = $1 AND is_hidden = FALSE
         ORDER BY COALESCE(parent_id, 0) ASC, order_index ASC, created_at ASC`,
        [req.params.id]
      );
      res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch folders" });
    }
  });
  app2.get("/api/courses/:id", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (respondAuthFailureIfAny(req, res)) return;
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
      const nowMs2 = Date.now();
      const [lecturesResult, testsResult, materialsResult, dailyMissionResult] = await Promise.all([
        user?.role === "admin" ? db2.query(
          "SELECT * FROM lectures WHERE course_id = $1 ORDER BY order_index",
          [courseIdParam]
        ) : db2.query(
          "SELECT * FROM lectures WHERE course_id = $1 AND (visible_after_at IS NULL OR visible_after_at <= $2) ORDER BY order_index",
          [courseIdParam, nowMs2]
        ),
        db2.query("SELECT * FROM tests WHERE course_id = $1 AND is_published = TRUE ORDER BY COALESCE(order_index, 0) ASC, created_at ASC, id ASC", [courseIdParam]),
        db2.query("SELECT * FROM study_materials WHERE course_id = $1 ORDER BY COALESCE(order_index, 0) ASC, created_at ASC, id ASC", [courseIdParam]),
        db2.query(`SELECT COUNT(*)::int AS cnt FROM daily_missions WHERE course_id = $1 AND course_id IS NOT NULL AND ${REAL_MISSION_SQL}`, [courseIdParam])
      ]);
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
        let progressRow = row;
        if (course.isEnrolled && !accessExpired) {
          await updateCourseProgress3(user.id, Number(courseIdParam)).catch(() => {
          });
          const refreshed = await db2.query(
            "SELECT progress_percent, last_lecture_id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)",
            [user.id, courseIdParam]
          );
          if (refreshed.rows[0]) progressRow = refreshed.rows[0];
        }
        course.progress = progressRow && !accessExpired ? progressRow?.progress_percent || 0 : 0;
        course.lastLectureId = progressRow && !accessExpired ? progressRow?.last_lecture_id : null;
        if (course.isEnrolled) {
          const lpResult = await db2.query(
            `SELECT lp.lecture_id, lp.is_completed,
                    COALESCE(lp.watch_percent, 0) AS watch_percent,
                    COALESCE(lp.last_position_seconds, 0) AS last_position_seconds
             FROM lecture_progress lp
             JOIN lectures l ON l.id = lp.lecture_id
             WHERE lp.user_id = $1 AND l.course_id = $2`,
            [user.id, courseIdParam]
          );
          const lpMap = {};
          lpResult.rows.forEach(
            (lp) => {
              lpMap[lp.lecture_id] = {
                is_completed: lp.is_completed,
                watch_percent: Number(lp.watch_percent) || 0,
                last_position_seconds: Number(lp.last_position_seconds) || 0
              };
            }
          );
          responseLectures.forEach((l) => {
            const prog = lpMap[l.id];
            l.isCompleted = prog?.is_completed || false;
            l.watch_percent = prog?.watch_percent || 0;
            l.last_position_seconds = prog?.last_position_seconds || 0;
          });
        }
      }
      const hasContentAccess = await canAccessCourseContent(user, courseIdParam);
      course.hasContentAccess = hasContentAccess;
      const gatedMaterials = responseMaterials.map((m) => {
        if (hasContentAccess) return m;
        if (m.is_free_preview || m.is_free) return m;
        return { ...m, file_url: null, download_url: null };
      });
      res.set("Cache-Control", "private, no-store");
      res.json({
        ...course,
        daily_mission_count: Number(dailyMissionResult.rows[0]?.cnt || 0),
        total_materials: gatedMaterials.length,
        lectures: responseLectures,
        tests: testsResult.rows,
        materials: gatedMaterials
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
      if (respondAuthFailureIfAny(req, res)) return;
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
      const existing = await db2.query(
        "SELECT id, status, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [user.id, req.params.id]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0];
        if (isAdminGrant) {
          const inactive = row.status === "inactive";
          const expired = isEnrollmentExpired(row);
          if (inactive || expired) {
            const at2 = Date.now();
            const vu2 = computeEnrollmentValidUntil(courseRow, at2);
            await db2.query(
              `UPDATE enrollments SET status = 'active', enrolled_at = $1, valid_until = $2 WHERE id = $3`,
              [at2, vu2, row.id]
            );
            return res.json({ success: true, reactivated: inactive, renewed: expired });
          }
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
  const handleRepairEnrollmentAccess = async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      if (respondAuthFailureIfAny(req, res)) return;
      const courseId = Number(req.body?.courseId);
      if (!Number.isFinite(courseId)) {
        return res.status(400).json({ message: "courseId is required" });
      }
      const result = await repairCourseEnrollmentAccess(db2, user.id, courseId);
      return res.json({ ok: true, fixed: result.fixed, reason: result.reason });
    } catch (err) {
      console.error("repair-access error:", err);
      res.status(500).json({ message: "Failed to repair enrollment access" });
    }
  };
  app2.post("/api/enrollments/repair-access", handleRepairEnrollmentAccess);
  app2.get("/api/my-courses", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db2.query(
        `SELECT c.*, e.progress_percent, e.enrolled_at FROM courses c
         JOIN enrollments e ON c.id = e.course_id
         WHERE e.user_id = $1
           AND (e.status = 'active' OR e.status IS NULL)
           AND (e.valid_until IS NULL OR e.valid_until > EXTRACT(EPOCH FROM NOW()) * 1000)
         ORDER BY e.enrolled_at DESC`,
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
                COALESCE(sm.order_index, 0) AS order_index, sm.course_id,
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
         ORDER BY c.title NULLS LAST, sm.section_title NULLS LAST, COALESCE(sm.order_index, 0) ASC`,
        [user.id, Date.now()]
      );
      const lecturesResult = await db2.query(
        `SELECT l.id, l.title, COALESCE(l.video_url, l.pdf_url) AS file_url,
                CASE WHEN l.video_url IS NOT NULL AND l.video_url != '' THEN 'video' ELSE 'pdf' END AS file_type,
                l.section_title, COALESCE(l.order_index, 0) AS order_index, l.course_id,
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
         ORDER BY c.title NULLS LAST, l.section_title NULLS LAST, COALESCE(l.order_index, 0) ASC`,
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
      if (roleNorm === "student" && !await checkDownloadUrlRateLimit(db2, user.id)) {
        return res.status(429).json({ message: "Too many download requests. Please wait a moment before trying again." });
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
      const { randomUUID: randomUUID2 } = await import("crypto");
      const token = randomUUID2();
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
      const { token } = req.query;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token required" });
      }
      const tokenResult = await db2.query(
        "DELETE FROM download_tokens WHERE token = $1 AND expires_at > $2 RETURNING *",
        [token, Date.now()]
      );
      if (tokenResult.rows.length === 0) {
        const user2 = await getAuthUser2(req);
        if (!user2) return res.status(401).json({ message: "Not authenticated" });
        return res.status(403).json({ message: "Token invalid or expired" });
      }
      const tokenData = tokenResult.rows[0];
      const proxyEntitlement = await assertDownloadProxyEntitlement(
        db2,
        Number(tokenData.user_id),
        String(tokenData.item_type),
        Number(tokenData.item_id)
      );
      if (!proxyEntitlement.ok) {
        return res.status(proxyEntitlement.status).json({ message: proxyEntitlement.message });
      }
      const user = await getAuthUser2(req);
      if (user && Number(tokenData.user_id) !== Number(user.id)) {
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
      const watermarkSecret = process.env.OTP_HMAC_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
      if (!watermarkSecret) {
        console.error("[download-proxy] Missing OTP_HMAC_SECRET / SESSION_SECRET");
        return res.status(503).json({ message: "Server configuration error" });
      }
      const { createHmac: createHmac5 } = await import("crypto");
      const timestamp = Date.now();
      const watermarkData = `${tokenData.user_id}:${timestamp}`;
      const hmac = createHmac5("sha256", watermarkSecret).update(watermarkData).digest("hex");
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
  app2.post("/api/offline/device-secret", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const deviceId = String(req.get("x-app-device-id") || "").trim();
      if (!deviceId) return res.status(400).json({ message: "x-app-device-id header required" });
      const existing = await db2.query(
        "SELECT id FROM device_offline_secrets WHERE user_id = $1 AND device_id = $2",
        [user.id, deviceId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          message: "A secret has already been issued for this device. Re-issue is not permitted.",
          code: "already_issued"
        });
      }
      const nonceBytes = crypto3.randomBytes(32);
      const nonceHex = nonceBytes.toString("hex");
      const hmacSecret = process.env.OTP_HMAC_SECRET || "";
      const nonceHash = crypto3.createHmac("sha256", hmacSecret).update(nonceHex).digest("hex");
      await db2.query(
        `INSERT INTO device_offline_secrets (user_id, device_id, secret_hash, issued_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, device_id) DO NOTHING`,
        [user.id, deviceId, nonceHash, Date.now()]
      );
      res.json({ nonce: nonceHex });
    } catch (err) {
      console.error("[offline/device-secret] Error:", err);
      res.status(500).json({ message: "Failed to issue device secret" });
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
var DOWNLOAD_URL_RATE_WINDOW_MS, DOWNLOAD_URL_RATE_MAX;
var init_course_access_routes = __esm({
  "backend/course-access-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_auth_failure_utils();
    init_progress_utils();
    init_media_key_utils();
    init_r2_presign_read();
    init_lecture_payload_utils();
    init_redis_client();
    init_redis_rate_limit_store();
    DOWNLOAD_URL_RATE_WINDOW_MS = 6e4;
    DOWNLOAD_URL_RATE_MAX = 10;
  }
});

// backend/r2-path-utils.ts
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
  "backend/r2-path-utils.ts"() {
    "use strict";
    LIVE_CLASS_RECORDING_ROOT = "live-class-recording";
    SUBFOLDER_MAX = 80;
  }
});

// backend/upload-routes.ts
function maxBytesForPresign(folder, contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.startsWith("video/")) return MAX_VIDEO_BYTES;
  if (ct === "application/pdf") return MAX_PDF_BYTES;
  if (ct.includes("word") || ct.includes("msword")) return MAX_DOC_BYTES;
  if (ct.startsWith("image/")) return MAX_IMAGE_BYTES;
  if (folder === "lectures") return MAX_VIDEO_BYTES;
  if (folder === "materials") return MAX_PDF_BYTES;
  return MAX_PDF_BYTES;
}
function getPublicApiBaseUrl(req) {
  const configured = String(process.env.PUBLIC_API_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5e3}`;
  const normalizedProtocol = host && String(host).includes("3ilearning.in") ? "https" : protocol;
  return `${normalizedProtocol}://${host}`;
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
  requireAdmin: requireAdmin2,
  getAuthUser: getAuthUser2,
  getR2Client,
  db: db2
}) {
  app2.post("/api/upload/presign-profile", async (req, res) => {
    try {
      const user = await getAuthUser2(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { filename, contentType } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      const ALLOWED_PROFILE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      if (!ALLOWED_PROFILE_MIME_TYPES.includes(String(contentType))) {
        return res.status(400).json({ message: "Only JPEG, PNG, WebP, or GIF images are allowed for profile photos" });
      }
      if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
        return res.status(500).json({ message: "R2 credentials not configured." });
      }
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const r2 = await getR2Client();
      const ext = (filename.split(".").pop() || "").toLowerCase();
      const ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif"];
      if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
        return res.status(400).json({ message: "Invalid file type. Allowed: jpg, jpeg, png, webp, gif" });
      }
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
  app2.get("/api/admin/upload/live-class-recording-folders", requireAdmin2, async (req, res) => {
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
  app2.post("/api/admin/upload/live-class-recording-folders", requireAdmin2, async (req, res) => {
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
  const ALLOWED_ADMIN_MIME_TYPES = /* @__PURE__ */ new Set([
    // Images
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Video (Cloudflare Stream handles these; direct R2 for recordings)
    "video/mp4",
    "video/webm",
    "video/quicktime",
    // Audio
    "audio/mpeg",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    // Data — interactive classroom board sync checkpoints (tldraw snapshots).
    // Safe to allow: browsers render application/json inline as text and never
    // execute it as script (unlike SVG/HTML, which remain excluded).
    "application/json"
  ]);
  app2.post("/api/upload/presign", requireAdmin2, async (req, res) => {
    try {
      const { filename, contentType, folder, subfolder, contentLength } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      const maxBytes = maxBytesForPresign(String(folder || "uploads"), String(contentType));
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > 0 && len > maxBytes) {
        return res.status(413).json({
          message: `File too large (${len} bytes). Maximum for this type is ${maxBytes} bytes.`
        });
      }
      if (!ALLOWED_ADMIN_MIME_TYPES.has(String(contentType))) {
        return res.status(400).json({
          message: `Content type '${contentType}' is not allowed. Permitted types: images (JPEG/PNG/WebP/GIF), PDF, MP4/WebM/MOV video, and common audio formats.`
        });
      }
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
      const isVideo = String(contentType).startsWith("video/");
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: isVideo ? 3600 : 600 });
      const publicUrl = `${getPublicApiBaseUrl(req)}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });
  app2.post("/api/upload/to-r2", requireAdmin2, async (_req, res) => {
    res.status(410).json({
      message: "Server-side buffered uploads are disabled. Use /api/upload/presign and upload from the client directly to R2."
    });
  });
  app2.delete("/api/upload/file", requireAdmin2, async (req, res) => {
    try {
      const { key } = req.body;
      if (!key) return res.status(400).json({ message: "key required" });
      const ALLOWED_KEY_PREFIXES = [
        "uploads/",
        "course-materials/",
        "profile-images/",
        "thumbnails/",
        "course-thumbnails/",
        "materials/",
        "lectures/",
        "books/",
        "videos/",
        "images/",
        "live-class-recording/"
      ];
      const keyStr = String(key);
      const keyAllowed = ALLOWED_KEY_PREFIXES.some((prefix) => keyStr.startsWith(prefix));
      if (!keyAllowed) return res.status(403).json({ message: "Invalid file key \u2014 operation not permitted" });
      if (keyStr.startsWith("lectures/") || keyStr.startsWith("materials/")) {
        const refCheck = await db2.query(
          `SELECT
             (SELECT COUNT(*)::int FROM lectures WHERE video_url LIKE '%' || $1) AS lecture_refs,
             (SELECT COUNT(*)::int FROM study_materials WHERE file_url LIKE '%' || $1) AS material_refs`,
          [keyStr]
        );
        const lectureRefs = Number(refCheck.rows[0]?.lecture_refs) || 0;
        const materialRefs = Number(refCheck.rows[0]?.material_refs) || 0;
        if (lectureRefs > 0 || materialRefs > 0) {
          return res.status(409).json({ message: "File is referenced by course content and cannot be deleted" });
        }
      }
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      await r2.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: keyStr }));
      res.json({ success: true });
    } catch (err) {
      console.error("[R2] Delete error:", err);
      res.status(500).json({ message: "Failed to delete file" });
    }
  });
}
var MAX_VIDEO_BYTES, MAX_PDF_BYTES, MAX_DOC_BYTES, MAX_IMAGE_BYTES;
var init_upload_routes = __esm({
  "backend/upload-routes.ts"() {
    "use strict";
    init_r2_path_utils();
    init_async_utils();
    MAX_VIDEO_BYTES = 500 * 1024 * 1024;
    MAX_PDF_BYTES = 50 * 1024 * 1024;
    MAX_DOC_BYTES = 50 * 1024 * 1024;
    MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  }
});

// backend/media-stream-routes.ts
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
function isPublicDisplayMediaKey(key) {
  const k = key.replace(/^\/+/, "").toLowerCase();
  if (!PUBLIC_DISPLAY_MEDIA_PREFIXES.some((prefix) => k.startsWith(prefix))) return false;
  return PUBLIC_IMAGE_EXTENSION.test(k);
}
async function streamMediaGet(req, res, db2, getAuthUser2, getR2Client, key) {
  const canonicalKey = canonicalMediaKey(key);
  if (!canonicalKey || canonicalKey === "/") {
    res.status(400).json({ message: "No file key" });
    return;
  }
  const isPublicAsset = isPublicDisplayMediaKey(canonicalKey);
  const mediaToken = req.query.token;
  let userId = null;
  let userRole = "student";
  let authenticatedViaMediaToken = false;
  if (isPublicAsset) {
  } else if (mediaToken) {
    const MEDIA_TOKEN_MAX_ACCESS = 800;
    const nowMs2 = Date.now();
    let tokenResult;
    try {
      tokenResult = await db2.query(
        `UPDATE media_tokens
         SET access_count = access_count + 1
         WHERE token = $1
           AND expires_at > $2
           AND file_key = $3
           AND access_count < $4
         RETURNING user_id, access_count`,
        [mediaToken, nowMs2, canonicalKey, MEDIA_TOKEN_MAX_ACCESS]
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("access_count")) throw err;
      tokenResult = await db2.query(
        "SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3",
        [mediaToken, nowMs2, canonicalKey]
      );
    }
    if (tokenResult.rows.length === 0) {
      const limitCheck = await db2.query(
        "SELECT access_count FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3 LIMIT 1",
        [mediaToken, nowMs2, canonicalKey]
      ).catch(() => ({ rows: [] }));
      if (limitCheck.rows.length > 0 && Number(limitCheck.rows[0].access_count) >= MEDIA_TOKEN_MAX_ACCESS) {
        res.status(429).json({ message: "Token usage limit exceeded" });
      } else {
        res.status(401).json({ message: "Token expired or invalid" });
      }
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
    if (userRole !== "admin") {
      const variants = mediaKeyMatchVariants(canonicalKey);
      const lectureMatch = await db2.query(
        `SELECT l.course_id, l.is_free_preview
           FROM lectures l
           WHERE (
             (l.video_url_normalized IS NOT NULL AND l.video_url_normalized = ANY($1::text[]))
             OR
             (l.pdf_url_normalized IS NOT NULL AND l.pdf_url_normalized = ANY($1::text[]))
           )
           AND (l.visible_after_at IS NULL OR l.visible_after_at <= EXTRACT(EPOCH FROM NOW()) * 1000)
           LIMIT 1`,
        [variants]
      );
      if (lectureMatch.rows.length > 0) {
        const row = lectureMatch.rows[0];
        if (!row.course_id || row.is_free_preview) {
        } else {
          const enrollment = await db2.query(
            "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
            [userId, row.course_id]
          );
          if (enrollment.rows.length === 0 || isEnrollmentExpired(enrollment.rows[0])) {
            res.status(403).json({ message: "Enrollment required" });
            return;
          }
        }
      } else {
        const liveClassMatch = await db2.query(
          `SELECT lc.course_id, lc.is_free_preview
             FROM live_classes lc
             WHERE lc.recording_url IS NOT NULL
               AND lc.recording_url_normalized IS NOT NULL
               AND lc.recording_url_normalized = ANY($1::text[])
             LIMIT 1`,
          [variants]
        );
        if (liveClassMatch.rows.length > 0) {
          const row = liveClassMatch.rows[0];
          if (!row.course_id || row.is_free_preview) {
          } else {
            const enrollment = await db2.query(
              "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
              [userId, row.course_id]
            );
            if (enrollment.rows.length === 0 || isEnrollmentExpired(enrollment.rows[0])) {
              res.status(403).json({ message: "Enrollment required" });
              return;
            }
          }
        } else {
          const materialMatch = await db2.query(
            `SELECT sm.course_id, sm.is_free
               FROM study_materials sm
               WHERE sm.file_url IS NOT NULL
                 AND sm.file_url_normalized IS NOT NULL
                 AND sm.file_url_normalized = ANY($1::text[])
               LIMIT 1`,
            [variants]
          );
          if (materialMatch.rows.length > 0) {
            const row = materialMatch.rows[0];
            if (!row.course_id || row.is_free) {
            } else {
              const enrollment = await db2.query(
                "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
                [userId, row.course_id]
              );
              if (enrollment.rows.length === 0 || isEnrollmentExpired(enrollment.rows[0])) {
                res.status(403).json({ message: "Enrollment required" });
                return;
              }
            }
          } else {
            res.status(403).json({ message: "Enrollment required" });
            return;
          }
        }
      }
    }
  } else {
    const user = await getAuthUser2(req);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    userId = user.id;
    userRole = user.role;
  }
  if (!isPublicAsset && !authenticatedViaMediaToken && userRole !== "admin") {
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
    res.setHeader(
      "Cache-Control",
      isPublicAsset ? "public, max-age=300" : isPdf ? "private, max-age=300" : "private, no-store"
    );
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
    res.setHeader(
      "Cache-Control",
      isPublicAsset ? "public, max-age=300" : isPdf ? "private, max-age=300" : "private, no-store"
    );
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
var R2_HEAD_TIMEOUT_MS, R2_GET_TIMEOUT_MS, R2_HEAD_META_TTL_MS, R2_HEAD_META_MAX, r2HeadMetaLru, PUBLIC_DISPLAY_MEDIA_PREFIXES, PUBLIC_IMAGE_EXTENSION;
var init_media_stream_routes = __esm({
  "backend/media-stream-routes.ts"() {
    "use strict";
    init_course_access_utils();
    init_media_key_utils();
    init_async_utils();
    R2_HEAD_TIMEOUT_MS = 15e3;
    R2_GET_TIMEOUT_MS = 3e4;
    R2_HEAD_META_TTL_MS = 5 * 60 * 1e3;
    R2_HEAD_META_MAX = 400;
    r2HeadMetaLru = /* @__PURE__ */ new Map();
    PUBLIC_DISPLAY_MEDIA_PREFIXES = [
      "images/",
      "profile-images/",
      "thumbnails/",
      "course-thumbnails/"
    ];
    PUBLIC_IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;
  }
});

// backend/runtime-flag-routes.ts
function registerRuntimeFlagRoutes({
  app: app2,
  db: db2,
  requireAdmin: requireAdmin2
}) {
  app2.get("/api/admin/runtime-flags", requireAdmin2, async (_req, res) => {
    try {
      const rows = await db2.query(
        "SELECT key, enabled, description, updated_at FROM runtime_feature_flags ORDER BY key ASC"
      );
      return res.json({ defaults: listDefaultFlags(), flags: rows.rows });
    } catch (err) {
      console.error("[RuntimeFlags] list error:", err);
      return res.status(500).json({ message: "Failed to load runtime flags" });
    }
  });
  app2.put("/api/admin/runtime-flags/:key", requireAdmin2, async (req, res) => {
    try {
      const key = String(req.params.key || "").trim();
      if (!key) return res.status(400).json({ message: "Invalid flag key" });
      const enabled = req.body?.enabled === true;
      const descriptionRaw = String(req.body?.description ?? "").trim();
      const description = descriptionRaw || null;
      await db2.query(
        `INSERT INTO runtime_feature_flags (key, enabled, description, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, description = EXCLUDED.description, updated_at = EXCLUDED.updated_at`,
        [key, enabled, description, Date.now()]
      );
      return res.json({ success: true, key, enabled });
    } catch (err) {
      console.error("[RuntimeFlags] update error:", err);
      return res.status(500).json({ message: "Failed to update runtime flag" });
    }
  });
}
var init_runtime_flag_routes = __esm({
  "backend/runtime-flag-routes.ts"() {
    "use strict";
    init_feature_flags();
  }
});

// backend/cloudflare-webhook-routes.ts
import crypto4 from "node:crypto";
function timingSafeEqualsHex(a, b) {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (aa.length !== bb.length) return false;
  return crypto4.timingSafeEqual(aa, bb);
}
function verifyWebhookSignature(req) {
  const secret = String(process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET || "").trim();
  if (!secret) return false;
  const authHeader = String(req.get("cf-webhook-auth") || "").trim();
  if (authHeader) {
    return crypto4.timingSafeEqual(Buffer.from(authHeader), Buffer.from(secret));
  }
  const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
  const headerSig = String(req.get("cf-webhook-signature") || req.get("x-webhook-signature") || "").trim();
  if (!headerSig) return false;
  const expected = crypto4.createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeEqualsHex(expected, headerSig);
}
function registerCloudflareWebhookRoutes({
  app: app2,
  db: db2
}) {
  app2.post("/api/webhooks/cloudflare/stream", async (req, res) => {
    try {
      if (process.env.FF_ENABLE_CLOUDFLARE_STREAM_WEBHOOKS === "false") {
        return res.status(202).json({ message: "webhook disabled" });
      }
      if (!verifyWebhookSignature(req)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }
      const eventType = String(req.body?.type || req.body?.event || "").toLowerCase();
      const eventId = String(req.body?.id || req.body?.event_id || req.get("cf-event-id") || "").trim();
      const uid = String(req.body?.uid || req.body?.data?.uid || req.body?.video?.uid || "").trim();
      if (!uid || !eventId) {
        console.log(`[CloudflareWebhook] test ping received \u2014 eventType=${eventType || "none"}, body=${JSON.stringify(req.body || {}).slice(0, 200)}`);
        return res.json({ ok: true });
      }
      try {
        await db2.query(
          `INSERT INTO webhook_event_receipts (source, event_id, event_type, received_at)
           VALUES ($1, $2, $3, $4)`,
          ["cloudflare_stream", eventId, eventType || null, Date.now()]
        );
      } catch (err) {
        if (String(err?.code || "") === "23505") {
          incrementCounter("cloudflare_webhook_duplicates");
          return res.status(202).json({ ok: true, duplicate: true });
        }
        throw err;
      }
      if (eventType.includes("live_input.disconnected") || eventType.includes("input.disconnected")) {
        await db2.query("UPDATE live_classes SET is_live = FALSE WHERE cf_stream_uid = $1 AND is_completed IS NOT TRUE", [uid]);
      }
      if (eventType.includes("video.ready") || eventType.includes("recording.ready")) {
        await db2.query(
          "UPDATE live_classes SET cf_recording_uid = COALESCE(cf_recording_uid, $1) WHERE (cf_stream_uid = $2 OR cf_recording_uid = $1) AND is_completed IS NOT TRUE",
          [uid, String(req.body?.data?.live_input_uid || req.body?.live_input_uid || "")]
        );
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error("[CloudflareWebhook] stream webhook error:", err);
      return res.status(500).json({ message: "Webhook handling failed" });
    }
  });
}
var init_cloudflare_webhook_routes = __esm({
  "backend/cloudflare-webhook-routes.ts"() {
    "use strict";
    init_observability();
  }
});

// backend/livekit-webhook-routes.ts
function parseLiveClassId(roomName) {
  const match = String(roomName || "").match(/^lc-(\d+)$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}
function registerLiveKitWebhookRoutes({
  app: app2,
  db: db2
}) {
  app2.post("/api/webhooks/livekit", async (req, res) => {
    res.status(200).end();
    void (async () => {
      try {
        let receiver;
        try {
          receiver = await getWebhookReceiver();
        } catch (loadErr) {
          console.warn("[LiveKit Webhook] Failed to load receiver:", loadErr);
          return;
        }
        if (!receiver) {
          console.warn("[LiveKit Webhook] Ignoring event \u2014 receiver not available.");
          return;
        }
        const rawBody = req.rawBody;
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
          console.warn("[LiveKit Webhook] rawBody missing \u2014 cannot verify signature. Skipping event.");
          return;
        }
        const authHeader = req.headers["authorization"];
        if (!authHeader) {
          console.warn("[LiveKit Webhook] Missing Authorization header \u2014 dropping event.");
          return;
        }
        let event;
        try {
          event = await receiver.receive(rawBody.toString("utf-8"), authHeader);
        } catch (verifyErr) {
          console.warn("[LiveKit Webhook] Signature verification failed:", verifyErr);
          return;
        }
        const eventName = event?.event;
        console.log(`[LiveKit Webhook] Received event="${eventName}" room="${event?.room?.name ?? ""}"`);
        if (eventName !== "room_finished") {
          return;
        }
        const roomName = String(event?.room?.name ?? "");
        const liveClassId = parseLiveClassId(roomName);
        if (!liveClassId) {
          console.log(`[LiveKit Webhook] room_finished for unrecognised room "${roomName}" \u2014 ignoring.`);
          return;
        }
        const result = await db2.query(
          `UPDATE live_classes
           SET is_live = FALSE,
               ended_at = COALESCE(ended_at, $1)
           WHERE id = $2
             AND is_live = TRUE
           RETURNING id, is_completed`,
          [Date.now(), liveClassId]
        );
        if (result.rows.length === 0) {
          console.log(`[LiveKit Webhook] room_finished for live_class=${liveClassId}: is_live already FALSE or class not found \u2014 no-op.`);
          return;
        }
        const row = result.rows[0];
        console.log(
          `[LiveKit Webhook] room_finished \u2014 set is_live=FALSE for live_class=${liveClassId} (is_completed=${row.is_completed}). ` + (row.is_completed ? "Class was already fully ended by admin." : "Class ended via LiveKit timeout/disconnect \u2014 admin may still need to finalise the recording.")
        );
      } catch (err) {
        console.error("[LiveKit Webhook] Unhandled error processing event:", err);
      }
    })();
  });
  console.log("[LiveKit Webhook] POST /api/webhooks/livekit registered");
}
var init_livekit_webhook_routes = __esm({
  "backend/livekit-webhook-routes.ts"() {
    "use strict";
    init_livekit_sdk();
  }
});

// backend/schema-readiness-contract.ts
var REQUIRED_TABLES, REQUIRED_COLUMNS, REQUIRED_UNIQUE_INDEX_SPECS;
var init_schema_readiness_contract = __esm({
  "backend/schema-readiness-contract.ts"() {
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
      "web_push_subscriptions",
      "session",
      "express_rate_limit",
      "otp_challenges",
      "notifications_sent",
      // Tables previously missing from this contract - added for complete coverage.
      "daily_missions",
      // 0000 baseline - holds daily drill questions
      "lecture_progress",
      // 0000 baseline - per-student lecture watch state
      "payments",
      // 0000 baseline - Razorpay payment records
      "user_missions",
      // 0035 - per-student daily mission completion records
      // Migration 0017 - live class polling system
      "live_class_polls",
      "live_class_poll_options",
      "live_class_poll_votes",
      "live_class_activity_timers",
      // Migration 0023 - payment failure audit log
      "payment_failures",
      // Migration 0037 - runtime feature flags
      "runtime_feature_flags",
      // Migration 0038 - API idempotency + standalone entitlements + webhook receipts
      "api_idempotency_keys",
      "standalone_material_entitlements",
      "webhook_event_receipts",
      // Migration 0039 - live stream finalize job queue
      "live_stream_finalize_jobs",
      // Migration 0062 - event-driven scheduled jobs (live class reminders)
      "scheduled_jobs",
      // Migration 0040b - live chat messages (existed in production, was missing from migrations)
      "live_chat_messages",
      // Migration 0043 - per-device server-issued offline encryption secrets (ODSR-01)
      "device_offline_secrets",
      // Migration 0044 - doubts table (was in schema.ts + backend routes but missing from migrations)
      "doubts"
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
        "active_session_platform",
        "otp_send_count",
        "otp_send_window_start",
        "otp_send_locked_until"
      ],
      enrollments: ["status", "valid_until", "download_cleanup_pending"],
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
        "board_snapshot_url",
        "board_pdf_url",
        "board_pages_json",
        "board_sync_checkpoint_url",
        "board_checkpoint_at",
        "board_client_checkpoint_url",
        "board_client_checkpoint_at",
        "cf_recording_uid",
        "recording_url_normalized"
      ],
      notifications: ["source", "expires_at", "is_hidden", "admin_notif_id", "image_url", "hide_after_at"],
      web_push_subscriptions: ["endpoint", "p256dh", "auth", "is_active", "last_seen_at"],
      courses: ["subject", "exam", "cover_color", "pyq_count", "mock_count", "practice_count", "teacher_bio", "teacher_image_url", "teacher_details_json", "multi_subject_config", "course_language", "batch_status"],
      lectures: [
        "download_allowed",
        "section_title",
        "live_class_id",
        "live_class_finalized",
        "transcript",
        "video_url_normalized",
        "pdf_url_normalized",
        "subject_key"
      ],
      study_materials: ["download_allowed", "section_title", "file_url_normalized", "subject_key"],
      tests: ["difficulty", "scheduled_at", "price", "mini_course_id", "subject_key"],
      questions: ["image_url", "solution_image_url"],
      lecture_progress: ["playback_sessions", "last_session_ping_at"],
      course_folders: ["parent_id", "subject_key"],
      standalone_folders: ["parent_id", "category", "price", "original_price", "is_free", "description", "validity_months"],
      // Migration 0042 - admin session device binding
      user_sessions: ["device_id", "platform_family"]
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
      { table: "web_push_subscriptions", columns: ["endpoint"] },
      { table: "users", columns: ["phone"] },
      { table: "users", columns: ["email"] },
      { table: "notifications_sent", columns: ["class_id", "user_id", "type"] },
      // Migration 0038
      { table: "api_idempotency_keys", columns: ["user_id", "scope", "idempotency_key"] },
      { table: "standalone_material_entitlements", columns: ["user_id", "material_id"] },
      { table: "webhook_event_receipts", columns: ["source", "event_id"] },
      // Migration 0039
      { table: "live_stream_finalize_jobs", columns: ["live_class_id"] },
      // Migration 0043 - per-device offline encryption secrets
      { table: "device_offline_secrets", columns: ["user_id", "device_id"] }
    ];
  }
});

// backend/db-readiness.ts
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
    if (!presentTables.has(table)) continue;
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
  const missingIndexes = REQUIRED_UNIQUE_INDEX_SPECS.filter((s) => presentTables.has(s.table)).map((s) => `${s.table}|${s.columns.join(",")}`).filter((sig) => !presentUniqueKeys.has(sig));
  const dependencyChecks = {
    redis: String(process.env.REDIS_URL || "").trim().length > 0 ? "ok" : "not_configured",
    cloudflareWebhookSecret: String(process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET || "").trim().length > 0 ? "ok" : "degraded"
  };
  return {
    ok: missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0,
    checks: {
      db: true,
      tables: missingTables.length === 0,
      columns: missingColumns.length === 0,
      indexes: missingIndexes.length === 0
    },
    dependencyChecks,
    missingTables,
    missingColumns,
    missingIndexes
  };
}
var init_db_readiness = __esm({
  "backend/db-readiness.ts"() {
    "use strict";
    init_schema_readiness_contract();
  }
});

// backend/sms-utils.ts
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
var init_sms_utils = __esm({
  "backend/sms-utils.ts"() {
    "use strict";
  }
});

// backend/download-utils.ts
async function deleteDownloadsForUser(db2, userId, courseId) {
  if (courseId) {
    try {
      await db2.query(
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
      return;
    } catch (err) {
      console.error("[Cleanup] Failed to delete downloads (course scope):", err);
      throw err;
    }
  }
  try {
    await db2.query("DELETE FROM user_downloads WHERE user_id = $1", [userId]);
    console.log(`[Cleanup] Deleted all downloads for user ${userId}`);
  } catch (err) {
    console.error("[Cleanup] Failed to delete downloads (user scope):", err);
    throw err;
  }
}
async function deleteDownloadsForCourse(db2, courseId) {
  try {
    await db2.query(
      `DELETE FROM user_downloads
       WHERE (item_type = 'lecture' AND item_id IN (SELECT id FROM lectures WHERE course_id = $1))
       OR (item_type = 'material' AND item_id IN (SELECT id FROM study_materials WHERE course_id = $1))`,
      [courseId]
    );
    console.log(`[Cleanup] Deleted all downloads for course ${courseId}`);
  } catch (err) {
    console.error("[Cleanup] Failed to delete course downloads:", err);
    throw err;
  }
}
var init_download_utils = __esm({
  "backend/download-utils.ts"() {
    "use strict";
  }
});

// backend/schedulers.ts
function startSchedulers(db2, pool2, sendPushToUsers2) {
  const runBackgroundSchedulers = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";
  if (isNeonKeepaliveEnabled()) {
    startNeonKeepalive(db2);
  } else {
    console.log("[Keepalive] Neon keepalive disabled \u2014 Neon may scale to zero after idle");
  }
  if (!runBackgroundSchedulers) {
    console.log("[Schedulers] Background schedulers disabled (RUN_BACKGROUND_SCHEDULERS=false)");
    return;
  }
  resetStuckFinalizeJobs(db2);
  startAdaptiveSchedulerLoop(db2, pool2, sendPushToUsers2);
}
function resetStuckFinalizeJobs(db2) {
  db2.query("UPDATE live_stream_finalize_jobs SET status = 'pending', updated_at = $1 WHERE status = 'running'", [
    Date.now()
  ]).then((r) => {
    if ((r.rowCount ?? 0) > 0) {
      console.log(`[FinalizeQueue] Startup: reset ${r.rowCount} stuck 'running' job(s) to 'pending'`);
    }
  }).catch((err) => {
    console.error("[FinalizeQueue] Startup reset of stuck jobs failed:", err);
  });
}
async function runWithAdvisoryLock2(pool2, lockKey, job) {
  const client2 = await pool2.connect();
  let locked = false;
  try {
    const got = await client2.query("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
    locked = got.rows[0]?.acquired === true;
    if (!locked) return;
    await job();
  } finally {
    if (locked) {
      await client2.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => {
      });
    }
    client2.release();
  }
}
function startAdaptiveSchedulerLoop(db2, pool2, sendPushToUsers2) {
  let lastStuckLiveRun = 0;
  let lastTokenCleanupRun = 0;
  let lastDownloadRetryCheck = 0;
  let lastFinalizeCheck = 0;
  const scheduleNext = (sleepMs) => {
    const delay = Math.max(SCHEDULER_MIN_SLEEP_MS, Math.min(SCHEDULER_MAX_SLEEP_MS, sleepMs));
    setTimeout(() => void tick().catch((err) => console.error("[Scheduler] tick error:", err)), delay);
  };
  const tick = async () => {
    const now = Date.now();
    let sleepMs = SCHEDULER_MAX_SLEEP_MS;
    await runDueScheduledJobs(db2, pool2, sendPushToUsers2, now);
    const nextJobAt = await getNextPendingScheduledJobRunAt(db2, now);
    if (nextJobAt != null) {
      sleepMs = Math.min(sleepMs, Math.max(SCHEDULER_MIN_SLEEP_MS, nextJobAt - now));
    }
    if (now - lastFinalizeCheck >= FINALIZE_CHECK_INTERVAL_MS) {
      lastFinalizeCheck = now;
      const hasFinalize = await hasDueFinalizeJobs(db2, now);
      if (hasFinalize) {
        await runLiveFinalizeQueueTick(db2, pool2);
        sleepMs = Math.min(sleepMs, FINALIZE_CHECK_INTERVAL_MS);
      }
    }
    if (now - lastDownloadRetryCheck >= DOWNLOAD_RETRY_INTERVAL_MS) {
      lastDownloadRetryCheck = now;
      const hasDownloadRetry = await hasDownloadCleanupPending(db2);
      if (hasDownloadRetry) {
        await runDownloadCleanupRetry(db2, pool2);
      }
    }
    if (now - lastStuckLiveRun >= STUCK_LIVE_INTERVAL_MS) {
      lastStuckLiveRun = now;
      await runWithAdvisoryLock2(pool2, STUCK_LIVE_CLEANUP_LOCK_KEY, async () => clearStuckLiveClasses(db2));
    }
    if (now - lastTokenCleanupRun >= TOKEN_CLEANUP_INTERVAL_MS) {
      lastTokenCleanupRun = now;
      await runDownloadTokenCleanup(db2, pool2);
      await runMediaTokenCleanup(db2, pool2);
    }
    scheduleNext(sleepMs);
  };
  console.log("[Scheduler] Adaptive loop started \u2014 event-driven reminders + idle-friendly housekeeping");
  void tick().catch((err) => console.error("[Scheduler] initial tick error:", err));
}
async function hasDueFinalizeJobs(db2, now) {
  const result = await db2.query(
    `SELECT 1 FROM live_stream_finalize_jobs
     WHERE status IN ('pending', 'running') AND next_attempt_at <= $1
     LIMIT 1`,
    [now]
  );
  return result.rows.length > 0;
}
async function hasDownloadCleanupPending(db2) {
  const result = await db2.query(
    `SELECT 1 FROM enrollments WHERE download_cleanup_pending = TRUE LIMIT 1`
  );
  return result.rows.length > 0;
}
async function runDownloadCleanupRetry(db2, pool2) {
  try {
    await runWithAdvisoryLock2(pool2, DOWNLOAD_CLEANUP_RETRY_LOCK_KEY, async () => {
      const pending = await db2.query(
        `SELECT id, user_id, course_id
         FROM enrollments
         WHERE download_cleanup_pending = TRUE
         LIMIT 200`
      );
      for (const row of pending.rows) {
        const enrollmentId = Number(row.id);
        const userId = Number(row.user_id);
        const courseId = Number(row.course_id);
        if (!Number.isFinite(enrollmentId) || !Number.isFinite(userId) || !Number.isFinite(courseId)) continue;
        try {
          await deleteDownloadsForUser(db2, userId, courseId);
          await db2.query("UPDATE enrollments SET download_cleanup_pending = FALSE WHERE id = $1", [enrollmentId]);
        } catch {
          console.error("[CleanupRetry] cleanup failed; will retry later", { enrollmentId, userId, courseId });
        }
      }
    });
  } catch (err) {
    console.error("[CleanupRetry] scheduler error:", err);
  }
}
async function clearStuckLiveClasses(db2) {
  try {
    const result = await db2.query(`
      UPDATE live_classes
      SET is_live = FALSE
      WHERE is_live = TRUE
        AND started_at IS NOT NULL
        AND started_at < EXTRACT(EPOCH FROM NOW()) * 1000 - 21600000
    `);
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[StuckLiveCleanup] Cleared is_live flag on ${result.rowCount} stuck class(es)`);
    }
  } catch (err) {
    console.error("[StuckLiveCleanup] Error clearing stuck live classes:", err);
  }
}
async function runDownloadTokenCleanup(db2, pool2) {
  try {
    await runWithAdvisoryLock2(pool2, DOWNLOAD_TOKEN_CLEANUP_LOCK_KEY, async () => {
      const result = await db2.query(
        `DELETE FROM download_tokens
         WHERE id IN (
           SELECT id
           FROM download_tokens
           WHERE expires_at < $1
           ORDER BY expires_at ASC
           LIMIT 2000
         )`,
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[TokenCleanup] Deleted ${result.rowCount} expired download tokens`);
      }
    });
  } catch (err) {
    console.error("[TokenCleanup] Error:", err);
  }
}
async function runMediaTokenCleanup(db2, pool2) {
  try {
    await runWithAdvisoryLock2(pool2, MEDIA_TOKEN_CLEANUP_LOCK_KEY, async () => {
      const result = await db2.query(
        `DELETE FROM media_tokens
         WHERE token IN (
           SELECT token FROM media_tokens
           WHERE expires_at < $1
           ORDER BY expires_at ASC
           LIMIT 2000
         )`,
        [Date.now()]
      );
      if (result.rowCount && result.rowCount > 0) {
        console.log(`[MediaTokenCleanup] Deleted ${result.rowCount} expired media tokens`);
      }
    });
  } catch (err) {
    console.error("[MediaTokenCleanup] Error:", err);
  }
}
async function runLiveFinalizeQueueTick(db2, pool2) {
  await runWithAdvisoryLock2(pool2, LIVE_FINALIZE_QUEUE_LOCK_KEY, async () => {
    const now = Date.now();
    const pending = await db2.query(
      `SELECT id, live_class_id, attempts
       FROM live_stream_finalize_jobs
       WHERE status IN ('pending', 'running')
         AND next_attempt_at <= $1
       ORDER BY next_attempt_at ASC
       LIMIT 100`,
      [now]
    );
    setGauge("live_finalize_queue_backlog", pending.rows.length);
    for (const job of pending.rows) {
      const jobId = Number(job.id);
      const liveClassId = Number(job.live_class_id);
      const attempts = Number(job.attempts || 0);
      if (!Number.isFinite(jobId) || !Number.isFinite(liveClassId)) continue;
      try {
        await db2.query("UPDATE live_stream_finalize_jobs SET status = 'running', updated_at = $2 WHERE id = $1", [
          jobId,
          now
        ]);
        const lc = await db2.query(
          "SELECT recording_url, cf_stream_uid, cf_recording_uid FROM live_classes WHERE id = $1 LIMIT 1",
          [liveClassId]
        );
        let recordingUrl = String(lc.rows[0]?.recording_url || "").trim();
        if (!recordingUrl && attempts >= 5) {
          const cfAccountId = process.env.CF_STREAM_ACCOUNT_ID;
          const cfApiToken = process.env.CF_STREAM_API_TOKEN;
          if (cfAccountId && cfApiToken) {
            const cfRecordingUid = String(lc.rows[0]?.cf_recording_uid || "").trim();
            const cfStreamUid = String(lc.rows[0]?.cf_stream_uid || "").trim();
            let cfRecording = null;
            if (cfRecordingUid) {
              cfRecording = await getCfVideoByUid(cfAccountId, cfApiToken, cfRecordingUid);
            }
            if (!cfRecording && cfStreamUid) {
              cfRecording = await getLatestRecordingForLiveInput(cfAccountId, cfApiToken, cfStreamUid);
            }
            if (cfRecording?.recordingUid) {
              await db2.query("UPDATE live_classes SET cf_recording_uid = COALESCE(cf_recording_uid, $1) WHERE id = $2", [
                cfRecording.recordingUid,
                liveClassId
              ]).catch(() => {
              });
              if (cfRecording.status === "ready") {
                try {
                  await saveRecordingForClassAndPeers(db2, String(liveClassId), cfRecording.manifestUrl);
                  recordingUrl = cfRecording.manifestUrl;
                  incrementCounter("live_finalize_queue_cf_fallback_success");
                } catch (saveErr) {
                  console.warn("[LiveFinalizeQueue] CF fallback save failed:", saveErr);
                }
              }
            }
          }
        }
        if (recordingUrl) {
          await db2.query("UPDATE live_stream_finalize_jobs SET status = 'done', updated_at = $2 WHERE id = $1", [
            jobId,
            now
          ]);
          continue;
        }
        const nextAttempts = attempts + 1;
        const maxAttempts = Number(process.env.LIVE_FINALIZE_MAX_ATTEMPTS || 24);
        const backoffMs = Math.min(10 * 60 * 1e3, nextAttempts * 60 * 1e3);
        await db2.query(
          `UPDATE live_stream_finalize_jobs
           SET status = $2,
               attempts = $3,
               updated_at = $4,
               next_attempt_at = $5,
               last_error = $6
           WHERE id = $1`,
          [
            jobId,
            nextAttempts >= maxAttempts ? "failed" : "pending",
            nextAttempts,
            now,
            now + backoffMs,
            "recording_url_not_ready"
          ]
        );
        if (nextAttempts >= maxAttempts) incrementCounter("live_finalize_queue_failed");
      } catch (err) {
        incrementCounter("live_finalize_queue_errors");
        await db2.query(
          `UPDATE live_stream_finalize_jobs
             SET status = 'pending',
                 attempts = COALESCE(attempts, 0) + 1,
                 updated_at = $2,
                 next_attempt_at = $3,
                 last_error = $4
             WHERE id = $1`,
          [jobId, now, now + 60 * 1e3, String(err?.message || "queue_error").slice(0, 500)]
        ).catch(() => {
        });
      }
    }
  });
}
function isNeonKeepaliveEnabled() {
  const raw = String(process.env.NEON_KEEPALIVE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
function startNeonKeepalive(db2) {
  const KEEPALIVE_INTERVAL_MS = 30 * 1e3;
  setInterval(async () => {
    try {
      await db2.query("SELECT 1");
    } catch {
    }
  }, KEEPALIVE_INTERVAL_MS);
  console.log("[Keepalive] Neon keepalive started \u2014 pings every 30s");
}
var DOWNLOAD_CLEANUP_RETRY_LOCK_KEY, DOWNLOAD_TOKEN_CLEANUP_LOCK_KEY, STUCK_LIVE_CLEANUP_LOCK_KEY, LIVE_FINALIZE_QUEUE_LOCK_KEY, MEDIA_TOKEN_CLEANUP_LOCK_KEY, SCHEDULER_MIN_SLEEP_MS, SCHEDULER_MAX_SLEEP_MS, STUCK_LIVE_INTERVAL_MS, TOKEN_CLEANUP_INTERVAL_MS, DOWNLOAD_RETRY_INTERVAL_MS, FINALIZE_CHECK_INTERVAL_MS;
var init_schedulers = __esm({
  "backend/schedulers.ts"() {
    "use strict";
    init_download_utils();
    init_observability();
    init_cloudflare_stream_api();
    init_live_class_recording_save();
    init_scheduled_jobs();
    DOWNLOAD_CLEANUP_RETRY_LOCK_KEY = 31415926536;
    DOWNLOAD_TOKEN_CLEANUP_LOCK_KEY = 31415926537;
    STUCK_LIVE_CLEANUP_LOCK_KEY = 31415926538;
    LIVE_FINALIZE_QUEUE_LOCK_KEY = 31415926539;
    MEDIA_TOKEN_CLEANUP_LOCK_KEY = 31415926540;
    SCHEDULER_MIN_SLEEP_MS = 3e4;
    SCHEDULER_MAX_SLEEP_MS = 5 * 60 * 1e3;
    STUCK_LIVE_INTERVAL_MS = 60 * 60 * 1e3;
    TOKEN_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1e3;
    DOWNLOAD_RETRY_INTERVAL_MS = 15 * 60 * 1e3;
    FINALIZE_CHECK_INTERVAL_MS = 5 * 60 * 1e3;
  }
});

// backend/routes.ts
var routes_exports = {};
__export(routes_exports, {
  registerRoutes: () => registerRoutes
});
import { createServer } from "node:http";
import { Pool as Pool2 } from "pg";
import { PDFParse } from "pdf-parse";
import { randomInt } from "node:crypto";
function isTransientPgError(err) {
  const message = String(err?.message || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();
  return message.includes("connection terminated") || message.includes("connection timeout") || message.includes("getaddrinfo eai_again") || message.includes("timeout exceeded when trying to connect") || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN" || code === "ETIMEDOUT" || code === "57P01" || // admin_shutdown
  code === "57P03";
}
function isRetrySafeSql(text) {
  const normalized = String(text || "").trim().toUpperCase();
  if (!normalized) return false;
  return normalized.startsWith("SELECT") || normalized.startsWith("WITH");
}
async function runInTransaction(fn) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const client2 = await pool.connect();
    try {
      await client2.query("BEGIN");
      const exec = {
        query: async (text, params) => {
          const r = await client2.query(text, params);
          return { rows: r.rows };
        }
      };
      const out = await fn(exec);
      await client2.query("COMMIT");
      return out;
    } catch (e) {
      try {
        await client2.query("ROLLBACK");
      } catch {
      }
      if (isTransientPgError(e) && attempt < maxAttempts) {
        console.warn("[DB] Transient transaction error, retrying", { attempt, code: e?.code, message: e?.message });
        await new Promise((resolve2) => setTimeout(resolve2, 200 * attempt));
        continue;
      }
      throw e;
    } finally {
      client2.release();
    }
  }
  throw new Error("Transaction failed after retries");
}
async function dbQuery(text, params, options) {
  const slowQueryThresholdMs = Number(process.env.DB_SLOW_QUERY_MS || "300");
  const shouldLogSlow = options?.logSlow !== false;
  const retrySafe = isRetrySafeSql(text);
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
      if (isTransient && retrySafe && attempt < 3) {
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
      if (!boundOk.ok && boundOk.code === "device_binding_mismatch") {
        req.session.user = null;
        return null;
      }
      const platOk = await assertActiveSessionPlatformMatches(db, req, user.id, user.role);
      if (!platOk.ok) {
        req.session.user = null;
        setAuthFailure(req, {
          code: "SESSION_PLATFORM_MISMATCH",
          activePlatform: platOk.activePlatform
        });
        return null;
      }
      setAuthFailure(req, null);
      return user;
    })();
    r[authUserLazyKey] = p;
  }
  return p;
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
  startSchedulers(db, pool, sendPushToUsers);
  app2.get("/api/health/ready", async (_req, res) => {
    try {
      const readiness = await checkDatabaseReadiness(db);
      if (!readiness.ok) {
        return res.status(503).json({
          ok: false,
          message: "Database schema is not fully migrated",
          checks: readiness.checks,
          dependencyChecks: readiness.dependencyChecks,
          missingTables: readiness.missingTables,
          missingColumns: readiness.missingColumns,
          missingIndexes: readiness.missingIndexes
        });
      }
      const hasDegradedDependency = Object.values(readiness.dependencyChecks || {}).includes("degraded");
      if (hasDegradedDependency) {
        return res.status(200).json({
          ok: true,
          degraded: true,
          checks: readiness.checks,
          dependencyChecks: readiness.dependencyChecks
        });
      }
      return res.json({
        ok: true,
        checks: readiness.checks,
        dependencyChecks: readiness.dependencyChecks
      });
    } catch (err) {
      return res.status(503).json({ ok: false, message: err?.message || "DB not ready" });
    }
  });
  async function requireAuth(req, res, next) {
    try {
      const user = await getAuthUser(req);
      if (!user) {
        return res.status(401).json({ message: "Login required" });
      }
      req.user = user;
      next();
    } catch (err) {
      console.error("[Auth] requireAuth failed:", err);
      return res.status(500).json({ message: "Authentication check failed" });
    }
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
  registerAdminOpsRoutes({
    app: app2,
    db,
    getAuthUser
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
    updateCourseProgress: updateCourseProgress2
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
    updateCourseProgress: updateCourseProgress2
  });
  registerTestAttemptRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerStudentMissionMaterialRoutes({
    app: app2,
    db,
    getAuthUser,
    updateCourseProgress: updateCourseProgress2
  });
  registerLiveClassRoutes({
    app: app2,
    db,
    getAuthUser
  });
  registerDoubtNotificationRoutes({
    app: app2,
    db,
    pool,
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
  app2.get("/api/push/web-public-key", async (_req, res) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY || "";
    if (!publicKey) return res.status(503).json({ message: "Web push is not configured" });
    res.json({ publicKey });
  });
  app2.post("/api/push/web/register", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      await registerWebPushSubscription(db, Number(user.id), req.body?.subscription, String(req.headers["user-agent"] || ""));
      return res.json({ success: true });
    } catch (err) {
      console.error("[WebPush] register error:", err);
      return res.status(500).json({ message: "Failed to register web push subscription" });
    }
  });
  app2.post("/api/push/web/unregister", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      const endpoint = String(req.body?.endpoint || "").trim();
      if (!endpoint) return res.status(400).json({ message: "Endpoint is required" });
      await unregisterWebPushSubscription(db, Number(user.id), endpoint);
      return res.json({ success: true });
    } catch (err) {
      console.error("[WebPush] unregister error:", err);
      return res.status(500).json({ message: "Failed to unregister web push subscription" });
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
  app2.post("/api/admin/material-entitlements/grant", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.body?.userId);
      const materialId = Number(req.body?.materialId);
      const expiresAtRaw = req.body?.expiresAt;
      const expiresAt = expiresAtRaw == null || expiresAtRaw === "" ? null : Number.isFinite(Number(expiresAtRaw)) ? Number(expiresAtRaw) : null;
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(materialId) || materialId <= 0) {
        return res.status(400).json({ message: "userId and materialId are required" });
      }
      await db.query(
        `INSERT INTO standalone_material_entitlements
           (user_id, material_id, granted_at, granted_by_payment_ref, expires_at, is_active)
         VALUES ($1, $2, $3, NULL, $4, TRUE)
         ON CONFLICT (user_id, material_id)
         DO UPDATE SET is_active = TRUE, expires_at = EXCLUDED.expires_at, granted_at = EXCLUDED.granted_at`,
        [userId, materialId, Date.now(), expiresAt]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[Entitlement] grant failed:", err);
      return res.status(500).json({ message: "Failed to grant entitlement" });
    }
  });
  app2.post("/api/admin/material-entitlements/revoke", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.body?.userId);
      const materialId = Number(req.body?.materialId);
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(materialId) || materialId <= 0) {
        return res.status(400).json({ message: "userId and materialId are required" });
      }
      await db.query(
        "UPDATE standalone_material_entitlements SET is_active = FALSE WHERE user_id = $1 AND material_id = $2",
        [userId, materialId]
      );
      return res.json({ success: true });
    } catch (err) {
      console.error("[Entitlement] revoke failed:", err);
      return res.status(500).json({ message: "Failed to revoke entitlement" });
    }
  });
  registerCloudflareWebhookRoutes({
    app: app2,
    db
  });
  if (isLiveKitWebhookConfigured()) {
    registerLiveKitWebhookRoutes({
      app: app2,
      db
    });
  }
  registerRuntimeFlagRoutes({
    app: app2,
    db,
    requireAdmin
  });
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
        const [expoDetail, webDetail] = await Promise.all([
          db.query(
            `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, t.expo_push_token, t.platform, t.is_active, t.created_at, t.last_seen_at
             FROM user_push_tokens t
             LEFT JOIN users u ON u.id = t.user_id
             WHERE t.user_id = $1
             ${activeOnly ? "AND t.is_active = TRUE" : ""}
             ORDER BY t.last_seen_at DESC`,
            [userId]
          ),
          db.query(
            `SELECT w.id, w.user_id, u.name AS user_name, w.endpoint, w.user_agent, w.is_active, w.created_at, w.last_seen_at
             FROM web_push_subscriptions w
             LEFT JOIN users u ON u.id = w.user_id
             WHERE w.user_id = $1
             ${activeOnly ? "AND w.is_active = TRUE" : ""}
             ORDER BY w.last_seen_at DESC`,
            [userId]
          )
        ]);
        return res.json({
          summary: {
            userId,
            expoTotal: expoDetail.rows.length,
            expoActive: expoDetail.rows.filter((r) => r.is_active === true).length,
            webTotal: webDetail.rows.length,
            webActive: webDetail.rows.filter((r) => r.is_active === true).length
          },
          expoTokens: expoDetail.rows,
          webSubscriptions: webDetail.rows.map((r) => ({
            ...r,
            endpoint: String(r.endpoint || "").slice(0, 80) + (String(r.endpoint || "").length > 80 ? "\u2026" : "")
          }))
        });
      }
      const [expoSummary, webSummary, recentExpo, recentWeb] = await Promise.all([
        db.query(
          `SELECT
             COUNT(*)::int AS total_tokens,
             COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_tokens,
             COUNT(DISTINCT user_id)::int AS total_users,
             COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_tokens
           FROM user_push_tokens`
        ),
        db.query(
          `SELECT
             COUNT(*)::int AS total_subscriptions,
             COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_subscriptions,
             COUNT(DISTINCT user_id)::int AS total_users,
             COUNT(DISTINCT user_id) FILTER (WHERE is_active = TRUE)::int AS users_with_active_subscriptions
           FROM web_push_subscriptions`
        ),
        db.query(
          `SELECT t.user_id, u.name AS user_name, u.phone AS user_phone, u.role, t.platform, t.is_active, t.last_seen_at
           FROM user_push_tokens t
           LEFT JOIN users u ON u.id = t.user_id
           ${activeOnly ? "WHERE t.is_active = TRUE" : ""}
           ORDER BY t.last_seen_at DESC
           LIMIT 200`
        ),
        db.query(
          `SELECT w.user_id, u.name AS user_name, u.role, w.is_active, w.last_seen_at, LEFT(w.endpoint, 64) AS endpoint_prefix
           FROM web_push_subscriptions w
           LEFT JOIN users u ON u.id = w.user_id
           ${activeOnly ? "WHERE w.is_active = TRUE" : ""}
           ORDER BY w.last_seen_at DESC
           LIMIT 200`
        )
      ]);
      return res.json({
        expo: expoSummary.rows[0] || {
          total_tokens: 0,
          active_tokens: 0,
          total_users: 0,
          users_with_active_tokens: 0
        },
        web: webSummary.rows[0] || {
          total_subscriptions: 0,
          active_subscriptions: 0,
          total_users: 0,
          users_with_active_subscriptions: 0
        },
        recentExpoTokens: recentExpo.rows,
        recentWebSubscriptions: recentWeb.rows
      });
    } catch (err) {
      console.error("[Push Debug] failed:", err);
      return res.status(500).json({ message: "Failed to fetch push token stats" });
    }
  });
  app2.post("/api/admin/push/test", requireAdmin, async (req, res) => {
    try {
      const user = req.user;
      const userId = Number(user?.id);
      if (!Number.isFinite(userId) || userId <= 0) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const result = await sendPushToUsers(db, [userId], {
        title: "3i Learning \u2014 test push",
        body: "If you see this, admin push delivery is working.",
        data: { type: "admin_push_test" }
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("[Push Test] failed:", err);
      return res.status(500).json({ message: "Failed to send test push" });
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
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
  });
  registerCourseAccessRoutes({
    app: app2,
    db,
    getAuthUser,
    generateSecureToken,
    getR2Client,
    updateCourseProgress: updateCourseProgress2
  });
  registerUploadRoutes({
    app: app2,
    requireAdmin,
    getAuthUser,
    getR2Client,
    db
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
    updateCourseTestCounts: updateCourseTestCounts2,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2,
    runInTransaction
  });
  registerAdminCourseManagementRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts: updateCourseTestCounts2
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
    deleteDownloadsForUser: deleteDownloadsForUser2,
    deleteDownloadsForCourse: deleteDownloadsForCourse2,
    runInTransaction
  });
  registerAdminLectureRoutes({
    app: app2,
    db,
    requireAdmin,
    getR2Client,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2,
    runInTransaction
  });
  registerAdminTestRoutes({
    app: app2,
    db,
    requireAdmin,
    updateCourseTestCounts: updateCourseTestCounts2
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
    deleteDownloadsForUser: deleteDownloadsForUser2,
    runInTransaction,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
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
    updateCourseTestCounts: updateCourseTestCounts2
  });
  registerAdminDailyMissionRoutes({
    app: app2,
    db,
    requireAdmin,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
  });
  registerAdminContentExportRoutes({
    app: app2,
    db,
    requireAdmin,
    getR2Client
  });
  registerAdminStaffRoutes({
    app: app2,
    db,
    requireAdmin,
    runInTransaction
  });
  registerStaffRoutes({
    app: app2,
    db,
    requireStaff,
    updateCourseTestCounts: updateCourseTestCounts2,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2
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
    pool,
    requireAdmin,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2,
    getR2Client
  });
  registerClassroomRoutes({
    app: app2,
    db,
    requireAuth,
    requireAdmin,
    getAuthUser,
    recomputeAllEnrollmentsProgressForCourse: recomputeAllEnrollmentsProgressForCourse2,
    getR2Client
  });
  registerLiveClassPollRoutes({
    app: app2,
    db,
    listenPool,
    requireAuth,
    requireAdmin,
    getAuthUser
  });
  registerPdfRoutes({ app: app2, db, getAuthUser, getR2Client });
  const httpServer = createServer(app2);
  attachClassroomSyncServer(httpServer, db, getR2Client);
  return httpServer;
}
var databaseUrlRaw, databaseUrl, pgPoolMax, pgPoolMin, pgIdleTimeoutMs, pool, listenPool, db, generateAIAnswer, updateCourseProgress2, recomputeAllEnrollmentsProgressForCourse2, updateCourseTestCounts2, deleteDownloadsForUser2, deleteDownloadsForCourse2, authUserLazyKey, requireAdmin, requireStaff;
var init_routes = __esm({
  "backend/routes.ts"() {
    "use strict";
    init_upload_config();
    init_firebase();
    init_razorpay();
    init_security_utils();
    init_auth_utils();
    init_require_admin();
    init_require_staff();
    init_admin_staff_routes();
    init_staff_routes();
    init_native_device_binding();
    init_auth_failure_utils();
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
    init_admin_content_export_routes();
    init_admin_ops_routes();
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
    init_live_class_poll_routes();
    init_classroom_sync();
    init_course_access_routes();
    init_upload_routes();
    init_media_stream_routes();
    init_runtime_flag_routes();
    init_cloudflare_webhook_routes();
    init_livekit_sdk();
    init_livekit_webhook_routes();
    init_ai_tutor_service();
    init_db_readiness();
    init_db_utils();
    init_sms_utils();
    init_progress_utils();
    init_schedulers();
    init_download_utils();
    init_push_notifications();
    databaseUrlRaw = process.env.DATABASE_URL;
    databaseUrl = databaseUrlRaw ? normalizeDatabaseUrl(databaseUrlRaw) : void 0;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL must be set");
    }
    pgPoolMax = Math.min(50, Math.max(1, parseInt(process.env.PG_POOL_MAX || "10", 10) || 10));
    pgPoolMin = Math.min(pgPoolMax, Math.max(0, parseInt(process.env.PG_POOL_MIN || "0", 10) || 0));
    pgIdleTimeoutMs = Math.max(1e3, parseInt(process.env.PG_POOL_IDLE_MS || "60000", 10) || 6e4);
    pool = new Pool2({
      connectionString: databaseUrl,
      ssl: process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: true },
      max: pgPoolMax,
      min: pgPoolMin,
      connectionTimeoutMillis: 1e4,
      idleTimeoutMillis: pgIdleTimeoutMs,
      statement_timeout: 25e3,
      // Neon / PgBouncer / long-lived sockets benefit from TCP keep-alive.
      keepAlive: true,
      keepAliveInitialDelayMillis: 1e4
    });
    console.log("[DB] Main pool configured", {
      max: pgPoolMax,
      min: pgPoolMin,
      idleTimeoutMs: pgIdleTimeoutMs,
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
    updateCourseProgress2 = (userId, courseId) => updateCourseProgress(db, userId, courseId, runInTransaction);
    recomputeAllEnrollmentsProgressForCourse2 = (courseId) => recomputeAllEnrollmentsProgressForCourse(db, courseId);
    updateCourseTestCounts2 = (courseId) => updateCourseTestCounts(db, courseId);
    deleteDownloadsForUser2 = (userId, courseId) => deleteDownloadsForUser(db, userId, courseId);
    deleteDownloadsForCourse2 = (courseId) => deleteDownloadsForCourse(db, courseId);
    authUserLazyKey = /* @__PURE__ */ Symbol("authUserLazy");
    requireAdmin = createRequireAdmin(getAuthUser);
    requireStaff = createRequireStaff(getAuthUser);
  }
});

// backend/index.ts
init_pg_rate_limit_store();
init_redis_client();
init_redis_rate_limit_store();
import dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { ipKeyGenerator } from "express-rate-limit";
import compression from "compression";
import pg from "pg";
import { randomUUID } from "node:crypto";

// backend/error-middleware.ts
function setupErrorHandler(app2, isTrustedOrigin2) {
  app2.use((err, req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = status >= 500 && process.env.NODE_ENV === "production" ? "Internal Server Error" : error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    const origin = req.get("origin");
    if (origin && isTrustedOrigin2(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }
    return res.status(status).json({ message });
  });
}

// backend/index.ts
init_ai_tutor_service();
init_db_utils();
init_feature_flags();
init_observability();
import cors from "cors";
var envPath = path.resolve(process.cwd(), ".env");
if (process.env.NODE_ENV !== "production" || process.env.LOAD_DOTENV === "true") {
  dotenv.config({ path: envPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: false });
}
if (!process.env.OTP_HMAC_SECRET) {
  throw new Error("OTP_HMAC_SECRET must be set");
}
if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in production");
}
var app = express();
var log = console.log;
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
      "X-Client-Form-Factor"
    ],
    credentials: true,
    exposedHeaders: ["Content-Length", "Content-Type", "Content-Disposition"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
    // maxAge: 0 tells the browser never to cache preflight responses.
    // Without this, Chrome caches a preflight that lacks PATCH for up to 600s
    // and "Disable cache" in DevTools does NOT clear the CORS preflight cache.
    maxAge: 0
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
    const trustedOrigin = origin ? isTrustedOrigin(origin) : false;
    const trustedReferer = referer ? isTrustedOrigin(referer) : false;
    if (trustedOrigin || trustedReferer) return next();
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
    const reqId = req.get("x-request-id") || randomUUID();
    res.setHeader("x-request-id", reqId);
    const start = Date.now();
    const reqPath = req.path;
    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;
      const duration = Date.now() - start;
      if (duration > 500 || res.statusCode >= 500) {
        log(`[req:${reqId}] ${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
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
    "backend",
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
function normalizeOtpIdentifier(input) {
  const raw = String(input || "").trim().toLowerCase();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 10) return `phone:${digits.slice(-10)}`;
  return `id:${raw || "global"}`;
}
function normalizeRateLimitStoreKind(value, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "postgres" || raw === "postgresql") return "pg";
  if (raw === "pg" || raw === "redis" || raw === "memory") return raw;
  return fallback;
}
(async () => {
  const { registerRoutes: registerRoutes2 } = await Promise.resolve().then(() => (init_routes(), routes_exports));
  setupCors(app);
  setupBodyParsing(app);
  setupApiResponseFormat(app);
  app.use(
    compression({
      filter: (req, res) => {
        const p = req.path || "";
        if (p.includes("/sse") || p.includes("/stream") || p.includes("/api/media/") || p.startsWith("/api/live-classes/") || p.includes("/listen")) {
          return false;
        }
        return compression.filter(req, res);
      }
    })
  );
  app.use(metricsMiddleware);
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
      // SEC-02: "strict" prevents the cookie from being sent on any cross-site request,
      // eliminating CSRF risk on cookie-authenticated GET endpoints with side effects.
      // The app primarily uses Bearer token auth (CSRF-immune by design), so changing
      // from "lax" to "strict" has no functional impact on normal usage.
      sameSite: "strict",
      maxAge: 400 * 24 * 60 * 60 * 1e3,
      ...isProduction && sessionCookieDomain ? { domain: sessionCookieDomain } : {}
    }
  };
  if (isProduction && process.env.DATABASE_URL) {
    const PgSession = connectPgSimple(session);
    sessionConfig.store = new PgSession({
      conString: normalizeDatabaseUrl(process.env.DATABASE_URL),
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
  app.get("/api/health/version", (req, res) => {
    const secret = process.env.METRICS_SECRET?.trim();
    const auth2 = String(req.headers.authorization || "");
    const isAuthed = !!secret && auth2.startsWith("Bearer ") && auth2.slice(7).trim() === secret;
    if (process.env.NODE_ENV === "production" && !isAuthed) {
      return res.json({ ok: true });
    }
    res.json(getBackendVersion());
  });
  app.get("/api/health/ai-providers", (_req, res) => {
    res.json({ ok: true, ...getAiTutorHealthSnapshot() });
  });
  app.get("/api/metrics", (req, res) => {
    const secret = process.env.METRICS_SECRET?.trim();
    if (secret) {
      const auth2 = String(req.headers.authorization || "");
      if (!auth2.startsWith("Bearer ") || auth2.slice(7).trim() !== secret) {
        return res.status(403).json({ error: "Forbidden" });
      }
    } else if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(getMetricsSnapshot());
  });
  const rateLimitPgSsl = process.env.PGSSL_NO_VERIFY === "true" && process.env.NODE_ENV !== "production" ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
  const rateLimitPool = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.trim().length > 0 ? new pg.Pool({
    connectionString: normalizeDatabaseUrl(process.env.DATABASE_URL),
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
  const redisClient = await getRedisClient();
  const failClosedAuthRateLimit = getEnvFlag("FF_FAIL_CLOSED_AUTH_RATE_LIMIT", true);
  const failClosedMediaRateLimit = getEnvFlag("FF_FAIL_CLOSED_MEDIA_RATE_LIMIT", true);
  const defaultRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.RATE_LIMIT_STORE, "pg");
  const authRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.AUTH_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const mediaRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.MEDIA_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const globalRateLimitStoreKind = normalizeRateLimitStoreKind(process.env.GLOBAL_RATE_LIMIT_STORE, defaultRateLimitStoreKind);
  const makeRateLimitStore = (prefix, options, storeKind = defaultRateLimitStoreKind) => {
    if (storeKind === "pg") {
      if (rateLimitPool) return new PgRateLimitStore(rateLimitPool, options);
      if (redisClient) return new RedisRateLimitStore(redisClient, prefix, options);
      return void 0;
    }
    if (storeKind === "redis") {
      if (redisClient) return new RedisRateLimitStore(redisClient, prefix, options);
      if (rateLimitPool) return new PgRateLimitStore(rateLimitPool, options);
      return void 0;
    }
    return void 0;
  };
  const otpSendStore = makeRateLimitStore("otp-send", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const otpVerifyStore = makeRateLimitStore("otp-verify", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const authLoginStore = makeRateLimitStore("auth-login", { failClosed: failClosedAuthRateLimit }, authRateLimitStoreKind);
  const mediaTokenStore = makeRateLimitStore("media-token", { failClosed: failClosedMediaRateLimit }, mediaRateLimitStoreKind);
  const globalApiStore = makeRateLimitStore("global-api", void 0, globalRateLimitStoreKind);
  if (redisClient) {
    console.log("[Redis] Client configured for optional shared features");
  }
  console.log("[RateLimit] Store selection", {
    default: defaultRateLimitStoreKind,
    auth: authRateLimitStoreKind,
    media: mediaRateLimitStoreKind,
    global: globalRateLimitStoreKind,
    pgAvailable: !!rateLimitPool,
    redisAvailable: !!redisClient
  });
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
  const authLoginKey = (req) => {
    const body = req.body ?? {};
    const raw = body.identifier ?? body.email ?? body.phoneNumber ?? body.phone ?? "global";
    return `auth-login:${ipKeyGenerator(req.ip || "")}:${normalizeOtpIdentifier(raw)}`;
  };
  const authLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 25,
    message: { message: "Too many login attempts, please try again later" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: authLoginKey,
    ...authLoginStore ? { store: authLoginStore } : {}
  });
  app.use("/api/auth/email-login", authLoginLimiter);
  app.use("/api/auth/verify-firebase", authLoginLimiter);
  app.use("/api/auth/firebase-login", authLoginLimiter);
  app.use("/api/auth/register-complete", authLoginLimiter);
  const mediaTokenLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 40,
    message: { message: "Too many media requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const auth2 = req.headers.authorization || "";
      const suffix = auth2.startsWith("Bearer ") ? auth2.slice(7, 24) : ipKeyGenerator(req.ip || "");
      return `media-token:${suffix}`;
    },
    ...mediaTokenStore ? { store: mediaTokenStore } : {}
  });
  app.use("/api/media-token", mediaTokenLimiter);
  const globalApiLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 600,
    message: { message: "Too many requests, please slow down" },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/send-otp") || req.path.startsWith("/api/auth/verify-otp") || req.path.startsWith("/api/auth/email-login") || req.path.startsWith("/api/auth/verify-firebase") || req.path.startsWith("/api/auth/firebase-login") || req.path.startsWith("/api/auth/register-complete") || req.path === "/api/media-token",
    ...globalApiStore ? { store: globalApiStore } : {}
  });
  app.use("/api", globalApiLimiter);
  const server = await registerRoutes2(app);
  app.get("/firebase-phone-auth", (_req, res) => {
    const firebaseAuthPath = path.resolve(process.cwd(), "backend", "templates", "firebase-phone-auth.html");
    if (fs.existsSync(firebaseAuthPath)) {
      return res.type("html").sendFile(firebaseAuthPath);
    }
    res.status(404).send("Not found");
  });
  configureExpoAndLanding(app);
  setupErrorHandler(app, isTrustedOrigin);
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
    if (typeof process.send === "function") {
      process.send("ready");
    }
  });
  process.on("SIGTERM", () => {
    log("[shutdown] SIGTERM received \u2014 draining in-flight requests");
    server.close(() => {
      log("[shutdown] All connections closed \u2014 exiting cleanly");
      process.exit(0);
    });
    setTimeout(() => {
      console.warn("[shutdown] Forced exit after 10 s timeout");
      process.exit(1);
    }, 1e4).unref();
  });
  process.on("SIGINT", () => {
    log("[shutdown] SIGINT received \u2014 exiting");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5e3).unref();
  });
})();
