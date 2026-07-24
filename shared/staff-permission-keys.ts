/** Shared permission keys for staff UI (mirrors backend/staff-permissions.ts). */

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
