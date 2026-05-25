/**
 * Cloudflare Stream MP4 downloads must be created via API (dashboard "Generate MP4" is the same).
 * POST /stream/{videoUid}/downloads → poll GET until default.status === "ready" → fetch url → R2.
 */

export type CfDownloadInfo = {
  status: "ready" | "inprogress" | "error";
  url?: string;
  percentComplete?: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseDefaultDownload(payload: any): CfDownloadInfo | null {
  const def = payload?.result?.default;
  if (!def || typeof def !== "object") return null;
  const status = String(def.status || "").toLowerCase();
  if (status !== "ready" && status !== "inprogress" && status !== "error") return null;
  return {
    status: status as CfDownloadInfo["status"],
    url: def.url ? String(def.url) : undefined,
    percentComplete: Number(def.percentComplete ?? def.percent_complete ?? 0),
  };
}

export async function createCloudflareStreamDownload(
  accountId: string,
  apiToken: string,
  videoUid: string
): Promise<CfDownloadInfo | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}/downloads`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}` },
    }
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.success) {
    console.warn(
      `[CF Stream] POST downloads failed uid=${videoUid} status=${res.status} body=${JSON.stringify(data?.errors || data).slice(0, 200)}`
    );
    return null;
  }
  return parseDefaultDownload(data);
}

export async function getCloudflareStreamDownload(
  accountId: string,
  apiToken: string,
  videoUid: string
): Promise<CfDownloadInfo | null> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${videoUid}/downloads`,
    { headers: { Authorization: `Bearer ${apiToken}` } }
  );
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.success) return null;
  return parseDefaultDownload(data);
}

/**
 * Triggers MP4 generation (if needed) and waits until Cloudflare reports download ready.
 * Returns the MP4 URL from the API (customer subdomain or videodelivery).
 */
export async function ensureCloudflareMp4DownloadUrl(
  accountId: string,
  apiToken: string,
  videoUid: string,
  options?: { maxWaitMs?: number; pollMs?: number }
): Promise<string | null> {
  const maxWaitMs = options?.maxWaitMs ?? Number(process.env.CF_STREAM_DOWNLOAD_MAX_WAIT_MS || 45 * 60 * 1000);
  const pollMs = options?.pollMs ?? Number(process.env.CF_STREAM_DOWNLOAD_POLL_MS || 10_000);

  const created = await createCloudflareStreamDownload(accountId, apiToken, videoUid);
  if (created?.status === "ready" && created.url) {
    console.log(`[CF Stream] MP4 download already ready uid=${videoUid}`);
    return created.url;
  }
  if (created?.status === "inprogress") {
    console.log(
      `[CF Stream] MP4 download generation started uid=${videoUid} pct=${created.percentComplete ?? 0}`
    );
  } else if (created) {
    console.log(`[CF Stream] MP4 download create status=${created.status} uid=${videoUid}`);
  } else {
    // Video may not be ready yet — keep polling GET
    console.log(`[CF Stream] MP4 download create pending (will poll) uid=${videoUid}`);
  }

  const deadline = Date.now() + maxWaitMs;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    const state = await getCloudflareStreamDownload(accountId, apiToken, videoUid);
    if (state?.status === "ready" && state.url) {
      console.log(`[CF Stream] MP4 download ready uid=${videoUid}`);
      return state.url;
    }
    if (state?.status === "error") {
      console.warn(`[CF Stream] MP4 download generation error uid=${videoUid}`);
      return null;
    }
    const now = Date.now();
    if (now - lastLogAt > 60_000) {
      lastLogAt = now;
      console.log(
        `[CF Stream] MP4 download in progress uid=${videoUid} pct=${state?.percentComplete ?? "?"}`
      );
    }
    await sleep(pollMs);
  }

  console.warn(`[CF Stream] MP4 download timed out uid=${videoUid} maxWaitMs=${maxWaitMs}`);
  return null;
}

/** Fallback URLs when API credentials are missing (legacy). */
export function buildLegacyMp4CandidateUrls(recordingUid: string): string[] {
  const configuredDownloadBase = String(process.env.CF_STREAM_DOWNLOAD_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return [
    `https://videodelivery.net/${recordingUid}/downloads/default.mp4`,
    configuredDownloadBase ? `${configuredDownloadBase}/${recordingUid}/downloads/default.mp4` : "",
  ].filter(Boolean);
}
