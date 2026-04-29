import type { Express, Request, Response } from "express";
import { LIVE_CLASS_RECORDING_ROOT, sanitizeLiveRecordingSubfolder } from "./r2-path-utils";

type RegisterUploadRoutesDeps = {
  app: Express;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<{ id: number } | null>;
  getR2Client: () => Promise<any>;
  uploadLarge: any;
};

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
  uploadLarge,
}: RegisterUploadRoutesDeps): void {
  app.post("/api/upload/presign-profile", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
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
      const out = await r2.send(
        new ListObjectsV2Command({
          Bucket: process.env.R2_BUCKET_NAME,
          Prefix: prefix,
          Delimiter: "/",
          MaxKeys: 1000,
        })
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

  app.post("/api/upload/presign", requireAdmin, async (req: Request, res: Response) => {
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
        ContentType: contentType,
      });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 600 });
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Presigned URL generated for ${key}, public: ${publicUrl}`);
      res.json({ uploadUrl, publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Presign error:", err?.message || err);
      res.status(500).json({ message: "Failed to generate upload URL" });
    }
  });

  app.post("/api/upload/to-r2", requireAdmin, uploadLarge.single("file"), async (req: Request, res: Response) => {
    try {
      if (process.env.ALLOW_SERVER_BUFFER_UPLOAD !== "true") {
        return res.status(403).json({
          message:
            "Direct buffered upload is disabled. Use /api/upload/presign and upload from client instead.",
        });
      }
      if (!(req as any).file) return res.status(400).json({ message: "No file uploaded" });
      const file = (req as any).file;
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
          ContentType: file.mimetype,
        })
      );
      const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
      const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${process.env.PORT || 5000}`;
      const publicUrl = `${protocol}://${host}/api/media/${key}`;
      console.log(`[R2] Server upload complete: ${key} (${file.size} bytes)`);
      res.json({ publicUrl, key });
    } catch (err: any) {
      console.error("[R2] Server upload error:", err?.message || err);
      res.status(500).json({ message: "Failed to upload file" });
    }
  });

  app.delete("/api/upload/file", requireAdmin, async (req: Request, res: Response) => {
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

