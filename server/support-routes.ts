import type { Express, Request, Response } from "express";
import type { Pool, PoolClient } from "pg";
import { takeSupportPostSlotPg } from "./pg-rate-limit-store";
import { releaseSseListen, tryAcquireSseListen } from "./sse-listen-budget";

const SUPPORT_POST_WINDOW_MS = 10 * 60 * 1000;
const SUPPORT_POST_MAX = 20;

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type AuthUser = {
  id: number;
};

type RegisterSupportRoutesDeps = {
  app: Express;
  db: DbClient;
  pool: Pool;
  listenPool: Pool;
  getAuthUser: (req: Request) => Promise<AuthUser | null>;
  requireAuth: (req: Request, res: Response, next: () => void) => any;
  requireAdmin: (req: Request, res: Response, next: () => void) => any;
};

export function registerSupportRoutes({
  app,
  db,
  pool,
  listenPool,
  getAuthUser,
  requireAuth,
  requireAdmin,
}: RegisterSupportRoutesDeps): void {
  const listenPoolMax = listenPool.options.max ?? 32;

  app.get("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [user.id]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  /** SSE: new rows for the signed-in student (NOTIFY support_chat, migration 0012). */
  app.get("/api/support/messages/stream", requireAuth, async (req: Request, res: Response) => {
    const user = (req as any).user as { id: number };
    const myUserId = Number(user?.id);
    if (!Number.isFinite(myUserId)) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }

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
        await c.query("UNLISTEN support_chat");
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
      console.error("[Support SSE] listen pool connect failed", e);
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
          const payload = JSON.parse(String(msg.payload || "{}")) as { userId?: unknown; id?: unknown };
          if (Number(payload.userId) !== myUserId) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db.query("SELECT * FROM support_messages WHERE id = $1 AND user_id = $2 LIMIT 1", [mid, myUserId]);
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
      await conn.query("LISTEN support_chat");
    } catch (e) {
      console.error("[Support SSE] LISTEN failed", e);
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

  app.post("/api/support/messages/mark-read", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'admin' AND is_read = FALSE",
        [user.id]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to mark messages read" });
    }
  });

  app.post("/api/support/messages", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const slot = await takeSupportPostSlotPg(pool, user.id, SUPPORT_POST_WINDOW_MS, SUPPORT_POST_MAX);
      if (!slot.ok) {
        return res.status(429).json({
          message: `Too many messages. Try again in about ${slot.retryAfterSec} seconds.`,
        });
      }
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'user', $2, $3) RETURNING *",
        [user.id, message.trim().slice(0, 1000), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send message" });
    }
  });

  app.get("/api/admin/support/conversations", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const result = await db.query(`
        SELECT u.id AS user_id, u.name, u.email, u.phone,
               COUNT(sm.id) FILTER (WHERE sm.is_read = FALSE AND sm.sender = 'user') AS unread_count,
               MAX(sm.created_at) AS last_message_at,
               (SELECT message FROM support_messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_message
        FROM users u
        JOIN support_messages sm ON sm.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.phone
        ORDER BY last_message_at DESC
      `);
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch conversations" });
    }
  });

  app.get("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const result = await db.query(
        "SELECT * FROM support_messages WHERE user_id = $1 ORDER BY created_at ASC",
        [req.params.userId]
      );
      res.json(result.rows);
    } catch {
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  });

  /** SSE: new rows in the selected student thread (admin). */
  app.get("/api/admin/support/messages/:userId/stream", requireAdmin, async (req: Request, res: Response) => {
    const threadUserId = Number(req.params.userId);
    if (!Number.isFinite(threadUserId) || threadUserId <= 0) {
      return res.status(400).json({ message: "Invalid user" });
    }

    if (!tryAcquireSseListen(listenPoolMax)) {
      return res.status(503).json({ message: "Too many realtime connections; try again shortly." });
    }

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
        await c.query("UNLISTEN support_chat");
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
      console.error("[SupportAdmin SSE] listen pool connect failed", e);
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
          const payload = JSON.parse(String(msg.payload || "{}")) as { userId?: unknown; id?: unknown };
          if (Number(payload.userId) !== threadUserId) return;
          const mid = Number(payload.id);
          if (!Number.isFinite(mid)) return;
          const row = await db.query("SELECT * FROM support_messages WHERE id = $1 AND user_id = $2 LIMIT 1", [mid, threadUserId]);
          if (row.rows.length === 0) return;
          res.write(`data: ${JSON.stringify(row.rows[0])}\n\n`);
        } catch {
          /* ignore */
        }
      })();
    };

    const adminConn = listenClient;
    if (!adminConn) {
      releaseSseListen();
      return res.status(503).json({ message: "Realtime unavailable" });
    }
    adminConn.on("notification", onNotify);
    try {
      await adminConn.query("LISTEN support_chat");
    } catch (e) {
      console.error("[SupportAdmin SSE] LISTEN failed", e);
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

  app.post("/api/admin/support/messages/:userId/mark-read", requireAdmin, async (req: Request, res: Response) => {
    try {
      await db.query(
        "UPDATE support_messages SET is_read = TRUE WHERE user_id = $1 AND sender = 'user' AND is_read = FALSE",
        [req.params.userId]
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to mark messages read" });
    }
  });

  app.post("/api/admin/support/messages/:userId", requireAdmin, async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message?.trim()) return res.status(400).json({ message: "Message required" });
      const result = await db.query(
        "INSERT INTO support_messages (user_id, sender, message, created_at) VALUES ($1, 'admin', $2, $3) RETURNING *",
        [req.params.userId, message.trim().slice(0, 1000), Date.now()]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ message: "Failed to send reply" });
    }
  });
}
