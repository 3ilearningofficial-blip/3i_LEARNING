/**
 * classroom-sync.ts
 * WebSocket sync server for tldraw collaborative whiteboard during live classroom sessions.
 *
 * Cluster note: pm2 runs multiple HTTP workers; sync rooms live in one process's memory.
 * Use nginx sticky sessions on the classroom WebSocket upgrade path, or route sync to a
 * single worker, so admin refresh always hits the same in-memory room when possible.
 * Auto-checkpoints to R2 cover reconnects that land on a different worker.
 *
 * Changes from original:
 *  - attachClassroomSyncServer now accepts getR2Client so it can persist board snapshots.
 *  - makeOrLoadRoom is now async; it attempts to restore the latest auto-checkpoint from R2
 *    on first connection after a server restart. A roomLoadingPromises Map coalesces concurrent
 *    connections so only one R2 fetch happens per room.
 *  - storage.onChange() schedules a throttled auto-checkpoint (default: every 2 minutes).
 *    The timer fires at most once per interval, even during continuous drawing.
 *  - teardownRoomIfAllowed saves one final checkpoint before closing the room.
 *  - A background interval prunes stale checkpoint state for rooms that no longer exist.
 *  - All checkpoint I/O is wrapped in try/catch — any R2 failure is logged and ignored;
 *    the sync protocol is never affected.
 *  - Preview rooms ("-preview" suffix) are never checkpointed (ephemeral by design).
 *  - If R2 is not configured, checkpoint code skips silently — old behavior exactly.
 *
 * Only auto-generated checkpoints (R2 key prefix "board-checkpoints/") are restored on restart.
 * Frontend-uploaded manual checkpoint URLs are stored separately and are not touched here.
 */

import type { Server } from "node:http";
import type { IncomingMessage } from "node:http";
import { URL } from "node:url";
import { createRequire } from "node:module";
import type { WebSocket } from "ws";

const require = createRequire(import.meta.url);
// CJS `ws` exposes the server class as `.Server`, not `.WebSocketServer`.
const WebSocketServer = require("ws").Server as new (
  options?: import("ws").ServerOptions
) => import("ws").WebSocketServer;

import {
  TLSocketRoom,
  InMemorySyncStorage,
  TLSyncErrorCloseEventCode,
  TLSyncErrorCloseEventReason,
} from "@tldraw/sync-core";
import type { RoomSnapshot } from "@tldraw/sync-core";
import { getAuthUserFromRequest } from "./auth-utils";
import type { DbClient } from "./classroom-sync-types";
import { userCanAccessLiveClassContent } from "./live-class-access";
import { createHmac, timingSafeEqual } from "node:crypto";

// ── Short-lived classroom-sync auth token ──────────────────────────────────────
// A browser cannot set an Authorization header on a WebSocket, and tldraw's
// useSync discards query params — so the credential must ride in the URL PATH.
// We issue a signed, ~2-minute token (NOT the raw session token) bound to the
// user + live class, verified here on connect.
const CLASSROOM_SYNC_TOKEN_TTL_MS = 2 * 60 * 1000;
function syncB64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function classroomSyncSecret(): string {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s) throw new Error("OTP_HMAC_SECRET must be set");
  return s;
}
export function signClassroomSyncToken(userId: number, liveClassId: string): string {
  const body = syncB64Url(Buffer.from(JSON.stringify({ uid: userId, lc: String(liveClassId), exp: Date.now() + CLASSROOM_SYNC_TOKEN_TTL_MS }), "utf8"));
  const sig = syncB64Url(createHmac("sha256", classroomSyncSecret()).update(body).digest());
  return body + "." + sig;
}
function verifyClassroomSyncToken(token: string | null | undefined): { uid: number; lc: string } | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = syncB64Url(createHmac("sha256", classroomSyncSecret()).update(body).digest());
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const pad = body.length % 4 === 0 ? "" : "=".repeat(4 - (body.length % 4));
    const json = Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
    const obj = JSON.parse(json) as { uid: number; lc: string; exp: number };
    if (typeof obj.exp !== "number" || obj.exp < Date.now()) return null;
    if (typeof obj.uid !== "number" || !Number.isFinite(obj.uid)) return null;
    return { uid: obj.uid, lc: String(obj.lc) };
  } catch {
    return null;
  }
}

