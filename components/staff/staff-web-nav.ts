import type { StaffPermissionKey } from "@/shared/staff-permission-keys";

export type StaffNavItem = {
  href: string;
  label: string;
  icon:
    | "home"
    | "person"
    | "book"
    | "document-text"
    | "flame"
    | "folder-open"
    | "hand-left";
  /** If set, show when any of these permissions is true. Omit = always visible for staff. */
  anyOf?: StaffPermissionKey[];
};

export const STAFF_WEB_NAV: StaffNavItem[] = [
  { href: "/staff", label: "Home", icon: "home" },
  { href: "/staff/profile", label: "Profile", icon: "person" },
  { href: "/staff/courses", label: "Courses", icon: "book" },
  {
    href: "/staff/tests",
    label: "Tests",
    icon: "document-text",
    anyOf: ["tests.create", "tests.edit"],
  },
  {
    href: "/staff/missions",
    label: "Missions",
    icon: "flame",
    anyOf: ["missions.create", "missions.edit"],
  },
  {
    href: "/staff/materials",
    label: "Materials",
    icon: "folder-open",
    anyOf: [
      "materials.course.create",
      "materials.course.edit",
      "materials.free.create",
      "materials.free.edit",
    ],
  },
  { href: "/staff/requests", label: "Requests", icon: "hand-left" },
];

export function filterStaffNav(
  items: StaffNavItem[],
  canAny: (...keys: StaffPermissionKey[]) => boolean,
): StaffNavItem[] {
  return items.filter((item) => {
    if (!item.anyOf || item.anyOf.length === 0) return true;
    return canAny(...item.anyOf);
  });
}
