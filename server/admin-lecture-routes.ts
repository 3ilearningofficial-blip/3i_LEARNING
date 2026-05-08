import type { Express, Request, Response } from "express";
import { withTimeout } from "./async-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminLectureRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getR2Client: () => Promise<any>;
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
};

export function registerAdminLectureRoutes({
  app,
  db,
  requireAdmin,
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterAdminLectureRoutesDeps): void {
  const normalizeSectionSegments = (value: unknown): string[] =>
    String(value || "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

  const resolveLectureSectionTitle = (
    sectionTitle: unknown,
    subfolderTitle: unknown,
  ): string | null => {
    const mainSeg = normalizeSectionSegments(sectionTitle);
    const subSeg = normalizeSectionSegments(subfolderTitle);
    if (!mainSeg.length && !subSeg.length) return null;
    if (!subSeg.length) return mainSeg.join(" / ") || null;
    if (!mainSeg.length) return subSeg.join(" / ");

    // If subfolder is same as the tail of main path, keep main (avoid duplicate nesting).
    const mainTail = mainSeg.slice(-subSeg.length).join(" / ");
    const subPath = subSeg.join(" / ");
    if (mainTail === subPath) return mainSeg.join(" / ");

    // If subfolder contains the full main path, trust it as full absolute path.
    const subHead = subSeg.slice(0, mainSeg.length).join(" / ");
    if (subHead === mainSeg.join(" / ")) return subSeg.join(" / ");

    return [...mainSeg, ...subSeg].join(" / ");
  };

  const inferLectureVideoType = (url: string): string => {
    const u = (url || "").trim().toLowerCase();
    if (!u) return "youtube";
    if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
    if (u.includes("drive.google.com")) return "gdrive";
    if (u.includes("/api/media/") || u.includes("r2.dev") || u.includes("cdn.") || u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".mkv")) return "r2";
    return "upload";
  };

  app.post("/api/admin/lectures", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { courseId, title, description, videoUrl, fileUrl, videoType, pdfUrl, durationMinutes, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed } =
        req.body;
      const parsedCourseId = Number(courseId);
      if (!Number.isFinite(parsedCourseId) || parsedCourseId <= 0) {
        return res.status(400).json({ message: "Invalid courseId" });
      }
      const courseCheck = await db.query("SELECT id FROM courses WHERE id = $1 LIMIT 1", [parsedCourseId]);
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
        lectureSubfolderTitle,
      );
      const result = await db.query(
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
          normalizedSectionTitle,
          downloadAllowed || false,
          Date.now(),
        ]
      );
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [parsedCourseId]);
      await recomputeAllEnrollmentsProgressForCourse(parsedCourseId);
      res.json(result.rows[0]);
    } catch (err) {
      console.error("[AdminLectures] create failed", {
        body: {
          courseId: req.body?.courseId,
          title: req.body?.title,
          videoType: req.body?.videoType,
          hasVideoUrl: !!req.body?.videoUrl,
          hasFileUrl: !!req.body?.fileUrl,
          hasPdfUrl: !!req.body?.pdfUrl,
        },
        error: err instanceof Error ? err.message : err,
      });
      res.status(500).json({ message: "Failed to add lecture", detail: err instanceof Error ? err.message : "unknown_error" });
    }
  });

  app.put("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, videoUrl, videoType, durationMinutes, orderIndex, isFreePreview, sectionTitle, lectureSubfolderTitle, downloadAllowed } = req.body;
      const normalizedSectionTitle = resolveLectureSectionTitle(
        sectionTitle,
        lectureSubfolderTitle,
      );
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
          normalizedSectionTitle,
          downloadAllowed || false,
          req.params.id,
        ]
      );
      const row = await db.query("SELECT course_id FROM lectures WHERE id = $1 LIMIT 1", [req.params.id]);
      if (row.rows[0]?.course_id) {
        await recomputeAllEnrollmentsProgressForCourse(row.rows[0].course_id);
      }
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update lecture" });
    }
  });

  app.delete("/api/admin/lectures/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      // Try to also surface live_class_id so we can mark the parent live class as
      // "recording deleted" (prevents the async finalize / archive sweep from re-creating
      // the lecture a few seconds after the admin removes it). The column may not yet exist
      // on older deployments, so fall back to the legacy projection.
      let lec: { rows: any[] };
      try {
        lec = await db.query(
          "SELECT course_id, video_url, live_class_id FROM lectures WHERE id = $1",
          [req.params.id],
        );
      } catch (_err) {
        lec = await db.query(
          "SELECT course_id, video_url FROM lectures WHERE id = $1",
          [req.params.id],
        );
      }

      if (lec.rows.length === 0) {
        return res.json({ success: true });
      }

      const lecture = lec.rows[0];

      // 1) Hard-delete from DB first. R2 cleanup runs after the response so a slow
      //    object-store call never holds the request long enough for the upstream
      //    proxy to return its own 504 (which would strip CORS headers).
      await db.query("DELETE FROM lectures WHERE id = $1", [req.params.id]);
      await db.query(
        "UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1",
        [lecture.course_id],
      );
      await recomputeAllEnrollmentsProgressForCourse(lecture.course_id);

      // 2) If this lecture was created from a live class, tombstone the live class so
      //    the async VOD finalize loop / archive sweep does not re-insert it.
      if (lecture.live_class_id) {
        try {
          await db.query(
            "UPDATE live_classes SET recording_deleted_at = $1 WHERE id = $2",
            [Date.now(), lecture.live_class_id],
          );
        } catch (markErr) {
          // Column may not exist on older schemas; the migration adds it.
          console.warn(
            "[AdminLectures] could not mark live_classes.recording_deleted_at:",
            markErr instanceof Error ? markErr.message : markErr,
          );
        }
      }

      res.json({ success: true });

      // 3) Fire-and-forget R2 cleanup, bounded by a short timeout.
      if (lecture.video_url && typeof lecture.video_url === "string") {
        void (async () => {
          try {
            const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
            const r2 = await getR2Client();

            let r2Key: string = lecture.video_url;
            if (r2Key.startsWith("http")) {
              try {
                const url = new URL(r2Key);
                r2Key = url.pathname.replace(/^\/+/, "");
              } catch (_e) {
                // keep original if URL parsing fails
              }
            }

            const deleteCommand = new DeleteObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: r2Key,
            });

            await withTimeout(r2.send(deleteCommand), 4000, "R2 delete timed out");
            console.log(`[R2] Deleted lecture file: ${r2Key}`);
          } catch (r2Err) {
            console.error(
              "[R2] Failed to delete lecture file (non-fatal):",
              r2Err instanceof Error ? r2Err.message : r2Err,
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