export type { DbClient };

// ── Shared R2 client type ─────────────────────────────────────────────────────

type GetR2Client = () => Promise<any>;

// ── Room lifecycle ────────────────────────────────────────────────────────────

/** Live rooms, keyed by sanitized roomId. */
const rooms = new Map<string, TLSocketRoom>();

/**
 * Coalesces concurrent async room-creation requests for the same roomId.
 * Without this, two simultaneous first-connections after a server restart would
 * each start an R2 fetch and create separate rooms — causing a split-brain.
 */
const roomLoadingPromises = new Map<string, Promise<TLSocketRoom>>();

// ── Auto-checkpoint state ─────────────────────────────────────────────────────

interface CheckpointState {
  /** setTimeout handle; null means no checkpoint is currently scheduled. */
  timer: ReturnType<typeof setTimeout> | null;
  /** documentClock value at the last successful save. Skip save if unchanged. */
  lastSavedClock: number;
  /** Guard: true while an R2 upload is in progress; prevents concurrent overlapping saves. */
  saving: boolean;
}

/** Per-room checkpoint state, keyed by sanitized roomId. */
const checkpointStates = new Map<string, CheckpointState>();

/**
 * How long to wait between auto-checkpoints (milliseconds).
 * Throttle semantics: the first change starts a timer; subsequent changes
 * during the interval are ignored. This guarantees saves during continuous
 * drawing (unlike a pure debounce which only saves after drawing stops).
 * Override via BOARD_CHECKPOINT_INTERVAL_MS env var (minimum: 60 000 ms).
 */
const AUTO_CHECKPOINT_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.BOARD_CHECKPOINT_INTERVAL_MS || "120000")
);

/** Debounced checkpoint after page add/remove (ms). */
const PAGE_CHANGE_CHECKPOINT_DEBOUNCE_MS = 5_000;

/**
 * R2 object-key prefix for server-generated auto-checkpoints.
 * Only keys with this prefix are restored on server restart.
 * Frontend-uploaded checkpoint URLs (http://…) are not touched.
 */
const AUTO_CHECKPOINT_KEY_PREFIX = "board-checkpoints/";

/** Maximum time (ms) to wait for the R2 checkpoint GET before falling back to an empty board. */
const AUTO_CHECKPOINT_LOAD_TIMEOUT_MS = 8_000;

/** Maximum time (ms) to wait for the final checkpoint save during room teardown. */
const AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS = 5_000;

/** How often to prune stale CheckpointState entries for rooms that no longer exist. */
const CHECKPOINT_CLEANUP_INTERVAL_MS = 10 * 60 * 1_000; // 10 minutes

// ── Utilities ─────────────────────────────────────────────────────────────────

function sanitizeRoomId(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function parseLiveClassIdFromRoomId(roomId: string): string {
  return roomId.replace(/^lc-/, "").replace(/-preview$/, "");
}

function isPreviewRoom(roomId: string): boolean {
  return roomId.endsWith("-preview");
}

/** Returns true only when all four R2 env vars are present. */
function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  );
}

// ── R2 checkpoint I/O ─────────────────────────────────────────────────────────

/**
 * Download and parse a RoomSnapshot JSON from R2.
 * Returns null on any error — caller falls back to empty board.
 */
async function fetchSnapshotFromR2(
  getR2Client: GetR2Client,
  objectKey: string
): Promise<RoomSnapshot | null> {
  try {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r2 = await getR2Client();
    const bucket = String(process.env.R2_BUCKET_NAME || "");
    const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!result.Body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    }
    const json = Buffer.concat(chunks).toString("utf-8");
    const parsed = JSON.parse(json) as RoomSnapshot & { document?: unknown };
    if (!Array.isArray(parsed?.documents)) {
      console.warn(
        `[classroom-checkpoint] R2 object ${objectKey} is not a RoomSnapshot — skipping for sync restore`
      );
      return null;
    }
    return parsed;
  } catch (err: any) {
    console.warn("[classroom-checkpoint] R2 GET failed:", err?.message || String(err));
    return null;
  }
}

