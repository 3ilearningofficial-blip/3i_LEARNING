import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import type { StaffPermissionKey } from "@/shared/staff-permission-keys";

export type StaffPermissionsMap = Partial<Record<StaffPermissionKey, boolean>>;

type StaffMeResponse = {
  permissions?: StaffPermissionsMap;
};

export function useStaffPermissions() {
  const { isStaff } = useAuth();
  const query = useQuery({
    queryKey: ["/api/staff/me"],
    queryFn: async (): Promise<StaffMeResponse> => {
      const res = await authFetch(new URL("/api/staff/me", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed to load staff permissions");
      return res.json();
    },
    enabled: isStaff,
    staleTime: 30_000,
  });

  const permissions = query.data?.permissions || {};
  const ready = !!query.data && !query.isLoading;

  // While permissions are loading, keep nav visible (defaults are permissive for teachers).
  const can = (key: StaffPermissionKey): boolean => {
    if (!ready) return true;
    return permissions[key] === true;
  };

  const canAny = (...keys: StaffPermissionKey[]): boolean => {
    if (!ready) return true;
    return keys.some((k) => permissions[k] === true);
  };

  return {
    permissions,
    can,
    canAny,
    isLoading: query.isLoading,
    ready,
    refetch: query.refetch,
  };
}
