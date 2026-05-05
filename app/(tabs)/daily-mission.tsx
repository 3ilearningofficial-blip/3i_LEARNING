import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, FlatList, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { isAndroidWeb } from "@/lib/useAndroidWebGate";
import AndroidWebGate from "@/components/AndroidWebGate";

interface MissionQuestion {
  id: number;
  question: string;
  options: string[];
  correct: string;
  topic: string;
  subtopic?: string;
  marks?: number;
  time_limit?: number; // seconds per question
  solution?: string;
  image_url?: string;
  solution_image_url?: string;
}

interface DailyMission {
  id: number;
  title: string;
  description: string;
  questions: MissionQuestion[];
  mission_type: string;
  mission_date: string;
  course_id?: number;
  category?: string;
  xp_reward?: number;
  isCompleted?: boolean;
  userScore?: number;
  userTimeTaken?: number;
  userAnswers?: Record<number, string>;
  userIncorrect?: number;
  userSkipped?: number;
  isAccessible?: boolean;
}

const TABS = [
  { key: "all", label: "All" },
  { key: "daily_drill", label: "Daily Drills" },
  { key: "free_practice", label: "Free Practice" },
];

function normalizeTopicLabel(s: unknown): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

/** Unique topic chips + subtopics that are not duplicates of any topic (avoids repeating the same label twice). */
function uniqueTopicsAndSubtopicsFromQuestions(questions: MissionQuestion[]): { topics: string[]; subtopics: string[] } {
  const topicKeys = new Set<string>();
  const topics: string[] = [];
  for (const q of questions) {
    const t = normalizeTopicLabel(q.topic);
    if (!t) continue;
    const k = t.toLowerCase();
    if (topicKeys.has(k)) continue;
    topicKeys.add(k);
    topics.push(t);
  }
  const subtopicKeys = new Set<string>();
  const subtopics: string[] = [];
  for (const q of questions) {
    const st = normalizeTopicLabel(q.subtopic);
    if (!st) continue;
    const k = st.toLowerCase();
    if (topicKeys.has(k) || subtopicKeys.has(k)) continue;
    subtopicKeys.add(k);
    subtopics.push(st);
  }
  return { topics, subtopics };
}

/** Single question row: show one chip if topic and subtopic are the same string. */
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

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function normalizeMissionQuestion(raw: any): MissionQuestion {
  const arr = Array.isArray(raw?.options) ? raw.options : [];
  const fromLegacy = [
    raw?.option_a ?? raw?.optionA ?? "",
    raw?.option_b ?? raw?.optionB ?? "",
    raw?.option_c ?? raw?.optionC ?? "",
    raw?.option_d ?? raw?.optionD ?? "",
  ];
  const options = (arr.length > 0 ? arr : fromLegacy).map((v: unknown) => String(v ?? ""));
  while (options.length < 4) options.push("");
  return {
    ...raw,
    id: Number(raw?.id ?? 0),
    question: String(raw?.question ?? raw?.question_text ?? ""),
    options: options.slice(0, 4),
    correct: String(raw?.correct ?? raw?.correct_option ?? "").toUpperCase(),
    topic: String(raw?.topic ?? ""),
    subtopic: String(raw?.subtopic ?? ""),
    marks: Number(raw?.marks ?? 0) || 0,
    time_limit: Number(raw?.time_limit ?? 0) || 0,
    solution: String(raw?.solution ?? raw?.explanation ?? ""),
    image_url: raw?.image_url ? String(raw.image_url) : undefined,
    solution_image_url: raw?.solution_image_url ? String(raw.solution_image_url) : undefined,
  };
}

function normalizeMission(raw: any): DailyMission {
  return {
    ...raw,
    questions: Array.isArray(raw?.questions) ? raw.questions.map(normalizeMissionQuestion) : [],
  };
}

type Screen = "list" | "start" | "quiz" | "result" | "review";

