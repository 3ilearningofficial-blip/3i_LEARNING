import type { Express, Request, Response } from "express";
import { isEnrollmentExpired } from "./course-access-utils";
import { canonicalMediaKey, mediaKeyMatchVariants } from "./media-key-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = {
  id: number;
  role: string;
};

type RegisterMediaStreamRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  getR2Client: () => Promise<any>;
};

import { withTimeout, isTimeoutError } from "./async-utils";

// R2 timeouts: cold reads from the India region routinely take 8–12 s, so the previous
// 10/15 s ceilings often pushed PDFs and videos into a 504. We give R2 a longer window
// here and add a single retry below for the GetObject path.
// Align any reverse-proxy read_timeout (nginx, Cloudflare origin rules) to exceed
// R2_HEAD_TIMEOUT_MS + R2_GET_TIMEOUT_MS (+ retry) or use presigned readUrl from /api/media-token.
const R2_HEAD_TIMEOUT_MS = 15000;
const R2_GET_TIMEOUT_MS = 30000;

const R2_HEAD_META_TTL_MS = 5 * 60 * 1000;
const R2_HEAD_META_MAX = 400;
type R2HeadMetaEntry = { contentLength: number; contentType: string | undefined; storedAt: number };
const r2HeadMetaLru = new Map<string, R2HeadMetaEntry>();

function r2HeadMetaGet(key: string): R2HeadMetaEntry | null {
  const row = r2HeadMetaLru.get(key);
  if (!row) return null;
  if (Date.now() - row.storedAt > R2_HEAD_META_TTL_MS) {
    r2HeadMetaLru.delete(key);
    return null;
  }
  return row;
}

function r2HeadMetaSet(key: string, contentLength: number, contentType: string | undefined) {
  if (r2HeadMetaLru.size >= R2_HEAD_META_MAX) {
    const oldest = r2HeadMetaLru.keys().next().value;
    if (oldest) r2HeadMetaLru.delete(oldest);
  }
  r2HeadMetaLru.set(key, { contentLength, contentType, storedAt: Date.now() });
}

async function r2GetWithRetry<T>(
  send: () => Promise<T>,
  label: string,
): Promise<T> {
  try {
    return await withTimeout<T>(send(), R2_GET_TIMEOUT_MS, label);
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    // Brief backoff, then a single retry. Most R2 timeouts are transient and a quick
    // retry succeeds where the first request had a slow connection setup.
    await new Promise((r) => setTimeout(r, 250));
    return await withTimeout<T>(send(), R2_GET_TIMEOUT_MS, label);
  }
}

// Non-sensitive display/marketing image buckets. Files here (welcome-page photos,
// avatars, course thumbnails) are shown on the public site and to every signed-in
// user, so they are served WITHOUT auth. Course content lives under other prefixes
// (lectures/, videos/, materials/, course-materials/, books/, live-class-recording/,
// uploads/) and is never made public by this list.
const PUBLIC_DISPLAY_MEDIA_PREFIXES = [
  "images/",
  "profile-images/",
  "thumbnails/",
  "course-thumbnails/",
];
// Second guard: only actual image files are exposed publicly, so a stray non-image
// object accidentally placed under a display prefix is never served without auth.
const PUBLIC_IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif)$/i;

function isPublicDisplayMediaKey(key: string): boolean {
  const k = key.replace(/^\/+/, "").toLowerCase();
  if (!PUBLIC_DISPLAY_MEDIA_PREFIXES.some((prefix) => k.startsWith(prefix))) return false;
  return PUBLIC_IMAGE_EXTENSION.test(k);
}

