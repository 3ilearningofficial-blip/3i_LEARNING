import type { Express, Request, Response } from "express";
import { LIVE_CLASS_RECORDING_ROOT, sanitizeLiveRecordingSubfolder } from "./r2-path-utils";
import { isTimeoutError, withTimeout } from "./async-utils";

type RegisterUploadRoutesDeps = {
  app: Express;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<{ id: number } | null>;
  getR2Client: () => Promise<any>;
};

function getPublicApiBaseUrl(req: Request): string {
  const configured = String(process.env.PUBLIC_API_BASE_URL || "").trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
  const normalizedProtocol = host && String(host).includes("3ilearning.in") ? "https" : protocol;
  return `${normalizedProtocol}://${host}`;
}

function buildPresignedObjectKey(
  body: { filename: string; folder?: string; subfolder?: string }
): { key: string } | { error: string } {
  const { filename, folder: rawFolder = "uploads", subfolder: rawSub } = body;
  if (!filename) return { error: "filename required" };
  const ext = String(filename).split(".").pop() || "";
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  if (String(rawFolder) === LIVE_CLASS_RECORDING_ROOT) {
    const hasSub = rawSub !== undefined && rawSub !== null && String(rawSub).trim() !== "";
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

export function registerUploadRoutes({
  app,
  requireAdmin,
  getAuthUser,
  getR2Client,
}: RegisterUploadRoutesDeps): void {
  app.post("/api/upload/presign-profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { filename, contentType } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      // Explicit allowlist — SVG is excluded because SVGs can contain <script> tags (XSS).
      // startsWith("image/") alone is not sufficient.
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
    } catch (err: any) {
      console.error("[R2] Profile presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  app.get("/api/admin/upload/live-class-recording-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return res.status(500).json({ message: "R2 not configured" });
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const prefix = `${LIVE_CLASS_RECORDING_ROOT}/`;
      const out = await withTimeout<any>(
        r2.send(
          new ListObjectsV2Command({
            Bucket: process.env.R2_BUCKET_NAME,
            Prefix: prefix,
            Delimiter: "/",
            MaxKeys: 1000,
          }),
        ),
        6000,
        "R2 list folders timed out",
      );
      const fromPrefixes = (out.CommonPrefixes || [])
        .map((c: { Prefix?: string }) => c.Prefix?.replace(prefix, "").replace(/\/$/, "") || "")
        .filter(Boolean);
      const fromKeys = (out.Contents || [])
        .map((c: { Key?: string }) => c.Key)
        .filter((k: string | undefined): k is string => !!k)
        .map((k: string) => {
          const rest = k.replace(prefix, "");
          const i = rest.indexOf("/");
          if (i <= 0) return null;
          return rest.slice(0, i);
        })
        .filter((x: string | null): x is string => !!x);
      const names = [...new Set([...fromPrefixes, ...fromKeys])].sort();
      res.json({ folders: names });
    } catch (err) {
      // On R2 latency, degrade to an empty list with a 200 so the admin UI stays
      // usable. A 504 here would also strip CORS headers via the upstream proxy
      // and cause a confusing "Access-Control-Allow-Credentials" browser error.
      if (isTimeoutError(err)) {
        console.warn("[R2] List subfolders timed out, returning empty list");
        return res.json({ folders: [], degraded: true });
      }
      console.error("[R2] List subfolders error:", err);
      res.status(500).json({ message: "Failed to list folders" });
    }
  });

  app.post("/api/admin/upload/live-class-recording-folders", requireAdmin, async (req: Request, res: Response) => {
    try {
      if (!process.env.R2_BUCKET_NAME) return res.status(500).json({ message: "R2 not configured" });
      const name = sanitizeLiveRecordingSubfolder((req.body as { name?: string }).name);
      if (!name) return res.status(400).json({ message: "Invalid folder name" });
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const r2 = await getR2Client();
      const key = `${LIVE_CLASS_RECORDING_ROOT}/${name}/.keep`;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: new Uint8Array(0),
          ContentType: "text/plain; charset=utf-8",
        })
      );
      res.json({ success: true, name });
    } catch (err) {
      console.error("[R2] Create subfolder error:", err);
      res.status(500).json({ message: "Failed to create folder" });
    }
  });

  // Allowlist of MIME types accepted by the admin presign endpoint.
  // SVG is explicitly excluded (SVGs can embed <script> tags → XSS if served from the same origin).
  // Add new types here only after confirming the client and CDN handle them safely.
  const ALLOWED_ADMIN_MIME_TYPES = new Set([
    // Images
    "image/jpeg", "image/png", "image/webp", "image/gif",
    // Documents
    "application/pdf",
    // Video (Cloudflare Stream handles these; direct R2 for recordings)
    "video/mp4", "video/webm", "video/quicktime",
    // Audio
    "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav",
    // Data — interactive classroom board sync checkpoints (tldraw snapshots).
    // Safe to allow: browsers render application/json inline as text and never
    // execute it as script (unlike SVG/HTML, which remain excluded).
    "application/json",
  ]);

  app.post("/api/upload/presign", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { filename, contentType, folder, subfolder } = req.body;
      if (!filename || !contentType) return res.status(400).json({ message: "filename and contentType required" });
      // Validate MIME type against the server-side allowlist.
      // Never pass the client-supplied contentType directly to S3 without validation —
      // an admin could presign a text/html or application/javascript object, which would
      // be an XSS vector if the R2 bucket has public read access.
      if (!ALLOWED_ADMIN_MIME_TYPES.has(String(contentType))) {
        return res.status(400).json({
          message: `Content type '${contentType}' is not allowed. Permitted types: images (JPEG/PNG/WebP/GIF), PDF, MP4/WebM/MOV video, and common audio formats.`,
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
        ContentType: contentType,
      });
      // CFSR-02: Use a 1-hour expiry for video uploads, 10 minutes for everything else.
      // A 500MB lecture video on a 1 Mbps connection takes ~67 minutes to upload —
      // the previous 600s (10 min) presigned URL expired mid-upload, causing a 403 from R2.
      // Security risk of a 1-hour PUT URL is minimal: it is bound to a specific R2 key
      // and can only PUT (not GET, LIST, or DELETE) that single object.
      const isVideo = String(contentType).startsWith("video/");
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: isVideo ? 3600 : 600 });
      const publicUrl = `${getPublicApiBaseUrl(req)}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  // Buffered uploads used multer in-memory which can OOM on concurrent large files.
  // Large assets must be uploaded via presigned PUT URL (`/api/upload/presign` + client PUT).
  app.post("/api/upload/to-r2", requireAdmin, async (_req: Request, res: Response) => {
    res.status(410).json({
      message: "Server-side buffered uploads are disabled. Use /api/upload/presign and upload from the client directly to R2.",
    });
  });

  app.delete("/api/upload/file", requireAdmin, async (req: Request, res: Response) => {
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
        "live-class-recording/",
      ];
      const keyAllowed = ALLOWED_KEY_PREFIXES.some((prefix) => String(key).startsWith(prefix));
      if (!keyAllowed) return res.status(403).json({ message: "Invalid file key — operation not permitted" });
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

