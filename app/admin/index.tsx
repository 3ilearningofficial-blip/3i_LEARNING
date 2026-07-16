import React, { useState, useEffect, useRef, Suspense, lazy } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, TextInput, Modal, Switch, Image, KeyboardAvoidingView, useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import { liveClassesQueryKey } from "@/lib/query-keys";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/AppThemeContext";
import { fetch } from "expo/fetch";
import { MULTI_SUBJECTS, SubjectIcon } from "@/constants/multiSubjects";
import BulkUploadModal from "@/components/BulkUploadModal";
import { parseMissionQuestionsPdf } from "@/lib/mission-bulk-parse";
import { downloadAdminContent } from "@/lib/admin-export";
import { ensurePushRegisteredWithGesture } from "@/lib/pushNotifications";
import { AdminExportDownloadButton } from "@/components/admin/AdminExportDownloadButton";
import SortableList from "@/components/admin/SortableList";
import SortableItem from "@/components/admin/SortableItem";
import { buildRecordingLectureSectionTitle, prefillLiveRecordingFormFields } from "@shared/recordingSection";
import type { DeviceDeniedUserRow, UserRecord } from "./user-types";
// AdminImageBoxInline is used throughout many sections — keep it eagerly loaded.
import { AdminImageBoxInline } from "./components/AdminImageBoxInline";
import AdminBannerPreview from "@/components/admin/AdminBannerPreview";
import AdminNotificationPreview from "@/components/admin/AdminNotificationPreview";
import NotificationImage from "@/components/NotificationImage";
import { resolveNotificationImageUrl } from "@/lib/notificationImageUrl";
import { adminGoBack, adminBackToApp } from "@/lib/admin/adminNavigation";
// Heavy tab components are lazy-loaded: they are never rendered until the user
// switches to that tab, so deferring their JS parse keeps the initial /admin
// bundle smaller and speeds up first-paint for the default (welcome) tab.
const AnalyticsTab = lazy(() =>
  import("./tabs/AnalyticsTab").then((m) => ({ default: m.AnalyticsTab }))
);
const StaffAccessTab = lazy(() =>
  import("./tabs/StaffAccessTab").then((m) => ({ default: m.StaffAccessTab }))
);
const WelcomeSettingsTab = lazy(() =>
  import("./tabs/WelcomeSettingsTab").then((m) => ({ default: m.WelcomeSettingsTab }))
);

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
  batch_status?: string;
  start_date?: string;
  end_date?: string;
  validity_months?: number | null;
}

type AdminTab = "courses" | "tests" | "materials" | "users" | "notifications" | "aiTutor" | "missions" | "books" | "support" | "analytics" | "welcome" | "staffAccess";

const ADMIN_TABS: { key: AdminTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "welcome", label: "Welcome", icon: "home" },
  { key: "courses", label: "Courses", icon: "book" },
  { key: "tests", label: "Tests", icon: "document-text" },
  { key: "materials", label: "Materials", icon: "folder-open" },
  { key: "missions", label: "Missions", icon: "flame" },
  { key: "notifications", label: "Notify", icon: "notifications" },
  { key: "aiTutor", label: "AI Tutor", icon: "chatbox-ellipses" },
  { key: "books", label: "Books", icon: "storefront" },
  { key: "support", label: "Support", icon: "chatbubbles" },
  { key: "analytics", label: "Analytics", icon: "bar-chart" },
  { key: "users", label: "Users", icon: "people" },
  { key: "staffAccess", label: "Staff & Access", icon: "people-circle" },
];

interface NewCourse {
  title: string; description: string; teacherName: string; price: string;
  originalPrice: string; category: string; subject: string; exam: string; isFree: boolean; level: string; durationHours: string;
  courseType: string; startDate: string; endDate: string; validityMonths: string;
  thumbnail: string; coverColor: string; teacherBio: string; teacherImageUrl: string;
  courseLanguage: string; batchStatus: string;
}

const defaultNewCourse = (courseType = "live"): NewCourse => ({
  title: "", description: "", teacherName: "3i Learning",
  price: "0", originalPrice: "0", category: courseType === "test_series" ? "Test Series" : "Mathematics",
  subject: "", exam: "", isFree: false, level: "Beginner", durationHours: "0",
  courseType, startDate: "", endDate: "", validityMonths: "", thumbnail: "", coverColor: "",
  teacherBio: "", teacherImageUrl: "", courseLanguage: "HINGLISH", batchStatus: "live",
});

function AdminR2ImagePicker({
  label,
  value,
  onChange,
  folder = "images",
  hint,
  variant = "image",
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  folder?: "images" | "books" | "lectures" | "materials";
  hint?: string;
  variant?: "banner" | "image" | "notification";
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resolveUrl = variant === "notification" ? resolveNotificationImageUrl : (url: string) => url;

  const cancelUpload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setUploadPct(0);
  };

  const runUpload = async (fileUri: string, fileName: string, mimeType: string, contentLength?: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setUploadPct(0);
    try {
      const { publicUrl } = await uploadToR2(fileUri, fileName, mimeType, folder, {
        onProgress: (pct) => setUploadPct(pct),
        signal: controller.signal,
        contentLength,
      });
      onChange(resolveUrl(publicUrl));
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        Alert.alert("Upload Failed", err?.message || "Could not upload image.");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUploading(false);
      setUploadPct(0);
    }
  };

  const handleUrlChange = (text: string) => {
    onChange(text ? resolveUrl(text) : "");
  };

  const pickImage = async () => {
    try {
      if (Platform.OS === "web") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async (event: any) => {
          const file = event.target?.files?.[0];
          if (!file) return;
          const blobUrl = URL.createObjectURL(file);
          try {
            await runUpload(blobUrl, file.name, file.type || "image/jpeg", file.size);
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        };
        input.click();
        return;
      }

      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to pick an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.82,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        await runUpload(asset.uri, asset.fileName || `course-${Date.now()}.jpg`, asset.mimeType || "image/jpeg", asset.fileSize);
      }
    } catch (err: any) {
      Alert.alert("Upload Failed", err?.message || "Could not upload image.");
    }
  };

  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      {value ? (
        variant === "banner" ? (
          <AdminBannerPreview uri={value} onClear={() => onChange("")} showHint={false} />
        ) : variant === "notification" ? (
          <AdminNotificationPreview uri={value} onClear={() => onChange("")} showHint={false} />
        ) : (
          <View style={{ borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border, marginBottom: 8, position: "relative" }}>
            <Image source={{ uri: value }} style={{ width: "100%", height: 130, backgroundColor: "#F8FAFC" }} resizeMode="contain" />
            <Pressable
              style={{ position: "absolute", top: 6, right: 6, backgroundColor: "#EF4444", borderRadius: 14, width: 26, height: 26, alignItems: "center", justifyContent: "center" }}
              onPress={() => onChange("")}
            >
              <Ionicons name="close" size={14} color="#fff" />
            </Pressable>
          </View>
        )
      ) : null}
      {uploading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" }}>
          <ActivityIndicator size="small" color={Colors.light.primary} />
          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Uploading {uploadPct}%</Text>
          <Pressable onPress={cancelUpload} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color="#EF4444" />
          </Pressable>
        </View>
      ) : null}
      <TextInput
        style={styles.formInput}
        placeholder={variant === "notification" ? "Paste image or Google Drive URL" : "Paste image URL or upload from device"}
        placeholderTextColor={Colors.light.textMuted}
        value={value}
        onChangeText={handleUrlChange}
        autoCapitalize="none"
      />
      <Pressable
        onPress={pickImage}
        disabled={uploading}
        style={{ marginTop: 8, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#EEF2FF", opacity: uploading ? 0.6 : 1 }}
      >
        {uploading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : <Ionicons name="cloud-upload-outline" size={17} color={Colors.light.primary} />}
        <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploading ? "Uploading..." : "Upload to R2"}</Text>
      </Pressable>
      {hint ? <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 6 }}>{hint}</Text> : null}
    </View>
  );
}

interface FreeMaterial {
  id: number;
  title: string;
  file_url: string;
  file_type: string;
  section_title?: string;
  download_allowed: boolean;
  created_at: number;
}

interface AdminDoubtRow {
  id: number;
  question: string;
  answer: string;
  topic: string;
  status: string;
  created_at: number;
  user_name?: string;
  user_phone?: string;
  user_email?: string;
}

interface AdminDoubtPattern {
  questionPattern: string;
  sampleQuestion: string;
  count: number;
  latestAt: number;
}

interface AdminStudentInsight {
  user_id: number;
  name: string;
  phone: string;
  email: string;
  doubtCount: number;
  lastAskedAt: number;
  topTopic: string;
}


