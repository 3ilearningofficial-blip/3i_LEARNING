import type { Request, Response } from "express";

const AUTH_FAILURE_KEY = "__auth_failure";

export type AuthFailure = {
  code: string;
  activePlatform?: string;
};

export function setAuthFailure(req: Request, failure: AuthFailure | null): void {
  const r = req as unknown as Record<string, unknown>;
  if (failure) {
    r[AUTH_FAILURE_KEY] = failure;
  } else {
    delete r[AUTH_FAILURE_KEY];
  }
}

export function getAuthFailure(req: Request): AuthFailure | null {
  const f = (req as unknown as Record<string, unknown>)[AUTH_FAILURE_KEY];
  if (!f || typeof f !== "object") return null;
  const row = f as AuthFailure;
  return row.code ? row : null;
}

/** If platform/session binding failed, respond 403 and return true. */
export function respondAuthFailureIfAny(req: Request, res: Response): boolean {
  const f = getAuthFailure(req);
  if (f?.code === "SESSION_PLATFORM_MISMATCH") {
    res.status(403).json({
      message: "Please log in again on this browser or app.",
      code: f.code,
      activePlatform: f.activePlatform,
    });
    return true;
  }
  return false;
}