async function streamMediaGet(
  req: Request,
  res: Response,
  db: DbClient,
  getAuthUser: (req: Request) => Promise<AuthUser | null>,
  getR2Client: () => Promise<any>,
  key: string
): Promise<void> {
  const canonicalKey = canonicalMediaKey(key);
  if (!canonicalKey || canonicalKey === "/") {
    res.status(400).json({ message: "No file key" });
    return;
  }
  // Public marketing/display images (welcome-page photos, avatars, course
  // thumbnails) skip all auth so logged-out visitors AND students load them the
  // same way admins do. Without this, /api/media/images/... returns 401 for guests
  // and 403 for students (the key matches no enrolled course).
  const isPublicAsset = isPublicDisplayMediaKey(canonicalKey);
  const mediaToken = req.query.token as string | undefined;
  let userId: number | null = null;
  let userRole = "student";
  let authenticatedViaMediaToken = false;

  if (isPublicAsset) {
    // No authentication or entitlement check — these are public assets.
  } else if (mediaToken) {
    const MEDIA_TOKEN_MAX_ACCESS = 800;
    const nowMs = Date.now();
    let tokenResult: { rows: Array<{ user_id: number; access_count?: number }> };
    try {
      // SEC-05: Enforce the access_count limit atomically inside the UPDATE WHERE clause.
      // Previously the UPDATE incremented unconditionally then checked after the fact —
      // a client could exceed the limit during the window between increment and check.
      // Now the UPDATE only proceeds if access_count is still under the cap.
      // If the limit is already reached, 0 rows are returned → we distinguish this from
      // an invalid token via a follow-up SELECT below.
      tokenResult = await db.query(
        `UPDATE media_tokens
         SET access_count = access_count + 1
         WHERE token = $1
           AND expires_at > $2
           AND file_key = $3
           AND access_count < $4
         RETURNING user_id, access_count`,
        [mediaToken, nowMs, canonicalKey, MEDIA_TOKEN_MAX_ACCESS]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("access_count")) throw err;
      // Fallback for pre-migration schema where access_count column doesn't exist yet.
      tokenResult = await db.query(
        "SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3",
        [mediaToken, nowMs, canonicalKey]
      );
    }
    if (tokenResult.rows.length === 0) {
      // Distinguish "limit exceeded" from "token invalid/expired" for a correct status code.
      const limitCheck = await db.query(
        "SELECT access_count FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3 LIMIT 1",
        [mediaToken, nowMs, canonicalKey]
      ).catch(() => ({ rows: [] as any[] }));
      if (limitCheck.rows.length > 0 && Number(limitCheck.rows[0].access_count) >= MEDIA_TOKEN_MAX_ACCESS) {
        res.status(429).json({ message: "Token usage limit exceeded" });
      } else {
        res.status(401).json({ message: "Token expired or invalid" });
      }
      return;
    }
    // access_count guard is now enforced atomically in the UPDATE WHERE clause above.
    const tokenUserId = tokenResult.rows[0].user_id as number;
    const sessionUser = await getAuthUser(req);
    // Session cookie is often absent on api.* when the app runs on www/root domain — pdf.js/video still sends ?token=... only.
    // A row in media_tokens already binds this token to tokenUserId after authenticated mint.
    if (sessionUser && sessionUser.id !== tokenUserId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    userId = tokenUserId;
    if (sessionUser && sessionUser.id === tokenUserId) {
      userRole = sessionUser.role;
    } else {
      const roleRow = await db.query("SELECT role FROM users WHERE id = $1 LIMIT 1", [tokenUserId]);
      userRole = String(roleRow.rows[0]?.role ?? "student");
    }
    authenticatedViaMediaToken = true;

      // F-01: playback-time entitlement check for media-token authenticated requests.
      // Without this, a token minted while the user was enrolled could remain usable
      // after `enrollments.valid_until` is updated/revoked.
      if (userRole !== "admin") {
        const variants = mediaKeyMatchVariants(canonicalKey);

        const lectureMatch = await db.query(
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
            // Free preview lecture stays playable.
          } else {
            const enrollment = await db.query(
              "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
              [userId, row.course_id]
            );
            if (enrollment.rows.length === 0 || isEnrollmentExpired(enrollment.rows[0])) {
              res.status(403).json({ message: "Enrollment required" });
              return;
            }
          }
        } else {
          const liveClassMatch = await db.query(
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
              // Free preview.
            } else {
              const enrollment = await db.query(
                "SELECT id, valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
                [userId, row.course_id]
              );
              if (enrollment.rows.length === 0 || isEnrollmentExpired(enrollment.rows[0])) {
                res.status(403).json({ message: "Enrollment required" });
                return;
              }
            }
          } else {
            const materialMatch = await db.query(
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
                // Free material stays playable.
              } else {
                const enrollment = await db.query(
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
    const user = await getAuthUser(req);
    if (!user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    userId = user.id;
    userRole = user.role;
  }

  // Media token mint already validates entitlement for this user + key.
  // Public display assets are exempt — they were served above without auth.
  if (!isPublicAsset && !authenticatedViaMediaToken && userRole !== "admin") {
    const keyVariants = mediaKeyMatchVariants(canonicalKey);

    const matResult = await db.query(
      `SELECT course_id, is_free
       FROM study_materials
       WHERE file_url = ANY($1::text[])
          OR regexp_replace(file_url, '^https?://[^/]+/', '') = ANY($1::text[])
          OR regexp_replace(file_url, '^https?://[^/]+', '') = ANY($1::text[])
       LIMIT 1`,
      [keyVariants],
    );
    if (matResult.rows.length > 0) {
      const mat = matResult.rows[0];
      if (mat.course_id && !mat.is_free) {
        const enrolled = await db.query(
          "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
          [userId, mat.course_id],
        );
        if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
          res.status(403).json({ message: "Enrollment required" });
          return;
        }
      }
    } else {
      const lecResult = await db.query(
        `SELECT course_id, is_free_preview
         FROM lectures
         WHERE video_url = ANY($1::text[])
            OR pdf_url = ANY($1::text[])
            OR regexp_replace(video_url, '^https?://[^/]+/', '') = ANY($1::text[])
            OR regexp_replace(video_url, '^https?://[^/]+', '') = ANY($1::text[])
            OR regexp_replace(pdf_url, '^https?://[^/]+/', '') = ANY($1::text[])
            OR regexp_replace(pdf_url, '^https?://[^/]+', '') = ANY($1::text[])
         LIMIT 1`,
        [keyVariants],
      );
      if (lecResult.rows.length > 0) {
        const lec = lecResult.rows[0];
        if (lec.course_id && !lec.is_free_preview) {
          const enrolled = await db.query(
            "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
            [userId, lec.course_id],
          );
          if (enrolled.rows.length === 0 || isEnrollmentExpired(enrolled.rows[0])) {
            res.status(403).json({ message: "Enrollment required" });
            return;
          }
        }
      } else {
        const lcResult = await db.query(
          `SELECT course_id, is_free_preview
           FROM live_classes
           WHERE recording_url = ANY($1::text[])
              OR regexp_replace(recording_url, '^https?://[^/]+/', '') = ANY($1::text[])
              OR regexp_replace(recording_url, '^https?://[^/]+', '') = ANY($1::text[])
           LIMIT 1`,
          [keyVariants],
        );
        if (lcResult.rows.length > 0) {
          const lc = lcResult.rows[0];
          if (lc.course_id && !lc.is_free_preview) {
            const enrolled = await db.query(
              "SELECT valid_until FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL) LIMIT 1",
              [userId, lc.course_id],
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
    let totalSize: number;
    let headContentType: string | undefined;
    if (cachedHead) {
      totalSize = cachedHead.contentLength;
      headContentType = cachedHead.contentType;
    } else {
      const head = await withTimeout<any>(
        r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey })),
        R2_HEAD_TIMEOUT_MS,
        "R2 head request timed out",
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

    const obj = await r2GetWithRetry<any>(
      () =>
        r2.send(
          new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey, Range: `bytes=${start}-${end}` }),
        ),
      "R2 media range request timed out",
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
    // PDF range responses can be safely cached privately for a few minutes — pdf.js
    // re-requests range chunks repeatedly on page navigation. All other content stays
    // no-store so signed-token access controls aren't undermined.
    const isPdf = typeof headContentType === "string" && /pdf/i.test(headContentType);
    res.setHeader(
      "Cache-Control",
      isPublicAsset ? "public, max-age=300" : isPdf ? "private, max-age=300" : "private, no-store"
    );
    res.setHeader("Content-Disposition", "inline");

    const stream = obj.Body as any;
    if (typeof stream.pipe === "function") stream.pipe(res);
    else if (stream.transformToByteArray) {
      const bytes = await stream.transformToByteArray();
      res.end(Buffer.from(bytes));
    } else res.status(500).json({ message: "Cannot stream file" });
  } else {
    const obj = await r2GetWithRetry<any>(
      () => r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey })),
      "R2 media request timed out",
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
    // PDFs are safe to cache privately for a few minutes (re-opens hit the browser
    // cache instead of R2). Other media stays no-store so signed-token access
    // controls aren't undermined.
    const isPdf = typeof obj.ContentType === "string" && /pdf/i.test(obj.ContentType);
    res.setHeader(
      "Cache-Control",
      isPublicAsset ? "public, max-age=300" : isPdf ? "private, max-age=300" : "private, no-store"
    );
    res.setHeader("Content-Disposition", "inline");

    const stream = obj.Body as any;
    if (typeof stream.pipe === "function") stream.pipe(res);
    else if (stream.transformToByteArray) {
      const bytes = await stream.transformToByteArray();
      res.end(Buffer.from(bytes));
    } else res.status(500).json({ message: "Cannot stream file" });
  }
}

export function registerMediaStreamRoutes({
  app,
  db,
  getAuthUser,
  getR2Client,
}: RegisterMediaStreamRoutesDeps): void {
  // Nested R2 key: e.g. live-class-recording/chapter-1/file.webm (must register before 2-segment route)
  app.get("/api/media/:a/:b/:c", async (req: Request, res: Response) => {
    try {
      const key = `${req.params.a}/${req.params.b}/${req.params.c}`;
      await streamMediaGet(req, res, db, getAuthUser, getR2Client, key);
    } catch (err: any) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });

  app.get("/api/media/:folder/:filename", async (req: Request, res: Response) => {
    try {
      const key = `${req.params.folder}/${req.params.filename}`;
      await streamMediaGet(req, res, db, getAuthUser, getR2Client, key);
    } catch (err: any) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });

  // Catch-all nested keys: /api/media/a/b/c/d...
  app.get(/^\/api\/media\/(.+)$/, async (req: Request, res: Response) => {
    try {
      const key = String((req.params as any)?.[0] || "").replace(/^\/+/, "");
      await streamMediaGet(req, res, db, getAuthUser, getR2Client, key);
    } catch (err: any) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (String(err?.message || "").toLowerCase().includes("timed out")) {
        return res.status(504).json({ message: "Media upstream timeout" });
      }
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      if (!res.headersSent) res.status(500).json({ message: "Failed to fetch file" });
    }
  });
}
