import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Platform, ActivityIndicator, Alert, Modal, Switch,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { fetch } from "expo/fetch";

interface Lecture {
  id: number;
  title: string;
  video_url: string;
  duration_minutes: number;
  order_index: number;
  is_free_preview: boolean;
}

interface TestItem {
  id: number;
  title: string;
  total_questions: number;
  duration_minutes: number;
  test_type: string;
}

interface CourseDetail {
  id: number;
  title: string;
  description: string;
  teacher_name: string;
  is_free: boolean;
  is_published: boolean;
  total_lectures: number;
  total_tests: number;
  lectures: Lecture[];
  tests: TestItem[];
}

interface NewLecture {
  title: string; description: string; videoUrl: string;
  videoType: string; durationMinutes: string; orderIndex: string; isFreePreview: boolean;
}

interface NewTestForm {
  title: string; description: string; durationMinutes: string;
  totalMarks: string; passingMarks: string; testType: string;
}

interface NewQuestion {
  questionText: string; optionA: string; optionB: string;
  optionC: string; optionD: string; correctOption: string;
  explanation: string; topic: string; marks: string; negativeMarks: string;
}

export default function AdminCourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"lectures" | "tests">("lectures");
  const [showAddLecture, setShowAddLecture] = useState(false);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState<number | null>(null);

  const [newLecture, setNewLecture] = useState<NewLecture>({
    title: "", description: "", videoUrl: "", videoType: "youtube",
    durationMinutes: "0", orderIndex: "0", isFreePreview: false,
  });

  const [newTest, setNewTest] = useState<NewTestForm>({
    title: "", description: "", durationMinutes: "60",
    totalMarks: "100", passingMarks: "35", testType: "practice",
  });

  const [newQuestion, setNewQuestion] = useState<NewQuestion>({
    questionText: "", optionA: "", optionB: "", optionC: "", optionD: "",
    correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1",
  });

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    enabled: !!id && id !== "undefined",
  });

  const addLectureMutation = useMutation({
    mutationFn: async (data: NewLecture) => {
      await apiRequest("POST", "/api/admin/lectures", { ...data, courseId: parseInt(id), durationMinutes: parseInt(data.durationMinutes), orderIndex: parseInt(data.orderIndex) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddLecture(false);
      setNewLecture({ title: "", description: "", videoUrl: "", videoType: "youtube", durationMinutes: "0", orderIndex: "0", isFreePreview: false });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Lecture added!");
    },
    onError: () => Alert.alert("Error", "Failed to add lecture"),
  });

  const deleteLectureMutation = useMutation({
    mutationFn: async (lectureId: number) => {
      await apiRequest("DELETE", `/api/admin/lectures/${lectureId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
  });

  const addTestMutation = useMutation({
    mutationFn: async (data: NewTestForm) => {
      const res = await apiRequest("POST", "/api/admin/tests", {
        ...data, courseId: parseInt(id),
        durationMinutes: parseInt(data.durationMinutes),
        totalMarks: parseInt(data.totalMarks),
        passingMarks: parseInt(data.passingMarks),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddTest(false);
      setNewTest({ title: "", description: "", durationMinutes: "60", totalMarks: "100", passingMarks: "35", testType: "practice" });
      Alert.alert("Success", "Test created!");
    },
    onError: () => Alert.alert("Error", "Failed to create test"),
  });

  const addQuestionMutation = useMutation({
    mutationFn: async ({ testId, data }: { testId: number; data: NewQuestion }) => {
      await apiRequest("POST", "/api/admin/questions", [{
        testId, ...data,
        marks: parseInt(data.marks), negativeMarks: parseFloat(data.negativeMarks),
      }]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddQuestion(null);
      setNewQuestion({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1" });
      Alert.alert("Success", "Question added!");
    },
    onError: () => Alert.alert("Error", "Failed to add question"),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/admin/tests/${testId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
    },
  });

  if (!id || id === "undefined") {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Select a Course</Text>
        </LinearGradient>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Please select a course from the admin dashboard</Text>
          <Pressable style={styles.backBtnSimple} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!course) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Course not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{course.title}</Text>
            <Text style={styles.headerSub}>{course.total_lectures} lectures · {course.total_tests} tests</Text>
          </View>
        </View>

        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, activeTab === "lectures" && styles.tabActive]} onPress={() => setActiveTab("lectures")}>
            <Text style={[styles.tabText, activeTab === "lectures" && styles.tabTextActive]}>Lectures</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === "tests" && styles.tabActive]} onPress={() => setActiveTab("tests")}>
            <Text style={[styles.tabText, activeTab === "tests" && styles.tabTextActive]}>Tests & Questions</Text>
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 80 }]}>
        {activeTab === "lectures" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Lectures ({course.lectures?.length || 0})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddLecture(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>

            {course.lectures?.map((lecture) => (
              <View key={lecture.id} style={styles.itemCard}>
                <View style={styles.itemIcon}>
                  <Ionicons name="videocam" size={18} color={Colors.light.primary} />
                </View>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemTitle}>{lecture.title}</Text>
                  <Text style={styles.itemMeta}>{lecture.duration_minutes}min · Order {lecture.order_index}{lecture.is_free_preview ? " · Preview" : ""}</Text>
                </View>
                <Pressable style={styles.deleteItemBtn} onPress={() => {
                  Alert.alert("Delete", `Delete "${lecture.title}"?`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteLectureMutation.mutate(lecture.id) },
                  ]);
                }}>
                  <Ionicons name="trash-outline" size={16} color="#EF4444" />
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {activeTab === "tests" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tests ({course.tests?.length || 0})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddTest(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Add Test</Text>
              </Pressable>
            </View>

            {course.tests?.map((test) => (
              <View key={test.id} style={styles.testCard}>
                <View style={styles.testCardRow}>
                  <Text style={styles.testCardTitle}>{test.title}</Text>
                  <View style={styles.testCardActions}>
                    <Pressable style={styles.addQBtn} onPress={() => setShowAddQuestion(test.id)}>
                      <Ionicons name="add-circle" size={16} color={Colors.light.primary} />
                      <Text style={styles.addQBtnText}>Add Q</Text>
                    </Pressable>
                    <Pressable style={styles.deleteItemBtn} onPress={() => {
                      Alert.alert("Delete Test", `Delete "${test.title}"?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) },
                      ]);
                    }}>
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
                <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={showAddLecture} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Lecture</Text>
              <Pressable onPress={() => setShowAddLecture(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {[
                { label: "Title *", key: "title", placeholder: "Lecture title" },
                { label: "Description", key: "description", placeholder: "What will students learn?" },
                { label: "YouTube URL *", key: "videoUrl", placeholder: "https://youtube.com/watch?v=..." },
                { label: "Duration (minutes)", key: "durationMinutes", placeholder: "45", numeric: true },
                { label: "Order Index", key: "orderIndex", placeholder: "1", numeric: true },
              ].map((field) => (
                <View key={field.key} style={styles.formField}>
                  <Text style={styles.formLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder={field.placeholder}
                    placeholderTextColor={Colors.light.textMuted}
                    value={String(newLecture[field.key as keyof NewLecture])}
                    onChangeText={(val) => setNewLecture((prev) => ({ ...prev, [field.key]: val }))}
                    keyboardType={field.numeric ? "numeric" : "default"}
                  />
                </View>
              ))}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Free Preview</Text>
                <Switch
                  value={newLecture.isFreePreview}
                  onValueChange={(val) => setNewLecture((prev) => ({ ...prev, isFreePreview: val }))}
                  trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
                  thumbColor="#fff"
                />
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!newLecture.title || !newLecture.videoUrl) && styles.createBtnDisabled]}
              onPress={() => (newLecture.title && newLecture.videoUrl) && addLectureMutation.mutate(newLecture)}
              disabled={!newLecture.title || !newLecture.videoUrl || addLectureMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addLectureMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Add Lecture</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddTest} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Test</Text>
              <Pressable onPress={() => setShowAddTest(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {[
                { label: "Test Title *", key: "title", placeholder: "e.g., Chapter 1 Test" },
                { label: "Description", key: "description", placeholder: "Test description" },
                { label: "Duration (minutes)", key: "durationMinutes", placeholder: "60", numeric: true },
                { label: "Total Marks", key: "totalMarks", placeholder: "100", numeric: true },
                { label: "Passing Marks", key: "passingMarks", placeholder: "35", numeric: true },
                { label: "Test Type", key: "testType", placeholder: "practice / mock / chapter / weekly" },
              ].map((field) => (
                <View key={field.key} style={styles.formField}>
                  <Text style={styles.formLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder={field.placeholder}
                    placeholderTextColor={Colors.light.textMuted}
                    value={String(newTest[field.key as keyof NewTestForm])}
                    onChangeText={(val) => setNewTest((prev) => ({ ...prev, [field.key]: val }))}
                    keyboardType={field.numeric ? "numeric" : "default"}
                  />
                </View>
              ))}
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !newTest.title && styles.createBtnDisabled]}
              onPress={() => newTest.title && addTestMutation.mutate(newTest)}
              disabled={!newTest.title || addTestMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addTestMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Test</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddQuestion !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Question</Text>
              <Pressable onPress={() => setShowAddQuestion(null)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 450 }}>
              {[
                { label: "Question *", key: "questionText", placeholder: "Enter the question" },
                { label: "Option A *", key: "optionA", placeholder: "First option" },
                { label: "Option B *", key: "optionB", placeholder: "Second option" },
                { label: "Option C *", key: "optionC", placeholder: "Third option" },
                { label: "Option D *", key: "optionD", placeholder: "Fourth option" },
                { label: "Correct Option (A/B/C/D)", key: "correctOption", placeholder: "A" },
                { label: "Topic", key: "topic", placeholder: "e.g., Real Numbers" },
                { label: "Explanation", key: "explanation", placeholder: "Solution explanation" },
                { label: "Marks", key: "marks", placeholder: "4", numeric: true },
                { label: "Negative Marks", key: "negativeMarks", placeholder: "1", numeric: true },
              ].map((field) => (
                <View key={field.key} style={styles.formField}>
                  <Text style={styles.formLabel}>{field.label}</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder={field.placeholder}
                    placeholderTextColor={Colors.light.textMuted}
                    value={String(newQuestion[field.key as keyof NewQuestion])}
                    onChangeText={(val) => setNewQuestion((prev) => ({ ...prev, [field.key]: val.toUpperCase() === val && field.key === "correctOption" ? val.toUpperCase() : val }))}
                    keyboardType={(field as { numeric?: boolean }).numeric ? "numeric" : "default"}
                    autoCapitalize={field.key === "correctOption" ? "characters" : "sentences"}
                  />
                </View>
              ))}
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!newQuestion.questionText || !newQuestion.optionA) && styles.createBtnDisabled]}
              onPress={() => {
                if (!newQuestion.questionText || !showAddQuestion) return;
                addQuestionMutation.mutate({ testId: showAddQuestion, data: newQuestion });
              }}
              disabled={!newQuestion.questionText || !newQuestion.optionA || addQuestionMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addQuestionMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Add Question</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 20 },
  errorText: { fontSize: 15, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },
  backBtnSimple: { backgroundColor: Colors.light.secondary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 8 },
  backBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  tabRow: { flexDirection: "row", gap: 8 },
  tab: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  tabTextActive: { color: Colors.light.primary },
  content: { padding: 16, gap: 12 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  itemCard: { backgroundColor: "#fff", borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  itemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  deleteItemBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  testCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 6 },
  testCardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  testCardTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  testCardActions: { flexDirection: "row", gap: 8 },
  addQBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  addQBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  testCardMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  formField: { marginBottom: 12 },
  formLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 },
  formInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
  createBtn: { marginTop: 12, borderRadius: 12, overflow: "hidden" },
  createBtnDisabled: { opacity: 0.5 },
  createBtnGrad: { paddingVertical: 14, alignItems: "center" },
  createBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
