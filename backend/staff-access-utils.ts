import type { Request } from "express";
import {
  mergePermissionOverrides,
  type StaffPermissionKey,
  isStaffRole,
} from "./staff-permissions";

export type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>;
};

export type StaffAssignment = {
  id: number;
  user_id: number;
  course_id: number;
  subject_key: string | null;
  assigned_at: number;
};

export class StaffAccessError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function getStaffAssignments(db: DbClient, userId: number): Promise<StaffAssignment[]> {
  const res = await db.query(
    `SELECT id, user_id, course_id, subject_key, assigned_at
     FROM staff_course_assignments
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY assigned_at DESC`,
    [userId],
  );
  return res.rows.map((r) => ({
    id: Number(r.id),
    user_id: Number(r.user_id),
    course_id: Number(r.course_id),
    subject_key: r.subject_key != null && String(r.subject_key).trim() !== "" ? String(r.subject_key) : null,
    assigned_at: Number(r.assigned_at || 0),
  }));
}

export function assignmentCoversSubject(a: StaffAssignment, subjectKey: string | null | undefined): boolean {
  if (a.subject_key == null) return true;
  if (subjectKey == null || String(subjectKey).trim() === "") return false;
  return String(a.subject_key).toLowerCase() === String(subjectKey).toLowerCase();
}

export function findAssignmentForCourse(
  assignments: StaffAssignment[],
  courseId: number,
  subjectKey?: string | null,
): StaffAssignment | null {
  const matches = assignments.filter((a) => a.course_id === courseId);
  if (matches.length === 0) return null;
  if (subjectKey != null && String(subjectKey).trim() !== "") {
    const exact = matches.find((a) => assignmentCoversSubject(a, subjectKey));
    if (exact) return exact;
    return null;
  }
  return matches[0] ?? null;
}

export async function getPermissionOverrides(db: DbClient, userId: number) {
  const res = await db.query(
    `SELECT permission_key, allowed FROM staff_permission_overrides WHERE user_id = $1`,
    [userId],
  );
  return res.rows as { permission_key: string; allowed: boolean }[];
}

export async function getEffectivePermissions(db: DbClient, userId: number, role: string) {
  const overrides = await getPermissionOverrides(db, userId);
  return mergePermissionOverrides(role, overrides);
}

export async function hasPermission(
  db: DbClient,
  userId: number,
  role: string,
  permission: StaffPermissionKey,
): Promise<boolean> {
  if (!isStaffRole(role)) return false;
  const perms = await getEffectivePermissions(db, userId, role);
  return !!perms[permission];
}

export async function assertCourseAssignment(
  db: DbClient,
  userId: number,
  courseId: number,
  opts?: { subjectKey?: string | null; permission?: StaffPermissionKey },
): Promise<StaffAssignment> {
  const assignments = await getStaffAssignments(db, userId);
  const assignment = findAssignmentForCourse(assignments, courseId, opts?.subjectKey);
  if (!assignment) {
    throw new StaffAccessError(403, "course_not_assigned", "You are not assigned to this course");
  }
  if (opts?.permission) {
    const roleRes = await db.query(`SELECT role FROM users WHERE id = $1 LIMIT 1`, [userId]);
    const role = String(roleRes.rows[0]?.role || "");
    const ok = await hasPermission(db, userId, role, opts.permission);
    if (!ok) {
      throw new StaffAccessError(403, "permission_denied", "Permission denied");
    }
  }
  return assignment;
}

/** For multi-subject writes: lock subject_key to assignment scope. */
export function resolveSubjectKeyForWrite(
  assignment: StaffAssignment,
  requestedSubjectKey: string | null | undefined,
): string | null {
  if (assignment.subject_key != null) return assignment.subject_key;
  if (requestedSubjectKey != null && String(requestedSubjectKey).trim() !== "") {
    return String(requestedSubjectKey).trim();
  }
  return null;
}

export function getClientPlatform(req: Request): string {
  const header = String(req.headers["x-app-platform"] || req.headers["x-platform"] || "").toLowerCase();
  if (header === "web" || header === "ios" || header === "android") return header;
  const ua = String(req.headers["user-agent"] || "").toLowerCase();
  if (ua.includes("expo") || ua.includes("okhttp") || ua.includes("cfnetwork")) {
    return "android";
  }
  return "web";
}

export async function assertLiveStartAllowed(
  db: DbClient,
  userId: number,
  role: string,
  req: Request,
): Promise<void> {
  const perms = await getEffectivePermissions(db, userId, role);
  if (!perms["live.start"]) {
    throw new StaffAccessError(403, "permission_denied", "Live start not permitted");
  }
  if (perms["live.start_web_only"] && getClientPlatform(req) !== "web") {
    throw new StaffAccessError(403, "live_web_only", "Start live classes from the web Teacher Portal");
  }
}

export async function logStaffActivity(
  db: DbClient,
  opts: {
    userId: number;
    action: string;
    entityType?: string;
    entityId?: string | number;
    courseId?: number | null;
    subjectKey?: string | null;
    meta?: Record<string, unknown>;
    req?: Request;
  },
): Promise<void> {
  try {
    const ip = opts.req ? String(opts.req.headers["x-forwarded-for"] || opts.req.socket?.remoteAddress || "") : "";
    const ua = opts.req ? String(opts.req.headers["user-agent"] || "") : "";
    await db.query(
      `INSERT INTO staff_activity_log
        (user_id, action, entity_type, entity_id, course_id, subject_key, meta, ip_address, user_agent, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        opts.userId,
        opts.action,
        opts.entityType ?? null,
        opts.entityId != null ? String(opts.entityId) : null,
        opts.courseId ?? null,
        opts.subjectKey ?? null,
        JSON.stringify(opts.meta ?? {}),
        ip.slice(0, 128),
        ua.slice(0, 512),
        Date.now(),
      ],
    );
  } catch {
    // non-fatal
  }
}

export function filterRowsBySubjectKey<T extends { subject_key?: string | null }>(
  rows: T[],
  assignment: StaffAssignment,
): T[] {
  if (assignment.subject_key == null) return rows;
  const sk = assignment.subject_key.toLowerCase();
  return rows.filter((r) => String(r.subject_key || "").toLowerCase() === sk);
}
