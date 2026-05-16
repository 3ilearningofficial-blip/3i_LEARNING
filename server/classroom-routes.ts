import type { Express, Request, Response } from "express";
import { AccessToken } from "livekit-server-sdk";
import { userCanAccessLiveClassContent } from "./live-class-access";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = { id: number; name?: string; role: string } | null;

type RegisterClassroomRoutesDeps = {
  app: Express;
  db: DbClient;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
  getAuthUser: (req: Request) => Promise<AuthUser>;
};

function getLiveKitConfig(): { url: string; apiKey: string; apiSecret: string } | null {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

function classroomRoomName(liveClassId: string | number): string {
  return `lc-${liveClassId}`;
}

async function loadLiveClass(db: DbClient, id: string) {
  const result = await db.query("SELECT * FROM live_classes WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export function registerClassroomRoutes({
  app,
  db,
  requireAuth,
  requireAdmin,
  getAuthUser,
}: RegisterClassroomRoutesDeps): void {
  app.get("/api/live-classes/:id/classroom/config", requireAuth, async (req: Request, res: Response) => {
    const cfg = getLiveKitConfig();
    res.json({
      livekitConfigured: !!cfg,
      syncPath: "/classroom-sync",
    });
  });

  app.post("/api/live-classes/:id/classroom/token", requireAuth, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });

      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "This class is not a classroom stream" });
      }

      const canAccess = await userCanAccessLiveClassContent(db, user, lc);
      if (!canAccess) return res.status(403).json({ message: "Access denied" });

      const isAdmin = user.role === "admin";
      if (!isAdmin && (!lc.is_live || lc.is_completed)) {
        return res.status(403).json({ message: "Class is not live" });
      }

      const cfg = getLiveKitConfig();
      if (!cfg) {
        return res.status(503).json({
          message: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
        });
      }

      const roomName = classroomRoomName(liveClassId);
      if (!lc.classroom_room_name) {
        await db.query("UPDATE live_classes SET classroom_room_name = $1 WHERE id = $2", [
          roomName,
          liveClassId,
        ]);
      }

      const identity = `user-${user.id}`;
      const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
        identity,
        name: user.name || identity,
        ttl: "6h",
      });
      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: isAdmin,
        canSubscribe: true,
        canPublishData: true,
      });

      const token = await at.toJwt();
      res.json({
        token,
        url: cfg.url,
        roomName,
        canPublish: isAdmin,
      });
    } catch (err: any) {
      console.error("[Classroom] token error:", err?.message || err);
      res.status(500).json({ message: "Failed to create classroom token" });
    }
  });

  app.put("/api/admin/live-classes/:id/classroom/board-snapshot", requireAdmin, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const { boardSnapshotUrl, recordingUrl } = req.body || {};
      const url = String(boardSnapshotUrl || recordingUrl || "").trim();
      if (!url) return res.status(400).json({ message: "boardSnapshotUrl required" });

      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });

      await db.query(
        "UPDATE live_classes SET board_snapshot_url = $1, recording_url = COALESCE(recording_url, $1) WHERE id = $2",
        [url, liveClassId]
      );
      res.json({ ok: true, boardSnapshotUrl: url });
    } catch (err: any) {
      console.error("[Classroom] board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to save board snapshot" });
    }
  });

  app.get("/api/live-classes/:id/classroom/board-snapshot", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const lc = await loadLiveClass(db, String(req.params.id));
      if (!lc) return res.status(404).json({ message: "Live class not found" });

      const canAccess = await userCanAccessLiveClassContent(db, user, lc);
      if (!canAccess) return res.status(403).json({ message: "Access denied" });

      res.json({
        boardSnapshotUrl: lc.board_snapshot_url || null,
        classroomRoomName: lc.classroom_room_name || null,
      });
    } catch (err: any) {
      console.error("[Classroom] get board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to load board snapshot" });
    }
  });
}

export { classroomRoomName, getLiveKitConfig };
