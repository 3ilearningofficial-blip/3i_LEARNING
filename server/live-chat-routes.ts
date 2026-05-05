import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { userCanAccessLiveClassContent } from "./live-class-access";
import { releaseSseListen, tryAcquireSseListen } from "./sse-listen-budget";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterLiveChatRoutesDeps = {
  app: Express;
  db: DbClient;
  listenPool: Pool;
  getAuthUser: (req: Request) => Promise<{ id: number; role: string } | null>;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

async function checkLiveClassAccess(
  req: Request,
  res: Response,
  db: DbClient,
  getAuthUser: (req: Request) => Promise<{ id: number; role: string } | null>,
  liveClassId: string
): Promise<boolean> {
  const lc = await db.query("SELECT * FROM live_classes WHERE id = $1", [liveClassId]);
  if (lc.rows.length === 0) {
    res.status(404).json({ message: "Live class not found" });
    return false;
  }

  const liveClass = lc.rows[0];
  const reqUser = (req as any).user as { id: number; role: string } | undefined;
  const user = reqUser || (await getAuthUser(req));
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return false;
  }
  const allow = await userCanAccessLiveClassContent(db, user, liveClass);
  if (!allow) {
    res.status(403).json({ message: "Not enrolled" });
    return false;
  }
  return true;
}

export function registerLiveChatRoutes({
  app,
  db,
  listenPool,
  getAuthUser,
  requireAuth,
  requireAdmin,
}: RegisterLiveChatRoutesDeps): void {
  const listenPoolMax = listenPool.options.max ?? 32;

  app.get("/api/live-classes/:id/chat", async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db, getAuthUser, req.params.id as string);
      if (!hasAccess) return;
      const { after } = req.query;
      let query = "SELECT * FROM live_chat_messages WHERE live_class_id = $1";
      const params: unknown[] = [req.params.id];
      if (after) {
        params.push(after);
        query += ` AND created_at > $${params.length}`;
      }
      query += " ORDER BY created_at ASC LIMIT 200";
      const result = await db.query(query, params);
      res.set("Cache-Control", "private, no-store");
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch chat" });
    }
  });

  /** Server-Sent Events: pushes new rows via PostgreSQL NOTIFY (see migration 0011). Uses listenPool + global cap so LISTEN does not exhaust the main API pool. */
  app.get("/api/live-classes/:id/chat/stream", requireAuth, async (req: Request, res: Response) => {
    const hasAccess = await checkLiveClassAccess(req, res, db, getAuthUser, req.params.id as string);
    if (!hasAccess) return;

    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }

    const liveClassIdStr = String(req.params.id);
    let closed = false;
    let listenClient: PoolClient | null = null;

    const cleanup = async () => {
      if (closed) return;
      closed = true;
      releaseSseListen();
      const c = listenClient;
      listenClient = null;
      if (!c) return;
      try {
        c.removeAllListeners("notification");
        await c.query("UNLISTEN live_chat");
      } catch {
        /* ignore */
      }
      try {
        c.release();
      } catch {
        /* ignore */
      }
    };

    try {
      listenClient = await listenPool.connect();
    } catch (e) {
      console.error("[LiveChat SSE] listen pool connect failed", e);
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    (res as any).flushHeaders?.();

    const onNotify = (msg: { channel?: string; payload?: string }) => {
      if (closed) return;
      void (async () => {
        try {
          const payload = JSON.parse(String(msg.payload || "{}")) as { liveClassId?: unknown; id?: unknown };
          if (String(payload.liveClassId ?? "") !== liveClassIdStr) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db.query(
            "SELECT * FROM live_chat_messages WHERE id = $1 AND live_class_id = $2 LIMIT 1",
            [mid, liveClassIdStr]
          );
          if (row.rows.length === 0) return;
          res.write(`data: ${JSON.stringify(row.rows[0])}\n\n`);
        } catch {
          /* ignore */
        }
      })();
    };

    const conn = listenClient;
    if (!conn) {
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    conn.on("notification", onNotify);
    try {
      await conn.query("LISTEN live_chat");
    } catch (e) {
      console.error("[LiveChat SSE] LISTEN failed", e);
      await cleanup();
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: "Realtime unavailable" })}\n\n`);
      } catch {
        /* ignore */
      }
      res.end();
      return;
    }

    const ping = setInterval(() => {
      if (closed) return;
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      void cleanup();
    });

    try {
      res.write(": stream ok\n\n");
    } catch {
      void cleanup();
    }
  });

  app.post("/api/live-classes/:id/chat", requireAuth, async (req: Request, res: Response) => {
    try {
      const hasAccess = await checkLiveClassAccess(req, res, db, getAuthUser, req.params.id as string);
      if (!hasAccess) return;
      const { message } = req.body;
      if (!message || !message.trim()) return res.status(400).json({ message: "Message is required" });
      const user = (req as any).user;
      const result = await db.query(
        `INSERT INTO live_chat_messages (live_class_id, user_id, user_name, message, is_admin, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [req.params.id, user.id, user.name || user.phone, message.trim().slice(0, 500), user.role === "admin", Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.delete("/api/admin/live-classes/:lcId/chat/:msgId", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query("DELETE FROM live_chat_messages WHERE id = $1 AND live_class_id = $2", [req.params.msgId, req.params.lcId]);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete message" });
    }
  });
}
