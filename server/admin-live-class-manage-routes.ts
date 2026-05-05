import type { Express, Request, Response } from "express";
import { buildRecordingLectureSectionTitle } from "./recordingSection";
import { sendPushToUsers } from "./push-notifications";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminLiveClassManageRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getR2Client: () => Promise<any>;
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
};

export function registerAdminLiveClassManageRoutes({
  app,
  db,
  requireAdmin,
  getR2Client,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterAdminLiveClassManageRoutesDeps): void {
  const inferVideoType = (url: string): "youtube" | "cloudflare" | "r2" => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };

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
      const { isLive, isCompleted, youtubeUrl, title, description, convertToLecture, sectionTitle, scheduledAt, notifyEmail, notifyBell, isFreePreview, streamType, chatMode, showViewerCount, recordingUrl, cfStreamUid, lectureSectionTitle, lectureSubfolderTitle } = req.body;
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
      if (lectureSectionTitle !== undefined) add("lecture_section_title", typeof lectureSectionTitle === "string" && lectureSectionTitle.trim() === "" ? null : lectureSectionTitle);
      if (lectureSubfolderTitle !== undefined) add("lecture_subfolder_title", typeof lectureSubfolderTitle === "string" && lectureSubfolderTitle.trim() === "" ? null : lectureSubfolderTitle);
      const { isPublic: isPublicVal } = req.body;
      if (isPublicVal !== undefined) add("is_public", isPublicVal);
      if (updates.length === 0) {
        // "Save as Lecture" may send only { convertToLecture: true } — allow without a no-op column write.
        if (convertToLecture === true) {
          const only = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
          if (only.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
          const liveClassOnly = only.rows[0];
          const st = sectionTitle;
          const canConvert =
            liveClassOnly.is_completed === true &&
            !!(liveClassOnly.youtube_url || liveClassOnly.recording_url || liveClassOnly.cf_playback_hls);
          if (!canConvert) {
            return res.status(400).json({ message: "Class must be completed with a YouTube, Cloudflare, or R2 recording URL to save as a lecture." });
          }
          await db
            .query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClassOnly.title + '%'])
            .catch(() => {});
          const sameTitle = await db.query("SELECT * FROM live_classes WHERE title = $1", [liveClassOnly.title]);
          for (const peer of sameTitle.rows) {
            if (!peer.course_id) continue;
            const urlForPeer = String(
              peer.recording_url ||
              peer.cf_playback_hls ||
              peer.youtube_url ||
              liveClassOnly.recording_url ||
              liveClassOnly.cf_playback_hls ||
              liveClassOnly.youtube_url ||
              ""
            ).trim();
            if (!urlForPeer) continue;
            const vType = inferVideoType(urlForPeer);
            const exists = await db.query(
              "SELECT 1 FROM lectures WHERE course_id = $1 AND title = $2 AND video_url = $3 LIMIT 1",
              [peer.course_id, peer.title, urlForPeer]
            );
            if (exists.rows.length > 0) continue;
            const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [peer.course_id]);
            const durationMins =
              peer.started_at && peer.ended_at
                ? Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 60000))
                : peer.duration_minutes != null
                  ? Number(peer.duration_minutes)
                  : liveClassOnly.duration_minutes != null
                    ? Number(liveClassOnly.duration_minutes)
                    : 0;
            const sectionForLecture = buildRecordingLectureSectionTitle(
              peer.lecture_section_title,
              peer.lecture_subfolder_title,
              st
            );
            await db.query(
              "INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
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
                Date.now(),
              ]
            );
            await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [peer.course_id]);
            await recomputeAllEnrollmentsProgressForCourse(peer.course_id);
          }
          return res.json(liveClassOnly);
        }
        return res.status(400).json({ message: "No fields to update" });
      }
      params.push(req.params.id);
      const whereIdx = "$" + params.length;
      const sql = "UPDATE live_classes SET " + updates.join(", ") + " WHERE id = " + whereIdx + " RETURNING *";
      const result = await db.query(sql, params);
      const liveClass = result.rows[0];

      if (isLive === true && liveClass.course_id) {
        const recipients =
          (liveClass.is_free_preview === true || liveClass.is_public === true)
            ? await db.query("SELECT id AS user_id FROM users WHERE role = 'student'")
            : await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [liveClass.course_id]);
        const expiresAt = Date.now() + 6 * 3600000;
        const recipientIds = recipients.rows.map((e: any) => Number(e.user_id));
        const notifTitle = "🔴 Live Class Started!";
        const notifMessage = '"' + liveClass.title + '" is live now. Join now!';
        const now = Date.now();
        if (recipientIds.length > 0) {
          await db
            .query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
               FROM unnest($1::int[]) AS u`,
              [recipientIds, notifTitle, notifMessage, now, expiresAt]
            )
            .catch(() => {});
        }
        await sendPushToUsers(db, recipientIds, {
          title: "🔴 Live Class Started!",
          body: `"${liveClass.title}" is live now. Join now!`,
          data: { type: "live_class_started", liveClassId: liveClass.id, courseId: liveClass.course_id || null },
        });
        console.log("[GoLive] Notification sent for '" + liveClass.title + "' to " + recipients.rows.length + " students");
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
        const peerExpiresAt = Date.now() + 12 * 3600000;
        const extraRecipients = new Set<number>();
        for (const other of otherClasses.rows) {
          const enrolled = await db.query("SELECT user_id FROM enrollments WHERE course_id = $1", [other.course_id]).catch(() => ({ rows: [] as any[] }));
          for (const e of enrolled.rows) {
            extraRecipients.add(Number(e.user_id));
          }
        }
        const peerNotifTitle = "🔴 Live Class Started!";
        const peerNotifMessage = '"' + liveClass.title + '" is live now. Join now!';
        const peerNow = Date.now();
        if (extraRecipients.size > 0) {
          const peerIds = [...extraRecipients];
          await db
            .query(
              `INSERT INTO notifications (user_id, title, message, type, created_at, expires_at)
               SELECT u, $2::text, $3::text, 'info', $4::bigint, $5::bigint
               FROM unnest($1::int[]) AS u`,
              [peerIds, peerNotifTitle, peerNotifMessage, peerNow, peerExpiresAt]
            )
            .catch(() => {});
          await sendPushToUsers(db, peerIds, {
            title: "🔴 Live Class Started!",
            body: `"${liveClass.title}" is live now. Join now!`,
            data: { type: "live_class_started", liveClassId: liveClass.id, courseId: liveClass.course_id || null },
          });
        }
      }

      // "Save as Lecture" from admin: was broken when class was already completed because the handler only
      // ran when `isCompleted` was sent in the same PUT body. Also allow `recording_url` (R2) when youtube_url is empty.
      // Auto-publish recording into course lectures whenever class is completed.
      // Explicit convertToLecture still works, but completion should no longer depend on manual action.
      const shouldConvertToLecture =
        (convertToLecture === true || isCompleted === true || isLive === false || liveClass.is_completed === true) &&
        (isCompleted === true || liveClass.is_completed === true) &&
        (liveClass.youtube_url || liveClass.recording_url || liveClass.cf_playback_hls);
      if (shouldConvertToLecture) {
        await db
          .query("DELETE FROM notifications WHERE title IN ('🔴 Live Class Started!', '🔴 Live Class Starting Now!', '⏰ Live Class in 30 minutes!') AND message ILIKE $1", ['%' + liveClass.title + '%'])
          .catch(() => {});
        const sameTitle = await db.query("SELECT * FROM live_classes WHERE title = $1", [liveClass.title]);
        for (const peer of sameTitle.rows) {
          if (!peer.course_id) continue;
          const urlForPeer = String(
            peer.recording_url ||
            peer.cf_playback_hls ||
            peer.youtube_url ||
            liveClass.recording_url ||
            liveClass.cf_playback_hls ||
            liveClass.youtube_url ||
            ""
          ).trim();
          if (!urlForPeer) continue;
          const vType = inferVideoType(urlForPeer);
          const exists = await db.query(
            "SELECT 1 FROM lectures WHERE course_id = $1 AND title = $2 AND video_url = $3 LIMIT 1",
            [peer.course_id, peer.title, urlForPeer]
          );
          if (exists.rows.length > 0) continue;
          const maxOrder = await db.query("SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1", [peer.course_id]);
          const durationMins =
            peer.started_at && peer.ended_at
              ? Math.max(1, Math.round((Number(peer.ended_at) - Number(peer.started_at)) / 60000))
              : peer.duration_minutes != null
                ? Number(peer.duration_minutes)
                : liveClass.duration_minutes != null
                  ? Number(liveClass.duration_minutes)
                  : 0;
          const targetSection = buildRecordingLectureSectionTitle(
            peer.lecture_section_title,
            peer.lecture_subfolder_title,
            sectionTitle
          );
          await db.query(
            "INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            [
              peer.course_id,
              peer.title,
              peer.description || "",
              urlForPeer,
              vType,
              durationMins,
              maxOrder.rows[0].next_order,
              false,
              targetSection,
              Date.now(),
            ]
          );
          await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [peer.course_id]);
          await recomputeAllEnrollmentsProgressForCourse(peer.course_id);
        }
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

