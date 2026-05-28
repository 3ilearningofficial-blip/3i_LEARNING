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
import { useScreenProtection } from "@/lib/useScreenProtection";

interface MissionQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  topic: string;
  subtopic?: string;
  marks?: number;
  time_limit?: number;
}

interface DailyMission {
  id: number;
  title: string;
  description: string;
  questions: MissionQuestion[];
  mission_type: string;
  mission_date: string;
  course_id?: number;
  course_title?: string | null;
  folder_name?: string | null;
  isCompleted?: boolean;
  userScore?: number;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function normalizeMission(raw: any): DailyMission {
  return {
    ...raw,
    questions: Array.isArray(raw?.questions) ? raw.questions : [],
  };
}

export default function MissionFolderScreen() {
  useScreenProtection(true);
  const { name, type } = useLocalSearchParams<{ name: string; type?: string }>();
  const folderName = decodeURIComponent(name || "");
  const missionType = type && type !== "undefined" ? type : "all";
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const { data: missions = [], isLoading } = useQuery<DailyMission[]>({
    queryKey: ["/api/daily-missions/folder", folderName, missionType],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(
        `/api/daily-missions/folder/${encodeURIComponent(folderName)}?type=${encodeURIComponent(missionType)}`,
        baseUrl,
      );
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      const payload = await res.json();
      return Array.isArray(payload) ? payload.map(normalizeMission) : [];
    },
    enabled: !!folderName,
    staleTime: 5 * 60 * 1000,
  });

  const showCourseOnCards = useMemo(() => {
    const courseIds = new Set<number>();
    for (const m of missions) {
      if (m.course_id != null && Number.isFinite(Number(m.course_id))) {
        courseIds.add(Number(m.course_id));
      }
    }
    return courseIds.size > 1;
  }, [missions]);

  const openMission = (missionId: number) => {
    router.push({
      pathname: "/(tabs)/daily-mission",
      params: { openMissionId: String(missionId) },
    } as any);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(tabs)/daily-mission" as any);
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.headerTitle} numberOfLines={2}>{folderName}</Text>
            <Text style={styles.headerSub}>
              {isLoading ? "Loading..." : `${missions.length} mission${missions.length === 1 ? "" : "s"}`}
            </Text>
          </View>
          <View style={styles.folderIconWrap}>
            <Ionicons name="folder-open" size={22} color="#DB2777" />
          </View>
        </View>
      </LinearGradient>

      {isLoading ? (
        <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />
      ) : missions.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="flame-outline" size={48} color={Colors.light.textMuted} />
          <Text style={styles.emptyTitle}>No missions yet</Text>
          <Text style={styles.emptySub}>Missions added to this folder will appear here</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 32 }}>
          {missions.map((item) => {
            const qCount = item.questions?.length || 0;
            const isCompleted = item.isCompleted || (item.userScore !== undefined && item.userScore > 0);
            const typeLabel = item.mission_type === "free_practice" ? "Free" : "Paid";
            const typeColor = item.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
            const totalMarks = (item.questions || []).reduce((s, q) => s + (q.marks || 0), 0);
            return (
              <Pressable
                key={item.id}
                style={[styles.card, isCompleted && styles.cardDone]}
                onPress={() => openMission(item.id)}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                    <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
                  </View>
                  <Text style={styles.cardDate}>{formatDate(item.mission_date)}</Text>
                </View>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {showCourseOnCards && item.course_title ? (
                  <Text style={styles.cardCourse} numberOfLines={1}>{item.course_title}</Text>
                ) : null}
                {item.description ? (
                  <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
                ) : null}
                <View style={styles.cardMeta}>
                  <Text style={styles.cardMetaText}>{qCount} Qs</Text>
                  {totalMarks > 0 ? <Text style={styles.cardMetaText}> · {totalMarks} marks</Text> : null}
                  {isCompleted ? (
                    <Text style={[styles.cardMetaText, { color: "#15803D", marginLeft: "auto" as any }]}>
                      Attempted · {item.userScore ?? 0}/{qCount}
                    </Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} style={styles.cardChevron} />
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.5)" },
  folderIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "#FCE7F3", alignItems: "center", justifyContent: "center",
  },
  empty: { alignItems: "center", paddingTop: 60, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySub: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: {
    backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 6,
    borderWidth: 1, borderColor: Colors.light.border,
  },
  cardDone: { borderColor: "#22C55E", borderWidth: 1.5 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardDate: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text, paddingRight: 24 },
  cardCourse: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  cardDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  cardMetaText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_500Medium" },
  cardChevron: { position: "absolute", right: 14, top: "50%" as any, marginTop: -9 },
});