/**
 * Serialize a RoomSnapshot to JSON and upload to R2.
 * Returns true on success, false on any error.
 */
async function uploadSnapshotToR2(
  getR2Client: GetR2Client,
  objectKey: string,
  snapshot: RoomSnapshot
): Promise<boolean> {
  try {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const r2 = await getR2Client();
    const bucket = String(process.env.R2_BUCKET_NAME || "");
    const body = Buffer.from(JSON.stringify(snapshot), "utf-8");
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentType: "application/json",
      })
    );
    return true;
  } catch (err: any) {
    console.warn("[classroom-checkpoint] R2 PUT failed:", err?.message || String(err));
    return false;
  }
}

/**
 * Download and parse a RoomSnapshot JSON from a public https URL (client checkpoint).
 * Returns null if the body is not a RoomSnapshot (e.g. editor getSnapshot JSON).
 */
async function fetchSnapshotFromHttp(url: string): Promise<RoomSnapshot | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as RoomSnapshot & { document?: unknown; store?: unknown };
    // Editor getSnapshot() has document/store.records — not usable as RoomSnapshot.
    if (!Array.isArray(json?.documents)) {
      console.warn(
        "[classroom-checkpoint] HTTP snapshot is editor JSON, not RoomSnapshot — skipping for sync restore"
      );
      return null;
    }
    return json;
  } catch (err: any) {
    console.warn("[classroom-checkpoint] HTTP GET failed:", err?.message || String(err));
    return null;
  }
}

/** Normalize a stored checkpoint reference (R2 key or public https URL) to an R2 object key. */
function resolveR2ObjectKey(stored: string): string | null {
  const s = stored.trim();
  if (!s) return null;
  if (s.startsWith(AUTO_CHECKPOINT_KEY_PREFIX)) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const pathname = decodeURIComponent(new URL(s).pathname);
      const markerIdx = pathname.indexOf(AUTO_CHECKPOINT_KEY_PREFIX);
      if (markerIdx >= 0) {
        return pathname.slice(markerIdx).replace(/^\//, "");
      }
      const base = pathname.replace(/^\//, "");
      if (base.endsWith(".json")) return base;
    } catch {
      return null;
    }
  }
  return null;
}


/**
 * Read the latest checkpoint from the DB and fetch its snapshot.
 * Prefers the newer of server auto-checkpoint (R2 key) vs client-uploaded (https URL).
 * Returns null on any failure — caller falls back to empty board.
 */
export async function loadAutoCheckpointSnapshot(
  db: DbClient,
  liveClassId: string,
  getR2Client: GetR2Client
): Promise<RoomSnapshot | null> {
  if (!isR2Configured()) return null;
  try {
    const result = await db.query(
      `SELECT board_sync_checkpoint_url, board_checkpoint_at,
              board_client_checkpoint_url, board_client_checkpoint_at
       FROM live_classes WHERE id = $1`,
      [liveClassId]
    );
    const row = result.rows[0];
    if (!row) return null;

    const serverUrl = String(row.board_sync_checkpoint_url || "");
    const clientUrl = String(row.board_client_checkpoint_url || "");
    const serverAt = Number(row.board_checkpoint_at) || 0;
    const clientAt = Number(row.board_client_checkpoint_at) || 0;
    const useClient = clientUrl && clientAt >= serverAt;

    if (useClient) {
      console.log(`[classroom-checkpoint] Restoring class=${liveClassId} client url`);
      const fromHttp = await fetchSnapshotFromHttp(clientUrl);
      if (fromHttp) {
        console.log(
          `[classroom-checkpoint] Restored class=${liveClassId} docs=${fromHttp.documents?.length ?? 0}`
        );
        return fromHttp;
      }
      const clientKey = resolveR2ObjectKey(clientUrl);
      if (clientKey) {
        const fromR2 = await fetchSnapshotFromR2(getR2Client, clientKey);
        if (fromR2) return fromR2;
      }
    }

    if (serverUrl) {
      const serverKey = resolveR2ObjectKey(serverUrl);
      if (serverKey) {
        console.log(`[classroom-checkpoint] Restoring class=${liveClassId} key=${serverKey}`);
        const snapshot = await fetchSnapshotFromR2(getR2Client, serverKey);
        if (snapshot) {
          console.log(
            `[classroom-checkpoint] Restored class=${liveClassId} docs=${snapshot.documents?.length ?? 0}`
          );
          return snapshot;
        }
      }
    }

    if (!useClient && clientUrl) {
      const fromHttp = await fetchSnapshotFromHttp(clientUrl);
      if (fromHttp) return fromHttp;
    }

    return null;
  } catch (err: any) {
    console.warn("[classroom-checkpoint] Load error:", err?.message || String(err));
    return null;
  }
}