export default function AdminDashboard() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('[aria-hidden="true"]')) activeElement.blur();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
    return () => observer.disconnect();
  }, []);

  const { tab: adminTabParam } = useLocalSearchParams<{ tab?: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isAdmin, isLoading: authLoading, refreshUser, logout } = useAuth();
  const { colors, isDarkMode } = useAppTheme();
  const [authRetryDone, setAuthRetryDone] = useState(false);

  useEffect(() => {
    if (authLoading || isAdmin || authRetryDone) return;
    let cancelled = false;
    (async () => {
      try {
        const { getStoredAuthUser } = await import("@/lib/auth-storage");
        const stored = await getStoredAuthUser();
        if (stored?.role === "admin") {
          await refreshUser();
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) setAuthRetryDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, isAdmin, authRetryDone, refreshUser]);
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    const t = String(adminTabParam || "").toLowerCase();
    const valid: AdminTab[] = ["welcome", "courses", "tests", "materials", "missions", "notifications", "aiTutor", "books", "support", "analytics", "users", "staffAccess"];
    return valid.includes(t as AdminTab) ? (t as AdminTab) : "welcome";
  });

  useEffect(() => {
    const t = String(adminTabParam || "").toLowerCase();
    const valid: AdminTab[] = ["welcome", "courses", "tests", "materials", "missions", "notifications", "aiTutor", "books", "support", "analytics", "users", "staffAccess"];
    if (valid.includes(t as AdminTab)) setActiveTab(t as AdminTab);
  }, [adminTabParam]);

  const openAdminAlerts = () => {
    ensurePushRegisteredWithGesture().catch(() => {});
    router.push("/notifications" as any);
  };
  const [aiDoubtDays, setAiDoubtDays] = useState<"all" | "7" | "30">("all");
  const [aiDoubtTopic, setAiDoubtTopic] = useState<string>("all");
  const [aiDoubtStudent, setAiDoubtStudent] = useState("");
  const [aiStudentsOffset, setAiStudentsOffset] = useState(0);
  const [aiFrequentOffset, setAiFrequentOffset] = useState(0);
  const [aiSelectedStudent, setAiSelectedStudent] = useState<any | null>(null);
  const [aiSelectedPattern, setAiSelectedPattern] = useState<any | null>(null);
  const [aiStudentHistoryOffset, setAiStudentHistoryOffset] = useState(0);
  const [aiPatternStudentsOffset, setAiPatternStudentsOffset] = useState(0);

  useEffect(() => {
    setAiStudentsOffset(0);
    setAiFrequentOffset(0);
    setAiStudentHistoryOffset(0);
    setAiPatternStudentsOffset(0);
  }, [aiDoubtDays, aiDoubtTopic, aiDoubtStudent]);
  const [showAddCourse, setShowAddCourse] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifTarget, setNotifTarget] = useState<"all" | "enrolled" | "course">("all");
  const [notifCourseId, setNotifCourseId] = useState<number | null>(null);
  const [notifImageUrl, setNotifImageUrl] = useState("");
  // Past notifications
  const [editNotifModal, setEditNotifModal] = useState<any | null>(null);
  const [editNotifTitle, setEditNotifTitle] = useState("");
  const [editNotifMessage, setEditNotifMessage] = useState("");
  const [editNotifImageUrl, setEditNotifImageUrl] = useState("");
  const openEditNotifModal = (n: any) => {
    setEditNotifTitle(n.title || "");
    setEditNotifMessage(n.message || "");
    setEditNotifImageUrl(n.image_url || "");
    setEditNotifModal(n);
  };
  const notifHasContent = !!(notifTitle.trim() || notifMessage.trim() || notifImageUrl.trim());
  const editNotifHasContent = !!(editNotifTitle.trim() || editNotifMessage.trim() || editNotifImageUrl.trim());
  const [showAllPastNotifs, setShowAllPastNotifs] = useState(false);
  // User action sheet
  const [userActionUser, setUserActionUser] = useState<UserRecord | null>(null);
  const deletingUserIdsRef = useRef<Set<number>>(new Set());
  // Clean up unfinished signups (legacy "Student7890" placeholder rows)
  const [cleanupPending, setCleanupPending] = useState(false);
  const [showCourseAccess, setShowCourseAccess] = useState(false);
  const [courseAccessUserId, setCourseAccessUserId] = useState<number | null>(null);
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userSearchDebounced, setUserSearchDebounced] = useState("");
  const [grantingCourseId, setGrantingCourseId] = useState<number | null>(null);
  const [enrollingCourseId, setEnrollingCourseId] = useState<number | null>(null);
  const [showAddMission, setShowAddMission] = useState(false);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionDesc, setMissionDesc] = useState("");
  const [missionFolder, setMissionFolder] = useState("");
  const [missionType, setMissionType] = useState<"daily_drill" | "free_practice">("free_practice");
  const [missionXP, setMissionXP] = useState("50");
  const [missionQuestions, setMissionQuestions] = useState<{ question: string; options: string[]; correct: string; topic: string; subtopic: string; marks: string; solution: string; image_url: string; solution_image_url: string }[]>([]);
  const [missionCourseId, setMissionCourseId] = useState<number | null>(null);
  const [missionSubjectKey, setMissionSubjectKey] = useState("");
  const [showMissionBulkUpload, setShowMissionBulkUpload] = useState(false);
  const [missionBulkText, setMissionBulkText] = useState("");
  const [missionBulkMode, setMissionBulkMode] = useState<"text" | "pdf">("text");
  const [missionPdfLoading, setMissionPdfLoading] = useState(false);
  const [missionBulkError, setMissionBulkError] = useState<string | null>(null);
  // Mission leaderboard
  const [selectedMission, setSelectedMission] = useState<any | null>(null);
  const [missionAttempts, setMissionAttempts] = useState<any[]>([]);
  const [missionAttemptsLoading, setMissionAttemptsLoading] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<any | null>(null);
  const [selectedAdminTest, setSelectedAdminTest] = useState<any | null>(null);
  const [adminTestQuestions, setAdminTestQuestions] = useState<any[]>([]);
  const [adminTestAttempts, setAdminTestAttempts] = useState<any[]>([]);
  const [adminTestAttemptsLoading, setAdminTestAttemptsLoading] = useState(false);
  const [selectedTestAttempt, setSelectedTestAttempt] = useState<any | null>(null);
  // Edit mission
  const [editMission, setEditMission] = useState<any | null>(null);
  // Edit test (admin tests tab)
  const [editAdminTest, setEditAdminTest] = useState<any | null>(null);
  // Edit free material (admin materials tab)
  const [editFreeMaterial, setEditFreeMaterial] = useState<any | null>(null);
  // Edit individual question
  const [editQuestion, setEditQuestion] = useState<any | null>(null);
  const [testQuestionsList, setTestQuestionsList] = useState<any[]>([]);
  const [testQuestionsLoading, setTestQuestionsLoading] = useState(false);
  const [showViewQuestions, setShowViewQuestions] = useState(false);
  // Folder management for tests/materials/missions tabs
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [openFolderView, setOpenFolderView] = useState<{ folder: any; type: "test" | "material" | "mission" } | null>(null);
  const [showCreateFolderModal, setShowCreateFolderModal] = useState<"test" | "material" | "mission" | null>(null);
  const [newFolderNameInput, setNewFolderNameInput] = useState("");
  const [newStandaloneFolderParentId, setNewStandaloneFolderParentId] = useState<number | null>(null);
  const [newFolderValidityMonths, setNewFolderValidityMonths] = useState("");
  // Folder action sheet (same as course admin)
  const [standalonefolderActionSheet, setStandaloneFolderActionSheet] = useState<any>(null);
  const [editStandaloneFolderModal, setEditStandaloneFolderModal] = useState(false);
  const [editStandaloneFolderName, setEditStandaloneFolderName] = useState("");
  const [editStandaloneFolderValidityMonths, setEditStandaloneFolderValidityMonths] = useState("");
  const [editingStandaloneFolderId, setEditingStandaloneFolderId] = useState<number | null>(null);

  const [showCourseTypeChoice, setShowCourseTypeChoice] = useState(false);
  const [showCreateClassChoice, setShowCreateClassChoice] = useState(false);
  // Add Lesson Class form state
  const [showAddLessonClass, setShowAddLessonClass] = useState(false);
  // Schedule Live Class form state
  const [showScheduleLiveClass, setShowScheduleLiveClass] = useState(false);
  const [liveTitle, setLiveTitle] = useState("");
  const [liveSelectedCourses, setLiveSelectedCourses] = useState<number[]>([]);
  const [liveChatMode, setLiveChatMode] = useState<'public' | 'private'>('public');
  const [liveShowViewerCount, setLiveShowViewerCount] = useState(true);
  const [liveScheduleDate, setLiveScheduleDate] = useState("");
  const [liveScheduleTime, setLiveScheduleTime] = useState("");
  const [liveNotifyEmail, setLiveNotifyEmail] = useState(false);
  const [liveNotifyBell, setLiveNotifyBell] = useState(false);
  const [liveFreePreview, setLiveFreePreview] = useState(false);
  const [liveIsNow, setLiveIsNow] = useState(true);
  const [liveSubmitting, setLiveSubmitting] = useState(false);
  /** Main section + optional subfolder — combined when saving the recording (see `buildRecordingLectureSectionTitle`). */
  const [liveLectureMain, setLiveLectureMain] = useState("");
  const [liveLectureSubfolder, setLiveLectureSubfolder] = useState("");
  const [liveSubjectKey, setLiveSubjectKey] = useState("maths");
  const [liveFoldersByCourse, setLiveFoldersByCourse] = useState<Record<number, any[]>>({});
  // Record a Class modal state
  const [showRecordClassModal, setShowRecordClassModal] = useState(false);
  const [recTitle, setRecTitle] = useState("");
  const [recSelectedCourses, setRecSelectedCourses] = useState<number[]>([]);
  const [recLectureMain, setRecLectureMain] = useState("");
  const [recLectureSubfolder, setRecLectureSubfolder] = useState("");
  const [recSubjectKey, setRecSubjectKey] = useState("maths");
  const [recFoldersByCourse, setRecFoldersByCourse] = useState<Record<number, any[]>>({});
  const [recVisibility, setRecVisibility] = useState<"immediate" | "scheduled">("immediate");
  const [recVisibleDate, setRecVisibleDate] = useState("");
  const [recVisibleTime, setRecVisibleTime] = useState("");
  const [recSubmitting, setRecSubmitting] = useState(false);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonVideoUrl, setLessonVideoUrl] = useState("");
  const [lessonSelectedCourses, setLessonSelectedCourses] = useState<number[]>([]);
  const [lessonFoldersByCourse, setLessonFoldersByCourse] = useState<Record<number, any[]>>({});
  const [lessonSelectedFolders, setLessonSelectedFolders] = useState<Record<number, string>>({});
  const [lessonDuration, setLessonDuration] = useState("");
  const [lessonOrderIndex, setLessonOrderIndex] = useState("");
  const [lessonFreePreview, setLessonFreePreview] = useState(false);
  const [lessonDownloadAllowed, setLessonDownloadAllowed] = useState(false);
  const [lessonUploading, setLessonUploading] = useState(false);
  const [lessonUploadProgress, setLessonUploadProgress] = useState(0);
  const [lessonSubmitting, setLessonSubmitting] = useState(false);
  const [lessonNewFolderCourseId, setLessonNewFolderCourseId] = useState<number | null>(null);
  const [lessonNewFolderName, setLessonNewFolderName] = useState("");
  const [newCourse, setNewCourse] = useState<NewCourse>(defaultNewCourse());
  const [showAddFreeMaterial, setShowAddFreeMaterial] = useState(false);
  const [freMatTitle, setFreMatTitle] = useState("");
  const [freMatUrl, setFreMatUrl] = useState("");
  const [freMatType, setFreMatType] = useState("pdf");
  const [freMatSection, setFreMatSection] = useState("");
  const [freMatDownload, setFreMatDownload] = useState(false);
  const [freMatUploading, setFreMatUploading] = useState(false);
  const [freMatUploadProgress, setFreMatUploadProgress] = useState(0);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importTargetCourseId, setImportTargetCourseId] = useState<number | null>(null);
  const [importSourceCourseId, setImportSourceCourseId] = useState<number | null>(null);
  const [allLectures, setAllLectures] = useState<any[]>([]);
  const [allTests, setAllTests] = useState<any[]>([]);
  const [allMaterials, setAllMaterials] = useState<any[]>([]);
  const [selectedLectureIds, setSelectedLectureIds] = useState<number[]>([]);
  const [selectedTestIds, setSelectedTestIds] = useState<number[]>([]);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<number[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importOptions, setImportOptions] = useState({ lectures: true, tests: true, materials: true, missions: true });
  const [importPreview, setImportPreview] = useState<{ lectures: number; tests: number; materials: number; missions: number } | null>(null);
  const [importPreviewLoading, setImportPreviewLoading] = useState(false);
  const [showAdvancedImport, setShowAdvancedImport] = useState(false);
  const [showCreateTest, setShowCreateTest] = useState(false);
  const [testTitle, setTestTitle] = useState("");
  const [testDesc, setTestDesc] = useState("");
  const [testType, setTestType] = useState("practice");
  const [testDuration, setTestDuration] = useState("60");
  const [testTotalMarks, setTestTotalMarks] = useState("100");
  const [testDifficulty, setTestDifficulty] = useState("moderate");
  const [testScheduledAt, setTestScheduledAt] = useState("");
  const [testPassingMarks, setTestPassingMarks] = useState("35");
  const [testCourseId, setTestCourseId] = useState<number | null>(null);
  const [testFolderName, setTestFolderName] = useState("");
  const [testMiniCourseId, setTestMiniCourseId] = useState<number | null>(null);
  const [testPrice, setTestPrice] = useState("0");
  const [showTestQuestions, setShowTestQuestions] = useState<number | null>(null);
  const [showAddQ, setShowAddQ] = useState(false);
  const [showBulkQ, setShowBulkQ] = useState(false);
  const [bulkQText, setBulkQText] = useState("");
  const [bulkQResult, setBulkQResult] = useState<{ count: number; questions: any[] } | null>(null);
  const [showBulkUploadModal, setShowBulkUploadModal] = useState<number | null>(null);
  /** Standalone test: insert new manual question after this question id (API order_index) */
  const [standaloneAddQuestionAfterId, setStandaloneAddQuestionAfterId] = useState<number | null>(null);
  /** True while Add form was opened from Questions list via "Add below"; dismiss/success restores list */
  const standaloneResumeQuestionListAfterAddRef = useRef(false);
  const [newQ, setNewQ] = useState({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1", difficulty: "moderate", imageUrl: "", solutionImageUrl: "" });

  // Books state
  const [showAddBook, setShowAddBook] = useState(false);
  const [bookTitle, setBookTitle] = useState("");
  const [bookDesc, setBookDesc] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookPrice, setBookPrice] = useState("0");
  const [bookOriginalPrice, setBookOriginalPrice] = useState("0");
  const [bookCoverUrl, setBookCoverUrl] = useState("");
  const [bookFileUrl, setBookFileUrl] = useState("");
  const [bookCoverBase64, setBookCoverBase64] = useState<string | null>(null);
  const [bookFileBase64, setBookFileBase64] = useState<string | null>(null);
  const [bookFileName, setBookFileName] = useState<string | null>(null);
  // Edit book
  const [editingBook, setEditingBook] = useState<any | null>(null);

  const pickBookCover = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const blobUrl = URL.createObjectURL(file);
          const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "books");
          URL.revokeObjectURL(blobUrl);
          setBookCoverUrl(publicUrl); setBookCoverBase64(null);
        } catch { Alert.alert("Upload Failed"); }
      };
      input.click();
    } else {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") { Alert.alert("Permission needed", "Allow photo library access."); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.8 });
      if (!result.canceled && result.assets[0]) {
        try {
          const { publicUrl } = await uploadToR2(result.assets[0].uri, result.assets[0].fileName || `book-cover-${Date.now()}.jpg`, result.assets[0].mimeType || "image/jpeg", "books");
          setBookCoverUrl(publicUrl); setBookCoverBase64(null);
        } catch { Alert.alert("Upload Failed"); }
      }
    }
  };

  const pickBookPdf = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "application/pdf";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          const blobUrl = URL.createObjectURL(file);
          const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "application/pdf", "books");
          URL.revokeObjectURL(blobUrl);
          setBookFileUrl(publicUrl); setBookFileBase64(null); setBookFileName(file.name);
        } catch { Alert.alert("Upload Failed"); }
      };
      input.click();
    } else {
      Alert.alert("PDF Upload", "On mobile, paste the PDF URL below or use a cloud link.");
    }
  };

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;
  const { width: screenWidth } = useWindowDimensions();
  const isWideSidebar = Platform.OS === "web" && screenWidth >= 768;
  const isAdminCompact = !isWideSidebar;

  const { data: courses = [], isLoading: coursesLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      const res = await authFetch(url.toString());
      return res.json();
    },
    enabled: true, // Admin always needs courses data
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const tsCourses = React.useMemo(() => courses.filter((c: any) => c.course_type === "test_series"), [courses]);

  useEffect(() => {
    const trimmed = userSearchInput.trim();
    if (!trimmed) {
      setUserSearchDebounced("");
      return;
    }
    const timer = setTimeout(() => setUserSearchDebounced(trimmed), 300);
    return () => clearTimeout(timer);
  }, [userSearchInput]);

  const {
    data: usersPages,
    isLoading: usersLoading,
    isFetching: usersFetching,
    fetchNextPage: fetchMoreUsers,
    hasNextPage: hasMoreUsers,
    isFetchingNextPage: isFetchingMoreUsers,
  } = useInfiniteQuery({
    queryKey: ["/api/admin/users", "paged", userSearchDebounced],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/users", baseUrl);
      url.searchParams.set("limit", "50");
      url.searchParams.set("offset", String(pageParam));
      const searchTrimmed = userSearchDebounced.trim();
      if (searchTrimmed) url.searchParams.set("search", searchTrimmed);
      const res = await authFetch(url.toString());
      if (!res.ok) {
        console.error("Admin users fetch failed:", res.status);
        return { users: [] as UserRecord[], nextOffset: undefined as number | undefined, totalCount: 0 };
      }
      const users = (await res.json()) as UserRecord[];
      const hasMore = res.headers.get("X-Has-More") === "true";
      const totalCount = parseInt(res.headers.get("X-Total-Count") ?? "0", 10) || 0;
      return {
        users,
        nextOffset: hasMore ? Number(pageParam) + users.length : undefined,
        totalCount,
      };
    },
    getNextPageParam: (last) => last.nextOffset,
    enabled: activeTab === "users",
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const users = React.useMemo(
    () => usersPages?.pages.flatMap((p) => p.users) ?? [],
    [usersPages]
  );
  const userSearchActive = userSearchDebounced.trim().length > 0;
  const usersTotalCount = usersPages?.pages[0]?.totalCount ?? 0;
  const allUsersLabelCount = userSearchActive ? usersTotalCount : users.length;

  const { data: courseAccessEnrollments } = useQuery<{ courseIds: number[] }>({
    queryKey: ["/api/admin/users", courseAccessUserId, "enrollments"],
    queryFn: async () => {
      if (!courseAccessUserId) return { courseIds: [] };
      const baseUrl = getApiUrl();
      const url = new URL(`/api/admin/users/${courseAccessUserId}/enrollments`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return { courseIds: [] };
      return res.json();
    },
    enabled: !!courseAccessUserId && showCourseAccess,
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });
  const courseAccessEnrollmentSet = React.useMemo(
    () => new Set((courseAccessEnrollments?.courseIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))),
    [courseAccessEnrollments]
  );

  const { data: deviceDeniedUsers = [], isLoading: deviceDeniedLoading } = useQuery<DeviceDeniedUserRow[]>({
    queryKey: ["/api/admin/device-denied-users"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/device-denied-users", baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "users",
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const deviceDeniedEventSum = React.useMemo(
    () => deviceDeniedUsers.reduce((s, u) => s + (Number(u.event_count) || 0), 0),
    [deviceDeniedUsers]
  );

  const { data: adminMissions = [], isLoading: missionsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/daily-missions"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/daily-missions", baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "missions",
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: adminBooks = [], isLoading: booksLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/books"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/books", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "books",
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: notifHistory = [], refetch: refetchNotifHistory } = useQuery<any[]>({
    queryKey: ["/api/admin/notifications/history"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/admin/notifications/history", baseUrl).toString());
        if (!res.ok) {
          console.warn("[NotifHistory] fetch failed:", res.status);
          return [];
        }
      return res.json();
      } catch (e) {
        console.error("[NotifHistory] error:", e);
        return [];
      }
    },
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const { data: adminDoubtData = { doubts: [] as AdminDoubtRow[], topTopics: [] as { topic: string; count: number }[], repeatedPatterns: [] as AdminDoubtPattern[], studentInsights: [] as AdminStudentInsight[], total: 0 }, isLoading: adminDoubtsLoading } = useQuery<{
    doubts: AdminDoubtRow[];
    topTopics: { topic: string; count: number }[];
    repeatedPatterns: AdminDoubtPattern[];
    studentInsights: AdminStudentInsight[];
    total: number;
  }>({
    queryKey: ["/api/admin/doubts", aiDoubtDays, aiDoubtTopic, aiDoubtStudent],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const qs = new URLSearchParams();
      if (aiDoubtDays !== "all") qs.set("days", aiDoubtDays);
      if (aiDoubtTopic !== "all") qs.set("topic", aiDoubtTopic);
      if (aiDoubtStudent.trim()) qs.set("student", aiDoubtStudent.trim());
      const path = `/api/admin/doubts${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await authFetch(new URL(path, baseUrl).toString());
      if (!res.ok) return { doubts: [], topTopics: [], repeatedPatterns: [], studentInsights: [], total: 0 };
      return res.json();
    },
    enabled: activeTab === "aiTutor",
    refetchInterval: activeTab === "aiTutor" ? 120000 : false,
    staleTime: 3 * 60 * 1000,
    refetchOnMount: false,
  });

  const aiStudentsLimit = 20;
  const { data: adminDoubtStudentsData = { rows: [] as any[], total: 0 } } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/admin/doubts/students", aiDoubtDays, aiDoubtTopic, aiDoubtStudent, aiStudentsOffset],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const qs = new URLSearchParams();
      if (aiDoubtDays !== "all") qs.set("days", aiDoubtDays);
      if (aiDoubtTopic !== "all") qs.set("topic", aiDoubtTopic);
      if (aiDoubtStudent.trim()) qs.set("q", aiDoubtStudent.trim());
      qs.set("limit", String(aiStudentsLimit));
      qs.set("offset", String(aiStudentsOffset));
      const res = await authFetch(new URL(`/api/admin/doubts/students?${qs.toString()}`, baseUrl).toString());
      if (!res.ok) return { rows: [], total: 0 };
      return res.json();
    },
    enabled: activeTab === "aiTutor",
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const aiFrequentLimit = 20;
  const { data: adminFrequentPatternsData = { rows: [] as any[], total: 0 } } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/admin/doubts/frequent", aiDoubtDays, aiDoubtStudent, aiFrequentOffset],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const qs = new URLSearchParams();
      if (aiDoubtDays !== "all") qs.set("days", aiDoubtDays);
      if (aiDoubtStudent.trim()) qs.set("q", aiDoubtStudent.trim());
      qs.set("limit", String(aiFrequentLimit));
      qs.set("offset", String(aiFrequentOffset));
      const res = await authFetch(new URL(`/api/admin/doubts/frequent?${qs.toString()}`, baseUrl).toString());
      if (!res.ok) return { rows: [], total: 0 };
      return res.json();
    },
    enabled: activeTab === "aiTutor",
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const aiStudentHistoryLimit = 25;
  const { data: aiSelectedStudentHistory = { rows: [] as any[], total: 0 } } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/admin/doubts/student", aiSelectedStudent?.user_id, aiDoubtDays, aiDoubtTopic, aiDoubtStudent, aiStudentHistoryOffset],
    queryFn: async () => {
      if (!aiSelectedStudent?.user_id) return { rows: [], total: 0 };
      const baseUrl = getApiUrl();
      const qs = new URLSearchParams();
      if (aiDoubtDays !== "all") qs.set("days", aiDoubtDays);
      if (aiDoubtTopic !== "all") qs.set("topic", aiDoubtTopic);
      if (aiDoubtStudent.trim()) qs.set("q", aiDoubtStudent.trim());
      qs.set("limit", String(aiStudentHistoryLimit));
      qs.set("offset", String(aiStudentHistoryOffset));
      const res = await authFetch(new URL(`/api/admin/doubts/student/${aiSelectedStudent.user_id}?${qs.toString()}`, baseUrl).toString());
      if (!res.ok) return { rows: [], total: 0 };
      return res.json();
    },
    enabled: activeTab === "aiTutor" && !!aiSelectedStudent?.user_id,
    staleTime: 30_000,
    refetchOnMount: false,
  });

  const aiPatternStudentsLimit = 20;
  const { data: aiSelectedPatternStudents = { rows: [] as any[], total: 0 } } = useQuery<{ rows: any[]; total: number }>({
    queryKey: ["/api/admin/doubts/frequent/students", aiSelectedPattern?.questionPattern, aiDoubtDays, aiDoubtStudent, aiPatternStudentsOffset],
    queryFn: async () => {
      if (!aiSelectedPattern?.questionPattern) return { rows: [], total: 0 };
      const baseUrl = getApiUrl();
      const qs = new URLSearchParams();
      qs.set("pattern", aiSelectedPattern.questionPattern);
      if (aiDoubtDays !== "all") qs.set("days", aiDoubtDays);
      if (aiDoubtStudent.trim()) qs.set("q", aiDoubtStudent.trim());
      qs.set("limit", String(aiPatternStudentsLimit));
      qs.set("offset", String(aiPatternStudentsOffset));
      const res = await authFetch(new URL(`/api/admin/doubts/frequent/students?${qs.toString()}`, baseUrl).toString());
      if (!res.ok) return { rows: [], total: 0 };
      return res.json();
    },
    enabled: activeTab === "aiTutor" && !!aiSelectedPattern?.questionPattern,
    staleTime: 30_000,
    refetchOnMount: false,
  });
  const clearAdminDoubtsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/admin/doubts");
      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(payload?.message || "Failed to clear doubts");
      return payload;
    },
    onSuccess: (payload: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/doubts"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/doubts/students"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/doubts/frequent"] });
      Alert.alert("AI Tutor", `Deleted ${Number(payload?.deletedCount || 0)} doubts.`);
    },
    onError: (err: any) => Alert.alert("Error", err?.message || "Failed to clear doubts"),
  });

  const { data: supportConvos = [], isLoading: supportLoading, refetch: refetchSupport } = useQuery<any[]>({
    queryKey: ["/api/admin/support/conversations"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/support/conversations", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "support",
    staleTime: 60000,
    refetchInterval: activeTab === "support" ? 60000 : false,
    refetchOnMount: false,
  });

  const [supportUserId, setSupportUserId] = useState<number | null>(null);
  const [supportUserName, setSupportUserName] = useState("");
  const [supportMessages, setSupportMessages] = useState<any[]>([]);
  const [supportMsgLoading, setSupportMsgLoading] = useState(false);
  const [supportReply, setSupportReply] = useState("");
  const [supportReplying, setSupportReplying] = useState(false);
  const supportScrollRef = React.useRef<ScrollView>(null);

  const loadSupportThread = async (userId: number, name: string) => {
    setSupportUserId(userId);
    setSupportUserName(name);
    setSupportMsgLoading(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/support/messages/${userId}`, baseUrl).toString());
      if (res.ok) {
        setSupportMessages(await res.json());
        // Scroll to bottom after messages load
        setTimeout(() => supportScrollRef.current?.scrollToEnd({ animated: false }), 100);
      }
    } finally {
      setSupportMsgLoading(false);
    }
  };

  const sendSupportReply = async () => {
    if (!supportReply.trim() || !supportUserId) return;
    setSupportReplying(true);
    try {
      await apiRequest("POST", `/api/admin/support/messages/${supportUserId}`, { message: supportReply.trim() });
      setSupportReply("");
      await loadSupportThread(supportUserId, supportUserName);
      refetchSupport();
      // Scroll to bottom after sending
      setTimeout(() => supportScrollRef.current?.scrollToEnd({ animated: true }), 150);
    } finally {
      setSupportReplying(false);
    }
  };

  const addBookMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/books", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/books"] });
      setShowAddBook(false);
      setBookTitle(""); setBookDesc(""); setBookAuthor("");
      setBookPrice("0"); setBookOriginalPrice("0");
      setBookCoverUrl(""); setBookFileUrl("");
      setBookCoverBase64(null); setBookFileBase64(null); setBookFileName(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Book added!");
    },
    onError: () => Alert.alert("Error", "Failed to add book"),
  });

  const deleteBookMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/books/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/books"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete book"),
  });

  const editBookMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/books/${data.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/books"] });
      setEditingBook(null);
      setBookTitle(""); setBookDesc(""); setBookAuthor("");
      setBookPrice("0"); setBookOriginalPrice("0");
      setBookCoverUrl(""); setBookFileUrl("");
      setBookCoverBase64(null); setBookFileBase64(null); setBookFileName(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update book"),
  });

  const { data: freeMaterials = [], isLoading: materialsLoading } = useQuery<any, any, FreeMaterial[]>({
    queryKey: ["/api/study-materials", "free"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/study-materials?free=true", baseUrl);
      const res = await authFetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },
    select: (data: any) => {
      if (Array.isArray(data)) return data;
      if (data?.materials && Array.isArray(data.materials)) return data.materials;
      return [];
    },
    enabled: activeTab === "materials",
    staleTime: 5 * 60 * 1000,
    refetchInterval: activeTab === "materials" ? 120000 : false,
    refetchOnMount: false,
  });

  const addFreeMaterialMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/study-materials", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      setShowAddFreeMaterial(false);
      setFreMatTitle(""); setFreMatUrl(""); setFreMatType("pdf"); setFreMatSection(""); setFreMatDownload(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Material added!");
    },
    onError: () => Alert.alert("Error", "Failed to add material"),
  });

  const deleteFreeMaterialMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/study-materials/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete material"),
  });

  const addMissionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/daily-missions", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      setShowAddMission(false);
      setMissionTitle(""); setMissionDesc(""); setMissionFolder(""); setMissionQuestions([]);
      setMissionXP("50"); setMissionType("free_practice"); setMissionCourseId(null); setMissionSubjectKey(""); setMissionBulkText("");
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

  const updateMissionMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/daily-missions/${data.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      setEditMission(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update mission"),
  });

  const updateAdminTestMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/tests/${data.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      setEditAdminTest(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update test"),
  });

  const updateFreeMaterialMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/study-materials/${data.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      setEditFreeMaterial(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update material"),
  });

  const { data: testFolders = [], refetch: refetchTestFolders } = useQuery<any[]>({
    queryKey: ["/api/admin/standalone-folders", "test"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/standalone-folders?type=test", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "tests",
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
  });

  const { data: materialFolders = [], refetch: refetchMaterialFolders } = useQuery<any[]>({
    queryKey: ["/api/admin/standalone-folders", "material"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/standalone-folders?type=material", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "materials",
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
  });

  const { data: missionFolders = [], refetch: refetchMissionFolders } = useQuery<any[]>({
    queryKey: ["/api/admin/standalone-folders", "mission"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/admin/standalone-folders?type=mission", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "missions",
    staleTime: 10 * 60 * 1000,
    refetchOnMount: false,
  });

  const createStandaloneFolderMutation = useMutation({
    mutationFn: async (data: { name: string; type: string; parentId?: number | null; category?: string; price?: string; originalPrice?: string; isFree?: boolean; description?: string; validityMonths?: string }) => {
      const res = await apiRequest("POST", "/api/admin/standalone-folders", data);
      return res.json();
    },
    onSuccess: (_, vars) => {
      if (vars.type === "test") refetchTestFolders();
      else if (vars.type === "mission") refetchMissionFolders();
      else refetchMaterialFolders();
    },
  });

  const standaloneFolderFullName = (folder: any): string => String(folder?.full_name || folder?.name || "").trim();
  const standaloneFolderLocalName = (folder: any): string => String(folder?.name || folder?.full_name || "").trim();
  const findStandaloneFolderById = (folderId?: number | null) => {
    if (!folderId) return null;
    return [...testFolders, ...materialFolders, ...missionFolders].find((folder: any) => Number(folder.id) === Number(folderId)) || null;
  };

  const updateStandaloneFolderMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/standalone-folders/${data.id}`, data);
    },
    onSuccess: () => { refetchTestFolders(); refetchMaterialFolders(); refetchMissionFolders(); },
  });

  const renameStandaloneFolderMutation = useMutation({
    mutationFn: async ({ id, name, validityMonths }: { id: number; name: string; validityMonths?: string }) => {
      await apiRequest("PUT", `/api/admin/standalone-folders/${id}`, { name, validityMonths });
    },
    onSuccess: (_data, variables) => {
      refetchTestFolders(); refetchMaterialFolders(); refetchMissionFolders();
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      setOpenFolderView((prev) => {
        if (!prev || Number(prev.folder?.id) !== Number(variables.id)) return prev;
        const oldFull = standaloneFolderFullName(prev.folder);
        const newFull = oldFull.includes(" / ")
          ? `${oldFull.slice(0, oldFull.lastIndexOf(" / "))} / ${variables.name}`
          : variables.name;
        return {
          ...prev,
          folder: {
            ...prev.folder,
            name: variables.name,
            full_name: newFull,
          },
        };
      });
      setEditStandaloneFolderModal(false);
    },
    onError: (err: any) => {
      const msg = String(err?.message || "").replace(/^\d+:\s*/, "") || "Failed to rename folder";
      if (Platform.OS === "web") window.alert(msg);
      else Alert.alert("Error", msg);
    },
  });

  const deleteStandaloneFolderMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/standalone-folders/${id}`);
    },
    onSuccess: () => {
      refetchTestFolders(); refetchMaterialFolders(); refetchMissionFolders();
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
    },
  });

  /**
   * Drag-reorder for free (non-course) standalone content. `itemType`:
   *   - "test"/"material": reorders FREE tests / study_materials (course_id IS NULL)
   *   - "folder": reorders standalone_folders rows (test/material/mission)
   * Web-only drag; native keeps server order. Persists via the dedicated
   * /api/admin/standalone/reorder endpoint, then refreshes the relevant lists.
   */
  const standaloneReorderMutation = useMutation({
    mutationFn: async ({ itemType, items }: { itemType: "test" | "material" | "mission" | "folder"; items: { id: number; orderIndex: number }[] }) => {
      await apiRequest("PATCH", "/api/admin/standalone/reorder", { itemType, items });
    },
    onSuccess: (_, vars) => {
      if (vars.itemType === "test") qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      else if (vars.itemType === "material") qc.invalidateQueries({ queryKey: ["/api/study-materials"] });
      else if (vars.itemType === "mission") qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
      else { refetchTestFolders(); refetchMaterialFolders(); refetchMissionFolders(); }
    },
    onError: () => Alert.alert("Error", "Failed to reorder items"),
  });

  const reorderStandaloneByDrag = (
    itemType: "test" | "material" | "mission" | "folder",
    groupItems: { id: number; type?: string }[],
    activeId: string | number,
    overId: string | number
  ) => {
    const from = groupItems.findIndex((i) => i.id === Number(activeId));
    const to = groupItems.findIndex((i) => i.id === Number(overId));
    if (from === -1 || to === -1 || from === to) return;
    const reordered = [...groupItems];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    const payload = reordered.map((item, idx) => ({ id: item.id, orderIndex: idx }));

    // Optimistic: reorder the cached list immediately so it doesn't snap back
    // while the PATCH round-trips; the next refetch reconciles with the server.
    const orderById = new Map(payload.map((p) => [p.id, p.orderIndex]));
    const applyOrder = (arr: any[]) =>
      arr
        .map((it: any) => (orderById.has(it.id) ? { ...it, order_index: orderById.get(it.id) } : it))
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));

    if (itemType === "test") {
      qc.setQueryData<any[]>(["/api/admin/tests"], (prev) => (Array.isArray(prev) ? applyOrder(prev) : prev));
    } else if (itemType === "mission") {
      qc.setQueryData<any[]>(["/api/admin/daily-missions"], (prev) => (Array.isArray(prev) ? applyOrder(prev) : prev));
    } else if (itemType === "material") {
      qc.setQueryData<any>(["/api/study-materials", "free"], (prev: any) => {
        if (Array.isArray(prev)) return applyOrder(prev);
        if (prev?.materials && Array.isArray(prev.materials)) return { ...prev, materials: applyOrder(prev.materials) };
        return prev;
      });
    } else if (itemType === "folder") {
      const folderType = (groupItems[0] as any)?.type;
      if (folderType) {
        qc.setQueryData<any[]>(["/api/admin/standalone-folders", folderType], (prev) =>
          Array.isArray(prev) ? applyOrder(prev) : prev
        );
      }
    }

    standaloneReorderMutation.mutate({ itemType, items: payload });
  };

  const updateQuestionMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/questions/${data.id}`, data);
    },
    onSuccess: () => {
      // Refresh questions list
      if (showTestQuestions) loadTestQuestions(showTestQuestions);
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      setEditQuestion(null);
    },
    onError: () => Alert.alert("Error", "Failed to update question"),
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (qId: number) => {
      await apiRequest("DELETE", `/api/admin/questions/${qId}`);
    },
    onSuccess: () => {
      if (showTestQuestions) loadTestQuestions(showTestQuestions);
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
    },
    onError: () => Alert.alert("Error", "Failed to delete question"),
  });

  const loadTestQuestions = async (testId: number) => {
    setTestQuestionsLoading(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/tests/${testId}/questions`, baseUrl).toString());
      const data = res.ok ? await res.json() : [];
      setTestQuestionsList(data);
    } catch { setTestQuestionsList([]); } finally { setTestQuestionsLoading(false); }
  };

  const dismissStandaloneTestQuestionsLayer = () => {
    if (showBulkQ) {
      setShowBulkQ(false);
      return;
    }
    if (showAddQ) {
      setShowAddQ(false);
      setStandaloneAddQuestionAfterId(null);
      if (standaloneResumeQuestionListAfterAddRef.current && showTestQuestions != null) {
        setShowViewQuestions(true);
        loadTestQuestions(showTestQuestions);
      }
      standaloneResumeQuestionListAfterAddRef.current = false;
      return;
    }
    if (showViewQuestions) {
      setShowViewQuestions(false);
      return;
    }
    setShowTestQuestions(null);
    setShowAddQ(false);
    setShowBulkQ(false);
    setBulkQResult(null);
    setShowViewQuestions(false);
    setTestQuestionsList([]);
    setStandaloneAddQuestionAfterId(null);
    standaloneResumeQuestionListAfterAddRef.current = false;
  };

  const { data: adminTests = [], isLoading: testsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/tests"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/admin/tests", baseUrl);
      const res = await authFetch(url.toString(), { cache: "no-store" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "tests",
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchInterval: activeTab === "tests" ? 120000 : false,
    refetchOnMount: false,
  });

  const createTestMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/tests", data);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowCreateTest(false);
      setTestTitle(""); setTestDesc(""); setTestType("practice");
      setTestDuration("60"); setTestTotalMarks("100"); setTestDifficulty("moderate"); setTestScheduledAt("");
      setTestCourseId(null); setTestFolderName(""); setTestMiniCourseId(null); setTestPrice("0");
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
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    },
    onError: () => Alert.alert("Error", "Failed to delete test"),
  });

  const addQuestionMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/questions", data);
      return res.json();
    },
    onSuccess: (_data: unknown, variables: any) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
      const tid = variables?.testId ?? showTestQuestions;
      setStandaloneAddQuestionAfterId(null);
      setShowAddQ(false);
      if (tid) {
        if (standaloneResumeQuestionListAfterAddRef.current) setShowViewQuestions(true);
        loadTestQuestions(tid);
      }
      standaloneResumeQuestionListAfterAddRef.current = false;
      setNewQ({ questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1", difficulty: "moderate", imageUrl: "", solutionImageUrl: "" });
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
      const payload = {
        ...courseData,
        category: courseData.courseType === "test_series" ? "Test Series" : courseData.category,
        multiSubjectConfig: courseData.courseType === "multi_subject" ? MULTI_SUBJECTS : [],
        teacherDetailsJson: courseData.courseType === "multi_subject"
          ? []
          : [],
      };
      const res = await apiRequest("POST", "/api/admin/courses", payload);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowAddCourse(false);
      setNewCourse(defaultNewCourse());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (Platform.OS === "web") window.alert("Course created successfully!");
      else Alert.alert("Success", "Course created successfully!");
    },
    onError: (err: any) => {
      const msg = (err?.message || "").replace(/^\d+: /, "");
      console.error("Create course error:", msg);
      if (Platform.OS === "web") window.alert(`Failed to create course: ${msg || "Server error"}`);
      else Alert.alert("Error", `Failed to create course: ${msg || "Please try again."}`);
    },
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
    mutationFn: async ({ title, message, target, courseId, imageUrl }: { title: string; message: string; target: string; courseId?: number | null; imageUrl?: string }) => {
      await apiRequest("POST", "/api/admin/notifications/send", { title, message, type: "info", target, courseId: courseId || undefined, imageUrl: imageUrl || undefined });
    },
    onSuccess: () => {
      setShowNotification(false);
      setNotifTitle(""); setNotifMessage(""); setNotifTarget("all"); setNotifCourseId(null); setNotifImageUrl("");
      qc.invalidateQueries({ queryKey: ["/api/admin/notifications/history"] });
      refetchNotifHistory();
      if (Platform.OS === "web") window.alert("Notification sent successfully!");
      else Alert.alert("Sent!", "Notification sent successfully.");
    },
    onError: (err: any) => {
      const msg = (err?.message || "").replace(/^\d+: /, "");
      if (Platform.OS === "web") window.alert(`Failed to send: ${msg || "Server error"}`);
      else Alert.alert("Error", "Failed to send notification");
    },
  });

  const blockUserMutation = useMutation({
    mutationFn: async ({ userId, blocked }: { userId: number; blocked: boolean }) => {
      await apiRequest("PUT", `/api/admin/users/${userId}/block`, { blocked });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update user"),
  });

  // Fetch folders for a course when selected for lesson class
  const fetchCourseFolders = async (courseId: number) => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/courses/${courseId}/folders`, baseUrl).toString());
      if (res.ok) {
        const folders = await res.json();
        setLessonFoldersByCourse(prev => ({ ...prev, [courseId]: folders.filter((f: any) => f.type === "lecture") }));
      }
    } catch (_e) {}
  };

  const fetchLiveRecordingFolders = async (courseId: number, mode: "live" | "record") => {
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/courses/${courseId}/folders`, baseUrl).toString());
      if (!res.ok) return;
      const folders = await res.json();
      const lectureFolders = Array.isArray(folders) ? folders.filter((f: any) => f.type === "lecture") : [];
      if (mode === "live") setLiveFoldersByCourse((prev) => ({ ...prev, [courseId]: lectureFolders }));
      else setRecFoldersByCourse((prev) => ({ ...prev, [courseId]: lectureFolders }));
    } catch (_e) {}
  };

  const folderFullName = (folder: any): string => String(folder?.full_name || folder?.name || "").trim();
  const selectedMultiCourseIds = (ids: number[]) =>
    ids.filter((courseId) => courses.some((course) => Number(course.id) === Number(courseId) && course.course_type === "multi_subject"));
  const selectedMultiCourseFolders = (ids: number[], folderMap: Record<number, any[]>, subjectKey: string) => {
    const rows = selectedMultiCourseIds(ids).flatMap((courseId) => folderMap[courseId] || []);
    const map = new Map<string, any>();
    rows
      .filter((folder: any) => String(folder.subject_key || "").toLowerCase() === subjectKey)
      .forEach((folder: any) => {
        const key = folderFullName(folder);
        if (key && !map.has(key)) map.set(key, folder);
      });
    return [...map.values()];
  };
  const directChildFolders = (folders: any[], parentName: string) => {
    const parent = folders.find((folder: any) => folderFullName(folder) === parentName);
    const byParent = parent?.id ? folders.filter((folder: any) => Number(folder.parent_id || 0) === Number(parent.id)) : [];
    const prefix = `${parentName} / `;
    const byPath = folders.filter((folder: any) => {
      const fullName = folderFullName(folder);
      if (!fullName.startsWith(prefix)) return false;
      const rest = fullName.slice(prefix.length);
      return rest && !rest.includes(" / ");
    });
    const map = new Map<string, any>();
    [...byParent, ...byPath].forEach((folder) => {
      const key = folderFullName(folder);
      if (key) map.set(key, folder);
    });
    return [...map.values()];
  };

  // Upcoming classes query
  const { data: upcomingClasses = [], refetch: refetchUpcoming } = useQuery<any[]>({
    queryKey: ["/api/upcoming-classes"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/upcoming-classes", baseUrl).toString(), { cache: "no-store" });
      if (!res.ok) {
        console.warn("[UpcomingClasses] fetch failed:", res.status);
        return [];
      }
      return res.json();
    },
    staleTime: 0,
    refetchInterval: activeTab === "courses" ? 10_000 : false,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const handleScheduleLiveClass = async () => {
    if (!liveTitle || (liveSelectedCourses.length === 0 && !editingLiveClass)) return;
    setLiveSubmitting(true);
    try {
      const scheduledAt = liveIsNow ? Date.now() : new Date(`${liveScheduleDate}T${liveScheduleTime || "00:00"}`).getTime();

      if (editingLiveClass) {
        // UPDATE existing live class entries — single PUT with all fields
        for (const id of editingLiveClass.ids) {
          await apiRequest("PUT", `/api/admin/live-classes/${id}`, {
            title: liveTitle,
            scheduledAt,
            notifyEmail: liveNotifyEmail,
            notifyBell: liveNotifyBell,
            isFreePreview: liveFreePreview,
            isPublic: liveFreePreview,
            chatMode: liveChatMode,
            showViewerCount: liveShowViewerCount,
            lectureSectionTitle: liveLectureMain.trim() || null,
            lectureSubfolderTitle: liveLectureSubfolder.trim() || null,
            subjectKey: editingLiveClass?.subject_key ? liveSubjectKey : undefined,
          }).catch(() => {});
        }
      } else {
        // CREATE new live class entries
        let createdId: number | null = null;
        for (const courseId of liveSelectedCourses) {
          // Auto-create lecture folder bucket for recording path (main[/subfolder]) if missing.
          const autoFolderName = buildRecordingLectureSectionTitle(liveLectureMain, liveLectureSubfolder, null).trim();
          if (autoFolderName) {
            await apiRequest("POST", `/api/admin/courses/${courseId}/folders`, {
              name: autoFolderName,
              type: "lecture",
              subjectKey: courses.some((course) => Number(course.id) === Number(courseId) && course.course_type === "multi_subject") ? liveSubjectKey : null,
            }).catch(() => {});
          }
          const res = await apiRequest("POST", "/api/admin/live-classes", {
            title: liveTitle,
            courseId,
            scheduledAt,
            isLive: false,
            isPublic: liveFreePreview,
            notifyEmail: liveNotifyEmail,
            notifyBell: liveNotifyBell,
            isFreePreview: liveFreePreview,
            streamType: 'rtmp',
            chatMode: liveChatMode,
            showViewerCount: liveShowViewerCount,
            lectureSectionTitle: liveLectureMain.trim() || null,
            lectureSubfolderTitle: liveLectureSubfolder.trim() || null,
            subjectKey: courses.some((course) => Number(course.id) === Number(courseId) && course.course_type === "multi_subject") ? liveSubjectKey : null,
          });
          if (!createdId) {
            const body = await res.json();
            createdId = body.id;
          }
        }

        // If "Live Now" mode, navigate to Studio Setup page
        if (liveIsNow && createdId) {
          refetchUpcoming();
          qc.invalidateQueries({ queryKey: ["/api/upcoming-classes"] });
          qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
          setShowScheduleLiveClass(false);
          setEditingLiveClass(null);
          setLiveTitle(""); setLiveSelectedCourses([]);
          setLiveChatMode('public'); setLiveShowViewerCount(true);
          setLiveScheduleDate(""); setLiveScheduleTime(""); setLiveNotifyEmail(false);
          setLiveNotifyBell(false); setLiveFreePreview(false); setLiveIsNow(true);
          setLiveLectureMain("");
          setLiveLectureSubfolder("");
          setLiveSubjectKey("maths");
          setLiveFoldersByCourse({});
          setLiveSubmitting(false);
          router.push(`/admin/live/${createdId}/choose-stream` as any);
          return;
        }
      }
      // Notifications will be sent automatically 30 min before class by server scheduler — not here
      refetchUpcoming();
      qc.invalidateQueries({ queryKey: ["/api/upcoming-classes"] });
      qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
      setShowScheduleLiveClass(false);
      setEditingLiveClass(null);
      setLiveTitle(""); setLiveSelectedCourses([]);
      setLiveChatMode('public'); setLiveShowViewerCount(true);
      setLiveScheduleDate(""); setLiveScheduleTime(""); setLiveNotifyEmail(false);
      setLiveNotifyBell(false); setLiveFreePreview(false); setLiveIsNow(true);
      setLiveLectureMain("");
      setLiveLectureSubfolder("");
      setLiveSubjectKey("maths");
      setLiveFoldersByCourse({});
      Alert.alert("Success", editingLiveClass ? "Live class updated!" : "Live class scheduled!");
    } catch (err: any) {
      Alert.alert("Error", "Failed to schedule live class.");
    } finally {
      setLiveSubmitting(false);
    }
  };

  // Handle Record a Class modal submission
  const handleRecordClass = async () => {
    if (!recTitle.trim() || recSelectedCourses.length === 0) return;
    setRecSubmitting(true);
    try {
      let visibleAfterAt: number | null = null;
      if (recVisibility === "scheduled" && recVisibleDate.trim()) {
        const ts = new Date(`${recVisibleDate}T${recVisibleTime || "00:00"}`).getTime();
        if (Number.isFinite(ts)) visibleAfterAt = ts;
      }
      let createdId: number | null = null;
      for (const courseId of recSelectedCourses) {
        const isMultiSubjectTarget = courses.some((course) => Number(course.id) === Number(courseId) && course.course_type === "multi_subject");
        const autoFolderName = buildRecordingLectureSectionTitle(recLectureMain, recLectureSubfolder, null).trim();
        if (autoFolderName) {
          await apiRequest("POST", `/api/admin/courses/${courseId}/folders`, {
            name: autoFolderName,
            type: "lecture",
            subjectKey: isMultiSubjectTarget ? recSubjectKey : null,
          }).catch(() => {});
        }
        const res = await apiRequest("POST", "/api/admin/live-classes", {
          title: recTitle.trim(),
          courseId,
          isLive: false,
          isPublic: false,
          streamType: "webrtc",
          isRecordingMode: true,
          visibleAfterAt,
          lectureSectionTitle: recLectureMain.trim() || null,
          lectureSubfolderTitle: recLectureSubfolder.trim() || null,
          subjectKey: isMultiSubjectTarget ? recSubjectKey : null,
        });
        if (!createdId) {
          const body = await res.json();
          createdId = body.id;
        }
      }
      if (createdId) {
        // Close modal and reset form before navigating
        setShowRecordClassModal(false);
        setRecTitle("");
        setRecSelectedCourses([]);
        setRecLectureMain("");
        setRecLectureSubfolder("");
        setRecSubjectKey("maths");
        setRecFoldersByCourse({});
        setRecVisibility("immediate");
        setRecVisibleDate("");
        setRecVisibleTime("");
        setRecSubmitting(false);
        router.push(`/admin/live/${createdId}/choose-stream` as any);
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to create recording session.");
      setRecSubmitting(false);
    }
  };

  // Edit upcoming class
  const [editingLiveClass, setEditingLiveClass] = useState<any>(null);
  const [liveActionSheet, setLiveActionSheet] = useState<any>(null);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [endingLiveGroupKey, setEndingLiveGroupKey] = useState<string | null>(null);

  const createFolderForCourse = async (courseId: number, folderName: string) => {
    if (!folderName.trim()) return;
    try {
      await apiRequest("POST", `/api/admin/courses/${courseId}/folders`, { name: folderName.trim(), type: "lecture" });
      await fetchCourseFolders(courseId);
      setLessonSelectedFolders(p => ({ ...p, [courseId]: folderName.trim() }));
      setLessonNewFolderCourseId(null);
      setLessonNewFolderName("");
    } catch (_e) {
      Alert.alert("Error", "Failed to create folder");
    }
  };

  const toggleLessonCourse = (courseId: number) => {
    setLessonSelectedCourses(prev => {
      if (prev.includes(courseId)) {
        const next = prev.filter(id => id !== courseId);
        setLessonSelectedFolders(pf => { const n = { ...pf }; delete n[courseId]; return n; });
        return next;
      } else {
        fetchCourseFolders(courseId);
        return [...prev, courseId];
      }
    });
  };

  const handleAddLessonClass = async () => {
    if (!lessonTitle || !lessonVideoUrl || lessonSelectedCourses.length === 0) return;
    setLessonSubmitting(true);
    try {
      for (const courseId of lessonSelectedCourses) {
        await apiRequest("POST", "/api/admin/lectures", {
          courseId,
          title: lessonTitle,
          videoUrl: lessonVideoUrl,
          videoType: lessonVideoUrl.includes("youtube") || lessonVideoUrl.includes("youtu.be") ? "youtube" : "r2",
          durationMinutes: (() => { const p = lessonDuration.split(":").map(Number); return (p[0] || 0) * 60 + (p[1] || 0) + ((p[2] || 0) > 0 ? 1 : 0); })(),
          orderIndex: parseInt(lessonOrderIndex) || 0,
          isFreePreview: lessonFreePreview,
          downloadAllowed: lessonDownloadAllowed,
          sectionTitle: lessonSelectedFolders[courseId] || null,
        });
      }
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowAddLessonClass(false);
      setLessonTitle(""); setLessonVideoUrl(""); setLessonSelectedCourses([]);
      setLessonFoldersByCourse({}); setLessonSelectedFolders({});
      setLessonDuration(""); setLessonOrderIndex(""); setLessonFreePreview(false); setLessonDownloadAllowed(false);
      setLessonNewFolderCourseId(null); setLessonNewFolderName("");
      Alert.alert("Success", `Lecture added to ${lessonSelectedCourses.length} course${lessonSelectedCourses.length > 1 ? "s" : ""}!`);
    } catch (err: any) {
      Alert.alert("Error", "Failed to add lecture. Please try again.");
    } finally {
      setLessonSubmitting(false);
    }
  };

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: number) => {
      if (deletingUserIdsRef.current.has(userId)) return userId;
      deletingUserIdsRef.current.add(userId);
      await apiRequest("DELETE", `/api/admin/users/${userId}`);
      return userId;
    },
    onSuccess: (deletedUserId) => {
      deletingUserIdsRef.current.delete(Number(deletedUserId));
      qc.setQueryData<UserRecord[]>(["/api/admin/users"], (prev) =>
        Array.isArray(prev) ? prev.filter((u) => Number(u.id) !== Number(deletedUserId)) : prev
      );
      qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
      qc.refetchQueries({ queryKey: ["/api/admin/users"], type: "active" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Success", "User removed from app");
    },
    onError: (err: any, userId) => {
      deletingUserIdsRef.current.delete(Number(userId));
      Alert.alert("Error", err?.message || "Failed to delete user");
    },
    onSettled: (_data, _error, userId) => {
      deletingUserIdsRef.current.delete(Number(userId));
    },
  });

  if (authLoading || (!isAdmin && !authRetryDone)) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.centered}>
        <Ionicons name="lock-closed" size={48} color={Colors.light.textMuted} />
        <Text style={styles.errorText}>Admin access required</Text>
        <Pressable style={styles.backBtnSimple} onPress={() => adminGoBack(router, "/(tabs)")}>
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

  const openAdminTestAttempts = async (test: any) => {
    setSelectedAdminTest(test);
    setSelectedTestAttempt(null);
    setAdminTestAttempts([]);
    setAdminTestQuestions([]);
    setAdminTestAttemptsLoading(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/tests/${test.id}/attempts`, baseUrl).toString());
      if (!res.ok) {
        const errText = await res.text();
        console.error("Test attempts fetch failed:", res.status, errText);
        setAdminTestAttempts([]);
        setAdminTestQuestions([]);
        return;
      }
      const data = await res.json();
      setSelectedAdminTest(data.test || test);
      setAdminTestQuestions(Array.isArray(data.questions) ? data.questions : []);
      setAdminTestAttempts(Array.isArray(data.attempts) ? data.attempts : []);
    } catch (e) {
      console.error("Test attempts fetch error:", e);
      setAdminTestAttempts([]);
      setAdminTestQuestions([]);
    } finally {
      setAdminTestAttemptsLoading(false);
    }
  };

  const findAdminTestById = (testId: number | null | undefined) =>
    testId ? adminTests.find((t: any) => Number(t.id) === Number(testId)) : null;

  const renderAdminMissionCard = (m: any) => {
    const qCount = Array.isArray(m.questions) ? m.questions.length : 0;
    const totalMarks = Array.isArray(m.questions) ? m.questions.reduce((s: number, q: any) => s + (q.marks || 0), 0) : 0;
    return (
      <Pressable key={m.id} style={[styles.adminCard, { flexDirection: "row", alignItems: "center", backgroundColor: colors.card }]} onPress={async () => {
        setSelectedMission(m);
        setMissionAttemptsLoading(true);
        try {
          const baseUrl = getApiUrl();
          const res = await authFetch(new URL(`/api/admin/daily-missions/${m.id}/attempts`, baseUrl).toString());
          if (!res.ok) {
            const errText = await res.text();
            console.error("Attempts fetch failed:", res.status, errText);
            setMissionAttempts([]);
          } else {
            const data = await res.json();
            setMissionAttempts(data);
          }
        } catch (e) {
          console.error("Attempts fetch error:", e);
          setMissionAttempts([]);
        } finally {
          setMissionAttemptsLoading(false);
        }
      }}>
        <View style={styles.adminCardContent}>
          <View style={styles.adminCardRow}>
            <Text style={[styles.adminCardTitle, { color: colors.text }]} numberOfLines={2}>{m.title}</Text>
            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
              {m.folder_name ? (
                <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: "#D1FAE5" }}>
                  <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#0F766E" }}>📁 {m.folder_name}</Text>
                </View>
              ) : null}
              <View style={[styles.typeBadge, { backgroundColor: m.mission_type === "free_practice" ? "#22C55E20" : "#F59E0B20" }]}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: m.mission_type === "free_practice" ? "#22C55E" : "#F59E0B" }}>
                  {m.mission_type === "free_practice" ? "Free" : "Drill"}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.adminCardMeta}>
            <Text style={[styles.adminCardMetaText, { color: colors.textMuted }]}>{qCount} questions</Text>
            {totalMarks > 0 && <><Text style={[styles.adminCardMetaText, { color: colors.textMuted }]}>|</Text><Text style={[styles.adminCardMetaText, { color: colors.textMuted }]}>{totalMarks} marks</Text></>}
            <Text style={[styles.adminCardMetaText, { color: colors.textMuted }]}>|</Text>
            <Text style={[styles.adminCardMetaText, { color: colors.textMuted }]}>{m.mission_date}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="people-outline" size={16} color={Colors.light.primary} />
          <Pressable style={[styles.deleteBtn, { backgroundColor: "#ECFDF5" }]} onPress={(e) => {
            e.stopPropagation?.();
            void downloadAdminContent("mission", m.id, `${m.title}.pdf`);
          }}>
            <Ionicons name="download-outline" size={18} color="#059669" />
          </Pressable>
          <Pressable style={[styles.deleteBtn, { backgroundColor: "#EEF2FF" }]} onPress={(e) => {
            e.stopPropagation?.();
            setEditMission({ ...m, questions: Array.isArray(m.questions) ? m.questions.map((q: any) => ({ ...q, marks: String(q.marks || ""), solution: q.solution || "", image_url: q.image_url || "", solution_image_url: q.solution_image_url || "", subtopic: q.subtopic || "" })) : [] });
          }}>
            <Ionicons name="pencil-outline" size={18} color={Colors.light.primary} />
          </Pressable>
          <Pressable style={styles.deleteBtn} onPress={(e) => {
            e.stopPropagation?.();
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
      </Pressable>
    );
  };

  const tabContent = (
    <ScrollView style={[styles.content, { backgroundColor: colors.background }]} contentContainerStyle={[styles.contentInner, { paddingBottom: bottomPadding + 80 }]}>
      {/* Folder Detail View — replaces tab content when a folder is opened */}
      {openFolderView ? (() => {
        const { folder, type } = openFolderView;
        const isTest = type === "test";
        const isMission = type === "mission";
        const accentColor = isMission ? "#0F766E" : isTest ? Colors.light.primary : "#DC2626";
        const folderPath = standaloneFolderFullName(folder);
        const folderList = isMission ? missionFolders : isTest ? testFolders : materialFolders;
        const childFolders = folderList.filter((f: any) => Number(f.parent_id || 0) === Number(folder.id || 0));
        const items = isMission
          ? adminMissions.filter((m: any) => m.folder_name === folderPath)
          : isTest
          ? adminTests.filter((t: any) => t.folder_name === folderPath && !t.course_id)
          : freeMaterials.filter((m: any) => m.section_title === folderPath);

        const renderTestCard = (test: any) => (
          <Pressable key={test.id} style={styles.adminCard} onPress={() => openAdminTestAttempts(test)}>
            <View style={styles.adminCardContent}>
              <View style={styles.adminCardRow}>
                <Text style={styles.adminCardTitle} numberOfLines={2}>{test.title}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <AdminExportDownloadButton kind="test" id={test.id} filename={`${test.title}.pdf`} stopPropagation size={14} />
                  <Pressable style={[styles.testActionBtn, { backgroundColor: "#EEF2FF" }]} onPress={(e) => { e.stopPropagation?.(); setEditAdminTest({ ...test, durationMinutes: String(test.duration_minutes), totalMarks: String(test.total_marks), passingMarks: String(test.passing_marks || 35), ts_course_id: tsCourses.some((c: any) => c.id === test.course_id) ? test.course_id : null }); }}>
                    <Ionicons name="pencil-outline" size={14} color={Colors.light.primary} />
                    <Text style={[styles.testActionBtnText, { color: Colors.light.primary }]}>Edit Test</Text>
                  </Pressable>
                  <View style={[styles.typeBadge, { backgroundColor: "#1A56DB15" }]}>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{test.test_type}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.adminCardMeta}>
                <Text style={styles.adminCardMetaText}>{test.total_questions || 0} Q · {test.duration_minutes}min · {test.total_marks} marks</Text>
                {test.course_title && <Text style={[styles.adminCardMetaText, { color: Colors.light.primary }]}> · {test.course_title}</Text>}
              </View>
              <View style={styles.testActionRow}>
                <Pressable style={[styles.testActionBtn, { backgroundColor: "#ECFDF5" }]} onPress={(e) => { e.stopPropagation?.(); void downloadAdminContent("test", test.id, `${test.title}.pdf`); }}>
                  <Ionicons name="download-outline" size={14} color="#059669" />
                  <Text style={[styles.testActionBtnText, { color: "#059669" }]}>Download PDF</Text>
                </Pressable>
                <Pressable style={styles.testActionBtn} onPress={(e) => { e.stopPropagation?.(); setShowTestQuestions(test.id); setShowAddQ(true); setShowBulkQ(false); setShowViewQuestions(false); setBulkQResult(null); setBulkQText(""); }}>
                  <Ionicons name="create-outline" size={14} color={Colors.light.primary} />
                  <Text style={styles.testActionBtnText}>Add Questions</Text>
                </Pressable>
                <Pressable style={[styles.testActionBtn, { backgroundColor: "#FFF3E0" }]} onPress={(e) => { e.stopPropagation?.(); setShowBulkUploadModal(test.id); }}>
                  <Ionicons name="cloud-upload" size={14} color="#FF6B35" />
                  <Text style={[styles.testActionBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                </Pressable>
                <Pressable style={[styles.testActionBtn, { backgroundColor: "#DCFCE7" }]} onPress={(e) => { e.stopPropagation?.(); setShowTestQuestions(test.id); setShowViewQuestions(true); setShowAddQ(false); setShowBulkQ(false); loadTestQuestions(test.id); }}>
                  <Ionicons name="list" size={14} color="#16A34A" />
                  <Text style={[styles.testActionBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                </Pressable>
                <Pressable style={[styles.testActionBtn, { backgroundColor: "#FEE2E2" }]} onPress={(e) => {
                  e.stopPropagation?.();
                  if (Platform.OS === "web") { if (window.confirm(`Delete "${test.title}" and all its questions?`)) deleteTestMutation.mutate(test.id); }
                  else Alert.alert("Delete Test", `Delete "${test.title}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) }]);
                }}>
                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                </Pressable>
              </View>
            </View>
          </Pressable>
        );

        const renderMatCard = (mat: any) => (
          <View key={mat.id} style={styles.adminCard}>
            <View style={styles.adminCardContent}>
              <View style={styles.adminCardRow}>
                <Text style={styles.adminCardTitle} numberOfLines={2}>{mat.title}</Text>
                <View style={{ backgroundColor: "#10B98120", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#10B981", textTransform: "uppercase" }}>{mat.file_type}</Text>
                </View>
              </View>
              <View style={styles.adminCardMeta}>
                {mat.section_title && <Text style={styles.adminCardMetaText}>{mat.section_title} | </Text>}
                <Text style={styles.adminCardMetaText}>{mat.download_allowed ? "Download ON" : "View only"}</Text>
              </View>
            </View>
            <View style={styles.adminCardActions}>
              {!!mat.file_url && (
                <Pressable style={[styles.deleteBtn, { backgroundColor: "#ECFDF5", marginRight: 6 }]} onPress={() => void downloadAdminContent("material", mat.id, mat.title)}>
                  <Ionicons name="download-outline" size={18} color="#059669" />
                </Pressable>
              )}
              <Pressable style={[styles.deleteBtn, { backgroundColor: "#EEF2FF", marginRight: 6 }]} onPress={() => setEditFreeMaterial({ ...mat, sectionTitle: mat.section_title || "", downloadAllowed: mat.download_allowed || false })}>
                <Ionicons name="pencil-outline" size={18} color={Colors.light.primary} />
              </Pressable>
              <Pressable style={styles.deleteBtn} onPress={() => {
                if (Platform.OS === "web") { if (window.confirm(`Delete "${mat.title}"?`)) deleteFreeMaterialMutation.mutate(mat.id); }
                else Alert.alert("Delete", `Delete "${mat.title}"?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteFreeMaterialMutation.mutate(mat.id) }]);
              }}>
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </Pressable>
            </View>
          </View>
        );

        return (
          <View style={{ gap: 12 }}>
            {/* Header with back button */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 }}>
              <Pressable onPress={() => {
                const parent = folder.parent_id ? folderList.find((f: any) => Number(f.id) === Number(folder.parent_id)) : null;
                if (parent) setOpenFolderView({ folder: parent, type });
                else setOpenFolderView(null);
              }} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="arrow-back" size={18} color={Colors.light.text} />
              </Pressable>
              <Ionicons name="folder" size={24} color={accentColor} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{standaloneFolderLocalName(folder)}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{items.length} {isMission ? "mission" : isTest ? "test" : "file"}{items.length !== 1 ? "s" : ""} · {folderPath}</Text>
                </View>
              </View>
              <Pressable style={{ padding: 6 }} onPress={() => setStandaloneFolderActionSheet(folder)}>
                <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
              </Pressable>
            </View>

            {/* Add button */}
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: accentColor, borderRadius: 12, paddingVertical: 12 }}
              onPress={() => {
                if (isMission) { setMissionFolder(folderPath); setShowAddMission(true); }
                else if (isTest) { setTestFolderName(folderPath); setShowCreateTest(true); }
                else { setFreMatSection(folderPath); setShowAddFreeMaterial(true); }
              }}>
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{isMission ? "Add Mission" : isTest ? "Create Test" : "Add Material"}</Text>
            </Pressable>

            <Pressable
              style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 12, paddingVertical: 12, borderWidth: 1, borderColor: "#BBF7D0" }}
              onPress={() => {
                setNewFolderNameInput("");
                setNewStandaloneFolderParentId(folder.id);
                setShowCreateFolderModal(type);
              }}>
              <Ionicons name="folder-open-outline" size={18} color="#16A34A" />
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>Create Subfolder</Text>
            </Pressable>

            {childFolders.length > 0 && (
              <View style={{ gap: 8 }}>
                {childFolders.map((child: any) => (
                  <Pressable
                    key={child.id}
                    style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                    onPress={() => setOpenFolderView({ folder: child, type })}
                  >
                    <Ionicons name="folder" size={24} color={accentColor} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.adminCardTitle}>{standaloneFolderLocalName(child)}</Text>
                      <Text style={styles.adminCardMetaText}>{standaloneFolderFullName(child)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Items list */}
            {items.length === 0 && childFolders.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
                <Ionicons name={isMission ? "flame-outline" : isTest ? "document-text-outline" : "folder-open-outline"} size={40} color={Colors.light.textMuted} />
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No {isMission ? "missions" : isTest ? "tests" : "materials"} in this folder yet</Text>
              </View>
            ) : isMission ? (
              <View style={{ gap: 8 }}>
                <SortableList
                  ids={items.map((i: any) => i.id)}
                  onReorder={(a, o) => reorderStandaloneByDrag("mission", items, a, o)}
                >
                  {items.map((item: any) => (
                    <SortableItem key={item.id} id={item.id}>
                      {renderAdminMissionCard(item)}
                    </SortableItem>
                  ))}
                </SortableList>
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                <SortableList
                  ids={items.map((i: any) => i.id)}
                  onReorder={(a, o) => reorderStandaloneByDrag(isTest ? "test" : "material", items, a, o)}
                >
                  {items.map((item: any) => (
                    <SortableItem key={item.id} id={item.id}>
                      {isTest ? renderTestCard(item) : renderMatCard(item)}
                    </SortableItem>
                  ))}
                </SortableList>
              </View>
            )}
          </View>
        );
      })() : (
      <>
      {activeTab === "courses" && (
        <View style={{ flexDirection: isWideSidebar ? "row" : "column-reverse", gap: isWideSidebar ? 20 : 16, alignItems: isWideSidebar ? ("stretch" as any) : "stretch", width: "100%" }}>
          {/* Courses List — 2/3 width on laptop web */}
          <View style={{ flex: isWideSidebar ? 2 : undefined, minWidth: 0, width: isAdminCompact ? "100%" : undefined }}>
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Courses ({courses.filter(c => c.course_type !== "test_series").length})</Text>
              <Pressable style={styles.addBtn} onPress={() => {
                setShowCourseTypeChoice(true);
              }}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add Course</Text>
              </Pressable>
            </View>

            {coursesLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : courses.filter(c => c.course_type !== "test_series").length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 40, gap: 10 }}>
                <Ionicons name="book-outline" size={48} color={Colors.light.textMuted} />
                <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>No courses yet</Text>
                <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" }}>Tap "+ Add Course" to create your first course</Text>
              </View>
            ) : (
              courses.filter(c => c.course_type !== "test_series").map((course) => (
                <View key={course.id} style={styles.adminCard}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <Text style={styles.adminCardTitle} numberOfLines={2}>{course.title}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={{ backgroundColor: course.course_type === "test_series" ? "#F59E0B20" : course.course_type === "multi_subject" ? (String(course.batch_status || "live").toLowerCase() === "recorded" ? "#8B5CF620" : "#EF444420") : (course.course_type || "live") === "live" ? "#EF444420" : "#8B5CF620", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: course.course_type === "test_series" ? "#F59E0B" : course.course_type === "multi_subject" ? (String(course.batch_status || "live").toLowerCase() === "recorded" ? "#8B5CF6" : "#EF4444") : (course.course_type || "live") === "live" ? "#EF4444" : "#8B5CF6", textTransform: "uppercase" }}>
                            {course.course_type === "test_series" ? "📋 TEST SERIES" : course.course_type === "multi_subject" ? (String(course.batch_status || "live").toLowerCase() === "recorded" ? "📹 RECORDED" : "🔴 LIVE") : (course.course_type || "live") === "live" ? "🔴 LIVE" : "📹 RECORDED"}
                          </Text>
                        </View>
                        <View style={[styles.statusDot, { backgroundColor: course.is_published ? "#22C55E" : "#F59E0B" }]} />
                        {!course.is_published && (
                          <View style={{ backgroundColor: "#FEF3C7", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#D97706" }}>UNPUBLISHED</Text>
                          </View>
                        )}
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      <Text style={styles.adminCardMetaText}>{course.category}</Text>
                      <Text style={styles.adminCardMetaText}>|</Text>
                      <Text style={styles.adminCardMetaText}>{course.total_lectures} lectures</Text>
                      <Text style={styles.adminCardMetaText}>|</Text>
                      <Text style={styles.adminCardMetaText}>{course.is_free ? "FREE" : `₹${parseFloat(course.price).toFixed(0)}`}</Text>
                    </View>
                    {((course.course_type || "live") === "live" || course.course_type === "multi_subject") && (course.start_date || course.end_date) && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Ionicons name="calendar-outline" size={12} color={Colors.light.textMuted} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
                          {course.start_date || "TBD"} → {course.end_date || "TBD"}
                        </Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.adminCardActions}>
                    <Pressable style={[styles.editBtn, { backgroundColor: "#8B5CF615" }]} onPress={() => {
                        setImportTargetCourseId(course.id);
                        setImportSourceCourseId(null);
                        setImportOptions({ lectures: true, tests: true, materials: true, missions: true });
                        setImportPreview(null);
                        setShowAdvancedImport(false);
                        setSelectedLectureIds([]);
                        setSelectedTestIds([]);
                        setSelectedMaterialIds([]);
                        setShowImportModal(true);
                      }}>
                        <Ionicons name="download-outline" size={18} color="#8B5CF6" />
                      </Pressable>
                    <Pressable style={[styles.editBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => router.push({ pathname: "/admin/course/[id]", params: { id: String(course.id), tab: "enrolled" } })}>
                      <Ionicons name="people-outline" size={18} color={Colors.light.primary} />
                    </Pressable>
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
          </View>

          {/* Upcoming Class — 1/3 width on laptop web; first on compact (column-reverse) */}
          <View style={{ flex: isWideSidebar ? 1 : undefined, minWidth: 0, width: isAdminCompact ? "100%" : undefined }}>
            <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, padding: 16, flex: isWideSidebar ? 1 : undefined, overflow: isWideSidebar ? "hidden" : undefined }}>
              {/* Panel Header */}
              {showAddLessonClass ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Pressable onPress={() => { setShowAddLessonClass(false); setShowCreateClassChoice(true); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="arrow-back" size={18} color={Colors.light.text} />
                  </Pressable>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 }}>Add Lesson Class</Text>
                </View>
              ) : showScheduleLiveClass ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <Pressable onPress={() => { setShowScheduleLiveClass(false); setShowCreateClassChoice(true); }} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="arrow-back" size={18} color={Colors.light.text} />
                  </Pressable>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 }}>Schedule Live Class</Text>
                </View>
              ) : showCreateClassChoice ? (
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Create Class</Text>
                  <Pressable onPress={() => setShowCreateClassChoice(false)} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="close" size={18} color={Colors.light.text} />
                  </Pressable>
                </View>
              ) : (
                <>
                  <Text style={styles.sectionTitle}>Upcoming Class</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 12, marginBottom: 12 }}>
                    <Pressable
                      style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 13 }}
                      onPress={() => setShowCreateClassChoice(true)}
                    >
                      <Ionicons name="add-circle-outline" size={18} color="#fff" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Create Class</Text>
                    </Pressable>
                    <Pressable
                      style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#DC2626", borderRadius: 12, paddingVertical: 13 }}
                      onPress={() => setShowRecordClassModal(true)}
                    >
                      <Ionicons name="recording-outline" size={18} color="#fff" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Record a Class</Text>
                    </Pressable>
                  </View>
                </>
              )}

              {/* Panel Content */}
              <ScrollView style={isWideSidebar ? { flex: 1 } : undefined} nestedScrollEnabled={isWideSidebar} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
                {showAddLessonClass ? (
                  /* Add Lesson Class Form */
                  <View style={{ gap: 10 }}>
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Class Title *</Text>
                      <TextInput style={styles.formInput} placeholder="e.g., Introduction to Algebra" placeholderTextColor={Colors.light.textMuted} value={lessonTitle} onChangeText={setLessonTitle} />
                    </View>

                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Video URL (YouTube or uploaded) *</Text>
                      <TextInput style={styles.formInput} placeholder="https://youtube.com/watch?v=..." placeholderTextColor={Colors.light.textMuted} value={lessonVideoUrl} onChangeText={setLessonVideoUrl} autoCapitalize="none" />
                      <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, opacity: lessonUploading ? 0.5 : 1 }}
                        disabled={lessonUploading}
                        onPress={() => {
                          if (Platform.OS === "web") {
                            const input = document.createElement("input"); input.type = "file"; input.accept = "video/*,.mp4,.mov,.mkv";
                            input.onchange = async (e: any) => { const file = e.target.files?.[0]; if (!file) return;
                              setLessonUploading(true); setLessonUploadProgress(0);
                              try {
                                const blobUrl = URL.createObjectURL(file);
                                const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "video/mp4", "lectures", (pct) => setLessonUploadProgress(pct));
                                URL.revokeObjectURL(blobUrl);
                                setLessonVideoUrl(publicUrl); setLessonUploading(false); setLessonUploadProgress(0);
                              } catch (err: any) { setLessonUploading(false); setLessonUploadProgress(0); Alert.alert("Upload Failed", err?.message || "Could not upload video."); }
                            }; input.click();
                          } else { Alert.alert("Upload", "Use the URL field or upload from web."); }
                        }}>
                        {lessonUploading ? <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{lessonUploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{lessonUploading ? `Uploading... ${lessonUploadProgress}%` : "Upload Video from Device"}</Text>
                      </Pressable>
                    </View>

                    {/* Course Selection */}
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add to Course *</Text>
                      <ScrollView style={{ maxHeight: 160, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10 }} nestedScrollEnabled>
                        {courses.filter((c) => c.course_type !== "test_series").map((c) => (
                          <Pressable key={c.id} onPress={() => toggleLessonCourse(c.id)}
                            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: lessonSelectedCourses.includes(c.id) ? "#EEF2FF" : "#fff" }}>
                            <Ionicons name={lessonSelectedCourses.includes(c.id) ? "checkbox" : "square-outline"} size={20} color={lessonSelectedCourses.includes(c.id) ? Colors.light.primary : Colors.light.textMuted} />
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{c.title}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                      {lessonSelectedCourses.length > 0 && (
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary }}>{lessonSelectedCourses.length} course{lessonSelectedCourses.length > 1 ? "s" : ""} selected</Text>
                      )}
                    </View>

                    {/* Folder Selection per course */}
                    {lessonSelectedCourses.length > 0 && (
                      <View style={{ gap: 8 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add to Folder <Text style={{ fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>(optional)</Text></Text>
                        {lessonSelectedCourses.map(cId => {
                          const course = courses.find(c => c.id === cId);
                          const folders = lessonFoldersByCourse[cId] || [];
                          const isCreatingFolder = lessonNewFolderCourseId === cId;
                          return (
                            <View key={cId} style={{ gap: 4 }}>
                              {lessonSelectedCourses.length > 1 && (
                                <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{course?.title}</Text>
                              )}
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                <Pressable onPress={() => setLessonSelectedFolders(p => { const n = { ...p }; delete n[cId]; return n; })}
                                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: !lessonSelectedFolders[cId] ? Colors.light.primary : "#F3F4F6" }}>
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: !lessonSelectedFolders[cId] ? "#fff" : Colors.light.text }}>No Folder</Text>
                                </Pressable>
                                {folders.map((f: any) => (
                                  <Pressable key={f.id} onPress={() => setLessonSelectedFolders(p => ({ ...p, [cId]: f.name }))}
                                    style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: lessonSelectedFolders[cId] === f.name ? Colors.light.primary : "#F3F4F6" }}>
                                    <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: lessonSelectedFolders[cId] === f.name ? "#fff" : Colors.light.text }}>{f.name}</Text>
                                  </Pressable>
                                ))}
                                <Pressable onPress={() => { setLessonNewFolderCourseId(cId); setLessonNewFolderName(""); }}
                                  style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderStyle: "dashed", borderColor: Colors.light.primary }}>
                                  <Ionicons name="add" size={14} color={Colors.light.primary} />
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>New Folder</Text>
                                </Pressable>
                              </ScrollView>
                              {isCreatingFolder && (
                                <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                                  <TextInput
                                    style={[styles.formInput, { flex: 1, paddingVertical: 8, fontSize: 12 }]}
                                    placeholder="Folder name..."
                                    placeholderTextColor={Colors.light.textMuted}
                                    value={lessonNewFolderName}
                                    onChangeText={setLessonNewFolderName}
                                    autoFocus
                                  />
                                  <Pressable
                                    style={{ backgroundColor: lessonNewFolderName.trim() ? Colors.light.primary : Colors.light.border, borderRadius: 8, paddingHorizontal: 12, justifyContent: "center" }}
                                    disabled={!lessonNewFolderName.trim()}
                                    onPress={() => createFolderForCourse(cId, lessonNewFolderName)}>
                                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Create</Text>
                                  </Pressable>
                                  <Pressable style={{ justifyContent: "center", paddingHorizontal: 6 }} onPress={() => setLessonNewFolderCourseId(null)}>
                                    <Ionicons name="close" size={18} color={Colors.light.textMuted} />
                                  </Pressable>
                                </View>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}

                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Duration (HH:MM:SS)</Text>
                        <TextInput style={styles.formInput} placeholder="00:45:00" placeholderTextColor={Colors.light.textMuted} value={lessonDuration} onChangeText={(v) => {
                          // Auto-format as HH:MM:SS
                          const digits = v.replace(/\D/g, "").slice(0, 6);
                          let formatted = digits;
                          if (digits.length > 4) formatted = digits.slice(0, 2) + ":" + digits.slice(2, 4) + ":" + digits.slice(4);
                          else if (digits.length > 2) formatted = digits.slice(0, 2) + ":" + digits.slice(2);
                          setLessonDuration(formatted);
                        }} />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Order Index</Text>
                        <TextInput style={styles.formInput} placeholder="1" placeholderTextColor={Colors.light.textMuted} value={lessonOrderIndex} onChangeText={setLessonOrderIndex} keyboardType="numeric" />
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
                      <Switch value={lessonFreePreview} onValueChange={setLessonFreePreview} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Free Preview</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Visible to all students without enrollment</Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
                      <Switch value={lessonDownloadAllowed} onValueChange={setLessonDownloadAllowed} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Allow Download</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Students can download this lecture</Text>
                      </View>
                    </View>

                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 14, marginTop: 4, opacity: (!lessonTitle || !lessonVideoUrl || lessonSelectedCourses.length === 0 || lessonSubmitting) ? 0.5 : 1 }}
                      disabled={!lessonTitle || !lessonVideoUrl || lessonSelectedCourses.length === 0 || lessonSubmitting}
                      onPress={handleAddLessonClass}
                    >
                      {lessonSubmitting ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="add-circle" size={20} color="#fff" />
                          <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Add Lecture</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                ) : showScheduleLiveClass ? (
                  /* Schedule Live Class Form */
                  <View style={{ gap: 10 }}>
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Class Title *</Text>
                      <TextInput style={styles.formInput} placeholder="e.g., Trigonometry Revision" placeholderTextColor={Colors.light.textMuted} value={liveTitle} onChangeText={setLiveTitle} />
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add to Course *</Text>
                      <ScrollView style={{ maxHeight: 140, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10 }} nestedScrollEnabled>
                        {courses.filter(c => c.course_type !== "test_series").map((c) => (
                          <Pressable key={c.id} onPress={() => setLiveSelectedCourses(prev => {
                            if (prev.includes(c.id)) return prev.filter(id => id !== c.id);
                            if (c.course_type === "multi_subject") fetchLiveRecordingFolders(c.id, "live");
                            return [...prev, c.id];
                          })}
                            style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: liveSelectedCourses.includes(c.id) ? "#FEE2E2" : "#fff" }}>
                            <Ionicons name={liveSelectedCourses.includes(c.id) ? "checkbox" : "square-outline"} size={20} color={liveSelectedCourses.includes(c.id) ? "#DC2626" : Colors.light.textMuted} />
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{c.title}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                    {selectedMultiCourseIds(liveSelectedCourses).length > 0 && (
                      <View style={{ gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: Colors.light.border }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Multi-subject placement</Text>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>
                          Select subject, folder and optional subfolder before starting or scheduling.
                        </Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {MULTI_SUBJECTS.map((subject) => (
                            <Pressable
                              key={subject.key}
                              onPress={() => {
                                setLiveSubjectKey(subject.key);
                                setLiveLectureMain("");
                                setLiveLectureSubfolder("");
                              }}
                              style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: liveSubjectKey === subject.key ? Colors.light.primary : "#EEF2FF" }}
                            >
                              <SubjectIcon subject={subject} size={14} color={liveSubjectKey === subject.key ? "#fff" : Colors.light.primary} />
                              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: liveSubjectKey === subject.key ? "#fff" : Colors.light.primary }}>{subject.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                        {(() => {
                          const folders = selectedMultiCourseFolders(liveSelectedCourses, liveFoldersByCourse, liveSubjectKey);
                          const roots = folders.filter((folder: any) => !folder.parent_id);
                          const children = liveLectureMain ? directChildFolders(folders, liveLectureMain) : [];
                          return (
                            <>
                              <View style={{ gap: 6 }}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Folder</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                                  <Pressable onPress={() => { setLiveLectureMain(""); setLiveLectureSubfolder(""); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !liveLectureMain ? Colors.light.primary : "#E5E7EB" }}>
                                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !liveLectureMain ? "#fff" : Colors.light.text }}>Default</Text>
                                  </Pressable>
                                  {roots.map((folder: any) => {
                                    const name = folderFullName(folder);
                                    return (
                                      <Pressable key={folder.id || name} onPress={() => { setLiveLectureMain(name); setLiveLectureSubfolder(""); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: liveLectureMain === name ? Colors.light.primary : "#E5E7EB" }}>
                                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: liveLectureMain === name ? "#fff" : Colors.light.text }}>{folder.name || name}</Text>
                                      </Pressable>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                              {liveLectureMain ? (
                                <View style={{ gap: 6 }}>
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Subfolder</Text>
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                                    <Pressable onPress={() => setLiveLectureSubfolder("")} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !liveLectureSubfolder ? Colors.light.primary : "#E5E7EB" }}>
                                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !liveLectureSubfolder ? "#fff" : Colors.light.text }}>No Subfolder</Text>
                                    </Pressable>
                                    {children.map((folder: any) => {
                                      const fullName = folderFullName(folder);
                                      const localName = String(folder.name || fullName.replace(`${liveLectureMain} / `, ""));
                                      return (
                                        <Pressable key={folder.id || fullName} onPress={() => setLiveLectureSubfolder(localName)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: liveLectureSubfolder === localName ? Colors.light.primary : "#E5E7EB" }}>
                                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: liveLectureSubfolder === localName ? "#fff" : Colors.light.text }}>{localName}</Text>
                                        </Pressable>
                                      );
                                    })}
                                  </ScrollView>
                                </View>
                              ) : null}
                            </>
                          );
                        })()}
                      </View>
                    )}
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Recording section (optional)</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Main folder name — default is &quot;Live Class Recordings&quot; if left empty when saving.</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="Live Class Recordings"
                        placeholderTextColor={Colors.light.textMuted}
                        value={liveLectureMain}
                        onChangeText={setLiveLectureMain}
                      />
                    </View>
                    <View style={{ gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Subfolder (optional)</Text>
                      <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>e.g. chapter or topic — groups recordings with the same name under the section above.</Text>
                      <TextInput
                        style={styles.formInput}
                        placeholder="e.g. Chapter 1 — Algebra"
                        placeholderTextColor={Colors.light.textMuted}
                        value={liveLectureSubfolder}
                        onChangeText={setLiveLectureSubfolder}
                      />
                      <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }} numberOfLines={2}>
                        Saves as: {buildRecordingLectureSectionTitle(liveLectureMain, liveLectureSubfolder, null)}
                      </Text>
                    </View>
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>When</Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable onPress={() => setLiveIsNow(true)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: liveIsNow ? "#DC2626" : "#F3F4F6" }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: liveIsNow ? "#fff" : Colors.light.text }}>Live Now</Text>
                        </Pressable>
                        <Pressable onPress={() => setLiveIsNow(false)} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: !liveIsNow ? Colors.light.primary : "#F3F4F6" }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: !liveIsNow ? "#fff" : Colors.light.text }}>Schedule</Text>
                        </Pressable>
                      </View>
                    </View>
                    {!liveIsNow && (
                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Date *</Text>
                          <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.light.textMuted} value={liveScheduleDate} onChangeText={setLiveScheduleDate} />
                        </View>
                        <View style={{ flex: 1, gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Time *</Text>
                          <TextInput style={styles.formInput} placeholder="18:00" placeholderTextColor={Colors.light.textMuted} value={liveScheduleTime} onChangeText={setLiveScheduleTime} />
                        </View>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}>
                      <Switch value={liveFreePreview} onValueChange={setLiveFreePreview} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Free Preview (all students)</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 }}>
                      <Pressable onPress={() => setLiveNotifyEmail(!liveNotifyEmail)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: liveNotifyEmail ? Colors.light.primary : Colors.light.border, backgroundColor: liveNotifyEmail ? "#EEF2FF" : "#fff" }}>
                        <Ionicons name={liveNotifyEmail ? "checkbox" : "square-outline"} size={16} color={liveNotifyEmail ? Colors.light.primary : Colors.light.textMuted} />
                        <Ionicons name="mail" size={14} color={liveNotifyEmail ? Colors.light.primary : Colors.light.textMuted} />
                      </Pressable>
                      <Pressable onPress={() => setLiveNotifyBell(!liveNotifyBell)} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: liveNotifyBell ? "#F59E0B" : Colors.light.border, backgroundColor: liveNotifyBell ? "#FFFBEB" : "#fff" }}>
                        <Ionicons name={liveNotifyBell ? "checkbox" : "square-outline"} size={16} color={liveNotifyBell ? "#F59E0B" : Colors.light.textMuted} />
                        <Ionicons name="notifications" size={14} color={liveNotifyBell ? "#F59E0B" : Colors.light.textMuted} />
                      </Pressable>
                      <Pressable
                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: liveIsNow ? "#DC2626" : Colors.light.primary, borderRadius: 10, paddingVertical: 12, opacity: (!liveTitle || liveSelectedCourses.length === 0 || (!liveIsNow && !liveScheduleDate) || liveSubmitting) ? 0.5 : 1 }}
                        disabled={!liveTitle || liveSelectedCourses.length === 0 || (!liveIsNow && !liveScheduleDate) || liveSubmitting}
                        onPress={handleScheduleLiveClass}
                      >
                        {liveSubmitting ? <ActivityIndicator color="#fff" size="small" /> : (
                          <>
                            <Ionicons name={liveIsNow ? "radio" : "calendar"} size={16} color="#fff" />
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{liveIsNow ? "Start Live" : "Schedule Live"}</Text>
                          </>
                        )}
                      </Pressable>
                    </View>
                  </View>
                ) : showCreateClassChoice ? (
                  <View style={{ gap: 12 }}>
                    <Pressable
                      style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}08`, gap: 6 }}
                      onPress={() => {
                        setShowCreateClassChoice(false);
                        setShowAddLessonClass(true);
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="videocam" size={18} color={Colors.light.primary} />
                        </View>
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 }}>Add Lesson Class</Text>
                      </View>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginLeft: 46 }}>Recorded or pre-uploaded lesson</Text>
                    </Pressable>
                    <Pressable
                      style={{ padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: "#DC2626", backgroundColor: "#DC262608", gap: 6 }}
                      onPress={() => {
                        setShowCreateClassChoice(false);
                        setEditingLiveClass(null);
                        setLiveLectureMain("");
                        setLiveLectureSubfolder("");
                        setShowScheduleLiveClass(true);
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="radio" size={18} color="#DC2626" />
                        </View>
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 }}>Schedule Live Class</Text>
                      </View>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginLeft: 46 }}>Live YouTube stream at a scheduled time</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {(() => {
                      // Group by title + scheduled_at to merge multi-course schedules into one card
                      const groups: { key: string; title: string; scheduledAt: string; isLive: boolean; isRecordingMode: boolean; ids: number[]; courseNames: string[]; streamType?: string; lecture_section_title?: string | null; lecture_subfolder_title?: string | null; subject_key?: string | null }[] = [];
                      for (const lc of upcomingClasses) {
                        const key = `${lc.title}_${lc.scheduled_at}`;
                        const existing = groups.find(g => g.key === key);
                        if (existing) {
                          existing.ids.push(lc.id);
                          if (lc.course_title) existing.courseNames.push(lc.course_title);
                          if (lc.is_live) existing.isLive = true;
                          if (lc.stream_type) existing.streamType = lc.stream_type;
                          if (!existing.lecture_section_title && lc.lecture_section_title) existing.lecture_section_title = lc.lecture_section_title;
                          if (!existing.lecture_subfolder_title && lc.lecture_subfolder_title) existing.lecture_subfolder_title = lc.lecture_subfolder_title;
                          if (!existing.subject_key && lc.subject_key) existing.subject_key = lc.subject_key;
                        } else {
                          groups.push({ key, title: lc.title, scheduledAt: lc.scheduled_at, isLive: !!lc.is_live, isRecordingMode: !!lc.is_recording_mode, ids: [lc.id], courseNames: lc.course_title ? [lc.course_title] : [], streamType: lc.stream_type, lecture_section_title: lc.lecture_section_title || null, lecture_subfolder_title: lc.lecture_subfolder_title || null, subject_key: lc.subject_key || null });
                        }
                      }
                      if (groups.length === 0) {
                        return (
                          <View style={{ alignItems: "center", paddingVertical: 24, gap: 8 }}>
                            <Ionicons name="calendar-outline" size={40} color={Colors.light.textMuted} />
                            <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center" }}>No upcoming classes scheduled</Text>
                          </View>
                        );
                      }
                      const visible = showAllUpcoming ? groups : groups.slice(0, 4);
                      return (
                        <>
                          {visible.map((g) => {
                            const schedTime = g.scheduledAt ? new Date(parseInt(g.scheduledAt)).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
                            return (
                              <View key={g.key} style={{ backgroundColor: g.isLive ? "#FEF2F2" : g.isRecordingMode ? "#F5F3FF" : "#F8FAFC", borderRadius: 12, padding: 12, borderLeftWidth: 3, borderLeftColor: g.isLive ? "#DC2626" : g.isRecordingMode ? "#7C3AED" : Colors.light.primary, gap: 8 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                                  <View style={{ flex: 1, gap: 2 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                      {g.isLive && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" }} />}
                                      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.text }} numberOfLines={1}>{g.title}</Text>
                                    </View>
                                    <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{schedTime} · {g.ids.length} course{g.ids.length > 1 ? "s" : ""}</Text>
                                  </View>
                                  <Pressable onPress={() => setLiveActionSheet(g)} style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                                    <Ionicons name="ellipsis-vertical" size={16} color={Colors.light.textMuted} />
                                  </Pressable>
                                </View>
                                <View style={{ flexDirection: "row", gap: 6 }}>
                                  {!g.isLive ? (
                                    <Pressable
                                      style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: g.isRecordingMode ? "#7C3AED" : "#DC2626", borderRadius: 8, paddingVertical: 8 }}
                                      onPress={() => {
                                        router.push(`/admin/live/${g.ids[0]}/choose-stream` as any);
                                      }}>
                                      <Ionicons name={g.isRecordingMode ? "videocam" : "radio"} size={14} color="#fff" />
                                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>{g.isRecordingMode ? "Start Recording" : "Start Live"}</Text>
                                    </Pressable>
                                  ) : (
                                    <>
                                      <Pressable
                                        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#DC2626", borderRadius: 8, paddingVertical: 8 }}
                                        onPress={() => {
                                          router.push(
                                            (String(g.streamType || "").toLowerCase() === "classroom"
                                              ? `/admin/classroom/${g.ids[0]}`
                                              : `/admin/broadcast/${g.ids[0]}`) as any
                                          );
                                        }}>
                                        <Ionicons name="radio" size={14} color="#fff" />
                                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Enter Studio</Text>
                                      </Pressable>
                                      <Pressable
                                        style={{
                                          flexDirection: "row",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          gap: 6,
                                          backgroundColor: "#7F1D1D",
                                          borderRadius: 8,
                                          paddingVertical: 8,
                                          paddingHorizontal: 12,
                                          opacity: endingLiveGroupKey === g.key ? 0.6 : 1,
                                        }}
                                        disabled={endingLiveGroupKey === g.key}
                                        onPress={async () => {
                                          if (endingLiveGroupKey === g.key) return;
                                          const confirmed = Platform.OS === "web"
                                            ? window.confirm(g.isRecordingMode ? "End this recording?" : "End this live class?")
                                            : await new Promise<boolean>(resolve =>
                                                Alert.alert(g.isRecordingMode ? "End Recording" : "End Live Class", "Are you sure?", [
                                                  { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                                                  { text: "End Class", style: "destructive", onPress: () => resolve(true) },
                                                ])
                                              );
                                          if (!confirmed) return;
                                          try {
                                            setEndingLiveGroupKey(g.key);
                                            if ((g.streamType || "").toLowerCase() === "cloudflare") {
                                              await apiRequest("POST", `/api/admin/live-classes/${g.ids[0]}/stream/end`, {});
                                            } else {
                                              await apiRequest("PUT", `/api/admin/live-classes/${g.ids[0]}`, {
                                                isLive: false,
                                                isCompleted: true,
                                              });
                                            }
                                            await refetchUpcoming();
                                            qc.invalidateQueries({ queryKey: ["/api/upcoming-classes"] });
                                            qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
                                            qc.invalidateQueries({ queryKey: ["/api/courses"] });
                                          } catch (e) {
                                            if (Platform.OS === "web") window.alert("Failed to end class");
                                            else Alert.alert("Error", "Failed to end class");
                                          } finally {
                                            setEndingLiveGroupKey(null);
                                          }
                                        }}>
                                        <Ionicons name="stop-circle" size={14} color="#fff" />
                                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                                          {endingLiveGroupKey === g.key ? "Ending..." : (g.isRecordingMode ? "End Rec" : "End Live")}
                                        </Text>
                                      </Pressable>
                                    </>
                                  )}
                                </View>
                              </View>
                            );
                          })}
                          {groups.length > 4 && !showAllUpcoming && (
                            <Pressable onPress={() => setShowAllUpcoming(true)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 }}>
                              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>View All {groups.length} Classes</Text>
                              <Ionicons name="chevron-down" size={16} color={Colors.light.primary} />
                            </Pressable>
                          )}
                          {showAllUpcoming && groups.length > 4 && (
                            <Pressable onPress={() => setShowAllUpcoming(false)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10 }}>
                              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Show Less</Text>
                              <Ionicons name="chevron-up" size={16} color={Colors.light.primary} />
                            </Pressable>
                          )}
                        </>
                      );
                    })()}
                  </View>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
        )}

        {activeTab === "materials" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Free Study Materials ({freeMaterials.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#DC2626" }]} onPress={() => { setNewFolderNameInput(""); setNewFolderValidityMonths(""); setNewStandaloneFolderParentId(null); setShowCreateFolderModal("material"); }}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowAddFreeMaterial(true)}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.addBtnText}>Add Material</Text>
                </Pressable>
              </View>
            </View>
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 12 }}>These materials are free for all students (no enrollment required)</Text>
            {materialsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (() => {
              const renderMatCard = (mat: any) => (
                <View key={mat.id} style={styles.adminCard}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <Text style={styles.adminCardTitle} numberOfLines={2}>{mat.title}</Text>
                      <View style={{ backgroundColor: "#10B98120", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#10B981", textTransform: "uppercase" }}>{mat.file_type}</Text>
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      {mat.section_title && <Text style={styles.adminCardMetaText}>{mat.section_title} | </Text>}
                      <Text style={styles.adminCardMetaText}>{mat.download_allowed ? "Download ON" : "View only"}</Text>
                    </View>
                  </View>
                  <View style={styles.adminCardActions}>
                    {!!mat.file_url && (
                      <Pressable style={[styles.deleteBtn, { backgroundColor: "#ECFDF5", marginRight: 6 }]} onPress={() => void downloadAdminContent("material", mat.id, mat.title)}>
                        <Ionicons name="download-outline" size={18} color="#059669" />
                      </Pressable>
                    )}
                    <Pressable style={[styles.deleteBtn, { backgroundColor: "#EEF2FF", marginRight: 6 }]} onPress={() => setEditFreeMaterial({ ...mat, sectionTitle: mat.section_title || "", downloadAllowed: mat.download_allowed || false })}>
                      <Ionicons name="pencil-outline" size={18} color={Colors.light.primary} />
                    </Pressable>
                    <Pressable style={styles.deleteBtn} onPress={() => {
                      if (Platform.OS === "web") { if (window.confirm(`Delete "${mat.title}"?`)) deleteFreeMaterialMutation.mutate(mat.id); }
                      else Alert.alert("Delete", `Delete "${mat.title}"?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteFreeMaterialMutation.mutate(mat.id) }]);
                    }}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
              );
              const rootMaterialFolders = materialFolders.filter((f: any) => !f.parent_id);
              const folderNames = new Set(materialFolders.map(standaloneFolderFullName));
              const noFolder = freeMaterials.filter((m: any) => !m.section_title || !folderNames.has(m.section_title));
              return (
                <>
                  <SortableList
                    ids={rootMaterialFolders.map((f: any) => f.id)}
                    onReorder={(a, o) => reorderStandaloneByDrag("folder", rootMaterialFolders, a, o)}
                  >
                  {rootMaterialFolders.map((folder: any) => {
                    const folderPath = standaloneFolderFullName(folder);
                    const folderMats = freeMaterials.filter((m: any) => m.section_title === folderPath || String(m.section_title || "").startsWith(`${folderPath} /`));
                    return (
                      <SortableItem key={folder.id} id={folder.id}>
                      <View style={{ marginBottom: 8 }}>
                        <Pressable style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: folder.is_hidden ? "#F3F4F6" : "#FEE2E2", borderLeftWidth: 4, borderLeftColor: "#DC2626", padding: 14 }]}
                          onPress={() => setOpenFolderView({ folder, type: "material" })}>
                          <Ionicons name={folder.is_hidden ? "folder-outline" : "folder"} size={22} color={folder.is_hidden ? Colors.light.textMuted : "#DC2626"} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{standaloneFolderLocalName(folder)}{folder.is_hidden ? " (Hidden)" : ""}</Text>
                            <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{folderMats.length} file{folderMats.length !== 1 ? "s" : ""}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                          <Pressable style={{ padding: 6 }} onPress={(e) => { e.stopPropagation?.(); setStandaloneFolderActionSheet(folder); }}>
                            <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                          </Pressable>
                        </Pressable>
                      </View>
                      </SortableItem>
                    );
                  })}
                  </SortableList>
                  {freeMaterials.length === 0 && materialFolders.length === 0 && <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center", marginTop: 30 }}>No free materials yet</Text>}
                  <SortableList
                    ids={noFolder.map((m: any) => m.id)}
                    onReorder={(a, o) => reorderStandaloneByDrag("material", noFolder, a, o)}
                  >
                  {noFolder.map((mat: any) => (
                    <SortableItem key={mat.id} id={mat.id}>
                      {renderMatCard(mat)}
                    </SortableItem>
                  ))}
                  </SortableList>
                </>
              );
            })()}
          </View>
        )}

        {activeTab === "users" && (
          <View style={styles.section}>
            <View style={{ marginBottom: 16 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: colors.card,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: Colors.light.border,
                  paddingHorizontal: 12,
                  gap: 8,
                }}
              >
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  style={[styles.formInput, { flex: 1, marginBottom: 0, borderWidth: 0, backgroundColor: "transparent", paddingVertical: 10 }]}
                  placeholder="Search by name, phone, or email"
                  placeholderTextColor={Colors.light.textMuted}
                  value={userSearchInput}
                  onChangeText={setUserSearchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                />
                {Platform.OS !== "ios" && userSearchInput.length > 0 ? (
                  <Pressable onPress={() => setUserSearchInput("")} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
            </View>
            {usersLoading || (usersFetching && !isFetchingMoreUsers && userSearchActive) ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (
              (() => {
                const now = Date.now();
                const onlineThreshold = 5 * 60 * 1000;       // online = active in last 5 min
                const inactiveThreshold = 180 * 24 * 60 * 60 * 1000; // inactive = no activity for 180 days
                const inactiveUsers = users.filter(u =>
                  u.last_active_at && (now - Number(u.last_active_at)) >= inactiveThreshold
                );

                const renderUserCard = (u: UserRecord) => {
                  const isOnline = u.last_active_at && (now - Number(u.last_active_at)) < onlineThreshold;
                  return (
                    <View key={u.id} style={[styles.userCard, { backgroundColor: colors.card }]}>
                      <View style={{ position: "relative" }}>
                        <View style={[styles.userAvatar, { backgroundColor: u.role === "admin" ? Colors.light.accent : Colors.light.secondary }]}>
                          <Ionicons name={u.role === "admin" ? "shield" : "person"} size={18} color={u.role === "admin" ? "#fff" : Colors.light.primary} />
                        </View>
                        {isOnline && (
                          <View style={[styles.statusDot, { position: "absolute", top: -2, right: -2, width: 12, height: 12, backgroundColor: "#22C55E", borderWidth: 2, borderColor: "#fff" }]} />
                        )}
                      </View>
                      <View style={styles.userInfo}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text style={[styles.userName, { color: colors.text }, u.is_blocked && { color: colors.textMuted, textDecorationLine: "line-through" }]}>{u.name}</Text>
                          {isOnline && <View style={{ backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#16A34A" }}>ONLINE</Text></View>}
                        </View>
                        {u.phone && <Text style={[styles.userContact, { color: colors.textMuted }]}>+91 {u.phone}</Text>}
                        {u.email && <Text style={[styles.userContact, { color: colors.textMuted }]}>{u.email}</Text>}
                        {u.is_blocked && (
                          <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, alignSelf: "flex-start", marginTop: 2 }}>
                            <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626" }}>BLOCKED</Text>
                          </View>
                        )}
                      </View>
                      <View style={[styles.roleBadge, { backgroundColor: u.role === "admin" ? `${Colors.light.accent}20` : Colors.light.secondary }]}>
                        <Text style={[styles.roleText, { color: u.role === "admin" ? Colors.light.accent : Colors.light.primary }]}>{u.role}</Text>
                      </View>
                      {u.role !== "admin" && (
                        <Pressable
                          style={styles.menuBtn}
                          onPress={() => setUserActionUser(u)}
                        >
                          <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
                        </Pressable>
                      )}
                    </View>
                  );
                };

                return (
                  <>
                    {/* Header row: All Users count + Inactive count */}
                    <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
                      <View style={[styles.statCard, { flex: 1, backgroundColor: colors.card }]}>
                        <Text style={[styles.statLabel, { color: colors.textMuted }]}>All Users</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{allUsersLabelCount}</Text>
                      </View>
                      {!userSearchActive ? (
                        <View style={[styles.statCard, { flex: 1, backgroundColor: colors.card }]}>
                          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Inactive (180d+)</Text>
                          <Text style={[styles.statValue, { color: "#9CA3AF" }]}>{inactiveUsers.length}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Device mismatch / denied login — open dedicated screen */}
                    <View style={{ marginBottom: 18, padding: 14, backgroundColor: "#FFF7ED", borderRadius: 14, borderWidth: 1, borderColor: "#FDBA74" }}>
                      <Pressable
                        onPress={() => router.push("/admin/device-locks" as any)}
                        style={({ pressed }) => ({
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 10,
                          opacity: pressed ? 0.92 : 1,
                          ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : {}),
                        })}
                        accessibilityRole="button"
                      >
                        <Ionicons name="phone-portrait-outline" size={20} color="#C2410C" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#9A3412" }}>Blocked sign-in attempts (device lock)</Text>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#7C2D12", marginTop: 2 }}>
                            {deviceDeniedLoading
                              ? "Loading…"
                              : `${deviceDeniedUsers.length} student${deviceDeniedUsers.length === 1 ? "" : "s"} · ${deviceDeniedEventSum} event${deviceDeniedEventSum === 1 ? "" : "s"}`}
                            {" · "}
                            Tap to open list
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={22} color="#9A3412" />
                      </Pressable>
                    </View>

                    {/* Clean up unfinished signups (legacy placeholder rows older than 24h) */}
                    <View style={{ marginBottom: 18, padding: 14, backgroundColor: "#EFF6FF", borderRadius: 14, borderWidth: 1, borderColor: "#BFDBFE" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <Ionicons name="trash-outline" size={20} color="#1D4ED8" />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Inter_700Bold", fontSize: 15, color: "#1E3A8A" }}>Clean up unfinished signups</Text>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: "#1E40AF", marginTop: 2 }}>
                            Permanently delete student rows older than 24h that never finished profile-setup and have no enrollments / payments / activity.
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        disabled={cleanupPending}
                        onPress={() => {
                          const runCleanup = async () => {
                            setCleanupPending(true);
                            try {
                              const res = await apiRequest("POST", "/api/admin/users/cleanup-pending", {});
                              const data = await res.json();
                              const deleted = Number(data?.deleted || 0);
                              const failed = Array.isArray(data?.failed) ? data.failed.length : 0;
                              await qc.invalidateQueries({ queryKey: ["/api/admin/users"] });
                              await qc.refetchQueries({ queryKey: ["/api/admin/users"], type: "active" });
                              const msg = failed > 0
                                ? `Removed ${deleted} placeholder accounts. ${failed} could not be removed.`
                                : `Removed ${deleted} unfinished signup${deleted === 1 ? "" : "s"}.`;
                              if (Platform.OS === "web" && typeof window !== "undefined") window.alert(msg);
                              else Alert.alert("Cleanup complete", msg);
                            } catch (err: any) {
                              const msg = err?.message?.replace(/^\d+:\s*/, "") || "Cleanup failed";
                              if (Platform.OS === "web" && typeof window !== "undefined") window.alert(msg);
                              else Alert.alert("Failed", msg);
                            } finally {
                              setCleanupPending(false);
                            }
                          };
                          const confirmMsg = "This will permanently delete student rows that never completed profile setup AND have no enrollments / payments / activity AND are older than 24 hours. Continue?";
                          if (Platform.OS === "web" && typeof window !== "undefined") {
                            if (window.confirm(confirmMsg)) void runCleanup();
                          } else {
                            Alert.alert("Clean up unfinished signups?", confirmMsg, [
                              { text: "Cancel", style: "cancel" },
                              { text: "Delete", style: "destructive", onPress: () => void runCleanup() },
                            ]);
                          }
                        }}
                        style={({ pressed }) => ({
                          marginTop: 10,
                          alignSelf: "flex-start",
                          paddingHorizontal: 14,
                          paddingVertical: 9,
                          borderRadius: 10,
                          backgroundColor: cleanupPending ? "#93C5FD" : "#1D4ED8",
                          opacity: pressed ? 0.92 : 1,
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                        })}
                      >
                        {cleanupPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="trash" size={14} color="#fff" />}
                        <Text style={{ color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
                          {cleanupPending ? "Cleaning…" : "Run cleanup now"}
                        </Text>
                      </Pressable>
                    </View>

                    {/* All Users list */}
                    <Text style={[styles.sectionTitle, { marginBottom: 10 }]}>All Users ({allUsersLabelCount})</Text>
                    {users.length === 0 ? (
                      <Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center", marginTop: 20 }}>
                        {userSearchActive ? "No users match your search" : "No users yet"}
                      </Text>
                    ) : (
                      <>
                        {users.map(renderUserCard)}
                        {hasMoreUsers ? (
                          <Pressable
                            style={[styles.testActionBtn, { alignSelf: "center", marginTop: 12, paddingHorizontal: 20 }]}
                            onPress={() => fetchMoreUsers()}
                            disabled={isFetchingMoreUsers}
                          >
                            {isFetchingMoreUsers ? (
                              <ActivityIndicator size="small" color={Colors.light.primary} />
                            ) : (
                              <Text style={[styles.testActionBtnText, { color: Colors.light.primary }]}>Load more users</Text>
                            )}
                          </Pressable>
                        ) : null}
                      </>
                    )}

                    {/* Inactive Users section */}
                    {!userSearchActive && inactiveUsers.length > 0 && (
                      <>
                        <View style={{ height: 1, backgroundColor: Colors.light.border, marginVertical: 20 }} />
                        <Text style={[styles.sectionTitle, { marginBottom: 10, color: "#9CA3AF" }]}>Inactive Users — 180+ days ({inactiveUsers.length})</Text>
                        {inactiveUsers.map(renderUserCard)}
                      </>
                    )}
                  </>
                );
              })()
            )}
          </View>
        )}

        {activeTab === "notifications" && (
          <View style={styles.section}>
            {/* Edit Notification Modal */}
            <Modal visible={!!editNotifModal} animationType="fade" transparent onRequestClose={() => setEditNotifModal(null)}>
              <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 }} onPress={() => setEditNotifModal(null)}>
                <Pressable style={{ backgroundColor: Colors.light.background, borderRadius: 20, width: "100%", maxWidth: 500, maxHeight: "80%" }} onPress={() => {}}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 12 }}>
                    <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Edit Notification</Text>
                    <Pressable onPress={() => setEditNotifModal(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                  </View>
                  <ScrollView style={{ paddingHorizontal: 20 }} showsVerticalScrollIndicator={false}>
                    <Text style={styles.notifLabel}>Notification Title <Text style={{ fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>(optional if message or image)</Text></Text>
                    <TextInput style={styles.notifInput} placeholder="e.g., New Test Available!" placeholderTextColor={Colors.light.textMuted} value={editNotifTitle} onChangeText={setEditNotifTitle} />
                    <View style={{ height: 12 }} />
                    <Text style={styles.notifLabel}>Message <Text style={{ fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>(optional if title or image)</Text></Text>
                    <TextInput style={[styles.notifInput, styles.notifInputMulti]} placeholder="Enter your notification message..." placeholderTextColor={Colors.light.textMuted} value={editNotifMessage} onChangeText={setEditNotifMessage} multiline numberOfLines={4} />
                    <AdminR2ImagePicker
                      label="Notification Image (optional)"
                      value={editNotifImageUrl}
                      onChange={setEditNotifImageUrl}
                      variant="notification"
                      hint="Recommended: 1200 × 630 px. Upload to R2 or paste a public image / Google Drive link."
                    />
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <View style={{ backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="people" size={12} color={Colors.light.primary} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary }}>
                          {editNotifModal?.target === "all" ? "All Students" : editNotifModal?.target === "enrolled" ? "Enrolled Users" : editNotifModal?.course_title || "Course"} · {editNotifModal?.sent_count || 0} sent
                        </Text>
                      </View>
                      <View style={{ backgroundColor: "#F3F4F6", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="time-outline" size={12} color={Colors.light.textMuted} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
                          {editNotifModal?.created_at ? new Date(parseInt(editNotifModal.created_at)).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
                        </Text>
                      </View>
                    </View>
                    <View style={{ height: 16 }} />
                  </ScrollView>
                  <View style={{ padding: 20, paddingTop: 8 }}>
                    <Pressable
                      style={{ borderRadius: 12, overflow: "hidden", opacity: !editNotifHasContent ? 0.5 : 1 }}
                      disabled={!editNotifHasContent}
                      onPress={async () => {
                        if (!editNotifHasContent) return;
                        await apiRequest("PUT", `/api/admin/notifications/${editNotifModal.id}`, {
                          title: editNotifTitle,
                          message: editNotifMessage,
                          imageUrl: editNotifImageUrl.trim() || null,
                        });
                        setEditNotifModal(null);
                        refetchNotifHistory();
                      }}
                    >
                      <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 }}>
                        <Ionicons name="checkmark-circle" size={18} color="#fff" />
                        <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Save Changes</Text>
                      </LinearGradient>
                    </Pressable>
                  </View>
                </Pressable>
              </Pressable>
            </Modal>

            <View style={{ flexDirection: isWideSidebar ? "row" : "column", gap: isWideSidebar ? 20 : 16, alignItems: "stretch", width: "100%" }}>
              {/* Send Notification */}
              <View style={{ flex: isWideSidebar ? 3 : undefined, minWidth: 0, width: isAdminCompact ? "100%" : undefined }}>
                <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden" }}>
                  <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border }}>
                    <Text style={styles.sectionTitle}>Send Notification</Text>
                  </View>
                  <View style={[styles.notifCard, { borderWidth: 0, borderRadius: 0, margin: 0 }]}>
                  <Text style={styles.notifLabel}>Notification Title <Text style={{ fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>(optional if message or image)</Text></Text>
                  <TextInput
                    style={styles.notifInput}
                    placeholder="e.g., New Test Available!"
                    placeholderTextColor={Colors.light.textMuted}
                    value={notifTitle}
                    onChangeText={setNotifTitle}
                  />
                  <Text style={styles.notifLabel}>Message <Text style={{ fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>(optional if title or image)</Text></Text>
                  <TextInput
                    style={[styles.notifInput, styles.notifInputMulti]}
                    placeholder="Enter your notification message..."
                    placeholderTextColor={Colors.light.textMuted}
                    value={notifMessage}
                    onChangeText={setNotifMessage}
                    multiline
                    numberOfLines={4}
                  />
                  <AdminR2ImagePicker
                    label="Notification Image (optional)"
                    value={notifImageUrl}
                    onChange={setNotifImageUrl}
                    variant="notification"
                    hint="Recommended: 1200 × 630 px. Upload to R2 or paste a public image / Google Drive link."
                  />
                  <Text style={styles.notifLabel}>Send To</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {[
                      { key: "all", label: "All Students", icon: "people" },
                      { key: "enrolled", label: "Enrolled Users", icon: "school" },
                      { key: "course", label: "Specific Course", icon: "book" },
                    ].map((opt) => (
                      <Pressable
                        key={opt.key}
                        style={[styles.typeSelectBtn, notifTarget === opt.key && styles.typeSelectActive, { flexDirection: "row", alignItems: "center", gap: 6 }]}
                        onPress={() => { setNotifTarget(opt.key as any); setNotifCourseId(null); }}
                      >
                        <Ionicons name={opt.icon as any} size={14} color={notifTarget === opt.key ? "#fff" : Colors.light.text} />
                        <Text style={[styles.typeSelectText, notifTarget === opt.key && styles.typeSelectTextActive]}>{opt.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {notifTarget === "course" && (
                    <View style={{ marginBottom: 12 }}>
                      <Text style={styles.notifLabel}>Select Course</Text>
                      <ScrollView style={{ maxHeight: 180, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10 }} showsVerticalScrollIndicator>
                        {courses.map((c) => (
                          <Pressable
                            key={c.id}
                            style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: notifCourseId === c.id ? Colors.light.secondary : "#fff", flexDirection: "row", alignItems: "center", gap: 8 }}
                            onPress={() => setNotifCourseId(c.id)}
                          >
                            {notifCourseId === c.id && <Ionicons name="checkmark-circle" size={16} color={Colors.light.primary} />}
                            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }}>{c.title}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                  <Pressable
                    style={[styles.sendNotifBtn, (!notifHasContent || (notifTarget === "course" && !notifCourseId)) && styles.sendNotifBtnDisabled]}
                    onPress={() => {
                      if (!notifHasContent) return;
                      if (notifTarget === "course" && !notifCourseId) return;
                      const targetLabel = notifTarget === "all" ? "all students" : notifTarget === "enrolled" ? "all enrolled users" : "students in selected course";
                      const doSend = () => sendNotificationMutation.mutate({
                        title: notifTitle,
                        message: notifMessage,
                        target: notifTarget,
                        courseId: notifCourseId,
                        imageUrl: notifImageUrl.trim() || undefined,
                      });
                      if (Platform.OS === "web") {
                        if (window.confirm(`Send to ${targetLabel}?`)) doSend();
                      } else {
                        Alert.alert(`Send to ${targetLabel}?`, "This will send the notification now.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Send", onPress: doSend },
                        ]);
                      }
                    }}
                    disabled={!notifHasContent || (notifTarget === "course" && !notifCourseId) || sendNotificationMutation.isPending}
                  >
                    <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.sendNotifBtnGrad}>
                      {sendNotificationMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                        <>
                          <Ionicons name="send" size={18} color="#fff" />
                          <Text style={styles.sendNotifBtnText}>
                            {notifTarget === "all" ? "Send to All Students" : notifTarget === "enrolled" ? "Send to Enrolled Users" : "Send to Course Students"}
                          </Text>
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
              </View>

              {/* Past Notifications */}
              <View style={{ flex: isWideSidebar ? 1 : undefined, minWidth: 0, width: isAdminCompact ? "100%" : undefined }}>
                <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, flex: isWideSidebar ? 1 : undefined, overflow: isWideSidebar ? "hidden" : undefined }}>
                  {/* Header */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.light.border }}>
                    {showAllPastNotifs ? (
                      <>
                        <Pressable onPress={() => setShowAllPastNotifs(false)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Ionicons name="arrow-back" size={18} color={Colors.light.text} />
                          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>All Notifications</Text>
                        </Pressable>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>{notifHistory.length} total</Text>
                      </>
                    ) : (
                      <>
                        <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Past Notifications</Text>
                        {notifHistory.length > 0 && (
                          <View style={{ backgroundColor: Colors.light.secondary, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{notifHistory.length}</Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                  {/* Content */}
                  <ScrollView
                    style={isWideSidebar ? { flex: 1 } : undefined}
                    scrollEnabled={isWideSidebar}
                    nestedScrollEnabled={isWideSidebar}
                    contentContainerStyle={{ padding: 12, gap: 10 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {notifHistory.length === 0 ? (
                      <View style={{ alignItems: "center", paddingVertical: 32, gap: 8 }}>
                        <Ionicons name="notifications-off-outline" size={36} color={Colors.light.textMuted} />
                        <Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" }}>No notifications sent yet</Text>
                      </View>
                    ) : (
                      <>
                        {(showAllPastNotifs ? notifHistory : notifHistory.slice(0, 4)).map((n: any) => (
                          <Pressable key={n.id} style={{ backgroundColor: n.is_hidden ? "#F9FAFB" : "#fff", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: n.is_hidden ? "#E5E7EB" : Colors.light.border, opacity: n.is_hidden ? 0.6 : 1 }}
                            onPress={() => {
                              if (Platform.OS === "web") { openEditNotifModal(n); }
                              else Alert.alert(n.title, "Choose an action", [
                                { text: "Edit", onPress: () => { openEditNotifModal(n); } },
                                { text: n.is_hidden ? "Unhide" : "Hide", onPress: async () => { await apiRequest("PUT", `/api/admin/notifications/${n.id}/hide`, { hidden: !n.is_hidden }); refetchNotifHistory(); } },
                                { text: "Delete", style: "destructive", onPress: () => { apiRequest("DELETE", `/api/admin/notifications/${n.id}`).then(() => refetchNotifHistory()); } },
                                { text: "Cancel", style: "cancel" },
                              ]);
                            }}>
                            {n.image_url ? (
                              <View style={{ borderRadius: 8, overflow: "hidden", marginBottom: 8, borderWidth: 1, borderColor: Colors.light.border }}>
                                <NotificationImage uri={n.image_url} />
                              </View>
                            ) : null}
                            <View style={{ gap: 4 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{n.title}</Text>
                                {n.is_hidden && (
                                  <View style={{ backgroundColor: "#FEF3C7", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                                    <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>Hidden</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.text }} numberOfLines={2}>{n.message}</Text>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>
                                  {new Date(parseInt(n.created_at)).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                                </Text>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary }}>{n.sent_count} sent</Text>
                              </View>
                            </View>
                            {/* Web inline actions */}
                            {Platform.OS === "web" && (
                              <View style={{ flexDirection: "row", gap: 6, marginTop: 8, borderTopWidth: 1, borderTopColor: Colors.light.border, paddingTop: 8 }}>
                                <Pressable onPress={(e) => { e.stopPropagation(); openEditNotifModal(n); }}
                                  style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#EEF2FF" }}>
                                  <Ionicons name="pencil" size={11} color={Colors.light.primary} />
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Edit</Text>
                                </Pressable>
                                <Pressable onPress={async (e) => { e.stopPropagation(); await apiRequest("PUT", `/api/admin/notifications/${n.id}/hide`, { hidden: !n.is_hidden }); refetchNotifHistory(); }}
                                  style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: n.is_hidden ? "#DCFCE7" : "#FEF3C7" }}>
                                  <Ionicons name={n.is_hidden ? "eye" : "eye-off"} size={11} color={n.is_hidden ? "#16A34A" : "#D97706"} />
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: n.is_hidden ? "#16A34A" : "#D97706" }}>{n.is_hidden ? "Unhide" : "Hide"}</Text>
                                </Pressable>
                                <Pressable onPress={(e) => { e.stopPropagation(); if (window.confirm("Delete?")) { apiRequest("DELETE", `/api/admin/notifications/${n.id}`).then(() => refetchNotifHistory()); } }}
                                  style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: "#FEE2E2" }}>
                                  <Ionicons name="trash" size={11} color="#DC2626" />
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>Delete</Text>
                                </Pressable>
                              </View>
                            )}
                          </Pressable>
                        ))}
                        {!showAllPastNotifs && notifHistory.length > 4 && (
                          <Pressable onPress={() => setShowAllPastNotifs(true)}
                            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9" }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>View All {notifHistory.length} Notifications</Text>
                            <Ionicons name="chevron-forward" size={16} color={Colors.light.primary} />
                          </Pressable>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>
              </View>
            </View>
          </View>
        )}

        {activeTab === "books" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Books ({adminBooks.length})</Text>
              <Pressable style={styles.addBtn} onPress={() => setShowAddBook(true)}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addBtnText}>Add Book</Text>
              </Pressable>
            </View>
            {booksLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : adminBooks.length === 0 ? (
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                <Text style={styles.infoText}>No books yet. Add books for students to purchase.</Text>
              </View>
            ) : (
              adminBooks.map((book: any) => (
                <View key={book.id} style={[styles.adminCard, book.is_hidden && { opacity: 0.6, borderLeftWidth: 3, borderLeftColor: "#F59E0B" }]}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={styles.adminCardTitle} numberOfLines={2}>{book.title}</Text>
                        {book.is_hidden && (
                          <View style={{ backgroundColor: "#FEF3C7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>Hidden</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ backgroundColor: book.price === "0" || book.price === 0 ? "#DCFCE7" : "#EFF6FF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: book.price === "0" || book.price === 0 ? "#16A34A" : Colors.light.primary }}>
                          {book.price === "0" || book.price === 0 ? "FREE" : `₹${parseFloat(book.price).toFixed(0)}`}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      {book.author ? <Text style={styles.adminCardMetaText}>by {book.author}</Text> : null}
                      {book.author && <Text style={styles.adminCardMetaText}>|</Text>}
                      <Text style={styles.adminCardMetaText}>{book.is_published ? "Published" : "Draft"}</Text>
                    </View>
                  </View>
                  <View style={styles.adminCardActions}>
                    {/* Edit */}
                    <Pressable style={[styles.deleteBtn, { backgroundColor: "#EEF2FF", marginRight: 4 }]} onPress={() => {
                      setEditingBook(book);
                      setBookTitle(book.title || "");
                      setBookDesc(book.description || "");
                      setBookAuthor(book.author || "");
                      setBookPrice(String(book.price || "0"));
                      setBookOriginalPrice(String(book.original_price || "0"));
                      setBookCoverUrl(book.cover_url && !book.cover_url.startsWith("data:") ? book.cover_url : "");
                      setBookCoverBase64(book.cover_url?.startsWith("data:") ? book.cover_url : null);
                      setBookFileUrl(book.file_url && !book.file_url.startsWith("data:") ? book.file_url : "");
                      setBookFileBase64(book.file_url?.startsWith("data:") ? book.file_url : null);
                      setBookFileName(null);
                    }}>
                      <Ionicons name="pencil" size={16} color={Colors.light.primary} />
                    </Pressable>
                    {/* Hide/Unhide */}
                    <Pressable style={[styles.deleteBtn, { backgroundColor: book.is_hidden ? "#FEF3C7" : "#F3F4F6", marginRight: 4 }]}
                      onPress={async () => {
                        await apiRequest("PUT", `/api/admin/books/${book.id}/hide`, { hidden: !book.is_hidden });
                        qc.invalidateQueries({ queryKey: ["/api/admin/books"] });
                      }}>
                      <Ionicons name={book.is_hidden ? "eye" : "eye-off-outline"} size={16} color={book.is_hidden ? "#D97706" : Colors.light.textMuted} />
                    </Pressable>
                    {/* Delete */}
                    <Pressable style={styles.deleteBtn} onPress={() => {
                      if (Platform.OS === "web") {
                        if (window.confirm(`Delete "${book.title}"?`)) deleteBookMutation.mutate(book.id);
                      } else {
                        Alert.alert("Delete", `Delete "${book.title}"?`, [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteBookMutation.mutate(book.id) },
                        ]);
                      }
                    }}>
                      <Ionicons name="trash-outline" size={18} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === "tests" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>All Tests ({adminTests.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#059669" }]} onPress={() => {
                  setNewCourse(defaultNewCourse("test_series"));
                  setShowAddCourse(true);
                }}>
                  <Ionicons name="albums" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Test Series</Text>
                </Pressable>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => { setNewFolderNameInput(""); setNewFolderValidityMonths(""); setNewStandaloneFolderParentId(null); setShowCreateFolderModal("test"); }}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowCreateTest(true)}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.addBtnText}>Create Test</Text>
                </Pressable>
              </View>
            </View>
            {/* Test Series Courses */}
            {(() => {
              const tsCourses = courses.filter((c: any) => c.course_type === "test_series");
              if (tsCourses.length === 0) return null;
              return (
                <View style={{ marginBottom: 12, gap: 8 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 8 }}>Test Series Courses</Text>
                  {tsCourses.map((course: any) => (
                    <Pressable key={course.id} style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF7ED", borderLeftWidth: 4, borderLeftColor: "#F59E0B", padding: 14 }]}
                      onPress={() => router.push({ pathname: "/admin/course/[id]", params: { id: course.id } })}>
                      <Ionicons name="clipboard-outline" size={22} color="#F59E0B" />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text }} numberOfLines={1}>{course.title}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                          {course.category && <View style={{ backgroundColor: "#EEF2FF", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{course.category}</Text></View>}
                          <View style={{ backgroundColor: course.is_free ? "#DCFCE7" : "#FEF3C7", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: course.is_free ? "#16A34A" : "#D97706" }}>{course.is_free ? "FREE" : `₹${parseFloat(course.price || "0").toFixed(0)}`}</Text></View>
                          {!!course.validity_months && <View style={{ backgroundColor: "#EDE9FE", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#6D28D9" }}>{course.validity_months}m validity</Text></View>}
                          <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{course.total_tests || 0} tests</Text>
                          {!course.is_published && <View style={{ backgroundColor: "#FEF3C7", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}><Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#D97706" }}>UNPUBLISHED</Text></View>}
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                      <Pressable style={styles.deleteBtn} onPress={(e) => {
                        e.stopPropagation?.();
                        const doDelete = () => deleteCourseMutation.mutate(course.id);
                        if (Platform.OS === "web") { if (window.confirm(`Delete "${course.title}" and all its tests?`)) doDelete(); }
                        else Alert.alert("Delete Course", `Delete "${course.title}" and all its tests?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
                      }}>
                        <Ionicons name="trash-outline" size={18} color="#EF4444" />
                      </Pressable>
                    </Pressable>
                  ))}
                </View>
              );
            })()}
            {testsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (() => {
              const renderTestCard = (test: any) => (
                <Pressable key={test.id} style={styles.adminCard} onPress={() => openAdminTestAttempts(test)}>
                  <View style={styles.adminCardContent}>
                    <View style={styles.adminCardRow}>
                      <Text style={styles.adminCardTitle} numberOfLines={2}>{test.title}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <AdminExportDownloadButton kind="test" id={test.id} filename={`${test.title}.pdf`} stopPropagation size={14} />
                        <Pressable style={[styles.testActionBtn, { backgroundColor: "#EEF2FF" }]} onPress={(e) => { e.stopPropagation?.(); setEditAdminTest({ ...test, durationMinutes: String(test.duration_minutes), totalMarks: String(test.total_marks), passingMarks: String(test.passing_marks || 35), ts_course_id: tsCourses.some((c: any) => c.id === test.course_id) ? test.course_id : null }); }}>
                          <Ionicons name="pencil-outline" size={14} color={Colors.light.primary} />
                          <Text style={[styles.testActionBtnText, { color: Colors.light.primary }]}>Edit Test</Text>
                        </Pressable>
                        <View style={[styles.typeBadge, { backgroundColor: "#1A56DB15" }]}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{test.test_type}</Text>
                        </View>
                      </View>
                    </View>
                    <View style={styles.adminCardMeta}>
                      <Text style={styles.adminCardMetaText}>{test.total_questions || 0} Q · {test.duration_minutes}min · {test.total_marks} marks</Text>
                      {test.course_title && <Text style={[styles.adminCardMetaText, { color: Colors.light.primary }]}> · {test.course_title}</Text>}
                    </View>
                    <View style={styles.testActionRow}>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#ECFDF5" }]} onPress={(e) => { e.stopPropagation?.(); void downloadAdminContent("test", test.id, `${test.title}.pdf`); }}>
                        <Ionicons name="download-outline" size={14} color="#059669" />
                        <Text style={[styles.testActionBtnText, { color: "#059669" }]}>Download PDF</Text>
                      </Pressable>
                      <Pressable style={styles.testActionBtn} onPress={(e) => { e.stopPropagation?.(); setShowTestQuestions(test.id); setShowAddQ(true); setShowBulkQ(false); setShowViewQuestions(false); setBulkQResult(null); setBulkQText(""); }}>
                        <Ionicons name="create-outline" size={14} color={Colors.light.primary} />
                        <Text style={styles.testActionBtnText}>Add Questions</Text>
                      </Pressable>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#FFF3E0" }]} onPress={(e) => { e.stopPropagation?.(); setShowBulkUploadModal(test.id); }}>
                        <Ionicons name="cloud-upload" size={14} color="#FF6B35" />
                        <Text style={[styles.testActionBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                      </Pressable>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#DCFCE7" }]} onPress={(e) => { e.stopPropagation?.(); setShowTestQuestions(test.id); setShowViewQuestions(true); setShowAddQ(false); setShowBulkQ(false); loadTestQuestions(test.id); }}>
                        <Ionicons name="list" size={14} color="#16A34A" />
                        <Text style={[styles.testActionBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                      </Pressable>
                      <Pressable style={[styles.testActionBtn, { backgroundColor: "#FEE2E2" }]} onPress={(e) => {
                        e.stopPropagation?.();
                        if (Platform.OS === "web") { if (window.confirm(`Delete "${test.title}" and all its questions?`)) deleteTestMutation.mutate(test.id); }
                        else Alert.alert("Delete Test", `Delete "${test.title}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) }]);
                      }}>
                        <Ionicons name="trash-outline" size={14} color="#EF4444" />
                      </Pressable>
                    </View>
                  </View>
                </Pressable>
              );
              const rootTestFolders = testFolders.filter((f: any) => !f.parent_id);
              const folderNames = new Set(testFolders.map(standaloneFolderFullName));
              const noFolder = adminTests.filter((t: any) => !t.folder_name || !folderNames.has(t.folder_name));
              return (
                <>
                  <SortableList
                    ids={rootTestFolders.map((f: any) => f.id)}
                    onReorder={(a, o) => reorderStandaloneByDrag("folder", rootTestFolders, a, o)}
                  >
                  {rootTestFolders.map((folder: any) => {
                    const folderPath = standaloneFolderFullName(folder);
                    const folderTests = adminTests.filter((t: any) => t.folder_name === folderPath || String(t.folder_name || "").startsWith(`${folderPath} /`));
                    return (
                      <SortableItem key={folder.id} id={folder.id}>
                      <View style={{ marginBottom: 8 }}>
                        <Pressable style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: folder.is_hidden ? "#F3F4F6" : "#EEF2FF", borderLeftWidth: 4, borderLeftColor: Colors.light.primary, padding: 14 }]}
                          onPress={() => setOpenFolderView({ folder, type: "test" })}>
                          <Ionicons name={folder.is_hidden ? "folder-outline" : "folder"} size={22} color={folder.is_hidden ? Colors.light.textMuted : Colors.light.primary} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{standaloneFolderLocalName(folder)}{folder.is_hidden ? " (Hidden)" : ""}</Text>
                            <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{folderTests.length} test{folderTests.length !== 1 ? "s" : ""}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                          <Pressable style={{ padding: 6 }} onPress={(e) => { e.stopPropagation?.(); setStandaloneFolderActionSheet(folder); }}>
                            <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                          </Pressable>
                        </Pressable>
                      </View>
                      </SortableItem>
                    );
                  })}
                  </SortableList>
                  {adminTests.length === 0 && testFolders.length === 0 && <View style={styles.infoCard}><Ionicons name="document-text-outline" size={20} color={Colors.light.primary} /><Text style={styles.infoText}>No tests yet.</Text></View>}
                  <SortableList
                    ids={noFolder.map((t: any) => t.id)}
                    onReorder={(a, o) => reorderStandaloneByDrag("test", noFolder, a, o)}
                  >
                  {noFolder.map((test: any) => (
                    <SortableItem key={test.id} id={test.id}>
                      {renderTestCard(test)}
                    </SortableItem>
                  ))}
                  </SortableList>
                </>
              );
            })()}
          </View>
        )}

        {activeTab === "analytics" && (
          <Suspense fallback={<ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />}>
            <AnalyticsTab />
          </Suspense>
        )}

        {activeTab === "staffAccess" && (
          <Suspense fallback={<ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />}>
            <StaffAccessTab />
          </Suspense>
        )}

        {activeTab === "aiTutor" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>AI Tutor Doubts ({adminDoubtData.total || 0})</Text>
            </View>

            <View style={isAdminCompact ? [styles.adminCompactCard, { backgroundColor: colors.card, borderColor: colors.border }] : [styles.adminCard, { marginBottom: 14, gap: 10 }]}>
              <Text style={[styles.adminCardTitle, isAdminCompact && { flex: undefined }]}>Filters</Text>
              <View style={styles.adminCompactChipRow}>
                {[
                  { key: "all", label: "All Time" },
                  { key: "7", label: "Last 7 Days" },
                  { key: "30", label: "Last 30 Days" },
                ].map((o) => (
                  <Pressable
                    key={o.key}
                    style={[styles.typeSelectBtn, aiDoubtDays === (o.key as any) && styles.typeSelectActive]}
                    onPress={() => setAiDoubtDays(o.key as any)}
                  >
                    <Text style={[styles.typeSelectText, aiDoubtDays === (o.key as any) && styles.typeSelectTextActive]}>{o.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.adminCompactChipRow}>
                <Pressable
                  style={[styles.typeSelectBtn, aiDoubtTopic === "all" && styles.typeSelectActive]}
                  onPress={() => setAiDoubtTopic("all")}
                >
                  <Text style={[styles.typeSelectText, aiDoubtTopic === "all" && styles.typeSelectTextActive]}>All Topics</Text>
                </Pressable>
                {(adminDoubtData.topTopics || []).map((t) => (
                  <Pressable
                    key={t.topic}
                    style={[styles.typeSelectBtn, aiDoubtTopic === t.topic && styles.typeSelectActive]}
                    onPress={() => setAiDoubtTopic(t.topic)}
                  >
                    <Text style={[styles.typeSelectText, aiDoubtTopic === t.topic && styles.typeSelectTextActive]}>
                      {t.topic}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={[styles.formInput, isAdminCompact && { width: "100%" }]}
                placeholder="Search student name/phone/email or question..."
                placeholderTextColor={Colors.light.textMuted}
                value={aiDoubtStudent}
                onChangeText={setAiDoubtStudent}
              />
              <Pressable
                disabled={clearAdminDoubtsMutation.isPending}
                style={{
                  marginTop: 2,
                  backgroundColor: "#EF4444",
                  borderRadius: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  opacity: clearAdminDoubtsMutation.isPending ? 0.7 : 1,
                  alignSelf: isAdminCompact ? "stretch" : undefined,
                }}
                onPress={() => {
                  const run = () => clearAdminDoubtsMutation.mutate();
                  if (Platform.OS === "web") {
                    if (window.confirm("Are you sure you want to delete all AI Tutor questions for all students? This action cannot be undone.")) run();
                    return;
                  }
                  Alert.alert("Clear All AI Tutor Questions?", "Are you sure you want to delete all AI Tutor questions for all students? This action cannot be undone.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete All", style: "destructive", onPress: run },
                  ]);
                }}
              >
                {clearAdminDoubtsMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={14} color="#fff" />
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                      Clear All Questions
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {adminDoubtsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : (
              <>
                <View style={isAdminCompact ? [styles.adminCompactCard, { backgroundColor: colors.card, borderColor: colors.border }] : [styles.adminCard, { marginBottom: 14 }]}>
                  <Text style={[styles.adminCardTitle, { marginBottom: 8 }, isAdminCompact && { flex: undefined }]}>Frequently Asked Topics</Text>
                  {(adminDoubtData.topTopics || []).length === 0 ? (
                    <Text style={styles.adminCardMetaText}>No topic data yet.</Text>
                  ) : (
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {adminDoubtData.topTopics.map((t) => (
                        <View key={t.topic} style={{ backgroundColor: "#EEF2FF", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: "#C7D2FE" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>
                            {t.topic} ({t.count})
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={isAdminCompact ? [styles.adminCompactCard, { backgroundColor: colors.card, borderColor: colors.border }] : [styles.adminCard, { marginBottom: 14 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, width: "100%" }}>
                    <Text style={[styles.adminCardTitle, isAdminCompact && { flex: undefined }]}>Student History</Text>
                    <Text style={styles.adminCardMetaText}>{adminDoubtStudentsData.total} students</Text>
                  </View>
                  {adminDoubtStudentsData.rows.length === 0 ? (
                    <Text style={styles.adminCardMetaText}>No student doubt history found.</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {adminDoubtStudentsData.rows.map((s) => (
                        <Pressable key={`student-h-${s.user_id}`} onPress={() => { setAiSelectedStudent(s); setAiStudentHistoryOffset(0); }}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>
                              {s.user_name || s.user_phone || s.user_email || "Student"}
                            </Text>
                            <Text style={styles.adminCardMetaText}>
                              Last asked: {s.last_asked_at ? new Date(Number(s.last_asked_at)).toLocaleString("en-IN") : "—"}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{s.doubt_count}</Text>
                            <Text style={styles.adminCardMetaText}>questions</Text>
                          </View>
                        </Pressable>
                      ))}
                      {(aiStudentsOffset + aiStudentsLimit) < Number(adminDoubtStudentsData.total || 0) && (
                        <Pressable style={styles.typeSelectBtn} onPress={() => setAiStudentsOffset((p) => p + aiStudentsLimit)}>
                          <Text style={styles.typeSelectText}>View More Students</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>

                <View style={isAdminCompact ? [styles.adminCompactCard, { backgroundColor: colors.card, borderColor: colors.border }] : [styles.adminCard, { marginBottom: 14 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, width: "100%" }}>
                    <Text style={[styles.adminCardTitle, isAdminCompact && { flex: undefined }]}>Frequently Asked Questions</Text>
                    <Text style={styles.adminCardMetaText}>{adminFrequentPatternsData.total} patterns</Text>
                  </View>
                  {adminFrequentPatternsData.rows.length === 0 ? (
                    <Text style={styles.adminCardMetaText}>No repeated patterns yet.</Text>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {adminFrequentPatternsData.rows.map((p, idx) => (
                        <Pressable key={`freq-${idx}-${p.questionPattern}`} onPress={() => { setAiSelectedPattern(p); setAiPatternStudentsOffset(0); }}
                          style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                            {p.sampleQuestion}
                          </Text>
                          <Text style={[styles.adminCardMetaText, { marginTop: 4 }]}>
                            repeated {p.count} times · tap to view students
                          </Text>
                        </Pressable>
                      ))}
                      {(aiFrequentOffset + aiFrequentLimit) < Number(adminFrequentPatternsData.total || 0) && (
                        <Pressable style={styles.typeSelectBtn} onPress={() => setAiFrequentOffset((p) => p + aiFrequentLimit)}>
                          <Text style={styles.typeSelectText}>View More Questions</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              </>
            )}
          </View>
        )}

        <Modal visible={activeTab === "aiTutor" && !!aiSelectedStudent} animationType="slide" transparent onRequestClose={() => setAiSelectedStudent(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: "86%" }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Student Question History</Text>
                  <Text style={styles.adminCardMetaText}>
                    {aiSelectedStudent?.user_name || aiSelectedStudent?.user_phone || aiSelectedStudent?.user_email || "Student"}
                  </Text>
                </View>
                <Pressable onPress={() => setAiSelectedStudent(null)}>
                  <Ionicons name="close" size={24} color={Colors.light.text} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {(aiSelectedStudentHistory.rows || []).length === 0 ? (
                  <Text style={styles.adminCardMetaText}>No doubts found for this student.</Text>
                ) : (
                  (aiSelectedStudentHistory.rows || []).map((d: any) => (
                    <View key={`history-${d.id}`} style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10, gap: 5, marginBottom: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <View style={styles.typeBadge}>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{d.topic || "General"}</Text>
                        </View>
                        <Text style={styles.adminCardMetaText}>{d.created_at ? new Date(Number(d.created_at)).toLocaleString("en-IN") : ""}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Q: {d.question}</Text>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, lineHeight: 20 }}>A: {d.answer}</Text>
                    </View>
                  ))
                )}
                {(aiStudentHistoryOffset + aiStudentHistoryLimit) < Number(aiSelectedStudentHistory.total || 0) && (
                  <Pressable style={styles.typeSelectBtn} onPress={() => setAiStudentHistoryOffset((p) => p + aiStudentHistoryLimit)}>
                    <Text style={styles.typeSelectText}>View More</Text>
                  </Pressable>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal visible={activeTab === "aiTutor" && !!aiSelectedPattern} animationType="slide" transparent onRequestClose={() => setAiSelectedPattern(null)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: "86%" }]}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Students Who Asked This</Text>
                  <Text style={styles.adminCardMetaText} numberOfLines={2}>{aiSelectedPattern?.sampleQuestion || ""}</Text>
                </View>
                <Pressable onPress={() => setAiSelectedPattern(null)}>
                  <Ionicons name="close" size={24} color={Colors.light.text} />
                </Pressable>
              </View>
              <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                {(aiSelectedPatternStudents.rows || []).length === 0 ? (
                  <Text style={styles.adminCardMetaText}>No students found for this question pattern.</Text>
                ) : (
                  (aiSelectedPatternStudents.rows || []).map((s: any) => (
                    <Pressable key={`pattern-student-${s.user_id}`} onPress={() => { setAiSelectedPattern(null); setAiSelectedStudent(s); setAiStudentHistoryOffset(0); }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 10, padding: 10, marginBottom: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>
                          {s.user_name || s.user_phone || s.user_email || "Student"}
                        </Text>
                        <Text style={styles.adminCardMetaText}>
                          Last asked: {s.last_asked_at ? new Date(Number(s.last_asked_at)).toLocaleString("en-IN") : "—"}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{s.doubt_count}</Text>
                        <Text style={styles.adminCardMetaText}>questions</Text>
                      </View>
                    </Pressable>
                  ))
                )}
                {(aiPatternStudentsOffset + aiPatternStudentsLimit) < Number(aiSelectedPatternStudents.total || 0) && (
                  <Pressable style={styles.typeSelectBtn} onPress={() => setAiPatternStudentsOffset((p) => p + aiPatternStudentsLimit)}>
                    <Text style={styles.typeSelectText}>View More</Text>
                  </Pressable>
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {activeTab === "support" && (
          <View style={styles.section}>
            {/* Conversations list */}
            <Text style={styles.sectionTitle}>Support Conversations</Text>
            {supportLoading ? (
              <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : supportConvos.length === 0 ? (
              <View style={styles.infoCard}>
                <Ionicons name="chatbubbles-outline" size={20} color={Colors.light.primary} />
                <Text style={styles.infoText}>No support messages yet.</Text>
              </View>
            ) : supportConvos.map((convo: any) => (
              <Pressable
                key={convo.user_id}
                style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                onPress={() => loadSupportThread(convo.user_id, convo.name || convo.phone || "Student")}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{(convo.name || "S")[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{convo.name || convo.phone || "Student"}</Text>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }} numberOfLines={1}>{convo.last_message || ""}</Text>
                </View>
                {parseInt(convo.unread_count) > 0 && (
                  <View style={{ backgroundColor: "#EF4444", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{convo.unread_count}</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Support Thread — full-screen modal so input stays pinned at bottom */}
        <Modal visible={activeTab === "support" && !!supportUserId} animationType="slide" onRequestClose={() => { setSupportUserId(null); setSupportMessages([]); }}>
          <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.light.background }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            {/* Header */}
            <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => { setSupportUserId(null); setSupportMessages([]); setSupportReply(""); }}>
                <Ionicons name="arrow-back" size={20} color="#fff" />
              </Pressable>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>{(supportUserName || "S")[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{supportUserName}</Text>
                <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>Student</Text>
              </View>
            </LinearGradient>
            {/* Messages */}
            {supportMsgLoading ? (
              <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
            ) : (
              <ScrollView
                ref={supportScrollRef}
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 16, gap: 4 }}
                showsVerticalScrollIndicator={false}
                onContentSizeChange={() => supportScrollRef.current?.scrollToEnd({ animated: false })}
              >
                {supportMessages.length === 0 && (
                  <Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", paddingVertical: 40 }}>No messages yet</Text>
                )}
                {supportMessages.map((msg: any) => {
                  const isAdminMsg = msg.sender === "admin";
                  const ts = typeof msg.created_at === "string" ? parseInt(msg.created_at) : msg.created_at;
                  const time = ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <View key={msg.id} style={{ marginBottom: 8, alignItems: isAdminMsg ? "flex-end" : "flex-start" }}>
                      <View style={{ maxWidth: "80%", backgroundColor: isAdminMsg ? Colors.light.primary : "#fff", borderRadius: 16, padding: 10, borderBottomRightRadius: isAdminMsg ? 2 : 16, borderBottomLeftRadius: isAdminMsg ? 16 : 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 }}>
                        {!isAdminMsg && <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary, marginBottom: 2 }}>{supportUserName}</Text>}
                        <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: isAdminMsg ? "#fff" : Colors.light.text, lineHeight: 20 }}>{msg.message}</Text>
                        <Text style={{ fontSize: 10, color: isAdminMsg ? "rgba(255,255,255,0.6)" : Colors.light.textMuted, marginTop: 3, textAlign: "right" }}>{time}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            )}
            {/* Input — pinned at bottom */}
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 10, paddingBottom: bottomPadding + 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border }}>
              <TextInput
                style={{ flex: 1, backgroundColor: Colors.light.secondary, borderRadius: 20, borderWidth: 1, borderColor: Colors.light.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, maxHeight: 100 }}
                placeholder="Type your reply..."
                placeholderTextColor={Colors.light.textMuted}
                value={supportReply}
                onChangeText={setSupportReply}
                multiline
              />
              <Pressable
                style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center", opacity: !supportReply.trim() || supportReplying ? 0.4 : 1 }}
                onPress={sendSupportReply}
                disabled={!supportReply.trim() || supportReplying}
              >
                {supportReplying ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {activeTab === "missions" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Daily Missions ({adminMissions.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#0F766E" }]} onPress={() => { setNewFolderNameInput(""); setNewStandaloneFolderParentId(null); setShowCreateFolderModal("mission"); }}>
                  <Ionicons name="folder-open-outline" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowAddMission(true)}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.addBtnText}>Add Mission</Text>
                </Pressable>
              </View>
            </View>
            {missionsLoading ? (
              <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 20 }} />
            ) : adminMissions.length === 0 ? (
              <View style={styles.infoCard}>
                <Ionicons name="flame-outline" size={20} color={Colors.light.primary} />
                <Text style={styles.infoText}>No missions yet. Create daily drill or free practice missions with questions for students.</Text>
              </View>
            ) : (
              (() => {
                const rootMissionFolders = missionFolders.filter((f: any) => !f.parent_id);
                const folderNames = new Set(missionFolders.map(standaloneFolderFullName));
                const noFolder = adminMissions.filter((m: any) => !m.folder_name || !folderNames.has(m.folder_name));
                return (
                  <>
                    <SortableList
                      ids={rootMissionFolders.map((f: any) => f.id)}
                      onReorder={(a, o) => reorderStandaloneByDrag("folder", rootMissionFolders, a, o)}
                    >
                    {rootMissionFolders.map((folder: any) => {
                      const folderPath = standaloneFolderFullName(folder);
                      const folderMissions = adminMissions.filter((m: any) => m.folder_name === folderPath || String(m.folder_name || "").startsWith(`${folderPath} /`));
                      return (
                        <SortableItem key={folder.id} id={folder.id}>
                        <View style={{ marginBottom: 8 }}>
                          <Pressable
                            style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: folder.is_hidden ? "#F3F4F6" : "#ECFDF5", borderLeftWidth: 4, borderLeftColor: "#0F766E", padding: 14 }]}
                            onPress={() => setOpenFolderView({ folder, type: "mission" })}
                          >
                            <Ionicons name={folder.is_hidden ? "folder-outline" : "folder"} size={22} color={folder.is_hidden ? Colors.light.textMuted : "#0F766E"} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{standaloneFolderLocalName(folder)}{folder.is_hidden ? " (Hidden)" : ""}</Text>
                              <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{folderMissions.length} mission{folderMissions.length !== 1 ? "s" : ""}</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                            <Pressable style={{ padding: 6 }} onPress={(e) => { e.stopPropagation?.(); setStandaloneFolderActionSheet(folder); }}>
                              <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                            </Pressable>
                          </Pressable>
                        </View>
                        </SortableItem>
                      );
                    })}
                    </SortableList>
                    {adminMissions.length === 0 && missionFolders.length === 0 && <View style={styles.infoCard}><Ionicons name="flame-outline" size={20} color={Colors.light.primary} /><Text style={styles.infoText}>No missions yet.</Text></View>}
                    {noFolder.map(renderAdminMissionCard)}
                  </>
                );
              })()
            )}
          </View>
        )}

        {activeTab === "welcome" && (
          <Suspense fallback={<ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />}>
            <WelcomeSettingsTab />
          </Suspense>
        )}
      </>
      )}
      </ScrollView>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Upload progress overlay — shown when any file is uploading */}
      {lessonUploading && (
        <View style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 9999,
          backgroundColor: "#0A1628", paddingVertical: 10, paddingHorizontal: 16,
          flexDirection: "row", alignItems: "center", gap: 12,
        }}>
          <ActivityIndicator size="small" color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", marginBottom: 4 }}>
              Uploading... {lessonUploadProgress}%
            </Text>
            <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <View style={{ height: 4, backgroundColor: "#22C55E", borderRadius: 2, width: `${lessonUploadProgress}%` as any }} />
            </View>
          </View>
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#22C55E" }}>{lessonUploadProgress}%</Text>
        </View>
      )}
      {isWideSidebar ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          {/* Sidebar */}
          <View style={{ width: 260, backgroundColor: colors.card, paddingTop: topPadding + 20, paddingBottom: 24, flexDirection: "column", borderRightWidth: 1, borderRightColor: colors.border }}>
            <View style={{ paddingHorizontal: 24, marginBottom: 32 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="school" size={24} color="#fff" />
                </View>
                <View>
                  <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: colors.text }}>3i Learning</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" }}>Admin Panel</Text>
                </View>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {ADMIN_TABS.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <Pressable key={tab.key} onPress={() => { setActiveTab(tab.key); setOpenFolderView(null); }}
                    style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 13, marginHorizontal: 10, borderRadius: 12, marginBottom: 4, backgroundColor: isActive ? colors.surfaceAlt : "transparent", borderLeftWidth: isActive ? 4 : 0, borderLeftColor: Colors.light.primary, shadowColor: isActive ? colors.shadow : "transparent", shadowOffset: { width: 0, height: 1 }, shadowOpacity: isActive ? 0.08 : 0, shadowRadius: 3, elevation: isActive ? 2 : 0 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: isActive ? Colors.light.primary + "18" : colors.surfaceAlt, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={tab.icon} size={20} color={isActive ? Colors.light.primary : colors.textMuted} />
                    </View>
                    <Text style={{ fontSize: 16, fontFamily: isActive ? "Inter_700Bold" : "Inter_500Medium", color: isActive ? Colors.light.primary : colors.textSecondary }}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={{ paddingHorizontal: 18, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{(user?.name || "A")[0].toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: colors.text }} numberOfLines={1}>{user?.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" }}>Admin</Text>
                </View>
              </View>
              <Pressable onPress={() => adminBackToApp(router)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, backgroundColor: colors.surfaceAlt }}>
                <Ionicons name="arrow-back" size={18} color={colors.textMuted} />
                <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: colors.textSecondary }}>Back to App</Text>
              </Pressable>
            </View>
          </View>
          {/* Main content */}
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            {/* Section header */}
            <View style={{ backgroundColor: isDarkMode ? colors.surfaceAlt : "#EEF2FF", paddingHorizontal: 32, paddingVertical: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View style={{ width: 46, height: 46, borderRadius: 12, backgroundColor: Colors.light.primary + "18", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={ADMIN_TABS.find(t => t.key === activeTab)?.icon || "grid"} size={24} color={Colors.light.primary} />
                </View>
                <View>
                  <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: colors.text }}>
                    {ADMIN_TABS.find(t => t.key === activeTab)?.label || "Dashboard"}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" }}>
                    Hi {user?.name?.split(" ")[0]}, welcome back 👋
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Pressable
                  onPress={openAdminAlerts}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    backgroundColor: colors.card,
                    borderRadius: 20,
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="notifications-outline" size={18} color={Colors.light.primary} />
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Admin Alerts</Text>
                </Pressable>
                <View style={{ backgroundColor: "#DCFCE7", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
                  <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>Admin</Text>
                </View>
              </View>
            </View>
            {tabContent}
          </View>
        </View>
      ) : (
        <>
          <LinearGradient colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
            <View style={styles.headerRow}>
              {Platform.OS !== "web" && (
                <Pressable style={styles.backBtn} onPress={() => adminBackToApp(router)}>
                  <Ionicons name="arrow-back" size={20} color="#fff" />
                </Pressable>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Admin Dashboard</Text>
                <Text style={styles.headerSub}>3i Learning · {user?.name}</Text>
              </View>
              {Platform.OS === "web" && (
                <Pressable onPress={openAdminAlerts} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center", marginRight: 8 }}>
                  <Ionicons name="notifications-outline" size={18} color="#fff" />
                </Pressable>
              )}
              {Platform.OS === "web" && (
                <Pressable onPress={() => adminBackToApp(router)} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-back" size={18} color="#fff" />
                </Pressable>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
              {ADMIN_TABS.map((tab) => (
                <Pressable key={tab.key} style={[styles.adminTab, activeTab === tab.key && styles.adminTabActive]} onPress={() => { setActiveTab(tab.key); setOpenFolderView(null); }}>
                  <Ionicons name={tab.icon} size={16} color={activeTab === tab.key ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                  <Text style={[styles.adminTabText, activeTab === tab.key && styles.adminTabTextActive]}>{tab.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </LinearGradient>
          {tabContent}
        </>
      )}
      <Modal visible={!!userActionUser} animationType="slide" transparent onRequestClose={() => setUserActionUser(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setUserActionUser(null)}>
          <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 }}>
            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>{userActionUser?.name}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: -8 }}>
              {userActionUser?.phone ? `+91 ${userActionUser.phone}` : userActionUser?.email}
            </Text>

            {/* Block/Unblock */}
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: colors.surfaceAlt, borderRadius: 12 }}
              onPress={() => {
                if (userActionUser) blockUserMutation.mutate({ userId: userActionUser.id, blocked: !userActionUser.is_blocked });
                setUserActionUser(null);
              }}
            >
              <Ionicons name={userActionUser?.is_blocked ? "lock-open-outline" : "ban-outline"} size={22} color={userActionUser?.is_blocked ? "#22C55E" : "#F59E0B"} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: colors.text }}>
                {userActionUser?.is_blocked ? "Unblock User" : "Block User"}
              </Text>
            </Pressable>

            {/* Course Access */}
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#EFF6FF", borderRadius: 12 }}
              onPress={() => {
                if (userActionUser) {
                  setCourseAccessUserId(userActionUser.id);
                  setShowCourseAccess(true);
                }
                setUserActionUser(null);
              }}
            >
              <Ionicons name="book-outline" size={22} color={Colors.light.primary} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.primary }}>Course Access</Text>
            </Pressable>

            {/* Remove from App */}
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#FEE2E2", borderRadius: 12 }}
              onPress={() => {
                if (userActionUser) {
                  if (Platform.OS === "web") {
                    if (window.confirm(`Remove ${userActionUser.name} from the app? This will delete all their data.`)) {
                      deleteUserMutation.mutate(userActionUser.id);
                    }
                  } else {
                    Alert.alert("Remove User", `Remove ${userActionUser.name}? This cannot be undone.`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => deleteUserMutation.mutate(userActionUser.id) },
                    ]);
                  }
                }
                setUserActionUser(null);
              }}
            >
              <Ionicons name="trash-outline" size={22} color="#EF4444" />
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: "#EF4444" }}>Remove from App</Text>
            </Pressable>

            <Pressable style={{ padding: 14, alignItems: "center" }} onPress={() => setUserActionUser(null)}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Course Access Modal */}
      <Modal visible={showCourseAccess} animationType="slide" transparent onRequestClose={() => setShowCourseAccess(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: "70%", display: "flex", flexDirection: "column" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: colors.text }}>Grant Course Access</Text>
              <Pressable onPress={() => setShowCourseAccess(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 }}>
              Select a course to enroll this student:
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {courses.map((c) => {
                const isAlreadyEnrolled = courseAccessEnrollmentSet.has(c.id);
                return (
                <Pressable
                  key={c.id}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: grantingCourseId === c.id ? Colors.light.secondary : "#fff" }}
                  onPress={async () => {
                    if (!courseAccessUserId || isAlreadyEnrolled) return;
                    setGrantingCourseId(c.id);
                    try {
                      await apiRequest("POST", `/api/courses/${c.id}/enroll`, { userId: courseAccessUserId });
                      await qc.invalidateQueries({ queryKey: ["/api/admin/users", courseAccessUserId, "enrollments"] });
                      if (Platform.OS === "web") window.alert(`${c.title} access granted!`);
                      else Alert.alert("Success", `Course access granted!`);
                    } catch (err: any) {
                      const msg = (err?.message || "").replace(/^\d+: /, "");
                      if (msg.includes("alreadyEnrolled") || msg.includes("Already")) {
                        await qc.invalidateQueries({ queryKey: ["/api/admin/users", courseAccessUserId, "enrollments"] });
                        if (Platform.OS === "web") window.alert("Student is already enrolled in this course.");
                        else Alert.alert("Already Enrolled", "Student is already enrolled in this course.");
                      } else {
                        if (Platform.OS === "web") window.alert(`Failed: ${msg}`);
                        else Alert.alert("Error", msg || "Failed to grant access.");
                      }
                    } finally {
                      setGrantingCourseId(null);
                    }
                  }}
                >
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="book" size={18} color={Colors.light.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{c.title}</Text>
                    <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                      {c.is_free ? "Free" : `₹${parseFloat(c.price).toFixed(0)}`} · {c.category}
                    </Text>
                  </View>
                  {grantingCourseId === c.id ? (
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                  ) : isAlreadyEnrolled ? (
                    <Ionicons name="checkmark-circle" size={22} color="#22C55E" />
                  ) : (
                    <Ionicons name="add-circle-outline" size={22} color={Colors.light.primary} />
                  )}
                </Pressable>
              )})}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Add Book Modal */}
      <Modal visible={showAddBook} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Book</Text>
              <Pressable onPress={() => setShowAddBook(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput style={styles.formInput} placeholder="Book title" placeholderTextColor={Colors.light.textMuted} value={bookTitle} onChangeText={setBookTitle} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Author</Text>
                <TextInput style={styles.formInput} placeholder="Author name" placeholderTextColor={Colors.light.textMuted} value={bookAuthor} onChangeText={setBookAuthor} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, { height: 80 }]} placeholder="Short description" placeholderTextColor={Colors.light.textMuted} value={bookDesc} onChangeText={setBookDesc} multiline />
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Price (₹)</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={bookPrice} onChangeText={setBookPrice} keyboardType="numeric" />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Original Price (₹)</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={bookOriginalPrice} onChangeText={setBookOriginalPrice} keyboardType="numeric" />
                </View>
              </View>

              {/* Cover Image */}
              <View style={styles.formField}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.formLabel}>Cover Image</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#F59E0B" }}>Max 2MB · JPG/PNG · 400×600px recommended</Text>
                </View>
                {bookCoverBase64 ? (
                  <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border }}>
                    <Image source={{ uri: bookCoverBase64 }} style={{ width: "100%", height: 160 }} resizeMode="cover" />
                    <Pressable onPress={() => setBookCoverBase64(null)}
                      style={{ position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color="#fff" />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable onPress={pickBookCover}
                      style={{ borderWidth: 1.5, borderColor: Colors.light.border, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", gap: 6, backgroundColor: "#FAFAFA", marginBottom: 8 }}>
                      <Ionicons name="image-outline" size={26} color={Colors.light.primary} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Pick from Gallery / Files</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>JPG, PNG — max 2MB</Text>
                    </Pressable>
                    <TextInput style={styles.formInput} placeholder="Or paste image URL (https://...)" placeholderTextColor={Colors.light.textMuted} value={bookCoverUrl} onChangeText={setBookCoverUrl} autoCapitalize="none" keyboardType="url" />
                  </>
                )}
              </View>

              {/* PDF File */}
              <View style={styles.formField}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.formLabel}>Book File (PDF)</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#F59E0B" }}>Max 10MB · PDF only</Text>
                </View>
                {bookFileBase64 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#BBF7D0" }}>
                    <Ionicons name="document-text" size={28} color="#16A34A" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#166534" }} numberOfLines={1}>{bookFileName || "PDF selected"}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#16A34A" }}>Ready to upload</Text>
                    </View>
                    <Pressable onPress={() => { setBookFileBase64(null); setBookFileName(null); }}
                      style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color="#16A34A" />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable onPress={pickBookPdf}
                      style={{ borderWidth: 1.5, borderColor: Colors.light.border, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", gap: 6, backgroundColor: "#FAFAFA", marginBottom: 8 }}>
                      <Ionicons name="document-attach-outline" size={26} color="#F59E0B" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>Pick PDF File</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>PDF only — max 10MB</Text>
                    </Pressable>
                    <TextInput style={styles.formInput} placeholder="Or paste PDF/Drive URL (https://...)" placeholderTextColor={Colors.light.textMuted} value={bookFileUrl} onChangeText={setBookFileUrl} autoCapitalize="none" keyboardType="url" />
                  </>
                )}
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !bookTitle && styles.createBtnDisabled]}
              onPress={() => {
                if (!bookTitle) return;
                addBookMutation.mutate({
                  title: bookTitle, description: bookDesc, author: bookAuthor,
                  price: parseFloat(bookPrice) || 0,
                  originalPrice: parseFloat(bookOriginalPrice) || 0,
                  coverUrl: bookCoverBase64 || bookCoverUrl || null,
                  fileUrl: bookFileBase64 || bookFileUrl || null,
                  isPublished: true,
                });
              }}
              disabled={!bookTitle || addBookMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addBookMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.createBtnText}>Add Book</Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edit Book Modal */}
      <Modal visible={!!editingBook} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Book</Text>
              <Pressable onPress={() => { setEditingBook(null); setBookTitle(""); setBookDesc(""); setBookAuthor(""); setBookPrice("0"); setBookOriginalPrice("0"); setBookCoverUrl(""); setBookFileUrl(""); setBookCoverBase64(null); setBookFileBase64(null); setBookFileName(null); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput style={styles.formInput} placeholder="Book title" placeholderTextColor={Colors.light.textMuted} value={bookTitle} onChangeText={setBookTitle} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Author</Text>
                <TextInput style={styles.formInput} placeholder="Author name" placeholderTextColor={Colors.light.textMuted} value={bookAuthor} onChangeText={setBookAuthor} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, { height: 80 }]} placeholder="Short description" placeholderTextColor={Colors.light.textMuted} value={bookDesc} onChangeText={setBookDesc} multiline />
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Price (₹)</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={bookPrice} onChangeText={setBookPrice} keyboardType="numeric" />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Original Price (₹)</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={bookOriginalPrice} onChangeText={setBookOriginalPrice} keyboardType="numeric" />
                </View>
              </View>
              {/* Cover Image */}
              <View style={styles.formField}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.formLabel}>Cover Image</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#F59E0B" }}>Max 2MB · 400×600px</Text>
                </View>
                {bookCoverBase64 ? (
                  <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border }}>
                    <Image source={{ uri: bookCoverBase64 }} style={{ width: "100%", height: 160 }} resizeMode="cover" />
                    <Pressable onPress={() => setBookCoverBase64(null)} style={{ position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color="#fff" />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable onPress={pickBookCover} style={{ borderWidth: 1.5, borderColor: Colors.light.border, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", gap: 6, backgroundColor: "#FAFAFA", marginBottom: 8 }}>
                      <Ionicons name="image-outline" size={26} color={Colors.light.primary} />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Pick from Gallery / Files</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>JPG, PNG — max 2MB</Text>
                    </Pressable>
                    <TextInput style={styles.formInput} placeholder="Or paste image URL (https://...)" placeholderTextColor={Colors.light.textMuted} value={bookCoverUrl} onChangeText={setBookCoverUrl} autoCapitalize="none" keyboardType="url" />
                  </>
                )}
              </View>
              {/* PDF File */}
              <View style={styles.formField}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={styles.formLabel}>Book File (PDF)</Text>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#F59E0B" }}>Max 10MB · PDF only</Text>
                </View>
                {bookFileBase64 ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#BBF7D0" }}>
                    <Ionicons name="document-text" size={28} color="#16A34A" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#166534" }} numberOfLines={1}>{bookFileName || "PDF selected"}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: "#16A34A" }}>Ready to upload</Text>
                    </View>
                    <Pressable onPress={() => { setBookFileBase64(null); setBookFileName(null); }} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name="close" size={16} color="#16A34A" />
                    </Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable onPress={pickBookPdf} style={{ borderWidth: 1.5, borderColor: Colors.light.border, borderStyle: "dashed", borderRadius: 10, padding: 16, alignItems: "center", gap: 6, backgroundColor: "#FAFAFA", marginBottom: 8 }}>
                      <Ionicons name="document-attach-outline" size={26} color="#F59E0B" />
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>Pick PDF File</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>PDF only — max 10MB</Text>
                    </Pressable>
                    <TextInput style={styles.formInput} placeholder="Or paste PDF/Drive URL (https://...)" placeholderTextColor={Colors.light.textMuted} value={bookFileUrl} onChangeText={setBookFileUrl} autoCapitalize="none" keyboardType="url" />
                  </>
                )}
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !bookTitle && styles.createBtnDisabled]}
              onPress={() => {
                if (!bookTitle || !editingBook) return;
                editBookMutation.mutate({
                  id: editingBook.id,
                  title: bookTitle, description: bookDesc, author: bookAuthor,
                  price: parseFloat(bookPrice) || 0,
                  originalPrice: parseFloat(bookOriginalPrice) || 0,
                  coverUrl: bookCoverBase64 || bookCoverUrl || editingBook.cover_url || null,
                  fileUrl: bookFileBase64 || bookFileUrl || editingBook.file_url || null,
                  isPublished: editingBook.is_published,
                });
              }}
              disabled={!bookTitle || editBookMutation.isPending}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {editBookMutation.isPending ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.createBtnText}>Save Changes</Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

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
                <Text style={styles.formLabel}>Folder (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Free Drills, CDS Paid, June 2026" placeholderTextColor={Colors.light.textMuted} value={missionFolder} onChangeText={setMissionFolder} />
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
              {missionType === "daily_drill" && (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Linked Course (optional)</Text>
                  <View style={{ marginTop: 6, gap: 6 }}>
                    <Pressable
                      style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: !missionCourseId ? Colors.light.primary : Colors.light.border, backgroundColor: !missionCourseId ? Colors.light.secondary : "#fff" }]}
                      onPress={() => setMissionCourseId(null)}
                    >
                      <Ionicons name="globe-outline" size={18} color={!missionCourseId ? Colors.light.primary : Colors.light.textMuted} />
                      <Text style={{ fontSize: 14, fontFamily: !missionCourseId ? "Inter_600SemiBold" : "Inter_400Regular", color: !missionCourseId ? Colors.light.primary : Colors.light.text }}>Any Course</Text>
                      {!missionCourseId && <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} style={{ marginLeft: "auto" }} />}
                    </Pressable>
                    {courses.map((c) => (
                      <Pressable
                        key={c.id}
                        style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: missionCourseId === c.id ? Colors.light.primary : Colors.light.border, backgroundColor: missionCourseId === c.id ? Colors.light.secondary : "#fff" }]}
                        onPress={() => { setMissionCourseId(c.id); setMissionSubjectKey(""); }}
                      >
                        <Ionicons name="book-outline" size={18} color={missionCourseId === c.id ? Colors.light.primary : Colors.light.textMuted} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontFamily: missionCourseId === c.id ? "Inter_600SemiBold" : "Inter_400Regular", color: missionCourseId === c.id ? Colors.light.primary : Colors.light.text }}>{c.title}</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{c.category} · {c.is_free ? "Free" : `₹${parseFloat(c.price).toFixed(0)}`}</Text>
                        </View>
                        {missionCourseId === c.id && <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {missionType === "daily_drill" && missionCourseId != null && courses.some((c) => c.id === missionCourseId && c.course_type === "multi_subject") ? (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Subject (required)</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    {MULTI_SUBJECTS.map((subject) => (
                      <Pressable
                        key={subject.key}
                        style={[{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: missionSubjectKey === subject.key ? Colors.light.primary : Colors.light.border,
                          backgroundColor: missionSubjectKey === subject.key ? Colors.light.secondary : "#fff",
                        }]}
                        onPress={() => setMissionSubjectKey(subject.key)}
                      >
                        <SubjectIcon subject={subject} size={16} />
                        <Text style={{ fontSize: 13, fontFamily: missionSubjectKey === subject.key ? "Inter_700Bold" : "Inter_500Medium", color: missionSubjectKey === subject.key ? Colors.light.primary : Colors.light.text }}>
                          {subject.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Questions ({missionQuestions.length})</Text>
                {missionQuestions.map((q, idx) => (
                  <React.Fragment key={idx}>
                  {idx > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 10 }}>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}12` }}
                        onPress={() => setMissionQuestions((prev) => {
                          const n = [...prev];
                          n.splice(idx, 0, { question: "", options: ["", "", "", ""], correct: "A", topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" });
                          return n;
                        })}
                      >
                        <Ionicons name="add-circle-outline" size={17} color={Colors.light.primary} />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add between</Text>
                      </Pressable>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#9333EA", backgroundColor: "#F5F3FF" }}
                        onPress={() => setMissionQuestions((prev) => {
                          const n = [...prev];
                          const src = prev[idx - 1];
                          const copy = { ...src, options: [...(src.options || ["", "", "", ""])] };
                          n.splice(idx, 0, copy);
                          return n;
                        })}
                      >
                        <Ionicons name="copy-outline" size={17} color="#9333EA" />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate above</Text>
                      </Pressable>
                    </View>
                  )}
                  <View style={styles.missionQCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Q{idx + 1}</Text>
                      <Pressable onPress={() => setMissionQuestions((prev) => prev.filter((_, i) => i !== idx))}>
                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                    <TextInput style={[styles.formInput, { minHeight: 88, textAlignVertical: "top" }]} placeholder="Question text (Enter for new line)" placeholderTextColor={Colors.light.textMuted} value={q.question} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], question: v }; setMissionQuestions(nq); }} multiline blurOnSubmit={false} returnKeyType="default" />
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
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Subtopic (optional)" placeholderTextColor={Colors.light.textMuted} value={q.subtopic} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], subtopic: v }; setMissionQuestions(nq); }} />
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Marks (e.g., 4)" placeholderTextColor={Colors.light.textMuted} value={q.marks} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], marks: v }; setMissionQuestions(nq); }} keyboardType="numeric" />
                    <View style={{ marginTop: 8, gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Question Image (optional)</Text>
                      <AdminImageBoxInline imageUrl={q.image_url} onUrlChange={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], image_url: v }; setMissionQuestions(nq); }} />
                    </View>
                    <TextInput style={[styles.formInput, { marginTop: 4, minHeight: 72, textAlignVertical: "top" }]} placeholder="Solution / Explanation (optional)" placeholderTextColor={Colors.light.textMuted} value={q.solution} onChangeText={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], solution: v }; setMissionQuestions(nq); }} multiline blurOnSubmit={false} />
                    <View style={{ marginTop: 4, gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Solution Image (optional)</Text>
                      <AdminImageBoxInline imageUrl={q.solution_image_url} onUrlChange={(v) => { const nq = [...missionQuestions]; nq[idx] = { ...nq[idx], solution_image_url: v }; setMissionQuestions(nq); }} />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 }}>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}12` }}
                      onPress={() => setMissionQuestions((prev) => { const n = [...prev]; n.splice(idx + 1, 0, { question: "", options: ["", "", "", ""], correct: "A", topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" }); return n; })}
                    >
                      <Ionicons name="add-circle-outline" size={17} color={Colors.light.primary} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add below</Text>
                    </Pressable>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#9333EA", backgroundColor: "#F5F3FF" }}
                      onPress={() => setMissionQuestions((prev) => { const n = [...prev]; const src = prev[idx]; const copy = { ...src, options: [...(src.options || ["", "", "", ""])] }; n.splice(idx + 1, 0, copy); return n; })}
                    >
                      <Ionicons name="copy-outline" size={17} color="#9333EA" />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate below</Text>
                    </Pressable>
                  </View>
                  </React.Fragment>
                ))}
                <Pressable style={styles.addQBtn} onPress={() => setMissionQuestions((prev) => [...prev, { question: "", options: ["", "", "", ""], correct: "A", topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" }])}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.light.primary} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Add Question</Text>
                </Pressable>
                <Pressable style={[styles.addQBtn, { backgroundColor: "#FFF3E0", marginTop: 6 }]} onPress={() => setShowMissionBulkUpload(true)}>
                  <Ionicons name="cloud-upload-outline" size={18} color="#FF6B35" />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#FF6B35" }}>Bulk Upload Questions</Text>
                </Pressable>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!missionTitle || missionQuestions.length === 0) && styles.createBtnDisabled]}
              disabled={!missionTitle || missionQuestions.length === 0 || addMissionMutation.isPending}
              onPress={() => {
                const linked = courses.find((c) => c.id === missionCourseId);
                if (linked?.course_type === "multi_subject" && !missionSubjectKey.trim()) {
                  Alert.alert("Subject required", "Select a subject for this multisubject course mission.");
                  return;
                }
                const questions = missionQuestions.map((q, i) => ({ id: i + 1, ...q, marks: q.marks ? parseFloat(q.marks) : undefined }));
                addMissionMutation.mutate({
                  title: missionTitle,
                  description: missionDesc,
                  questions,
                  missionType,
                  missionDate: new Date().toISOString().split("T")[0],
                  courseId: missionCourseId,
                  folderName: missionFolder.trim() || null,
                  subjectKey: missionSubjectKey.trim() || null,
                });
              }}>
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {addMissionMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Mission</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showCourseTypeChoice} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: 380 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>What do you want to create?</Text>
              <Pressable onPress={() => setShowCourseTypeChoice(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <View style={{ gap: 12, padding: 16 }}>
              <Pressable
                style={{ padding: 16, borderRadius: 14, borderWidth: 2, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}08` }}
                onPress={() => {
                  setShowCourseTypeChoice(false);
                  setNewCourse(defaultNewCourse("live"));
                  setShowAddCourse(true);
                }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Ionicons name="book" size={24} color={Colors.light.primary} />
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Single Subject Course</Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
                  Current course logic with lectures, tests, study materials, folders, and live classes
                </Text>
              </Pressable>
              <Pressable
                style={{ padding: 16, borderRadius: 14, borderWidth: 2, borderColor: "#7C3AED", backgroundColor: "#7C3AED08" }}
                onPress={() => {
                  setShowCourseTypeChoice(false);
                  setNewCourse({ ...defaultNewCourse("multi_subject"), subject: "Maths, English, Science, G.K" });
                  setShowAddCourse(true);
                }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Ionicons name="grid" size={24} color="#7C3AED" />
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Multiple Subject Course</Text>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
                  Dedicated about page plus fixed Maths, English, Science, and G.K subject layout
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Live Class Action Sheet (3-dot menu) */}
      <Modal visible={!!liveActionSheet} animationType="fade" transparent onRequestClose={() => setLiveActionSheet(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} onPress={() => setLiveActionSheet(null)}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPadding + 20, gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: colors.text }} numberOfLines={1}>{liveActionSheet?.title}</Text>
              <Pressable onPress={() => setLiveActionSheet(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: "#EEF2FF" }}
              onPress={() => {
                const g = liveActionSheet;
                setLiveActionSheet(null);
                // Pre-fill the schedule form for editing
                setLiveTitle(g.title);
                setLiveScheduleDate(g.scheduledAt ? new Date(parseInt(g.scheduledAt)).toISOString().split("T")[0] : "");
                setLiveScheduleTime(g.scheduledAt ? new Date(parseInt(g.scheduledAt)).toTimeString().slice(0, 5) : "");
                setLiveIsNow(false);
                const pf = prefillLiveRecordingFormFields(g.lecture_section_title, g.lecture_subfolder_title);
                setLiveLectureMain(pf.main);
                setLiveLectureSubfolder(pf.sub);
                setLiveSubjectKey(String(g.subject_key || "maths").toLowerCase());
                setShowScheduleLiveClass(true);
                setEditingLiveClass(g);
              }}>
              <Ionicons name="pencil" size={20} color={Colors.light.primary} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Edit Live Class</Text>
            </Pressable>
            <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 12, backgroundColor: "#FEE2E2" }}
              onPress={() => {
                const g = liveActionSheet;
                setLiveActionSheet(null);
                const doDelete = async () => {
                  for (const id of g.ids) { await apiRequest("DELETE", `/api/admin/live-classes/${id}`).catch(() => {}); }
                  refetchUpcoming(); qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
                };
                if (Platform.OS === "web") { if (window.confirm(`Delete "${g.title}" from all courses?`)) doDelete(); }
                else Alert.alert("Delete", `Delete "${g.title}" from all ${g.ids.length} course(s)?`, [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
              }}>
              <Ionicons name="trash" size={20} color="#EF4444" />
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Delete</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showAddCourse} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{newCourse.courseType === "test_series" ? "Add Test Series" : newCourse.courseType === "multi_subject" ? "Add Multiple Subject Course" : "Add Single Subject Course"}</Text>
              <Pressable onPress={() => setShowAddCourse(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              {[
                { label: "Course Title *", key: "title", placeholder: "e.g., Class 10 Mathematics" },
                ...(newCourse.courseType !== "multi_subject" ? [
                  { label: "Teacher Name", key: "teacherName", placeholder: "3i Learning" },
                  { label: "Language", key: "courseLanguage", placeholder: "e.g., HINGLISH, Hindi, English" },
                ] : []),
                ...(newCourse.courseType === "multi_subject" ? [
                  { label: "Teacher / Team Name", key: "teacherName", placeholder: "Pankaj Sir & Team" },
                  { label: "Language", key: "courseLanguage", placeholder: "e.g., HINGLISH, Hindi, English" },
                ] : []),
                ...(newCourse.courseType !== "test_series" ? [
                  { label: "Category", key: "category", placeholder: "e.g., NDA, CDS, AFCAT" },
                ] : []),
                { label: "Subject", key: "subject", placeholder: "e.g., Mathematics, English, GK" },
                ...(newCourse.courseType === "test_series" ? [
                  { label: "Exam", key: "exam", placeholder: "e.g., NDA, CDS, AFCAT" },
                ] : []),
                { label: "Level", key: "level", placeholder: "Beginner / Intermediate / Advanced" },
                { label: "Price (₹)", key: "price", placeholder: "0 for free" },
                { label: "Original Price (₹)", key: "originalPrice", placeholder: "For discount display" },
              ].map((field) => (
                <View key={field.key} style={styles.formField}>
                  <Text style={styles.formLabel}>{field.label}</Text>
                  <TextInput
                    style={[styles.formInput, field.key === "teacherBio" && styles.formInputMulti]}
                    placeholder={field.placeholder}
                    placeholderTextColor={Colors.light.textMuted}
                    value={String(newCourse[field.key as keyof NewCourse])}
                    onChangeText={(val) => setNewCourse((prev) => ({ ...prev, [field.key]: val }))}
                    multiline={field.key === "teacherBio"}
                    numberOfLines={field.key === "teacherBio" ? 3 : 1}
                    keyboardType={["price", "originalPrice"].includes(field.key) ? "numeric" : "default"}
                  />
                </View>
              ))}
              {newCourse.courseType === "multi_subject" && (
                <AdminR2ImagePicker
                  label="Course Card Banner Image"
                  value={newCourse.thumbnail}
                  onChange={(url) => setNewCourse((prev) => ({ ...prev, thumbnail: url }))}
                  variant="banner"
                  hint="Recommended banner size: 1200 × 450 px. Used on the vertical multi-subject card."
                />
              )}
              {(newCourse.courseType === "live" || newCourse.courseType === "recorded") && (
                <AdminR2ImagePicker
                  label="Course Card Banner Image"
                  value={newCourse.thumbnail}
                  onChange={(url) => setNewCourse((prev) => ({ ...prev, thumbnail: url }))}
                  variant="banner"
                  hint="Recommended banner size: 1200 × 450 px. Shown at the top of the home course card."
                />
              )}
              {newCourse.courseType === "test_series" && (
                <AdminR2ImagePicker
                  label="Test Series Banner Image"
                  value={newCourse.thumbnail}
                  onChange={(url) => setNewCourse((prev) => ({ ...prev, thumbnail: url }))}
                  variant="banner"
                  hint="Recommended banner size: 1200 × 450 px. Shown on the home test series card and course header."
                />
              )}
              {newCourse.courseType === "multi_subject" && (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Batch Status</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                    {(["live", "recorded"] as const).map((status) => (
                      <Pressable
                        key={status}
                        onPress={() => setNewCourse((prev) => ({ ...prev, batchStatus: status }))}
                        style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: newCourse.batchStatus === status ? Colors.light.primary : Colors.light.border, backgroundColor: newCourse.batchStatus === status ? "#EEF2FF" : "transparent", alignItems: "center" }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: newCourse.batchStatus === status ? Colors.light.primary : Colors.light.textMuted }}>{status.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.formLabel}>Included Subjects</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {MULTI_SUBJECTS.map((subject) => (
                      <View key={subject.key} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: "#EEF2FF" }}>
                        <SubjectIcon subject={subject} size={16} color="#4F46E5" />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#3730A3" }}>{subject.label}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 6 }}>
                    These fixed subjects will appear on the student course layout screen.
                  </Text>
                </View>
              )}
              {newCourse.courseType === "test_series" && (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Course End Date</Text>
                    <TextInput style={styles.formInput} placeholder="e.g., 15 Jun 2026" placeholderTextColor={Colors.light.textMuted} value={newCourse.endDate} onChangeText={(val) => setNewCourse((prev) => ({ ...prev, endDate: val }))} />
                  </View>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Access validity (months from purchase, optional)</Text>
                    <TextInput
                      style={styles.formInput}
                      placeholder="e.g., 6 or 12 or 18 (leave empty for no extra limit from purchase date)"
                      placeholderTextColor={Colors.light.textMuted}
                      value={newCourse.validityMonths}
                      onChangeText={(val) => setNewCourse((prev) => ({ ...prev, validityMonths: val }))}
                      keyboardType="numeric"
                    />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 4 }}>
                      Access ends on the earlier of: course end date, or (purchase time + this many months).
                    </Text>
                  </View>
                </>
              )}
              {newCourse.courseType !== "test_series" && newCourse.courseType !== "multi_subject" && (
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
              )}
              {(newCourse.courseType === "live" || newCourse.courseType === "multi_subject") && (
                <>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Start Date</Text>
                    <TextInput style={styles.formInput} placeholder="e.g., 15 Mar 2026" placeholderTextColor={Colors.light.textMuted} value={newCourse.startDate} onChangeText={(val) => setNewCourse((prev) => ({ ...prev, startDate: val }))} />
                  </View>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>End Date</Text>
                    <TextInput style={styles.formInput} placeholder="e.g., 15 Jun 2026" placeholderTextColor={Colors.light.textMuted} value={newCourse.endDate} onChangeText={(val) => setNewCourse((prev) => ({ ...prev, endDate: val }))} />
                  </View>
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Access validity (months from purchase, optional)</Text>
                    <TextInput
                      style={styles.formInput}
                      placeholder="e.g., 6 or 12 or 18 (leave empty for no extra limit from purchase date)"
                      placeholderTextColor={Colors.light.textMuted}
                      value={newCourse.validityMonths}
                      onChangeText={(val) => setNewCourse((prev) => ({ ...prev, validityMonths: val }))}
                      keyboardType="numeric"
                    />
                    <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: 4 }}>
                      Access ends on the earlier of: course end date, or (purchase time + this many months).
                    </Text>
                  </View>
                </>
              )}
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
                  <Text style={styles.createBtnText}>{newCourse.courseType === "test_series" ? "Create Test Series" : newCourse.courseType === "multi_subject" ? "Create Multiple Subject Course" : "Create Course"}</Text>
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
              <Text style={styles.modalTitle}>Import Content</Text>
              <Pressable onPress={() => setShowImportModal(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={[styles.infoCard, { marginBottom: 12 }]}>
                <Ionicons name="information-circle-outline" size={18} color={Colors.light.primary} />
                <Text style={styles.infoText}>
                  Copies content into this course only. Title, price, and description stay unchanged. Folder names and order are preserved.
                </Text>
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>Source Course *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  {courses.filter(c => c.id !== importTargetCourseId).map(c => (
                    <Pressable
                      key={c.id}
                      onPress={async () => {
                        setImportSourceCourseId(c.id);
                        setImportPreview(null);
                        setImportPreviewLoading(true);
                        try {
                          const baseUrl = getApiUrl();
                          const res = await authFetch(
                            new URL(`/api/admin/courses/${importTargetCourseId}/import-content-preview?sourceCourseId=${c.id}`, baseUrl).toString()
                          );
                          if (res.ok) setImportPreview(await res.json());
                          else setImportPreview({ lectures: 0, tests: 0, materials: 0, missions: 0 });
                        } catch {
                          setImportPreview(null);
                        } finally {
                          setImportPreviewLoading(false);
                        }
                      }}
                      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: importSourceCourseId === c.id ? Colors.light.primary : Colors.light.secondary, marginRight: 8 }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: importSourceCourseId === c.id ? "#fff" : Colors.light.text }} numberOfLines={1}>{c.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {!importSourceCourseId && (
                  <Text style={styles.adminCardMetaText}>Select the course to copy content from.</Text>
                )}
                {importPreviewLoading && <ActivityIndicator size="small" color={Colors.light.primary} style={{ marginTop: 8 }} />}
                {importPreview && importSourceCourseId && !importPreviewLoading && (
                  <Text style={[styles.adminCardMetaText, { marginTop: 6 }]}>
                    Available: {importPreview.lectures} lectures · {importPreview.tests} tests · {importPreview.materials} materials · {importPreview.missions} missions
                  </Text>
                )}
              </View>

              <View style={styles.formField}>
                <Text style={styles.formLabel}>What to import</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {([
                    { key: "lectures" as const, label: "Lectures" },
                    { key: "tests" as const, label: "Tests" },
                    { key: "materials" as const, label: "Materials" },
                    { key: "missions" as const, label: "Missions" },
                  ]).map((item) => (
                    <Pressable
                      key={item.key}
                      style={[styles.typeSelectBtn, importOptions[item.key] && styles.typeSelectActive]}
                      onPress={() => setImportOptions((p) => ({ ...p, [item.key]: !p[item.key] }))}
                    >
                      <Text style={[styles.typeSelectText, importOptions[item.key] && styles.typeSelectTextActive]}>{item.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable
                style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}
                onPress={async () => {
                  const next = !showAdvancedImport;
                  setShowAdvancedImport(next);
                  if (next && allLectures.length === 0) {
                    const baseUrl = getApiUrl();
                    const [lecs, tests, mats] = await Promise.all([
                      globalThis.fetch(new URL("/api/admin/all-lectures", baseUrl).toString(), { credentials: "include" }).then(r => r.json()).catch(() => []),
                      globalThis.fetch(new URL("/api/admin/all-tests", baseUrl).toString(), { credentials: "include" }).then(r => r.json()).catch(() => []),
                      globalThis.fetch(new URL("/api/admin/all-materials", baseUrl).toString(), { credentials: "include" }).then(r => r.ok ? r.json() : []).catch(() => []),
                    ]);
                    setAllLectures(Array.isArray(lecs) ? lecs : []);
                    setAllTests(Array.isArray(tests) ? tests : []);
                    setAllMaterials(Array.isArray(mats) ? mats : []);
                  }
                }}
              >
                <Ionicons name={showAdvancedImport ? "chevron-down" : "chevron-forward"} size={16} color={Colors.light.primary} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>
                  Advanced: pick individual items
                </Text>
              </Pressable>

              {showAdvancedImport && (() => {
                const filteredLectures = allLectures.filter(l => l.course_id !== importTargetCourseId && l.course_id === importSourceCourseId);
                const filteredTests = allTests.filter(t => t.course_id !== importTargetCourseId && t.course_id === importSourceCourseId);
                const filteredMaterials = allMaterials.filter(m => m.course_id !== importTargetCourseId && m.course_id === importSourceCourseId);
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
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{l.title}</Text>
                              {l.section_title && <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>📁 {l.section_title}</Text>}
                            </View>
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
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{t.title}</Text>
                              {t.folder_name && <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>📁 {t.folder_name}</Text>}
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    ))}

                    {!importSourceCourseId && (
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center", marginTop: 12 }}>Select a source course above.</Text>
                    )}
                    {importSourceCourseId && filteredLectures.length === 0 && filteredTests.length === 0 && filteredMaterials.length === 0 && (
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center", marginTop: 20 }}>No lectures, tests, or materials in the source course</Text>
                    )}

                    {filteredMaterials.length > 0 && (() => {
                      const groupedMaterials: Record<string, any[]> = {};
                      filteredMaterials.forEach(m => {
                        const key = m.course_title || "Unknown";
                        if (!groupedMaterials[key]) groupedMaterials[key] = [];
                        groupedMaterials[key].push(m);
                      });
                      return (
                        <>
                          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 12, marginBottom: 8 }}>Materials ({selectedMaterialIds.length} selected)</Text>
                          {Object.entries(groupedMaterials).map(([courseName, mats]) => (
                            <View key={courseName} style={{ marginBottom: 12 }}>
                              <Pressable onPress={() => {
                                const mIds = mats.map(m => m.id);
                                const allSelected = mIds.every(id => selectedMaterialIds.includes(id));
                                if (allSelected) setSelectedMaterialIds(prev => prev.filter(id => !mIds.includes(id)));
                                else setSelectedMaterialIds(prev => [...new Set([...prev, ...mIds])]);
                              }}>
                                <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary, marginBottom: 4 }}>{courseName} ({mats.length})</Text>
                              </Pressable>
                              {mats.map(m => (
                                <Pressable key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, paddingHorizontal: 4 }}
                                  onPress={() => setSelectedMaterialIds(prev => prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id])}>
                                  <Ionicons name={selectedMaterialIds.includes(m.id) ? "checkbox" : "square-outline"} size={20} color={selectedMaterialIds.includes(m.id) ? Colors.light.primary : Colors.light.textMuted} />
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{m.title}</Text>
                                    {m.section_title && <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>📁 {m.section_title}</Text>}
                                    <Text style={{ fontSize: 10, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{(m.file_type || "pdf").toUpperCase()}</Text>
                                  </View>
                                </Pressable>
                              ))}
                            </View>
                          ))}
                        </>
                      );
                    })()}
                  </>
                );
              })()}
            </ScrollView>
            <Pressable
              style={[
                styles.createBtn,
                (!importSourceCourseId || (!importOptions.lectures && !importOptions.tests && !importOptions.materials && !importOptions.missions)) && styles.createBtnDisabled,
              ]}
              disabled={
                importLoading ||
                !importSourceCourseId ||
                (!importOptions.lectures && !importOptions.tests && !importOptions.materials && !importOptions.missions)
              }
              onPress={async () => {
                if (!importTargetCourseId || !importSourceCourseId) return;
                setImportLoading(true);
                try {
                  if (showAdvancedImport && (selectedLectureIds.length > 0 || selectedTestIds.length > 0 || selectedMaterialIds.length > 0)) {
                    if (selectedLectureIds.length > 0) {
                      await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-lectures`, { lectureIds: selectedLectureIds });
                    }
                    if (selectedTestIds.length > 0) {
                      await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-tests`, { testIds: selectedTestIds });
                    }
                    if (selectedMaterialIds.length > 0) {
                      await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-materials`, { materialIds: selectedMaterialIds });
                    }
                    qc.invalidateQueries({ queryKey: ["/api/courses"] });
                    qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
                    setShowImportModal(false);
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert(
                      "Success",
                      `Imported ${selectedLectureIds.length} lectures, ${selectedTestIds.length} tests, ${selectedMaterialIds.length} materials (selected items).`
                    );
                    return;
                  }

                  const res = await apiRequest("POST", `/api/admin/courses/${importTargetCourseId}/import-content`, {
                    sourceCourseId: importSourceCourseId,
                    options: importOptions,
                  });
                  const payload = await res.json();
                  if (!res.ok) throw new Error(payload?.message || "Import failed");

                  qc.invalidateQueries({ queryKey: ["/api/courses"] });
                  qc.invalidateQueries({ queryKey: ["/api/admin/daily-missions"] });
                  setShowImportModal(false);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert(
                    "Import complete",
                    [
                      importOptions.lectures ? `${payload.lectures ?? 0} lectures` : null,
                      importOptions.tests ? `${payload.tests ?? 0} tests` : null,
                      importOptions.materials ? `${payload.materials ?? 0} materials` : null,
                      importOptions.missions ? `${payload.missions ?? 0} missions` : null,
                    ]
                      .filter(Boolean)
                      .join(", ") + " added to this course."
                  );
                } catch (e: any) {
                  Alert.alert("Import failed", e?.message || "Could not import content. Nothing was changed if the request failed midway.");
                } finally {
                  setImportLoading(false);
                }
              }}
            >
              <LinearGradient colors={["#8B5CF6", "#7C3AED"]} style={styles.createBtnGrad}>
                {importLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.createBtnText}>
                    {showAdvancedImport && (selectedLectureIds.length + selectedTestIds.length + selectedMaterialIds.length) > 0
                      ? `Import ${selectedLectureIds.length + selectedTestIds.length + selectedMaterialIds.length} selected items`
                      : "Import from source course"}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showCreateTest} animationType="slide" transparent style={Platform.OS === "web" ? { zIndex: 91000 } : undefined}>
        <View style={[styles.modalOverlay, Platform.OS === "web" ? { zIndex: 91000, elevation: 80 } : null]}>
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
                  {courses.filter((c: any) => c.course_type !== "test_series").map((c) => (
                    <Pressable key={c.id} style={[styles.typeOption, testCourseId === c.id && styles.typeOptionActive, { marginLeft: 6 }]} onPress={() => setTestCourseId(c.id)}>
                      <Text style={[styles.typeOptionText, testCourseId === c.id && styles.typeOptionTextActive]} numberOfLines={1}>{c.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Add to Test Series Course (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                  <Pressable style={[styles.typeOption, testMiniCourseId === null && styles.typeOptionActive]} onPress={() => setTestMiniCourseId(null)}>
                    <Text style={[styles.typeOptionText, testMiniCourseId === null && styles.typeOptionTextActive]}>None</Text>
                  </Pressable>
                  {tsCourses.map((mc: any) => (
                    <Pressable key={mc.id} style={[styles.typeOption, testMiniCourseId === mc.id && styles.typeOptionActive, { marginLeft: 6 }]} onPress={() => setTestMiniCourseId(mc.id)}>
                      <Text style={[styles.typeOptionText, testMiniCourseId === mc.id && styles.typeOptionTextActive]} numberOfLines={1}>{mc.title}</Text>
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
                  <Text style={styles.formLabel}>Price (₹) — 0 = Free</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={testPrice} onChangeText={setTestPrice} keyboardType="numeric" />
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Difficulty Level</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  {(["easy", "moderate", "hard"] as const).map((d) => {
                    const diffColors: Record<string, string> = { easy: "#22C55E", moderate: "#F59E0B", hard: "#EF4444" };
                    const active = testDifficulty === d;
                    return (
                      <Pressable key={d} onPress={() => setTestDifficulty(d)}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, borderColor: active ? diffColors[d] : Colors.light.border, backgroundColor: active ? diffColors[d] + "18" : "transparent", alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: active ? diffColors[d] : Colors.light.textMuted, textTransform: "capitalize" }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Schedule Date & Time (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., 2026-06-15 10:00" placeholderTextColor={Colors.light.textMuted} value={testScheduledAt} onChangeText={setTestScheduledAt} />
                <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 }}>
                  Leave blank to publish immediately. Format: YYYY-MM-DD HH:MM
                </Text>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Folder Name (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Chapter 1, Algebra" placeholderTextColor={Colors.light.textMuted} value={testFolderName} onChangeText={setTestFolderName} />
                <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 }}>Group this test under a folder</Text>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !testTitle && styles.createBtnDisabled]}
              onPress={() => testTitle && createTestMutation.mutate({
                title: testTitle, description: testDesc, testType,
                durationMinutes: parseInt(testDuration) || 60, totalMarks: parseInt(testTotalMarks) || 100,
                difficulty: testDifficulty, scheduledAt: testScheduledAt || null,
                folderName: testFolderName || null,
                courseId: testMiniCourseId || testCourseId || null,
                price: parseFloat(testPrice) || 0,
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

      <Modal visible={showTestQuestions !== null} animationType="slide" transparent onRequestClose={dismissStandaloneTestQuestionsLayer} style={Platform.OS === "web" ? { zIndex: 92000 } : undefined}>
        <View style={[styles.modalOverlay, Platform.OS === "web" ? { zIndex: 92000, elevation: 85 } : null]}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: "90%" }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>
                  {showBulkQ ? "Bulk Upload Questions" : showAddQ ? (standaloneAddQuestionAfterId ? "Add Question Below" : "Add Question") : showViewQuestions ? "Questions" : "Test Questions"}
                </Text>
                {!!showAddQ && !!standaloneAddQuestionAfterId && (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 }}>New question is inserted after the selected one.</Text>
                )}
              </View>
              {showTestQuestions ? (
                <AdminExportDownloadButton
                  kind="test"
                  id={showTestQuestions}
                  filename={`${findAdminTestById(showTestQuestions)?.title || "test"}.pdf`}
                  style={{ marginRight: 8 }}
                />
              ) : null}
              <Pressable onPress={dismissStandaloneTestQuestionsLayer} accessibilityLabel="Close or go back">
                <Ionicons name={showBulkQ || showAddQ || showViewQuestions ? "chevron-back" : "close"} size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            {!showBulkQ && !showAddQ && !showViewQuestions && (
              <View style={{ gap: 12, paddingVertical: 12 }}>
                <Pressable style={styles.testActionBtnLarge} onPress={() => { setShowViewQuestions(true); if (showTestQuestions) loadTestQuestions(showTestQuestions); }}>
                  <Ionicons name="list" size={22} color="#22C55E" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>View & Edit Questions</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Edit or delete existing questions</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                </Pressable>
                <Pressable style={styles.testActionBtnLarge} onPress={() => { standaloneResumeQuestionListAfterAddRef.current = false; setStandaloneAddQuestionAfterId(null); setShowAddQ(true); }}>
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
                <Pressable style={styles.testActionBtnLarge} onPress={() => { const id = showTestQuestions; setShowTestQuestions(null); setShowAddQ(false); setShowBulkQ(false); setBulkQResult(null); setShowBulkUploadModal(id); }}>
                  <Ionicons name="document-text" size={22} color="#7C3AED" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Upload PDF / PPT</Text>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Upload a PDF or PPT converted to PDF</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            )}
            {showViewQuestions && (
              <ScrollView style={styles.modalScroll}>
                <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }} onPress={dismissStandaloneTestQuestionsLayer}>
                  <Ionicons name="arrow-back" size={16} color={Colors.light.primary} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Back</Text>
                </Pressable>
                {testQuestionsLoading ? <ActivityIndicator color={Colors.light.primary} /> : testQuestionsList.length === 0 ? (
                  <Text style={{ fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 20 }}>No questions yet</Text>
                ) : testQuestionsList.map((q: any, idx: number) => (
                  <View key={q.id} style={{ marginBottom: 10 }}>
                    <View style={{ backgroundColor: Colors.light.background, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.light.border }}>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Q{idx + 1}. {q.question_text}</Text>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          <Pressable style={{ padding: 6, backgroundColor: "#EEF2FF", borderRadius: 8 }} onPress={() => setEditQuestion({ id: q.id, questionText: q.question_text, optionA: q.option_a, optionB: q.option_b, optionC: q.option_c, optionD: q.option_d, correctOption: q.correct_option, explanation: q.explanation || "", topic: q.topic || "", marks: String(q.marks || 1), negativeMarks: String(q.negative_marks || 0), difficulty: q.difficulty || "moderate", imageUrl: q.image_url || "", solutionImageUrl: q.solution_image_url || "" })}>
                            <Ionicons name="pencil-outline" size={16} color={Colors.light.primary} />
                          </Pressable>
                          <Pressable style={{ padding: 6, backgroundColor: "#FEE2E2", borderRadius: 8 }} onPress={() => {
                            if (Platform.OS === "web") { if (window.confirm("Delete this question?")) deleteQuestionMutation.mutate(q.id); }
                            else Alert.alert("Delete", "Delete this question?", [{ text: "Cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteQuestionMutation.mutate(q.id) }]);
                          }}>
                            <Ionicons name="trash-outline" size={16} color="#EF4444" />
                          </Pressable>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: "#22C55E", fontFamily: "Inter_500Medium", marginTop: 4 }}>✓ {q[`option_${q.correct_option?.toLowerCase()}`]}</Text>
                      {q.topic ? <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{q.topic}</Text> : null}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 }}>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}12` }}
                        onPress={() => {
                          standaloneResumeQuestionListAfterAddRef.current = true;
                          setStandaloneAddQuestionAfterId(q.id);
                          setShowViewQuestions(false);
                          setShowAddQ(true);
                        }}
                      >
                        <Ionicons name="add-circle-outline" size={17} color={Colors.light.primary} />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add below</Text>
                      </Pressable>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#9333EA", backgroundColor: "#F5F3FF" }}
                        disabled={addQuestionMutation.isPending}
                        onPress={() => {
                          const co = String(q.correct_option || "A").toUpperCase().slice(0, 1);
                          addQuestionMutation.mutate({
                            testId: showTestQuestions!,
                            insertAfterQuestionId: q.id,
                            questionText: q.question_text,
                            optionA: q.option_a || "",
                            optionB: q.option_b || "",
                            optionC: q.option_c || "",
                            optionD: q.option_d || "",
                            correctOption: ["A", "B", "C", "D"].includes(co) ? co : "A",
                            explanation: q.explanation || "",
                            topic: q.topic || "",
                            marks: parseInt(String(q.marks), 10) || 4,
                            negativeMarks: parseInt(String(q.negative_marks), 10) || 1,
                            difficulty: q.difficulty || "moderate",
                            imageUrl: q.image_url || null,
                            solutionImageUrl: q.solution_image_url || null,
                          });
                        }}
                      >
                        <Ionicons name="copy-outline" size={17} color="#9333EA" />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate below</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
            {showAddQ && (
              <ScrollView style={styles.modalScroll}>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Question *</Text>
                  <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Enter question text (Enter for new line)" placeholderTextColor={Colors.light.textMuted} value={newQ.questionText} onChangeText={(v) => setNewQ(p => ({ ...p, questionText: v }))} multiline blurOnSubmit={false} numberOfLines={3} />
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
                  <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Why this answer?" placeholderTextColor={Colors.light.textMuted} value={newQ.explanation} onChangeText={(v) => setNewQ(p => ({ ...p, explanation: v }))} multiline blurOnSubmit={false} numberOfLines={2} />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Difficulty</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                    {(["easy", "moderate", "hard"] as const).map((d) => {
                      const diffColors: Record<string, string> = { easy: "#22C55E", moderate: "#F59E0B", hard: "#EF4444" };
                      const active = newQ.difficulty === d;
                      return (
                        <Pressable key={d} onPress={() => setNewQ(p => ({ ...p, difficulty: d }))}
                          style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, borderColor: active ? diffColors[d] : Colors.light.border, backgroundColor: active ? diffColors[d] + "18" : "transparent", alignItems: "center" }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: active ? diffColors[d] : Colors.light.textMuted, textTransform: "capitalize" }}>{d}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
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
                {/* Image fields */}
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Question Image (optional)</Text>
                  <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 6 }}>Recommended: 800×400px, JPG/PNG, max 2MB</Text>
                  <AdminImageBoxInline imageUrl={newQ.imageUrl} onUrlChange={(v) => setNewQ(p => ({ ...p, imageUrl: v }))} />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Solution Image (optional)</Text>
                  <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 6 }}>Recommended: 800×400px, JPG/PNG, max 2MB</Text>
                  <AdminImageBoxInline imageUrl={newQ.solutionImageUrl} onUrlChange={(v) => setNewQ(p => ({ ...p, solutionImageUrl: v }))} />
                </View>
                <Pressable
                  style={[styles.createBtn, !newQ.questionText && styles.createBtnDisabled]}
                  onPress={() => newQ.questionText && addQuestionMutation.mutate({
                    testId: showTestQuestions!,
                    ...(standaloneAddQuestionAfterId != null ? { insertAfterQuestionId: standaloneAddQuestionAfterId } : {}),
                    questionText: newQ.questionText, optionA: newQ.optionA, optionB: newQ.optionB,
                    optionC: newQ.optionC, optionD: newQ.optionD, correctOption: newQ.correctOption,
                    explanation: newQ.explanation, marks: parseInt(newQ.marks) || 4, negativeMarks: parseInt(newQ.negativeMarks) || 1,
                    difficulty: newQ.difficulty || "moderate",
                    imageUrl: newQ.imageUrl || null, solutionImageUrl: newQ.solutionImageUrl || null,
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

      {/* Edit Question — after test sheet so it stacks above on web */}
      <Modal visible={!!editQuestion} animationType="slide" transparent onRequestClose={() => setEditQuestion(null)}>
        <View style={[styles.modalOverlay, { zIndex: 100000, elevation: 100 }]}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setEditQuestion(null)} hitSlop={10}>
                <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
              </Pressable>
              <Text style={[styles.modalTitle, { flex: 1, marginHorizontal: 8 }]}>Edit Question</Text>
              <Pressable onPress={() => setEditQuestion(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Question *</Text>
                <TextInput style={[styles.formInput, { height: 80, textAlignVertical: "top" }]} value={editQuestion?.questionText || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, questionText: v }))} placeholder="Question text" placeholderTextColor={Colors.light.textMuted} multiline blurOnSubmit={false} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Question Image (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion?.imageUrl || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, imageUrl: v }))} placeholder="Paste URL or upload" placeholderTextColor={Colors.light.textMuted} autoCapitalize="none" />
                  <Pressable style={{ backgroundColor: "#EEF2FF", borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
                        input.onchange = async (e: any) => { const file = e.target.files?.[0]; if (!file) return;
                          try { const blobUrl = URL.createObjectURL(file); const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "images"); URL.revokeObjectURL(blobUrl); setEditQuestion((p: any) => ({ ...p, imageUrl: publicUrl })); } catch {} };
                        input.click();
                      }
                    }}>
                    <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />
                  </Pressable>
                </View>
                {!!editQuestion?.imageUrl && <Image source={{ uri: editQuestion.imageUrl }} style={{ width: "100%", height: 120, borderRadius: 8, marginTop: 6 }} resizeMode="contain" />}
              </View>
              {["A", "B", "C", "D"].map((letter) => (
                <View key={letter} style={[styles.formField, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
                  <Pressable onPress={() => setEditQuestion((p: any) => ({ ...p, correctOption: letter }))}
                    style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: editQuestion?.correctOption === letter ? "#22C55E" : Colors.light.border, backgroundColor: editQuestion?.correctOption === letter ? "#22C55E" : "transparent", alignItems: "center", justifyContent: "center" }}>
                    {editQuestion?.correctOption === letter && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </Pressable>
                  <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion?.[`option${letter}`] || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, [`option${letter}`]: v }))} placeholder={`Option ${letter}`} placeholderTextColor={Colors.light.textMuted} />
                </View>
              ))}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Explanation</Text>
                <TextInput style={[styles.formInput, { height: 60, textAlignVertical: "top" }]} value={editQuestion?.explanation || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, explanation: v }))} placeholder="Solution explanation" placeholderTextColor={Colors.light.textMuted} multiline blurOnSubmit={false} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Solution Image (optional)</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion?.solutionImageUrl || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, solutionImageUrl: v }))} placeholder="Paste URL or upload" placeholderTextColor={Colors.light.textMuted} autoCapitalize="none" />
                  <Pressable style={{ backgroundColor: "#EEF2FF", borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}
                    onPress={() => {
                      if (Platform.OS === "web") {
                        const input = document.createElement("input"); input.type = "file"; input.accept = "image/*";
                        input.onchange = async (e: any) => { const file = e.target.files?.[0]; if (!file) return;
                          try { const blobUrl = URL.createObjectURL(file); const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "images"); URL.revokeObjectURL(blobUrl); setEditQuestion((p: any) => ({ ...p, solutionImageUrl: publicUrl })); } catch {} };
                        input.click();
                      }
                    }}>
                    <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />
                  </Pressable>
                </View>
                {!!editQuestion?.solutionImageUrl && <Image source={{ uri: editQuestion.solutionImageUrl }} style={{ width: "100%", height: 120, borderRadius: 8, marginTop: 6 }} resizeMode="contain" />}
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Difficulty</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {["easy","moderate","hard"].map((d) => (
                    <Pressable key={d} onPress={() => setEditQuestion((p: any) => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: (editQuestion?.difficulty || "moderate") === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6" }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (editQuestion?.difficulty || "moderate") === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Topic</Text>
                  <TextInput style={styles.formInput} value={editQuestion?.topic || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, topic: v }))} placeholder="Topic" placeholderTextColor={Colors.light.textMuted} />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Correct Marks</Text>
                  <TextInput style={styles.formInput} value={editQuestion?.marks || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, marks: v }))} placeholder="4" placeholderTextColor={Colors.light.textMuted} keyboardType="numeric" />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Negative Marks</Text>
                  <TextInput style={styles.formInput} value={editQuestion?.negativeMarks || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, negativeMarks: v }))} placeholder="1" placeholderTextColor={Colors.light.textMuted} keyboardType="numeric" />
                </View>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !editQuestion?.questionText && styles.createBtnDisabled]}
              disabled={!editQuestion?.questionText || updateQuestionMutation.isPending}
              onPress={() => editQuestion && updateQuestionMutation.mutate({ id: editQuestion.id, questionText: editQuestion.questionText, optionA: editQuestion.optionA, optionB: editQuestion.optionB, optionC: editQuestion.optionC, optionD: editQuestion.optionD, correctOption: editQuestion.correctOption, explanation: editQuestion.explanation, topic: editQuestion.topic, marks: editQuestion.marks, negativeMarks: editQuestion.negativeMarks, difficulty: editQuestion.difficulty, imageUrl: editQuestion.imageUrl, solutionImageUrl: editQuestion.solutionImageUrl })}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {updateQuestionMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Save Question</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showAddFreeMaterial} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Free Study Material</Text>
              <Pressable onPress={() => setShowAddFreeMaterial(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Algebra Formulae Sheet" placeholderTextColor={Colors.light.textMuted} value={freMatTitle} onChangeText={setFreMatTitle} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>File *</Text>
                {freMatUrl ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#BBF7D0" }}>
                    <Ionicons name="document-text" size={20} color="#16A34A" />
                    <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#166534" }} numberOfLines={1}>{freMatUrl.includes("cdn.3ilearning") ? "Uploaded to cloud ✓" : freMatUrl}</Text>
                    <Pressable onPress={() => setFreMatUrl("")}><Ionicons name="close-circle" size={20} color="#16A34A" /></Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable
                      style={{ borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, padding: 14, alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", marginBottom: 6, opacity: freMatUploading ? 0.6 : 1 }}
                      disabled={freMatUploading}
                      onPress={() => {
                        if (Platform.OS === "web") {
                          const input = document.createElement("input"); input.type = "file"; input.accept = ".pdf,.doc,.docx,video/*,.mp4,.mov";
                          input.onchange = async (e: any) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            setFreMatUploading(true); setFreMatUploadProgress(0);
                            try {
                              const blobUrl = URL.createObjectURL(file);
                              const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || getMimeType(file.name), "materials", (pct) => setFreMatUploadProgress(pct));
                              URL.revokeObjectURL(blobUrl);
                              setFreMatUrl(publicUrl);
                              const ext = file.name.split(".").pop()?.toLowerCase() || "";
                              setFreMatType(ext === "pdf" ? "pdf" : ["doc","docx"].includes(ext) ? "doc" : "video");
                            } catch (err: any) { Alert.alert("Upload Failed", err?.message || "Could not upload."); }
                            finally { setFreMatUploading(false); setFreMatUploadProgress(0); }
                          };
                          input.click();
                        } else {
                          Alert.alert("Add File", "Paste a URL below or use a cloud link.");
                        }
                      }}>
                      {freMatUploading ? (
                        <>
                          <ActivityIndicator size="small" color={Colors.light.primary} />
                          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{freMatUploadProgress}%</Text>
                          <View style={{ width: "100%", height: 4, backgroundColor: "#C7D2FE", borderRadius: 2, overflow: "hidden" }}>
                            <View style={{ height: 4, backgroundColor: Colors.light.primary, borderRadius: 2, width: `${freMatUploadProgress}%` as any }} />
                          </View>
                        </>
                      ) : (
                        <>
                          <Ionicons name="cloud-upload-outline" size={22} color={Colors.light.primary} />
                          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Upload File (PDF/DOC/Video)</Text>
                          <Text style={{ fontSize: 10, color: Colors.light.textMuted }}>Uploads to Cloudflare R2</Text>
                        </>
                      )}
                    </Pressable>
                    <TextInput style={styles.formInput} placeholder="Or paste file URL (https://...)" placeholderTextColor={Colors.light.textMuted} value={freMatUrl} onChangeText={setFreMatUrl} />
                  </>
                )}
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>File Type</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {["pdf", "video", "link", "doc"].map(t => (
                    <Pressable key={t} onPress={() => setFreMatType(t)} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: freMatType === t ? Colors.light.primary : Colors.light.secondary }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: freMatType === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Folder / Section</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Formulas, Notes" placeholderTextColor={Colors.light.textMuted} value={freMatSection} onChangeText={setFreMatSection} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Allow Download</Text>
                <Switch value={freMatDownload} onValueChange={setFreMatDownload} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!freMatTitle || !freMatUrl) && styles.createBtnDisabled]}
              disabled={!freMatTitle || !freMatUrl || addFreeMaterialMutation.isPending}
              onPress={() => addFreeMaterialMutation.mutate({ title: freMatTitle, fileUrl: freMatUrl, fileType: freMatType, sectionTitle: freMatSection || null, downloadAllowed: freMatDownload, isFree: true })}>
              <LinearGradient colors={["#10B981", "#059669"]} style={styles.createBtnGrad}>
                {addFreeMaterialMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Add Material</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>
      <BulkUploadModal
        visible={showBulkUploadModal !== null}
        testId={showBulkUploadModal}
        onClose={() => setShowBulkUploadModal(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/admin/tests"] }); setShowBulkUploadModal(null); }}
        bottomPadding={bottomPadding}
        modalStyle={Platform.OS === "web" ? { zIndex: 93000 } : undefined}
      />

      {/* ─── Record a Class Modal ─── */}
      <Modal
        visible={showRecordClassModal}
        transparent
        animationType="fade"
        onRequestClose={() => !recSubmitting && setShowRecordClassModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%", maxWidth: 480 }}>
            <View style={{ backgroundColor: "#fff", borderRadius: 20, overflow: "hidden", maxHeight: "90%" }}>
              {/* Modal Header */}
              <LinearGradient colors={["#0A1628", "#1A2A4A"]} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: Platform.OS === "web" ? 16 : 20, paddingBottom: 14, gap: 10 }}>
                <Pressable
                  onPress={() => !recSubmitting && setShowRecordClassModal(false)}
                  style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="arrow-back" size={18} color="#fff" />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Record a Class</Text>
                  <Text style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular" }}>Private recording — not visible to students during recording</Text>
                </View>
                <Pressable
                  onPress={() => !recSubmitting && setShowRecordClassModal(false)}
                  style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
                >
                  <Ionicons name="close" size={18} color="#fff" />
                </Pressable>
              </LinearGradient>

              {/* Modal Body */}
              <ScrollView style={{ padding: 16 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Title */}
                <View style={{ gap: 4, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Recording Title *</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. Trigonometry — Chapter 1"
                    placeholderTextColor={Colors.light.textMuted}
                    value={recTitle}
                    onChangeText={setRecTitle}
                    editable={!recSubmitting}
                  />
                </View>

                {/* Course selector */}
                <View style={{ gap: 4, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add to Course *</Text>
                  <ScrollView style={{ maxHeight: 130, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 10 }} nestedScrollEnabled>
                    {courses.filter(c => c.course_type !== "test_series").map((c) => (
                      <Pressable
                        key={c.id}
                        onPress={() => setRecSelectedCourses(prev => {
                          if (prev.includes(c.id)) return prev.filter(id => id !== c.id);
                          if (c.course_type === "multi_subject") fetchLiveRecordingFolders(c.id, "record");
                          return [...prev, c.id];
                        })}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: Colors.light.border, backgroundColor: recSelectedCourses.includes(c.id) ? "#FEE2E2" : "#fff" }}
                        disabled={recSubmitting}
                      >
                        <Ionicons name={recSelectedCourses.includes(c.id) ? "checkbox" : "square-outline"} size={20} color={recSelectedCourses.includes(c.id) ? "#DC2626" : Colors.light.textMuted} />
                        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text, flex: 1 }} numberOfLines={1}>{c.title}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>

                {selectedMultiCourseIds(recSelectedCourses).length > 0 && (
                  <View style={{ gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: Colors.light.border, marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Multi-subject placement</Text>
                    <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>
                      Select subject, folder and optional subfolder before recording.
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                      {MULTI_SUBJECTS.map((subject) => (
                        <Pressable
                          key={subject.key}
                          onPress={() => {
                            setRecSubjectKey(subject.key);
                            setRecLectureMain("");
                            setRecLectureSubfolder("");
                          }}
                          style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: recSubjectKey === subject.key ? Colors.light.primary : "#EEF2FF" }}
                          disabled={recSubmitting}
                        >
                          <SubjectIcon subject={subject} size={14} color={recSubjectKey === subject.key ? "#fff" : Colors.light.primary} />
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: recSubjectKey === subject.key ? "#fff" : Colors.light.primary }}>{subject.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    {(() => {
                      const folders = selectedMultiCourseFolders(recSelectedCourses, recFoldersByCourse, recSubjectKey);
                      const roots = folders.filter((folder: any) => !folder.parent_id);
                      const children = recLectureMain ? directChildFolders(folders, recLectureMain) : [];
                      return (
                        <>
                          <View style={{ gap: 6 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Folder</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                              <Pressable onPress={() => { setRecLectureMain(""); setRecLectureSubfolder(""); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !recLectureMain ? Colors.light.primary : "#E5E7EB" }} disabled={recSubmitting}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !recLectureMain ? "#fff" : Colors.light.text }}>Default</Text>
                              </Pressable>
                              {roots.map((folder: any) => {
                                const name = folderFullName(folder);
                                return (
                                  <Pressable key={folder.id || name} onPress={() => { setRecLectureMain(name); setRecLectureSubfolder(""); }} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: recLectureMain === name ? Colors.light.primary : "#E5E7EB" }} disabled={recSubmitting}>
                                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: recLectureMain === name ? "#fff" : Colors.light.text }}>{folder.name || name}</Text>
                                  </Pressable>
                                );
                              })}
                            </ScrollView>
                          </View>
                          {recLectureMain ? (
                            <View style={{ gap: 6 }}>
                              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Subfolder</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                                <Pressable onPress={() => setRecLectureSubfolder("")} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !recLectureSubfolder ? Colors.light.primary : "#E5E7EB" }} disabled={recSubmitting}>
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !recLectureSubfolder ? "#fff" : Colors.light.text }}>No Subfolder</Text>
                                </Pressable>
                                {children.map((folder: any) => {
                                  const fullName = folderFullName(folder);
                                  const localName = String(folder.name || fullName.replace(`${recLectureMain} / `, ""));
                                  return (
                                    <Pressable key={folder.id || fullName} onPress={() => setRecLectureSubfolder(localName)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: recLectureSubfolder === localName ? Colors.light.primary : "#E5E7EB" }} disabled={recSubmitting}>
                                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: recLectureSubfolder === localName ? "#fff" : Colors.light.text }}>{localName}</Text>
                                    </Pressable>
                                  );
                                })}
                              </ScrollView>
                            </View>
                          ) : null}
                        </>
                      );
                    })()}
                  </View>
                )}

                {/* Recording section */}
                <View style={{ gap: 4, marginBottom: 8 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Lecture Section (optional)</Text>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Folder inside the course where the recording will appear. Leave empty to use "Live Class Recordings".</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. Live Class Recordings"
                    placeholderTextColor={Colors.light.textMuted}
                    value={recLectureMain}
                    onChangeText={setRecLectureMain}
                    editable={!recSubmitting}
                  />
                </View>
                <View style={{ gap: 4, marginBottom: 12 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Subfolder (optional)</Text>
                  <TextInput
                    style={styles.formInput}
                    placeholder="e.g. Chapter 1 — Algebra"
                    placeholderTextColor={Colors.light.textMuted}
                    value={recLectureSubfolder}
                    onChangeText={setRecLectureSubfolder}
                    editable={!recSubmitting}
                  />
                  {(recLectureMain || recLectureSubfolder) ? (
                    <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
                      Saves as: {buildRecordingLectureSectionTitle(recLectureMain, recLectureSubfolder, null)}
                    </Text>
                  ) : null}
                </View>

                {/* Visibility */}
                <View style={{ gap: 6, marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Visible to Students</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Pressable
                      onPress={() => setRecVisibility("immediate")}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: recVisibility === "immediate" ? "#DC2626" : "#F3F4F6" }}
                      disabled={recSubmitting}
                    >
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: recVisibility === "immediate" ? "#fff" : Colors.light.text }}>After Recording</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setRecVisibility("scheduled")}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: recVisibility === "scheduled" ? Colors.light.primary : "#F3F4F6" }}
                      disabled={recSubmitting}
                    >
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: recVisibility === "scheduled" ? "#fff" : Colors.light.text }}>Schedule Date</Text>
                    </Pressable>
                  </View>
                  {recVisibility === "scheduled" ? (
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Date *</Text>
                        <TextInput style={styles.formInput} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.light.textMuted} value={recVisibleDate} onChangeText={setRecVisibleDate} editable={!recSubmitting} />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Time</Text>
                        <TextInput style={styles.formInput} placeholder="18:00" placeholderTextColor={Colors.light.textMuted} value={recVisibleTime} onChangeText={setRecVisibleTime} editable={!recSubmitting} />
                      </View>
                    </View>
                  ) : null}
                </View>
              </ScrollView>

              {/* Modal Footer — Next button */}
              <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: Colors.light.border }}>
                <Pressable
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                    backgroundColor: (!recTitle.trim() || recSelectedCourses.length === 0 || (recVisibility === "scheduled" && !recVisibleDate.trim()) || recSubmitting) ? "#9CA3AF" : "#DC2626",
                    borderRadius: 12, paddingVertical: 14,
                  }}
                  disabled={!recTitle.trim() || recSelectedCourses.length === 0 || (recVisibility === "scheduled" && !recVisibleDate.trim()) || recSubmitting}
                  onPress={handleRecordClass}
                >
                  {recSubmitting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" }}>Next</Text>
                      <Ionicons name="arrow-forward" size={18} color="#fff" />
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Mission Leaderboard Modal */}
      <Modal visible={!!selectedMission && !selectedAttempt} animationType="slide" onRequestClose={() => { setSelectedMission(null); setMissionAttempts([]); }}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => { setSelectedMission(null); setMissionAttempts([]); }}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={1}>{selectedMission?.title}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>{missionAttempts.length} student{missionAttempts.length !== 1 ? "s" : ""} attempted</Text>
            </View>
            {selectedMission?.id ? (
              <AdminExportDownloadButton
                kind="mission"
                id={selectedMission.id}
                filename={`${selectedMission.title || "mission"}.pdf`}
                variant="header"
                size={18}
              />
            ) : null}
          </LinearGradient>
          {missionAttemptsLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
          ) : missionAttempts.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
              <Ionicons name="people-outline" size={52} color={Colors.light.textMuted} />
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>No attempts yet</Text>
              <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>No students have attempted this mission.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              {missionAttempts.map((attempt: any, idx: number) => {
                const questions = Array.isArray(selectedMission?.questions) ? selectedMission.questions : [];
                const totalQ = questions.length;
                const totalMarks = questions.reduce((s: number, q: any) => s + (q.marks || 0), 0);
                const timeMins = Math.floor((attempt.time_taken || 0) / 60);
                const timeSecs = (attempt.time_taken || 0) % 60;
                const rankColors = ["#F59E0B", "#9CA3AF", "#CD7C2F"];
                return (
                  <Pressable key={attempt.user_id} style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 12 }]} onPress={() => setSelectedAttempt({ ...attempt, mission: selectedMission })}>
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: idx < 3 ? rankColors[idx] : Colors.light.secondary, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: idx < 3 ? "#fff" : Colors.light.text }}>#{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{attempt.name || attempt.phone || "Student"}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                        {attempt.score}/{totalQ} correct · {timeMins}m {timeSecs}s
                      </Text>
                    </View>
                    {totalMarks > 0 && (
                      <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#D97706" }}>
                          {questions.reduce((s: number, q: any) => {
                            const ans = attempt.answers?.[q.id] ?? attempt.answers?.[String(q.id)];
                            return ans === q.correct ? s + (q.marks || 0) : s;
                          }, 0)}/{totalMarks} marks
                        </Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Student Report Card Modal */}
      <Modal visible={!!selectedAttempt} animationType="slide" onRequestClose={() => setSelectedAttempt(null)}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => setSelectedAttempt(null)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{selectedAttempt?.name || selectedAttempt?.phone || "Student"}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>Mission Report Card</Text>
            </View>
          </LinearGradient>
          {selectedAttempt && (() => {
            const questions = Array.isArray(selectedAttempt.mission?.questions) ? selectedAttempt.mission.questions : [];
            const totalQ = questions.length;
            const totalMarks = questions.reduce((s: number, q: any) => s + (q.marks || 0), 0);
            const earnedMarks = questions.reduce((s: number, q: any) => {
              const ans = selectedAttempt.answers?.[q.id] ?? selectedAttempt.answers?.[String(q.id)];
              return ans === q.correct ? s + (q.marks || 0) : s;
            }, 0);
            const correct = selectedAttempt.score || 0;
            const incorrect = selectedAttempt.incorrect || 0;
            const skipped = totalQ - correct - incorrect;
            const pct = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;
            const timeTaken = selectedAttempt.time_taken || 0;
            const timeMins = Math.floor(timeTaken / 60);
            const timeSecs = timeTaken % 60;
            return (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                {/* Score card */}
                <LinearGradient colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]} style={{ borderRadius: 20, padding: 24, alignItems: "center", gap: 8 }}>
                  <Ionicons name="trophy" size={48} color="#fff" />
                  <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" }}>{selectedAttempt.mission?.title}</Text>
                  <Text style={{ fontSize: 40, fontFamily: "Inter_700Bold", color: "#fff" }}>{correct}/{totalQ}</Text>
                  <Text style={{ fontSize: 16, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular" }}>{pct}% correct</Text>
                </LinearGradient>
                {/* Stats grid */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {[
                    { label: "Time Taken", value: `${timeMins}m ${timeSecs}s`, icon: "time-outline", color: Colors.light.primary },
                    { label: "Correct", value: String(correct), icon: "checkmark-circle-outline", color: "#22C55E" },
                    { label: "Incorrect", value: String(incorrect), icon: "close-circle-outline", color: "#EF4444" },
                    { label: "Skipped", value: String(skipped), icon: "remove-circle-outline", color: "#9CA3AF" },
                    ...(totalMarks > 0 ? [{ label: "Marks", value: `${earnedMarks}/${totalMarks}`, icon: "star-outline", color: "#F59E0B" }] : []),
                  ].map((stat) => (
                    <View key={stat.label} style={{ flex: 1, minWidth: 100, backgroundColor: "#fff", borderRadius: 14, padding: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: Colors.light.border }}>
                      <Ionicons name={stat.icon as any} size={22} color={stat.color} />
                      <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{stat.value}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
                {/* Q-by-Q breakdown */}
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Question Breakdown</Text>
                {questions.map((q: any, idx: number) => {
                  const ans = selectedAttempt.answers?.[q.id] ?? selectedAttempt.answers?.[String(q.id)];
                  const isCorrect = ans === q.correct;
                  const isSkipped = !ans;
                  return (
                    <View key={q.id} style={{ backgroundColor: "#fff", borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444", gap: 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name={isCorrect ? "checkmark-circle" : isSkipped ? "remove-circle" : "close-circle"} size={18} color={isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444"} />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted }}>Q{idx + 1}</Text>
                        {q.topic ? <Text style={{ fontSize: 11, color: Colors.light.primary, fontFamily: "Inter_500Medium" }}>{q.topic}</Text> : null}
                      </View>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{q.question}</Text>
                      <Text style={{ fontSize: 12, color: "#22C55E", fontFamily: "Inter_600SemiBold" }}>✓ {q.options?.[q.correct?.charCodeAt(0) - 65]}</Text>
                      {!isCorrect && !isSkipped && <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular" }}>✗ {q.options?.[ans?.charCodeAt(0) - 65]}</Text>}
                      {isSkipped && <Text style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" }}>Not answered</Text>}
                    </View>
                  );
                })}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* Test Attempts Modal */}
      <Modal
        visible={!!selectedAdminTest && !selectedTestAttempt}
        animationType="slide"
        onRequestClose={() => {
          setSelectedAdminTest(null);
          setAdminTestAttempts([]);
          setAdminTestQuestions([]);
        }}
      >
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
              onPress={() => {
                setSelectedAdminTest(null);
                setAdminTestAttempts([]);
                setAdminTestQuestions([]);
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={1}>{selectedAdminTest?.title}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>
                {adminTestAttempts.length} student{adminTestAttempts.length !== 1 ? "s" : ""} attempted
              </Text>
            </View>
            {selectedAdminTest?.id ? (
              <AdminExportDownloadButton
                kind="test"
                id={selectedAdminTest.id}
                filename={`${selectedAdminTest.title || "test"}.pdf`}
                variant="header"
                size={18}
              />
            ) : null}
          </LinearGradient>
          {adminTestAttemptsLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
          ) : adminTestAttempts.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
              <Ionicons name="people-outline" size={52} color={Colors.light.textMuted} />
              <Text style={{ fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>No attempts yet</Text>
              <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" }}>No students have attempted this test.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
              {adminTestAttempts.map((attempt: any, idx: number) => {
                const timeTaken = Number(attempt.time_taken_seconds || 0);
                const timeMins = Math.floor(timeTaken / 60);
                const timeSecs = timeTaken % 60;
                const rankColors = ["#F59E0B", "#9CA3AF", "#CD7C2F"];
                return (
                  <Pressable
                    key={`${attempt.user_id}-${attempt.attempt_id}`}
                    style={[styles.adminCard, { flexDirection: "row", alignItems: "center", gap: 12 }]}
                    onPress={() => setSelectedTestAttempt({ ...attempt, test: selectedAdminTest, questions: adminTestQuestions })}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: idx < 3 ? rankColors[idx] : Colors.light.secondary, alignItems: "center", justifyContent: "center" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: idx < 3 ? "#fff" : Colors.light.text }}>#{idx + 1}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{attempt.name || attempt.phone || attempt.email || "Student"}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                        {Number(attempt.score || 0)}/{Number(attempt.total_marks || selectedAdminTest?.total_marks || 0)} marks · {timeMins}m {timeSecs}s
                      </Text>
                    </View>
                    <View style={{ backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>
                        {Math.round(Number(attempt.percentage || 0))}%
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Student Test Report Modal */}
      <Modal visible={!!selectedTestAttempt} animationType="slide" onRequestClose={() => setSelectedTestAttempt(null)}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => setSelectedTestAttempt(null)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>{selectedTestAttempt?.name || selectedTestAttempt?.phone || "Student"}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>Test Result</Text>
            </View>
          </LinearGradient>
          {selectedTestAttempt && (() => {
            const questions = Array.isArray(selectedTestAttempt.questions) ? selectedTestAttempt.questions : [];
            const answers = selectedTestAttempt.answers || {};
            const score = Number(selectedTestAttempt.score || 0);
            const totalMarks = Number(selectedTestAttempt.total_marks || selectedTestAttempt.test?.total_marks || 0);
            const correct = Number(selectedTestAttempt.correct || 0);
            const incorrect = Number(selectedTestAttempt.incorrect || 0);
            const attempted = Number(selectedTestAttempt.attempted || 0);
            const skipped = Math.max(0, questions.length - attempted);
            const pct = Math.round(Number(selectedTestAttempt.percentage || 0));
            const timeTaken = Number(selectedTestAttempt.time_taken_seconds || 0);
            const timeMins = Math.floor(timeTaken / 60);
            const timeSecs = timeTaken % 60;
            return (
              <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
                <LinearGradient colors={pct >= 60 ? ["#22C55E", "#16A34A"] : ["#F59E0B", "#D97706"]} style={{ borderRadius: 20, padding: 24, alignItems: "center", gap: 8 }}>
                  <Ionicons name="trophy" size={48} color="#fff" />
                  <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" }}>{selectedTestAttempt.test?.title}</Text>
                  <Text style={{ fontSize: 40, fontFamily: "Inter_700Bold", color: "#fff" }}>{score}/{totalMarks}</Text>
                  <Text style={{ fontSize: 16, color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular" }}>{pct}% score</Text>
                </LinearGradient>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {[
                    { label: "Time Taken", value: `${timeMins}m ${timeSecs}s`, icon: "time-outline", color: Colors.light.primary },
                    { label: "Correct", value: String(correct), icon: "checkmark-circle-outline", color: "#22C55E" },
                    { label: "Incorrect", value: String(incorrect), icon: "close-circle-outline", color: "#EF4444" },
                    { label: "Skipped", value: String(skipped), icon: "remove-circle-outline", color: "#9CA3AF" },
                    { label: "Attempted", value: String(attempted), icon: "radio-button-on-outline", color: "#F59E0B" },
                  ].map((stat) => (
                    <View key={stat.label} style={{ flex: 1, minWidth: 100, backgroundColor: "#fff", borderRadius: 14, padding: 14, alignItems: "center", gap: 4, borderWidth: 1, borderColor: Colors.light.border }}>
                      <Ionicons name={stat.icon as any} size={22} color={stat.color} />
                      <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{stat.value}</Text>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Question Breakdown</Text>
                {questions.map((q: any, idx: number) => {
                  const ans = answers[q.id] ?? answers[String(q.id)];
                  const isCorrect = ans === q.correct_option;
                  const isSkipped = !ans;
                  const options = [q.option_a, q.option_b, q.option_c, q.option_d];
                  const correctText = options[String(q.correct_option || "A").charCodeAt(0) - 65] || q.correct_option;
                  const userText = ans ? options[String(ans).charCodeAt(0) - 65] || ans : "";
                  return (
                    <View key={q.id} style={{ backgroundColor: "#fff", borderRadius: 12, padding: 14, borderLeftWidth: 4, borderLeftColor: isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444", gap: 6 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name={isCorrect ? "checkmark-circle" : isSkipped ? "remove-circle" : "close-circle"} size={18} color={isCorrect ? "#22C55E" : isSkipped ? "#9CA3AF" : "#EF4444"} />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted }}>Q{idx + 1}</Text>
                        {q.topic ? <Text style={{ fontSize: 11, color: Colors.light.primary, fontFamily: "Inter_500Medium" }}>{q.topic}</Text> : null}
                      </View>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{q.question_text}</Text>
                      <Text style={{ fontSize: 12, color: "#22C55E", fontFamily: "Inter_600SemiBold" }}>Correct: {correctText}</Text>
                      {!isCorrect && !isSkipped && <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular" }}>Student: {userText}</Text>}
                      {isSkipped && <Text style={{ fontSize: 12, color: "#9CA3AF", fontFamily: "Inter_400Regular" }}>Not answered</Text>}
                    </View>
                  );
                })}
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* Create Folder Modal (Tests, Materials, Missions) — DB-backed */}
      <Modal visible={!!showCreateFolderModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: 320 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Folder</Text>
              <Pressable onPress={() => { setShowCreateFolderModal(null); setNewStandaloneFolderParentId(null); }}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>{newStandaloneFolderParentId ? "Subfolder Name *" : "Folder Name *"}</Text>
              {newStandaloneFolderParentId ? (
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 6 }}>
                  Parent: {standaloneFolderFullName(findStandaloneFolderById(newStandaloneFolderParentId)) || (openFolderView?.folder ? standaloneFolderFullName(openFolderView.folder) : standaloneFolderFullName(standalonefolderActionSheet))}
                </Text>
              ) : null}
              <TextInput style={styles.formInput} placeholder="e.g., Chapter 1, Algebra" placeholderTextColor={Colors.light.textMuted} value={newFolderNameInput} onChangeText={setNewFolderNameInput} autoFocus />
            </View>
            {showCreateFolderModal === "test" && (
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Validity (months)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g., 6"
                  placeholderTextColor={Colors.light.textMuted}
                  value={newFolderValidityMonths}
                  onChangeText={setNewFolderValidityMonths}
                  keyboardType="numeric"
                />
              </View>
            )}
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !newFolderNameInput.trim() && styles.createBtnDisabled]}
              disabled={!newFolderNameInput.trim() || createStandaloneFolderMutation.isPending}
              onPress={async () => {
                if (!newFolderNameInput.trim() || !showCreateFolderModal) return;
                const name = newFolderNameInput.trim();
                const folderType = showCreateFolderModal;
                const parentFolder = findStandaloneFolderById(newStandaloneFolderParentId);
                const parentName = parentFolder ? standaloneFolderFullName(parentFolder) : "";
                const created = await createStandaloneFolderMutation.mutateAsync({
                  name,
                  type: showCreateFolderModal,
                  parentId: newStandaloneFolderParentId,
                  validityMonths: showCreateFolderModal === "test" ? newFolderValidityMonths : undefined,
                });
                if (newStandaloneFolderParentId) {
                  setOpenFolderView({
                    folder: {
                      ...created,
                      type: folderType,
                      parent_id: created?.parent_id ?? newStandaloneFolderParentId,
                      full_name: created?.full_name || (parentName ? `${parentName} / ${name}` : name),
                      name: created?.name || name,
                    },
                    type: folderType,
                  });
                }
                setShowCreateFolderModal(null);
                setNewFolderNameInput("");
                setNewStandaloneFolderParentId(null);
                setNewFolderValidityMonths("");
              }}
            >
              <LinearGradient
                colors={
                  showCreateFolderModal === "test"
                    ? [Colors.light.primary, Colors.light.primaryDark]
                    : showCreateFolderModal === "mission"
                      ? ["#0F766E", "#115E59"]
                      : ["#DC2626", "#B91C1C"]
                }
                style={styles.createBtnGrad}
              >
                {createStandaloneFolderMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Create Folder</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Folder / Mini Course Action Sheet (3-dots menu) */}
      <Modal visible={!!standalonefolderActionSheet} animationType="slide" transparent onRequestClose={() => setStandaloneFolderActionSheet(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setStandaloneFolderActionSheet(null)}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            {(() => {
              return (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle} numberOfLines={1}>{standalonefolderActionSheet?.name}</Text>
                    <Pressable onPress={() => setStandaloneFolderActionSheet(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                  </View>
                  {/* Edit */}
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#EEF2FF", marginBottom: 8 }}
                    onPress={() => {
                      setEditStandaloneFolderName(standaloneFolderLocalName(standalonefolderActionSheet) || "");
                      setEditStandaloneFolderValidityMonths(String(standalonefolderActionSheet?.validity_months ?? ""));
                      setEditingStandaloneFolderId(standalonefolderActionSheet?.id ?? null);
                      setEditStandaloneFolderModal(true);
                      setStandaloneFolderActionSheet(null);
                    }}>
                    <Ionicons name="pencil" size={20} color={Colors.light.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Edit Folder</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Rename this folder</Text>
                    </View>
                  </Pressable>
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#F0FDF4", marginBottom: 8 }}
                    onPress={() => {
                      if (!standalonefolderActionSheet) return;
                      setNewFolderNameInput("");
                      setNewStandaloneFolderParentId(standalonefolderActionSheet.id);
                      setShowCreateFolderModal(standalonefolderActionSheet.type);
                      setStandaloneFolderActionSheet(null);
                    }}>
                    <Ionicons name="folder-open" size={20} color="#16A34A" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Create Subfolder</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Add a folder inside this folder</Text>
                    </View>
                  </Pressable>
                  {/* Hide/Show */}
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: Colors.light.background, marginBottom: 8 }}
                    onPress={async () => { await updateStandaloneFolderMutation.mutateAsync({ id: standalonefolderActionSheet.id, isHidden: !standalonefolderActionSheet.is_hidden }); setStandaloneFolderActionSheet(null); }}>
                    <Ionicons name={standalonefolderActionSheet?.is_hidden ? "eye" : "eye-off"} size={20} color={Colors.light.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{standalonefolderActionSheet?.is_hidden ? "Show Folder" : "Hide Folder"}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{standalonefolderActionSheet?.is_hidden ? "Make visible to students" : "Hide from students"}</Text>
                    </View>
                  </Pressable>
                  {/* Add to Test Series Course — only for test folders */}
                  {standalonefolderActionSheet?.type === "test" && tsCourses.length > 0 && (
                    <View style={{ marginBottom: 8, backgroundColor: "#FFF7ED", borderRadius: 12, padding: 16, gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <Ionicons name="clipboard-outline" size={20} color="#F59E0B" />
                        <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Add to Test Series Course</Text>
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {tsCourses.map((tc: any) => (
                          <Pressable key={tc.id} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: "#fff", marginRight: 8, borderWidth: 1, borderColor: "#FDE68A" }}
                            onPress={async () => {
                              const folderTests = adminTests.filter((t: any) => t.folder_name === standalonefolderActionSheet.name && !t.course_id);
                              for (const t of folderTests) {
                                await apiRequest("PUT", `/api/admin/tests/${t.id}`, { ...t, durationMinutes: String(t.duration_minutes), totalMarks: String(t.total_marks), passingMarks: String(t.passing_marks || 35), testType: t.test_type, folderName: t.folder_name, courseId: tc.id }).catch(() => {});
                              }
                              qc.invalidateQueries({ queryKey: ["/api/admin/tests"] });
                              qc.invalidateQueries({ queryKey: ["/api/courses"] });
                              setStandaloneFolderActionSheet(null);
                              if (Platform.OS === "web") alert(`Moved ${folderTests.length} tests to "${tc.title}"`);
                              else Alert.alert("Done", `Moved ${folderTests.length} tests to "${tc.title}"`);
                            }}>
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#D97706" }}>{tc.title}</Text>
                          </Pressable>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                  {/* Delete */}
                  <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#FEE2E2" }}
                    onPress={() => {
                      const doDelete = async () => { await deleteStandaloneFolderMutation.mutateAsync(standalonefolderActionSheet.id); setStandaloneFolderActionSheet(null); if (openFolderView?.folder?.id === standalonefolderActionSheet.id) setOpenFolderView(null); };
                      if (Platform.OS === "web") { if (window.confirm(`Delete folder "${standalonefolderActionSheet?.name}" and all its content?`)) doDelete(); }
                      else Alert.alert("Delete Folder", `Delete "${standalonefolderActionSheet?.name}" and all its content?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: doDelete }]);
                    }}>
                    <Ionicons name="trash" size={20} color="#EF4444" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Delete Folder</Text>
                      <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular", opacity: 0.7 }}>Permanently deletes folder and all content</Text>
                    </View>
                  </Pressable>
                </>
              );
            })()}
          </View>
        </Pressable>
      </Modal>

      {/* Rename Folder Modal */}
      <Modal visible={editStandaloneFolderModal} animationType="slide" transparent style={Platform.OS === "web" ? { zIndex: 100010 } : undefined}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16, maxHeight: 300 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rename Folder</Text>
              <Pressable onPress={() => setEditStandaloneFolderModal(false)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Folder Name *</Text>
              <TextInput style={styles.formInput} value={editStandaloneFolderName} onChangeText={setEditStandaloneFolderName} placeholder="Folder name" placeholderTextColor={Colors.light.textMuted} autoFocus />
            </View>
            <View style={styles.formField}>
              <Text style={styles.formLabel}>Validity (months)</Text>
              <TextInput
                style={styles.formInput}
                value={editStandaloneFolderValidityMonths}
                onChangeText={setEditStandaloneFolderValidityMonths}
                placeholder="e.g., 6"
                placeholderTextColor={Colors.light.textMuted}
                keyboardType="numeric"
              />
            </View>
            <Pressable
              style={[styles.createBtn, !editStandaloneFolderName.trim() && styles.createBtnDisabled]}
              disabled={!editStandaloneFolderName.trim() || renameStandaloneFolderMutation.isPending}
              onPress={() => editingStandaloneFolderId && renameStandaloneFolderMutation.mutate({ id: editingStandaloneFolderId, name: editStandaloneFolderName.trim(), validityMonths: editStandaloneFolderValidityMonths })}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {renameStandaloneFolderMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Save</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edit Admin Test Modal */}
      <Modal visible={!!editAdminTest} animationType="slide" transparent style={Platform.OS === "web" ? { zIndex: 93500 } : undefined}>
        <View style={[styles.modalOverlay, Platform.OS === "web" ? { zIndex: 93500, elevation: 88 } : null]}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Test</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {editAdminTest?.id ? (
                  <AdminExportDownloadButton kind="test" id={editAdminTest.id} filename={`${editAdminTest.title || "test"}.pdf`} />
                ) : null}
                <Pressable onPress={() => setEditAdminTest(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
              </View>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Test Title *</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Chapter 1 Test" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.title || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, title: v }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, styles.formInputMulti]} placeholder="Test description" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.description || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, description: v }))} multiline numberOfLines={2} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Type</Text>
                <View style={styles.typeOptions}>
                  {["practice", "mock", "chapter", "weekly", "pyq_practice", "pyq_papers"].map((t) => (
                    <Pressable key={t} style={[styles.typeOption, editAdminTest?.test_type === t && styles.typeOptionActive]} onPress={() => setEditAdminTest((p: any) => ({ ...p, test_type: t }))}>
                      <Text style={[styles.typeOptionText, editAdminTest?.test_type === t && styles.typeOptionTextActive]}>{t}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Link to Course (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                  <Pressable style={[styles.typeOption, editAdminTest?.course_id === null && styles.typeOptionActive]} onPress={() => setEditAdminTest((p: any) => ({ ...p, course_id: null }))}>
                    <Text style={[styles.typeOptionText, editAdminTest?.course_id === null && styles.typeOptionTextActive]}>Standalone</Text>
                  </Pressable>
                  {courses.map((c) => (
                    <Pressable key={c.id} style={[styles.typeOption, editAdminTest?.course_id === c.id && styles.typeOptionActive, { marginLeft: 6 }]} onPress={() => setEditAdminTest((p: any) => ({ ...p, course_id: c.id }))}>
                      <Text style={[styles.typeOptionText, editAdminTest?.course_id === c.id && styles.typeOptionTextActive]} numberOfLines={1}>{c.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Duration (minutes)</Text>
                <TextInput style={styles.formInput} placeholder="60" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.durationMinutes || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, durationMinutes: v }))} keyboardType="numeric" />
              </View>
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Total Marks</Text>
                  <TextInput style={styles.formInput} placeholder="100" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.totalMarks || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, totalMarks: v }))} keyboardType="numeric" />
                </View>
                <View style={[styles.formField, { flex: 1 }]}>
                  <Text style={styles.formLabel}>Price (₹) — 0 = Free</Text>
                  <TextInput style={styles.formInput} placeholder="0" placeholderTextColor={Colors.light.textMuted} value={String(editAdminTest?.price ?? "0")} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, price: v }))} keyboardType="numeric" />
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Difficulty Level</Text>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                  {(["easy", "moderate", "hard"] as const).map((d) => {
                    const diffColors: Record<string, string> = { easy: "#22C55E", moderate: "#F59E0B", hard: "#EF4444" };
                    const active = editAdminTest?.difficulty === d;
                    return (
                      <Pressable key={d} onPress={() => setEditAdminTest((p: any) => ({ ...p, difficulty: d }))}
                        style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, borderColor: active ? diffColors[d] : Colors.light.border, backgroundColor: active ? diffColors[d] + "18" : "transparent", alignItems: "center" }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: active ? diffColors[d] : Colors.light.textMuted, textTransform: "capitalize" }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Folder Name (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Chapter 1, Algebra" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.folder_name || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, folder_name: v }))} />
                <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 }}>Leave empty to remove from folder</Text>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Add to Test Series Course (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
                  <Pressable style={[styles.typeOption, !editAdminTest?.ts_course_id && styles.typeOptionActive]} onPress={() => setEditAdminTest((p: any) => ({ ...p, ts_course_id: null }))}>
                    <Text style={[styles.typeOptionText, !editAdminTest?.ts_course_id && styles.typeOptionTextActive]}>None</Text>
                  </Pressable>
                  {tsCourses.map((mc: any) => (
                    <Pressable key={mc.id} style={[styles.typeOption, editAdminTest?.ts_course_id === mc.id && styles.typeOptionActive, { marginLeft: 6 }]} onPress={() => setEditAdminTest((p: any) => ({ ...p, ts_course_id: mc.id }))}>
                      <Text style={[styles.typeOptionText, editAdminTest?.ts_course_id === mc.id && styles.typeOptionTextActive]} numberOfLines={1}>{mc.title}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Schedule Date & Time (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., 2026-06-15 10:00" placeholderTextColor={Colors.light.textMuted} value={editAdminTest?.scheduled_at || ""} onChangeText={(v) => setEditAdminTest((p: any) => ({ ...p, scheduled_at: v }))} />
                <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 }}>Leave blank to publish immediately. Format: YYYY-MM-DD HH:MM</Text>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !editAdminTest?.title && styles.createBtnDisabled]}
              disabled={!editAdminTest?.title || updateAdminTestMutation.isPending}
              onPress={() => editAdminTest && updateAdminTestMutation.mutate({ id: editAdminTest.id, title: editAdminTest.title, description: editAdminTest.description || "", durationMinutes: editAdminTest.durationMinutes, totalMarks: editAdminTest.totalMarks, testType: editAdminTest.test_type, folderName: editAdminTest.folder_name, difficulty: editAdminTest.difficulty || "moderate", scheduledAt: editAdminTest.scheduled_at, passingMarks: editAdminTest.passingMarks, courseId: editAdminTest.ts_course_id || null, price: editAdminTest.price ?? 0 })}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {updateAdminTestMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Save Changes</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edit Free Material Modal */}
      <Modal visible={!!editFreeMaterial} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Material</Text>
              <Pressable onPress={() => setEditFreeMaterial(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Title *</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Algebra Formulae Sheet" placeholderTextColor={Colors.light.textMuted} value={editFreeMaterial?.title || ""} onChangeText={(v) => setEditFreeMaterial((p: any) => ({ ...p, title: v }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>File URL *</Text>
                <TextInput style={styles.formInput} placeholder="https://drive.google.com/..." placeholderTextColor={Colors.light.textMuted} value={editFreeMaterial?.file_url || ""} onChangeText={(v) => setEditFreeMaterial((p: any) => ({ ...p, file_url: v }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>File Type</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {["pdf", "video", "link", "doc"].map((t) => (
                    <Pressable key={t} onPress={() => setEditFreeMaterial((p: any) => ({ ...p, file_type: t }))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: editFreeMaterial?.file_type === t ? Colors.light.primary : Colors.light.secondary }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: editFreeMaterial?.file_type === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Folder / Section</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Formulas, Notes" placeholderTextColor={Colors.light.textMuted} value={editFreeMaterial?.sectionTitle || ""} onChangeText={(v) => setEditFreeMaterial((p: any) => ({ ...p, sectionTitle: v }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Allow Download</Text>
                <Switch value={editFreeMaterial?.downloadAllowed || false} onValueChange={(v) => setEditFreeMaterial((p: any) => ({ ...p, downloadAllowed: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, !editFreeMaterial?.title && styles.createBtnDisabled]}
              disabled={!editFreeMaterial?.title || updateFreeMaterialMutation.isPending}
              onPress={() => editFreeMaterial && updateFreeMaterialMutation.mutate({ id: editFreeMaterial.id, title: editFreeMaterial.title, description: editFreeMaterial.description || "", fileUrl: editFreeMaterial.file_url, fileType: editFreeMaterial.file_type || "pdf", isFree: true, sectionTitle: editFreeMaterial.sectionTitle || null, downloadAllowed: editFreeMaterial.downloadAllowed || false })}
            >
              <LinearGradient colors={["#10B981", "#059669"]} style={styles.createBtnGrad}>
                {updateFreeMaterialMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Save Changes</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Edit Mission Modal */}
      <Modal visible={!!editMission} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Mission</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {editMission?.id ? (
                  <AdminExportDownloadButton kind="mission" id={editMission.id} filename={`${editMission.title || "mission"}.pdf`} />
                ) : null}
                <Pressable onPress={() => setEditMission(null)}>
                  <Ionicons name="close" size={24} color={Colors.light.text} />
                </Pressable>
              </View>
            </View>
            <ScrollView style={styles.modalScroll}>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Mission Title *</Text>
                <TextInput style={styles.formInput} value={editMission?.title || ""} onChangeText={(v) => setEditMission((p: any) => ({ ...p, title: v }))} placeholder="Mission title" placeholderTextColor={Colors.light.textMuted} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Description</Text>
                <TextInput style={[styles.formInput, styles.formInputMulti]} value={editMission?.description || ""} onChangeText={(v) => setEditMission((p: any) => ({ ...p, description: v }))} placeholder="Description..." placeholderTextColor={Colors.light.textMuted} multiline />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Folder (optional)</Text>
                <TextInput style={styles.formInput} placeholder="e.g., Free Drills, CDS Paid, June 2026" placeholderTextColor={Colors.light.textMuted} value={editMission?.folder_name || ""} onChangeText={(v) => setEditMission((p: any) => ({ ...p, folder_name: v }))} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Date</Text>
                <TextInput style={styles.formInput} value={editMission?.mission_date || ""} onChangeText={(v) => setEditMission((p: any) => ({ ...p, mission_date: v }))} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.light.textMuted} />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Type</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {[{ key: "free_practice", label: "Free Practice" }, { key: "daily_drill", label: "Daily Drill" }].map((t) => (
                    <Pressable
                      key={t.key}
                      style={[styles.typeSelectBtn, editMission?.mission_type === t.key && styles.typeSelectActive]}
                      onPress={() => setEditMission((p: any) => ({ ...p, mission_type: t.key, course_id: t.key === "daily_drill" ? p?.course_id ?? null : null }))}
                    >
                      <Text style={[styles.typeSelectText, editMission?.mission_type === t.key && styles.typeSelectTextActive]}>{t.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {editMission?.mission_type === "daily_drill" && (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Linked Course (optional)</Text>
                  <View style={{ marginTop: 6, gap: 6 }}>
                    <Pressable
                      style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: !editMission?.course_id ? Colors.light.primary : Colors.light.border, backgroundColor: !editMission?.course_id ? Colors.light.secondary : "#fff" }]}
                      onPress={() => setEditMission((p: any) => ({ ...p, course_id: null, subject_key: null }))}
                    >
                      <Ionicons name="globe-outline" size={18} color={!editMission?.course_id ? Colors.light.primary : Colors.light.textMuted} />
                      <Text style={{ fontSize: 14, fontFamily: !editMission?.course_id ? "Inter_600SemiBold" : "Inter_400Regular", color: !editMission?.course_id ? Colors.light.primary : Colors.light.text }}>Any Course</Text>
                      {!editMission?.course_id && <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} style={{ marginLeft: "auto" }} />}
                    </Pressable>
                    {courses.map((c) => (
                      <Pressable
                        key={c.id}
                        style={[{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: editMission?.course_id === c.id ? Colors.light.primary : Colors.light.border, backgroundColor: editMission?.course_id === c.id ? Colors.light.secondary : "#fff" }]}
                        onPress={() => setEditMission((p: any) => ({ ...p, course_id: c.id, subject_key: c.course_type === "multi_subject" ? p.subject_key : null }))}
                      >
                        <Ionicons name="book-outline" size={18} color={editMission?.course_id === c.id ? Colors.light.primary : Colors.light.textMuted} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontFamily: editMission?.course_id === c.id ? "Inter_600SemiBold" : "Inter_400Regular", color: editMission?.course_id === c.id ? Colors.light.primary : Colors.light.text }}>{c.title}</Text>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{c.category} · {c.is_free ? "Free" : `₹${parseFloat(c.price).toFixed(0)}`}</Text>
                        </View>
                        {editMission?.course_id === c.id && <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />}
                      </Pressable>
                    ))}
                  </View>
                </View>
              )}
              {editMission?.mission_type === "daily_drill" && editMission?.course_id != null && courses.some((c) => c.id === editMission.course_id && c.course_type === "multi_subject") ? (
                <View style={styles.formField}>
                  <Text style={styles.formLabel}>Subject (required)</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                    {MULTI_SUBJECTS.map((subject) => (
                      <Pressable
                        key={subject.key}
                        style={[{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: editMission?.subject_key === subject.key ? Colors.light.primary : Colors.light.border,
                          backgroundColor: editMission?.subject_key === subject.key ? Colors.light.secondary : "#fff",
                        }]}
                        onPress={() => setEditMission((p: any) => ({ ...p, subject_key: subject.key }))}
                      >
                        <SubjectIcon subject={subject} size={16} />
                        <Text style={{ fontSize: 13, fontFamily: editMission?.subject_key === subject.key ? "Inter_700Bold" : "Inter_500Medium", color: editMission?.subject_key === subject.key ? Colors.light.primary : Colors.light.text }}>
                          {subject.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Questions ({editMission?.questions?.length || 0})</Text>
                {(editMission?.questions || []).map((q: any, idx: number) => (
                  <React.Fragment key={idx}>
                  {idx > 0 && (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 10 }}>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}12` }}
                        onPress={() => setEditMission((p: any) => {
                          const list = [...(p.questions || [])];
                          list.splice(idx, 0, { question: "", options: ["", "", "", ""], correct: "A", topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" });
                          return { ...p, questions: list };
                        })}
                      >
                        <Ionicons name="add-circle-outline" size={17} color={Colors.light.primary} />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add between</Text>
                      </Pressable>
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#9333EA", backgroundColor: "#F5F3FF" }}
                        onPress={() => setEditMission((p: any) => {
                          const list = [...(p.questions || [])];
                          const src = list[idx - 1];
                          const copy = { ...src, options: [...(src.options || ["", "", "", ""])] };
                          list.splice(idx, 0, copy);
                          return { ...p, questions: list };
                        })}
                      >
                        <Ionicons name="copy-outline" size={17} color="#9333EA" />
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate above</Text>
                      </Pressable>
                    </View>
                  )}
                  <View style={styles.missionQCard}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Q{idx + 1}</Text>
                      <Pressable onPress={() => setEditMission((p: any) => ({ ...p, questions: p.questions.filter((_: any, i: number) => i !== idx) }))}>
                        <Ionicons name="close-circle" size={20} color="#EF4444" />
                      </Pressable>
                    </View>
                    <TextInput style={[styles.formInput, { minHeight: 88, textAlignVertical: "top" }]} placeholder="Question text (Enter for new line)" placeholderTextColor={Colors.light.textMuted} value={q.question} onChangeText={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], question: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} multiline blurOnSubmit={false} returnKeyType="default" />
                    {["A", "B", "C", "D"].map((letter, optIdx) => (
                      <View key={letter} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <Pressable onPress={() => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], correct: letter }; setEditMission((p: any) => ({ ...p, questions: nq })); }}
                          style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: q.correct === letter ? "#22C55E" : Colors.light.border, backgroundColor: q.correct === letter ? "#22C55E" : "transparent", alignItems: "center", justifyContent: "center" }}>
                          {q.correct === letter && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </Pressable>
                        <TextInput style={[styles.formInput, { flex: 1, paddingVertical: 6 }]} placeholder={`Option ${letter}`} placeholderTextColor={Colors.light.textMuted} value={q.options?.[optIdx] || ""}
                          onChangeText={(v) => { const nq = [...editMission.questions]; const opts = [...(nq[idx].options || ["","","",""])]; opts[optIdx] = v; nq[idx] = { ...nq[idx], options: opts }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                      </View>
                    ))}
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Topic" placeholderTextColor={Colors.light.textMuted} value={q.topic || ""} onChangeText={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], topic: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Subtopic (optional)" placeholderTextColor={Colors.light.textMuted} value={q.subtopic || ""} onChangeText={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], subtopic: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                    <TextInput style={[styles.formInput, { marginTop: 4 }]} placeholder="Marks (optional)" placeholderTextColor={Colors.light.textMuted} value={q.marks || ""} keyboardType="numeric" onChangeText={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], marks: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                    <View style={{ marginTop: 8, gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Question Image (optional)</Text>
                      <AdminImageBoxInline imageUrl={q.image_url || ""} onUrlChange={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], image_url: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                    </View>
                    <TextInput style={[styles.formInput, { marginTop: 4, minHeight: 72, textAlignVertical: "top" }]} placeholder="Solution / Explanation (optional)" placeholderTextColor={Colors.light.textMuted} value={q.solution || ""} onChangeText={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], solution: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} multiline blurOnSubmit={false} />
                    <View style={{ marginTop: 4, gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Solution Image (optional)</Text>
                      <AdminImageBoxInline imageUrl={q.solution_image_url || ""} onUrlChange={(v) => { const nq = [...editMission.questions]; nq[idx] = { ...nq[idx], solution_image_url: v }; setEditMission((p: any) => ({ ...p, questions: nq })); }} />
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 10 }}>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}12` }}
                      onPress={() => setEditMission((p: any) => {
                        const list = [...(p.questions || [])];
                        list.splice(idx + 1, 0, { question: "", options: ["", "", "", ""], correct: "A", topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" });
                        return { ...p, questions: list };
                      })}
                    >
                      <Ionicons name="add-circle-outline" size={17} color={Colors.light.primary} />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add below</Text>
                    </Pressable>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#9333EA", backgroundColor: "#F5F3FF" }}
                      onPress={() => setEditMission((p: any) => {
                        const list = [...(p.questions || [])];
                        const src = list[idx];
                        const copy = { ...src, options: [...(src.options || ["", "", "", ""])] };
                        list.splice(idx + 1, 0, copy);
                        return { ...p, questions: list };
                      })}
                    >
                      <Ionicons name="copy-outline" size={17} color="#9333EA" />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate below</Text>
                    </Pressable>
                  </View>
                  </React.Fragment>
                ))}
                <Pressable style={styles.addQBtn} onPress={() => setEditMission((p: any) => ({ ...p, questions: [...(p.questions || []), { question: "", options: ["","","",""], correct: "A", topic: "", marks: "", solution: "", image_url: "", solution_image_url: "", subtopic: "" }] }))}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.light.primary} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Add Question</Text>
                </Pressable>
              </View>
            </ScrollView>
            <Pressable
              style={[styles.createBtn, (!editMission?.title || !editMission?.questions?.length) && styles.createBtnDisabled]}
              disabled={!editMission?.title || !editMission?.questions?.length || updateMissionMutation.isPending}
              onPress={() => {
                const linked = courses.find((c) => c.id === editMission.course_id);
                if (linked?.course_type === "multi_subject" && !String(editMission?.subject_key || "").trim()) {
                  Alert.alert("Subject required", "Select a subject for this multisubject course mission.");
                  return;
                }
                const questions = (editMission.questions || []).map((q: any, i: number) => ({ id: i + 1, ...q, marks: q.marks ? parseFloat(q.marks) : undefined }));
                updateMissionMutation.mutate({
                  id: editMission.id,
                  title: editMission.title,
                  description: editMission.description,
                  questions,
                  missionDate: editMission.mission_date,
                  missionType: editMission.mission_type,
                  courseId: editMission.course_id || null,
                  folderName: editMission.folder_name?.trim() || null,
                  subjectKey: String(editMission?.subject_key || "").trim() || null,
                });
              }}>
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                {updateMissionMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.createBtnText}>Save Changes</Text>}
              </LinearGradient>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Mission Bulk Upload Modal */}
      <Modal visible={showMissionBulkUpload} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bulk Upload Questions</Text>
              <Pressable onPress={() => { setShowMissionBulkUpload(false); setMissionBulkError(null); setMissionBulkMode("text"); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginBottom: 8 }}>
              {(["text", "pdf"] as const).map((mode) => (
                <Pressable
                  key={mode}
                  onPress={() => { setMissionBulkMode(mode); setMissionBulkError(null); }}
                  style={{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center", backgroundColor: missionBulkMode === mode ? Colors.light.primary : "#F3F4F6" }}
                >
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: missionBulkMode === mode ? "#fff" : Colors.light.text, textTransform: "uppercase" }}>{mode}</Text>
                </Pressable>
              ))}
            </View>
            {missionBulkMode === "text" ? (
            <ScrollView style={styles.modalScroll}>
              <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 }}>
                Paste questions in format:{"\n"}Q1. Question text{"\n"}A) Option A{"\n"}B) Option B{"\n"}C) Option C{"\n"}D) Option D{"\n"}Answer: A
              </Text>
              <TextInput
                style={[styles.formInput, { height: 200, textAlignVertical: "top" }]}
                placeholder="Paste questions here..."
                placeholderTextColor={Colors.light.textMuted}
                value={missionBulkText}
                onChangeText={setMissionBulkText}
                multiline
              />
            </ScrollView>
            ) : (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 12 }}>
                Upload a PDF with numbered questions and A/B/C/D options (same format as test bulk upload).
              </Text>
              {missionBulkError ? (
                <Text style={{ fontSize: 12, color: "#EF4444", marginBottom: 8, fontFamily: "Inter_500Medium" }}>{missionBulkError}</Text>
              ) : null}
              <Pressable
                style={[styles.addQBtn, { backgroundColor: "#FFF3E0", justifyContent: "center", paddingVertical: 24 }]}
                disabled={missionPdfLoading}
                onPress={async () => {
                  setMissionBulkError(null);
                  const handleFile = async (file: any) => {
                    setMissionPdfLoading(true);
                    try {
                      const parsed = await parseMissionQuestionsPdf(file);
                      setMissionQuestions((prev) => [...prev, ...parsed]);
                      setShowMissionBulkUpload(false);
                      setMissionBulkMode("text");
                      Alert.alert("Success", `${parsed.length} question(s) added.`);
                    } catch (err: any) {
                      const msg = err?.message || "Failed to parse PDF";
                      setMissionBulkError(msg);
                      Alert.alert("PDF Parse Error", msg);
                    } finally {
                      setMissionPdfLoading(false);
                    }
                  };
                  if (Platform.OS === "web") {
                    const input = document.createElement("input");
                    input.type = "file";
                    input.accept = ".pdf";
                    input.onchange = (e: any) => {
                      const file = e.target?.files?.[0];
                      if (file) void handleFile(file);
                    };
                    input.click();
                  } else {
                    try {
                      const DocumentPicker = await import("expo-document-picker");
                      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
                      if (!result.canceled && result.assets?.[0]) void handleFile(result.assets[0]);
                    } catch {
                      Alert.alert("Error", "Could not open file picker");
                    }
                  }
                }}
              >
                {missionPdfLoading ? <ActivityIndicator color="#FF6B35" /> : <Ionicons name="cloud-upload-outline" size={28} color="#FF6B35" />}
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FF6B35" }}>{missionPdfLoading ? "Parsing PDF..." : "Select PDF"}</Text>
              </Pressable>
            </View>
            )}
            {missionBulkMode === "text" && (
            <Pressable
              style={[styles.createBtn, !missionBulkText.trim() && styles.createBtnDisabled]}
              disabled={!missionBulkText.trim()}
              onPress={() => {
                try {
                  const lines = missionBulkText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((l: string) => l.trim());
                  const isQuestion = (l: string) => /^(Q\.?\s*\d+|Q\d+|\d+[\.\)\:])\s*[\.\)\:]?\s*.+/i.test(l);
                  const isOption = (l: string) => /^[\(\[]?[AaBbCcDd][\)\]\.\:][\s\)]/.test(l) || /^\([AaBbCcDd]\)/.test(l);
                  const getOptionLetter = (l: string) => { const m = l.match(/^[\(\[]?([AaBbCcDd])[\)\]\.\:]/); return m ? m[1].toUpperCase() : ""; };
                  const stripOptionPrefix = (l: string) => l.replace(/^[\(\[]?[AaBbCcDd][\)\]\.\:]\s*/, "").replace(/^\([AaBbCcDd]\)\s*/, "").trim();
                  const stripQuestionPrefix = (l: string) => l.replace(/^(Q\.?\s*\d+|Q\d+|\d+)[\.\)\:]?\s*/i, "").trim();
                  const isAnswer = (l: string) => /^(Answer|Ans|Correct\s*Answer|Key)[\s\:\.\-]*[:\-]?\s*[\(\[]?[A-Da-d][\)\]]?/i.test(l);
                  const getAnswerLetter = (l: string) => { const m = l.match(/[\(\[]?([A-Da-d])[\)\]]?\s*$/); if (m) return m[1].toUpperCase(); const m2 = l.match(/[:\-\s][\(\[]?([A-Da-d])[\)\]]?/i); if (m2) return m2[1].toUpperCase(); return "A"; };
                  const result: { question: string; options: string[]; correct: string; topic: string; subtopic: string; marks: string; solution: string; image_url: string; solution_image_url: string }[] = [];
                  let curQ = "", opts: Record<string, string> = {}, correct = "A";
                  const flush = () => {
                    if (curQ && (opts["A"] || opts["B"])) {
                      result.push({ question: curQ, options: [opts["A"] || "", opts["B"] || "", opts["C"] || "", opts["D"] || ""], correct, topic: "", subtopic: "", marks: "", solution: "", image_url: "", solution_image_url: "" });
                    }
                    curQ = ""; opts = {}; correct = "A";
                  };
                  for (const line of lines) {
                    if (!line) continue;
                    if (isQuestion(line)) { flush(); curQ = stripQuestionPrefix(line); }
                    else if (isOption(line)) { const l = getOptionLetter(line); if (l) opts[l] = stripOptionPrefix(line); }
                    else if (isAnswer(line)) { correct = getAnswerLetter(line); }
                    else if (curQ && Object.keys(opts).length === 0) { curQ += " " + line; }
                  }
                  flush();
                  if (result.length === 0) { Alert.alert("Parse Error", "No questions found. Check the format."); return; }
                  setMissionQuestions((prev) => [...prev, ...result]);
                  setMissionBulkText("");
                  setShowMissionBulkUpload(false);
                  Alert.alert("Success", `${result.length} question(s) added.`);
                } catch (e) {
                  Alert.alert("Error", "Failed to parse questions.");
                }
              }}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.createBtnGrad}>
                <Text style={styles.createBtnText}>Parse & Add Questions</Text>
              </LinearGradient>
            </Pressable>
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
  adminCard: { backgroundColor: Colors.light.card, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  adminCardContent: { flex: 1, gap: 4 },
  adminCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  adminCardTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  adminCardMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  adminCardMetaText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  adminCompactCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    width: "100%",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 12,
  },
  adminCompactChipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  adminCardActions: { flexDirection: "row", gap: 8 },
  editBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  deleteBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  menuBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  userCard: { backgroundColor: Colors.light.card, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  userAvatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  userContact: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  roleBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 12, gap: 6 },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted },
  statValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
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
