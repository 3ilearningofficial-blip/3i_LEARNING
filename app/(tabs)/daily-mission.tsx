import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";
import { useLocalSearchParams, router } from "expo-router";
import MissionAttemptFlow from "@/components/mission/MissionAttemptFlow";
import {
  type DailyMission,
  type MissionQuestion,
  type MissionSessionResult,
  normalizeMission,
  formatMissionDate,
  uniqueTopicsAndSubtopicsFromQuestions,
  isMissionCompleted,
} from "@/lib/mission-types";
import type { MissionCompletePatch } from "@/lib/mission-cache";

const TABS = [
  { key: "all", label: "All" },
  { key: "daily_drill", label: "Daily Drills" },
  { key: "free_practice", label: "Free Practice" },
];

const MISSION_FOLDER_COLOR = "#DB2777";

export default function DailyMissionScreen() {
  useScreenProtection(true);
  const { colors, isDarkMode } = useAppTheme();
  if (isAndroidWeb()) return <AndroidWebGate />;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ openMissionId?: string }>();
  const [activeTab, setActiveTab] = useState("all");
  const [activeMission, setActiveMission] = useState<DailyMission | null>(null);
  const [completedThisSession, setCompletedThisSession] = useState<Set<number>>(new Set());
  const [sessionResults, setSessionResults] = useState<Record<number, MissionSessionResult>>({});

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  const { data: missions = [], isLoading } = useQuery<DailyMission[]>({
    queryKey: ["/api/daily-missions", activeTab],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/daily-missions?type=${activeTab}`, baseUrl);
      const res = await authFetch(url.toString());
      const payload = await res.json();
      return Array.isArray(payload) ? payload.map(normalizeMission) : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 25 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const openMissionHandledRef = useRef<string | null>(null);

  const { data: missionFolders = [] } = useQuery<any[]>({
    queryKey: ["/api/mission-folders"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/mission-folders", baseUrl);
      const res = await authFetch(url.toString());
      const payload = await res.json();
      return Array.isArray(payload) ? payload : [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 25 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { visibleFolders, ungroupedMissions, enrolledCourseCount } = useMemo(() => {
    const folderFullName = (folder: any) => String(folder.full_name || folder.name || "");
    const folderNames = new Set(missionFolders.map(folderFullName));
    const ungrouped = missions.filter((m) => !m.folder_name || !folderNames.has(m.folder_name));
    const courseIds = new Set<number>();
    for (const m of missions) {
      if (m.course_id != null && Number.isFinite(Number(m.course_id))) {
        courseIds.add(Number(m.course_id));
      }
    }
    const folders = missionFolders
      .filter((folder) => !folder.parent_id)
      .map((folder) => {
        const fullName = folderFullName(folder);
        const folderMissions = missions.filter((m) => m.folder_name === fullName || String(m.folder_name || "").startsWith(`${fullName} /`));
        return { folder, folderMissions };
      })
      .filter(({ folderMissions }) => folderMissions.length > 0);
    return {
      visibleFolders: folders,
      ungroupedMissions: ungrouped,
      enrolledCourseCount: courseIds.size,
    };
  }, [missions, missionFolders]);

  const folderCardSubtitle = (folderMissions: DailyMission[]) => {
    if (enrolledCourseCount <= 1) return null;
    const titles = [
      ...new Set(
        folderMissions
          .map((m) => (m.course_title ? String(m.course_title).trim() : ""))
          .filter(Boolean),
      ),
    ];
    if (titles.length === 0) return null;
    return titles.join(" · ");
  };

  const startMission = (mission: DailyMission) => {
    if (!isMissionCompleted(mission, completedThisSession) && !mission.isAccessible) {
      Alert.alert("Locked", "Purchase a course to access this mission.");
      return;
    }
    setActiveMission(mission);
  };

  const handleMissionCompleted = (data: MissionCompletePatch) => {
    setCompletedThisSession((prev) => new Set(prev).add(data.missionId));
    setSessionResults((prev) => ({
      ...prev,
      [data.missionId]: {
        score: data.score,
        timeTaken: data.timeTaken,
        answers: data.answers,
        incorrect: data.incorrect,
        skipped: data.skipped,
      },
    }));
    setActiveMission((prev) =>
      prev && prev.id === data.missionId
        ? {
            ...prev,
            isCompleted: true,
            userScore: data.score,
            userTimeTaken: data.timeTaken,
            userAnswers: data.answers as any,
            userIncorrect: data.incorrect,
            userSkipped: data.skipped,
          }
        : prev,
    );
    qc.invalidateQueries({ queryKey: ["/api/daily-missions", activeTab] });
  };

  useEffect(() => {
    const raw = params.openMissionId ? String(params.openMissionId) : "";
    if (!raw || isLoading || activeMission) return;
    if (openMissionHandledRef.current === raw) return;

    const tryOpen = (list: DailyMission[]) => {
      const found = list.find((m) => m.id === Number(raw));
      if (!found) return false;
      openMissionHandledRef.current = raw;
      startMission(found);
      router.setParams({ openMissionId: "" } as any);
      return true;
    };

    if (tryOpen(missions)) return;

    const baseUrl = getApiUrl();
    authFetch(new URL("/api/daily-missions?type=all", baseUrl).toString())
      .then((res) => res.json())
      .then((payload) => {
        const all = Array.isArray(payload) ? payload.map(normalizeMission) : [];
        tryOpen(all);
      })
      .catch(() => {});
  }, [params.openMissionId, isLoading, missions, activeMission]);

  if (activeMission) {
    return (
      <MissionAttemptFlow
        mission={activeMission}
        onExit={() => setActiveMission(null)}
        sessionResult={sessionResults[activeMission.id]}
        onCompleted={handleMissionCompleted}
      />
    );
  }

  const renderMissionCard = (item: DailyMission) => {
    const questions: MissionQuestion[] = Array.isArray(item.questions) ? item.questions : [];
    const qCount = questions.length;
    const isLocked = !item.isAccessible;
    const isCompleted = isMissionCompleted(item, completedThisSession);
    const sessionData = sessionResults[item.id];
    const typeLabel = item.mission_type === "free_practice" ? "Free" : "Paid";
    const typeColor = item.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
    const totalMarks = questions.reduce((s: number, q: MissionQuestion) => s + (q.marks || 0), 0);
    const totalTimeSecs = questions.reduce((s: number, q: MissionQuestion) => s + (q.time_limit || 0), 0);
    const { topics, subtopics } = uniqueTopicsAndSubtopicsFromQuestions(questions);
    return (
      <Pressable
        key={item.id}
        style={[styles.missionListCard, { backgroundColor: colors.card, borderColor: colors.border }, isLocked && styles.missionLocked, isCompleted && styles.missionDone]}
        onPress={() => startMission(item)}
      >
        {isCompleted &&
          (() => {
            const rawAns = sessionData?.answers || item.userAnswers || {};
            const displayScore = sessionData?.score ?? item.userScore ?? 0;
            const earnedMarks =
              totalMarks > 0
                ? questions.reduce((s: number, q: MissionQuestion) => {
                    const ans = (rawAns as any)[q.id] ?? (rawAns as any)[String(q.id)];
                    return ans === q.correct ? s + (q.marks || 0) : s;
                  }, 0)
                : null;
            return (
              <View style={styles.attemptedBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#15803D" />
                <Text style={styles.attemptedBannerText}>
                  Attempted · {displayScore}/{qCount} correct
                  {earnedMarks !== null ? ` · ${earnedMarks}/${totalMarks} marks` : ""}
                </Text>
                <Ionicons name="chevron-forward" size={14} color="#15803D" style={{ marginLeft: "auto" as any }} />
              </View>
            );
          })()}
        <View style={styles.missionListTop}>
          <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
            <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
          </View>
          {isLocked && (
            <Ionicons name="lock-closed" size={16} color={colors.textMuted} style={{ marginLeft: "auto" as any }} />
          )}
          <Text style={[styles.missionDate, { color: colors.textMuted }]}>{formatMissionDate(item.mission_date)}</Text>
        </View>
        <Text style={[styles.missionListTitle, { color: colors.text }]}>{item.title}</Text>
        {item.description ? (
          <Text style={[styles.missionListDesc, { color: colors.textMuted }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        {!isCompleted && (
          <View style={styles.missionListFooter}>
            <View style={styles.missionListStat}>
              <Ionicons name="help-circle-outline" size={13} color={colors.textMuted} />
              <Text style={[styles.missionListStatText, { color: colors.textMuted }]}>{qCount} Qs</Text>
            </View>
            {totalMarks > 0 && (
              <View style={styles.missionListStat}>
                <Ionicons name="star-outline" size={13} color="#F59E0B" />
                <Text style={[styles.missionListStatText, { color: colors.textMuted }]}>{totalMarks} marks</Text>
              </View>
            )}
            {totalTimeSecs > 0 && (
              <View style={styles.missionListStat}>
                <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                <Text style={[styles.missionListStatText, { color: colors.textMuted }]}>{Math.ceil(totalTimeSecs / 60)} min</Text>
              </View>
            )}
          </View>
        )}
        {(topics.length > 0 || subtopics.length > 0) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {topics.map((t) => (
              <View key={`t-${t}`} style={styles.topicChip}>
                <Text style={styles.topicChipText}>{t}</Text>
              </View>
            ))}
            {subtopics.map((s) => (
              <View key={`s-${s}`} style={[styles.topicChip, { backgroundColor: "#F3E8FF" }]}>
                <Text style={[styles.topicChipText, { color: "#7C3AED" }]}>{s}</Text>
              </View>
            ))}
          </View>
        )}
      </Pressable>
    );
  };

  const hasAnyMissions = visibleFolders.length > 0 || ungroupedMissions.length > 0;

  const openMissionFolder = (folderName: string) => {
    router.push({
      pathname: "/mission-folder/[name]",
      params: { name: encodeURIComponent(folderName), type: activeTab },
    } as any);
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding, backgroundColor: colors.background }]}>
      <LinearGradient colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]} style={styles.headerGradient}>
        <Text style={styles.headerTitle}>Daily Missions</Text>
        <Text style={styles.headerSub}>Practice every day · attempt once</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((tab) => (
            <Pressable key={tab.key} style={[styles.tab, activeTab === tab.key && styles.tabActive]} onPress={() => setActiveTab(tab.key)}>
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      ) : !hasAnyMissions ? (
        <View style={styles.emptyState}>
          <Ionicons name="flame-outline" size={60} color={colors.textMuted} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No Missions Available</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>Check back later for new practice missions!</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 100, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {visibleFolders.map(({ folder, folderMissions }) => {
            const subtitle = folderCardSubtitle(folderMissions);
            const completedInFolder = folderMissions.filter((m) => isMissionCompleted(m, completedThisSession)).length;
            return (
              <Pressable
                key={folder.id}
                style={[styles.folderCard, { borderLeftColor: MISSION_FOLDER_COLOR }]}
                onPress={() => openMissionFolder(String(folder.full_name || folder.name))}
              >
                <View style={[styles.folderIconWrap, { backgroundColor: MISSION_FOLDER_COLOR + "18" }]}>
                  <Ionicons name="folder" size={22} color={MISSION_FOLDER_COLOR} />
                </View>
                <View style={styles.folderCardBody}>
                  <Text style={styles.folderCardTitle} numberOfLines={2}>
                    {folder.name}
                  </Text>
                  {subtitle ? (
                    <Text style={styles.folderCardCourse} numberOfLines={2}>
                      {subtitle}
                    </Text>
                  ) : null}
                  <Text style={styles.folderCardMeta}>
                    {folderMissions.length} mission{folderMissions.length === 1 ? "" : "s"}
                    {completedInFolder > 0 ? ` · ${completedInFolder} done` : ""}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
              </Pressable>
            );
          })}

          {ungroupedMissions.map((m) => renderMissionCard(m))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerGradient: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, gap: 6 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  tabsRow: { gap: 8, marginTop: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  tabTextActive: { color: Colors.light.primary },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  missionListCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: Colors.light.border },
  missionLocked: { opacity: 0.55 },
  missionDone: { borderColor: "#22C55E", borderWidth: 1.5 },
  attemptedBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    marginBottom: 4,
  },
  attemptedBannerText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#15803D", flex: 1 },
  missionListTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  missionDate: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  missionListTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  missionListDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  missionListFooter: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  missionListStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  missionListStatText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_500Medium" },
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  folderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  folderCardBody: { flex: 1, gap: 2 },
  folderCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  folderCardCourse: { fontSize: 13, fontFamily: "Inter_500Medium", color: MISSION_FOLDER_COLOR },
  folderCardMeta: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  topicChip: { backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  topicChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
});
