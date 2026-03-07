import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, FlatList,
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
  mission_type: string;
  isCompleted?: boolean;
  userScore?: number;
  isAccessible?: boolean;
}

const TABS = [
  { key: "all", label: "All Missions" },
  { key: "daily_drill", label: "Daily Drills" },
  { key: "free_practice", label: "Free Practice" },
];

export default function DailyMissionScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("all");
  const [activeMission, setActiveMission] = useState<DailyMission | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: missions = [], isLoading } = useQuery<DailyMission[]>({
    queryKey: ["/api/daily-missions", activeTab],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/daily-missions?type=${activeTab}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async ({ missionId, score }: { missionId: number; score: number }) => {
      await apiRequest("POST", `/api/daily-mission/${missionId}/complete`, { score });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/daily-missions"] });
    },
  });

  const handleSelectAnswer = (questionId: number, option: string) => {
    if (isSubmitted) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: option }));
  };

  const handleNext = () => {
    const questions = activeMission?.questions || [];
    if (currentQ < questions.length - 1) setCurrentQ((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (currentQ > 0) setCurrentQ((prev) => prev - 1);
  };

  const handleSubmit = async () => {
    if (!activeMission) return;
    const questions = activeMission.questions || [];
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
    if (!activeMission) return;
    const questions = activeMission.questions || [];
    let correct = 0;
    questions.forEach((q) => {
      if (selectedAnswers[q.id] === q.correct) correct++;
    });
    setScore(correct);
    setIsSubmitted(true);
    completeMutation.mutate({ missionId: activeMission.id, score: correct });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const resetMission = () => {
    setActiveMission(null);
    setCurrentQ(0);
    setSelectedAnswers({});
    setIsSubmitted(false);
    setScore(0);
    setHasStarted(false);
  };

  const startMission = (mission: DailyMission) => {
    if (!mission.isAccessible) {
      Alert.alert("Locked", "Purchase a course to access this mission.");
      return;
    }
    setActiveMission(mission);
    setCurrentQ(0);
    setSelectedAnswers({});
    setIsSubmitted(false);
    setScore(0);
    setHasStarted(false);
  };

  if (activeMission && (isSubmitted || activeMission.isCompleted)) {
    const questions = activeMission.questions || [];
    const finalScore = isSubmitted ? score : (activeMission.userScore || 0);
    const total = questions.length;
    const pct = total > 0 ? Math.round((finalScore / total) * 100) : 0;
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.resultContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <Pressable onPress={resetMission} style={styles.backRow}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
          <Text style={styles.backText}>Back to Missions</Text>
        </Pressable>
        <LinearGradient colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]} style={styles.resultCard}>
          <MaterialCommunityIcons name={pct >= 60 ? "trophy" : "emoticon-sad-outline"} size={56} color="#fff" />
          <Text style={styles.resultTitle}>{pct >= 60 ? "Mission Complete!" : "Good Try!"}</Text>
          <Text style={styles.resultScore}>{finalScore}/{total}</Text>
          <Text style={styles.resultPct}>{pct}% correct</Text>
          <View style={styles.xpBadge}>
            <Ionicons name="star" size={16} color="#F59E0B" />
            <Text style={styles.xpText}>+{pct >= 60 ? activeMission.xp_reward : Math.round(activeMission.xp_reward * 0.5)} XP earned</Text>
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

  if (activeMission && hasStarted) {
    const questions = activeMission.questions || [];
    const q = questions[currentQ];
    const OPTIONS = ["A", "B", "C", "D"];
    return (
      <View style={[styles.container, { paddingBottom: bottomPadding + 80 }]}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}>
          <View style={styles.quizHeaderTop}>
            <Pressable onPress={resetMission} hitSlop={10}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.quizCounter}>{currentQ + 1}/{questions.length}</Text>
            <Text style={styles.quizTopic}>{q?.topic}</Text>
            <Text style={styles.quizXP}>{activeMission.xp_reward} XP</Text>
          </View>
          <View style={styles.quizProgress}>
            {questions.map((_, i) => (
              <View key={i} style={[styles.quizProgressDot, i === currentQ && styles.quizProgressDotActive, i < currentQ && styles.quizProgressDotDone, selectedAnswers[questions[i].id] ? styles.quizProgressDotAnswered : null]} />
            ))}
          </View>
        </LinearGradient>
        <ScrollView style={styles.quizContent} contentContainerStyle={styles.quizContentInner} keyboardShouldPersistTaps="handled">
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{q?.question}</Text>
          </View>
          <View style={styles.optionsList}>
            {q?.options.map((opt, optIdx) => {
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

  if (activeMission && !hasStarted) {
    const questions = activeMission.questions || [];
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.startContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <Pressable onPress={resetMission} style={styles.backRow}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
          <Text style={styles.backText}>Back to Missions</Text>
        </Pressable>
        <LinearGradient colors={["#F59E0B", "#EF4444"]} style={styles.missionCard}>
          <Ionicons name="flame" size={48} color="#fff" />
          <Text style={styles.missionCardTitle}>{activeMission.title}</Text>
          <Text style={styles.missionCardDesc}>{activeMission.description}</Text>
          <View style={styles.missionStats}>
            <View style={styles.missionStat}>
              <Ionicons name="help-circle" size={20} color="#fff" />
              <Text style={styles.missionStatText}>{questions.length} Questions</Text>
            </View>
            <View style={styles.missionStat}>
              <Ionicons name="star" size={20} color="#fff" />
              <Text style={styles.missionStatText}>{activeMission.xp_reward} XP</Text>
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

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={styles.headerGradient}>
        <Text style={styles.headerTitle}>Daily Missions</Text>
        <Text style={styles.headerSub}>Practice and earn XP every day</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      ) : missions.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="flame-outline" size={60} color={Colors.light.textMuted} />
          <Text style={styles.emptyTitle}>No Missions Available</Text>
          <Text style={styles.emptySubtitle}>Check back later for new practice missions!</Text>
        </View>
      ) : (
        <FlatList
          data={missions}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 100, gap: 12 }}
          scrollEnabled={missions.length > 0}
          renderItem={({ item }) => {
            const qCount = Array.isArray(item.questions) ? item.questions.length : 0;
            const isLocked = !item.isAccessible;
            const typeLabel = item.mission_type === "free_practice" ? "Free" : "Premium";
            const typeColor = item.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
            return (
              <Pressable
                style={[styles.missionListCard, isLocked && styles.missionLocked]}
                onPress={() => startMission(item)}
              >
                <View style={styles.missionListTop}>
                  <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                    <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
                  </View>
                  {item.isCompleted && (
                    <View style={styles.completedBadge}>
                      <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                      <Text style={styles.completedText}>Done</Text>
                    </View>
                  )}
                  {isLocked && (
                    <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />
                  )}
                </View>
                <Text style={styles.missionListTitle}>{item.title}</Text>
                {item.description ? <Text style={styles.missionListDesc} numberOfLines={2}>{item.description}</Text> : null}
                <View style={styles.missionListFooter}>
                  <View style={styles.missionListStat}>
                    <Ionicons name="help-circle-outline" size={14} color={Colors.light.textMuted} />
                    <Text style={styles.missionListStatText}>{qCount} Qs</Text>
                  </View>
                  <View style={styles.missionListStat}>
                    <Ionicons name="star-outline" size={14} color="#F59E0B" />
                    <Text style={styles.missionListStatText}>{item.xp_reward} XP</Text>
                  </View>
                  {item.isCompleted && item.userScore !== undefined && (
                    <View style={styles.missionListStat}>
                      <Text style={styles.missionListStatText}>Score: {item.userScore}/{qCount}</Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerGradient: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, gap: 4 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  tabsRow: { gap: 8, marginTop: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  tabTextActive: { color: Colors.light.primary },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  missionListCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: Colors.light.border },
  missionLocked: { opacity: 0.6 },
  missionListTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  completedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" },
  completedText: { fontSize: 12, color: "#22C55E", fontFamily: "Inter_500Medium" },
  missionListTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  missionListDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  missionListFooter: { flexDirection: "row", gap: 16, marginTop: 4 },
  missionListStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  missionListStatText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_500Medium" },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  backText: { fontSize: 14, color: Colors.light.primary, fontFamily: "Inter_500Medium" },
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
  quizHeaderTop: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  quizCounter: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  quizTopic: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", flex: 1 },
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