export default function DailyMissionScreen() {
  useScreenProtection(true);
  if (isAndroidWeb()) return <AndroidWebGate />;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("all");
  const [screen, setScreen] = useState<Screen>("list");
  const [activeMission, setActiveMission] = useState<DailyMission | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [questionTimes, setQuestionTimes] = useState<Record<number, number>>({});
  const [totalTime, setTotalTime] = useState(0);
  const [score, setScore] = useState(0);
  const [incorrectCount, setIncorrectCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [reviewQIndex, setReviewQIndex] = useState(0);
  // Local override: track which mission IDs have been completed this session
  const [completedThisSession, setCompletedThisSession] = useState<Set<number>>(new Set());
  // Store full result data per mission for immediate display
  const [sessionResults, setSessionResults] = useState<Record<number, { score: number; timeTaken: number; answers: Record<number, string>; incorrect: number; skipped: number }>>({});
  const [isSubmittingMission, setIsSubmittingMission] = useState(false);

  // Refs — always current, safe inside Alert callbacks (no stale closure)
  const totalTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimeRef = useRef(0);
  const totalTimeRef = useRef(0);
  const activeMissionRef = useRef<DailyMission | null>(null);
  const selectedAnswersRef = useRef<Record<number, string>>({});
  const currentQRef = useRef(0);
  const submitMissionRef = useRef<() => void>(() => {});
  // Store last submission data for immediate result display
  const lastSubmitDataRef = useRef<{ score: number; timeTaken: number; answers: Record<number, string>; incorrect: number; skipped: number } | null>(null);

  // Keep refs in sync with state — set directly, not via useEffect (avoids async delay)

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

  const completeMutation = useMutation({
    mutationFn: async (data: { missionId: number; score: number; timeTaken: number; answers: Record<number, string>; incorrect: number; skipped: number }) => {
      const res = await apiRequest("POST", `/api/daily-mission/${data.missionId}/complete`, {
        score: data.score, timeTaken: data.timeTaken,
        answers: data.answers, incorrect: data.incorrect, skipped: data.skipped,
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
      // Patch all cached mission lists (each tab has its own cache key)
      const patchFn = (old: DailyMission[] | undefined) => {
        if (!old) return old;
        return old.map((m) =>
          m.id === data.missionId
            ? { ...m, isCompleted: true, userScore: data.score, userTimeTaken: data.timeTaken, userAnswers: data.answers as any, userIncorrect: data.incorrect, userSkipped: data.skipped }
            : m
        );
      };
      // Patch all tab variants
      ["all", "daily_drill", "free_practice"].forEach((tab) => {
        qc.setQueryData<DailyMission[]>(["/api/daily-missions", tab], patchFn);
      });
      // Also invalidate to get fresh server data
      qc.invalidateQueries({ queryKey: ["/api/daily-missions"] });
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
      setScreen("result");
      setIsSubmittingMission(false);
    },
  });

  // Start total timer when quiz begins
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
    qTimerRef.current = setInterval(() => { qTimeRef.current += 1; }, 1000);
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
    const questions = activeMission?.questions || [];
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
      const questions = activeMission?.questions || [];
      saveQTime(questions[currentQ].id);
      const prev = currentQ - 1;
      currentQRef.current = prev;
      setCurrentQ(prev);
      startQTimer();
    }
  };

  const handleSubmit = () => {
    if (!activeMission) return;
    const questions = activeMission.questions || [];
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
    const mission = activeMissionRef.current;
    if (!mission) return;
    const questions = mission.questions || [];
    const curQ = currentQRef.current;
    const answers = selectedAnswersRef.current;

    // Save time for current question
    if (qTimerRef.current) clearInterval(qTimerRef.current);
    setQuestionTimes((prev) => ({ ...prev, [questions[curQ]?.id]: (prev[questions[curQ]?.id] || 0) + qTimeRef.current }));

    // Stop total timer and capture final time
    if (totalTimerRef.current) clearInterval(totalTimerRef.current);
    const finalTime = totalTimeRef.current;
    setTotalTime(finalTime);

    let correct = 0, incorrect = 0, skipped = 0;
    questions.forEach((q) => {
      const ans = answers[q.id];
      if (!ans) skipped++;
      else if (ans === q.correct) correct++;
      else incorrect++;
    });
    setScore(correct);
    setIncorrectCount(incorrect);
    setSkippedCount(skipped);
    lastSubmitDataRef.current = { score: correct, timeTaken: finalTime, answers, incorrect, skipped };
    setIsSubmittingMission(true);
    completeMutation.mutate({ missionId: mission.id, score: correct, timeTaken: finalTime, answers, incorrect, skipped });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  // Always keep the ref pointing to the latest submitMission
  submitMissionRef.current = submitMission;

  const resetMission = () => {
    activeMissionRef.current = null;
    selectedAnswersRef.current = {};
    currentQRef.current = 0;
    totalTimeRef.current = 0;
    qTimeRef.current = 0;
    setActiveMission(null);
    setCurrentQ(0);
    setSelectedAnswers({});
    setQuestionTimes({});
    setTotalTime(0);
    setScore(0);
    setIncorrectCount(0);
    setSkippedCount(0);
    setScreen("list");
  };

  const startMission = (mission: DailyMission) => {
    const alreadyDone = mission.isCompleted || completedThisSession.has(mission.id) || (mission.userScore !== undefined && mission.userScore > 0);
    if (alreadyDone) {
      // Use session data first (most reliable), fall back to server data
      const sessionData = sessionResults[mission.id];
      const rawAnswers = sessionData?.answers || mission.userAnswers || {};
      const normalizedAnswers: Record<number, string> = {};
      Object.entries(rawAnswers).forEach(([k, v]) => { normalizedAnswers[Number(k)] = v; });
      activeMissionRef.current = mission;
      selectedAnswersRef.current = normalizedAnswers;
      currentQRef.current = 0;
      setActiveMission(mission);
      setScore(sessionData?.score ?? mission.userScore ?? 0);
      setTotalTime(sessionData?.timeTaken ?? mission.userTimeTaken ?? 0);
      setSelectedAnswers(normalizedAnswers);
      setIncorrectCount(sessionData?.incorrect ?? mission.userIncorrect ?? 0);
      setSkippedCount(sessionData?.skipped ?? mission.userSkipped ?? 0);
      setScreen("result");
      return;
    }
    if (!mission.isAccessible) {
      Alert.alert("Locked", "Purchase a course to access this mission.");
      return;
    }
    // Set refs directly before setting state
    activeMissionRef.current = mission;
    selectedAnswersRef.current = {};
    currentQRef.current = 0;
    totalTimeRef.current = 0;
    setActiveMission(mission);
    setCurrentQ(0);
    setSelectedAnswers({});
    setQuestionTimes({});
    setTotalTime(0);
    setScore(0);
    setIncorrectCount(0);
    setSkippedCount(0);
    setScreen("start");
  };

  // ─── REVIEW DETAIL SCREEN ───────────────────────────────────────────────────
  if (screen === "review" && activeMission) {
    const questions = activeMission.questions || [];
    const q = questions[reviewQIndex];
    const OPTIONS = ["A", "B", "C", "D"];
    const userAns = selectedAnswers[q.id] ?? (selectedAnswers as any)[String(q.id)];
    const isCorrect = userAns === q.correct;
    const qTime = questionTimes[q.id] || 0;
    return (
      <View style={[styles.container, { paddingBottom: bottomPadding + 80 }]}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}>
          <View style={styles.quizHeaderTop}>
            <Pressable onPress={() => setScreen("result")} hitSlop={10}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.quizCounter}>{reviewQIndex + 1}/{questions.length}</Text>
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Ionicons name="time-outline" size={13} color="#fff" />
                <Text style={{ fontSize: 12, color: "#fff", fontFamily: "Inter_500Medium" }}>{formatTime(qTime)}</Text>
              </View>
            </View>
          </View>
          <View style={styles.quizProgress}>
            {questions.map((_, i) => {
              const ua = selectedAnswers[questions[i].id];
              const ic = ua === questions[i].correct;
              return (
                <Pressable key={i} style={[styles.quizProgressDot,
                  i === reviewQIndex && styles.quizProgressDotActive,
                  ua ? (ic ? { backgroundColor: "#22C55E" } : { backgroundColor: "#EF4444" }) : { backgroundColor: "rgba(255,255,255,0.2)" }
                ]} onPress={() => setReviewQIndex(i)} />
              );
            })}
          </View>
        </LinearGradient>

        <ScrollView style={styles.quizContent} contentContainerStyle={styles.quizContentInner}>
          <TopicSubtopicChipsRow topic={q.topic} subtopic={q.subtopic} />
          <View style={[styles.questionCard, { borderLeftWidth: 4, borderLeftColor: isCorrect ? "#22C55E" : userAns ? "#EF4444" : "#9CA3AF" }]}>
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
              let bg = "#fff", border = Colors.light.border, textColor = Colors.light.text;
              if (isCorrectOpt) { bg = "#DCFCE7"; border = "#22C55E"; textColor = "#15803D"; }
              else if (isUserChoice && !isCorrectOpt) { bg = "#FEE2E2"; border = "#EF4444"; textColor = "#DC2626"; }
              return (
                <View key={letter} style={[styles.option, { backgroundColor: bg, borderColor: border }]}>
                  <View style={[styles.optionBullet, { backgroundColor: isCorrectOpt ? "#22C55E" : isUserChoice ? "#EF4444" : Colors.light.background }]}>
                    <Text style={[styles.optionBulletText, (isCorrectOpt || isUserChoice) && { color: "#fff" }]}>{letter}</Text>
                  </View>
                  <Text style={[styles.optionText, { color: textColor }]}>{opt}</Text>
                  {isCorrectOpt && <Ionicons name="checkmark-circle" size={18} color="#22C55E" />}
                  {isUserChoice && !isCorrectOpt && <Ionicons name="close-circle" size={18} color="#EF4444" />}
                </View>
              );
            })}
          </View>
          {/* Status row */}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <View style={[styles.statChip, { backgroundColor: isCorrect ? "#DCFCE7" : userAns ? "#FEE2E2" : "#F3F4F6" }]}>
              <Ionicons name={isCorrect ? "checkmark-circle" : userAns ? "close-circle" : "remove-circle"} size={14} color={isCorrect ? "#22C55E" : userAns ? "#EF4444" : "#9CA3AF"} />
              <Text style={[styles.statChipText, { color: isCorrect ? "#15803D" : userAns ? "#DC2626" : "#6B7280" }]}>
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
          {/* Solution */}
          {q.solution ? (
            <View style={{ backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 4 }}>Solution</Text>
              <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 20 }}>{q.solution}</Text>
              {q.solution_image_url ? (
                <Image source={{ uri: q.solution_image_url }} style={[styles.questionImage, { marginTop: 10 }]} resizeMode="contain" />
              ) : null}
            </View>
          ) : q.solution_image_url ? (
            <View style={{ backgroundColor: "#FFFBEB", borderRadius: 12, padding: 14, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#92400E", marginBottom: 8 }}>Solution</Text>
              <Image source={{ uri: q.solution_image_url }} style={styles.questionImage} resizeMode="contain" />
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.quizActions, { paddingBottom: bottomPadding + 16 }]}>
          <Pressable style={[styles.navBtn, reviewQIndex === 0 && styles.navBtnDisabled]} onPress={() => reviewQIndex > 0 && setReviewQIndex((p) => p - 1)} disabled={reviewQIndex === 0}>
            <Ionicons name="chevron-back" size={20} color={reviewQIndex === 0 ? Colors.light.textMuted : Colors.light.primary} />
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
  if (screen === "result" && activeMission) {
    const questions = activeMission.questions || [];
    const total = questions.length;
    // Use activeMission.userScore as fallback when state score is 0 (e.g. after page refresh)
    const displayScore = score > 0 ? score : (activeMission.userScore || 0);
    const pct = total > 0 ? Math.round((displayScore / total) * 100) : 0;
    const hasAnswers = Object.keys(selectedAnswers).length > 0;
    const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);
    const earnedMarks = hasAnswers ? questions.reduce((s, q) => {
      const ans = selectedAnswers[q.id] ?? (selectedAnswers as any)[String(q.id)];
      return ans === q.correct ? s + (q.marks || 0) : s;
    }, 0) : 0;
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.resultContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <Pressable onPress={resetMission} style={styles.backRow}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
          <Text style={styles.backText}>Back to Missions</Text>
        </Pressable>

        {/* Trophy card */}
        <LinearGradient colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]} style={styles.resultCard}>
          <MaterialCommunityIcons name="trophy" size={56} color="#fff" />
          <Text style={styles.resultTitle}>Mission Complete!</Text>
          <Text style={styles.resultScore}>{displayScore}/{total}</Text>
          <Text style={styles.resultPct}>{pct}% correct</Text>
        </LinearGradient>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Ionicons name="time-outline" size={20} color={Colors.light.primary} />
            <Text style={styles.statBoxVal}>{formatTime(totalTime)}</Text>
            <Text style={styles.statBoxLabel}>Time Taken</Text>
          </View>
          {totalMarks > 0 && (
            <View style={styles.statBox}>
              <Ionicons name="star-outline" size={20} color="#F59E0B" />
              <Text style={styles.statBoxVal}>{earnedMarks}/{totalMarks}</Text>
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

        {/* Review answers — only show if we have answer data */}
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
                style={[styles.reviewCard, isCorrect ? styles.reviewCorrect : isSkipped ? styles.reviewSkipped : styles.reviewWrong]}
                onPress={() => { setReviewQIndex(idx); setScreen("review"); }}
              >
                <View style={styles.reviewHeader}>
                  <Ionicons name={isCorrect ? "checkmark-circle" : isSkipped ? "remove-circle" : "close-circle"} size={20} color={isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444"} />
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
                  <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} style={{ marginLeft: "auto" as any }} />
                </View>
                <Text style={styles.reviewQuestion} numberOfLines={2}>{q.question}</Text>
                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <Text style={[styles.reviewCorrectAns]}>✓ {q.options[q.correct.charCodeAt(0) - 65]}</Text>
                  {!isCorrect && !isSkipped && (
                    <Text style={styles.reviewWrongAns}>✗ {q.options[userAns.charCodeAt(0) - 65]}</Text>
                  )}
                  {isSkipped && <Text style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" }}>Not answered</Text>}
                </View>
              </Pressable>
            );
          })}
        </View>
        ) : (
          <View style={{ backgroundColor: "#FEF3C7", borderRadius: 12, padding: 16, flexDirection: "row", gap: 10, alignItems: "center" }}>
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
  if (screen === "quiz" && activeMission) {
    const questions = activeMission.questions || [];
    const q = questions[currentQ];
    const OPTIONS = ["A", "B", "C", "D"];
    const totalMarks = questions.reduce((s, qq) => s + (qq.marks || 0), 0);
    return (
      <View style={[styles.container, { paddingBottom: bottomPadding + 80 }]}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.quizHeader, { paddingTop: topPadding + 8 }]}>
          <View style={styles.quizHeaderTop}>
            <Pressable onPress={() => {
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
                  ]
                );
              }
            }} hitSlop={10}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.quizCounter}>{currentQ + 1}/{questions.length}</Text>
            {/* Timer */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Ionicons name="time-outline" size={13} color="#fff" />
              <Text style={{ fontSize: 12, color: "#fff", fontFamily: "Inter_600SemiBold" }}>{formatTime(totalTime)}</Text>
            </View>
            {totalMarks > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(245,158,11,0.25)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Ionicons name="star" size={12} color="#F59E0B" />
                <Text style={{ fontSize: 12, color: "#F59E0B", fontFamily: "Inter_600SemiBold" }}>{q?.marks || 0} marks</Text>
              </View>
            )}
          </View>
          <View style={styles.quizProgress}>
            {questions.map((_, i) => (
              <View key={i} style={[styles.quizProgressDot,
                i === currentQ && styles.quizProgressDotActive,
                i < currentQ && styles.quizProgressDotDone,
                selectedAnswers[questions[i].id] ? styles.quizProgressDotAnswered : null
              ]} />
            ))}
          </View>
        </LinearGradient>

        <ScrollView style={styles.quizContent} contentContainerStyle={styles.quizContentInner} keyboardShouldPersistTaps="handled">
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
                  style={({ pressed }) => [styles.option, isSelected && styles.optionSelected, pressed && !isSelected && { opacity: 0.85 }]}
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
            <Pressable style={[styles.submitBtn, isSubmittingMission && { opacity: 0.7 }]} onPress={handleSubmit} disabled={isSubmittingMission}>
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
  if (screen === "start" && activeMission) {
    const questions = activeMission.questions || [];
    const totalMarks = questions.reduce((s, q) => s + (q.marks || 0), 0);
    const totalTime = questions.reduce((s, q) => s + (q.time_limit || 0), 0);
    const { topics, subtopics: startSubtopics } = uniqueTopicsAndSubtopicsFromQuestions(questions);
    const typeLabel = activeMission.mission_type === "free_practice" ? "Free Practice" : "Daily Drill";
    const typeColor = activeMission.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.startContent, { paddingTop: topPadding + 20, paddingBottom: bottomPadding + 100 }]}>
        <Pressable onPress={resetMission} style={styles.backRow}>
          <Ionicons name="arrow-back" size={20} color={Colors.light.primary} />
          <Text style={styles.backText}>Back to Missions</Text>
        </Pressable>
        <LinearGradient colors={["#F59E0B", "#EF4444"]} style={styles.missionCard}>
          <Ionicons name="flame" size={48} color="#fff" />
          <View style={[{ backgroundColor: typeColor + "30", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 }]}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{typeLabel}</Text>
          </View>
          <Text style={styles.missionCardTitle}>{activeMission.title}</Text>
          {activeMission.description ? <Text style={styles.missionCardDesc}>{activeMission.description}</Text> : null}
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
            {totalTime > 0 && (
              <View style={styles.missionStat}>
                <Ionicons name="time" size={18} color="#fff" />
                <Text style={styles.missionStatText}>{Math.ceil(totalTime / 60)} min</Text>
              </View>
            )}
          </View>
        </LinearGradient>
        {/* Topics */}
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
        <View style={{ backgroundColor: "#FEF3C7", borderRadius: 12, padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <Ionicons name="information-circle" size={18} color="#D97706" />
          <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#92400E", lineHeight: 18 }}>
            This mission can only be attempted once. Make sure you're ready before starting.
          </Text>
        </View>
        <Pressable style={styles.startBtn} onPress={() => { setScreen("quiz"); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); }}>
          <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.startBtnGradient}>
            <Text style={styles.startBtnText}>Start Mission</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </LinearGradient>
        </Pressable>
      </ScrollView>
    );
  }

  // ─── MISSION LIST ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={styles.headerGradient}>
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
          renderItem={({ item }) => {
            const questions: MissionQuestion[] = Array.isArray(item.questions) ? item.questions : [];
            const qCount = questions.length;
            const isLocked = !item.isAccessible;
            const isCompleted = item.isCompleted || completedThisSession.has(item.id) || (item.userScore !== undefined && item.userScore > 0);
            const sessionData = sessionResults[item.id];
            const typeLabel = item.mission_type === "free_practice" ? "Free" : "Paid";
            const typeColor = item.mission_type === "free_practice" ? "#22C55E" : "#F59E0B";
            const totalMarks = questions.reduce((s: number, q: MissionQuestion) => s + (q.marks || 0), 0);
            const totalTimeSecs = questions.reduce((s: number, q: MissionQuestion) => s + (q.time_limit || 0), 0);
            const { topics, subtopics } = uniqueTopicsAndSubtopicsFromQuestions(questions);
            return (
              <Pressable
                style={[styles.missionListCard, isLocked && styles.missionLocked, isCompleted && styles.missionDone]}
                onPress={() => startMission(item)}
              >
                {/* Completed score banner */}
                {isCompleted && (() => {
                  const rawAns = sessionData?.answers || item.userAnswers || {};
                  const displayScore = sessionData?.score ?? item.userScore ?? 0;                  const earnedMarks = totalMarks > 0 ? questions.reduce((s: number, q: MissionQuestion) => {
                    const ans = (rawAns as any)[q.id] ?? (rawAns as any)[String(q.id)];
                    return ans === q.correct ? s + (q.marks || 0) : s;
                  }, 0) : null;
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

                {/* Top row: badges */}
                <View style={styles.missionListTop}>
                  <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
                    <Text style={[styles.typeBadgeText, { color: typeColor }]}>{typeLabel}</Text>
                  </View>
                  {isLocked && <Ionicons name="lock-closed" size={16} color={Colors.light.textMuted} style={{ marginLeft: "auto" as any }} />}
                  <Text style={styles.missionDate}>{formatDate(item.mission_date)}</Text>
                </View>

                {/* Title */}
                <Text style={styles.missionListTitle}>{item.title}</Text>
                {item.description ? <Text style={styles.missionListDesc} numberOfLines={2}>{item.description}</Text> : null}

                {/* Stats row — only show when not completed */}
                {!isCompleted && (
                  <View style={styles.missionListFooter}>
                    <View style={styles.missionListStat}>
                      <Ionicons name="help-circle-outline" size={13} color={Colors.light.textMuted} />
                      <Text style={styles.missionListStatText}>{qCount} Qs</Text>
                    </View>
                    {totalMarks > 0 && (
                      <View style={styles.missionListStat}>
                        <Ionicons name="star-outline" size={13} color="#F59E0B" />
                        <Text style={styles.missionListStatText}>{totalMarks} marks</Text>
                      </View>
                    )}
                    {totalTimeSecs > 0 && (
                      <View style={styles.missionListStat}>
                        <Ionicons name="time-outline" size={13} color={Colors.light.textMuted} />
                        <Text style={styles.missionListStatText}>{Math.ceil(totalTimeSecs / 60)} min</Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Topics / subtopics */}
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
          }}
        />
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

  // Mission list card
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
  completedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  completedText: { fontSize: 11, color: "#22C55E", fontFamily: "Inter_600SemiBold" },
  missionDate: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginLeft: "auto" as any },
  missionListTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  missionListDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  missionListFooter: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  missionListStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  missionListStatText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_500Medium" },

  // Topic chips
  topicChip: { backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  topicChipText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  statChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#F3F4F6", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.text },

  // Start screen
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

  // Quiz screen
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
  option: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 2, borderColor: Colors.light.border },
  optionSelected: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  optionBullet: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.light.background, alignItems: "center", justifyContent: "center" },
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

  // Result screen
  resultContent: { padding: 20, gap: 16 },
  resultCard: { borderRadius: 24, padding: 28, alignItems: "center", gap: 8 },
  resultTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  resultScore: { fontSize: 48, fontFamily: "Inter_700Bold", color: "#fff" },
  resultPct: { fontSize: 16, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
  statsRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  statBox: { flex: 1, minWidth: 70, backgroundColor: "#fff", borderRadius: 14, padding: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: Colors.light.border },
  statBoxVal: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  statBoxLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center" },

  // Review
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
