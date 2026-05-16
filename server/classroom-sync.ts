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
import { TLSocketRoom, InMemorySyncStorage } from "@tldraw/sync-core";
import { getAuthUserFromRequest } from "./auth-utils";
import type { DbClient } from "./classroom-sync-types";
import { userCanAccessLiveClassContent } from "./live-class-access";

export type { DbClient };

const rooms = new Map<string, TLSocketRoom>();

function sanitizeRoomId(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120);
}

function makeOrLoadRoom(roomId: string): TLSocketRoom {
  const id = sanitizeRoomId(roomId);
  const existing = rooms.get(id);
  if (existing && !existing.isClosed()) return existing;

  const storage = new InMemorySyncStorage();
  const room = new TLSocketRoom({
    storage,
    onSessionRemoved(roomInstance, args) {
      if (args.numSessionsRemaining === 0) {
        roomInstance.close();
        rooms.delete(id);
      }
    },
  });
  rooms.set(id, room);
  return room;
}

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
  roomId: string
): Promise<{ ok: true; user: { id: number; role: string }; isReadonly: boolean } | { ok: false; status: number; message: string }> {
  const url = new URL(req.url || "", "http://localhost");
  const token = url.searchParams.get("access_token") || url.searchParams.get("token") || "";
  const fakeReq = {
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      cookie: req.headers.cookie,
    },
    session: (req as any).session,
  } as any;

  const user = await getAuthUserFromRequest(fakeReq, db);
  if (!user) return { ok: false, status: 401, message: "Unauthorized" };

  const liveClassId = roomId.replace(/^lc-/, "").replace(/-preview$/, "");
  const lcResult = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  const lc = lcResult.rows[0];
  if (!lc) return { ok: false, status: 404, message: "Live class not found" };

  if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
    return { ok: false, status: 400, message: "Not a classroom stream" };
  }

  const canAccess = await userCanAccessLiveClassContent(db, user, lc);
  if (!canAccess) return { ok: false, status: 403, message: "Access denied" };

  const isPreview = roomId.endsWith("-preview");
  const isAdmin = user.role === "admin";
  if (!isPreview && !isAdmin && (!lc.is_live || lc.is_completed)) {
    return { ok: false, status: 403, message: "Class is not live" };
  }

  return { ok: true, user: { id: user.id, role: user.role }, isReadonly: !isAdmin };
}

export function attachClassroomSyncServer(httpServer: Server, db: DbClient): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", "http://localhost");
    const match = url.pathname.match(/^\/classroom-sync\/([^/]+)$/);
    if (!match) return;

    wss.handleUpgrade(req, socket, head, (socketConn) => {
      void handleConnection(socketConn, req, match[1], db);
    });
  });
}

async function handleConnection(ws: WebSocket, req: IncomingMessage, rawRoomId: string, db: DbClient) {
  const auth = await authenticateClassroomSocket(db, req, rawRoomId);
  if (!auth.ok) {
    ws.close(auth.status === 401 ? 4401 : 4403, auth.message);
    return;
  }

  const roomId = sanitizeRoomId(rawRoomId);
  const url = new URL(req.url || "", "http://localhost");
  const sessionId = parseSessionId(url);
  const room = makeOrLoadRoom(roomId);

  const caughtMessages: Buffer[] = [];
  const collect = (data: Buffer | ArrayBuffer) => {
    caughtMessages.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
  };
  ws.on("message", collect);

  room.handleSocketConnect({
    sessionId,
    socket: ws as any,
    isReadonly: auth.isReadonly,
  });

  ws.off("message", collect);
  for (const msg of caughtMessages) {
    ws.send(msg);
  }
}