// ── Checkpoint save ───────────────────────────────────────────────────────────

/**
 * Serialize the current room snapshot to JSON, upload to R2, and update the DB row.
 * Skips the save if the document clock has not advanced since the last save.
 * Never throws — all errors are caught and logged.
 */
async function runCheckpoint(
  roomId: string,
  liveClassId: string,
  room: TLSocketRoom,
  db: DbClient,
  getR2Client: GetR2Client
): Promise<void> {
  const state = checkpointStates.get(roomId);
  if (!state || state.saving || room.isClosed() || !isR2Configured()) return;

  const currentClock = room.getCurrentDocumentClock();
  if (currentClock === state.lastSavedClock) return; // nothing changed since last save

  state.saving = true;
  try {
    const snapshot = room.getCurrentSnapshot();
    const timestamp = Date.now();
    const key = `${AUTO_CHECKPOINT_KEY_PREFIX}lc-${liveClassId}-${timestamp}.json`;
    const ok = await uploadSnapshotToR2(getR2Client, key, snapshot);
    if (!ok) return;
    await db.query(
      "UPDATE live_classes SET board_sync_checkpoint_url = $1, board_checkpoint_at = $2 WHERE id = $3",
      [key, timestamp, liveClassId]
    );
    state.lastSavedClock = currentClock;
    console.log(
      `[classroom-checkpoint] Saved class=${liveClassId} clock=${currentClock} key=${key}`
    );
  } catch (err: any) {
    console.warn("[classroom-checkpoint] Save error:", err?.message || String(err));
  } finally {
    state.saving = false;
  }
}

/**
 * Schedule a checkpoint for roomId if one is not already pending.
 * Throttle semantics: the first call after a save schedules the next checkpoint
 * AUTO_CHECKPOINT_INTERVAL_MS in the future. Subsequent calls within that window
 * are no-ops (timer already set). This ensures checkpoints happen even during
 * sustained continuous drawing, which a pure debounce would never fire.
 */
function scheduleCheckpoint(
  roomId: string,
  liveClassId: string,
  room: TLSocketRoom,
  db: DbClient,
  getR2Client: GetR2Client
): void {
  const state = checkpointStates.get(roomId);
  if (!state || state.timer !== null) return; // already scheduled
  if (isPreviewRoom(roomId)) return;          // preview rooms are never checkpointed

  state.timer = setTimeout(() => {
    state.timer = null;
    void runCheckpoint(roomId, liveClassId, room, db, getR2Client);
  }, AUTO_CHECKPOINT_INTERVAL_MS);
}

// ── Room creation ─────────────────────────────────────────────────────────────

/**
 * Return or create the TLSocketRoom for roomId.
 *
 * On first creation (no live room in memory, e.g. after server restart):
 *   1. Check DB for an existing auto-checkpoint key.
 *   2. If found, fetch the RoomSnapshot from R2 (with timeout).
 *   3. Initialise InMemorySyncStorage from the snapshot, or start empty on any failure.
 *   4. Wire storage.onChange to schedule periodic auto-checkpoints.
 *   5. Store room in the rooms Map.
 *
 * The roomLoadingPromises Map ensures concurrent first-connections share a single
 * loading promise rather than starting parallel R2 fetches or creating duplicate rooms.
 */
