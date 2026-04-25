import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminLectureRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getR2Client: () => Promise<any>;
};

export function registerAdminLectureRoutes({
  app,
  db,
  requireAdmin,
  getR2Client,
}: RegisterAdminLectureRoutesDeps): void {
  app.post("/api/admin/lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { courseId, title, description, videoUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } =
        req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId)) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      if (!title || !String(title).trim()) {
        return res.status(400).json({ message: "Lecture title is required" });
      }
      if (!videoUrl && !pdfUrl) {
        return res.status(400).json({ message: "Either videoUrl or pdfUrl is required" });
      }
      const result = await db.query(
        `INSERT INTO lectures (course_id, title, description, video_url, video_type, pdf_url, duration_minutes, order_index, is_free_preview, section_title, download_allowed, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [
          parsedCourseId,
          String(title).trim(),
          description,
          videoUrl || null,
          videoType || "youtube",
          pdfUrl || null,
          Number(durationMinutes) || 0,
          Number(orderIndex) || 0,
          isFreePreview || false,
          sectionTitle || null,
          downloadAllowed || false,
          Date.now(),
        ]
      );
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Failed to add lecture", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });

  app.put("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, videoUrl, videoType, durationMinutes, orderIndex, isFreePreview, sectionTitle, downloadAllowed } = req.body;
      await db.query(
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
          req.params.id,
        ]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update lecture" });
    }
  });

  app.delete("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const lec = await db.query("SELECT course_id, video_url FROM lectures WHERE id = $1", [req.params.id]);

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
                // keep original if URL parsing fails
              }
            }

            const deleteCommand = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key,
            });

            await r2.send(deleteCommand);
            console.log(`[R2] Deleted lecture file: ${r2Key}`);
          } catch (r2Err) {
            console.error("[R2] Failed to delete lecture file:", r2Err);
          }
        }

        await db.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
          lecture.course_id,
        ]);
      }

      res.json({ success: true });
    } catch (err) {
      console.error("Delete lecture error:", err);
      res.status(500).json({ message: "Failed to delete lecture" });
    }
  });
}

