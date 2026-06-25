import React, { useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import {
  normalizeMission,
  type DailyMission,
  isMissionCompleted,
  missionHasRealQuestions,
} from "@/lib/mission-types";
import { getContentFolderRootName } from "@shared/recordingSection";

const MISSION_COLOR = "#0F766E";

export default function CourseMissionFolderScreen() {
  useScreenProtection(true);
  const { colors, isDarkMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    courseId: string;
    name: string;
    subjectKey?: string;
  }>();
  const courseId = String(params.courseId || "");
  const folderName = decodeURIComponent(String(params.name || ""));
  const subjectKey = String(params.subjectKey || "").trim().toLowerCase();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  const { data: missions = [], isLoading } = useQuery<DailyMission[]>({
    queryKey: ["/api/daily-missions", "course", courseId],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/daily-missions?type=all", getApiUrl()).toString());
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows
        .map(normalizeMission)
        .filter((m) => Number(m.course_id) === Number(courseId))
        .filter((m) => missionHasRealQuestions(m));
    },
    enabled: !!courseId && courseId !== "undefined",
    staleTime: 0,
  });

  const folderMissions = useMemo(() => {
    return missions.filter((m) => {
      if (subjectKey && String(m.subject_key || "").toLowerCase() !== subjectKey) return false;
      const root = getContentFolderRootName(m.folder_name);
      if (root !== folderName) return false;
      return m.folder_name === folderName || String(m.folder_name || "").startsWith(`${folderName} /`);
    });
  }, [missions, folderName, subjectKey]);

  const openMission = (missionId: number) => {
    router.push({
      pathname: "/course-mission/[id]",
      params: { id: String(missionId), courseId },
    } as any);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
        style={[styles.header, { paddingTop: topPadding + 8 }]}
      >
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace(`/course/${courseId}` as any);
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.headerTitle} numberOfLines={2}>{folderName}</Text>
            <Text style={styles.headerSub}>
              {isLoading ? "Loading..." : `${folderMissions.length} mission${folderMissions.length === 1 ? "" : "s"}`}
            </Text>
          </View>
          <View style={[styles.folderIconWrap, { backgroundColor: MISSION_COLOR + "30" }]}>
            <Ionicons name="folder-open" size={22} color={MISSION_COLOR} />
          </View>
        </View>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : folderMissions.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="flag-outline" size={48} color={colors.textMuted} />
          <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: colors.textMuted }}>No missions in this folder</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 40, gap: 0 }}>
          {folderMissions.map((mission) => {
            const qCount = mission.questions.filter((q) => String(q.question || "").trim()).length;
            const done = isMissionCompleted(mission);
            return (
              <Pressable
                key={mission.id}
                style={[styles.row, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
                onPress={() => openMission(mission.id)}
              >
                <View style={[styles.colorBar, { backgroundColor: MISSION_COLOR }]} />
                <View style={styles.iconWrap}>
                  <Ionicons name="flag" size={22} color={MISSION_COLOR} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.title, { color: colors.text }]}>{mission.title}</Text>
                  <Text style={[styles.meta, { color: colors.textMuted }]}>
                    {qCount} {qCount === 1 ? "question" : "questions"} · {mission.xp_reward || 50} XP
                  </Text>
                </View>
                {done ? (
                  <View style={styles.doneBadge}>
                    <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                    <Text style={styles.doneBadgeText}>
                      {mission.userScore ?? 0}/{qCount}
                    </Text>
                  </View>
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)" },
  folderIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    paddingVertical: 14,
    paddingRight: 12,
  },
  colorBar: { width: 4, alignSelf: "stretch", borderRadius: 2, marginRight: 12 },
  iconWrap: { width: 40, alignItems: "center", marginRight: 8 },
  title: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#DCFCE7",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  doneBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" },
});
