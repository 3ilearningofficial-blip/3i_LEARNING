/** Permission keys for staff RBAC. Teacher defaults; manager template reserved for Phase 6. */

export const STAFF_PERMISSION_KEYS = [
  "live.schedule",
  "live.start",
  "live.start_web_only",
  "tests.create",
  "tests.edit",
  "tests.delete",
  "materials.course.create",
  "materials.course.edit",
  "materials.course.delete",
  "materials.free.create",
  "materials.free.edit",
  "materials.free.delete",
  "materials.youtube",
  "folders.create",
  "folders.delete",
  "missions.create",
  "missions.edit",
  "missions.delete",
  "lectures.upload_recording",
  "course.settings.edit",
  "analytics.view",
  "users.manage",
] as const;

export type StaffPermissionKey = (typeof STAFF_PERMISSION_KEYS)[number];

const TEACHER_DEFAULTS: Record<StaffPermissionKey, boolean> = {
  "live.schedule": true,
  "live.start": true,
  "live.start_web_only": true,
  "tests.create": true,
  "tests.edit": true,
  "tests.delete": false,
  "materials.course.create": true,
  "materials.course.edit": true,
  "materials.course.delete": false,
  "materials.free.create": true,
  "materials.free.edit": true,
  "materials.free.delete": true,
  "materials.youtube": false,
  "folders.create": true,
  "folders.delete": false,
  "missions.create": true,
  "missions.edit": true,
  "missions.delete": false,
  "lectures.upload_recording": false,
  "course.settings.edit": false,
  "analytics.view": false,
  "users.manage": false,
};

export const STAFF_ROLES = ["teacher", "manager"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: string): role is StaffRole {
  return STAFF_ROLES.includes(role as StaffRole);
}

export function getDefaultPermissionsForRole(role: string): Record<StaffPermissionKey, boolean> {
  if (role === "manager") {
    return {
      ...TEACHER_DEFAULTS,
      "analytics.view": true,
      "users.manage": false,
    };
  }
  return { ...TEACHER_DEFAULTS };
}

export function mergePermissionOverrides(
  role: string,
  overrides: { permission_key: string; allowed: boolean }[],
): Record<StaffPermissionKey, boolean> {
  const base = getDefaultPermissionsForRole(role);
  for (const o of overrides) {
    const key = o.permission_key as StaffPermissionKey;
    if (key in base) base[key] = o.allowed;
  }
  return base;
}
