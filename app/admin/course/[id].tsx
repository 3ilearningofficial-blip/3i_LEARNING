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
  section_title?: string;
}

interface TestItem {
  id: number;
  title: string;
  total_questions: number;
  duration_minutes: number;
  test_type: string;
}

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  section_title?: string;
}

interface LiveClassItem {
  id: number;
  title: string;
  youtube_url: string;
  is_live: boolean;
  is_completed: boolean;
  scheduled_at: number;
}

interface CourseDetail {
  id: number;
  title: string;
  description?: string;
  teacher_name?: string;
  price?: number;
  original_price?: number;
  category?: string;
  is_free: boolean;
  is_published?: boolean;
  level?: string;
  duration_hours?: number;
  course_type?: string;
  total_lectures: number;
  total_tests: number;
  lectures: Lecture[];
  tests: TestItem[];
  materials: Material[];
}

interface EditCourseForm {
  title: string;
  description: string;
  teacherName: string;
  price: string;
  originalPrice: string;
  category: string;
  subject: string;
  isFree: boolean;
  isPublished: boolean;
  level: string;
  durationHours: string;
  startDate: string;
  endDate: string;
}

type AdminCourseTab = "lectures" | "tests" | "materials" | "live";

interface NewLecture {
  title: string; description: string; videoUrl: string;
  videoType: string; durationMinutes: string; orderIndex: string;
  isFreePreview: boolean; sectionTitle: string;
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

interface NewMaterial {
  title: string; description: string; fileUrl: string;
  fileType: string; isFree: boolean; sectionTitle: string;
  downloadAllowed: boolean;
}

interface NewLiveClass {
  title: string; description: string; youtubeUrl: string;
  scheduledAt: string; isLive: boolean;
}

const ADMIN_COURSE_TABS: { key: AdminCourseTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "lectures", label: "Lectures", icon: "videocam" },
  { key: "tests", label: "Tests", icon: "document-text" },
  { key: "materials", label: "Materials", icon: "folder" },
  { key: "live", label: "Live", icon: "radio" },
];

