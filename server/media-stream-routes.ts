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
const R2_HEAD_TIMEOUT_MS = 15000;
const R2_GET_TIMEOUT_MS = 30000;

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
  const mediaToken = req.query.token as string | undefined;
  let userId: number | null = null;
  let userRole = "student";
  let authenticatedViaMediaToken = false;

  if (mediaToken) {
    const tokenResult = await db.query("SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [mediaToken, Date.now(), canonicalKey]);
    if (tokenResult.rows.length === 0) {
      res.status(401).json({ message: "Token expired or invalid" });
      return;
    }
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
  if (!authenticatedViaMediaToken && userRole !== "admin") {
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
        res.status(403).json({ message: "Forbidden" });
        return;
      }
    }
  }

  const { GetObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const r2 = await getR2Client();
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const head = await withTimeout<any>(
      r2.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: canonicalKey })),
      R2_HEAD_TIMEOUT_MS,
      "R2 head request timed out"
    );
    const totalSize = head.ContentLength || 0;
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
    if (head.ContentType) res.setHeader("Content-Type", head.ContentType);
    // PDF range responses can be safely cached privately for a few minutes — pdf.js
    // re-requests range chunks repeatedly on page navigation. All other content stays
    // no-store so signed-token access controls aren't undermined.
    const isPdf = typeof head.ContentType === "string" && /pdf/i.test(head.ContentType);
    res.setHeader("Cache-Control", isPdf ? "private, max-age=300" : "private, no-store");
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

    if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
    if (obj.ContentLength) res.setHeader("Content-Length", String(obj.ContentLength));
    res.setHeader("Accept-Ranges", "bytes");
    // PDFs are safe to cache privately for a few minutes (re-opens hit the browser
    // cache instead of R2). Other media stays no-store so signed-token access
    // controls aren't undermined.
    const isPdf = typeof obj.ContentType === "string" && /pdf/i.test(obj.ContentType);
    res.setHeader("Cache-Control", isPdf ? "private, max-age=300" : "private, no-store");
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