async function makeOrLoadRoom(
  roomId: string,
  liveClassId: string,
  db: DbClient,
  getR2Client: GetR2Client
): Promise<TLSocketRoom> {
  const id = sanitizeRoomId(roomId);

  // Fast path: room already exists and is alive.
  const existing = rooms.get(id);
  if (existing && !existing.isClosed()) return existing;

  // Slow path: coalesce concurrent loads so we never start two R2 fetches for the same room.
  const pending = roomLoadingPromises.get(id);
  if (pending) return pending;

  const loadPromise = (async (): Promise<TLSocketRoom> => {
    try {
      // Attempt to restore from the last auto-checkpoint (non-preview only).
      // Race against a timeout so a slow/unreachable R2 does not stall the first connection.
      let snapshot: RoomSnapshot | null = null;
      if (!isPreviewRoom(id)) {
        snapshot = await Promise.race([
          loadAutoCheckpointSnapshot(db, liveClassId, getR2Client),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), AUTO_CHECKPOINT_LOAD_TIMEOUT_MS)
          ),
        ]);
      }

      const storage = snapshot
        ? new InMemorySyncStorage({ snapshot })
        : new InMemorySyncStorage();

      // Initialise checkpoint state; seed lastSavedClock so we skip a redundant
      // save immediately after restore (clock hasn't advanced yet).
      const cpState: CheckpointState = {
        timer: null,
        lastSavedClock: storage.getClock(),
        saving: false,
      };
      checkpointStates.set(id, cpState);

      const room = new TLSocketRoom({
        storage,
        onSessionRemoved(roomInstance, args) {
          if (args.numSessionsRemaining === 0) {
            void teardownRoomIfAllowed(id, liveClassId, roomInstance, db, getR2Client);
          }
        },
      });

      // Wire auto-checkpoint: any board change schedules a periodic save.
      // Non-preview rooms only; silently skip if R2 is not configured.
      if (!isPreviewRoom(id) && isR2Configured()) {
        let lastPageCount = room.getCurrentSnapshot().documents?.length ?? 0;
        let pageChangeTimer: ReturnType<typeof setTimeout> | null = null;
        storage.onChange(() => {
          scheduleCheckpoint(id, liveClassId, room, db, getR2Client);
          try {
            const pageCount = room.getCurrentSnapshot().documents?.length ?? 0;
            if (pageCount !== lastPageCount) {
              lastPageCount = pageCount;
              if (pageChangeTimer) clearTimeout(pageChangeTimer);
              pageChangeTimer = setTimeout(() => {
                pageChangeTimer = null;
                void runCheckpoint(id, liveClassId, room, db, getR2Client);
              }, PAGE_CHANGE_CHECKPOINT_DEBOUNCE_MS);
            }
          } catch {
            /* ignore page-count probe errors */
          }
        });
      }

      rooms.set(id, room);
      return room;
    } finally {
      // Always remove the loading promise so future calls don't block on a stale one.
      roomLoadingPromises.delete(id);
    }
  })();

  roomLoadingPromises.set(id, loadPromise);
  return loadPromise;
}

// ── Checkpoint state cleanup ──────────────────────────────────────────────────

function cleanupCheckpointState(roomId: string): void {
  const state = checkpointStates.get(roomId);
  if (state?.timer !== null && state?.timer !== undefined) {
    clearTimeout(state.timer);
  }
  checkpointStates.delete(roomId);
}

/**
 * Periodic cleanup: prune CheckpointState entries for rooms that no longer
 * exist in the rooms Map, preventing unbounded memory growth in long-running
 * deployments where many classes are created and closed over time.
 */
setInterval(() => {
  for (const roomId of checkpointStates.keys()) {
    const room = rooms.get(roomId);
    if (!room || room.isClosed()) {
      cleanupCheckpointState(roomId);
    }
  }
}, CHECKPOINT_CLEANUP_INTERVAL_MS);

