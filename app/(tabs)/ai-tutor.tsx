import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, Platform, ActivityIndicator, FlatList, KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";

interface Doubt {
  id: number;
  question: string;
  answer: string;
  topic: string;
  status: string;
  created_at: number;
}

const TOPICS = ["General", "Algebra", "Geometry", "Trigonometry", "Calculus", "Statistics", "Real Numbers", "Probability"];
const QUICK_QUESTIONS = [
  "Explain the quadratic formula",
  "How to solve linear equations?",
  "What are trigonometric identities?",
  "Explain differentiation basics",
];

export default function AITutorScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState("General");
  const [isExpanded, setIsExpanded] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const topPadding = insets.top;
  const bottomPadding = insets.bottom;

  const { data: doubts = [], isLoading } = useQuery<Doubt[]>({
    queryKey: ["/api/doubts"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/doubts", baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 3 * 60 * 1000,
    gcTime: 20 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const askMutation = useMutation({
    mutationFn: async ({ q, t }: { q: string; t: string }) => {
      const res = await apiRequest("POST", "/api/doubts", { question: q, topic: t });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/doubts"] });
      setQuestion("");
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300);
    },
  });

  const handleAsk = () => {
    if (!question.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    askMutation.mutate({ q: question.trim(), t: topic });
  };

  const handleQuickQuestion = (q: string) => {
    setQuestion(q);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 20 }]}>
        <View style={styles.headerContent}>
          <View>
            <Text style={styles.headerTitle}>AI Tutor</Text>
            <Text style={styles.headerSub}>Ask anything, get instant help</Text>
          </View>
          <View style={styles.aiAvatar}>
            <MaterialCommunityIcons name="robot" size={28} color="#fff" />
          </View>
        </View>
      </LinearGradient>

      <View style={styles.inputSection}>
        <View style={styles.topicRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topicContent}>
            {TOPICS.map((t) => (
              <Pressable
                key={t}
                style={[styles.topicChip, topic === t && styles.topicChipActive]}
                onPress={() => setTopic(t)}
              >
                <Text style={[styles.topicText, topic === t && styles.topicTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Ask your maths doubt..."
            placeholderTextColor={Colors.light.textMuted}
            value={question}
            onChangeText={setQuestion}
            multiline
            maxLength={500}
            returnKeyType="send"
          />
          <Pressable
            style={({ pressed }) => [styles.sendBtn, (askMutation.isPending || !question.trim()) && styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
            onPress={handleAsk}
            disabled={askMutation.isPending || !question.trim()}
          >
            {askMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="send" size={18} color="#fff" />
            )}
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickQContent}>
          {QUICK_QUESTIONS.map((q) => (
            <Pressable key={q} style={styles.quickQChip} onPress={() => handleQuickQuestion(q)}>
              <Ionicons name="flash" size={12} color={Colors.light.primary} />
              <Text style={styles.quickQText}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.doubtsScroll}
        contentContainerStyle={[styles.doubtsContent, { paddingBottom: bottomPadding + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading your doubts...</Text>
          </View>
        ) : doubts.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="robot-outline" size={64} color={Colors.light.textMuted} />
            <Text style={styles.emptyTitle}>Ask your first doubt</Text>
            <Text style={styles.emptySubtitle}>Get instant AI-powered answers to all your maths questions. No question is too small!</Text>
          </View>
        ) : (
          doubts.map((doubt) => (
            <View key={doubt.id} style={styles.doubtCard}>
              <View style={styles.questionBubble}>
                <View style={styles.questionIcon}>
                  <Ionicons name="person" size={14} color="#fff" />
                </View>
                <View style={styles.questionContent}>
                  <View style={styles.questionTopRow}>
                    <Text style={styles.questionLabel}>You</Text>
                    <View style={styles.topicBadge}>
                      <Text style={styles.topicBadgeText}>{doubt.topic}</Text>
                    </View>
                  </View>
                  <Text style={styles.questionText}>{doubt.question}</Text>
                </View>
              </View>

              <View style={styles.answerBubble}>
                <View style={styles.answerIcon}>
                  <MaterialCommunityIcons name="robot" size={14} color="#fff" />
                </View>
                <View style={styles.answerContent}>
                  <Text style={styles.answerLabel}>AI Tutor</Text>
                  <Text style={styles.answerText}>{doubt.answer}</Text>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  headerContent: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 2 },
  aiAvatar: {
    width: 52, height: 52, borderRadius: 16,
    backgroundColor: Colors.light.accent, alignItems: "center", justifyContent: "center",
  },
  inputSection: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border, paddingTop: 12, gap: 8 },
  topicRow: {},
  topicContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  topicChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
    backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border,
  },
  topicChipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  topicText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  topicTextActive: { color: "#fff" },
  inputContainer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 16, paddingBottom: 8,
  },
  textInput: {
    flex: 1, backgroundColor: Colors.light.background, borderRadius: 14, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text,
    maxHeight: 100, borderWidth: 1, borderColor: Colors.light.border,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 14,
    backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: Colors.light.textMuted },
  quickQContent: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  quickQChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: Colors.light.border,
  },
  quickQText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  doubtsScroll: { flex: 1 },
  doubtsContent: { padding: 16, gap: 16 },
  loadingContainer: { paddingVertical: 40, alignItems: "center", gap: 12 },
  loadingText: { color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptyState: { paddingVertical: 60, alignItems: "center", gap: 12, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 20 },
  doubtCard: { gap: 8 },
  questionBubble: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  questionIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" },
  questionContent: { flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 14, borderTopLeftRadius: 4, padding: 12, gap: 4 },
  questionTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  questionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  topicBadge: { backgroundColor: Colors.light.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  topicBadgeText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#fff" },
  questionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text, lineHeight: 20 },
  answerBubble: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingLeft: 20 },
  answerIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.light.accent, alignItems: "center", justifyContent: "center" },
  answerContent: { flex: 1, backgroundColor: "#FFF8F5", borderRadius: 14, borderTopLeftRadius: 4, padding: 12, gap: 4, borderWidth: 1, borderColor: "#FDDCD4" },
  answerLabel: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.accent },
  answerText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, lineHeight: 22 },
});
