import type { Express, Request, Response } from "express";
import { buildRecordingLectureSectionTitle } from "./recordingSection";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveStreamRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
};

export function registerLiveStreamRoutes({
  app,
  db,
  requireAdmin,
  recomputeAllEnrollmentsProgressForCourse,
}: RegisterLiveStreamRoutesDeps): void {
  app.post("/api/admin/live-classes/:id/stream/create", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res
          .status(500)
          .json({ message: "Cloudflare Stream credentials not configured. Add CF_STREAM_ACCOUNT_ID and CF_STREAM_API_TOKEN to .env" });
      }

      const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const liveClass = lcResult.rows[0];

      if (liveClass.cf_stream_uid) {
        return res.json({
          uid: liveClass.cf_stream_uid,
          rtmpUrl: liveClass.cf_stream_rtmp_url,
          streamKey: liveClass.cf_stream_key,
          playbackHls: liveClass.cf_playback_hls,
        });
      }

      const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          meta: { name: liveClass.title },
          recording: { mode: "automatic", timeoutSeconds: 60 },
        }),
      });

      if (!cfRes.ok) {
        const errBody = await cfRes.text();
        console.error("[CF Stream] Create live input failed:", errBody);
        return res.status(502).json({ message: "Cloudflare Stream API error: " + errBody });
      }

      const cfData = (await cfRes.json()) as any;
      const input = cfData.result;
      const uid = input.uid;
      const rtmpUrl = input.rtmps?.url || "rtmps://live.cloudflare.com:443/live/";
      const streamKey = input.rtmps?.streamKey || uid;
      const playbackHls = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

      const titleResult = await db.query("SELECT title FROM live_classes WHERE id = $1", [req.params.id]);
      const lcTitle = titleResult.rows[0]?.title;
      if (lcTitle) {
        await db.query(
          "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE title = $5",
          [uid, streamKey, rtmpUrl, playbackHls, lcTitle]
        );
      } else {
        await db.query(
          "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE id = $5",
          [uid, streamKey, rtmpUrl, playbackHls, req.params.id]
        );
      }

      console.log(`[CF Stream] Created live input uid=${uid} for live class ${req.params.id}`);
      res.json({ uid, rtmpUrl, streamKey, playbackHls });
    } catch (err: any) {
      console.error("[CF Stream] Create error:", err);
      res.status(500).json({ message: "Failed to create Cloudflare Stream live input" });
    }
  });

  app.get("/api/admin/live-classes/:id/stream/status", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) {
        return res.status(500).json({ message: "Cloudflare Stream credentials not configured" });
      }

      const lcResult = await db.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) return res.status(404).json({ message: "Live class not found" });
      const uid = lcResult.rows[0].cf_stream_uid;
      if (!uid) return res.json({ connected: false, uid: null });

      const cfRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!cfRes.ok) return res.json({ connected: false, uid });

      const cfData = (await cfRes.json()) as any;
      const status = cfData.result?.status;
      res.json({ connected: status?.current?.state === "connected", uid, status: status?.current?.state || "idle" });
    } catch (err) {
      console.error("[CF Stream] Status error:", err);
      res.status(500).json({ message: "Failed to get stream status" });
    }
  });

  app.post("/api/admin/live-classes/:id/stream/end", requireAdmin, async (req: Request, res: Response) => {
    try {
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      if (!accountId || !apiToken) return res.status(500).json({ message: "CF Stream credentials not configured" });

      const lcResult = await db.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      const uid = lcResult.rows[0]?.cf_stream_uid;
      if (!uid) return res.json({ success: true });

      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiToken}` },
      });

      console.log(`[CF Stream] Ended live input uid=${uid}`);
      res.json({ success: true });
    } catch (err) {
      console.error("[CF Stream] End error:", err);
      res.status(500).json({ message: "Failed to end stream" });
    }
  });

  app.post("/api/admin/live-classes/:id/recording", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { recordingUrl, sectionTitle } = req.body;
      if (!recordingUrl) {
        return res.status(400).json({ message: "recordingUrl is required" });
      }

      const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [req.params.id]);
      if (lcResult.rows.length === 0) {
        return res.status(404).json({ message: "Live class not found" });
      }
      const liveClass = lcResult.rows[0];
      const title = liveClass.title as string;

      const peers = await db.query("SELECT * FROM live_classes WHERE title = $1 ORDER BY id", [title]);
      const endedAt = Date.now();
      const lectureIds: number[] = [];

      for (const row of peers.rows) {
        const durationMins = row.started_at
          ? Math.max(1, Math.round((endedAt - Number(row.started_at)) / 60000))
          : 0;
        await db.query(
          `UPDATE live_classes 
         SET recording_url = $1, is_completed = TRUE, is_live = FALSE, ended_at = $2,
             duration_minutes = CASE 
               WHEN started_at IS NOT NULL 
               THEN GREATEST(1, ROUND(($2::bigint - started_at) / 60000.0)::INTEGER)
               ELSE 0
             END
         WHERE id = $3`,
          [recordingUrl, endedAt, row.id]
        );

        if (row.course_id) {
          const maxOrder = await db.query(
            "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
            [row.course_id]
          );
          const recordSection = buildRecordingLectureSectionTitle(
            row.lecture_section_title,
            row.lecture_subfolder_title,
            sectionTitle
          );
          const lectureResult = await db.query(
            `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
            [
              row.course_id,
              row.title,
              row.description || "",
              recordingUrl,
              "r2",
              durationMins,
              maxOrder.rows[0].next_order,
              false,
              recordSection,
              Date.now(),
            ]
          );
          lectureIds.push(lectureResult.rows[0].id);
          await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
            row.course_id,
          ]);
          await recomputeAllEnrollmentsProgressForCourse(row.course_id);
        }
      }

      res.json({ success: true, lectureId: lectureIds[0] ?? null, lectureIds });
    } catch (err) {
      console.error("Recording completion error:", err);
      res.status(500).json({ message: "Failed to save recording" });
    }
  });
}

