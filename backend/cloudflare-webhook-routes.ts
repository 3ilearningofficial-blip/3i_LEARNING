import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import { incrementCounter } from "./observability";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterCloudflareWebhookRoutesDeps = {
  app: Express;
  db: DbClient;
};

function timingSafeEqualsHex(a: string, b: string): boolean {
  const aa = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function verifyWebhookSignature(req: Request): boolean {
  const secret = String(process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;

  // Cloudflare Account Notifications (set up via the Notifications UI) send
  // the literal secret in the cf-webhook-auth header — no HMAC involved.
  const authHeader = String(req.get("cf-webhook-auth") || "").trim();
  if (authHeader) {
    return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(secret));
  }

  // Cloudflare Stream direct webhooks (set up via the Stream API) use HMAC-SHA256
  // in the cf-webhook-signature header.
  const raw = Buffer.isBuffer((req as any).rawBody)
    ? ((req as any).rawBody as Buffer)
    : Buffer.from(JSON.stringify(req.body || {}));
  const headerSig = String(req.get("cf-webhook-signature") || req.get("x-webhook-signature") || "").trim();
  if (!headerSig) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return timingSafeEqualsHex(expected, headerSig);
}

export function registerCloudflareWebhookRoutes({
  app,
  db,
}: RegisterCloudflareWebhookRoutesDeps): void {
  app.post("/api/webhooks/cloudflare/stream", async (req: Request, res: Response) => {
    try {
      if (process.env.FF_ENABLE_CLOUDFLARE_STREAM_WEBHOOKS === "false") {
        return res.status(202).json({ message: "webhook disabled" });
      }
      if (!verifyWebhookSignature(req)) {
        return res.status(401).json({ message: "Invalid webhook signature" });
      }

      const eventType = String(req.body?.type || req.body?.event || "").toLowerCase();
      const eventId = String(req.body?.id || req.body?.event_id || req.get("cf-event-id") || "").trim();
      const uid = String(req.body?.uid || req.body?.data?.uid || req.body?.video?.uid || "").trim();
      if (!uid) return res.status(400).json({ message: "Missing uid" });
      if (!eventId) return res.status(400).json({ message: "Missing event id" });

      try {
        await db.query(
          `INSERT INTO webhook_event_receipts (source, event_id, event_type, received_at)
           VALUES ($1, $2, $3, $4)`,
          ["cloudflare_stream", eventId, eventType || null, Date.now()]
        );
      } catch (err: any) {
        if (String(err?.code || "") === "23505") {
          incrementCounter("cloudflare_webhook_duplicates");
          return res.status(202).json({ ok: true, duplicate: true });
        }
        throw err;
      }

      if (eventType.includes("live_input.disconnected") || eventType.includes("input.disconnected")) {
        await db.query("UPDATE live_classes SET is_live = FALSE WHERE cf_stream_uid = $1 AND is_completed IS NOT TRUE", [uid]);
      }

      if (eventType.includes("video.ready") || eventType.includes("recording.ready")) {
        await db.query(
          "UPDATE live_classes SET cf_recording_uid = COALESCE(cf_recording_uid, $1) WHERE (cf_stream_uid = $2 OR cf_recording_uid = $1) AND is_completed IS NOT TRUE",
          [uid, String(req.body?.data?.live_input_uid || req.body?.live_input_uid || "")]
        );
      }

      return res.json({ ok: true });
    } catch (err) {
      console.error("[CloudflareWebhook] stream webhook error:", err);
      return res.status(500).json({ message: "Webhook handling failed" });
    }
  });
}
