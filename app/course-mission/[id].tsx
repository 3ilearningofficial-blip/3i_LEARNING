import React from "react";
import { View, ActivityIndicator, Text, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import MissionAttemptFlow from "@/components/mission/MissionAttemptFlow";
import { normalizeMission, type DailyMission } from "@/lib/mission-types";
import type { MissionCompletePatch } from "@/lib/mission-cache";

export default function CourseMissionScreen() {
  useScreenProtection(true);
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ id: string; courseId?: string }>();
  const missionId = String(params.id || "");
  const courseId = params.courseId ? String(params.courseId) : "";

  const { data: mission, isLoading, error } = useQuery<DailyMission>({
    queryKey: ["/api/daily-missions", missionId],
    queryFn: async () => {
      const cached = courseId
        ? qc.getQueryData<DailyMission[]>(["/api/daily-missions", "course", courseId])
        : undefined;
      const fromCache = cached?.find((m) => String(m.id) === missionId);
      if (fromCache) return fromCache;

      const res = await authFetch(new URL(`/api/daily-missions/${missionId}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed to load mission");
      const payload = await res.json();
      return normalizeMission(payload);
    },
    enabled: !!missionId && missionId !== "undefined",
    staleTime: 0,
  });

  const handleCompleted = (data: MissionCompletePatch) => {
    qc.invalidateQueries({ queryKey: ["/api/daily-missions", "course", courseId] });
    qc.invalidateQueries({ queryKey: ["/api/daily-missions", missionId] });
  };

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (error || !mission) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Mission not found</Text>
        <Pressable
          onPress={() => router.back()}
          style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.light.primary, borderRadius: 10 }}
        >
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <MissionAttemptFlow
      mission={mission}
      onExit={() => router.back()}
      onCompleted={handleCompleted}
    />
  );
}
