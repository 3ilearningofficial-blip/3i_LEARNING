import type { Request, Response, NextFunction } from "express";

type AuthUser = {
  id: number;
  role: string;
};

type GetAuthUserFn = (req: Request) => Promise<AuthUser | null>;

export function createRequireAdmin(getAuthUser: GetAuthUserFn) {
  return async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = await getAuthUser(req);
    if (!user || user.role !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return;
    }
    (req as Request & { user?: AuthUser }).user = user;
    next();
  };
}
