import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { fetch } from "expo/fetch";

interface MissionQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  topic: string;
}

interface DailyMission {
  id: number;
  title: string;
  description: string;
  questions: MissionQuestion[];
  xp_reward: number;
  isCompleted?: boolean;
  userScore?: number;
}

export default function DailyMissionScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: mission, isLoading } = useQuery<DailyMission | null>({
    queryKey: ["/api/daily-mission"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/daily-mission", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async ({ missionId, score }: { missionId: number; score: number }) => {
      await apiRequest("POST", `/api/daily-mission/${missionId}/complete`, { score });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/daily-mission"] });
    },
  });

  const questions: MissionQuestion[] = mission?.questions || [];

  const handleSelectAnswer = (questionId: number, option: string) => {
    if (isSubmitted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const handleNext = () => {
    if (currentQ < questions.length - 1) setCurrentQ((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (currentQ > 0) setCurrentQ((prev) => prev - 1);
  };

  const handleSubmit = async () => {
    if (!mission) return;
    const answeredCount = Object.keys(selectedAnswers).length;
    if (answeredCount < questions.length) {
      Alert.alert("Incomplete", `You have answered ${answeredCount} of ${questions.length} questions. Submit anyway?`, [
        { text: "Continue", style: "cancel" },
        { text: "Submit", onPress: () => submitMission() },
      ]);
    } else {
      submitMission();
    }
  };

  const submitMission = () => {
    if (!mission) return;
    let correct = 0;
    questions.forEach((q) => {
      const userAns = selectedAnswers[q.id];
      const correctAns = q.correct;
      if (userAns === correctAns) correct++;
    });
    setScore(correct);
    setIsSubmitted(true);
    completeMutation.mutate({ missionId: mission.id, score: correct });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding }]}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!mission) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={styles.headerGradient}>
          <Text style={styles.headerTitle}>Daily Mission</Text>
          <Text style={styles.headerSub}>Your daily challenge</Text>
        </LinearGradient>
        <View style={styles.emptyState}>
          <Ionicons name="flame-outline" size={60} color={Colors.light.textMuted} />
          <Text style={styles.emptyTitle}>No Mission Today</Text>
          <Text style={styles.emptySubtitle}>Check back tomorrow for your daily mission!</Text>
        </View>
      </View>
    );
  }

  if (mission.isCompleted || isSubmitted) {
    const finalScore = isSubmitted ? score : (mission.userScore || 0);
    const total = questions.length;
    const pct = total > 0 ? Math.round((finalScore / total) * 100) : 0;
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.resultContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <LinearGradient colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]} style={styles.resultCard}>
          <MaterialCommunityIcons name={pct >= 60 ? "trophy" : "emoticon-sad-outline"} size={56} color="#fff" />
          <Text style={styles.resultTitle}>{pct >= 60 ? "Mission Complete!" : "Good Try!"}</Text>
          <Text style={styles.resultScore}>{finalScore}/{total}</Text>
          <Text style={styles.resultPct}>{pct}% correct</Text>
          <View style={styles.xpBadge}>
            <Ionicons name="star" size={16} color="#F59E0B" />
            <Text style={styles.xpText}>+{pct >= 60 ? mission.xp_reward : Math.round(mission.xp_reward * 0.5)} XP earned</Text>
          </View>
        </LinearGradient>

        {isSubmitted && (
          <View style={styles.reviewSection}>
            <Text style={styles.reviewTitle}>Review Answers</Text>
            {questions.map((q, idx) => {
              const userAns = selectedAnswers[q.id];
              const isCorrect = userAns === q.correct;
              return (
                <View key={q.id} style={[styles.reviewCard, isCorrect ? styles.reviewCorrect : styles.reviewWrong]}>
                  <View style={styles.reviewHeader}>
                    <Ionicons name={isCorrect ? "checkmark-circle" : "close-circle"} size={20} color={isCorrect ? "#22C55E" : "#EF4444"} />
                    <Text style={styles.reviewQNum}>Q{idx + 1}</Text>
                    <Text style={styles.reviewTopic}>{q.topic}</Text>
                  </View>
                  <Text style={styles.reviewQuestion}>{q.question}</Text>
                  <Text style={styles.reviewCorrectAns}>Correct: {q.options[q.correct.charCodeAt(0) - 65]}</Text>
                  {!isCorrect && <Text style={styles.reviewWrongAns}>Your answer: {userAns ? q.options[userAns.charCodeAt(0) - 65] : "Not answered"}</Text>}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    );
  }

  if (!hasStarted) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.startContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <LinearGradient colors={["#F59E0B", "#EF4444"]} style={styles.missionCard}>
          <Ionicons name="flame" size={48} color="#fff" />
          <Text style={styles.missionCardTitle}>{mission.title}</Text>
          <Text style={styles.missionCardDesc}>{mission.description}</Text>
          <View style={styles.missionStats}>
            <View style={styles.missionStat}>
              <Ionicons name="help-circle" size={20} color="#fff" />
              <Text style={styles.missionStatText}>{questions.length} Questions</Text>
            </View>
            <View style={styles.missionStat}>
              <Ionicons name="star" size={20} color="#fff" />
              <Text style={styles.missionStatText}>{mission.xp_reward} XP</Text>
            </View>
          </View>
        </LinearGradient>
        <Pressable style={styles.startBtn} onPress={() => { setHasStarted(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}>
          <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.startBtnGradient}>
            <Text style={styles.startBtnText}>Start Mission</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </LinearGradient>
        </Pressable>
      </ScrollView>
    );
  }

  const q = questions[currentQ];
  const OPTIONS = ["A", "B", "C", "D"];

  return (
    <View style={[styles.container, { paddingBottom: bottomPadding + 80 }]}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}>
        <View style={styles.quizHeaderTop}>
          <Text style={styles.quizCounter}>{currentQ + 1}/{questions.length}</Text>
          <Text style={styles.quizTopic}>{q.topic}</Text>
          <Text style={styles.quizXP}>{mission.xp_reward} XP</Text>
        </View>
        <View style={styles.quizProgress}>
          {questions.map((_, i) => (
            <View key={i} style={[styles.quizProgressDot, i === currentQ && styles.quizProgressDotActive, i < currentQ && styles.quizProgressDotDone, selectedAnswers[questions[i].id] ? styles.quizProgressDotAnswered : null]} />
          ))}
        </View>
      </LinearGradient>

      <ScrollView style={styles.quizContent} contentContainerStyle={styles.quizContentInner} keyboardShouldPersistTaps="handled">
        <View style={styles.questionCard}>
          <Text style={styles.questionText}>{q.question}</Text>
        </View>

        <View style={styles.optionsList}>
          {q.options.map((opt, optIdx) => {
            const letter = OPTIONS[optIdx];
            const isSelected = selectedAnswers[q.id] === letter;
            return (
              <Pressable
                key={letter}
                style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && !isSelected && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}
                onPress={() => handleSelectAnswer(q.id, letter)}
              >
                <View style={[styles.optionBullet, isSelected && styles.optionBulletSelected]}>
                  <Text style={[styles.optionBulletText, isSelected && styles.optionBulletTextSelected]}>{letter}</Text>
                </View>
                <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{opt}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={[styles.quizActions, { paddingBottom: bottomPadding + 16 }]}>
        <Pressable style={[styles.navBtn, currentQ === 0 && styles.navBtnDisabled]} onPress={handlePrev} disabled={currentQ === 0}>
          <Ionicons name="chevron-back" size={20} color={currentQ === 0 ? Colors.light.textMuted : Colors.light.primary} />
        </Pressable>
        {currentQ === questions.length - 1 ? (
          <Pressable style={styles.submitBtn} onPress={handleSubmit}>
            <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.submitBtnGradient}>
              <Text style={styles.submitBtnText}>Submit</Text>
              <Ionicons name="checkmark-circle" size={20} color="#fff" />
            </LinearGradient>
          </Pressable>
        ) : (
          <Pressable style={styles.nextBtn} onPress={handleNext}>
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.nextBtnGradient}>
              <Text style={styles.nextBtnText}>Next</Text>
              <Ionicons name="chevron-forward" size={20} color="#fff" />
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
  headerGradient: { paddingHorizontal: 20, paddingBottom: 20, gap: 4 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  startContent: { padding: 20, gap: 20, alignItems: "stretch" },
  resultContent: { padding: 20, gap: 20 },
  missionCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 12 },
  missionCardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  missionCardDesc: { fontSize: 14, color: "rgba(255,255,255,0.8)", textAlign: "center", fontFamily: "Inter_400Regular" },
  missionStats: { flexDirection: "row", gap: 24, marginTop: 8 },
  missionStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  missionStatText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  startBtn: { borderRadius: 14, overflow: "hidden" },
  startBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  startBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  quizHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  quizHeaderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  quizCounter: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  quizTopic: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium" },
  quizXP: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#F59E0B" },
  quizProgress: { flexDirection: "row", gap: 6 },
  quizProgressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  quizProgressDotActive: { backgroundColor: "#fff" },
  quizProgressDotDone: { backgroundColor: "#22C55E" },
  quizProgressDotAnswered: { backgroundColor: Colors.light.accent },
  quizContent: { flex: 1 },
  quizContentInner: { padding: 20, gap: 16 },
  questionCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  questionText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.light.text, lineHeight: 26 },
  optionsList: { gap: 10 },
  option: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 2, borderColor: Colors.light.border,
  },
  optionSelected: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  optionBullet: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center",
  },
  optionBulletSelected: { backgroundColor: Colors.light.primary },
  optionBulletText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  optionBulletTextSelected: { color: "#fff" },
  optionText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.text },
  optionTextSelected: { color: Colors.light.primary },
  quizActions: { flexDirection: "row", paddingHorizontal: 20, paddingTop: 12, gap: 12, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border },
  navBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center" },
  navBtnDisabled: { opacity: 0.4 },
  nextBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  nextBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 8 },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  submitBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  submitBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 8 },
  submitBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  resultCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 8 },
  resultTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  resultScore: { fontSize: 48, fontFamily: "Inter_700Bold", color: "#fff" },
  resultPct: { fontSize: 16, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
  xpBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginTop: 4 },
  xpText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  reviewSection: { gap: 10 },
  reviewTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  reviewCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6, borderLeftWidth: 4 },
  reviewCorrect: { borderLeftColor: "#22C55E" },
  reviewWrong: { borderLeftColor: "#EF4444" },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewQNum: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.text },
  reviewTopic: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  reviewQuestion: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text, lineHeight: 20 },
  reviewCorrectAns: { fontSize: 13, color: "#22C55E", fontFamily: "Inter_600SemiBold" },
  reviewWrongAns: { fontSize: 13, color: "#EF4444", fontFamily: "Inter_400Regular" },
});
