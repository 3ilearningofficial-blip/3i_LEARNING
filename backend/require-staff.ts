import type { Request, Response, NextFunction } from "express";
import { isStaffRole } from "./staff-permissions";

type AuthUser = {
  id: number;
  role: string;
};

type GetAuthUserFn = (req: Request) => Promise<AuthUser | null>;

export function createRequireStaff(getAuthUser: GetAuthUserFn) {
  return async function requireStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
    const user = await getAuthUser(req);
    if (!user || !isStaffRole(user.role)) {
      res.status(403).json({ message: "Staff access required" });
      return;
    }
    (req as Request & { user?: AuthUser }).user = user;
    next();
  };
}
