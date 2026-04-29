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
  getR2Client: () => Promise<any>;
};

export function registerLiveStreamRoutes({
  app,
  db,
  requireAdmin,
  recomputeAllEnrollmentsProgressForCourse,
  getR2Client,
}: RegisterLiveStreamRoutesDeps): void {
  const inferVideoType = (url: string): "youtube" | "cloudflare" | "r2" => {
    const lower = String(url || "").toLowerCase();
    if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
    if (lower.includes("videodelivery.net") || lower.endsWith(".m3u8")) return "cloudflare";
    return "r2";
  };
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const extractCloudflareRecordingUid = (url: string): string | null => {
    const m = String(url || "").match(/videodelivery\.net\/([^/]+)\/manifest\/video\.m3u8/i);
    return m?.[1] ? String(m[1]) : null;
  };
  const toMediaApiPath = (key: string): string => `/api/media/${key}`;
  const archiveCloudflareRecordingToR2 = async (recordingUid: string): Promise<string | null> => {
    try {
      if (!process.env.R2_BUCKET_NAME) return null;
      const configuredDownloadBase = String(process.env.CF_STREAM_DOWNLOAD_BASE_URL || "").trim().replace(/\/+$/, "");
      const candidateUrls = [
        `https://videodelivery.net/${recordingUid}/downloads/default.mp4`,
        configuredDownloadBase ? `${configuredDownloadBase}/${recordingUid}/downloads/default.mp4` : "",
      ].filter(Boolean);
      let source: globalThis.Response | null = null;
      let matchedUrl = "";
      for (const candidateUrl of candidateUrls) {
        const resp = await fetch(candidateUrl);
        if (resp.ok && resp.body) {
          source = resp;
          matchedUrl = candidateUrl;
          break;
        }
        console.warn(`[CF Stream] MP4 download not ready/failed for uid=${recordingUid}, status=${resp.status}, url=${candidateUrl}`);
      }
      if (!source || !source.body) return null;
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { Readable } = await import("stream");
      const r2 = await getR2Client();
      const key = `live-class-recording/cloudflare/${Date.now()}-${recordingUid}.mp4`;
      const contentLengthHeader = source.headers.get("content-length");
      const parsedContentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
      const contentLength = Number.isFinite(parsedContentLength) && parsedContentLength > 0
        ? parsedContentLength
        : undefined;
      await r2.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: key,
          Body: Readable.fromWeb(source.body as any),
          ContentType: "video/mp4",
          ...(contentLength ? { ContentLength: contentLength } : {}),
        })
      );
      console.log(`[CF Stream] Archived recording uid=${recordingUid} to R2 from ${matchedUrl || "unknown-source"}`);
      return toMediaApiPath(key);
    } catch (err) {
      console.warn("[CF Stream] Failed to archive recording to R2:", err);
      return null;
    }
  };
  const getLatestRecordingForLiveInput = async (
    accountId: string,
    apiToken: string,
    liveInputUid: string
  ): Promise<{ manifestUrl: string; recordingUid: string } | null> => {
    try {
      const videosRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${liveInputUid}/videos`,
        { headers: { Authorization: `Bearer ${apiToken}` } }
      );
      if (!videosRes.ok) return null;
      const videosData = (await videosRes.json()) as any;
      const raw = videosData?.result;
      const items: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.videos) ? raw.videos : [];
      if (!items.length) return null;
      const ready = items.find((v) => String(v?.status || "").toLowerCase() === "ready") || items[0];
      const recordingUid = ready?.uid || ready?.id;
      if (!recordingUid) return null;
      return {
        manifestUrl: `https://videodelivery.net/${recordingUid}/manifest/video.m3u8`,
        recordingUid: String(recordingUid),
      };
    } catch {
      return null;
    }
  };

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
          // Lower timeout keeps very short classes from lingering too long as "live" after stop.
          recording: { mode: "automatic", timeoutSeconds: 20 },
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

      await db.query(
        "UPDATE live_classes SET cf_stream_uid = $1, cf_stream_key = $2, cf_stream_rtmp_url = $3, cf_playback_hls = $4 WHERE id = $5",
        [uid, streamKey, rtmpUrl, playbackHls, req.params.id]
      );

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
      if (!process.env.R2_BUCKET_NAME) return res.status(500).json({ message: "R2 bucket is not configured" });

      const lcResult = await db.query("SELECT cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      const uid = lcResult.rows[0]?.cf_stream_uid;
      const endedAtNow = Date.now();
      await db.query(
        "UPDATE live_classes SET is_live = FALSE, ended_at = COALESCE(ended_at, $1), is_completed = TRUE WHERE id = $2",
        [endedAtNow, req.params.id]
      ).catch(() => {});
      if (!uid) return res.json({ success: true });

      const getLatestRecording = async (): Promise<{ manifestUrl: string; recordingUid: string } | null> =>
        getLatestRecordingForLiveInput(accountId, apiToken, uid);

      // Cloudflare may need time to finalize VOD after stream stop.
      let recordingUrl: string | null = null;
      for (let i = 0; i < 18; i += 1) {
        const latest = await getLatestRecording();
        if (latest) {
          const archived = await archiveCloudflareRecordingToR2(latest.recordingUid);
          recordingUrl = archived || latest.manifestUrl;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      // Delete live input after recording lookup attempt (best effort).
      await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiToken}` },
      }).catch(() => {});

      console.log(`[CF Stream] Ended live input uid=${uid}`);
      res.json({ success: true, recordingUrl });
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
      const lectureIds: number[] = [];

      for (const row of peers.rows) {
        const endedAt = Number(row.ended_at || Date.now());
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
              inferVideoType(recordingUrl),
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

  let isArchiveSweepRunning = false;
  const runArchiveSweep = async () => {
    if (isArchiveSweepRunning) return;
    isArchiveSweepRunning = true;
    try {
      const pending = await db.query(
        `SELECT id, title, description, course_id, started_at, lecture_section_title, lecture_subfolder_title, recording_url, cf_stream_uid
         FROM live_classes
         WHERE stream_type = 'cloudflare'
           AND is_completed = TRUE
           AND (recording_url IS NULL OR recording_url ILIKE 'https://videodelivery.net/%/manifest/video.m3u8')
         ORDER BY ended_at DESC NULLS LAST
         LIMIT 20`
      );
      const accountId = process.env.CF_STREAM_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
      const apiToken = process.env.CF_STREAM_API_TOKEN;
      for (const row of pending.rows) {
        const currentUrl = String(row.recording_url || "").trim();
        let recordingUid = extractCloudflareRecordingUid(currentUrl);
        if (!recordingUid && accountId && apiToken && row.cf_stream_uid) {
          const latest = await getLatestRecordingForLiveInput(accountId, apiToken, String(row.cf_stream_uid));
          recordingUid = latest?.recordingUid || null;
        }
        if (recordingUid && currentUrl) {
          const head = await fetch(`https://videodelivery.net/${recordingUid}/manifest/video.m3u8`, { method: "HEAD" }).catch(() => null as any);
          if (!head || !head.ok) {
            // Saved UID can be the live input uid; resolve the true recording uid through Cloudflare API.
            if (accountId && apiToken && row.cf_stream_uid) {
              const latest = await getLatestRecordingForLiveInput(accountId, apiToken, String(row.cf_stream_uid));
              recordingUid = latest?.recordingUid || recordingUid;
            }
          }
        }
        if (!recordingUid) continue;
        const archivedUrl = await archiveCloudflareRecordingToR2(recordingUid);
        if (!archivedUrl) continue;
        await db.query("UPDATE live_classes SET recording_url = $1 WHERE id = $2", [archivedUrl, row.id]);
        const patchedLecture = await db.query(
          "UPDATE lectures SET video_url = $1, video_type = 'r2' WHERE title = $2 AND video_url = $3",
          [archivedUrl, row.title, currentUrl]
        ).catch(() => {});
        if (row.course_id) {
          const updatedRows = Array.isArray((patchedLecture as any)?.rows) ? (patchedLecture as any).rows.length : 0;
          if (updatedRows === 0) {
            const maxOrder = await db.query(
              "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
              [row.course_id]
            );
            const durationMins = row.started_at
              ? Math.max(1, Math.round((Date.now() - Number(row.started_at)) / 60000))
              : 0;
            const sectionTitle = buildRecordingLectureSectionTitle(
              row.lecture_section_title,
              row.lecture_subfolder_title,
              undefined
            );
            await db.query(
              `INSERT INTO lectures (course_id, title, description, video_url, video_type, duration_minutes, order_index, is_free_preview, section_title, created_at)
               SELECT $1, $2, $3, $4, 'r2', $5, $6, FALSE, $7, $8
               WHERE NOT EXISTS (
                 SELECT 1 FROM lectures
                 WHERE course_id = $1 AND title = $2 AND video_url = $4
               )`,
              [
                row.course_id,
                row.title,
                row.description || "",
                archivedUrl,
                durationMins,
                maxOrder.rows[0].next_order,
                sectionTitle,
                Date.now(),
              ]
            );
            await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
              row.course_id,
            ]).catch(() => {});
            await recomputeAllEnrollmentsProgressForCourse(row.course_id).catch(() => {});
          }
        }
        console.log(`[CF Stream] Archived fallback recording to R2 for live class ${row.id}`);
        await sleep(250);
      }
    } catch (err) {
      console.warn("[CF Stream] Archive sweep error:", err);
    } finally {
      isArchiveSweepRunning = false;
    }
  };
  const runArchiveSweepWorker = process.env.RUN_BACKGROUND_SCHEDULERS !== "false";
  if (runArchiveSweepWorker) {
    const sweepIntervalMs = Math.max(30000, Number(process.env.CF_ARCHIVE_SWEEP_MS || 120000));
    void runArchiveSweep();
    setInterval(() => {
      void runArchiveSweep();
    }, sweepIntervalMs);
    console.log(`[CF Stream] Archive sweep started — every ${sweepIntervalMs}ms`);
  } else {
    console.log("[CF Stream] Archive sweep disabled (RUN_BACKGROUND_SCHEDULERS=false)");
  }
}

