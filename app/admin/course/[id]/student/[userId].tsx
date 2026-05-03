import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch } from "@/lib/query-client";

type StudentRow = {
  id?: number;
  user_id: number;
  user_name?: string;
  user_email?: string | null;
  user_phone?: string | null;
  progress_percent?: number;
  enrolled_at?: number | string | null;
  status?: string;
};

type LectureRow = {
  lecture_id: number;
  title: string;
  section_title?: string | null;
  watch_percent: number;
  is_completed: boolean;
  playback_sessions: number;
};

type LiveRow = {
  live_class_id: number;
  title: string;
  scheduled_at?: number | null;
  is_completed: boolean;
  is_live: boolean;
  present_during_live: boolean;
  recording_watch_percent: number;
  recording_playback_sessions: number;
  has_recording: boolean;
};

type TestRow = {
  test_id: number;
  title: string;
  total_questions: number | null;
  attempt_id: number | null;
  attempt_status: string | null;
  correct: number | null;
  incorrect: number | null;
  attempted: number | null;
  completed_at: number | null;
};

type MissionRow = {
  mission_id: number;
  title: string;
  mission_date: string | null;
  total_questions: number | null;
  is_completed: boolean;
  correct: number | null;
  incorrect: number | null;
  skipped: number | null;
};

type ReportTab = "lecturesLive" | "tests";

