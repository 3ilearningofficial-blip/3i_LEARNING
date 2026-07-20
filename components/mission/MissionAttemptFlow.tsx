import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest } from "@/lib/query-client";
import { patchMissionListCaches, type MissionCompletePatch } from "@/lib/mission-cache";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import {
  type DailyMission,
  type MissionScreen,
  type MissionSessionResult,
  normalizeTopicLabel,
  uniqueTopicsAndSubtopicsFromQuestions,
  formatMissionTime,
  isMissionCompleted,
} from "@/lib/mission-types";

export type MissionAttemptFlowProps = {
  mission: DailyMission;
  onExit: () => void;
  exitLabel?: string;
  sessionResult?: MissionSessionResult;
  onCompleted?: (data: MissionCompletePatch) => void;
};

function TopicSubtopicChipsRow({ topic, subtopic }: { topic?: string; subtopic?: string }) {
  const t = normalizeTopicLabel(topic);
  const st = normalizeTopicLabel(subtopic);
  if (!t && !st) return null;
  if (t && st && t.toLowerCase() === st.toLowerCase()) {
    return (
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <View style={styles.topicChip}>
          <Text style={styles.topicChipText}>{t}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      {t ? (
        <View style={styles.topicChip}>
          <Text style={styles.topicChipText}>{t}</Text>
        </View>
      ) : null}
      {st ? (
        <View style={[styles.topicChip, { backgroundColor: "#F3E8FF" }]}>
          <Text style={[styles.topicChipText, { color: "#7C3AED" }]}>{st}</Text>
        </View>
      ) : null}
    </View>
  );
}

function normalizeAnswers(raw: Record<number | string, string> | undefined): Record<number, string> {
  const normalized: Record<number, string> = {};
  if (!raw) return normalized;
  Object.entries(raw).forEach(([k, v]) => {
    normalized[Number(k)] = v;
  });
  return normalized;
}

export default function MissionAttemptFlow({
  mission,
  onExit,
  exitLabel = "Back to Missions",
  sessionResult: sessionResultProp,
  onCompleted,
}: MissionAttemptFlowProps) {
  useScreenProtection(true);
  const { colors, isDarkMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const [screen, setScreen] = useState<MissionScreen>("start");
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [questionTimes, setQuestionTimes] = useState<Record<number, number>>({});
  const [totalTime, setTotalTime] = useState(0);
  const [score, setScore] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [reviewQIndex, setReviewQIndex] = useState(0);
  const [completedThisSession, setCompletedThisSession] = useState<Set<number>>(new Set());
  const [localSessionResult, setLocalSessionResult] = useState<MissionSessionResult | null>(null);
  const [isSubmittingMission, setIsSubmittingMission] = useState(false);

  const totalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimeRef = useRef(0);
  const totalTimeRef = useRef(0);
  const missionRef = useRef(mission);
  const selectedAnswersRef = useRef<Record<number, string>>({});
  const currentQRef = useRef(0);
  const submitMissionRef = useRef<() => void>(() => {});

  missionRef.current = mission;

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;
  const actionBarBottomPadding =
    Platform.OS === "web"
      ? 12
      : (Platform.OS === "android" ? 58 : 52) + Math.max(insets.bottom, 6);

  const completeMutation = useMutation({
    mutationFn: async (data: MissionCompletePatch) => {
      const res = await apiRequest("POST", `/api/daily-mission/${data.missionId}/complete`, {
        score: data.score,
        timeTaken: data.timeTaken,
        answers: data.answers,
        incorrect: data.incorrect,
        skipped: data.skipped,
      });
      const json = await res.json();
      if (!json.success) throw new Error("Server did not confirm success");
      return data;
    },
    onError: (err) => {
      console.error("[Mission] Complete failed:", err);
      if (Platform.OS === "web") {
        console.error("[Mission] This mission attempt was NOT saved to the database.");
      }
      setIsSubmittingMission(false);
    },
    onSuccess: (data) => {
      patchMissionListCaches(qc, data);
      onCompleted?.(data);
      setCompletedThisSession((prev) => new Set(prev).add(data.missionId));
      setLocalSessionResult({
        score: data.score,
        timeTaken: data.timeTaken,
        answers: data.answers,
        incorrect: data.incorrect,
        skipped: data.skipped,
      });
      setScreen("result");
      setIsSubmittingMission(false);
    },
  });

  useEffect(() => {
    setLocalSessionResult(null);
    const completed = isMissionCompleted(mission, completedThisSession);
    if (completed) {
      const sessionData = localSessionResult ?? sessionResultProp;
      const normalizedAnswers = normalizeAnswers(sessionData?.answers ?? mission.userAnswers);
      selectedAnswersRef.current = normalizedAnswers;
      currentQRef.current = 0;
      setSelectedAnswers(normalizedAnswers);
      setScore(sessionData?.score ?? mission.userScore ?? 0);
      setTotalTime(sessionData?.timeTaken ?? mission.userTimeTaken ?? 0);
      setIncorrectCount(sessionData?.incorrect ?? mission.userIncorrect ?? 0);
      setSkippedCount(sessionData?.skipped ?? mission.userSkipped ?? 0);
      setCurrentQ(0);
      setQuestionTimes({});
      setReviewQIndex(0);
      setScreen("result");
    } else {
      selectedAnswersRef.current = {};
      currentQRef.current = 0;
      totalTimeRef.current = 0;
      qTimeRef.current = 0;
      setCurrentQ(0);
      setSelectedAnswers({});
      setQuestionTimes({});
      setTotalTime(0);
      setScore(0);
      setIncorrectCount(0);
      setSkippedCount(0);
      setReviewQIndex(0);
      setScreen("start");
    }
     
  }, [mission.id]);

  useEffect(() => {
    if (screen === "quiz") {
      totalTimeRef.current = 0;
      totalTimerRef.current = setInterval(() => {
        totalTimeRef.current += 1;
        setTotalTime((t) => t + 1);
      }, 1000);
      startQTimer();
    } else {
      if (totalTimerRef.current) clearInterval(totalTimerRef.current);
      if (qTimerRef.current) clearInterval(qTimerRef.current);
    }
    return () => {
      if (totalTimerRef.current) clearInterval(totalTimerRef.current);
      if (qTimerRef.current) clearInterval(qTimerRef.current);
    };
  }, [screen]);

  const startQTimer = () => {
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    qTimeRef.current = 0;
    qTimerRef.current = setInterval(() => {
      qTimeRef.current += 1;
    }, 1000);
  };

  const saveQTime = (qId: number) => {
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    setQuestionTimes((prev) => ({ ...prev, [qId]: (prev[qId] || 0) + qTimeRef.current }));
  };

  const handleSelectAnswer = (questionId: number, option: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedAnswers((prev) => {
      const next = { ...prev, [questionId]: option };
      selectedAnswersRef.current = next;
      return next;
    });
  };

  const handleNext = () => {
    const questions = mission.questions || [];
    if (currentQ < questions.length - 1) {
      saveQTime(questions[currentQ].id);
      const next = currentQ + 1;
      currentQRef.current = next;
      setCurrentQ(next);
      startQTimer();
    }
  };

  const handlePrev = () => {
    if (currentQ > 0) {
      const questions = mission.questions || [];
      saveQTime(questions[currentQ].id);
      const prev = currentQ - 1;
      currentQRef.current = prev;
      setCurrentQ(prev);
      startQTimer();
    }
  };

  const handleSubmit = () => {
    const questions = mission.questions || [];
    const answeredCount = Object.keys(selectedAnswers).length;
    if (answeredCount < questions.length) {
      if (Platform.OS === "web") {
        if (window.confirm(`You answered ${answeredCount}/${questions.length} questions. Submit anyway?`)) {
          submitMissionRef.current();
        }
      } else {
        Alert.alert("Incomplete", `You answered ${answeredCount}/${questions.length} questions. Submit anyway?`, [
          { text: "Continue", style: "cancel" },
          { text: "Submit", onPress: () => submitMissionRef.current() },
        ]);
      }
    } else {
      submitMissionRef.current();
    }
  };

  const submitMission = () => {
    const m = missionRef.current;
    const questions = m.questions || [];
    const curQ = currentQRef.current;
    const answers = selectedAnswersRef.current;

    if (qTimerRef.current) clearInterval(qTimerRef.current);
    setQuestionTimes((prev) => ({
      ...prev,
      [questions[curQ]?.id]: (prev[questions[curQ]?.id] || 0) + qTimeRef.current,
    }));

    if (totalTimerRef.current) clearInterval(totalTimerRef.current);
    const finalTime = totalTimeRef.current;
    setTotalTime(finalTime);

    let correct = 0;
    let incorrect = 0;
    let skipped = 0;
    questions.forEach((q) => {
      const ans = answers[q.id];
      if (!ans) skipped++;
      else if (ans === q.correct) correct++;
      else incorrect++;
    });
    setScore(correct);
    setIncorrectCount(incorrect);
    setSkippedCount(skipped);
    setIsSubmittingMission(true);
    completeMutation.mutate({
      missionId: m.id,
      score: correct,
      timeTaken: finalTime,
      answers,
      incorrect,
      skipped,
      courseId: m.course_id ?? null,
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  submitMissionRef.current = submitMission;

  const handleStartPress = () => {
    if (!mission.isAccessible) {
      Alert.alert("Locked", "Purchase a course to access this mission.");
      return;
    }
    setScreen("quiz");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  // ─── REVIEW DETAIL SCREEN ───────────────────────────────────────────────────
  if (screen === "review") {
    const questions = mission.questions || [];
    const q = questions[reviewQIndex];
    const OPTIONS = ["A", "B", "C", "D"];
    const userAns = selectedAnswers[q.id] ?? (selectedAnswers as any)[String(q.id)];
    const isCorrect = userAns === q.correct;
    const qTime = questionTimes[q.id] || 0;
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
          style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}
        >
          <View style={styles.quizHeaderTop}>
            <Pressable onPress={() => setScreen("result")} hitSlop={10}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.quizCounter}>
              {reviewQIndex + 1}/{questions.length}
            </Text>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: "rgba(255,255,255,0.15)",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Ionicons name="time-outline" size={13} color="#fff" />
                <Text style={{ fontSize: 12, color: "#fff", fontFamily: "Inter_500Medium" }}>
                  {formatMissionTime(qTime)}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.quizProgress}>
            {questions.map((_, i) => {
              const ua = selectedAnswers[questions[i].id];
              const ic = ua === questions[i].correct;
              return (
                <Pressable
                  key={i}
                  style={[
                    styles.quizProgressDot,
                    i === reviewQIndex && styles.quizProgressDotActive,
                    ua
                      ? ic
                        ? { backgroundColor: "#22C55E" }
                        : { backgroundColor: "#EF4444" }
                      : { backgroundColor: "rgba(255,255,255,0.2)" },
                  ]}
                  onPress={() => setReviewQIndex(i)}
                />
              );
            })}
          </View>
        </LinearGradient>

        <ScrollView style={styles.quizContent} contentContainerStyle={styles.quizContentInner}>
          <TopicSubtopicChipsRow topic={q.topic} subtopic={q.subtopic} />
          <View
            style={[
              styles.questionCard,
              {
                borderLeftWidth: 4,
                borderLeftColor: isCorrect ? "#22C55E" : userAns ? "#EF4444" : "#9CA3AF",
              },
            ]}
          >
            <Text style={styles.questionText}>{q.question}</Text>
            {q.image_url ? (
              <Image source={{ uri: q.image_url }} style={styles.questionImage} resizeMode="contain" />
            ) : null}
          </View>
          <View style={styles.optionsList}>
            {q.options.map((opt, optIdx) => {
              const letter = OPTIONS[optIdx];
              const isUserChoice = userAns === letter;
              const isCorrectOpt = q.correct === letter;
              let bg = "#fff";
              let border = Colors.light.border;
              let textColor = Colors.light.text;
              if (isCorrectOpt) {
                bg = "#DCFCE7";
                border = "#22C55E";
                textColor = "#15803D";
              } else if (isUserChoice && !isCorrectOpt) {
                bg = "#FEE2E2";
                border = "#EF4444";
                textColor = "#DC2626";
              }
              return (
                <View key={letter} style={[styles.option, { backgroundColor: bg, borderColor: border }]}>
                  <View
                    style={[
                      styles.optionBullet,
                      {
                        backgroundColor: isCorrectOpt ? "#22C55E" : isUserChoice ? "#EF4444" : Colors.light.background,
                      },
                    ]}
                  >
                    <Text style={[styles.optionBulletText, (isCorrectOpt || isUserChoice) && { color: "#fff" }]}>
                      {letter}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, { color: textColor }]}>{opt}</Text>
                  {isCorrectOpt && <Ionicons name="checkmark-circle" size={18} color="#22C55E" />}
                  {isUserChoice && !isCorrectOpt && <Ionicons name="close-circle" size={18} color="#EF4444" />}
                </View>
              );
            })}
          </View>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View
              style={[
                styles.statChip,
                { backgroundColor: isCorrect ? "#DCFCE7" : userAns ? "#FEE2E2" : "#F3F4F6" },
              ]}
            >
              <Ionicons
                name={isCorrect ? "checkmark-circle" : userAns ? "close-circle" : "remove-circle"}
                size={14}
                color={isCorrect ? "#22C55E" : userAns ? "#EF4444" : "#9CA3AF"}
              />
              <Text
                style={[
                  styles.statChipText,
                  { color: isCorrect ? "#15803D" : userAns ? "#DC2626" : "#6B7280" },
                ]}
              >
                {isCorrect ? "Correct" : userAns ? "Incorrect" : "Skipped"}
              </Text>
            </View>
            {q.marks ? (
              <View style={styles.statChip}>
                <Ionicons name="star-outline" size={14} color={Colors.light.primary} />
                <Text style={styles.statChipText}>{isCorrect ? `+${q.marks}` : "0"} marks</Text>
              </View>
            ) : null}
          </View>
          {q.solution ? (
            <View
              style={{
                backgroundColor: "#FFFBEB",
                borderRadius: 12,
                padding: 14,
                borderLeftWidth: 3,
                borderLeftColor: "#F59E0B",
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 4 }}>
                Solution
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                  color: Colors.light.text,
                  lineHeight: 20,
                }}
              >
                {q.solution}
              </Text>
              {q.solution_image_url ? (
                <Image
                  source={{ uri: q.solution_image_url }}
                  style={[styles.questionImage, { marginTop: 10 }]}
                  resizeMode="contain"
                />
              ) : null}
            </View>
          ) : q.solution_image_url ? (
            <View
              style={{
                backgroundColor: "#FFFBEB",
                borderRadius: 12,
                padding: 14,
                borderLeftWidth: 3,
                borderLeftColor: "#F59E0B",
              }}
            >
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 8 }}>
                Solution
              </Text>
              <Image source={{ uri: q.solution_image_url }} style={styles.questionImage} resizeMode="contain" />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.quizActions, { paddingBottom: actionBarBottomPadding }]}>
          <Pressable
            style={[styles.navBtn, reviewQIndex === 0 && styles.navBtnDisabled]}
            onPress={() => reviewQIndex > 0 && setReviewQIndex((p) => p - 1)}
            disabled={reviewQIndex === 0}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={reviewQIndex === 0 ? Colors.light.textMuted : Colors.light.primary}
            />
          </Pressable>
          {reviewQIndex < questions.length - 1 ? (
            <Pressable style={styles.nextBtn} onPress={() => setReviewQIndex((p) => p + 1)}>
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.nextBtnGradient}>
                <Text style={styles.nextBtnText}>Next</Text>
                <Ionicons name="chevron-forward" size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          ) : (
            <Pressable style={styles.submitBtn} onPress={() => setScreen("result")}>
              <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.submitBtnGradient}>
                <Text style={styles.submitBtnText}>Done</Text>
                <Ionicons name="checkmark-circle" size={20} color="#fff" />
              </LinearGradient>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  // ─── RESULT SCREEN ──────────────────────────────────────────────────────────
  if (screen === "result") {
    const questions = mission.questions || [];
    const total = questions.length;
    const displayScore = score > 0 ? score : mission.userScore || 0;
    const pct = total > 0 ? Math.round((displayScore / total) * 100) : 0;
    const hasAnswers = Object.keys(selectedAnswers).length > 0;
    const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);
    const earnedMarks = hasAnswers
      ? questions.reduce((s, q) => {
          const ans = selectedAnswers[q.id] ?? (selectedAnswers as any)[String(q.id)];
          return ans === q.correct ? s + (q.marks || 0) : s;
        }, 0)
      : 0;
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.resultContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}
      >
        <Pressable onPress={onExit} style={styles.backRow}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
          <Text style={styles.backText}>{exitLabel}</Text>
        </Pressable>

        <LinearGradient
          colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]}
          style={styles.resultCard}
        >
          <MaterialCommunityIcons name="trophy" size={56} color="#fff" />
          <Text style={styles.resultTitle}>Mission Complete!</Text>
          <Text style={styles.resultScore}>
            {displayScore}/{total}
          </Text>
          <Text style={styles.resultPct}>{pct}% correct</Text>
        </LinearGradient>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Ionicons name="time-outline" size={20} color={Colors.light.primary} />
            <Text style={styles.statBoxVal}>{formatMissionTime(totalTime)}</Text>
            <Text style={styles.statBoxLabel}>Time Taken</Text>
          </View>
          {totalMarks > 0 && (
            <View style={styles.statBox}>
              <Ionicons name="star-outline" size={20} color="#F59E0B" />
              <Text style={styles.statBoxVal}>
                {earnedMarks}/{totalMarks}
              </Text>
              <Text style={styles.statBoxLabel}>Marks</Text>
            </View>
          )}
          <View style={styles.statBox}>
            <Ionicons name="close-circle-outline" size={20} color="#EF4444" />
            <Text style={styles.statBoxVal}>{incorrectCount}</Text>
            <Text style={styles.statBoxLabel}>Incorrect</Text>
          </View>
          <View style={styles.statBox}>
            <Ionicons name="remove-circle-outline" size={20} color="#9CA3AF" />
            <Text style={styles.statBoxVal}>{skippedCount}</Text>
            <Text style={styles.statBoxLabel}>Skipped</Text>
          </View>
        </View>

        {hasAnswers ? (
          <View style={styles.reviewSection}>
            <Text style={styles.reviewTitle}>Review Answers</Text>
            {questions.map((q, idx) => {
              const userAns = selectedAnswers[q.id] ?? (selectedAnswers as any)[String(q.id)];
              const isCorrect = userAns === q.correct;
              const isSkipped = !userAns;
              return (
                <Pressable
                  key={q.id}
                  style={[
                    styles.reviewCard,
                    isCorrect ? styles.reviewCorrect : isSkipped ? styles.reviewSkipped : styles.reviewWrong,
                  ]}
                  onPress={() => {
                    setReviewQIndex(idx);
                    setScreen("review");
                  }}
                >
                  <View style={styles.reviewHeader}>
                    <Ionicons
                      name={isCorrect ? "checkmark-circle" : isSkipped ? "remove-circle" : "close-circle"}
                      size={20}
                      color={isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444"}
                    />
                    <Text style={styles.reviewQNum}>Q{idx + 1}</Text>
                    {(() => {
                      const rt = normalizeTopicLabel(q.topic);
                      const rst = normalizeTopicLabel(q.subtopic);
                      if (!rt && !rst) return null;
                      if (rt && rst && rt.toLowerCase() === rst.toLowerCase()) {
                        return <Text style={styles.reviewTopic}>{rt}</Text>;
                      }
                      return (
                        <>
                          {rt ? <Text style={styles.reviewTopic}>{rt}</Text> : null}
                          {rst ? <Text style={[styles.reviewTopic, { color: "#7C3AED" }]}>{rst}</Text> : null}
                        </>
                      );
                    })()}
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={Colors.light.textMuted}
                      style={{ marginLeft: "auto" as any }}
                    />
                  </View>
                  <Text style={styles.reviewQuestion} numberOfLines={2}>
                    {q.question}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                    <Text style={styles.reviewCorrectAns}>✓ {q.options[q.correct.charCodeAt(0) - 65]}</Text>
                    {!isCorrect && !isSkipped && (
                      <Text style={styles.reviewWrongAns}>✗ {q.options[userAns.charCodeAt(0) - 65]}</Text>
                    )}
                    {isSkipped && (
                      <Text style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" }}>
                        Not answered
                      </Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "#FEF3C7",
              borderRadius: 12,
              padding: 16,
              flexDirection: "row",
              gap: 10,
              alignItems: "center",
            }}
          >
            <Ionicons name="information-circle" size={18} color="#D97706" />
            <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E" }}>
              Detailed answer review is not available for this attempt.
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ─── QUIZ SCREEN ────────────────────────────────────────────────────────────
  if (screen === "quiz") {
    const questions = mission.questions || [];
    const q = questions[currentQ];
    const OPTIONS = ["A", "B", "C", "D"];
    const totalMarks = questions.reduce((s, qq) => s + (qq.marks || 0), 0);
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient
          colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
          style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}
        >
          <View style={styles.quizHeaderTop}>
            <Pressable
              onPress={() => {
                if (Platform.OS === "web") {
                  if (window.confirm("Submit this mission now? You cannot attempt it again.")) {
                    submitMissionRef.current();
                  }
                } else {
                  Alert.alert(
                    "Submit Mission?",
                    "Do you want to submit the mission now? You cannot attempt it again.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Submit", style: "default", onPress: () => submitMissionRef.current() },
                    ],
                  );
                }
              }}
              hitSlop={10}
            >
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.quizCounter}>
              {currentQ + 1}/{questions.length}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: "rgba(255,255,255,0.15)",
                borderRadius: 8,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Ionicons name="time-outline" size={13} color="#fff" />
              <Text style={{ fontSize: 12, color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                {formatMissionTime(totalTime)}
              </Text>
            </View>
            {totalMarks > 0 && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: "rgba(245,158,11,0.25)",
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                }}
              >
                <Ionicons name="star" size={12} color="#F59E0B" />
                <Text style={{ fontSize: 12, color: "#F59E0B", fontFamily: "Inter_600SemiBold" }}>
                  {q?.marks || 0} marks
                </Text>
              </View>
            )}
          </View>
          <View style={styles.quizProgress}>
            {questions.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.quizProgressDot,
                  i === currentQ && styles.quizProgressDotActive,
                  i < currentQ && styles.quizProgressDotDone,
                  selectedAnswers[questions[i].id] ? styles.quizProgressDotAnswered : null,
                ]}
              />
            ))}
          </View>
        </LinearGradient>

        <ScrollView
          style={styles.quizContent}
          contentContainerStyle={styles.quizContentInner}
          keyboardShouldPersistTaps="handled"
        >
          <TopicSubtopicChipsRow topic={q?.topic} subtopic={q?.subtopic} />
          <View style={styles.questionCard}>
            <Text style={styles.questionText}>{q?.question}</Text>
            {q?.image_url ? (
              <Image source={{ uri: q.image_url }} style={styles.questionImage} resizeMode="contain" />
            ) : null}
          </View>
          <View style={styles.optionsList}>
            {q?.options.map((opt, optIdx) => {
              const letter = OPTIONS[optIdx];
              const isSelected = selectedAnswers[q.id] === letter;
              return (
                <Pressable
                  key={letter}
                  style={({ pressed }) => [
                    styles.option,
                    isSelected && styles.optionSelected,
                    pressed && !isSelected && { opacity: 0.85 },
                  ]}
                  onPress={() => handleSelectAnswer(q.id, letter)}
                >
                  <View style={[styles.optionBullet, isSelected && styles.optionBulletSelected]}>
                    <Text style={[styles.optionBulletText, isSelected && styles.optionBulletTextSelected]}>
                      {letter}
                    </Text>
                  </View>
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{opt}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        <View style={[styles.quizActions, { paddingBottom: actionBarBottomPadding }]}>
          <Pressable
            style={[styles.navBtn, currentQ === 0 && styles.navBtnDisabled]}
            onPress={handlePrev}
            disabled={currentQ === 0}
          >
            <Ionicons
              name="chevron-back"
              size={20}
              color={currentQ === 0 ? Colors.light.textMuted : Colors.light.primary}
            />
          </Pressable>
          {currentQ === questions.length - 1 ? (
            <Pressable
              style={[styles.submitBtn, isSubmittingMission && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={isSubmittingMission}
            >
              <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.submitBtnGradient}>
                {isSubmittingMission ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.submitBtnText}>Submit</Text>
                    <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  </>
                )}
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

  // ─── START SCREEN ───────────────────────────────────────────────────────────
  const questions = mission.questions || [];
  const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);
  const estimatedTimeSecs = questions.reduce((s, q) => s + (q.time_limit || 0), 0);
  const { topics, subtopics: startSubtopics } = uniqueTopicsAndSubtopicsFromQuestions(questions);
  const typeLabel = mission.mission_type === "free_practice" ? "Free Practice" : "Daily Drill";
  const typeColor = mission.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.startContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}
    >
      <Pressable onPress={onExit} style={styles.backRow}>
        <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
        <Text style={styles.backText}>{exitLabel}</Text>
      </Pressable>
      <LinearGradient colors={["#F59E0B", "#EF4444"]} style={styles.missionCard}>
        <Ionicons name="flame" size={48} color="#fff" />
        <View style={[{ backgroundColor: typeColor + "30", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }]}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{typeLabel}</Text>
        </View>
        <Text style={styles.missionCardTitle}>{mission.title}</Text>
        {mission.description ? <Text style={styles.missionCardDesc}>{mission.description}</Text> : null}
        <View style={styles.missionStats}>
          <View style={styles.missionStat}>
            <Ionicons name="help-circle" size={18} color="#fff" />
            <Text style={styles.missionStatText}>{questions.length} Qs</Text>
          </View>
          {totalMarks > 0 && (
            <View style={styles.missionStat}>
              <Ionicons name="star" size={18} color="#fff" />
              <Text style={styles.missionStatText}>{totalMarks} Marks</Text>
            </View>
          )}
          {estimatedTimeSecs > 0 && (
            <View style={styles.missionStat}>
              <Ionicons name="time" size={18} color="#fff" />
              <Text style={styles.missionStatText}>{Math.ceil(estimatedTimeSecs / 60)} min</Text>
            </View>
          )}
        </View>
      </LinearGradient>
      {(topics.length > 0 || startSubtopics.length > 0) && (
        <View style={{ gap: 8 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Topics Covered</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {topics.map((t) => (
              <View key={`t-${t}`} style={styles.topicChip}>
                <Text style={styles.topicChipText}>{t}</Text>
              </View>
            ))}
            {startSubtopics.map((s) => (
              <View key={`s-${s}`} style={[styles.topicChip, { backgroundColor: "#F3E8FF" }]}>
                <Text style={[styles.topicChipText, { color: "#7C3AED" }]}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <View
        style={{
          backgroundColor: "#FEF3C7",
          borderRadius: 12,
          padding: 14,
          flexDirection: "row",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <Ionicons name="information-circle" size={18} color="#D97706" />
        <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 }}>
          This mission can only be attempted once. Make sure you're ready before starting.
        </Text>
      </View>
      <Pressable style={styles.startBtn} onPress={handleStartPress}>
        <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.startBtnGradient}>
          <Text style={styles.startBtnText}>Start Mission</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </LinearGradient>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },

  topicChip: { backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  topicChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  statChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.text },

  backRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  backText: { fontSize: 14, color: Colors.light.primary, fontFamily: "Inter_500Medium" },
  startContent: { padding: 20, gap: 16, alignItems: "stretch" },
  missionCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 10 },
  missionCardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  missionCardDesc: { fontSize: 14, color: "rgba(255,255,255,0.8)", textAlign: "center", fontFamily: "Inter_400Regular" },
  missionStats: { flexDirection: "row", gap: 20, marginTop: 4, flexWrap: "wrap", justifyContent: "center" },
  missionStat: { flexDirection: "row", alignItems: "center", gap: 6 },
  missionStatText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  startBtn: { borderRadius: 14, overflow: "hidden" },
  startBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  startBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },

  quizHeader: { paddingHorizontal: 20, paddingBottom: 16 },
  quizHeaderTop: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  quizCounter: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  quizProgress: { flexDirection: "row", gap: 4 },
  quizProgressDot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.2)" },
  quizProgressDotActive: { backgroundColor: "#fff" },
  quizProgressDotDone: { backgroundColor: "#22C55E" },
  quizProgressDotAnswered: { backgroundColor: Colors.light.accent },
  quizContent: { flex: 1 },
  quizContentInner: { padding: 20, gap: 14 },
  questionCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  questionText: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: Colors.light.text, lineHeight: 26 },
  questionImage: { width: "100%", height: 180, borderRadius: 10, marginTop: 12, backgroundColor: "#F3F4F6" },
  optionsList: { gap: 10 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    borderWidth: 2,
    borderColor: Colors.light.border,
  },
  optionSelected: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  optionBullet: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
  },
  optionBulletSelected: { backgroundColor: Colors.light.primary },
  optionBulletText: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.textSecondary },
  optionBulletTextSelected: { color: "#fff" },
  optionText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.text },
  optionTextSelected: { color: Colors.light.primary },
  quizActions: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  navBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.light.background,
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnDisabled: { opacity: 0.4 },
  nextBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  nextBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 8 },
  nextBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  submitBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  submitBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 8 },
  submitBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },

  resultContent: { padding: 20, gap: 16 },
  resultCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 8 },
  resultTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  resultScore: { fontSize: 48, fontFamily: "Inter_700Bold", color: "#fff" },
  resultPct: { fontSize: 16, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statBox: {
    flex: 1,
    minWidth: 70,
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  statBoxVal: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  statBoxLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center" },

  reviewSection: { gap: 10 },
  reviewTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  reviewCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 6, borderLeftWidth: 4 },
  reviewCorrect: { borderLeftColor: "#22C55E" },
  reviewWrong: { borderLeftColor: "#EF4444" },
  reviewSkipped: { borderLeftColor: "#9CA3AF" },
  reviewHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  reviewQNum: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.text },
  reviewTopic: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  reviewQuestion: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text, lineHeight: 20 },
  reviewCorrectAns: { fontSize: 12, color: "#22C55E", fontFamily: "Inter_600SemiBold" },
  reviewWrongAns: { fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular" },
});
