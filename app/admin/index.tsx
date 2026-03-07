import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, TextInput, Modal, Switch,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { fetch } from "expo/fetch";

interface Course {
  id: number;
  title: string;
  category: string;
  is_free: boolean;
  total_lectures: number;
  total_tests: number;
  is_published: boolean;
  price: string;
  course_type?: string;
}

interface UserRecord {
  id: number;
  name: string;
  email: string;
  phone: string;
  role: string;
  created_at: number;
}

type AdminTab = "courses" | "tests" | "users" | "notifications" | "missions";

const ADMIN_TABS: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "courses", label: "Courses", icon: "book" },
  { key: "tests", label: "Tests", icon: "document-text" },
  { key: "missions", label: "Missions", icon: "flame" },
  { key: "users", label: "Users", icon: "people" },
  { key: "notifications", label: "Notify", icon: "notifications" },
];

interface NewCourse {
  title: string; description: string; teacherName: string; price: string;
  originalPrice: string; category: string; subject: string; isFree: boolean; level: string; durationHours: string;
  courseType: string;
}

export default function AdminDashboard() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isAdmin, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>("courses");
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [showAddMission, setShowAddMission] = useState(false);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionDesc, setMissionDesc] = useState("");
  const [missionType, setMissionType] = useState<"daily_drill" | "free_practice">("free_practice");
  const [missionXP, setMissionXP] = useState("50");
  const [missionQuestions, setMissionQuestions] = useState<{ question: string; options: string[]; correct: string; topic: string }[]>([]);
  const [missionCourseId, setMissionCourseId] = useState<number | null>(null);

  const [newCourse, setNewCourse] = useState<NewCourse>({
    title: "", description: "", teacherName: "3i Learning",
    price: "0", originalPrice: "0", category: "Mathematics",
    subject: "", isFree: false, level: "Beginner", durationHours: "0",
    courseType: "live",
  });
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTargetCourseId, setImportTargetCourseId] = useState<number | null>(null);
  const [importSourceCourseId, setImportSourceCourseId] = useState<number | null>(null);
  const [allLectures, setAllLectures] = useState<any[]>([]);
  const [allTests, setAllTests] = useState<any[]>([]);
  const [selectedLectureIds, setSelectedLectureIds] = useState<number[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<number[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importSectionTitle, setImportSectionTitle] = useState("");
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [testTitle, setTestTitle] = useState("");
  const [testDesc, setTestDesc] = useState("");
  const [testType, setTestType] = useState("practice");
  const [testDuration, setTestDuration] = useState("60");
  const [testTotalMarks, setTestTotalMarks] = useState("100");
  const [testPassingMarks, setTestPassingMarks] = useState("35");
  const [testCourseId, setTestCourseId] = useState<number | null>(null);
  const [showTestQuestions, setShowTestQuestions] = useState<number | null>(null);
  const [showAddQ, setShowAddQ] = useState(false);
  const [showBulkQ, setShowBulkQ] = useState(false);
  const [bulkQText, setBulkQText] = useState("");
  const [bulkQResult, setBulkQResult] = useState<{ count: number; questions: any[] } | null>(null);
  const [newQ, setNewQ] = useState({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1" });

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: courses = [], isLoading: coursesLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    enabled: activeTab === "courses" || activeTab === "tests",
  });

  const { data: users = [], isLoading: usersLoading } = useQuery<UserRecord[]>({
    queryKey: ["/api/admin/users"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/users", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "users",
  });

  const { data: adminMissions = [], isLoading: missionsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/daily-missions"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/daily-missions", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "missions",
  });

  const addMissionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/daily-missions", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      setShowAddMission(false);
      setMissionTitle(""); setMissionDesc(""); setMissionQuestions([]);
      setMissionXP("50"); setMissionType("free_practice"); setMissionCourseId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Mission created!");
    },
    onError: () => Alert.alert("Error", "Failed to create mission"),
  });

  const deleteMissionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/daily-missions/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete mission"),
  });

  const { data: adminTests = [], isLoading: testsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/tests"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/tests", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "tests",
  });

  const createTestMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/tests", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      setShowCreateTest(false);
      setTestTitle(""); setTestDesc(""); setTestType("practice");
      setTestDuration("60"); setTestTotalMarks("100"); setTestPassingMarks("35");
      setTestCourseId(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Test created!");
    },
    onError: () => Alert.alert("Error", "Failed to create test"),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/tests/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete test"),
  });

  const addQuestionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/questions", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      setShowAddQ(false);
      setNewQ({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Question added!");
    },
    onError: () => Alert.alert("Error", "Failed to add question"),
  });

  const bulkUploadMutation = useMutation({
    mutationFn: async (data: { testId: number; text: string }) => {
      const res = await apiRequest("POST", "/api/admin/questions/bulk-text", data);
      return res.json();
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      setBulkQResult(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to upload questions"),
  });

  const addCourseMutation = useMutation({
    mutationFn: async (courseData: NewCourse) => {
      const res = await apiRequest("POST", "/api/admin/courses", courseData);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowAddCourse(false);
      setNewCourse({ title: "", description: "", teacherName: "3i Learning", price: "0", originalPrice: "0", category: "Mathematics", subject: "", isFree: false, level: "Beginner", durationHours: "0", courseType: "live" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Course created successfully!");
    },
    onError: () => Alert.alert("Error", "Failed to create course"),
  });

  const deleteCourseMutation = useMutation({
    mutationFn: async (courseId: number) => {
      await apiRequest("DELETE", `/api/admin/courses/${courseId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete course"),
  });

  const sendNotificationMutation = useMutation({
    mutationFn: async ({ title, message }: { title: string; message: string }) => {
      await apiRequest("POST", "/api/admin/notifications/send", { title, message, type: "info" });
    },
    onSuccess: () => {
      setShowNotification(false);
      setNotifTitle(""); setNotifMessage("");
      Alert.alert("Sent!", "Notification sent to all students.");
    },
    onError: () => Alert.alert("Error", "Failed to send notification"),
  });

  if (!isAdmin) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed" size={48} color={Colors.light.textMuted} />
        <Text style={styles.errorText}>Admin access required</Text>
        <Pressable style={styles.backBtnSimple} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const handleDeleteCourse = (course: Course) => {
    if (Platform.OS === "web") {
      if (window.confirm(`Delete "${course.title}"? This will delete all lectures, tests, materials and enrollments. This cannot be undone.`)) {
        deleteCourseMutation.mutate(course.id);
      }
    } else {
      Alert.alert("Delete Course", `Delete "${course.title}"? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteCourseMutation.mutate(course.id) },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View>
            <Text style={styles.headerTitle}>Admin Dashboard</Text>
            <Text style={styles.headerSub}>3i Learning · {user?.name}</Text>
          </View>
          <Pressable style={styles.logoutBtn} onPress={logout}>
            <Ionicons name="log-out-outline" size={20} color="#fff" />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {ADMIN_TABS.map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.adminTab, activeTab === tab.key && styles.adminTabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons name={tab.icon} size={16} color={activeTab === tab.key ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
              <Text style={[styles.adminTabText, activeTab === tab.key && styles.adminTabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      <ScrollView style={styles.content} contentContainerStyle={[styles.contentInner, { paddingBottom: bottomPadding + 80 }]}>
        {activeTab === "courses" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Courses ({courses.length})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddCourse(true)}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add Course</Text>
              </Pressable>
            </View>

            {coursesLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (
              courses.map((course) => (
                <View key={course.id} style={styles.adminCard}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <Text style={styles.adminCardTitle} numberOfLines={2}>{course.title}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ backgroundColor: (course.course_type || "live") === "live" ? "#EF444420" : "#8B5CF620", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: (course.course_type || "live") === "live" ? "#EF4444" : "#8B5CF6", textTransform: "uppercase" }}>
                            {(course.course_type || "live") === "live" ? "🔴 LIVE" : "📹 RECORDED"}
                          </Text>
                        </View>
                        <View style={[styles.statusDot, { backgroundColor: course.is_published ? "#22C55E" : "#F59E0B" }]} />
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      <Text style={styles.adminCardMetaText}>{course.category}</Text>
                      <Text style={styles.adminCardMetaText}>|</Text>
                      <Text style={styles.adminCardMetaText}>{course.total_lectures} lectures</Text>
                      <Text style={styles.adminCardMetaText}>|</Text>
                      <Text style={styles.adminCardMetaText}>{course.is_free ? "FREE" : `₹${parseFloat(course.price).toFixed(0)}`}</Text>
                    </View>
                  </View>
                  <View style={styles.adminCardActions}>
                    {(course.course_type || "live") === "recorded" && (
                      <Pressable style={[styles.editBtn, { backgroundColor: "#8B5CF615" }]} onPress={() => {
                        setImportTargetCourseId(course.id);
                        setImportSourceCourseId(null);
                        setSelectedLectureIds([]);
                        setSelectedTestIds([]);
                        setImportSectionTitle("");
                        const baseUrl = getApiUrl();
                        Promise.all([
                          globalThis.fetch(new URL("/api/admin/all-lectures", baseUrl).toString(), { credentials: "include" }).then(r => r.json()),
                          globalThis.fetch(new URL("/api/admin/all-tests", baseUrl).toString(), { credentials: "include" }).then(r => r.json()),
                        ]).then(([lecs, tests]) => {
                          setAllLectures(lecs);
                          setAllTests(tests);
                          setShowImportModal(true);
                        });
                      }}>
                        <Ionicons name="download-outline" size={18} color="#8B5CF6" />
                      </Pressable>
                    )}
                    <Pressable style={styles.editBtn} onPress={() => router.push({ pathname: "/admin/course/[id]", params: { id: course.id } })}>
                      <Ionicons name="create-outline" size={18} color={Colors.light.primary} />
                    </Pressable>
                    <Pressable style={styles.deleteBtn} onPress={() => handleDeleteCourse(course)}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "users" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>All Users ({users.length})</Text>
            {usersLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (
              users.map((u) => (
                <View key={u.id} style={styles.userCard}>
                  <View style={[styles.userAvatar, { backgroundColor: u.role === "admin" ? Colors.light.accent : Colors.light.secondary }]}>
                    <Ionicons name={u.role === "admin" ? "shield" : "person"} size={18} color={u.role === "admin" ? "#fff" : Colors.light.primary} />
                  </View>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{u.name}</Text>
                    <Text style={styles.userContact}>{u.email || u.phone}</Text>
                  </View>
                  <View style={[styles.roleBadge, { backgroundColor: u.role === "admin" ? `${Colors.light.accent}20` : Colors.light.secondary }]}>
                    <Text style={[styles.roleText, { color: u.role === "admin" ? Colors.light.accent : Colors.light.primary }]}>{u.role}</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "notifications" && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Send Notification</Text>
            <View style={styles.notifCard}>
              <Text style={styles.notifLabel}>Notification Title</Text>
              <TextInput
                style={styles.notifInput}
                placeholder="e.g., New Test Available!"
                placeholderTextColor={Colors.light.textMuted}
                value={notifTitle}
                onChangeText={setNotifTitle}
              />
              <Text style={styles.notifLabel}>Message</Text>
              <TextInput
                style={[styles.notifInput, styles.notifInputMulti]}
                placeholder="Enter your notification message..."
                placeholderTextColor={Colors.light.textMuted}
                value={notifMessage}
                onChangeText={setNotifMessage}
                multiline
                numberOfLines={4}
              />
              <Pressable
                style={[styles.sendNotifBtn, (!notifTitle || !notifMessage) && styles.sendNotifBtnDisabled]}
                onPress={() => {
                  if (!notifTitle || !notifMessage) return;
                  Alert.alert("Send to All Students?", "This will send to all registered students.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Send", onPress: () => sendNotificationMutation.mutate({ title: notifTitle, message: notifMessage }) },
                  ]);
                }}
                disabled={!notifTitle || !notifMessage || sendNotificationMutation.isPending}
              >
                <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.sendNotifBtnGrad}>
                  {sendNotificationMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                    <>
                      <Ionicons name="send" size={18} color="#fff" />
                      <Text style={styles.sendNotifBtnText}>Send to All Students</Text>
                    </>
                  )}
                </LinearGradient>
              </Pressable>

              <View style={styles.notifTemplates}>
                <Text style={styles.notifLabel}>Quick Templates</Text>
                {[
                  { title: "Motivation", message: "You're doing great! Keep practicing daily to achieve your goals." },
                  { title: "New Test Alert", message: "A new practice test has been added. Test your knowledge now!" },
                  { title: "Study Reminder", message: "Don't forget to complete your daily mission today!" },
                ].map((template) => (
                  <Pressable key={template.title} style={styles.templateChip} onPress={() => { setNotifTitle(template.title); setNotifMessage(template.message); }}>
                    <Text style={styles.templateText}>{template.title}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          </View>
        )}

        {activeTab === "tests" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>All Tests ({adminTests.length})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowCreateTest(true)}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Create Test</Text>
              </Pressable>
            </View>
            {testsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : adminTests.length === 0 ? (
              <View style={styles.infoCard}>
                <Ionicons name="document-text-outline" size={20} color={Colors.light.primary} />
                <Text style={styles.infoText}>No tests yet. Create a test and add questions to it.</Text>
              </View>
            ) : (
              adminTests.map((test: any) => (
                <View key={test.id} style={styles.adminCard}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <Text style={styles.adminCardTitle} numberOfLines={2}>{test.title}</Text>
                      <View style={[styles.typeBadge, { backgroundColor: "#1A56DB15" }]}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>
                          {test.test_type}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      <Text style={styles.adminCardMetaText}>{test.total_questions || 0} Q</Text>
                      <Text style={styles.adminCardMetaText}>·</Text>
                      <Text style={styles.adminCardMetaText}>{test.duration_minutes}min</Text>
                      <Text style={styles.adminCardMetaText}>·</Text>
                      <Text style={styles.adminCardMetaText}>{test.total_marks} marks</Text>
                      {test.course_title && (
                        <>
                          <Text style={styles.adminCardMetaText}>·</Text>
                          <Text style={[styles.adminCardMetaText, { color: Colors.light.primary }]}>{test.course_title}</Text>
                        </>
                      )}
                    </View>
                    <View style={styles.testActionRow}>
                      <Pressable style={styles.testActionBtn} onPress={() => { setShowTestQuestions(test.id); setShowAddQ(false); setShowBulkQ(false); setBulkQResult(null); setBulkQText(""); }}>
                        <Ionicons name="create-outline" size={14} color={Colors.light.primary} />
                        <Text style={styles.testActionBtnText}>Add Questions</Text>
                      </Pressable>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#FFF3E0" }]} onPress={() => { setShowTestQuestions(test.id); setShowBulkQ(true); setShowAddQ(false); setBulkQResult(null); setBulkQText(""); }}>
                        <Ionicons name="cloud-upload" size={14} color="#FF6B35" />
                        <Text style={[styles.testActionBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                      </Pressable>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => {
                        if (Platform.OS === "web") {
                          if (window.confirm(`Delete "${test.title}" and all its questions?`)) deleteTestMutation.mutate(test.id);
                        } else {
                          Alert.alert("Delete Test", `Delete "${test.title}"?`, [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) },
                          ]);
                        }
                      }}>
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "missions" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Daily Missions ({adminMissions.length})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddMission(true)}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add Mission</Text>
              </Pressable>
            </View>
            {missionsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : adminMissions.length === 0 ? (
              <View style={styles.infoCard}>
                <Ionicons name="flame-outline" size={20} color={Colors.light.primary} />
                <Text style={styles.infoText}>No missions yet. Create daily drill or free practice missions with questions for students.</Text>
              </View>
            ) : (
              adminMissions.map((m: any) => {
                const qCount = Array.isArray(m.questions) ? m.questions.length : 0;
                return (
                  <View key={m.id} style={styles.adminCard}>
                    <View style={styles.adminCardContent}>
                      <View style={styles.adminCardRow}>
                        <Text style={styles.adminCardTitle} numberOfLines={2}>{m.title}</Text>
                        <View style={[styles.typeBadge, { backgroundColor: m.mission_type === "free_practice" ? "#22C55E20" : "#F59E0B20" }]}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: m.mission_type === "free_practice" ? "#22C55E" : "#F59E0B" }}>
                            {m.mission_type === "free_practice" ? "Free" : "Drill"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.adminCardMeta}>
                        <Text style={styles.adminCardMetaText}>{qCount} questions</Text>
                        <Text style={styles.adminCardMetaText}>|</Text>
                        <Text style={styles.adminCardMetaText}>{m.xp_reward} XP</Text>
                        <Text style={styles.adminCardMetaText}>|</Text>
                        <Text style={styles.adminCardMetaText}>{m.mission_date}</Text>
                      </View>
                    </View>
                    <Pressable style={styles.deleteBtn} onPress={() => {
                      if (Platform.OS === "web") {
                        if (window.confirm(`Delete "${m.title}"?`)) deleteMissionMutation.mutate(m.id);
                      } else {
                        Alert.alert("Delete Mission", `Delete "${m.title}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteMissionMutation.mutate(m.id) },
                        ]);
                      }
                    }}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={showAddMission} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Mission</Text>
              <Pressable onPress={() => setShowAddMission(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Mission Title *</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Algebra Practice" placeholderTextColor={Colors.light.textMuted} value={missionTitle} onChangeText={setMissionTitle} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Mission description..." placeholderTextColor={Colors.light.textMuted} value={missionDesc} onChangeText={setMissionDesc} multiline numberOfLines={2} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Type</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[{ key: "free_practice", label: "Free Practice" }, { key: "daily_drill", label: "Daily Drill" }].map((t) => (
                    <Pressable key={t.key} style={[styles.typeSelectBtn, missionType === t.key && styles.typeSelectActive]} onPress={() => setMissionType(t.key as any)}>
                      <Text style={[styles.typeSelectText, missionType === t.key && styles.typeSelectTextActive]}>{t.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>XP Reward</Text>
                <TextInput style={styles.formInput} placeholder="50" placeholderTextColor={Colors.light.textMuted} value={missionXP} onChangeText={setMissionXP} keyboardType="numeric" />
              </View>
              {missionType === "daily_drill" && (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Linked Course (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                    <View style={{ flexDirection: "row", gap: 6 }}>
                      <Pressable style={[styles.typeSelectBtn, { flex: 0, paddingHorizontal: 12 }, !missionCourseId && styles.typeSelectActive]} onPress={() => setMissionCourseId(null)}>
                        <Text style={[styles.typeSelectText, !missionCourseId && styles.typeSelectTextActive]}>Any Course</Text>
                      </Pressable>
                      {courses.map((c) => (
                        <Pressable key={c.id} style={[styles.typeSelectBtn, { flex: 0, paddingHorizontal: 12 }, missionCourseId === c.id && styles.typeSelectActive]} onPress={() => setMissionCourseId(c.id)}>
                          <Text style={[styles.typeSelectText, missionCourseId === c.id && styles.typeSelectTextActive]} numberOfLines={1}>{c.title}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              )}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Questions ({missionQuestions.length})</Text>
                {missionQuestions.map((q, idx) => (
                  <View key={idx} style={styles.missionQCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Q{idx + 1}</Text>
                      <Pressable onPress={() => setMissionQuestions((prev) => prev.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                    <TextInput style={styles.formInput} placeholder="Question text" placeholderTextColor={Colors.light.textMuted} value={q.question} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], question: v }; setMissionQuestions(nq); }} />
                    {["A", "B", "C", "D"].map((letter, optIdx) => (
                      <View key={letter} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <Pressable onPress={() => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], correct: letter }; setMissionQuestions(nq); }}
                          style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: q.correct === letter ? "#22C55E" : Colors.light.border, backgroundColor: q.correct === letter ? "#22C55E" : "transparent", alignItems: "center", justifyContent: "center" }}>
                          {q.correct === letter && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </Pressable>
                        <TextInput style={[styles.formInput, { flex: 1, paddingVertical: 6 }]} placeholder={`Option ${letter}`} placeholderTextColor={Colors.light.textMuted} value={q.options[optIdx]}
                          onChangeText={(v) => { const nq = [...missionQuestions]; const opts = [...nq[idx].options]; opts[optIdx] = v; nq[idx] = { ...nq[idx], options: opts }; setMissionQuestions(nq); }} />
                      </View>
                    ))}
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Topic (e.g., Algebra)" placeholderTextColor={Colors.light.textMuted} value={q.topic} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], topic: v }; setMissionQuestions(nq); }} />
                  </View>
                ))}
                <Pressable style={styles.addQBtn} onPress={() => setMissionQuestions((prev) => [...prev, { question: "", options: ["", "", "", ""], correct: "A", topic: "" }])}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.light.primary} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Add Question</Text>
                </Pressable>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!missionTitle || missionQuestions.length === 0) && styles.createBtnDisabled]}
              disabled={!missionTitle || missionQuestions.length === 0 || addMissionMutation.isPending}
              onPress={() => {
                const questions = missionQuestions.map((q, i) => ({ id: i + 1, ...q }));
                addMissionMutation.mutate({ title: missionTitle, description: missionDesc, questions, xpReward: parseInt(missionXP) || 50, missionType, missionDate: new Date().toISOString().split("T")[0], courseId: missionCourseId });
              }}>
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addMissionMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Mission</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddCourse} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add New Course</Text>
              <Pressable onPress={() => setShowAddCourse(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              {[
                { label: "Course Title *", key: "title", placeholder: "e.g., Class 10 Mathematics" },
                { label: "Description", key: "description", placeholder: "Course description..." },
                { label: "Teacher Name", key: "teacherName", placeholder: "3i Learning" },
                { label: "Category", key: "category", placeholder: "e.g., NDA, CDS, AFCAT" },
                { label: "Subject", key: "subject", placeholder: "e.g., Mathematics, English, GK" },
                { label: "Level", key: "level", placeholder: "Beginner / Intermediate / Advanced" },
                { label: "Price (₹)", key: "price", placeholder: "0 for free" },
                { label: "Original Price (₹)", key: "originalPrice", placeholder: "For discount display" },
                { label: "Duration (hours)", key: "durationHours", placeholder: "e.g., 40" },
              ].map((field) => (
                <View key={field.key} style={styles.formField}>
                  <Text style={styles.formLabel}>{field.label}</Text>
                  <TextInput
                    style={[styles.formInput, field.key === "description" && styles.formInputMulti]}
                    placeholder={field.placeholder}
                    placeholderTextColor={Colors.light.textMuted}
                    value={String(newCourse[field.key as keyof NewCourse])}
                    onChangeText={(val) => setNewCourse((prev) => ({ ...prev, [field.key]: val }))}
                    multiline={field.key === "description"}
                    numberOfLines={field.key === "description" ? 3 : 1}
                    keyboardType={["price", "originalPrice", "durationHours"].includes(field.key) ? "numeric" : "default"}
                  />
                </View>
              ))}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Course Type</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["live", "recorded"] as const).map((t) => (
                    <Pressable key={t} onPress={() => setNewCourse((prev) => ({ ...prev, courseType: t }))}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, borderColor: newCourse.courseType === t ? (t === "live" ? "#EF4444" : "#8B5CF6") : Colors.light.border, backgroundColor: newCourse.courseType === t ? (t === "live" ? "#EF444410" : "#8B5CF610") : "transparent", alignItems: "center" }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: newCourse.courseType === t ? (t === "live" ? "#EF4444" : "#8B5CF6") : Colors.light.textMuted }}>
                        {t === "live" ? "🔴 Live" : "📹 Recorded"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Free Course</Text>
                <Switch
                  value={newCourse.isFree}
                  onValueChange={(val) => setNewCourse((prev) => ({ ...prev, isFree: val }))}
                  trackColor={{ false: Colors.light.border, true: Colors.light.primary }}
                  thumbColor="#fff"
                />
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !newCourse.title && styles.createBtnDisabled]}
              onPress={() => newCourse.title && addCourseMutation.mutate(newCourse)}
              disabled={!newCourse.title || addCourseMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addCourseMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.createBtnText}>Create Course</Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showImportModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Import Lectures & Tests</Text>
              <Pressable onPress={() => setShowImportModal(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Section Title (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Week 1 - Algebra" placeholderTextColor={Colors.light.textMuted} value={importSectionTitle} onChangeText={setImportSectionTitle} />
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>Filter by Source Course</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <Pressable onPress={() => setImportSourceCourseId(null)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: importSourceCourseId === null ? Colors.light.primary : Colors.light.secondary, marginRight: 8 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: importSourceCourseId === null ? "#fff" : Colors.light.text }}>All</Text>
                  </Pressable>
                  {courses.filter(c => c.id !== importTargetCourseId).map(c => (
                    <Pressable key={c.id} onPress={() => setImportSourceCourseId(c.id)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: importSourceCourseId === c.id ? Colors.light.primary : Colors.light.secondary, marginRight: 8 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: importSourceCourseId === c.id ? "#fff" : Colors.light.text }} numberOfLines={1}>{c.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {(() => {
                const filteredLectures = allLectures.filter(l => l.course_id !== importTargetCourseId && (importSourceCourseId === null || l.course_id === importSourceCourseId));
                const filteredTests = allTests.filter(t => t.course_id !== importTargetCourseId && (importSourceCourseId === null || t.course_id === importSourceCourseId));
                const groupedLectures: Record<string, any[]> = {};
                filteredLectures.forEach(l => {
                  const key = l.course_title || "Unknown";
                  if (!groupedLectures[key]) groupedLectures[key] = [];
                  groupedLectures[key].push(l);
                });
                const groupedTests: Record<string, any[]> = {};
                filteredTests.forEach(t => {
                  const key = t.course_title || "Unknown";
                  if (!groupedTests[key]) groupedTests[key] = [];
                  groupedTests[key].push(t);
                });
                return (
                  <>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 8 }}>Lectures ({selectedLectureIds.length} selected)</Text>
                    {Object.entries(groupedLectures).map(([courseName, lecs]) => (
                      <View key={courseName} style={{ marginBottom: 12 }}>
                        <Pressable onPress={() => {
                          const lecIds = lecs.map(l => l.id);
                          const allSelected = lecIds.every(id => selectedLectureIds.includes(id));
                          if (allSelected) setSelectedLectureIds(prev => prev.filter(id => !lecIds.includes(id)));
                          else setSelectedLectureIds(prev => [...new Set([...prev, ...lecIds])]);
                        }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary, marginBottom: 4 }}>{courseName} ({lecs.length})</Text>
                        </Pressable>
                        {lecs.map(l => (
                          <Pressable key={l.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingHorizontal: 4 }}
                            onPress={() => setSelectedLectureIds(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}>
                            <Ionicons name={selectedLectureIds.includes(l.id) ? "checkbox" : "square-outline"} size={20} color={selectedLectureIds.includes(l.id) ? Colors.light.primary : Colors.light.textMuted} />
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{l.title}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ))}

                    <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 12, marginBottom: 8 }}>Tests ({selectedTestIds.length} selected)</Text>
                    {Object.entries(groupedTests).map(([courseName, tests]) => (
                      <View key={courseName} style={{ marginBottom: 12 }}>
                        <Pressable onPress={() => {
                          const tIds = tests.map(t => t.id);
                          const allSelected = tIds.every(id => selectedTestIds.includes(id));
                          if (allSelected) setSelectedTestIds(prev => prev.filter(id => !tIds.includes(id)));
                          else setSelectedTestIds(prev => [...new Set([...prev, ...tIds])]);
                        }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary, marginBottom: 4 }}>{courseName} ({tests.length})</Text>
                        </Pressable>
                        {tests.map(t => (
                          <Pressable key={t.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingHorizontal: 4 }}
                            onPress={() => setSelectedTestIds(prev => prev.includes(t.id) ? prev.filter(x => x !== t.id) : [...prev, t.id])}>
                            <Ionicons name={selectedTestIds.includes(t.id) ? "checkbox" : "square-outline"} size={20} color={selectedTestIds.includes(t.id) ? Colors.light.primary : Colors.light.textMuted} />
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{t.title}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ))}

                    {filteredLectures.length === 0 && filteredTests.length === 0 && (
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center", marginTop: 20 }}>No lectures or tests found in other courses</Text>
                    )}
                  </>
                );
              })()}
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (selectedLectureIds.length === 0 && selectedTestIds.length === 0) && styles.createBtnDisabled]}
              disabled={importLoading || (selectedLectureIds.length === 0 && selectedTestIds.length === 0)}
              onPress={async () => {
                setImportLoading(true);
                try {
                  if (selectedLectureIds.length > 0) {
                    await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-lectures`, { lectureIds: selectedLectureIds, sectionTitle: importSectionTitle || undefined });
                  }
                  if (selectedTestIds.length > 0) {
                    await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-tests`, { testIds: selectedTestIds });
                  }
                  qc.invalidateQueries({ queryKey: ["/api/courses"] });
                  setShowImportModal(false);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert("Success", `Imported ${selectedLectureIds.length} lectures and ${selectedTestIds.length} tests!`);
                } catch (e) {
                  Alert.alert("Error", "Failed to import");
                } finally {
                  setImportLoading(false);
                }
              }}>
              <LinearGradient colors={["#8B5CF6", "#7C3AED"]} style={styles.createBtnGrad}>
                {importLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Import {selectedLectureIds.length + selectedTestIds.length} Items</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showCreateTest} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Test</Text>
              <Pressable onPress={() => setShowCreateTest(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Test Title *</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Chapter 1 Test" placeholderTextColor={Colors.light.textMuted} value={testTitle} onChangeText={setTestTitle} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Test description" placeholderTextColor={Colors.light.textMuted} value={testDesc} onChangeText={setTestDesc} multiline numberOfLines={2} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Type</Text>
                <View style={styles.typeOptions}>
                  {["practice", "mock", "chapter", "weekly", "pyq_practice", "pyq_papers"].map((t) => (
                    <Pressable key={t} style={[styles.typeOption, testType === t && styles.typeOptionActive]} onPress={() => setTestType(t)}>
                      <Text style={[styles.typeOptionText, testType === t && styles.typeOptionTextActive]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Link to Course (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                  <Pressable style={[styles.typeOption, testCourseId === null && styles.typeOptionActive]} onPress={() => setTestCourseId(null)}>
                    <Text style={[styles.typeOptionText, testCourseId === null && styles.typeOptionTextActive]}>Standalone</Text>
                  </Pressable>
                  {courses.map((c) => (
                    <Pressable key={c.id} style={[styles.typeOption, testCourseId === c.id && styles.typeOptionActive, { marginLeft: 6 }]} onPress={() => setTestCourseId(c.id)}>
                      <Text style={[styles.typeOptionText, testCourseId === c.id && styles.typeOptionTextActive]} numberOfLines={1}>{c.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Duration (minutes)</Text>
                <TextInput style={styles.formInput} placeholder="60" placeholderTextColor={Colors.light.textMuted} value={testDuration} onChangeText={setTestDuration} keyboardType="numeric" />
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Total Marks</Text>
                  <TextInput style={styles.formInput} placeholder="100" placeholderTextColor={Colors.light.textMuted} value={testTotalMarks} onChangeText={setTestTotalMarks} keyboardType="numeric" />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Passing Marks</Text>
                  <TextInput style={styles.formInput} placeholder="35" placeholderTextColor={Colors.light.textMuted} value={testPassingMarks} onChangeText={setTestPassingMarks} keyboardType="numeric" />
                </View>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !testTitle && styles.createBtnDisabled]}
              onPress={() => testTitle && createTestMutation.mutate({
                title: testTitle, description: testDesc, testType, courseId: testCourseId,
                durationMinutes: parseInt(testDuration) || 60, totalMarks: parseInt(testTotalMarks) || 100, passingMarks: parseInt(testPassingMarks) || 35,
              })}
              disabled={!testTitle || createTestMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {createTestMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.createBtnText}>Create Test</Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showTestQuestions !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {showBulkQ ? "Bulk Upload Questions" : "Add Question"}
              </Text>
              <Pressable onPress={() => { setShowTestQuestions(null); setShowAddQ(false); setShowBulkQ(false); setBulkQResult(null); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            {!showBulkQ && !showAddQ && (
              <View style={{ gap: 12, paddingVertical: 12 }}>
                <Pressable style={styles.testActionBtnLarge} onPress={() => setShowAddQ(true)}>
                  <Ionicons name="create-outline" size={22} color={Colors.light.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add Manually</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Add one question at a time</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                </Pressable>
                <Pressable style={styles.testActionBtnLarge} onPress={() => setShowBulkQ(true)}>
                  <Ionicons name="cloud-upload" size={22} color="#FF6B35" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Bulk Text Upload</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Paste multiple questions in text format</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            )}
            {showAddQ && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Question *</Text>
                  <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Enter question text" placeholderTextColor={Colors.light.textMuted} value={newQ.questionText} onChangeText={(v) => setNewQ(p => ({ ...p, questionText: v }))} multiline numberOfLines={3} />
                </View>
                {[
                  { key: "optionA", label: "Option A *" },
                  { key: "optionB", label: "Option B *" },
                  { key: "optionC", label: "Option C" },
                  { key: "optionD", label: "Option D" },
                ].map((o) => (
                  <View key={o.key} style={styles.formField}>
                    <Text style={styles.formLabel}>{o.label}</Text>
                    <TextInput style={styles.formInput} placeholder={o.label} placeholderTextColor={Colors.light.textMuted} value={(newQ as any)[o.key]} onChangeText={(v) => setNewQ(p => ({ ...p, [o.key]: v }))} />
                  </View>
                ))}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Correct Option</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {["A", "B", "C", "D"].map((opt) => (
                      <Pressable key={opt} style={[styles.typeOption, newQ.correctOption === opt && styles.typeOptionActive]} onPress={() => setNewQ(p => ({ ...p, correctOption: opt }))}>
                        <Text style={[styles.typeOptionText, newQ.correctOption === opt && styles.typeOptionTextActive]}>{opt}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Explanation</Text>
                  <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Why this answer?" placeholderTextColor={Colors.light.textMuted} value={newQ.explanation} onChangeText={(v) => setNewQ(p => ({ ...p, explanation: v }))} multiline numberOfLines={2} />
                </View>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <View style={[styles.formField, { flex: 1 }]}>
                    <Text style={styles.formLabel}>Marks</Text>
                    <TextInput style={styles.formInput} placeholder="4" placeholderTextColor={Colors.light.textMuted} value={newQ.marks} onChangeText={(v) => setNewQ(p => ({ ...p, marks: v }))} keyboardType="numeric" />
                  </View>
                  <View style={[styles.formField, { flex: 1 }]}>
                    <Text style={styles.formLabel}>Negative</Text>
                    <TextInput style={styles.formInput} placeholder="1" placeholderTextColor={Colors.light.textMuted} value={newQ.negativeMarks} onChangeText={(v) => setNewQ(p => ({ ...p, negativeMarks: v }))} keyboardType="numeric" />
                  </View>
                </View>
                <Pressable
                  style={[styles.createBtn, !newQ.questionText && styles.createBtnDisabled]}
                  onPress={() => newQ.questionText && addQuestionMutation.mutate({
                    testId: showTestQuestions,
                    questionText: newQ.questionText, optionA: newQ.optionA, optionB: newQ.optionB,
                    optionC: newQ.optionC, optionD: newQ.optionD, correctOption: newQ.correctOption,
                    explanation: newQ.explanation, marks: parseInt(newQ.marks) || 4, negativeMarks: parseInt(newQ.negativeMarks) || 1,
                  })}
                  disabled={!newQ.questionText || addQuestionMutation.isPending}
                >
                  <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                    {addQuestionMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.createBtnText}>Add Question</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            )}
            {showBulkQ && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.infoCard}>
                  <Ionicons name="information-circle" size={18} color={Colors.light.primary} />
                  <Text style={[styles.infoText, { fontSize: 11 }]}>
                    Format: Q1. question{"\n"}A. option{"\n"}B. option{"\n"}C. option{"\n"}D. option{"\n"}Answer: A
                  </Text>
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Paste Questions</Text>
                  <TextInput
                    style={[styles.formInput, { minHeight: 150, textAlignVertical: "top" }]}
                    placeholder={"Q1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6\nAnswer: B\n\nQ2. ..."}
                    placeholderTextColor={Colors.light.textMuted}
                    value={bulkQText}
                    onChangeText={setBulkQText}
                    multiline
                    numberOfLines={8}
                  />
                </View>
                {bulkQResult && (
                  <View style={[styles.infoCard, { backgroundColor: "#DCFCE7" }]}>
                    <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                    <Text style={[styles.infoText, { color: "#166534" }]}>
                      Successfully uploaded {bulkQResult.count} questions!
                    </Text>
                  </View>
                )}
                <Pressable
                  style={[styles.createBtn, !bulkQText.trim() && styles.createBtnDisabled]}
                  onPress={() => bulkQText.trim() && bulkUploadMutation.mutate({ testId: showTestQuestions!, text: bulkQText })}
                  disabled={!bulkQText.trim() || bulkUploadMutation.isPending}
                >
                  <LinearGradient colors={["#FF6B35", "#E55A25"]} style={styles.createBtnGrad}>
                    {bulkUploadMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.createBtnText}>Upload Questions</Text>
                    )}
                  </LinearGradient>
                </Pressable>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  errorText: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  backBtnSimple: { backgroundColor: Colors.light.secondary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  backBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  logoutBtn: { marginLeft: "auto", width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(239,68,68,0.2)", alignItems: "center", justifyContent: "center" },
  tabsRow: { gap: 8, paddingVertical: 4 },
  adminTab: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  adminTabActive: { backgroundColor: "#fff" },
  adminTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  adminTabTextActive: { color: Colors.light.primary },
  content: { flex: 1 },
  contentInner: { padding: 16, gap: 12 },
  section: { gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  addBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" },
  adminCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  adminCardContent: { flex: 1, gap: 4 },
  adminCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  adminCardTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  adminCardMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  adminCardMetaText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  adminCardActions: { flexDirection: "row", gap: 8 },
  editBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  userCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  userAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  userContact: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  roleBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  notifCard: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12 },
  notifLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  notifInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
  notifInputMulti: { height: 100, textAlignVertical: "top" },
  sendNotifBtn: { borderRadius: 12, overflow: "hidden" },
  sendNotifBtnDisabled: { opacity: 0.5 },
  sendNotifBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 13, gap: 8 },
  sendNotifBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  notifTemplates: { gap: 8 },
  templateChip: { backgroundColor: Colors.light.secondary, borderRadius: 10, padding: 10 },
  templateText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  infoCard: { backgroundColor: Colors.light.secondary, borderRadius: 12, padding: 14, flexDirection: "row", gap: 10, alignItems: "flex-start" },
  infoText: { flex: 1, fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 19 },
  courseTestCard: { backgroundColor: "#fff", borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  courseTestInfo: { flex: 1 },
  courseTestTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  courseTestMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", padding: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  modalScroll: { maxHeight: 400 },
  formField: { marginBottom: 12 },
  formLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 },
  formInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
  formInputMulti: { height: 80, textAlignVertical: "top" },
  createBtn: { marginTop: 12, borderRadius: 12, overflow: "hidden" },
  createBtnDisabled: { opacity: 0.5 },
  createBtnGrad: { paddingVertical: 14, alignItems: "center" },
  createBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  typeBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  typeSelectBtn: { flex: 1, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Colors.light.border, alignItems: "center" },
  typeSelectActive: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  typeSelectText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  typeSelectTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  missionQCard: { backgroundColor: Colors.light.background, borderRadius: 12, padding: 12, gap: 6, marginTop: 8, borderWidth: 1, borderColor: Colors.light.border },
  addQBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.primary, borderStyle: "dashed" },
  typeOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeOption: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.light.background, borderWidth: 1, borderColor: Colors.light.border },
  typeOptionActive: { backgroundColor: Colors.light.secondary, borderColor: Colors.light.primary },
  typeOptionText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted },
  typeOptionTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  testActionRow: { flexDirection: "row", gap: 6, marginTop: 8 },
  testActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  testActionBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  testActionBtnLarge: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.light.background, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.light.border },
});
