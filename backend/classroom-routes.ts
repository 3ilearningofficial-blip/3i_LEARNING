import type { Express, Request, Response } from "express";
import { createAccessToken, getLiveKitConfig } from "./livekit-sdk";
import { userCanAccessLiveClassContent } from "./live-class-access";
import { buildRecordingLectureSectionTitle } from "../shared/recordingSection";
import { saveRecordingForClassAndPeers } from "./live-class-recording-save";
import { convertLiveClassTitlePeersToLectures } from "./live-class-lecture-convert";
import { notifyAdminsLiveClassCompleted } from "./notification-utils";
import { signClassroomSyncToken, loadAutoCheckpointSnapshot } from "./classroom-sync";

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
  recomputeAllEnrollmentsProgressForCourse: (courseId: number | string) => Promise<void>;
  getR2Client: () => Promise<unknown>;
};

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
  recomputeAllEnrollmentsProgressForCourse,
  getR2Client,
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
      const at = await createAccessToken(cfg.apiKey, cfg.apiSecret, {
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
        canUpdateOwnMetadata: isAdmin,
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

  /**
   * Returns the caller's current session bearer token so the tldraw WebSocket
   * sync URI can include it as ?access_token=... rather than relying on
   * sessionStorage (which is unreliable across navigations) or session cookies
   * (which don't always get sent on cross-subdomain WS upgrades).
   * The token is read from the Authorization header or users.session_token.
   */
  app.get("/api/live-classes/:id/classroom/sync-token", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const lc = await loadLiveClass(db, String(req.params.id));
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "Not a classroom stream" });
      }
      // Issue a short-lived, single-purpose signed token (NOT the raw session
      // token) for the tldraw WS to carry in its URL path. ~2-min TTL, bound to
      // this user + live class, verified by the sync server on connect.
      const token = signClassroomSyncToken(user.id, String(req.params.id));
      res.set("Cache-Control", "no-store");
      res.json({ token });
    } catch (err) {
      console.error("[Classroom] sync-token error:", err);
      res.status(500).json({ message: "Failed to get sync token" });
    }
  });

  app.get(
    "/api/admin/live-classes/:id/classroom/board-checkpoint",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const lc = await loadLiveClass(db, String(req.params.id));
        if (!lc) return res.status(404).json({ message: "Live class not found" });
        const clientUrl = String(lc.board_client_checkpoint_url || "").trim();
        const serverUrl = String(lc.board_sync_checkpoint_url || "").trim();
        const clientAt = Number(lc.board_client_checkpoint_at) || 0;
        const serverAt = Number(lc.board_checkpoint_at) || 0;
        const useClient = clientUrl && clientAt >= serverAt;
        res.json({
          checkpointUrl: useClient ? clientUrl : serverUrl || clientUrl || null,
          checkpointAt: useClient ? clientAt : serverAt || clientAt || null,
        });
      } catch (err: any) {
        console.error("[Classroom] get checkpoint error:", err?.message || err);
        res.status(500).json({ message: "Failed to load board checkpoint" });
      }
    }
  );

  app.get(
    "/api/admin/live-classes/:id/classroom/board-checkpoint/snapshot",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const liveClassId = String(req.params.id);
        const lc = await loadLiveClass(db, liveClassId);
        if (!lc) return res.status(404).json({ message: "Live class not found" });
        const snapshot = await loadAutoCheckpointSnapshot(db, liveClassId, getR2Client);
        if (!snapshot) return res.status(404).json({ message: "No board checkpoint snapshot" });
        res.set("Cache-Control", "no-store");
        res.json(snapshot);
      } catch (err: unknown) {
        console.error("[Classroom] checkpoint snapshot error:", err instanceof Error ? err.message : err);
        res.status(500).json({ message: "Failed to load board checkpoint snapshot" });
      }
    }
  );

  app.put(
    "/api/admin/live-classes/:id/classroom/board-checkpoint",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const liveClassId = String(req.params.id);
        const checkpointUrl = String(req.body?.checkpointUrl || "").trim();
        if (!checkpointUrl) return res.status(400).json({ message: "checkpointUrl required" });

        const lc = await loadLiveClass(db, liveClassId);
        if (!lc) return res.status(404).json({ message: "Live class not found" });

        const t = Date.now();
        await db.query(
          `UPDATE live_classes SET board_client_checkpoint_url = $1, board_client_checkpoint_at = $2 WHERE id = $3`,
          [checkpointUrl, t, liveClassId]
        );
        res.json({ ok: true, checkpointUrl, checkpointAt: t });
      } catch (err: any) {
        console.error("[Classroom] put checkpoint error:", err?.message || err);
        res.status(500).json({ message: "Failed to save board checkpoint" });
      }
    }
  );

  app.put("/api/admin/live-classes/:id/classroom/board-snapshot", requireAdmin, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const { boardSnapshotUrl, recordingUrl } = req.body || {};
      const url = String(boardSnapshotUrl || recordingUrl || "").trim();
      if (!url) return res.status(400).json({ message: "boardSnapshotUrl required" });

      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });

      await db.query("UPDATE live_classes SET board_snapshot_url = $1 WHERE id = $2", [url, liveClassId]);
      res.json({ ok: true, boardSnapshotUrl: url });
    } catch (err: any) {
      console.error("[Classroom] board-snapshot error:", err?.message || err);
      res.status(500).json({ message: "Failed to save board snapshot" });
    }
  });

  app.post("/api/admin/live-classes/:id/classroom/finalize", requireAdmin, async (req: Request, res: Response) => {
    try {
      const liveClassId = String(req.params.id);
      const lc = await loadLiveClass(db, liveClassId);
      if (!lc) return res.status(404).json({ message: "Live class not found" });
      if (String(lc.stream_type || "").toLowerCase() !== "classroom") {
        return res.status(400).json({ message: "Not a classroom stream" });
      }

      const body = req.body || {};
      const recordingUrl = String(body.recordingUrl || "").trim();
      const boardSnapshotUrl = String(body.boardSnapshotUrl || "").trim();
      const boardPdfUrl = String(body.boardPdfUrl || "").trim();
      const boardPagesRaw = body.boardPages;
      const boardSyncCheckpointUrl = String(body.boardSyncCheckpointUrl || "").trim();
      const boardClientCheckpointUrl = String(body.boardClientCheckpointUrl || "").trim();
      const sectionTitle = buildRecordingLectureSectionTitle(
        lc.lecture_section_title,
        lc.lecture_subfolder_title,
        body.sectionTitle
      );

      const isImageUrl = (u: string) => /\.(png|jpe?g|webp|gif)(\?|$)/i.test(u);

      let lectureIds: number[] = [];
      if (recordingUrl && !isImageUrl(recordingUrl)) {
        const saved = await saveRecordingForClassAndPeers(db, liveClassId, recordingUrl, {
          sectionTitle,
          recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse,
        });
        lectureIds = saved.lectureIds;
      }

      if (boardSnapshotUrl) {
        await db.query(
          "UPDATE live_classes SET board_snapshot_url = COALESCE(board_snapshot_url, $1) WHERE id = $2",
          [boardSnapshotUrl, liveClassId]
        );
      }

      const archiveFields: string[] = [];
      const archiveParams: unknown[] = [];
      let p = 1;
      if (boardPdfUrl) {
        archiveFields.push(`board_pdf_url = $${p++}`);
        archiveParams.push(boardPdfUrl);
      }
      if (Array.isArray(boardPagesRaw) && boardPagesRaw.length > 0) {
        archiveFields.push(`board_pages_json = $${p++}`);
        archiveParams.push(JSON.stringify(boardPagesRaw));
      }
      if (boardSyncCheckpointUrl) {
        archiveFields.push(`board_sync_checkpoint_url = $${p++}`);
        archiveParams.push(boardSyncCheckpointUrl);
        archiveFields.push(`board_checkpoint_at = $${p++}`);
        archiveParams.push(Date.now());
      }
      // Editor getSnapshot() JSON belongs in the client column only — never
      // overwrite board_sync_checkpoint_url (RoomSnapshot) with editor format.
      if (boardClientCheckpointUrl) {
        archiveFields.push(`board_client_checkpoint_url = $${p++}`);
        archiveParams.push(boardClientCheckpointUrl);
        archiveFields.push(`board_client_checkpoint_at = $${p++}`);
        archiveParams.push(Date.now());
      }
      if (archiveFields.length > 0) {
        archiveParams.push(liveClassId);
        await db.query(
          `UPDATE live_classes SET ${archiveFields.join(", ")} WHERE id = $${p}`,
          archiveParams
        );
      }

      if (!recordingUrl || isImageUrl(recordingUrl)) {
        const wasCompleted = lc.is_completed === true;
        const endedAt = Date.now();
        await db.query(
          `UPDATE live_classes 
           SET is_live = FALSE, is_completed = TRUE, ended_at = COALESCE(ended_at, $1)
           WHERE id = $2`,
          [endedAt, liveClassId]
        );
        const refreshed = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
        if (!wasCompleted) {
          await notifyAdminsLiveClassCompleted(db, refreshed.rows[0] || lc).catch((err) =>
            console.error("[Classroom] admin completion notify failed:", err)
          );
        }
        lectureIds = await convertLiveClassTitlePeersToLectures(db, refreshed.rows[0] || lc, {
          sectionTitleOverride: sectionTitle,
          recomputeCourseProgress: recomputeAllEnrollmentsProgressForCourse,
        });
      }

      const refreshed = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
      const row = refreshed.rows[0] || lc;

      res.json({
        success: true,
        recordingUrl: recordingUrl && !isImageUrl(recordingUrl) ? recordingUrl : null,
        boardSnapshotUrl: boardSnapshotUrl || row.board_snapshot_url || null,
        boardPdfUrl: row.board_pdf_url || boardPdfUrl || null,
        lectureIds,
        sectionTitle,
      });
    } catch (err: any) {
      console.error("[Classroom] finalize error:", err?.message || err);
      res.status(500).json({ message: err?.message || "Failed to finalize classroom session" });
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
