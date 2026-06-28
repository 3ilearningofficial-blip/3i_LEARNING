import type { Express, Request, Response } from "express";
import { getWebhookReceiver } from "./livekit-sdk";

/**
 * CFSR-01: LiveKit room_finished webhook — server-side safety net.
 *
 * Why this exists:
 *   The admin UI calls POST /api/admin/live-classes/:id/stream/end to end a class.
 *   If the broadcast tab crashes, the network drops, or the admin forgets to click
 *   "End Class", is_live stays TRUE forever — students can still try to join a dead room.
 *
 *   This webhook fires from LiveKit's server when the room is truly destroyed
 *   (all participants have left and LiveKit closes the room). It acts as a guarantee:
 *   even if the admin endpoint is never called, is_live will be set to FALSE.
 *
 * How it works:
 *   1. LiveKit calls POST /api/webhooks/livekit with a signed JWT in the
 *      Authorization header and the event payload in the body.
 *   2. We verify the signature using WebhookReceiver (livekit-server-sdk).
 *   3. For room_finished events, we extract the room name (`lc-<liveClassId>`),
 *      derive the live_class_id, and set is_live = FALSE.
 *   4. We respond 200 immediately — LiveKit retries on non-2xx responses, so
 *      we must not return an error for recoverable issues.
 *
 * Setup required in the LiveKit dashboard / server config:
 *   Webhook URL:  https://your-domain.com/api/webhooks/livekit
 *   Events:       room_finished  (at minimum)
 *
 * Environment variables required (already in ecosystem.config.js):
 *   LIVEKIT_API_KEY    — same key used to issue AccessTokens
 *   LIVEKIT_API_SECRET — same secret used to issue AccessTokens
 */

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveKitWebhookRoutesDeps = {
  app: Express;
  db: DbClient;
};

/**
 * Room names follow the pattern used in classroom-routes.ts: `lc-{liveClassId}`.
 * Returns the numeric ID, or null if the name does not match the pattern.
 */
function parseLiveClassId(roomName: string): number | null {
  const match = String(roomName || "").match(/^lc-(\d+)$/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function registerLiveKitWebhookRoutes({
  app,
  db,
}: RegisterLiveKitWebhookRoutesDeps): void {
  /**
   * POST /api/webhooks/livekit
   *
   * No auth middleware — LiveKit authenticates via its own signed JWT in
   * the Authorization header, verified by WebhookReceiver.receive().
   *
   * IMPORTANT: This route depends on req.rawBody (Buffer) being populated by
   * the express.json verify callback in setupBodyParsing (backend/index.ts).
   * If that verify callback is ever removed, change this route to use
   * express.raw() on a path-specific basis instead.
   */
  app.post("/api/webhooks/livekit", async (req: Request, res: Response) => {
    // Acknowledge immediately — LiveKit retries on non-2xx, so a slow DB query
    // must not delay the response. We process the event asynchronously.
    res.status(200).end();

    void (async () => {
      try {
        let receiver;
        try {
          receiver = await getWebhookReceiver();
        } catch (loadErr) {
          console.warn("[LiveKit Webhook] Failed to load receiver:", loadErr);
          return;
        }

        if (!receiver) {
          console.warn("[LiveKit Webhook] Ignoring event — receiver not available.");
          return;
        }

        // req.rawBody is populated by the express.json verify callback.
        // We need the raw bytes (not the parsed JSON object) for HMAC verification.
        const rawBody = (req as any).rawBody;
        if (!rawBody || !Buffer.isBuffer(rawBody)) {
          console.warn("[LiveKit Webhook] rawBody missing — cannot verify signature. Skipping event.");
          return;
        }

        const authHeader = req.headers["authorization"];
        if (!authHeader) {
          console.warn("[LiveKit Webhook] Missing Authorization header — dropping event.");
          return;
        }

        let event: Awaited<ReturnType<typeof receiver.receive>>;
        try {
          event = await receiver.receive(rawBody.toString("utf-8"), authHeader as string);
        } catch (verifyErr) {
          // Signature mismatch or expired token — could be a probe or spoofed request.
          console.warn("[LiveKit Webhook] Signature verification failed:", verifyErr);
          return;
        }

        const eventName = (event as any)?.event;
        console.log(`[LiveKit Webhook] Received event="${eventName}" room="${(event as any)?.room?.name ?? ""}"`);

        if (eventName !== "room_finished") {
          // We only handle room_finished for now; silently ignore other events.
          return;
        }

        const roomName = String((event as any)?.room?.name ?? "");
        const liveClassId = parseLiveClassId(roomName);

        if (!liveClassId) {
          // Room name doesn't match our pattern — could be a test room or unrelated LiveKit project.
          console.log(`[LiveKit Webhook] room_finished for unrecognised room "${roomName}" — ignoring.`);
          return;
        }

        // Safety net: only clear is_live. Do NOT set is_completed here — the admin
        // "End Class" button handles the full finalization flow (recording, CF Stream teardown, etc.).
        // Setting is_completed via webhook could skip recording archival on classes that
        // ended via LiveKit timeout rather than the admin button.
        //
        // We use COALESCE(ended_at, ...) so we don't overwrite an ended_at that the
        // admin UI already set when the class was properly ended from the broadcast page.
        const result = await db.query(
          `UPDATE live_classes
           SET is_live = FALSE,
               ended_at = COALESCE(ended_at, $1)
           WHERE id = $2
             AND is_live = TRUE
           RETURNING id, is_completed`,
          [Date.now(), liveClassId]
        );

        if (result.rows.length === 0) {
          // Either the class was already ended (is_live = FALSE) or the ID doesn't exist.
          // Both are normal — log at debug level only.
          console.log(`[LiveKit Webhook] room_finished for live_class=${liveClassId}: is_live already FALSE or class not found — no-op.`);
          return;
        }

        const row = result.rows[0];
        console.log(
          `[LiveKit Webhook] room_finished — set is_live=FALSE for live_class=${liveClassId} ` +
            `(is_completed=${row.is_completed}). ` +
            (row.is_completed
              ? "Class was already fully ended by admin."
              : "Class ended via LiveKit timeout/disconnect — admin may still need to finalise the recording.")
        );
      } catch (err) {
        // Catch-all: log but never throw — the 200 is already sent, nothing to do.
        console.error("[LiveKit Webhook] Unhandled error processing event:", err);
      }
    })();
  });

  console.log("[LiveKit Webhook] POST /api/webhooks/livekit registered");
}
