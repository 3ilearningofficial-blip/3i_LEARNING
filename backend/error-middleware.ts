import type { Express, Request, Response, NextFunction } from "express";

type IsTrustedOriginFn = (origin: string) => boolean;

export function setupErrorHandler(
  app: Express,
  isTrustedOrigin: IsTrustedOriginFn
): void {
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message =
      status >= 500 && process.env.NODE_ENV === "production"
        ? "Internal Server Error"
        : error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    const origin = req.get("origin");
    if (origin && isTrustedOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
    }

    return res.status(status).json({ message });
  });
}
