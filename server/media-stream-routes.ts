import type { Express, Request, Response } from "express";

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

export function registerMediaStreamRoutes({
  app,
  db,
  getAuthUser,
  getR2Client,
}: RegisterMediaStreamRoutesDeps): void {
  app.get("/api/media/:folder/:filename", async (req: Request, res: Response) => {
    try {
      const key = `${req.params.folder}/${req.params.filename}`;
      if (!key || key === "/") return res.status(400).json({ message: "No file key" });
      const mediaToken = req.query.token as string | undefined;
      let userId: number | null = null;
      let userRole = "student";

      if (mediaToken) {
        const tokenResult = await db.query("SELECT user_id FROM media_tokens WHERE token = $1 AND expires_at > $2 AND file_key = $3", [mediaToken, Date.now(), key]);
        if (tokenResult.rows.length === 0) return res.status(401).json({ message: "Token expired or invalid" });
        userId = tokenResult.rows[0].user_id;
        const userResult = await db.query("SELECT role FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length > 0) userRole = userResult.rows[0].role;
      } else {
        const user = await getAuthUser(req);
        if (!user) return res.status(401).json({ message: "Unauthorized" });
        userId = user.id;
        userRole = user.role;
      }

      if (userRole !== "admin") {
        const matResult = await db.query("SELECT course_id, is_free FROM study_materials WHERE file_url LIKE $1", [`%${key}%`]);
        if (matResult.rows.length > 0) {
          const mat = matResult.rows[0];
          if (mat.course_id && !mat.is_free) {
            const enrolled = await db.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [userId, mat.course_id]);
            if (enrolled.rows.length === 0) return res.status(403).json({ message: "Enrollment required" });
          }
        } else {
          const lecResult = await db.query("SELECT course_id, is_free_preview FROM lectures WHERE video_url LIKE $1 OR pdf_url LIKE $1", [`%${key}%`]);
          if (lecResult.rows.length > 0) {
            const lec = lecResult.rows[0];
            if (lec.course_id && !lec.is_free_preview) {
              const enrolled = await db.query("SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2 AND (status = 'active' OR status IS NULL)", [userId, lec.course_id]);
              if (enrolled.rows.length === 0) return res.status(403).json({ message: "Enrollment required" });
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

        const stream = obj.Body as any;
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

        const stream = obj.Body as any;
        if (typeof stream.pipe === "function") stream.pipe(res);
        else if (stream.transformToByteArray) {
          const bytes = await stream.transformToByteArray();
          res.end(Buffer.from(bytes));
        } else res.status(500).json({ message: "Cannot stream file" });
      }
    } catch (err: any) {
      console.error("[R2 Proxy] Error:", err?.message || err);
      if (err?.name === "NoSuchKey") return res.status(404).json({ message: "File not found" });
      res.status(500).json({ message: "Failed to fetch file" });
    }
  });
}

