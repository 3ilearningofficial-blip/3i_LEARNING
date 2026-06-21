import type { Express, Request, Response } from "express";
import { notifyAdminsAppInstall, notifyAdminsCaptureAttempt } from "./notification-utils";

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type RegisterAdminOpsRoutesDeps = {
  app: Express;
  db: DbClient;
  getAuthUser: (req: Request) => Promise<any>;
};

export function registerAdminOpsRoutes({ app, db, getAuthUser }: RegisterAdminOpsRoutesDeps): void {
  app.post("/api/analytics/app-install", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      if (String(user.role || "") !== "student") return res.json({ ok: true });

      const platform = String(req.body?.platform || "unknown").trim().slice(0, 32);
      const isPwa = req.body?.isPwa === true || req.body?.isPwa === "true";
      const userName = String(user.name || user.phone || user.email || `Student #${user.id}`);

      await notifyAdminsAppInstall(db, {
        userId: Number(user.id),
        userName,
        platform,
        isPwa,
      }).catch((err) => console.error("[AppInstall] admin notify failed:", err));

      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });

  app.post("/api/security/capture-attempt", async (req: Request, res: Response) => {
    try {
      const user = await getAuthUser(req);
      if (!user) return res.json({ ok: true });
      if (String(user.role || "") === "admin") return res.json({ ok: true });

      const kind = req.body?.kind === "recording" ? "recording" : "screenshot";
      const context = String(req.body?.context || "protected content").trim().slice(0, 120);
      const userName = String(user.name || user.phone || user.email || `Student #${user.id}`);

      await notifyAdminsCaptureAttempt(db, {
        userId: Number(user.id),
        userName,
        context,
        kind,
      }).catch((err) => console.error("[CaptureAttempt] admin notify failed:", err));

      res.json({ ok: true });
    } catch {
      res.json({ ok: true });
    }
  });
}
