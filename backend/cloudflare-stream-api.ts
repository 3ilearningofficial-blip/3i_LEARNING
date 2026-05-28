/**
 * Shared Cloudflare Stream API helpers.
 *
 * Used by:
 *  - live-stream-routes.ts   (inline recording archival on class end)
 *  - schedulers.ts           (CFSR-03: finalize-queue webhook-miss fallback)
 *
 * Credentials are read from env:
 *   CF_STREAM_ACCOUNT_ID
 *   CF_STREAM_API_TOKEN
 */

// ─── Types ────────────────────────────────────────────────────────────────

export interface CfRecording {
  /** Cloudflare Stream video UID */
  recordingUid: string;
  /** HLS manifest URL — always available once the recording is ready */
  manifestUrl: string;
  /** Cloudflare processing status ("ready", "queued", "inprogress", …) */
  status: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function normalizeCfVideoItems(payload: unknown): unknown[] {
  const raw = (payload as any)?.result;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray((raw as any)?.videos)) return (raw as any).videos;
  if (Array.isArray((payload as any)?.videos)) return (payload as any).videos;
  return [];
}

function pickBestCfRecording(
  items: unknown[],
  excludeUid?: string
): CfRecording | null {
  if (!items.length) return null;
  const filtered = items.filter((v) => {
    const id = String((v as any)?.uid || (v as any)?.id || "");
    return id && (!excludeUid || id !== excludeUid);
  });
  const pool = filtered.length ? filtered : items;

  const statusRank = (s: string): number => {
    const x = String(s || "").toLowerCase();
    if (x === "ready") return 0;
    if (x === "inprogress" || x.includes("progress") || x === "queued" || x === "downloading") return 1;
    return 2;
  };
  const sorted = [...pool].sort((a, b) => {
    const ra = statusRank((a as any)?.status);
    const rb = statusRank((b as any)?.status);
    if (ra !== rb) return ra - rb;
    const ta = Number((a as any)?.modified || (a as any)?.created || 0);
    const tb = Number((b as any)?.modified || (b as any)?.created || 0);
    return tb - ta;
  });

  const best = sorted[0] as any;
  const recordingUid = String(best?.uid || best?.id || "").trim();
  if (!recordingUid || recordingUid === excludeUid) return null;
  return {
    recordingUid,
    manifestUrl: `https://videodelivery.net/${recordingUid}/manifest/video.m3u8`,
    status: String(best?.status || "unknown"),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * List recording videos for a Cloudflare Stream live input and return the
 * best candidate (newest "ready" recording, falling back to most-recent).
 *
 * Returns null on API error or when no recordings exist yet.
 */
export async function getLatestRecordingForLiveInput(
  accountId: string,
  apiToken: string,
  liveInputUid: string
): Promise<CfRecording | null> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/live_inputs/${liveInputUid}/videos`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) {
      console.warn("[CF Stream API] live_inputs videos HTTP", res.status);
      return null;
    }
    const data = await res.json();
    const items = normalizeCfVideoItems(data);
    if (!items.length) return null;
    return pickBestCfRecording(items, liveInputUid);
  } catch {
    return null;
  }
}

/**
 * Fetch a specific Cloudflare Stream video by its UID.
 * Returns null if not found or not yet ready.
 */
export async function getCfVideoByUid(
  accountId: string,
  apiToken: string,
  videoUid: string
): Promise<CfRecording | null> {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}`,
      { headers: { Authorization: `Bearer ${apiToken}` } }
    );
    if (!res.ok) {
      console.warn("[CF Stream API] get video HTTP", res.status, `uid=${videoUid}`);
      return null;
    }
    const data = (await res.json()) as any;
    const vid = data?.result;
    const uid = String(vid?.uid || "").trim();
    if (!uid) return null;
    return {
      recordingUid: uid,
      manifestUrl: `https://videodelivery.net/${uid}/manifest/video.m3u8`,
      status: String(vid?.status?.state || vid?.status || "unknown"),
    };
  } catch {
    return null;
  }
}

/**
 * Search Cloudflare Stream by title substring and return the best match.
 * Used as last-resort fallback when neither liveInputUid nor recordingUid are known.
 */
export async function findRecordingViaStreamSearch(
  accountId: string,
  apiToken: string,
  liveClassTitle: string,
  excludeLiveInputUid: string
): Promise<CfRecording | null> {
  const q = String(liveClassTitle || "").trim();
  if (q.length < 2) return null;
  try {
    const u = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`);
    u.searchParams.set("search", q);
    u.searchParams.set("limit", "40");
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = normalizeCfVideoItems(data);
    const qLow = q.toLowerCase();
    const matched = items.filter((v) => {
      const id = String((v as any)?.uid || (v as any)?.id || "");
      if (!id || id === excludeLiveInputUid) return false;
      const metaName = String((v as any)?.meta?.name || "").trim().toLowerCase();
      const nameField = String((v as any)?.name || "").trim().toLowerCase();
      if (metaName && metaName === qLow) return true;
      if (nameField && nameField === qLow) return true;
      return metaName.includes(qLow) || nameField.includes(qLow);
    });
    const pool = matched.length
      ? matched
      : items.filter((v) => String((v as any)?.uid || "") && String((v as any).uid) !== excludeLiveInputUid);
    return pickBestCfRecording(pool, excludeLiveInputUid);
  } catch {
    return null;
  }
}