// ── Teardown ──────────────────────────────────────────────────────────────────

/**
 * Close the room if the class is no longer live.
 * Before closing, cancel any pending checkpoint timer and run one final save
 * so the board state is preserved right up to the moment the class ended.
 * The final save is bounded by AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS so teardown
 * is never blocked indefinitely by a slow/failing R2.
 */
async function teardownRoomIfAllowed(
  roomId: string,
  liveClassId: string,
  roomInstance: TLSocketRoom,
  db: DbClient,
  getR2Client: GetR2Client
): Promise<void> {
  // Preview rooms are always torn down immediately — no checkpoint needed.
  if (roomId.endsWith("-preview")) {
    roomInstance.close();
    rooms.delete(roomId);
    cleanupCheckpointState(roomId);
    return;
  }

  // Check whether the class is still live before tearing down.
  try {
    const r = await db.query(
      "SELECT is_live, is_completed FROM live_classes WHERE id = $1",
      [liveClassId]
    );
    const lc = r.rows[0] as
      | { is_live?: boolean | number; is_completed?: boolean | number }
      | undefined;
    if (lc && Boolean(lc.is_live) && !Boolean(lc.is_completed)) {
      // Class is still live — keep room in memory but flush a checkpoint so another
      // cluster worker can restore if this admin reconnects on a different instance.
      const state = checkpointStates.get(roomId);
      if (state) {
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
        try {
          await Promise.race([
            runCheckpoint(roomId, liveClassId, roomInstance, db, getR2Client),
            new Promise<void>((resolve) =>
              setTimeout(resolve, AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS)
            ),
          ]);
        } catch {
          /* ignore — must not block session removal */
        }
      }
      return;
    }
  } catch (e) {
    console.warn("[classroom-sync] could not check live status before teardown:", e);
  }

  // Class has ended — save a final checkpoint before discarding RAM state.
  const state = checkpointStates.get(roomId);
  if (state) {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    try {
      await Promise.race([
        runCheckpoint(roomId, liveClassId, roomInstance, db, getR2Client),
        new Promise<void>((resolve) =>
          setTimeout(resolve, AUTO_CHECKPOINT_TEARDOWN_TIMEOUT_MS)
        ),
      ]);
    } catch {
      /* ignore — teardown must proceed regardless */
    }
  }

  roomInstance.close();
  rooms.delete(roomId);
  cleanupCheckpointState(roomId);
}

// ── Authentication ────────────────────────────────────────────────────────────

function parseSessionId(url: URL): string {
  const sid =
    url.searchParams.get("syncClientId") ||
    url.searchParams.get("sessionId");
  if (sid && sid.trim()) return sid.trim().slice(0, 128);
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function authenticateClassroomSocket(
  db: DbClient,
  req: IncomingMessage,
  roomId: string,
  pathToken?: string | null
): Promise<
  | { ok: true; user: { id: number; role: string }; isReadonly: boolean }
  | { ok: false; status: number; message: string }
> {
  const url = new URL(req.url || "", "http://localhost");
  const liveClassId = roomId.replace(/^lc-/, "").replace(/-preview$/, "");

  // Primary (web): short-lived signed token carried in the URL path.
  let user: { id: number; role: string } | null = null;
  const verified = verifyClassroomSyncToken(pathToken);
  if (verified && verified.lc === liveClassId) {
    const r = await db.query(
      "SELECT id, role, COALESCE(is_blocked, FALSE) AS is_blocked FROM users WHERE id = $1",
      [verified.uid]
    );
    const row = r.rows[0];
    if (row && !row.is_blocked) user = { id: Number(row.id), role: String(row.role) };
  }

  // Fallback: legacy query token / session cookie (native app, older clients).
  if (!user) {
    const token =
      url.searchParams.get("access_token") ||
      url.searchParams.get("token") ||
      "";
    const fakeReq = {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        cookie: req.headers.cookie,
      },
      session: (req as { session?: unknown }).session ?? {},
    } as import("express").Request;
    const resolved = await getAuthUserFromRequest(fakeReq, db);
    if (resolved) user = { id: resolved.id, role: resolved.role };
  }

  if (!user) return { ok: false, status: 401, message: "Unauthorized" };
  const lcResult = await db.query(
    "SELECT * FROM live_classes WHERE id = $1",
    [liveClassId]
  );
  const lc = lcResult.rows[0];
  if (!lc) return { ok: false, status: 404, message: "Live class not found" };

  if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
    return { ok: false, status: 400, message: "Not a classroom stream" };
  }

  const canAccess = await userCanAccessLiveClassContent(db, user as Parameters<typeof userCanAccessLiveClassContent>[1], lc);
  if (!canAccess) return { ok: false, status: 403, message: "Access denied" };

  const isPreview = roomId.endsWith("-preview");
  const isAdmin = user.role === "admin";
  if (!isPreview && !isAdmin && (!lc.is_live || lc.is_completed)) {
    return { ok: false, status: 403, message: "Class is not live" };
  }

  // Admins can draw on the board; students are read-only.
  const isReadonly = user.role !== "admin";
  return { ok: true, user: { id: user.id, role: user.role }, isReadonly };
}

