import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
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

export default function AdminEnrollmentStudentDetailScreen() {
  const { id: courseId, userId } = useLocalSearchParams<{ id: string; userId: string }>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 840;

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
      };
    },
    enabled: !!courseId && !!userId,
  });

  const student = data?.student;
  const lectures = data?.lectures ?? [];
  const lives = data?.liveClasses ?? [];
  const tests = data?.tests ?? [];

  const videoColumn = (
    <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.columnHeading}>Lectures & live</Text>
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
                {" "}— counts separate visits to the lecture player (~8&nbsp;min apart)
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
    </ScrollView>
  );

  const testsColumn = (
    <ScrollView style={styles.columnScroll} contentContainerStyle={styles.columnContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.columnHeading}>Tests</Text>
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
    </ScrollView>
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
        <View style={[styles.grid, wide ? styles.gridRow : styles.gridCol]}>
          {videoColumn}
          {testsColumn}
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
  grid: { flex: 1, paddingHorizontal: 12, paddingBottom: 24, gap: 16 },
  gridRow: { flexDirection: "row", alignItems: "stretch" },
  gridCol: { flexDirection: "column" },
  columnScroll: { flex: 1, minHeight: 200, ...(Platform.OS === "web" ? { minWidth: 0 } : {}) },
  columnContent: { paddingBottom: 32, gap: 10 },
  columnHeading: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 4 },
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
