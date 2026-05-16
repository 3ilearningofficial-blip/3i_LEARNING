import { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { liveClassQueryKey } from "@/lib/query-keys";
import {
  getAdminChooseStreamRoute,
  getAdminLiveSessionRoute,
  getAdminSetupRoute,
} from "@/lib/live-stream/liveRoutes";
import { normalizeStreamType } from "@/lib/live-stream/types";
import Colors from "@/constants/colors";

/** Legacy route: redirect to the new live wizard. */
export default function StudioRedirectPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveClassId = String(id || "");

  const { data: liveClass, isLoading } = useQuery({
    queryKey: liveClassQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}`);
      if (!res.ok) throw new Error("not found");
      const payload = await res.json();
      return payload?.data ?? payload;
    },
    enabled: !!liveClassId,
    retry: false,
  });

  useEffect(() => {
    if (!liveClassId || isLoading) return;
    if (!liveClass) {
      router.replace(getAdminChooseStreamRoute(liveClassId) as any);
      return;
    }
    if (liveClass.is_live) {
      router.replace(getAdminLiveSessionRoute(liveClass) as any);
      return;
    }
    const type = normalizeStreamType(liveClass.stream_type);
    if (type) {
      router.replace(getAdminSetupRoute(liveClassId, type) as any);
    } else {
      router.replace(getAdminChooseStreamRoute(liveClassId) as any);
    }
  }, [liveClass, liveClassId, isLoading]);

  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={Colors.light.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
});
