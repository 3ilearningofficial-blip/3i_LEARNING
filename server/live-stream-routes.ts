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
  const archiveRetryState = new Map<
    string,
    { attempts: number; nextAttemptAt: number; lastStatus: number | null }
  >();

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
      const now = Date.now();
      const retryState = archiveRetryState.get(recordingUid);
      if (retryState && retryState.nextAttemptAt > now) {
        return null;
      }
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
          archiveRetryState.delete(recordingUid);
          break;
        }
        const prev = archiveRetryState.get(recordingUid) || { attempts: 0, nextAttemptAt: 0, lastStatus: null };
        const attempts = prev.attempts + 1;
        const backoffMs = Math.min(6 * 60 * 60 * 1000, Math.max(2 * 60 * 1000, attempts * 10 * 60 * 1000));
        archiveRetryState.set(recordingUid, {
          attempts,
          nextAttemptAt: Date.now() + backoffMs,
          lastStatus: resp.status,
        });
        if (attempts === 1 || attempts % 10 === 0) {
          console.warn(
            `[CF Stream] MP4 not ready uid=${recordingUid} status=${resp.status} attempt=${attempts} nextRetryInMs=${backoffMs}`
          );
        }
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
  const normalizeCfVideoItems = (payload: any): any[] => {
    const raw = payload?.result;
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.videos)) return raw.videos;
    if (Array.isArray(payload?.videos)) return payload.videos;
    return [];
  };

  const pickBestCfRecording = (items: any[], excludeUid?: string): { manifestUrl: string; recordingUid: string } | null => {
    if (!items.length) return null;
    const filtered = items.filter((v) => {
      const id = String(v?.uid || v?.id || "");
      return id && (!excludeUid || id !== excludeUid);
    });
    const pool = filtered.length ? filtered : items;
    const statusRank = (s: string) => {
      const x = String(s || "").toLowerCase();
      if (x === "ready") return 0;
      if (x.includes("progress") || x === "queued" || x === "downloading") return 1;
      return 2;
    };
    const sorted = [...pool].sort((a, b) => {
      const ra = statusRank(a?.status);
      const rb = statusRank(b?.status);
      if (ra !== rb) return ra - rb;
      const ta = Number(a?.modified || a?.created || 0);
      const tb = Number(b?.modified || b?.created || 0);
      return tb - ta;
    });
    const ready = sorted.find((v) => String(v?.status || "").toLowerCase() === "ready") || sorted[0];
    const recordingUid = String(ready?.uid || ready?.id || "").trim();
    if (!recordingUid || recordingUid === excludeUid) return null;
    return {
      manifestUrl: `https://videodelivery.net/${recordingUid}/manifest/video.m3u8`,
      recordingUid,
    };
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
      if (!videosRes.ok) {
        const txt = await videosRes.text().catch(() => "");
        console.warn("[CF Stream] live_inputs/.../videos HTTP", videosRes.status, txt.slice(0, 280));
        return null;
      }
      const videosData = (await videosRes.json()) as any;
      const items = normalizeCfVideoItems(videosData);
      if (!items.length) return null;
      return pickBestCfRecording(items, liveInputUid);
    } catch {
      return null;
    }
  };

  /** If live-input polling is empty/delayed, find the asset by dashboard title / meta.name (still scoped by search). */
  const findRecordingViaStreamSearch = async (
    accountId: string,
    apiToken: string,
    liveClassTitle: string,
    excludeLiveInputUid: string
  ): Promise<{ manifestUrl: string; recordingUid: string } | null> => {
    const q = String(liveClassTitle || "").trim();
    if (q.length < 2) return null;
    try {
      const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`);
      u.searchParams.set("search", q);
      u.searchParams.set("limit", "40");
      const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${apiToken}` } });
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      const items = normalizeCfVideoItems(data);
      const qLow = q.toLowerCase();
      const matched = items.filter((v: any) => {
        const id = String(v?.uid || v?.id || "");
        if (!id || id === excludeLiveInputUid) return false;
        const metaName = String(v?.meta?.name || "").trim().toLowerCase();
        const nameField = String(v?.name || "").trim().toLowerCase();
        if (metaName && metaName === qLow) return true;
        if (nameField && nameField === qLow) return true;
        return metaName.includes(qLow) || nameField.includes(qLow);
      });
      const pool = matched.length ? matched : items.filter((v: any) => String(v?.uid || "") && String(v.uid) !== excludeLiveInputUid);
      return pickBestCfRecording(pool, excludeLiveInputUid);
    } catch {
      return null;
    }
  };
  const saveRecordingForClassAndPeers = async (
    liveClassId: string,
    recordingUrl: string,
    sectionTitle?: string
  ): Promise<{ lectureId: number | null; lectureIds: number[] }> => {
    const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
    if (lcResult.rows.length === 0) {
      throw new Error("Live class not found");
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

      if (!row.course_id) continue;
      const maxOrder = await db.query(
        "SELECT COALESCE(MAX(order_index), 0) + 1 as next_order FROM lectures WHERE course_id = $1",
        [row.course_id]
      );
      const recordSection = buildRecordingLectureSectionTitle(
        row.lecture_section_title,
        row.lecture_subfolder_title,
        sectionTitle
      );
      const existingLecture = await db.query(
        "SELECT id FROM lectures WHERE course_id = $1 AND title = $2 AND video_url = $3 LIMIT 1",
        [row.course_id, row.title, recordingUrl]
      );
      if (existingLecture.rows.length > 0) {
        lectureIds.push(Number(existingLecture.rows[0].id));
      } else {
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
      }
      await db.query("UPDATE courses SET total_lectures = (SELECT COUNT(*) FROM lectures WHERE course_id = $1) WHERE id = $1", [
        row.course_id,
      ]);
      await recomputeAllEnrollmentsProgressForCourse(row.course_id);
    }

    return { lectureId: lectureIds[0] ?? null, lectureIds };
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
      // R2 is optional: we always persist Cloudflare HLS when MP4 archival is unavailable.

      const lcResult = await db.query("SELECT id, title, cf_stream_uid FROM live_classes WHERE id = $1", [req.params.id]);
      const uid = lcResult.rows[0]?.cf_stream_uid;
      const liveTitle = String(lcResult.rows[0]?.title || "").trim();
      const endedAtNow = Date.now();
      await db.query(
        "UPDATE live_classes SET is_live = FALSE, ended_at = COALESCE(ended_at, $1), is_completed = TRUE WHERE id = $2",
        [endedAtNow, req.params.id]
      ).catch(() => {});
      if (!uid) return res.json({ success: true });

      const getLatestRecording = async (): Promise<{ manifestUrl: string; recordingUid: string } | null> =>
        getLatestRecordingForLiveInput(accountId, apiToken, uid);

      // Cloudflare needs time to finalize VOD — poll longer before falling back / deleting input.
      let recordingUrl: string | null = null;
      const maxPolls = Number(process.env.CF_STREAM_END_MAX_POLLS || 48);
      const pollMs = Number(process.env.CF_STREAM_END_POLL_MS || 5000);
      for (let i = 0; i < maxPolls; i += 1) {
        const latest = await getLatestRecording();
        if (latest) {
          const archived = await archiveCloudflareRecordingToR2(latest.recordingUid);
          recordingUrl = archived || latest.manifestUrl;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      if (!recordingUrl && liveTitle) {
        const viaSearch = await findRecordingViaStreamSearch(accountId, apiToken, liveTitle, uid);
        if (viaSearch) {
          const archived = await archiveCloudflareRecordingToR2(viaSearch.recordingUid);
          recordingUrl = archived || viaSearch.manifestUrl;
          console.log(`[CF Stream] Resolved recording via stream search title="${liveTitle.slice(0, 60)}"`);
        }
      }

      if (recordingUrl) {
        try {
          await saveRecordingForClassAndPeers(String(req.params.id), recordingUrl);
        } catch (saveErr) {
          console.warn("[CF Stream] recording save after stream end failed:", saveErr);
        }
      } else {
        console.warn(
          `[CF Stream] No recording URL after end for live_class=${req.params.id} live_input_uid=${uid}. Leaving live_input in place for retry/archive sweep.`
        );
      }

      // Delete live input only after we attached a playable URL — otherwise admins can retry "end"
      // and archive sweep still has cf_stream_uid to resolve MP4/HLS later.
      if (recordingUrl) {
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${uid}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${apiToken}` },
        }).catch(() => {});
      }

      console.log(`[CF Stream] Ended live input uid=${uid} saved=${Boolean(recordingUrl)}`);
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
      const { lectureId, lectureIds } = await saveRecordingForClassAndPeers(
        String(req.params.id),
        String(recordingUrl),
        sectionTitle
      );
      res.json({ success: true, lectureId, lectureIds });
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
           AND ended_at IS NOT NULL
           AND ended_at > (EXTRACT(EPOCH FROM NOW()) * 1000 - 14 * 24 * 60 * 60 * 1000)
           AND (recording_url IS NULL OR recording_url ILIKE 'https://videodelivery.net/%/manifest/video.m3u8')
         ORDER BY ended_at DESC NULLS LAST
         LIMIT 8`
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

