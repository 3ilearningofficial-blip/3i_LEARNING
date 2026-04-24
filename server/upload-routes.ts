import type { Express, Request, Response } from "express";

type RegisterUploadRoutesDeps = {
  app: Express;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<{ id: number } | null>;
  getR2Client: () => Promise<any>;
  uploadLarge: any;
};

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

  app.post("/api/upload/presign", requireAdmin, async (req: Request, res: Response) => {
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
      if (!(req as any).file) return res.status(400).json({ message: "No file uploaded" });
      const file = (req as any).file;
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

