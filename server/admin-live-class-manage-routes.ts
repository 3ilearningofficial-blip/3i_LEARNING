import type { Express, Request, Response } from "express";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminLiveClassManageRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getR2Client: () => Promise<any>;
};

export function registerAdminLiveClassManageRoutes({
  app,
  db,
  requireAdmin,
  getR2Client,
}: RegisterAdminLiveClassManageRoutesDeps): void {
  app.post("/api/admin/live-classes/cleanup", requireAdmin, async (_req: Request, res: Response) => {
    try {
      console.log("[Cleanup] Starting live class cleanup...");
      const findResult = await db.query(`
        SELECT id, title FROM live_classes WHERE is_live = true ORDER BY scheduled_at DESC
      `);
      if (findResult.rows.length === 0) {
        return res.json({ success: true, message: "No cleanup needed", cleaned: 0, classes: [] });
      }
      const updateResult = await db.query(`
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

  app.put("/api/admin/live-classes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid } = req.body;
      const updates: string[] = [];
      const params: unknown[] = [];
      const add = (col: string, val: unknown) => {
        params.push(val);
        updates.push(col + " = $" + params.length);
      };
      if (isLive !== undefined) add("is_live", isLive);
      if (isCompleted !== undefined) add("is_completed", isCompleted);
      if (isLive === true) add("started_at", Date.now());
      if (isCompleted === true || isLive === false) add("ended_at", Date.now());
      if (youtubeUrl !== undefined) add("youtube_url", youtubeUrl);
      if (title !== undefined) add("title", title);
      if (description !== undefined) add("description", description);
      if (scheduledAt !== undefined) add("scheduled_at", scheduledAt);
      if (notifyEmail !== undefined) add("notify_email", notifyEmail);
      if (notifyBell !== undefined) add("notify_bell", notifyBell);
      if (isFreePreview !== undefined) add("is_free_preview", isFreePreview);
      if (streamType !== undefined) add("stream_type", streamType);
      if (chatMode !== undefined) add("chat_mode", chatMode);
      if (showViewerCount !== undefined) add("show_viewer_count", showViewerCount);
      if (recordingUrl !== undefined) add("recording_url", recordingUrl);
      if (cfStreamUid !== undefined) add("cf_stream_uid", cfStreamUid);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== undefined) add("is_public", isPublicVal);
      if (updates.length === 0) return res.status(400).json({ message: "No fields to update" });
      params.push(req.params.id);
      const whereIdx = "$" + params.length;
      const sql = "UPDATE live_classes SET " + updates.join(", ") + " WHERE id = " + whereIdx + " RETURNING *";
      const result = await db.query(sql, params);
      const liveClass = result.rows[0];

      if (isLive === true && liveClass.course_id) {
        const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = Date.now() + 12 * 3600000;
        for (const e of enrolled.rows) {
          await db.query("INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
            e.user_id,
            "🔴 Live Class Started!",
            '"' + liveClass.title + '" is live now. Join now!',
            "info",
            Date.now(),
            expiresAt,
          ]);
        }
        console.log("[GoLive] Notification sent for '" + liveClass.title + "' to " + enrolled.rows.length + " students");
      }

      if (isLive === true) {
        const syncUpdates: string[] = [];
        const syncParams: unknown[] = [];
        const syncAdd = (col: string, val: unknown) => {
          syncParams.push(val);
          syncUpdates.push(col + " = $" + syncParams.length);
        };
        syncAdd("is_live", true);
        syncAdd("started_at", Date.now());
        if (youtubeUrl !== undefined) syncAdd("youtube_url", youtubeUrl);
        if (streamType !== undefined) syncAdd("stream_type", streamType);
        if (chatMode !== undefined) syncAdd("chat_mode", chatMode);
        if (showViewerCount !== undefined) syncAdd("show_viewer_count", showViewerCount);
        if (cfStreamUid !== undefined) syncAdd("cf_stream_uid", cfStreamUid);
        const cfStreamKey = (req.body as any).cfStreamKey;
        const cfStreamRtmpUrl = (req.body as any).cfStreamRtmpUrl;
        const cfPlaybackHls = (req.body as any).cfPlaybackHls;
        if (cfStreamKey !== undefined) syncAdd("cf_stream_key", cfStreamKey);
        if (cfStreamRtmpUrl !== undefined) syncAdd("cf_stream_rtmp_url", cfStreamRtmpUrl);
        if (cfPlaybackHls !== undefined) syncAdd("cf_playback_hls", cfPlaybackHls);

        syncParams.push(req.params.id);
        syncParams.push(liveClass.title);
        await db
          .query(
            `UPDATE live_classes SET ${syncUpdates.join(", ")} 
           WHERE id != $${syncParams.length - 1} 
             AND title = $${syncParams.length}
             AND is_completed IS NOT TRUE`,
            syncParams
          )
          .catch(() => {});

        const otherClasses = await db
          .query("SELECT course_id FROM live_classes WHERE id != $1 AND title = $2 AND is_completed IS NOT TRUE AND course_id IS NOT NULL", [req.params.id, liveClass.title])
          .catch(() => ({ rows: [] as any[] }));
        const expiresAt = Date.now() + 12 * 3600000;
        for (const other of otherClasses.rows) {
          const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [other.course_id]).catch(() => ({ rows: [] as any[] }));
          for (const e of enrolled.rows) {
            await db
              .query("INSERT INTO notifications (user_id, title, message, type, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING", [
                e.user_id,
                "🔴 Live Class Started!",
                '"' + liveClass.title + '" is live now. Join now!',
                "info",
                Date.now(),
                expiresAt,
              ])
              .catch(() => {});
          }
        }
      }

      if (isCompleted && convertToLecture && liveClass.youtube_url && liveClass.course_id) {
        await db
          .query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClass.title + '%'])
          .catch(() => {});
        const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [liveClass.course_id]);
        await db.query(
          "INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
          [liveClass.course_id, liveClass.title, liveClass.description || "", liveClass.youtube_url, "youtube", 0, maxOrder.rows[0].next_order, false, sectionTitle || "Live Class Recordings", Date.now()]
        );
        await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [liveClass.course_id]);
      }
      if (isCompleted && !convertToLecture && liveClass.title) {
        await db
          .query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClass.title + '%'])
          .catch(() => {});
      }

      if (isCompleted === true || isLive === false) {
        await db
          .query(
            `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live IS NOT TRUE 
             AND is_completed IS NOT TRUE
             AND title = $2`,
            [req.params.id, liveClass.title]
          )
          .catch(() => {});

        await db
          .query(
            `UPDATE live_classes 
           SET is_completed = TRUE, is_live = FALSE
           WHERE id != $1 
             AND is_live = TRUE
             AND title = $2`,
            [req.params.id, liveClass.title]
          )
          .catch(() => {});
      }

      res.json(liveClass);
    } catch (err) {
      console.error("Update live class error:", err);
      res.status(500).json({ message: "Failed to update live class" });
    }
  });

  app.delete("/api/admin/live-classes/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_classes WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete live class" });
    }
  });

  app.put("/api/admin/study-materials/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { title, description, fileUrl, fileType, isFree, sectionTitle, downloadAllowed } = req.body;
      await db.query(`UPDATE study_materials SET title=$1, description=$2, file_url=$3, file_type=$4, is_free=$5, section_title=$6, download_allowed=$7 WHERE id=$8`, [
        title,
        description || "",
        fileUrl,
        fileType || "pdf",
        isFree || false,
        sectionTitle || null,
        downloadAllowed || false,
        req.params.id,
      ]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to update material" });
    }
  });

  app.delete("/api/admin/study-materials/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const material = await db.query("SELECT file_url, course_id FROM study_materials WHERE id = $1", [req.params.id]);

      if (material.rows.length > 0 && material.rows[0].file_url) {
        try {
          const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
          const r2 = await getR2Client();

          let r2Key = material.rows[0].file_url;
          if (r2Key.startsWith("http")) {
            try {
              const url = new URL(r2Key);
              r2Key = url.pathname.substring(1);
            } catch (_e) {}
          }

          const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: r2Key,
          });

          await r2.send(deleteCommand);
          console.log(`[R2] Deleted study material file: ${r2Key}`);
        } catch (r2Err) {
          console.error("[R2] Failed to delete study material file:", r2Err);
        }
      }

      const courseId = material.rows[0]?.course_id;
      await db.query("DELETE FROM study_materials WHERE id = $1", [req.params.id]);
      if (courseId) {
        await db.query("UPDATE courses SET total_materials = (SELECT COUNT(*) FROM study_materials WHERE course_id = $1) WHERE id = $1", [courseId]);
      }
      res.json({ success: true });
    } catch (err) {
      console.error("Delete study material error:", err);
      res.status(500).json({ message: "Failed to delete material" });
    }
  });
}