const emptyLecture: NewLecture = { title: "", description: "", videoUrl: "", videoType: "youtube", durationMinutes: "0", orderIndex: "0", isFreePreview: false, sectionTitle: "" };
const emptyTest: NewTestForm = { title: "", description: "", durationMinutes: "60", totalMarks: "100", passingMarks: "35", testType: "practice" };
const emptyQuestion: NewQuestion = { questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1" };
const emptyMaterial: NewMaterial = { title: "", description: "", fileUrl: "", fileType: "pdf", isFree: false, sectionTitle: "", downloadAllowed: false };
const emptyLiveClass: NewLiveClass = { title: "", description: "", youtubeUrl: "", scheduledAt: "", isLive: false };

export default function AdminCourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminCourseTab>("lectures");
  const [showAddLecture, setShowAddLecture] = useState(false);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState<number | null>(null);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddLiveClass, setShowAddLiveClass] = useState(false);
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [editForm, setEditForm] = useState<EditCourseForm>({
    title: "", description: "", teacherName: "", price: "0", originalPrice: "0",
    category: "", subject: "", isFree: false, isPublished: true, level: "beginner", durationHours: "0", startDate: "", endDate: "",
  });
  const [showBulkUpload, setShowBulkUpload] = useState<number | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkUploadMode, setBulkUploadMode] = useState<"text" | "pdf">("text");
  const [bulkResult, setBulkResult] = useState<{ count: number; questions: any[] } | null>(null);
  const [newLecture, setNewLecture] = useState<NewLecture>(emptyLecture);
  const [newTest, setNewTest] = useState<NewTestForm>(emptyTest);
  const [newQuestion, setNewQuestion] = useState<NewQuestion>(emptyQuestion);
  const [newMaterial, setNewMaterial] = useState<NewMaterial>(emptyMaterial);
  const [newLiveClass, setNewLiveClass] = useState<NewLiveClass>(emptyLiveClass);
  const [liveClasses, setLiveClasses] = useState<LiveClassItem[]>([]);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const isValidId = !!id && id !== "undefined" && id !== "null";

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    enabled: isValidId,
  });

  const { data: courseLiveClasses = [] } = useQuery<LiveClassItem[]>({
    queryKey: ["/api/live-classes", id, "admin"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes?courseId=${id}&admin=true`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isValidId && activeTab === "live",
    refetchInterval: activeTab === "live" ? 10000 : false,
  });

  const addLectureMutation = useMutation({
    mutationFn: async (data: NewLecture) => {
      await apiRequest("POST", "/api/admin/lectures", {
        ...data, courseId: parseInt(id),
        durationMinutes: parseInt(data.durationMinutes) || 0,
        orderIndex: parseInt(data.orderIndex) || 0,
        sectionTitle: data.sectionTitle || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddLecture(false); setNewLecture(emptyLecture);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Lecture added!");
    },
    onError: () => Alert.alert("Error", "Failed to add lecture"),
  });

  const deleteLectureMutation = useMutation({
    mutationFn: async (lectureId: number) => {
      await apiRequest("DELETE", `/api/admin/lectures/${lectureId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const addTestMutation = useMutation({
    mutationFn: async (data: NewTestForm) => {
      await apiRequest("POST", "/api/admin/tests", {
        ...data, courseId: parseInt(id),
        durationMinutes: parseInt(data.durationMinutes),
        totalMarks: parseInt(data.totalMarks),
        passingMarks: parseInt(data.passingMarks),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddTest(false); setNewTest(emptyTest);
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
      setShowAddQuestion(null); setNewQuestion(emptyQuestion);
      Alert.alert("Success", "Question added!");
    },
    onError: () => Alert.alert("Error", "Failed to add question"),
  });

  const bulkUploadTextMutation = useMutation({
    mutationFn: async ({ testId, text }: { testId: number; text: string }) => {
      const res = await apiRequest("POST", "/api/admin/questions/bulk-text", {
        testId, text, defaultMarks: 4, defaultNegativeMarks: 1,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setBulkResult({ count: data.count, questions: data.questions });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to parse questions"),
  });

  const bulkUploadPdfMutation = useMutation({
    mutationFn: async ({ testId, file }: { testId: number; file: any }) => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/questions/bulk-pdf", baseUrl);
      const formData = new FormData();
      formData.append("testId", String(testId));
      formData.append("defaultMarks", "4");
      formData.append("defaultNegativeMarks", "1");
      if (Platform.OS === "web") {
        formData.append("pdf", file);
      } else {
        const FileSystem = await import("expo-file-system");
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        const blob = new Blob([byteArray], { type: "application/pdf" });
        formData.append("pdf", blob, file.name || "questions.pdf");
      }
      const nativeFetch = globalThis.fetch;
      const res = await nativeFetch(url.toString(), {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setBulkResult({ count: data.count, questions: data.questions });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: any) => Alert.alert("Error", err.message || "Failed to parse PDF"),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/admin/tests/${testId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const addMaterialMutation = useMutation({
    mutationFn: async (data: NewMaterial) => {
      await apiRequest("POST", "/api/admin/study-materials", {
        ...data, courseId: parseInt(id),
        sectionTitle: data.sectionTitle || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddMaterial(false); setNewMaterial(emptyMaterial);
      Alert.alert("Success", "Material added!");
    },
    onError: () => Alert.alert("Error", "Failed to add material"),
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: async (materialId: number) => {
      await apiRequest("DELETE", `/api/admin/study-materials/${materialId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const addLiveClassMutation = useMutation({
    mutationFn: async (data: NewLiveClass) => {
      await apiRequest("POST", "/api/admin/live-classes", {
        ...data,
        courseId: parseInt(id),
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).getTime() : Date.now(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      setShowAddLiveClass(false); setNewLiveClass(emptyLiveClass);
      Alert.alert("Success", "Live class added!");
    },
    onError: () => Alert.alert("Error", "Failed to add live class"),
  });

  const deleteLiveClassMutation = useMutation({
    mutationFn: async (lcId: number) => {
      await apiRequest("DELETE", `/api/admin/live-classes/${lcId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] }); },
  });

  const updateLiveClassMutation = useMutation({
    mutationFn: async ({ lcId, ...data }: { lcId: number; isLive?: boolean; isCompleted?: boolean; youtubeUrl?: string; convertToLecture?: boolean; sectionTitle?: string }) => {
      await apiRequest("PUT", `/api/admin/live-classes/${lcId}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      qc.invalidateQueries({ queryKey: ["/api/live-classes"] });
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
    },
  });

  const editCourseMutation = useMutation({
    mutationFn: async (data: EditCourseForm) => {
      await apiRequest("PUT", `/api/admin/courses/${id}`, {
        title: data.title,
        description: data.description,
        teacherName: data.teacherName,
        price: parseFloat(data.price) || 0,
        originalPrice: parseFloat(data.originalPrice) || 0,
        category: data.category,
        subject: data.subject,
        isFree: data.isFree,
        isPublished: data.isPublished,
        level: data.level,
        durationHours: parseFloat(data.durationHours) || 0,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowEditCourse(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Course updated!");
    },
    onError: () => Alert.alert("Error", "Failed to update course"),
  });

  const openEditCourse = () => {
    if (course) {
      setEditForm({
        title: course.title || "",
        description: course.description || "",
        teacherName: course.teacher_name || "",
        price: String(course.price || 0),
        originalPrice: String(course.original_price || 0),
        category: course.category || "",
        subject: (course as any).subject || "",
        isFree: course.is_free || false,
        isPublished: course.is_published !== false,
        level: course.level || "beginner",
        durationHours: String(course.duration_hours || 0),
        startDate: (course as any).start_date || "",
        endDate: (course as any).end_date || "",
      });
      setShowEditCourse(true);
    }
  };

  if (!isValidId) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Select a Course</Text>
        </LinearGradient>
        <View style={styles.centered}>
          <Ionicons name="folder-open-outline" size={48} color={Colors.light.textMuted} />
          <Text style={styles.errorText}>Please select a course from the Admin Dashboard</Text>
          <Pressable style={styles.backBtnSimple} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (isLoading) {
    return <View style={styles.centered}><ActivityIndicator size="large" color={Colors.light.primary} /></View>;
  }

  if (!course) {
    return <View style={styles.centered}><Text style={styles.errorText}>Course not found</Text></View>;
  }

  const isTestSeries = course.course_type === "test_series";
  const effectiveTab = isTestSeries ? "tests" : activeTab;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{course.title}</Text>
            <Text style={styles.headerSub}>
              {isTestSeries ? "Test Series" : `${course.total_lectures} lectures`} · {course.total_tests} tests
            </Text>
          </View>
          <Pressable style={styles.editCourseBtn} onPress={openEditCourse}>
            <Ionicons name="create-outline" size={18} color="#fff" />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {ADMIN_COURSE_TABS.filter(t => !isTestSeries || t.key === "tests").map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.tab, effectiveTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons name={tab.icon} size={14} color={effectiveTab === tab.key ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
              <Text style={[styles.tabText, effectiveTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 80 }]}>
        {effectiveTab === "lectures" && !isTestSeries && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Lectures ({course.lectures?.length || 0})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddLecture(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Add Lecture</Text>
              </Pressable>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
              <Text style={styles.infoText}>Use "Section/Folder Name" to organize lectures into folders. Leave blank for no folder.</Text>
            </View>
            {course.lectures?.map((lecture) => (
              <View key={lecture.id} style={styles.itemCard}>
                {lecture.section_title && (
                  <View style={styles.itemSectionBadge}>
                    <Ionicons name="folder" size={12} color={Colors.light.primary} />
                    <Text style={styles.itemSectionText}>{lecture.section_title}</Text>
                  </View>
                )}
                <View style={styles.itemRow}>
                  <View style={styles.itemIcon}>
                    <Ionicons name="videocam" size={16} color={Colors.light.primary} />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle}>{lecture.title}</Text>
                    <Text style={styles.itemMeta}>{lecture.duration_minutes}min · Order {lecture.order_index}{lecture.is_free_preview ? " · Free Preview" : ""}</Text>
                  </View>
                  <Pressable
                    style={styles.deleteItemBtn}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        if (window.confirm(`Delete "${lecture.title}"?`)) deleteLectureMutation.mutate(lecture.id);
                      } else {
                        Alert.alert("Delete Lecture", `Delete "${lecture.title}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteLectureMutation.mutate(lecture.id) },
                        ]);
                      }
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {effectiveTab === "tests" && (
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
                  <Pressable style={styles.deleteItemBtn} onPress={() => {
                    if (Platform.OS === "web") {
                      if (window.confirm(`Delete "${test.title}" and all its questions?`)) deleteTestMutation.mutate(test.id);
                    } else {
                      Alert.alert("Delete Test", `Delete "${test.title}" and all its questions?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) },
                      ]);
                    }
                  }}>
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </Pressable>
                </View>
                <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
                <View style={styles.testUploadRow}>
                  <Pressable style={styles.testUploadBtn} onPress={() => setShowAddQuestion(test.id)}>
                    <Ionicons name="create-outline" size={16} color={Colors.light.primary} />
                    <Text style={styles.testUploadBtnText}>Add Manually</Text>
                  </Pressable>
                  <Pressable style={[styles.testUploadBtn, { backgroundColor: "#FFF3E0" }]} onPress={() => { setShowBulkUpload(test.id); setBulkResult(null); setBulkText(""); }}>
                    <Ionicons name="cloud-upload" size={16} color="#FF6B35" />
                    <Text style={[styles.testUploadBtnText, { color: "#FF6B35" }]}>Upload via Text/PDF</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {effectiveTab === "materials" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Materials ({course.materials?.length || 0})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddMaterial(true)}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Add Material</Text>
              </Pressable>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
              <Text style={styles.infoText}>Add PDFs, notes, or reference links. Use "Folder Name" to organize materials into folders.</Text>
            </View>
            {course.materials?.map((mat) => (
              <View key={mat.id} style={styles.itemCard}>
                {mat.section_title && (
                  <View style={styles.itemSectionBadge}>
                    <Ionicons name="folder" size={12} color="#DC2626" />
                    <Text style={[styles.itemSectionText, { color: "#DC2626" }]}>{mat.section_title}</Text>
                  </View>
                )}
                <View style={styles.itemRow}>
                  <View style={[styles.itemIcon, { backgroundColor: "#FEE2E2" }]}>
                    <Ionicons name="document-text" size={16} color="#DC2626" />
                  </View>
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemTitle}>{mat.title}</Text>
                    <Text style={styles.itemMeta}>{mat.file_type?.toUpperCase() || "PDF"}{mat.description ? ` · ${mat.description}` : ""}</Text>
                  </View>
                  <Pressable
                    style={styles.deleteItemBtn}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        if (window.confirm(`Delete "${mat.title}"?`)) deleteMaterialMutation.mutate(mat.id);
                      } else {
                        Alert.alert("Delete Material", `Delete "${mat.title}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteMaterialMutation.mutate(mat.id) },
                        ]);
                      }
                    }}
                  >
                    <Ionicons name="trash-outline" size={16} color="#EF4444" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {effectiveTab === "live" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Live Classes ({courseLiveClasses.length})</Text>
              <Pressable style={[styles.addBtn, { backgroundColor: "#DC2626" }]} onPress={() => setShowAddLiveClass(true)}>
                <Ionicons name="radio" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Schedule Live</Text>
              </Pressable>
            </View>
            {courseLiveClasses.length === 0 && (
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                <Text style={styles.infoText}>Schedule a live class, then tap "Go Live" when ready to start streaming. Paste the YouTube stream/share link.</Text>
              </View>
            )}
            {courseLiveClasses.map((lc) => (
              <View key={lc.id} style={[styles.itemCard, { gap: 10 }]}>
                <View style={styles.itemRow}>
                  <View style={[styles.itemIcon, { backgroundColor: lc.is_live ? "#FEE2E2" : lc.is_completed ? "#F3F4F6" : Colors.light.secondary }]}>
                    <Ionicons name={lc.is_live ? "radio" : lc.is_completed ? "checkmark-circle" : "calendar"} size={16} color={lc.is_live ? "#DC2626" : lc.is_completed ? "#9CA3AF" : Colors.light.primary} />
                  </View>
                  <View style={styles.itemInfo}>
                    <View style={styles.liveRow}>
                      <Text style={[styles.itemTitle, lc.is_completed && { color: Colors.light.textMuted }]} numberOfLines={1}>{lc.title}</Text>
                      {lc.is_live && (
                        <View style={styles.liveBadge}>
                          <Text style={styles.liveBadgeText}>LIVE</Text>
                        </View>
                      )}
                      {lc.is_completed && (
                        <View style={[styles.liveBadge, { backgroundColor: "#9CA3AF" }]}>
                          <Text style={styles.liveBadgeText}>ENDED</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.itemMeta}>{new Date(lc.scheduled_at).toLocaleString()}</Text>
                    {lc.youtube_url ? <Text style={[styles.itemMeta, { color: Colors.light.primary }]} numberOfLines={1}>{lc.youtube_url}</Text> : null}
                  </View>
                </View>
                <View style={styles.liveActionRow}>
                  {!lc.is_live && !lc.is_completed && (
                    <Pressable
                      style={[styles.liveActionBtn, { backgroundColor: "#DC262620" }]}
                      onPress={() => {
                        updateLiveClassMutation.mutate({ lcId: lc.id, isLive: true });
                      }}
                    >
                      <Ionicons name="play-circle" size={16} color="#DC2626" />
                      <Text style={[styles.liveActionBtnText, { color: "#DC2626" }]}>Go Live</Text>
                    </Pressable>
                  )}
                  {lc.is_live && (
                    <Pressable
                      style={[styles.liveActionBtn, { backgroundColor: "#F59E0B20" }]}
                      onPress={() => {
                        const doEnd = () => {
                          updateLiveClassMutation.mutate({
                            lcId: lc.id, isLive: false, isCompleted: true,
                            convertToLecture: true, sectionTitle: "Live Class Recordings",
                          });
                          qc.invalidateQueries({ queryKey: ["/api/courses", id] });
                        };
                        if (Platform.OS === "web") {
                          if (window.confirm(`End "${lc.title}" and save as lecture recording?`)) doEnd();
                        } else {
                          Alert.alert("End Live Class", `End "${lc.title}" and save as lecture recording?`, [
                            { text: "Cancel", style: "cancel" },
                            { text: "End & Save", onPress: doEnd },
                          ]);
                        }
                      }}
                    >
                      <Ionicons name="stop-circle" size={16} color="#F59E0B" />
                      <Text style={[styles.liveActionBtnText, { color: "#F59E0B" }]}>End & Save</Text>
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.liveActionBtn, { backgroundColor: "#FEE2E2" }]}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        if (window.confirm(`Delete "${lc.title}"?`)) deleteLiveClassMutation.mutate(lc.id);
                      } else {
                        Alert.alert("Delete", `Delete "${lc.title}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteLiveClassMutation.mutate(lc.id) },
                        ]);
                      }
                    }}
                  >
                    <Ionicons name="trash-outline" size={14} color="#EF4444" />
                    <Text style={[styles.liveActionBtnText, { color: "#EF4444" }]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Add Lecture Modal */}
      <Modal visible={showAddLecture} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Lecture</Text>
              <Pressable onPress={() => { setShowAddLecture(false); setNewLecture(emptyLecture); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <FormField label="Folder/Section Name (optional)" placeholder="e.g., Chapter 1 - Introduction" value={newLecture.sectionTitle} onChangeText={(v) => setNewLecture(p => ({ ...p, sectionTitle: v }))} />
              <FormField label="Lecture Title *" placeholder="e.g., Introduction to Algebra" value={newLecture.title} onChangeText={(v) => setNewLecture(p => ({ ...p, title: v }))} />
              <FormField label="YouTube URL *" placeholder="https://youtube.com/watch?v=..." value={newLecture.videoUrl} onChangeText={(v) => setNewLecture(p => ({ ...p, videoUrl: v }))} />
              <FormField label="Description" placeholder="What students will learn" value={newLecture.description} onChangeText={(v) => setNewLecture(p => ({ ...p, description: v }))} multiline />
              <FormField label="Duration (minutes)" placeholder="45" value={newLecture.durationMinutes} onChangeText={(v) => setNewLecture(p => ({ ...p, durationMinutes: v }))} numeric />
              <FormField label="Order Index (lower = first)" placeholder="1" value={newLecture.orderIndex} onChangeText={(v) => setNewLecture(p => ({ ...p, orderIndex: v }))} numeric />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Free Preview (visible without enrollment)</Text>
                <Switch value={newLecture.isFreePreview} onValueChange={(v) => setNewLecture(p => ({ ...p, isFreePreview: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton
              label="Add Lecture"
              onPress={() => addLectureMutation.mutate(newLecture)}
              disabled={!newLecture.title || !newLecture.videoUrl}
              loading={addLectureMutation.isPending}
            />
          </View>
        </View>
      </Modal>

      {/* Add Test Modal */}
      <Modal visible={showAddTest} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Test</Text>
              <Pressable onPress={() => { setShowAddTest(false); setNewTest(emptyTest); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <FormField label="Test Title *" placeholder="e.g., Chapter 1 Test" value={newTest.title} onChangeText={(v) => setNewTest(p => ({ ...p, title: v }))} />
              <FormField label="Description" placeholder="Test description" value={newTest.description} onChangeText={(v) => setNewTest(p => ({ ...p, description: v }))} />
              <FormField label="Type (practice/mock/chapter/weekly/pyq_practice/pyq_papers)" placeholder="practice" value={newTest.testType} onChangeText={(v) => setNewTest(p => ({ ...p, testType: v }))} />
              <FormField label="Duration (minutes)" placeholder="60" value={newTest.durationMinutes} onChangeText={(v) => setNewTest(p => ({ ...p, durationMinutes: v }))} numeric />
              <FormField label="Total Marks" placeholder="100" value={newTest.totalMarks} onChangeText={(v) => setNewTest(p => ({ ...p, totalMarks: v }))} numeric />
              <FormField label="Passing Marks" placeholder="35" value={newTest.passingMarks} onChangeText={(v) => setNewTest(p => ({ ...p, passingMarks: v }))} numeric />
            </ScrollView>
            <ActionButton label="Create Test" onPress={() => addTestMutation.mutate(newTest)} disabled={!newTest.title} loading={addTestMutation.isPending} />
          </View>
        </View>
      </Modal>

      {/* Add Question Modal */}
      <Modal visible={showAddQuestion !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Question</Text>
              <Pressable onPress={() => { setShowAddQuestion(null); setNewQuestion(emptyQuestion); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <FormField label="Question *" placeholder="Enter the question text" value={newQuestion.questionText} onChangeText={(v) => setNewQuestion(p => ({ ...p, questionText: v }))} multiline />
              <FormField label="Option A *" placeholder="First option" value={newQuestion.optionA} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionA: v }))} />
              <FormField label="Option B *" placeholder="Second option" value={newQuestion.optionB} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionB: v }))} />
              <FormField label="Option C" placeholder="Third option" value={newQuestion.optionC} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionC: v }))} />
              <FormField label="Option D" placeholder="Fourth option" value={newQuestion.optionD} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionD: v }))} />
              <FormField label="Correct Option (A/B/C/D)" placeholder="A" value={newQuestion.correctOption} onChangeText={(v) => setNewQuestion(p => ({ ...p, correctOption: v.toUpperCase().slice(0, 1) }))} autoCapitalize="characters" />
              <FormField label="Topic" placeholder="e.g., Trigonometry" value={newQuestion.topic} onChangeText={(v) => setNewQuestion(p => ({ ...p, topic: v }))} />
              <FormField label="Explanation (optional)" placeholder="Solution explanation" value={newQuestion.explanation} onChangeText={(v) => setNewQuestion(p => ({ ...p, explanation: v }))} multiline />
              <FormField label="Marks for correct" placeholder="4" value={newQuestion.marks} onChangeText={(v) => setNewQuestion(p => ({ ...p, marks: v }))} numeric />
              <FormField label="Negative marks for wrong" placeholder="1" value={newQuestion.negativeMarks} onChangeText={(v) => setNewQuestion(p => ({ ...p, negativeMarks: v }))} numeric />
            </ScrollView>
            <ActionButton
              label="Add Question"
              onPress={() => { if (showAddQuestion) addQuestionMutation.mutate({ testId: showAddQuestion, data: newQuestion }); }}
              disabled={!newQuestion.questionText || !newQuestion.optionA || !newQuestion.optionB}
              loading={addQuestionMutation.isPending}
            />
          </View>
        </View>
      </Modal>

      {/* Add Material Modal */}
      <Modal visible={showAddMaterial} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Study Material</Text>
              <Pressable onPress={() => { setShowAddMaterial(false); setNewMaterial(emptyMaterial); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <FormField label="Folder Name (optional)" placeholder="e.g., Chapter 1 Notes" value={newMaterial.sectionTitle} onChangeText={(v) => setNewMaterial(p => ({ ...p, sectionTitle: v }))} />
              <FormField label="Title *" placeholder="e.g., Algebra Formula Sheet" value={newMaterial.title} onChangeText={(v) => setNewMaterial(p => ({ ...p, title: v }))} />
              <FormField label="File URL" placeholder="https://drive.google.com/..." value={newMaterial.fileUrl} onChangeText={(v) => setNewMaterial(p => ({ ...p, fileUrl: v }))} />
              <FormField label="File Type (pdf/video/link/doc)" placeholder="pdf" value={newMaterial.fileType} onChangeText={(v) => setNewMaterial(p => ({ ...p, fileType: v }))} />
              <FormField label="Description" placeholder="Short description of the material" value={newMaterial.description} onChangeText={(v) => setNewMaterial(p => ({ ...p, description: v }))} />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Allow Download</Text>
                <Switch value={newMaterial.downloadAllowed} onValueChange={(v) => setNewMaterial(p => ({ ...p, downloadAllowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton label="Add Material" onPress={() => addMaterialMutation.mutate(newMaterial)} disabled={!newMaterial.title} loading={addMaterialMutation.isPending} />
          </View>
        </View>
      </Modal>

      {/* Add Live Class Modal */}
      <Modal visible={showAddLiveClass} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Live Class</Text>
              <Pressable onPress={() => { setShowAddLiveClass(false); setNewLiveClass(emptyLiveClass); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              <FormField label="Title *" placeholder="e.g., Live Class - Trigonometry Revision" value={newLiveClass.title} onChangeText={(v) => setNewLiveClass(p => ({ ...p, title: v }))} />
              <FormField label="YouTube URL *" placeholder="https://youtube.com/watch?v=... or live stream URL" value={newLiveClass.youtubeUrl} onChangeText={(v) => setNewLiveClass(p => ({ ...p, youtubeUrl: v }))} />
              <FormField label="Description" placeholder="What will be covered" value={newLiveClass.description} onChangeText={(v) => setNewLiveClass(p => ({ ...p, description: v }))} />
              <FormField label="Scheduled Date & Time" placeholder="2026-03-15 18:00" value={newLiveClass.scheduledAt} onChangeText={(v) => setNewLiveClass(p => ({ ...p, scheduledAt: v }))} />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Is Live Right Now?</Text>
                <Switch value={newLiveClass.isLive} onValueChange={(v) => setNewLiveClass(p => ({ ...p, isLive: v }))} trackColor={{ false: Colors.light.border, true: "#DC2626" }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton
              label="Add Live Class"
              onPress={() => addLiveClassMutation.mutate(newLiveClass)}
              disabled={!newLiveClass.title || !newLiveClass.youtubeUrl}
              loading={addLiveClassMutation.isPending}
              color="#DC2626"
            />
          </View>
        </View>
      </Modal>

      {/* Bulk Upload Questions Modal */}
      <Modal visible={showBulkUpload !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bulk Upload Questions</Text>
              <Pressable onPress={() => { setShowBulkUpload(null); setBulkText(""); setBulkResult(null); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>

            {bulkResult ? (
              <View style={{ gap: 12 }}>
                <View style={styles.successCard}>
                  <Ionicons name="checkmark-circle" size={40} color={Colors.light.success} />
                  <Text style={styles.successTitle}>{bulkResult.count} Questions Imported!</Text>
                  <Text style={styles.successSub}>All questions have been added with default answer "A". Review and update correct answers as needed.</Text>
                </View>
                <ScrollView style={{ maxHeight: 200 }}>
                  {bulkResult.questions.map((q, i) => (
                    <View key={i} style={styles.previewQuestion}>
                      <Text style={styles.previewQNum}>Q{i + 1}</Text>
                      <Text style={styles.previewQText} numberOfLines={2}>{q.questionText}</Text>
                    </View>
                  ))}
                </ScrollView>
                <ActionButton label="Done" onPress={() => { setShowBulkUpload(null); setBulkText(""); setBulkResult(null); }} color={Colors.light.success} />
              </View>
            ) : (
              <>
                <View style={styles.modeToggle}>
                  <Pressable
                    style={[styles.modeBtn, bulkUploadMode === "text" && styles.modeBtnActive]}
                    onPress={() => setBulkUploadMode("text")}
                  >
                    <Ionicons name="create" size={16} color={bulkUploadMode === "text" ? "#fff" : Colors.light.text} />
                    <Text style={[styles.modeBtnText, bulkUploadMode === "text" && styles.modeBtnTextActive]}>Paste Text</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.modeBtn, bulkUploadMode === "pdf" && styles.modeBtnActive]}
                    onPress={() => setBulkUploadMode("pdf")}
                  >
                    <Ionicons name="document" size={16} color={bulkUploadMode === "pdf" ? "#fff" : Colors.light.text} />
                    <Text style={[styles.modeBtnText, bulkUploadMode === "pdf" && styles.modeBtnTextActive]}>Upload PDF</Text>
                  </Pressable>
                </View>

                {bulkUploadMode === "text" ? (
                  <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
                    <View style={styles.infoCard}>
                      <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>
                        Paste questions in this format:{"\n\n"}
                        Q1. What is 2 + 2?{"\n"}
                        A. 3{"\n"}
                        B. 4{"\n"}
                        C. 5{"\n"}
                        D. 6{"\n"}
                        Answer: B{"\n\n"}
                        Q2. What is 3 x 3?{"\n"}
                        A. 6{"\n"}
                        B. 9{"\n"}
                        C. 12{"\n"}
                        D. 15{"\n\n"}
                        Note: If no answer is marked, default "A" will be used. You can edit correct answers later.
                      </Text>
                    </View>
                    <View style={styles.formField}>
                      <Text style={styles.formLabel}>Paste Questions</Text>
                      <TextInput
                        style={[styles.formInput, { height: 200, textAlignVertical: "top" }]}
                        placeholder={"Q1. What is the value of sin(90°)?\nA. 0\nB. 1\nC. -1\nD. 0.5\n\nQ2. What is cos(0°)?\nA. 0\nB. 1\nC. -1\nD. 0.5"}
                        placeholderTextColor={Colors.light.textMuted}
                        value={bulkText}
                        onChangeText={setBulkText}
                        multiline
                        numberOfLines={10}
                      />
                    </View>
                  </ScrollView>
                ) : (
                  <View style={{ gap: 12 }}>
                    <View style={styles.infoCard}>
                      <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>
                        Upload a PDF with questions. Each question should be numbered (Q1, 1., etc.) with options labeled A, B, C, D.{"\n\n"}
                        The system will extract text from the PDF and parse questions automatically. Answers default to "A" — update them after import.
                      </Text>
                    </View>
                    {Platform.OS === "web" ? (
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Select PDF File</Text>
                        <Pressable
                          style={styles.filePickerBtn}
                          onPress={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = ".pdf";
                            input.onchange = (e: any) => {
                              const file = e.target?.files?.[0];
                              if (file && showBulkUpload) {
                                bulkUploadPdfMutation.mutate({ testId: showBulkUpload, file });
                              }
                            };
                            input.click();
                          }}
                        >
                          <Ionicons name="cloud-upload" size={28} color={Colors.light.primary} />
                          <Text style={styles.filePickerText}>Tap to select PDF file</Text>
                          <Text style={styles.filePickerSub}>Max 10MB</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>PDF Upload</Text>
                        <Pressable
                          style={styles.filePickerBtn}
                          onPress={async () => {
                            try {
                              const DocumentPicker = await import("expo-document-picker");
                              const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
                              if (!result.canceled && result.assets?.[0] && showBulkUpload) {
                                bulkUploadPdfMutation.mutate({ testId: showBulkUpload, file: result.assets[0] });
                              }
                            } catch {
                              Alert.alert("Error", "Could not open file picker");
                            }
                          }}
                        >
                          <Ionicons name="cloud-upload" size={28} color={Colors.light.primary} />
                          <Text style={styles.filePickerText}>Tap to select PDF file</Text>
                          <Text style={styles.filePickerSub}>Max 10MB</Text>
                        </Pressable>
                      </View>
                    )}
                  </View>
                )}

                {bulkUploadMode === "text" && (
                  <ActionButton
                    label="Parse & Import Questions"
                    onPress={() => { if (showBulkUpload && bulkText.trim()) bulkUploadTextMutation.mutate({ testId: showBulkUpload, text: bulkText }); }}
                    disabled={!bulkText.trim()}
                    loading={bulkUploadTextMutation.isPending}
                    color="#FF6B35"
                  />
                )}
                {bulkUploadMode === "pdf" && bulkUploadPdfMutation.isPending && (
                  <View style={{ alignItems: "center", padding: 16 }}>
                    <ActivityIndicator size="large" color="#FF6B35" />
                    <Text style={{ marginTop: 8, color: Colors.light.textSecondary, fontFamily: "Inter_500Medium" }}>Parsing PDF...</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showEditCourse} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Course</Text>
              <Pressable onPress={() => setShowEditCourse(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <FormField label="Course Title *" placeholder="e.g., NDA Mathematics" value={editForm.title} onChangeText={(v) => setEditForm(p => ({ ...p, title: v }))} />
              <FormField label="Description" placeholder="Course description" value={editForm.description} onChangeText={(v) => setEditForm(p => ({ ...p, description: v }))} multiline />
              <FormField label="Category *" placeholder="e.g., NDA, CDS, AFCAT" value={editForm.category} onChangeText={(v) => setEditForm(p => ({ ...p, category: v }))} />
              <FormField label="Subject" placeholder="e.g., Mathematics, English, GK" value={editForm.subject} onChangeText={(v) => setEditForm(p => ({ ...p, subject: v }))} />
              <FormField label="Teacher Name" placeholder="e.g., Pankaj Sir" value={editForm.teacherName} onChangeText={(v) => setEditForm(p => ({ ...p, teacherName: v }))} />
              <FormField label="Level (beginner/intermediate/advanced)" placeholder="beginner" value={editForm.level} onChangeText={(v) => setEditForm(p => ({ ...p, level: v }))} />
              <FormField label="Duration (hours)" placeholder="10" value={editForm.durationHours} onChangeText={(v) => setEditForm(p => ({ ...p, durationHours: v }))} numeric />
              <FormField label="Start Date" placeholder="e.g., 15 Mar 2026" value={editForm.startDate} onChangeText={(v) => setEditForm(p => ({ ...p, startDate: v }))} />
              <FormField label="End Date" placeholder="e.g., 15 Jun 2026" value={editForm.endDate} onChangeText={(v) => setEditForm(p => ({ ...p, endDate: v }))} />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Free Course</Text>
                <Switch value={editForm.isFree} onValueChange={(v) => setEditForm(p => ({ ...p, isFree: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
              {!editForm.isFree && (
                <>
                  <FormField label="Price (₹)" placeholder="499" value={editForm.price} onChangeText={(v) => setEditForm(p => ({ ...p, price: v }))} numeric />
                  <FormField label="Original Price (₹)" placeholder="999" value={editForm.originalPrice} onChangeText={(v) => setEditForm(p => ({ ...p, originalPrice: v }))} numeric />
                </>
              )}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Published (visible to students)</Text>
                <Switch value={editForm.isPublished} onValueChange={(v) => setEditForm(p => ({ ...p, isPublished: v }))} trackColor={{ false: Colors.light.border, true: "#16A34A" }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton
              label="Save Changes"
              onPress={() => editCourseMutation.mutate(editForm)}
              disabled={!editForm.title || !editForm.category}
              loading={editCourseMutation.isPending}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

function FormField({
  label, placeholder, value, onChangeText, multiline, numeric, autoCapitalize,
}: {
  label: string; placeholder: string; value: string;
  onChangeText: (v: string) => void; multiline?: boolean; numeric?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        style={[styles.formInput, multiline && styles.formInputMulti]}
        placeholder={placeholder}
        placeholderTextColor={Colors.light.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
        keyboardType={numeric ? "numeric" : "default"}
        autoCapitalize={autoCapitalize || "sentences"}
      />
    </View>
  );
}

function ActionButton({ label, onPress, disabled, loading, color }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; color?: string }) {
  const btnColor = color || Colors.light.primary;
  const darkColor = color ? `${color}CC` : Colors.light.primaryDark;
  return (
    <Pressable style={[styles.createBtn, disabled && styles.createBtnDisabled]} onPress={onPress} disabled={disabled || loading}>
      <LinearGradient colors={[btnColor, darkColor]} style={styles.createBtnGrad}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>{label}</Text>}
      </LinearGradient>
    </Pressable>
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
  editCourseBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerContent: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  tabsRow: { gap: 8, paddingVertical: 4 },
  tab: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)" },
  tabActive: { backgroundColor: "#fff" },
  tabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  tabTextActive: { color: Colors.light.primary },
  content: { padding: 16, gap: 12 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  infoCard: { backgroundColor: Colors.light.secondary, borderRadius: 10, padding: 12, flexDirection: "row", gap: 8, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 },
  liveActionRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 12 },
  liveActionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  liveActionBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  itemCard: { backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border },
  itemSectionBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.secondary, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  itemSectionText: { fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  itemIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  itemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  deleteItemBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  testCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, gap: 6, borderWidth: 1, borderColor: Colors.light.border },
  testCardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  testCardTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  testCardActions: { flexDirection: "row", gap: 8 },
  addQBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  addQBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  testCardMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  testUploadRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  testUploadBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.light.secondary, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8 },
  testUploadBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveBadge: { backgroundColor: "#DC2626", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  liveBadgeText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "92%", padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  formField: { marginBottom: 12 },
  formLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 },
  formInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
  formInputMulti: { height: 80, textAlignVertical: "top" },
  createBtn: { marginTop: 12, borderRadius: 12, overflow: "hidden" },
  createBtnDisabled: { opacity: 0.5 },
  createBtnGrad: { paddingVertical: 14, alignItems: "center" },
  createBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  modeToggle: { flexDirection: "row" as const, gap: 8, marginBottom: 16 },
  modeBtn: { flex: 1, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border },
  modeBtnActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  modeBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  modeBtnTextActive: { color: "#fff" },
  successCard: { backgroundColor: "#F0FDF4", borderRadius: 16, padding: 24, alignItems: "center" as const, gap: 8, borderWidth: 1, borderColor: "#BBF7D0" },
  successTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#16A34A" },
  successSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#5A6A85", textAlign: "center" as const, lineHeight: 19 },
  previewQuestion: { flexDirection: "row" as const, gap: 8, alignItems: "center" as const, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  previewQNum: { fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary, width: 28 },
  previewQText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text },
  filePickerBtn: { borderWidth: 2, borderColor: Colors.light.border, borderStyle: "dashed" as const, borderRadius: 16, padding: 32, alignItems: "center" as const, gap: 8, backgroundColor: Colors.light.background },
  filePickerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  filePickerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
});
