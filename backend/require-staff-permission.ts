import type { Request, Response, NextFunction } from "express";
import type { DbClient } from "./staff-access-utils";
import { hasPermission as checkPerm } from "./staff-access-utils";
import type { StaffPermissionKey } from "./staff-permissions";

type AuthUser = { id: number; role: string };

export function createRequireStaffPermission(db: DbClient) {
  return function requireStaffPermission(permission: StaffPermissionKey) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const user = (req as Request & { user?: AuthUser }).user;
      if (!user) {
        res.status(403).json({ message: "Staff access required" });
        return;
      }
      const ok = await checkPerm(db, user.id, user.role, permission);
      if (!ok) {
        res.status(403).json({ message: "Permission denied", code: "permission_denied" });
        return;
      }
      next();
    };
  };
}
