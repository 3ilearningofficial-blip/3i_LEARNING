import { Platform } from "react-native";
import type { StoredAuthUser } from "@/lib/auth-storage";

export function getPostAuthPathForUser(
  user: Pick<StoredAuthUser, "role"> | null | undefined,
  opts?: { next?: string },
): string {
  const next = opts?.next;
  if (Platform.OS === "web" && typeof next === "string" && next.startsWith("/")) {
    return next === "/(tabs)" ? "/home" : next;
  }
  const role = String(user?.role || "student").toLowerCase();
  if (role === "admin") return "/admin";
  if (role === "teacher" || role === "manager") return "/staff";
  return Platform.OS === "web" ? "/home" : "/(tabs)";
}
