import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, Modal, TextInput, Image, Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch, apiRequest } from "@/lib/query-client";

const OPTIONS = ["A", "B", "C", "D"];
const REPORT_REASONS = ["Answer is wrong", "Question is wrong", "Solution is wrong", "Other"];

export default function TestVerifyScreen() {
  const { id, attemptId, timeTakenSeconds } = useLocalSearchParams<{ id: string; attemptId: string; timeTakenSeconds: string }>();
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const [currentQ, setCurrentQ] = useState(0);
  const [showOMR, setShowOMR] = useState(false);
  const [reportQuestion, setReportQuestion] = useState<any>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportDetails, setReportDetails] = useState("");
  const [showSolution, setShowSolution] = useState(false);

  const timeTaken = parseInt(timeTakenSeconds || "0");
  const timeDisplay = timeTaken >= 3600
    ? `${Math.floor(timeTaken / 3600)}h ${Math.floor((timeTaken % 3600) / 60)}m`
    : timeTaken >= 60 ? `${Math.floor(timeTaken / 60)}m ${timeTaken % 60}s` : `${timeTaken}s`;

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/attempts", attemptId, "detail"],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/attempts/${attemptId}/detail`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    enabled: !!attemptId,
  });

  const reportMutation = useMutation({
    mutationFn: async ({ questionId, reason, details }: { questionId: number; reason: string; details: string }) => {
      await apiRequest("POST", `/api/questions/${questionId}/report`, { reason, details });
    },
    onError: () => { if (Platform.OS === "web") window.alert("Failed."); else Alert.alert("Error", "Failed to submit report."); },
  });

  const openReportEmailComposer = async (question: any, reason: string, details: string) => {
    const to = "3ilearningofficial@gmail.com";
    const subject = `Question Report: Test ${id} · Q${currentQ + 1}`;
    const body = [
      "Student question report",
      "",
      `Test ID: ${id}`,
      `Attempt ID: ${attemptId || "N/A"}`,
      `Question ID: ${question?.id ?? "N/A"}`,
      `Reason: ${reason}`,
      details?.trim() ? `Details: ${details.trim()}` : "Details: (none)",
      "",
      "Question:",
      String(question?.question_text || "").slice(0, 1000),
      "",
      `Correct Option: ${question?.correct_option || "N/A"}`,
      `Student Answer: ${question?.userAnswer || "Skipped"}`,
    ].join("\n");
    const mailto = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = mailto;
      return;
    }
    const canOpen = await Linking.canOpenURL(mailto);
    if (canOpen) await Linking.openURL(mailto);
    else Alert.alert("Email app not found", "Please set up an email app to send this report.");
  };

  if (isLoading || !data) return <View style={styles.centered}><ActivityIndicator size="large" color={Colors.light.primary} /></View>;

  const questions = data.questions || [];
  const q = questions[currentQ];
  if (!q) return null;

  const diffColor = (q.difficulty || "").toLowerCase() === "easy" ? "#22C55E" : (q.difficulty || "").toLowerCase() === "hard" ? "#EF4444" : "#F59E0B";
  const isAttempted = !!q.userAnswer;
  const isCorrect = q.isCorrect;

  if (showOMR) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding }]}>
          <View style={styles.headerRow}>
            <Pressable style={styles.headerBtn} onPress={() => setShowOMR(false)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" }}>OMR Sheet</Text>
            <View style={styles.timeBadge}><Ionicons name="time-outline" size={14} color="#fff" /><Text style={styles.timeBadgeText}>{timeDisplay}</Text></View>
          </View>
        </LinearGradient>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 80 }}>
          <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_500Medium", textAlign: "center", marginBottom: 12 }}>Tap a question to review it</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {questions.map((question: any, idx: number) => {
              const ua = question.userAnswer;
              const ic = question.isCorrect;
              const bg = !ua ? "#F1F5F9" : ic ? "#DCFCE7" : "#FEE2E2";
              const border = !ua ? "#CBD5E1" : ic ? "#22C55E" : "#EF4444";
              return (
                <Pressable key={question.id} onPress={() => { setCurrentQ(idx); setShowOMR(false); }}
                  style={{ width: 72, backgroundColor: bg, borderRadius: 12, borderWidth: 2, borderColor: border, padding: 8, alignItems: "center", gap: 4 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: !ua ? "#64748B" : ic ? "#15803D" : "#DC2626" }}>Q{idx + 1}</Text>
                  {!ua ? (
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#CBD5E1", alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>S</Text>
                    </View>
                  ) : ic ? <Ionicons name="checkmark-circle" size={22} color="#22C55E" /> : <Ionicons name="close-circle" size={22} color="#EF4444" />}
                  <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#15803D" }}>✓{question.correct_option}</Text>
                  {ua && !ic && <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>✗{ua}</Text>}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.headerBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.qCounter}>
            <Text style={styles.qCounterText}>{currentQ + 1}/{questions.length}</Text>
            <Text style={styles.qCounterSub}>Solutions</Text>
          </View>
          <View style={styles.timeBadge}><Ionicons name="time-outline" size={14} color="#fff" /><Text style={styles.timeBadgeText}>{timeDisplay}</Text></View>
        </View>
        <View style={styles.progressBarContainer}>
          <View style={[styles.progressBar, { width: `${((currentQ + 1) / questions.length) * 100}%` }]} />
        </View>
      </LinearGradient>

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: bottomPadding + 100 }}>
        <View style={styles.questionCard}>
          <View style={styles.questionMeta}>
            <View style={{ flexDirection: "row", gap: 6, flex: 1, flexWrap: "wrap", alignItems: "center" }}>
              {q.topic ? <View style={styles.topicBadge}><Text style={styles.topicText}>{q.topic}</Text></View> : null}
              {q.difficulty ? (
                <View style={{ backgroundColor: diffColor + "20", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: diffColor, textTransform: "capitalize" }}>{q.difficulty}</Text>
                </View>
              ) : null}
              {/* Time taken badge */}
              {q.timeTaken ? (
                <View style={{ backgroundColor: "#EFF6FF", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="time-outline" size={10} color={Colors.light.primary} />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>
                    {q.timeTaken >= 60 ? `${Math.floor(q.timeTaken / 60)}m ${q.timeTaken % 60}s` : `${q.timeTaken}s`}
                  </Text>
                </View>
              ) : null}
              {!isAttempted ? (
                <View style={{ backgroundColor: "#F1F5F9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="remove-circle" size={11} color="#94A3B8" />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#94A3B8" }}>Skipped</Text>
                </View>
              ) : isCorrect ? (
                <View style={{ backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>Correct</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <Ionicons name="close-circle" size={11} color="#DC2626" />
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626" }}>Incorrect</Text>
                </View>
              )}
              {/* Marks gained/lost badge */}
              {isAttempted && (
                <View style={{ backgroundColor: isCorrect ? "#DCFCE7" : "#FEE2E2", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: isCorrect ? "#16A34A" : "#DC2626" }}>
                    {isCorrect
                      ? `+${q.marks}`
                      : `-${parseFloat(q.negative_marks || "0").toFixed(2).replace(/\.?0+$/, "")}`}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.marksText}>+{q.marks} | -{q.negative_marks}</Text>
          </View>
          <Text style={styles.questionText}>Q{currentQ + 1}. {q.question_text}</Text>
          {q.image_url ? (
            <Image source={{ uri: q.image_url }} style={{ width: "100%", height: 180, borderRadius: 10, marginTop: 8 }} resizeMode="contain" />
          ) : null}
        </View>

        <View style={{ gap: 10 }}>
          {OPTIONS.map((opt, idx) => {
            const optText = [q.option_a, q.option_b, q.option_c, q.option_d][idx];
            if (!optText) return null;
            const isOptCorrect = opt === q.correct_option;
            const isUserOpt = opt === q.userAnswer;
            const isOptWrong = isUserOpt && !isOptCorrect;
            let bg = "#fff", border = Colors.light.border, icon = null;
            if (isOptCorrect) { bg = "#DCFCE7"; border = "#22C55E"; icon = "checkmark-circle"; }
            else if (isOptWrong) { bg = "#FEE2E2"; border = "#EF4444"; icon = "close-circle"; }
            return (
              <View key={opt} style={[styles.option, { backgroundColor: bg, borderColor: border }]}>
                <View style={[styles.optCircle, { borderColor: border, backgroundColor: isOptCorrect ? "#22C55E" : isOptWrong ? "#EF4444" : "transparent" }]}>
                  <Text style={[styles.optCircleText, { color: (isOptCorrect || isOptWrong) ? "#fff" : Colors.light.textSecondary }]}>{opt}</Text>
                </View>
                <Text style={[styles.optText, { color: isOptCorrect ? "#15803D" : isOptWrong ? "#DC2626" : Colors.light.text, flex: 1 }]}>{optText}</Text>
                {icon && <Ionicons name={icon as any} size={20} color={isOptCorrect ? "#22C55E" : "#EF4444"} />}
              </View>
            );
          })}
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={styles.viewSolutionBtn} onPress={() => setShowSolution(s => !s)}>
            <Ionicons name="bulb-outline" size={16} color="#92400E" />
            <Text style={styles.viewSolutionBtnText}>{showSolution ? "Hide Solution" : "View Solution"}</Text>
          </Pressable>
          <Pressable style={styles.reportBtn} onPress={() => { setReportQuestion(q); setReportReason(""); setReportDetails(""); }}>
            <Ionicons name="flag-outline" size={16} color="#EF4444" />
            <Text style={styles.reportBtnText}>Report</Text>
          </Pressable>
        </View>

        {showSolution && (
          <View style={styles.solutionCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Ionicons name="bulb" size={18} color="#F59E0B" />
              <Text style={styles.solutionTitle}>Solution</Text>
            </View>
            {q.explanation
              ? <Text style={styles.solutionText}>{q.explanation}</Text>
              : <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>No solution for this question.</Text>}
            {q.solution_image_url ? (
              <Image source={{ uri: q.solution_image_url }} style={{ width: "100%", height: 180, borderRadius: 10, marginTop: 8 }} resizeMode="contain" />
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPadding + 12 }]}>
        <Pressable style={[styles.navBtn, currentQ === 0 && styles.navBtnDisabled]} onPress={() => { setShowSolution(false); setCurrentQ(p => Math.max(0, p - 1)); }} disabled={currentQ === 0}>
          <Ionicons name="chevron-back" size={20} color={currentQ === 0 ? Colors.light.textMuted : Colors.light.primary} />
        </Pressable>
        {currentQ < questions.length - 1 ? (
          <Pressable style={styles.nextBtn} onPress={() => { setShowSolution(false); setCurrentQ(p => p + 1); }}>
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.nextBtnGrad}>
              <Text style={styles.nextBtnText}>Next</Text>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable style={styles.nextBtn} onPress={() => router.back()}>
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.nextBtnGrad}>
              <Text style={styles.nextBtnText}>Done</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        )}
        <Pressable style={styles.omrBtn} onPress={() => setShowOMR(true)}>
          <Ionicons name="grid" size={18} color="#fff" />
          <Text style={styles.omrBtnText}>OMR</Text>
        </Pressable>
      </View>

      <Modal visible={!!reportQuestion} animationType="slide" transparent onRequestClose={() => setReportQuestion(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14, paddingBottom: bottomPadding + 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Report Question</Text>
              <Pressable onPress={() => setReportQuestion(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <View style={{ gap: 8 }}>
              {REPORT_REASONS.map((r) => (
                <Pressable key={r} onPress={() => setReportReason(r)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 2, borderColor: reportReason === r ? Colors.light.primary : Colors.light.border, backgroundColor: reportReason === r ? Colors.light.secondary : "#fff" }}>
                  <View style={{ width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: reportReason === r ? Colors.light.primary : Colors.light.border, backgroundColor: reportReason === r ? Colors.light.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {reportReason === r && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" }} />}
                  </View>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{r}</Text>
                </Pressable>
              ))}
            </View>
            {reportReason === "Other" && (
              <TextInput style={{ borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.light.text, minHeight: 80, textAlignVertical: "top" }}
                placeholder="Describe the issue..." placeholderTextColor={Colors.light.textMuted} value={reportDetails} onChangeText={setReportDetails} multiline />
            )}
            <Pressable style={{ backgroundColor: reportReason ? "#EF4444" : Colors.light.border, borderRadius: 12, padding: 14, alignItems: "center", opacity: reportReason ? 1 : 0.5 }}
              onPress={async () => {
                if (!reportReason || !reportQuestion) return;
                await reportMutation.mutateAsync({ questionId: reportQuestion.id, reason: reportReason, details: reportDetails });
                setReportQuestion(null); setReportReason(""); setReportDetails("");
                await openReportEmailComposer(reportQuestion, reportReason, reportDetails);
              }}
              disabled={!reportReason || reportMutation.isPending}>
              {reportMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Submit Report</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  qCounter: { alignItems: "center" },
  qCounterText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  qCounterSub: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  timeBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  timeBadgeText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" },
  progressBarContainer: { height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" },
  progressBar: { height: 4, backgroundColor: Colors.light.accent, borderRadius: 2 },
  scroll: { flex: 1 },
  questionCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 8 },
  questionMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  topicBadge: { backgroundColor: Colors.light.secondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  topicText: { fontSize: 11, color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  marksText: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" },
  questionText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text, lineHeight: 24 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, padding: 14, borderWidth: 2 },
  optCircle: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  optCircleText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  optText: { fontSize: 15, fontFamily: "Inter_400Regular" },
  solutionCard: { backgroundColor: "#FFFBEB", borderRadius: 14, padding: 14, borderLeftWidth: 4, borderLeftColor: "#F59E0B" },
  solutionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#92400E" },
  solutionText: { fontSize: 14, fontFamily: "Inter_400Regular", color: "#78350F", lineHeight: 20 },
  viewSolutionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#FDE68A", backgroundColor: "#FFFBEB" },
  viewSolutionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#92400E" },
  reportBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" },
  reportBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#EF4444" },
  footer: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border },
  navBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.light.border },
  navBtnDisabled: { opacity: 0.4 },
  nextBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  nextBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 6 },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  omrBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.primary, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },
  omrBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