// ── Server attachment ─────────────────────────────────────────────────────────

function syncCloseReason(status: number): string {
  if (status === 401) return TLSyncErrorCloseEventReason.NOT_AUTHENTICATED;
  if (status === 404) return TLSyncErrorCloseEventReason.NOT_FOUND;
  return TLSyncErrorCloseEventReason.FORBIDDEN;
}

/**
 * Attach the classroom WebSocket sync server to an existing HTTP server.
 *
 * @param httpServer  Node.js HTTP server (from createServer(app))
 * @param db          Shared DB client for auth + live-class queries + checkpoint metadata
 * @param getR2Client Lazy R2 S3Client factory (same instance used by all other upload routes)
 */
export function attachClassroomSyncServer(
  httpServer: Server,
  db: DbClient,
  getR2Client: GetR2Client
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", "http://localhost");
    // Path may be /classroom-sync/<room> or /classroom-sync/<room>/<auth-token>.
    const match = url.pathname.match(/^\/classroom-sync\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return;

    wss.handleUpgrade(req, socket, head, (socketConn) => {
      const pathToken = match[2] ? decodeURIComponent(match[2]) : null;
      void handleConnection(socketConn, req, match[1], db, getR2Client, pathToken);
    });
  });
}

async function handleConnection(
  ws: WebSocket,
  req: IncomingMessage,
  rawRoomId: string,
  db: DbClient,
  getR2Client: GetR2Client,
  pathToken: string | null = null
) {
  // Buffer incoming messages during async auth + room-load so no tldraw packets
  // are dropped while we await the DB and (potentially) R2.
  const caughtMessages: Buffer[] = [];
  const collect = (data: Buffer | ArrayBuffer) => {
    caughtMessages.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  ws.on("message", collect);

  const auth = await authenticateClassroomSocket(db, req, rawRoomId, pathToken);
  if (!auth.ok) {
    ws.off("message", collect);
    ws.close(TLSyncErrorCloseEventCode, syncCloseReason(auth.status));
    return;
  }

  const roomId = sanitizeRoomId(rawRoomId);
  const liveClassId = parseLiveClassIdFromRoomId(roomId);
  const url = new URL(req.url || "", "http://localhost");
  const sessionId = parseSessionId(url);

  // makeOrLoadRoom is now async: on first connection after a restart it restores
  // the last auto-checkpoint from R2. The message buffer above ensures no packets
  // are lost during this brief async window.
  const room = await makeOrLoadRoom(roomId, liveClassId, db, getR2Client);

  room.handleSocketConnect({
    sessionId,
    socket: ws as any,
    isReadonly: auth.isReadonly,
  });

  // Replay buffered messages now that the room is ready.
  ws.off("message", collect);
  for (const msg of caughtMessages) {
    (ws as WebSocket & { emit(event: "message", data: Buffer): boolean }).emit(
      "message",
      msg
    );
  }
}