export default function AdminEnrollmentStudentDetailScreen() {
  const { id: courseId, userId } = useLocalSearchParams<{ id: string; userId: string }>();
  const insets = useSafeAreaInsets();
  const [reportTab, setReportTab] = useState<ReportTab>("lecturesLive");

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/admin/courses", courseId, "enrollment-detail", userId],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/admin/courses/${courseId}/enrollments/${userId}/detail`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.message || "Failed to load");
      }
      const payload = await res.json();
      return payload as {
        student: StudentRow;
        lectures: LectureRow[];
        liveClasses: LiveRow[];
        tests: TestRow[];
        missions: MissionRow[];
      };
    },
    enabled: !!courseId && !!userId,
  });

  const student = data?.student;
  const lectures = data?.lectures ?? [];
  const lives = data?.liveClasses ?? [];
  const tests = data?.tests ?? [];
  const missions = data?.missions ?? [];

  const lecturesLiveInner = (
    <>
      <Text style={styles.sectionLabel}>Recorded lectures</Text>
      {lectures.length === 0 ? (
        <Text style={styles.emptyHint}>No lectures in this course.</Text>
      ) : (
        lectures.map((lec) => {
          const wp = Number(lec.watch_percent) || 0;
          const firstPass = wp > 0 && wp < 100 && !lec.is_completed;
          return (
            <View key={`l-${lec.lecture_id}`} style={styles.card}>
              {!!lec.section_title?.trim() && (
                <Text style={styles.cardFolder} numberOfLines={1}>{lec.section_title}</Text>
              )}
              <Text style={styles.cardTitle} numberOfLines={2}>{lec.title}</Text>
              <Text style={styles.cardLine}>
                Current progress:{" "}
                <Text style={styles.cardEm}>{wp}%</Text>
                {firstPass ? " · first-pass in progress" : lec.is_completed ? " · completed" : wp <= 0 ? " · not started" : ""}
              </Text>
              <Text style={styles.cardLine}>
                Playback opens (debounced):{" "}
                <Text style={styles.cardEm}>{Number(lec.playback_sessions) || 0}</Text>
                {" "}— counts separate visits to the lecture player (~8 min apart)
              </Text>
            </View>
          );
        })
      )}
      <Text style={[styles.sectionLabel, { marginTop: lecturingGap(lectures.length) }]}>Live classes</Text>
      {lives.length === 0 ? (
        <Text style={styles.emptyHint}>No live classes for this course.</Text>
      ) : (
        lives.map((lc) => (
          <View key={`lc-${lc.live_class_id}`} style={styles.card}>
            <Text style={styles.cardTitle} numberOfLines={2}>{lc.title}</Text>
            <Text style={styles.cardLine}>
              Present during live (opened class & heartbeat):{" "}
              <Text style={styles.cardEm}>{lc.present_during_live ? "Yes" : "No"}</Text>
            </Text>
            {lc.has_recording ? (
              <>
                <Text style={styles.cardLine}>
                  Recording replay opens:{" "}
                  <Text style={styles.cardEm}>{Number(lc.recording_playback_sessions) || 0}</Text>
                </Text>
                <Text style={styles.cardLine}>
                  Best recording watch progress:{" "}
                  <Text style={styles.cardEm}>{Number(lc.recording_watch_percent) || 0}%</Text>
                </Text>
              </>
            ) : (
              <Text style={styles.cardMuted}>No recording published yet.</Text>
            )}
          </View>
        ))
      )}
    </>
  );

  const testsInner = (
    <>
      <Text style={styles.sectionLabel}>Daily missions (this course)</Text>
      {missions.length === 0 ? (
        <Text style={styles.emptyHint}>No course-linked daily missions yet.</Text>
      ) : (
        missions.map((m) => {
          const totalQ = m.total_questions != null ? Number(m.total_questions) : null;
          const done = !!m.is_completed;
          return (
            <View key={`m-${m.mission_id}`} style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={2}>{m.title}</Text>
              {m.mission_date ? (
                <Text style={styles.cardMuted}>Date: {m.mission_date}</Text>
              ) : null}
              {totalQ != null && (
                <Text style={styles.cardLine}>
                  Total questions: <Text style={styles.cardEm}>{totalQ}</Text>
                </Text>
              )}
              <Text style={styles.cardLine}>
                Status:{" "}
                <Text style={styles.cardEm}>{done ? "Completed" : "Not completed"}</Text>
              </Text>
              {done ? (
                <>
                  <Text style={styles.cardLine}>
                    Correct: <Text style={styles.cardEm}>{m.correct != null ? m.correct : "—"}</Text>
                    {" · "}Incorrect: <Text style={styles.cardEm}>{m.incorrect != null ? m.incorrect : "—"}</Text>
                  </Text>
                  {m.skipped != null && Number(m.skipped) > 0 && (
                    <Text style={styles.cardMuted}>Skipped: {m.skipped}</Text>
                  )}
                </>
              ) : (
                <Text style={styles.cardMuted}>Student has not submitted this mission yet.</Text>
              )}
            </View>
          );
        })
      )}
      <Text style={[styles.sectionLabel, { marginTop: missions.length > 0 ? 16 : 8 }]}>Tests</Text>
      {tests.length === 0 ? (
        <Text style={styles.emptyHint}>No tests in this course.</Text>
      ) : (
        tests.map((t) => {
          const attempted = t.attempt_id != null && (t.attempt_status === "completed" || t.attempt_status === "in_progress");
          const totalQ = t.total_questions != null ? Number(t.total_questions) : null;
          return (
            <View key={`t-${t.test_id}`} style={styles.card}>
              <Text style={styles.cardTitle} numberOfLines={2}>{t.title}</Text>
              {!attempted ? (
                <Text style={styles.cardLine}>
                  Status: <Text style={styles.cardEm}>Not attempted</Text>
                </Text>
              ) : (
                <>
                  <Text style={styles.cardLine}>
                    Attempted: <Text style={styles.cardEm}>Yes</Text>
                    {t.attempt_status === "completed" ? " (submitted)" : " (in progress)"}
                  </Text>
                  {totalQ != null && (
                    <Text style={styles.cardLine}>
                      Total questions: <Text style={styles.cardEm}>{totalQ}</Text>
                    </Text>
                  )}
                  <Text style={styles.cardLine}>
                    Correct: <Text style={styles.cardEm}>{t.correct != null ? t.correct : "—"}</Text>
                    {" · "}Incorrect: <Text style={styles.cardEm}>{t.incorrect != null ? t.incorrect : "—"}</Text>
                  </Text>
                  {t.attempted != null && (
                    <Text style={styles.cardMuted}>Answered in attempt: {t.attempted}</Text>
                  )}
                </>
              )}
            </View>
          );
        })
      )}
    </>
  );

  const scrollInnerStyle = React.useMemo(
    () =>
      ({
        paddingBottom: Math.max(24, insets.bottom + 16),
        gap: 10 as const,
        paddingHorizontal: 14,
        paddingTop: 10,
      }) as const,
    [insets.bottom]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.topBar}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={Colors.light.text} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>Student progress</Text>
          {student && (
            <Text style={styles.headerSub} numberOfLines={1}>
              {student.user_name || "Student"} · Course #{courseId}
            </Text>
          )}
        </View>
      </View>

      {isLoading && <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 24 }} />}
      {error && (
        <Text style={styles.errorText}>{(error as Error).message}</Text>
      )}
      {!isLoading && !error && data && (
        <View style={styles.mainBody}>
          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tabBtn, reportTab === "lecturesLive" && styles.tabBtnActive]}
              onPress={() => setReportTab("lecturesLive")}
              accessibilityRole="tab"
              accessibilityState={{ selected: reportTab === "lecturesLive" }}
            >
              <Ionicons
                name="play-circle-outline"
                size={18}
                color={reportTab === "lecturesLive" ? "#fff" : Colors.light.primary}
              />
              <Text style={[styles.tabBtnText, reportTab === "lecturesLive" && styles.tabBtnTextActive]} numberOfLines={1}>
                Lectures & live
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, reportTab === "tests" && styles.tabBtnActive]}
              onPress={() => setReportTab("tests")}
              accessibilityRole="tab"
              accessibilityState={{ selected: reportTab === "tests" }}
            >
              <Ionicons
                name="document-text-outline"
                size={18}
                color={reportTab === "tests" ? "#fff" : Colors.light.primary}
              />
              <Text style={[styles.tabBtnText, reportTab === "tests" && styles.tabBtnTextActive]} numberOfLines={1}>
                Tests
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.reportScroll}
            contentContainerStyle={scrollInnerStyle}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
          >
            {reportTab === "lecturesLive" ? lecturesLiveInner : testsInner}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function lecturingGap(n: number) {
  return n > 0 ? 16 : 8;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.card, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.light.border },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  headerSub: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  mainBody: { flex: 1, minHeight: 0, ...(Platform.OS === "web" ? ({ overflow: "hidden" } as object) : {}) },
  tabBar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tabBtn: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.card,
  },
  tabBtnActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  tabBtnText: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
  tabBtnTextActive: {
    color: "#fff",
  },
  reportScroll: {
    flex: 1,
    minHeight: 0,
    ...(Platform.OS === "web" ? ({ overflow: "auto" } as object) : {}),
  },
  sectionLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 14,
    gap: 6,
  },
  cardFolder: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_500Medium" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  cardLine: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, lineHeight: 19 },
  cardEm: { fontFamily: "Inter_700Bold", color: Colors.light.text },
  cardMuted: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, lineHeight: 17 },
  emptyHint: { fontSize: 13, color: Colors.light.textMuted, fontStyle: "italic" },
  errorText: { color: "#DC2626", padding: 16, fontFamily: "Inter_500Medium" },
});
