import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, BackHandler,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { fetch } from "expo/fetch";

interface Question {
  id: number;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  marks: number;
  negative_marks: string;
  topic: string;
  order_index: number;
}

interface TestData {
  id: number;
  title: string;
  description: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  passing_marks: number;
  test_type: string;
  questions: Question[];
}

const OPTIONS = ["A", "B", "C", "D"];

export default function TestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [hasStarted, setHasStarted] = useState(false);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showOMR, setShowOMR] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: test, isLoading } = useQuery<TestData>({
    queryKey: ["/api/tests", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/tests/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load test");
      return res.json();
    },
  });

  useEffect(() => {
    if (hasStarted && test) {
      setTimeLeft(test.duration_minutes * 60);
      startTimeRef.current = Date.now();
    }
  }, [hasStarted, test]);

  useEffect(() => {
    if (!hasStarted || timeLeft <= 0) return;
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmit(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current!);
  }, [hasStarted]);

  const handleAnswer = (questionId: number, option: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAnswers((prev) => {
      if (prev[questionId] === option) {
        const next = { ...prev };
        delete next[questionId];
        return next;
      }
      return { ...prev, [questionId]: option };
    });
  };

  const handleSubmit = async (timeUp = false) => {
    if (!test) return;
    if (!timeUp) {
      const unanswered = test.questions.length - Object.keys(answers).length;
      Alert.alert(
        "Submit Test",
        `${unanswered > 0 ? `${unanswered} questions unanswered. ` : ""}Are you sure you want to submit?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit", style: "destructive", onPress: () => submitTest() },
        ]
      );
    } else {
      submitTest();
    }
  };

  const submitTest = async () => {
    if (!test) return;
    setIsSubmitting(true);
    clearInterval(timerRef.current!);
    const timeTaken = Math.round((Date.now() - startTimeRef.current) / 1000);
    try {
      const res = await apiRequest("POST", `/api/tests/${id}/attempt`, {
        answers,
        timeTakenSeconds: timeTaken,
      });
      const result = await res.json();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({
        pathname: `/test-result/${id}`,
        params: {
          score: result.score,
          totalMarks: result.totalMarks,
          percentage: result.percentage,
          passed: result.passed ? "true" : "false",
          weakTopics: result.weakTopics?.join(","),
          attemptId: result.attemptId,
        },
      });
    } catch {
      Alert.alert("Error", "Failed to submit test. Please try again.");
      setIsSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const timeColor = timeLeft < 300 ? "#EF4444" : timeLeft < 600 ? "#F59E0B" : "#22C55E";

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!test) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Test not found</Text>
      </View>
    );
  }

  if (!hasStarted) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.startHeader, { paddingTop: topPadding + 8 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.testType}>{test.test_type.toUpperCase()} TEST</Text>
          <Text style={styles.testTitle}>{test.title}</Text>
        </LinearGradient>

        <ScrollView contentContainerStyle={[styles.startContent, { paddingBottom: bottomPadding + 20 }]}>
          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>Test Instructions</Text>
            <View style={styles.ruleRow}>
              <Ionicons name="help-circle" size={18} color={Colors.light.primary} />
              <Text style={styles.ruleText}>{test.total_questions} Questions, {test.total_marks} Marks</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="time" size={18} color={Colors.light.primary} />
              <Text style={styles.ruleText}>Duration: {test.duration_minutes} minutes</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
              <Text style={styles.ruleText}>+{test.questions[0]?.marks || 4} marks for each correct answer</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="close-circle" size={18} color="#EF4444" />
              <Text style={styles.ruleText}>-{test.questions[0]?.negative_marks || 1} marks for each wrong answer</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="trophy" size={18} color="#F59E0B" />
              <Text style={styles.ruleText}>Passing marks: {test.passing_marks}/{test.total_marks}</Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons name="shield" size={18} color={Colors.light.primary} />
              <Text style={styles.ruleText}>Screenshots & recording disabled during test</Text>
            </View>
          </View>

          <Pressable style={styles.startBtn} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); setHasStarted(true); }}>
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.startBtnGradient}>
              <Text style={styles.startBtnText}>Start Test</Text>
              <Ionicons name="arrow-forward" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  const q = test.questions[currentQ];
  const answeredCount = Object.keys(answers).length;

  if (showOMR) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.testHeader, { paddingTop: topPadding + 4 }]}>
          <View style={styles.testHeaderRow}>
            <Pressable style={styles.headerBtn} onPress={() => setShowOMR(false)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Text style={styles.headerTitle}>OMR Sheet</Text>
            <Text style={[styles.timerText, { color: timeColor }]}>{formatTime(timeLeft)}</Text>
          </View>
        </LinearGradient>

        <ScrollView contentContainerStyle={[styles.omrContent, { paddingBottom: bottomPadding + 100 }]}>
          <Text style={styles.omrNote}>{answeredCount}/{test.questions.length} answered · Tap to navigate</Text>
          <View style={styles.omrGrid}>
            {test.questions.map((question, idx) => {
              const ans = answers[question.id];
              return (
                <Pressable
                  key={question.id}
                  style={[styles.omrCell, ans && styles.omrCellAnswered]}
                  onPress={() => { setCurrentQ(idx); setShowOMR(false); }}
                >
                  <Text style={[styles.omrCellNum, ans && styles.omrCellNumAnswered]}>{idx + 1}</Text>
                  {OPTIONS.map((opt) => (
                    <View key={opt} style={[styles.omrBubble, ans === opt && styles.omrBubbleFilled]}>
                      <Text style={[styles.omrBubbleText, ans === opt && styles.omrBubbleTextFilled]}>{opt}</Text>
                    </View>
                  ))}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.testFooter, { paddingBottom: bottomPadding + 12 }]}>
          <Pressable style={styles.submitBtnFull} onPress={() => handleSubmit()} disabled={isSubmitting}>
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.submitBtnGradient}>
              {isSubmitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.submitBtnText}>Submit Test</Text>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                </>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.testHeader, { paddingTop: topPadding + 4 }]}>
        <View style={styles.testHeaderRow}>
          <Pressable style={styles.headerBtn} onPress={() => Alert.alert("Exit Test?", "Your answers will be lost.", [{ text: "Stay", style: "cancel" }, { text: "Exit", style: "destructive", onPress: () => router.back() }])}>
            <Ionicons name="close" size={20} color="#fff" />
          </Pressable>
          <View style={styles.qCounter}>
            <Text style={styles.qCounterText}>{currentQ + 1}/{test.questions.length}</Text>
            <Text style={styles.qCounterSub}>{answeredCount} answered</Text>
          </View>
          <Pressable style={styles.omrBtn} onPress={() => setShowOMR(true)}>
            <Ionicons name="grid" size={18} color="#fff" />
            <Text style={styles.omrBtnText}>OMR</Text>
          </Pressable>
        </View>

        <View style={styles.timerRow}>
          <View style={styles.progressBarContainer}>
            <View style={[styles.testProgress, { width: `${((currentQ + 1) / test.questions.length) * 100}%` }]} />
          </View>
          <Text style={[styles.timerText, { color: timeColor }]}>{formatTime(timeLeft)}</Text>
        </View>
      </LinearGradient>

      <ScrollView style={styles.questionScroll} contentContainerStyle={styles.questionContent}>
        <View style={styles.questionCard}>
          <View style={styles.questionMeta}>
            <Text style={styles.questionTopic}>{q.topic}</Text>
            <Text style={styles.questionMarks}>+{q.marks} | -{q.negative_marks}</Text>
          </View>
          <Text style={styles.questionText}>Q{currentQ + 1}. {q.question_text}</Text>
        </View>

        <View style={styles.optionsList}>
          {OPTIONS.map((opt, optIdx) => {
            const optText = [q.option_a, q.option_b, q.option_c, q.option_d][optIdx];
            const isSelected = answers[q.id] === opt;
            return (
              <Pressable
                key={opt}
                style={({ pressed }) => [styles.omrOption, isSelected && styles.omrOptionSelected, pressed && !isSelected && { opacity: 0.85 }]}
                onPress={() => handleAnswer(q.id, opt)}
              >
                <View style={[styles.omrCircle, isSelected && styles.omrCircleFilled]}>
                  <Text style={[styles.omrCircleText, isSelected && styles.omrCircleTextFilled]}>{opt}</Text>
                </View>
                <Text style={[styles.omrOptionText, isSelected && styles.omrOptionTextSelected]}>{optText}</Text>
                {isSelected && <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.testFooter, { paddingBottom: bottomPadding + 12 }]}>
        <Pressable
          style={[styles.navBtn, currentQ === 0 && styles.navBtnDisabled]}
          onPress={() => setCurrentQ((p) => Math.max(0, p - 1))}
          disabled={currentQ === 0}
        >
          <Ionicons name="chevron-back" size={20} color={currentQ === 0 ? Colors.light.textMuted : Colors.light.primary} />
        </Pressable>

        {currentQ === test.questions.length - 1 ? (
          <Pressable style={styles.submitBtnMain} onPress={() => handleSubmit()} disabled={isSubmitting}>
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.submitBtnGradient}>
              {isSubmitting ? <ActivityIndicator color="#fff" /> : (
                <>
                  <Text style={styles.submitBtnText}>Submit</Text>
                  <Ionicons name="checkmark-circle" size={18} color="#fff" />
                </>
              )}
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable
            style={styles.nextBtn}
            onPress={() => setCurrentQ((p) => Math.min(test.questions.length - 1, p + 1))}
          >
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.nextBtnGradient}>
              <Text style={styles.nextBtnText}>Next</Text>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  startHeader: { paddingHorizontal: 20, paddingBottom: 20, gap: 8 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  testType: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_600SemiBold", letterSpacing: 1, textTransform: "uppercase" },
  testTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 30 },
  startContent: { padding: 20, gap: 16 },
  rulesCard: { backgroundColor: "#fff", borderRadius: 20, padding: 20, gap: 14 },
  rulesTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 4 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  ruleText: { fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  startBtn: { borderRadius: 14, overflow: "hidden" },
  startBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  startBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  testHeader: { paddingHorizontal: 16, paddingBottom: 12 },
  testHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  headerBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  qCounter: { alignItems: "center" },
  qCounterText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  qCounterSub: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  omrBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
  omrBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  timerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  progressBarContainer: { flex: 1, height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" },
  testProgress: { height: 4, backgroundColor: Colors.light.accent, borderRadius: 2 },
  timerText: { fontSize: 16, fontFamily: "Inter_700Bold", minWidth: 60, textAlign: "right" },
  questionScroll: { flex: 1 },
  questionContent: { padding: 16, gap: 14, paddingBottom: 20 },
  questionCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 8 },
  questionMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  questionTopic: { fontSize: 11, color: Colors.light.primary, fontFamily: "Inter_600SemiBold", backgroundColor: Colors.light.secondary, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  questionMarks: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" },
  questionText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text, lineHeight: 24 },
  optionsList: { gap: 10 },
  omrOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 2, borderColor: Colors.light.border,
  },
  omrOptionSelected: { borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}08` },
  omrCircle: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: Colors.light.border,
    alignItems: "center", justifyContent: "center",
  },
  omrCircleFilled: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  omrCircleText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  omrCircleTextFilled: { color: "#fff" },
  omrOptionText: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text },
  omrOptionTextSelected: { color: Colors.light.primary, fontFamily: "Inter_500Medium" },
  testFooter: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border },
  navBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Colors.light.border },
  navBtnDisabled: { opacity: 0.4 },
  nextBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  nextBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 6 },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  submitBtnMain: { flex: 1, borderRadius: 14, overflow: "hidden" },
  submitBtnFull: { flex: 1, borderRadius: 14, overflow: "hidden" },
  submitBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 6 },
  submitBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  omrContent: { padding: 16, gap: 12 },
  omrNote: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_500Medium", textAlign: "center" },
  omrGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  omrCell: {
    backgroundColor: "#fff", borderRadius: 10, padding: 8,
    borderWidth: 1, borderColor: Colors.light.border,
    alignItems: "center", gap: 4, minWidth: 70,
  },
  omrCellAnswered: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  omrCellNum: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  omrCellNumAnswered: { color: Colors.light.primary },
  omrBubble: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.light.border, alignItems: "center", justifyContent: "center" },
  omrBubbleFilled: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  omrBubbleText: { fontSize: 9, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  omrBubbleTextFilled: { color: "#fff" },
});
