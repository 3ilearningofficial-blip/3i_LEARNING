import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Platform, ActivityIndicator, Alert, Modal, Switch, Image, Linking,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import { liveClassesForCourseQueryKey, liveClassesQueryKey } from "@/lib/query-keys";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { fetch } from "expo/fetch";
import BulkUploadModal from "@/components/BulkUploadModal";
import { buildRecordingLectureSectionTitle, DEFAULT_LIVE_RECORDING_SECTION, getContentFolderRootName } from "@shared/recordingSection";
import { useDocumentVisibility } from "@/lib/useDocumentVisibility";
import SortableList from "@/components/admin/SortableList";
import SortableItem from "@/components/admin/SortableItem";
import { MULTI_SUBJECTS, SubjectIcon, getSubjectMeta } from "@/constants/multiSubjects";
import { downloadAdminContent } from "@/lib/admin-export";

interface Lecture {
  id: number;
  title: string;
  video_url: string;
  duration_minutes: number;
  order_index: number;
  is_free_preview: boolean;
  section_title?: string;
  subject_key?: string | null;
}

interface TestItem {
  id: number;
  title: string;
  total_questions: number;
  duration_minutes: number;
  test_type: string;
  folder_name?: string;
  subject_key?: string | null;
  difficulty?: string;
  order_index?: number;
}

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  section_title?: string;
  subject_key?: string | null;
  download_allowed?: boolean;
  order_index?: number;
}

interface LiveClassItem {
  id: number;
  title: string;
  youtube_url: string;
  recording_url?: string | null;
  cf_playback_hls?: string | null;
  board_snapshot_url?: string | null;
  stream_type?: string | null;
  is_live: boolean;
  is_completed: boolean;
  is_public: boolean;
  scheduled_at: number;
  subject_key?: string | null;
}

interface EnrolledStudent {
  id: number;
  user_id: number;
  name: string;
  email: string;
  phone?: string;
  enrolled_at: string;
  progress_percent: number;
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
  multi_subject_config?: any[];
  teacher_details_json?: any;
  teacher_bio?: string | null;
  teacher_image_url?: string | null;
  thumbnail?: string | null;
  course_language?: string | null;
  batch_status?: string | null;
  total_students?: number;
  validity_months?: number | null;
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
  validityMonths: string;
  thumbnail: string;
  courseLanguage: string;
  batchStatus: string;
}

type AboutTeacher = {
  name: string;
  imageUrl: string;
  bio: string;
};

type CourseAboutForm = {
  description: string;
  features: string;
  teachers: AboutTeacher[];
};

interface NewLecture {
  title: string; description: string; videoUrl: string;
  videoType: string; durationMinutes: string; orderIndex: string;
  isFreePreview: boolean; sectionTitle: string; subjectKey: string;
}

interface NewTestForm {
  title: string; description: string; durationMinutes: string;
  totalMarks: string; testType: string; folderName: string; difficulty: string; scheduledAt: string; subjectKey: string;
}

interface NewQuestion {
  questionText: string; optionA: string; optionB: string;
  optionC: string; optionD: string; correctOption: string;
  explanation: string; topic: string; marks: string; negativeMarks: string;
  imageUrl: string; solutionImageUrl: string; difficulty: string;
}

interface NewMaterial {
  title: string; description: string; fileUrl: string;
  fileType: string; isFree: boolean; sectionTitle: string;
  downloadAllowed: boolean; subjectKey: string;
}

interface NewLiveClass {
  title: string; description: string; youtubeUrl: string;
  scheduledAt: string; isLive: boolean; isPublic: boolean;
  /** Main section (e.g. "Live Class Recordings") for auto-saved recording */
  lectureSectionTitle: string;
  /** Optional subfolder segment (e.g. "Chapter 1") — full path = main + " / " + sub */
  lectureSubfolderTitle: string;
  subjectKey: string;
}

type AdminCourseTab = "about" | "lectures" | "tests" | "pyqs" | "mocks" | "materials" | "live" | "enrolled";

const ADMIN_COURSE_TABS: { key: AdminCourseTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "about", label: "About", icon: "information-circle" },
  { key: "live", label: "Live", icon: "radio" },
  { key: "lectures", label: "Lectures", icon: "videocam" },
  { key: "tests", label: "Tests", icon: "document-text" },
  { key: "pyqs", label: "PYQs", icon: "school" },
  { key: "mocks", label: "Mock Tests", icon: "clipboard" },
  { key: "materials", label: "Materials", icon: "folder" },
  { key: "enrolled", label: "Students", icon: "people" },
];

const emptyLecture: NewLecture = { title: "", description: "", videoUrl: "", videoType: "youtube", durationMinutes: "0", orderIndex: "0", isFreePreview: false, sectionTitle: "", subjectKey: "" };
const TEST_TYPES = ["practice", "test", "pyq", "mock"];
const emptyTest: NewTestForm = { title: "", description: "", durationMinutes: "60", totalMarks: "100", testType: "practice", folderName: "", difficulty: "moderate", scheduledAt: "", subjectKey: "" };
const emptyQuestion: NewQuestion = { questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1", imageUrl: "", solutionImageUrl: "", difficulty: "moderate" };
const emptyMaterial: NewMaterial = { title: "", description: "", fileUrl: "", fileType: "pdf", isFree: false, sectionTitle: "", downloadAllowed: false, subjectKey: "" };
const emptyLiveClass: NewLiveClass = { title: "", description: "", youtubeUrl: "", scheduledAt: "", isLive: false, isPublic: false, lectureSectionTitle: "Live Class Recordings", lectureSubfolderTitle: "", subjectKey: "" };
const COURSE_TABS = new Set<AdminCourseTab>(["about", "lectures", "tests", "pyqs", "mocks", "materials", "live", "enrolled"]);

function normalizeBatchStatus(value: unknown): "live" | "recorded" {
  const status = String(value || "").toLowerCase();
  return status === "recorded" || status === "completed" ? "recorded" : "live";
}

const NORMAL_COURSE_TAB_ORDER: AdminCourseTab[] = ["about", "lectures", "tests", "mocks", "materials", "live", "enrolled"];

// Multi-subject admin layout: the top-level header shows About | subjects | Students.
// Selecting a subject reveals these content sub-tabs (same order as the student subject screen).
const MULTI_CONTENT_TAB_KEYS: AdminCourseTab[] = ["live", "lectures", "tests", "pyqs", "mocks", "materials"];

function parseCourseAboutMeta(value: any): { features: string[]; teachers: AboutTeacher[] } {
  const raw = typeof value === "string" ? (() => { try { return JSON.parse(value); } catch { return value; } })() : value;
  if (Array.isArray(raw)) {
    return {
      features: [],
      teachers: raw.map((t: any) => ({
        name: String(t?.name || "").trim(),
        imageUrl: String(t?.imageUrl || t?.image_url || "").trim(),
        bio: String(t?.bio || t?.description || "").trim(),
      })).filter((t: AboutTeacher) => t.name || t.imageUrl || t.bio),
    };
  }
  if (raw && typeof raw === "object") {
    const teachers = Array.isArray(raw.teachers) ? raw.teachers : [];
    const features = Array.isArray(raw.features) ? raw.features : [];
    return {
      features: features.map((f: any) => String(f || "").trim()).filter(Boolean),
      teachers: teachers.map((t: any) => ({
        name: String(t?.name || "").trim(),
        imageUrl: String(t?.imageUrl || t?.image_url || "").trim(),
        bio: String(t?.bio || t?.description || "").trim(),
      })).filter((t: AboutTeacher) => t.name || t.imageUrl || t.bio),
    };
  }
  return { features: [], teachers: [] };
}

const LIVE_RECORDING_ROOT = DEFAULT_LIVE_RECORDING_SECTION;

function splitLectureSectionPath(sectionTitle: unknown): { root: string; subfolder: string } {
  const raw = String(sectionTitle || "").trim();
  if (!raw) return { root: "", subfolder: "" };
  const parts = raw
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) return { root: parts[0] || "", subfolder: "" };
  return { root: parts.slice(0, -1).join(" / "), subfolder: parts[parts.length - 1] || "" };
}

function composeLectureSectionPath(sectionTitle: unknown, subfolderTitle: unknown): string | null {
  const mainParts = String(sectionTitle || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  const subParts = String(subfolderTitle || "")
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!mainParts.length && !subParts.length) return null;
  if (!subParts.length) return mainParts.join(" / ") || null;
  if (!mainParts.length) return subParts.join(" / ");

  const mainPath = mainParts.join(" / ");
  const subPath = subParts.join(" / ");
  if (mainPath.endsWith(` / ${subPath}`) || mainPath === subPath) return mainPath;
  if (subPath.startsWith(`${mainPath} /`)) return subPath;
  return [...mainParts, ...subParts].join(" / ");
}

export default function AdminCourseScreen() {
  const { colors, isDarkMode } = useAppTheme();
  useEffect(() => {
    if (Platform.OS !== "web" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('[aria-hidden="true"]')) activeElement.blur();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
    return () => observer.disconnect();
  }, []);

  const { id, tab: tabParam, fromLiveEnd } = useLocalSearchParams<{
    id: string;
    tab?: string;
    fromLiveEnd?: string;
  }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminCourseTab>(() => {
    const fromUrl = String(tabParam || "").toLowerCase();
    if (COURSE_TABS.has(fromUrl as AdminCourseTab)) {
      return fromUrl as AdminCourseTab;
    }
    return "lectures";
  });

  useEffect(() => {
    const fromUrl = String(tabParam || "").toLowerCase();
    if (COURSE_TABS.has(fromUrl as AdminCourseTab)) {
      setActiveTab(fromUrl as AdminCourseTab);
    }
  }, [tabParam]);

  useEffect(() => {
    if (String(fromLiveEnd || "") !== "1") return;
    setOpenAdminFolder(null);
    setShowAddLecture(false);
    setShowAddLiveClass(false);
    setShowFolderPicker(null);
  }, [fromLiveEnd]);
  const [showAddLecture, setShowAddLecture] = useState(false);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState<number | null>(null);
  /** Insert manual add immediately after this question id when saving */
  const [addQuestionAfterId, setAddQuestionAfterId] = useState<number | null>(null);
  const [showViewQuestions, setShowViewQuestions] = useState<number | null>(null); // test id for viewing questions
  const [questionsList, setQuestionsList] = useState<any[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [editQuestion, setEditQuestion] = useState<any>(null);
  /** When opening Add Question from the Questions modal, reopen that modal after close/success */
  const resumeQuestionsModalAfterAddRef = useRef<number | null>(null);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddLiveClass, setShowAddLiveClass] = useState(false);
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [editForm, setEditForm] = useState<EditCourseForm>({
    title: "", description: "", teacherName: "", price: "0", originalPrice: "0",
    category: "", subject: "", isFree: false, isPublished: true, level: "beginner", durationHours: "0", startDate: "", endDate: "", validityMonths: "",
    thumbnail: "", courseLanguage: "HINGLISH", batchStatus: "live",
  });
  const [aboutForm, setAboutForm] = useState<CourseAboutForm>({
    description: "",
    features: "",
    teachers: [{ name: "", imageUrl: "", bio: "" }],
  });
  const [showBulkUpload, setShowBulkUpload] = useState<number | null>(null);
  const [bulkUploadMode, setBulkUploadMode] = useState<"text" | "pdf">("text");
  const [newLecture, setNewLecture] = useState<NewLecture>(emptyLecture);
  const [newTest, setNewTest] = useState<NewTestForm>(emptyTest);
  const [newQuestion, setNewQuestion] = useState<NewQuestion>(emptyQuestion);
  const [newMaterial, setNewMaterial] = useState<NewMaterial>(emptyMaterial);
  const [newLiveClass, setNewLiveClass] = useState<NewLiveClass>(emptyLiveClass);
  const [liveClasses, setLiveClasses] = useState<LiveClassItem[]>([]);
  // Folder state
  const [showFolderPicker, setShowFolderPicker] = useState<"lecture" | "test" | "material" | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParentId, setNewFolderParentId] = useState<number | null>(null);
  const [openAdminFolder, setOpenAdminFolder] = useState<{ id?: number; name: string; type: "lecture" | "test" | "material" } | null>(null);
  /** Create "parent / child" lecture folder name (matches lecture section_title for recordings) */
  const [showLectureSubfolderModal, setShowLectureSubfolderModal] = useState(false);
  const [lectureSubfolderLeafName, setLectureSubfolderLeafName] = useState("");
  const [folderAddMode, setFolderAddMode] = useState(false);
  const [folderAddModal, setFolderAddModal] = useState(false); // modal-based add inside folder
  const [folderEditItem, setFolderEditItem] = useState<any>(null); // inline edit inside folder
  const [folderActionSheet, setFolderActionSheet] = useState<any>(null);
  const [studentActionSheet, setStudentActionSheet] = useState<any>(null);
  // Edit folder
  const [editFolderModal, setEditFolderModal] = useState(false);
  const [editFolderName, setEditFolderName] = useState("");
  const [editingFolderId, setEditingFolderId] = useState<number | null>(null);
  // Edit items (outside folder — modals at root level)
  const [editLecture, setEditLecture] = useState<any>(null);
  const [editTest, setEditTest] = useState<any>(null);
  const [editMaterial, setEditMaterial] = useState<any>(null);
  const [selectedAdminTest, setSelectedAdminTest] = useState<any | null>(null);
  const [adminTestQuestions, setAdminTestQuestions] = useState<any[]>([]);
  const [adminTestAttempts, setAdminTestAttempts] = useState<any[]>([]);
  const [adminTestAttemptsLoading, setAdminTestAttemptsLoading] = useState(false);
  const [selectedTestAttempt, setSelectedTestAttempt] = useState<any | null>(null);
  // Edit items (inside folder — modals inside folder modal)
  const [folderEditLecture, setFolderEditLecture] = useState<any>(null);
  const [folderEditTest, setFolderEditTest] = useState<any>(null);
  const [folderEditMaterial, setFolderEditMaterial] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeSubjectKey, setActiveSubjectKey] = useState("maths");
  const courseIdNum = Number(id);
  const tabVisible = useDocumentVisibility();

  const inferLectureVideoType = (url: string): string => {
    const u = (url || "").trim().toLowerCase();
    if (!u) return "youtube";
    if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
    if (u.includes("drive.google.com")) return "gdrive";
    if (u.includes("/api/media/") || u.includes("r2.dev") || u.includes("cdn.") || u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".mkv")) return "r2";
    return "upload";
  };

  const pickFileAndUpload = async (folder: "lectures" | "materials" | "images", accept: string, onDone: (url: string) => void) => {
    try {
      if (Platform.OS === "web") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.onchange = async (e: any) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploading(true); setUploadProgress(0);
          try {
            const blobUrl = URL.createObjectURL(file);
            const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || getMimeType(file.name), folder, (pct) => setUploadProgress(pct));
            URL.revokeObjectURL(blobUrl);
            onDone(publicUrl);
            setUploading(false); setUploadProgress(0);
          } catch (err: any) {
            Alert.alert("Upload Failed", err?.message || "Could not upload file.");
            setUploading(false); setUploadProgress(0);
          }
        };
        input.click();
      } else {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 1 });
        if (result.canceled || !result.assets[0]) return;
        setUploading(true); setUploadProgress(0);
        const asset = result.assets[0];
        const { publicUrl } = await uploadToR2(asset.uri, asset.fileName || `file-${Date.now()}`, asset.mimeType || getMimeType(asset.fileName || ""), folder, (pct) => setUploadProgress(pct));
        onDone(publicUrl);
        setUploading(false); setUploadProgress(0);
      }
    } catch (err: any) {
      Alert.alert("Upload Failed", err?.message || "Could not upload file.");
      setUploading(false); setUploadProgress(0);
    }
  };

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const isValidId = !!id && id !== "undefined" && id !== "null";
  const unwrapPayload = (raw: any) => {
    if (
      raw &&
      typeof raw === "object" &&
      typeof raw.success === "boolean" &&
      "data" in raw
    ) {
      return raw.success ? raw.data : null;
    }
    return raw;
  };

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", String(id)],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      const res = await authFetch(url.toString());
      const raw = await res.json().catch(() => null);
      const payload = unwrapPayload(raw);
      if (!payload || typeof payload !== "object") {
        return {
          id: Number(id) || 0,
          title: "",
          is_free: false,
          total_lectures: 0,
          total_tests: 0,
          lectures: [],
          tests: [],
          materials: [],
        } as CourseDetail;
      }
      return {
        ...payload,
        lectures: Array.isArray((payload as any).lectures) ? (payload as any).lectures : [],
        tests: Array.isArray((payload as any).tests) ? (payload as any).tests : [],
        materials: Array.isArray((payload as any).materials) ? (payload as any).materials : [],
      } as CourseDetail;
    },
    enabled: isValidId,
    staleTime: 0,
    refetchInterval:
      tabVisible && ["lectures", "tests", "pyqs", "mocks", "materials"].includes(activeTab) ? 10_000 : false,
  });

  const { data: courseLiveClasses = [], isPending: courseLivePending } = useQuery<LiveClassItem[]>({
    queryKey: ["/api/live-classes", id, "admin"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes?courseId=${id}&admin=true`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      const raw = await res.json().catch(() => []);
      const payload = unwrapPayload(raw);
      return Array.isArray(payload) ? payload : [];
    },
    enabled: isValidId,
    staleTime: 30_000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: tabVisible && activeTab === "live" ? 8000 : false,
  });

  const { data: dbFolders = [], refetch: refetchFolders } = useQuery<any[]>({
    queryKey: ["/api/admin/courses", id, "folders"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/courses/${id}/folders`, baseUrl).toString());
      if (!res.ok) return [];
      const payload = await res.json().catch(() => []);
      return Array.isArray(payload) ? payload : [];
    },
    enabled: isValidId,
  });

  const { data: enrolledStudents = [], isPending: enrolledStudentsPending } = useQuery<EnrolledStudent[]>({
    queryKey: ["/api/admin/courses", id, "enrolled"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/courses/${id}/enrollments`, baseUrl).toString());
      if (!res.ok) return [];
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data) ? data : [];
      return rows.map((s: any) => ({
        ...s,
        name: s.user_name || s.name || "Unknown",
        email: s.user_email || s.email || "",
        phone: s.user_phone || s.phone || "",
      }));
    },
    enabled: isValidId,
    staleTime: 60_000,
    gcTime: 15 * 60 * 1000,
  });

  const allCourseLectures = Array.isArray(course?.lectures) ? course.lectures : [];
  const allCourseTests = Array.isArray(course?.tests) ? course.tests : [];
  const allCourseMaterials = Array.isArray(course?.materials) ? course.materials : [];
  const isMultiSubjectCourse = course?.course_type === "multi_subject";
  const subjectMatches = (row: { subject_key?: string | null }) =>
    !isMultiSubjectCourse || String(row.subject_key || "").toLowerCase() === activeSubjectKey;
  const courseLectures = allCourseLectures.filter(subjectMatches);
  const subjectTests = allCourseTests.filter(subjectMatches);
  const activeTestType = activeTab === "pyqs" ? "pyq" : activeTab === "mocks" ? "mock" : "";
  const courseTests = activeTestType
    ? subjectTests.filter((test: any) => String(test.test_type || "").toLowerCase() === activeTestType)
    : subjectTests.filter((test: any) => !["pyq", "mock"].includes(String(test.test_type || "").toLowerCase()));
  const pyqTests = subjectTests.filter((test: any) => String(test.test_type || "").toLowerCase() === "pyq");
  const mockTests = subjectTests.filter((test: any) => String(test.test_type || "").toLowerCase() === "mock");
  const courseMaterials = allCourseMaterials.filter(subjectMatches);
  const scopedCourseLiveClasses = courseLiveClasses.filter(subjectMatches);

  useEffect(() => {
    if (!course || course.course_type === "test_series") return;
    const meta = parseCourseAboutMeta((course as any).teacher_details_json);
    const teachers = meta.teachers.length > 0 ? meta.teachers : [{
      name: course.teacher_name || "",
      imageUrl: course.teacher_image_url || "",
      bio: course.teacher_bio || "",
    }];
    setAboutForm({
      description: course.description || "",
      features: meta.features.join("\n"),
      teachers,
    });
  }, [course?.id, course?.course_type]);

  useEffect(() => {
    if (course?.course_type !== "multi_subject") return;
    setOpenAdminFolder(null);
    setFolderAddModal(false);
    setShowFolderPicker(null);
  }, [activeSubjectKey, course?.course_type]);

  const applyDeleteOptimisticUpdate = (entity: "lecture" | "test" | "material", itemId: number) => {
    qc.setQueryData<CourseDetail | undefined>(["/api/courses", String(id)], (prev) => {
      if (!prev) return prev;
      if (entity === "lecture") {
        return {
          ...prev,
          lectures: (prev.lectures || []).filter((l) => Number(l.id) !== Number(itemId)),
          total_lectures: Math.max(0, Number(prev.total_lectures || 0) - 1),
        };
      }
      if (entity === "test") {
        return {
          ...prev,
          tests: (prev.tests || []).filter((t) => Number(t.id) !== Number(itemId)),
          total_tests: Math.max(0, Number(prev.total_tests || 0) - 1),
        };
      }
      const next: any = {
        ...prev,
        materials: (prev.materials || []).filter((m) => Number(m.id) !== Number(itemId)),
      };
      if (typeof (prev as any).total_materials === "number") {
        next.total_materials = Math.max(0, Number((prev as any).total_materials || 0) - 1);
      }
      return next;
    });

    qc.setQueryData<any[]>(["/api/courses"], (prev) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((c) => {
        if (Number(c?.id) !== Number(id)) return c;
        if (entity === "lecture") {
          return { ...c, total_lectures: Math.max(0, Number(c?.total_lectures || 0) - 1) };
        }
        if (entity === "test") {
          return { ...c, total_tests: Math.max(0, Number(c?.total_tests || 0) - 1) };
        }
        if (typeof c?.total_materials === "number") {
          return { ...c, total_materials: Math.max(0, Number(c?.total_materials || 0) - 1) };
        }
        return c;
      });
    });
  };
  const safeFolders = (Array.isArray(dbFolders) ? dbFolders : []).filter((folder: any) => {
    if (!isMultiSubjectCourse) return true;
    return String(folder?.subject_key || "").toLowerCase() === activeSubjectKey;
  });
  const folderFullName = (folder: any): string => String(folder?.full_name || folder?.name || "").trim();
  const folderLocalName = (folder: any): string => {
    if (folder?.name) return String(folder.name).trim();
    const full = folderFullName(folder);
    if (full.includes(" / ")) return full.split(" / ").pop()!.trim();
    return full;
  };
  const testMatchesFolder = (test: { folder_name?: string | null }, folderName: string) => {
    const fn = String(test.folder_name || "");
    return fn === folderName || fn.startsWith(`${folderName} /`);
  };
  const findFolderById = (folderId?: number | null) =>
    folderId ? safeFolders.find((f: any) => Number(f.id) === Number(folderId)) : null;
  const findFolderByPath = (name: string, type: "lecture" | "test" | "material") =>
    safeFolders.find((f: any) => f.type === type && folderFullName(f) === name);
  const openFolder = (folderName: string, type: "lecture" | "test" | "material") => {
    const folder = findFolderByPath(folderName, type);
    setFolderAddMode(false);
    setOpenAdminFolder({ id: folder?.id, name: folderName, type });
  };
  const LIVE_ROOT = DEFAULT_LIVE_RECORDING_SECTION;
  const livePlacementSubjectKey = isMultiSubjectCourse ? (newLiveClass.subjectKey || activeSubjectKey) : "";
  const livePlacementFolders = (Array.isArray(dbFolders) ? dbFolders : [])
    .filter((folder: any) => folder.type === "lecture")
    .filter((folder: any) => !isMultiSubjectCourse || String(folder.subject_key || "").toLowerCase() === livePlacementSubjectKey);
  const livePlacementRootFolders = livePlacementFolders.filter((folder: any) => !folder.parent_id);
  const livePlacementChildFolders = (parentName: string) => {
    const parent = livePlacementFolders.find((folder: any) => folderFullName(folder) === parentName);
    const byParent = parent?.id ? livePlacementFolders.filter((folder: any) => Number(folder.parent_id || 0) === Number(parent.id)) : [];
    const prefix = `${parentName} / `;
    const byPath = livePlacementFolders.filter((folder: any) => {
      const fullName = folderFullName(folder);
      if (!fullName.startsWith(prefix)) return false;
      const rest = fullName.slice(prefix.length);
      return rest && !rest.includes(" / ");
    });
    const map = new Map<string, any>();
    [...byParent, ...byPath].forEach((folder) => {
      const fullName = folderFullName(folder);
      if (fullName) map.set(fullName, folder);
    });
    return [...map.values()];
  };
  const getLectureRootName = getContentFolderRootName;
  const ensureLectureFolderByPath = async (pathName: string) => {
    const normalized = String(pathName || "").trim();
    if (!normalized) return null;
    let folder = findFolderByPath(normalized, "lecture");
    if (folder) return folder;
    const parts = splitLectureSectionPath(normalized);
    if (parts.subfolder && parts.root) {
      let parent = findFolderByPath(parts.root, "lecture");
      if (!parent) {
        const parentRes = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: parts.root, type: "lecture" });
        parent = await parentRes.json();
      }
      const childRes = await apiRequest("POST", `/api/admin/courses/${id}/folders`, {
        name: parts.subfolder,
        type: "lecture",
        parentId: parent?.id || null,
      });
      folder = await childRes.json();
    } else {
      const res = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: normalized, type: "lecture" });
      folder = await res.json();
    }
    await refetchFolders();
    return folder;
  };
  const getDirectLectureSubfolders = (parentName: string): string[] => {
    const parent = findFolderByPath(parentName, "lecture");
    const fromDbChildren = parent?.id
      ? safeFolders
          .filter((f: any) => f.type === "lecture" && Number(f.parent_id || 0) === Number(parent.id))
          .map(folderFullName)
          .filter(Boolean)
      : [];
    const prefix = `${parentName} / `;
    const fromLectures = courseLectures
      .map((l: any) => l.section_title)
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${parentName} / ${head}` : "";
      })
      .filter(Boolean);
    const fromFolders = safeFolders
      .filter((f: any) => f.type === "lecture")
      .map(folderFullName)
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${parentName} / ${head}` : "";
      })
      .filter(Boolean);
    return [...new Set([...fromDbChildren, ...fromLectures, ...fromFolders])];
  };

  const MAX_FOLDER_NAME_LEN = 120;
  const createFolderMutation = useMutation({
    mutationFn: async ({ name, type, parentId }: { name: string; type: string; parentId?: number | null }) => {
      const res = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name, type, parentId: parentId || null, subjectKey: isMultiSubjectCourse ? activeSubjectKey : null });
      return res.json();
    },
    onSuccess: () => {
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
    },
    onError: (e: any) => console.error("Create folder error:", e),
  });

  const updateFolderMutation = useMutation({
    mutationFn: async ({ folderId, isHidden }: { folderId: number; isHidden: boolean }) => {
      await apiRequest("PUT", `/api/admin/courses/${id}/folders/${folderId}`, { isHidden });
    },
    onSuccess: () => refetchFolders(),
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ folderId, name }: { folderId: number; name: string }) => {
      await apiRequest("PUT", `/api/admin/courses/${id}/folders/${folderId}`, { name });
    },
    onSuccess: (_data, variables) => {
      const renamedFullPath = (prevFullName: string, localName: string) => {
        if (prevFullName.includes(" / ")) {
          return `${prevFullName.slice(0, prevFullName.lastIndexOf(" / "))} / ${localName}`;
        }
        return localName;
      };
      setOpenAdminFolder((prev) => {
        if (!prev || Number(prev.id) !== Number(variables.folderId)) return prev;
        return { ...prev, name: renamedFullPath(prev.name, variables.name) };
      });
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/admin/courses", id, "folders"] });
    },
    onError: (err: any) => {
      const msg = String(err?.message || "").replace(/^\d+:\s*/, "") || "Failed to rename folder";
      Alert.alert("Error", msg);
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: number) => {
      await apiRequest("DELETE", `/api/admin/courses/${id}/folders/${folderId}`);
    },
    onSuccess: () => {
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
    },
  });

  const addLectureMutation = useMutation({
    mutationFn: async (data: NewLecture) => {
      if (!Number.isFinite(courseIdNum) || courseIdNum <= 0) throw new Error("Invalid course id");
      const title = (data.title || "").trim();
      const videoUrl = (data.videoUrl || "").trim();
      if (!title) throw new Error("Lecture title is required");
      if (!videoUrl) throw new Error("Video URL is required");
      const sectionTitle = (data.sectionTitle || "").trim();
      if (sectionTitle.includes(" / ")) {
        await ensureLectureFolderByPath(sectionTitle);
      }
      await apiRequest("POST", "/api/admin/lectures", {
        ...data,
        courseId: courseIdNum,
        title,
        videoUrl,
        videoType: inferLectureVideoType(videoUrl),
        durationMinutes: parseInt(data.durationMinutes) || 0,
        orderIndex: parseInt(data.orderIndex) || 0,
        sectionTitle: sectionTitle || null,
        subjectKey: isMultiSubjectCourse ? activeSubjectKey : (data.subjectKey || null),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      refetchFolders();
      setShowAddLecture(false); setFolderAddModal(false); setNewLecture(emptyLecture);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Lecture added!");
    },
    onError: (err: any) => Alert.alert("Error", err?.message?.replace(/^\S+\s->\s\d+:\s*/, "") || "Failed to add lecture"),
  });

  const deleteLectureMutation = useMutation({
    mutationFn: async (lectureId: number) => {
      await apiRequest("DELETE", `/api/admin/lectures/${lectureId}`);
    },
    onMutate: async (lectureId: number) => {
      await qc.cancelQueries({ queryKey: ["/api/courses", String(id)] });
      await qc.cancelQueries({ queryKey: ["/api/courses"] });
      const prevDetail = qc.getQueryData<CourseDetail>(["/api/courses", String(id)]);
      const prevList = qc.getQueryData<any[]>(["/api/courses"]);
      applyDeleteOptimisticUpdate("lecture", lectureId);
      return { prevDetail, prevList };
    },
    onError: (_err, _lectureId, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(["/api/courses", String(id)], ctx.prevDetail);
      if (ctx?.prevList) qc.setQueryData(["/api/courses"], ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
    },
  });

  const updateLectureMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/lectures/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); setEditLecture(null); setFolderEditLecture(null); setFolderEditItem(null); },
    onError: () => Alert.alert("Error", "Failed to update lecture"),
  });

  const addTestMutation = useMutation({
    mutationFn: async (data: NewTestForm) => {
      await apiRequest("POST", "/api/admin/tests", {
        ...data, courseId: parseInt(id),
        durationMinutes: parseInt(data.durationMinutes),
        totalMarks: parseInt(data.totalMarks),
        folderName: data.folderName || null,
        difficulty: data.difficulty || "moderate",
        scheduledAt: data.scheduledAt || null,
        subjectKey: isMultiSubjectCourse ? activeSubjectKey : (data.subjectKey || null),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      refetchFolders();
      setShowAddTest(false); setFolderAddModal(false); setNewTest(emptyTest);
      Alert.alert("Success", "Test created!");
    },
    onError: () => Alert.alert("Error", "Failed to create test"),
  });

  type AddQuestionMutationVars = {
    testId: number;
    data: NewQuestion;
    insertAfterQuestionId?: number | null;
    /** True when duplicating from the Questions list (stay on list and reload). */
    duplicateRefresh?: boolean;
  };

  const addQuestionMutation = useMutation({
    mutationFn: async ({ testId, data, insertAfterQuestionId }: AddQuestionMutationVars) => {
      const row: Record<string, unknown> = {
        testId,
        questionText: data.questionText,
        optionA: data.optionA,
        optionB: data.optionB,
        optionC: data.optionC || "",
        optionD: data.optionD || "",
        correctOption: data.correctOption,
        explanation: data.explanation || "",
        topic: data.topic || "",
        difficulty: (data as any).difficulty || "moderate",
        marks: parseInt(String(data.marks), 10) || 4,
        negativeMarks: parseFloat(String(data.negativeMarks)) || 1,
        imageUrl: data.imageUrl || null,
        solutionImageUrl: data.solutionImageUrl || null,
      };
      if (insertAfterQuestionId != null && Number.isFinite(insertAfterQuestionId)) {
        row.insertAfterQuestionId = insertAfterQuestionId;
      }
      await apiRequest("POST", "/api/admin/questions", [row]);
    },
    onSuccess: (_data, variables: AddQuestionMutationVars) => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      const resumeId = resumeQuestionsModalAfterAddRef.current;
      resumeQuestionsModalAfterAddRef.current = null;
      setShowAddQuestion(null);
      setNewQuestion(emptyQuestion);
      setAddQuestionAfterId(null);
      if (resumeId != null) {
        setShowViewQuestions(resumeId);
        void loadQuestions(resumeId);
      } else if (variables.duplicateRefresh && variables.testId) {
        void loadQuestions(variables.testId);
      }
      Alert.alert("Success", "Question added!");
    },
    onError: () => Alert.alert("Error", "Failed to add question"),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/admin/tests/${testId}`);
    },
    onMutate: async (testId: number) => {
      await qc.cancelQueries({ queryKey: ["/api/courses", String(id)] });
      await qc.cancelQueries({ queryKey: ["/api/courses"] });
      const prevDetail = qc.getQueryData<CourseDetail>(["/api/courses", String(id)]);
      const prevList = qc.getQueryData<any[]>(["/api/courses"]);
      applyDeleteOptimisticUpdate("test", testId);
      return { prevDetail, prevList };
    },
    onError: (_err, _testId, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(["/api/courses", String(id)], ctx.prevDetail);
      if (ctx?.prevList) qc.setQueryData(["/api/courses"], ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
    },
  });

  const updateTestMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/tests/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); setEditTest(null); setFolderEditTest(null); setFolderEditItem(null); },
    onError: () => Alert.alert("Error", "Failed to update test"),
  });

  const addMaterialMutation = useMutation({
    mutationFn: async (data: NewMaterial) => {
      if (!Number.isFinite(courseIdNum) || courseIdNum <= 0) throw new Error("Invalid course id");
      const title = (data.title || "").trim();
      const fileUrl = (data.fileUrl || "").trim();
      if (!title) throw new Error("Material title is required");
      if (!fileUrl) throw new Error("File URL is required");
      await apiRequest("POST", "/api/admin/study-materials", {
        ...data,
        courseId: courseIdNum,
        title,
        fileUrl,
        sectionTitle: data.sectionTitle || null,
        subjectKey: isMultiSubjectCourse ? activeSubjectKey : (data.subjectKey || null),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      refetchFolders();
      setShowAddMaterial(false); setFolderAddModal(false); setNewMaterial(emptyMaterial);
      Alert.alert("Success", "Material added!");
    },
    onError: (err: any) => Alert.alert("Error", err?.message?.replace(/^\S+\s->\s\d+:\s*/, "") || "Failed to add material"),
  });

  const deleteMaterialMutation = useMutation({
    mutationFn: async (materialId: number) => {
      await apiRequest("DELETE", `/api/admin/study-materials/${materialId}`);
    },
    onMutate: async (materialId: number) => {
      await qc.cancelQueries({ queryKey: ["/api/courses", String(id)] });
      await qc.cancelQueries({ queryKey: ["/api/courses"] });
      const prevDetail = qc.getQueryData<CourseDetail>(["/api/courses", String(id)]);
      const prevList = qc.getQueryData<any[]>(["/api/courses"]);
      applyDeleteOptimisticUpdate("material", materialId);
      return { prevDetail, prevList };
    },
    onError: (_err, _materialId, ctx) => {
      if (ctx?.prevDetail) qc.setQueryData(["/api/courses", String(id)], ctx.prevDetail);
      if (ctx?.prevList) qc.setQueryData(["/api/courses"], ctx.prevList);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
    },
  });

  const updateMaterialMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/study-materials/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); setEditMaterial(null); setFolderEditMaterial(null); setFolderEditItem(null); },
    onError: () => Alert.alert("Error", "Failed to update material"),
  });

  /**
   * reorderMutation — sends new order_index values for a group of tests or
   * materials to the server.  On success it invalidates the course detail query
   * so the list refreshes with the persisted order.
   */
  const reorderMutation = useMutation({
    mutationFn: async ({ itemType, items }: { itemType: "test" | "material" | "lecture" | "folder"; items: { id: number; orderIndex: number }[] }) => {
      await apiRequest("PATCH", `/api/admin/courses/${id}/reorder`, { itemType, items });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); },
    onError: () => Alert.alert("Error", "Failed to reorder items"),
  });

  /**
   * moveItem — swaps adjacent items in a filtered list and computes new
   * orderIndex values (0, 1, 2, …), then fires reorderMutation.
   * `allItems` is the full (already-sorted) list for this group so we can
   * update ALL items in the group in one request — preventing gaps.
   */
  const moveItem = (
    itemType: "test" | "material" | "lecture" | "folder",
    groupItems: { id: number }[],
    fromIdx: number,
    direction: "up" | "down"
  ) => {
    const toIdx = direction === "up" ? fromIdx - 1 : fromIdx + 1;
    if (toIdx < 0 || toIdx >= groupItems.length) return;
    const reordered = [...groupItems];
    const tmp = reordered[fromIdx];
    reordered[fromIdx] = reordered[toIdx];
    reordered[toIdx] = tmp;
    const payload = reordered.map((item, idx) => ({ id: item.id, orderIndex: idx }));
    reorderMutation.mutate({ itemType, items: payload });
  };

  /**
   * Called by SortableList after a drag-and-drop reorder.
   * Optimistically reorders the cached course detail so the item stays where
   * it was dropped immediately (no snap-back while the slow PATCH round-trips),
   * then persists. The server query (sorted by order_index) reconciles on the
   * next refetch; on error the invalidation restores the true server order.
   */
  const reorderByDrag = (
    itemType: "test" | "material" | "lecture",
    groupItems: { id: number }[],
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

    const orderById = new Map(payload.map((p) => [p.id, p.orderIndex]));
    const key = itemType === "test" ? "tests" : itemType === "material" ? "materials" : "lectures";
    qc.setQueryData<CourseDetail | undefined>(["/api/courses", String(id)], (prev) => {
      if (!prev || !Array.isArray((prev as any)[key])) return prev;
      const updated = (prev as any)[key]
        .map((it: any) => (orderById.has(it.id) ? { ...it, order_index: orderById.get(it.id) } : it))
        .sort((a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0));
      return { ...prev, [key]: updated } as CourseDetail;
    });

    reorderMutation.mutate({ itemType, items: payload });
  };

  /**
   * Folders are derived from a mix of item section names and course_folders
   * rows, so they are keyed by NAME (not numeric id) for drag. Order is
   * persisted via course_folders.order_index. Folders that exist only as an
   * item's section name (no row yet) are created on demand so the order can be
   * saved. Web-only drag; native keeps the order it reads back from the server.
   */
  const sortFolderNamesByOrder = (names: string[], type: "lecture" | "test" | "material"): string[] =>
    [...names].sort((a, b) => {
      const fa = findFolderByPath(a, type);
      const fb = findFolderByPath(b, type);
      const oa = fa?.order_index ?? Number.MAX_SAFE_INTEGER;
      const ob = fb?.order_index ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });

  const reorderFoldersByDrag = async (
    type: "lecture" | "test" | "material",
    folderNames: string[],
    activeName: string | number,
    overName: string | number
  ) => {
    const names = [...folderNames];
    const from = names.indexOf(String(activeName));
    const to = names.indexOf(String(overName));
    if (from === -1 || to === -1 || from === to) return;
    const [moved] = names.splice(from, 1);
    names.splice(to, 0, moved);

    // Optimistic: reflect the new folder order immediately (no snap-back).
    const orderByName = new Map(names.map((n, i) => [n, i] as const));
    qc.setQueryData<any[]>(["/api/admin/courses", id, "folders"], (prev) =>
      Array.isArray(prev)
        ? prev.map((f: any) =>
            f.type === type && orderByName.has(folderFullName(f))
              ? { ...f, order_index: orderByName.get(folderFullName(f)) }
              : f
          )
        : prev
    );

    try {
      const items: { id: number; orderIndex: number }[] = [];
      for (let i = 0; i < names.length; i += 1) {
        const name = names[i];
        let folderRow = findFolderByPath(name, type);
        if (!folderRow) {
          if (type === "lecture") {
            folderRow = await ensureLectureFolderByPath(name);
          } else {
            const created = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name, type });
            folderRow = await created.json();
          }
        }
        if (folderRow?.id != null) items.push({ id: Number(folderRow.id), orderIndex: i });
      }
      if (items.length) {
        await reorderMutation.mutateAsync({ itemType: "folder", items });
      }
      await refetchFolders();
    } catch {
      Alert.alert("Error", "Failed to reorder folders");
    }
  };

  const loadQuestions = async (testId: number) => {
    setQuestionsLoading(true);
    try {
      const res = await authFetch(new URL(`/api/admin/tests/${testId}/questions`, getApiUrl()).toString());
      if (res.ok) setQuestionsList(await res.json());
    } catch {}
    setQuestionsLoading(false);
  };

  const openAdminTestAttempts = async (test: any) => {
    setSelectedAdminTest(test);
    setSelectedTestAttempt(null);
    setAdminTestAttempts([]);
    setAdminTestQuestions([]);
    setAdminTestAttemptsLoading(true);
    try {
      const res = await authFetch(new URL(`/api/admin/tests/${test.id}/attempts`, getApiUrl()).toString());
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

  const closeAddQuestionModal = () => {
    const resumeId = resumeQuestionsModalAfterAddRef.current;
    resumeQuestionsModalAfterAddRef.current = null;
    setShowAddQuestion(null);
    setNewQuestion(emptyQuestion);
    setAddQuestionAfterId(null);
    if (resumeId != null) {
      setShowViewQuestions(resumeId);
      void loadQuestions(resumeId);
    }
  };

  const updateQuestionMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/questions/${data.id}`, data);
    },
    onSuccess: () => { if (showViewQuestions) loadQuestions(showViewQuestions); setEditQuestion(null); },
    onError: () => Alert.alert("Error", "Failed to update question"),
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (qId: number) => {
      await apiRequest("DELETE", `/api/admin/questions/${qId}`);
    },
    onSuccess: () => { if (showViewQuestions) loadQuestions(showViewQuestions); qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); },
  });

  const addLiveClassMutation = useMutation({
    mutationFn: async (data: NewLiveClass) => {
      const autoFolderName = buildRecordingLectureSectionTitle(data.lectureSectionTitle, data.lectureSubfolderTitle, null).trim();
      if (autoFolderName) {
        await apiRequest("POST", `/api/admin/courses/${id}/folders`, {
          name: autoFolderName,
          type: "lecture",
          subjectKey: isMultiSubjectCourse ? (data.subjectKey || activeSubjectKey) : null,
        }).catch(() => {});
      }
      await apiRequest("POST", "/api/admin/live-classes", {
        ...data,
        courseId: parseInt(id),
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).getTime() : Date.now(),
        lectureSectionTitle: (data.lectureSectionTitle || "").trim() || undefined,
        lectureSubfolderTitle: (data.lectureSubfolderTitle || "").trim() || undefined,
        subjectKey: isMultiSubjectCourse ? (data.subjectKey || activeSubjectKey) : null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
      qc.invalidateQueries({ queryKey: liveClassesForCourseQueryKey(id) });
      setShowAddLiveClass(false); setNewLiveClass(emptyLiveClass);
      Alert.alert("Success", "Live class added!");
    },
    onError: () => Alert.alert("Error", "Failed to add live class"),
  });

  const deleteLiveClassMutation = useMutation({
    mutationFn: async (lcId: number) => {
      await apiRequest("DELETE", `/api/admin/live-classes/${lcId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      qc.invalidateQueries({ queryKey: liveClassesForCourseQueryKey(id) });
    },
  });

  const updateLiveClassMutation = useMutation({
    mutationFn: async ({ lcId, ...data }: { lcId: number; isLive?: boolean; isCompleted?: boolean; youtubeUrl?: string; convertToLecture?: boolean; sectionTitle?: string }) => {
      await apiRequest("PUT", `/api/admin/live-classes/${lcId}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
      qc.invalidateQueries({ queryKey: liveClassesForCourseQueryKey(id) });
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
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
        validityMonths: data.validityMonths || null,
        thumbnail: data.thumbnail || null,
        courseLanguage: data.courseLanguage || null,
        batchStatus: isMultiSubjectCourse ? data.batchStatus || null : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      setShowEditCourse(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Course updated!");
    },
    onError: () => Alert.alert("Error", "Failed to update course"),
  });

  const saveAboutMutation = useMutation({
    mutationFn: async (data: CourseAboutForm) => {
      const teachers = data.teachers
        .map((teacher) => ({
          name: teacher.name.trim(),
          imageUrl: teacher.imageUrl.trim(),
          bio: teacher.bio.trim(),
        }))
        .filter((teacher) => teacher.name || teacher.imageUrl || teacher.bio);
      const features = data.features
        .split(/\r?\n/)
        .map((feature) => feature.trim())
        .filter(Boolean);
      const primaryTeacher = teachers[0] || { name: "", imageUrl: "", bio: "" };
      await apiRequest("PUT", `/api/admin/courses/${id}`, {
        title: course?.title || editForm.title,
        description: data.description,
        teacherName: primaryTeacher.name || course?.teacher_name || "3i Learning",
        price: editForm.price || course?.price || 0,
        originalPrice: editForm.originalPrice || course?.original_price || 0,
        category: editForm.category || course?.category || "Course",
        isFree: editForm.isFree ?? course?.is_free,
        level: editForm.level || course?.level || "Beginner",
        durationHours: editForm.durationHours || course?.duration_hours || 0,
        isPublished: editForm.isPublished ?? course?.is_published,
        teacherBio: primaryTeacher.bio || null,
        teacherImageUrl: primaryTeacher.imageUrl || null,
        teacherDetailsJson: { features, teachers },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      qc.invalidateQueries({ queryKey: ["/api/courses"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Saved", "Course about section updated.");
    },
    onError: () => Alert.alert("Error", "Failed to save course about section"),
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
        validityMonths: String((course as any).validity_months ?? ""),
        thumbnail: (course as any).thumbnail || "",
        courseLanguage: (course as any).course_language || "HINGLISH",
        batchStatus: normalizeBatchStatus((course as any).batch_status),
      });
      setShowEditCourse(true);
    }
  };

  if (!isValidId) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
          <Pressable style={styles.backBtn} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/admin" as any); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Select a Course</Text>
        </LinearGradient>
        <View style={styles.centered}>
          <Ionicons name="folder-open-outline" size={48} color={Colors.light.textMuted} />
          <Text style={styles.errorText}>Please select a course from the Admin Dashboard</Text>
          <Pressable style={styles.backBtnSimple} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/admin" as any); }}>
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
  const effectiveTab = isTestSeries && activeTab !== "enrolled" ? "tests" : (activeTab === "pyqs" || activeTab === "mocks" ? "tests" : activeTab);
  const testSectionLabel = activeTab === "pyqs" ? "PYQs" : activeTab === "mocks" ? "Mock Tests" : "Tests";
  // For multi-subject courses: a "content" tab (Live/Lectures/Tests/PYQs/Mock/Materials) means
  // a subject is selected at the top level. About and Students are subject-agnostic.
  const isContentTab = activeTab !== "about" && activeTab !== "enrolled";
  const MULTI_CONTENT_TABS = ADMIN_COURSE_TABS.filter((t) => MULTI_CONTENT_TAB_KEYS.includes(t.key));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Global upload progress overlay */}
      {uploading && (
        <View style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 9999,
          backgroundColor: "#0A1628", paddingVertical: 10, paddingHorizontal: 16,
          flexDirection: "row", alignItems: "center", gap: 12,
        }}>
          <ActivityIndicator size="small" color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", marginBottom: 4 }}>
              Uploading... {uploadProgress}%
            </Text>
            <View style={{ height: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 2, overflow: "hidden" }}>
              <View style={{ height: 4, backgroundColor: "#22C55E", borderRadius: 2, width: `${uploadProgress}%` as any }} />
            </View>
          </View>
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#22C55E" }}>{uploadProgress}%</Text>
        </View>
      )}
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/admin" as any); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{course.title}</Text>
            <Text style={styles.headerSub}>
              {isTestSeries ? "Test Series" : `${Number(course.total_lectures) || courseLectures.length} lectures`} · {subjectTests.length} tests · {enrolledStudents.length} students
            </Text>
          </View>
          <Pressable style={styles.editCourseBtn} onPress={openEditCourse}>
            <Ionicons name="create-outline" size={18} color="#fff" />
          </Pressable>
        </View>

        {isMultiSubjectCourse ? (
          <>
            {/* Top-level: About | Maths | English | Science | G.K | Students */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
              <Pressable
                style={[styles.tab, activeTab === "about" && styles.tabActive]}
                onPress={() => setActiveTab("about")}
              >
                <Ionicons name="information-circle" size={14} color={activeTab === "about" ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.tabText, activeTab === "about" && styles.tabTextActive]}>About</Text>
              </Pressable>
              {MULTI_SUBJECTS.map((subject) => {
                const selected = isContentTab && activeSubjectKey === subject.key;
                return (
                  <Pressable
                    key={subject.key}
                    style={[styles.tab, selected && styles.tabActive]}
                    onPress={() => {
                      setActiveSubjectKey(subject.key);
                      if (!isContentTab) setActiveTab("lectures");
                    }}
                  >
                    <SubjectIcon subject={subject} size={14} color={selected ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                    <Text style={[styles.tabText, selected && styles.tabTextActive]}>{subject.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                style={[styles.tab, activeTab === "enrolled" && styles.tabActive]}
                onPress={() => setActiveTab("enrolled")}
              >
                <Ionicons name="people" size={14} color={activeTab === "enrolled" ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.tabText, activeTab === "enrolled" && styles.tabTextActive]}>Students</Text>
              </Pressable>
            </ScrollView>
          </>
        ) : isTestSeries ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {ADMIN_COURSE_TABS.filter((t) => t.key === "tests" || t.key === "enrolled").map((tab) => (
              <Pressable
                key={tab.key}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Ionicons name={tab.icon} size={14} color={activeTab === tab.key ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
            {NORMAL_COURSE_TAB_ORDER.map((tabKey) => {
              const tab = ADMIN_COURSE_TABS.find((t) => t.key === tabKey);
              if (!tab) return null;
              return (
              <Pressable
                key={tab.key}
                style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
              >
                <Ionicons name={tab.icon} size={14} color={activeTab === tab.key ? Colors.light.primary : "rgba(255,255,255,0.6)"} />
                <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
              </Pressable>
              );
            })}
          </ScrollView>
        )}
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 80 }]}>
        {isMultiSubjectCourse && isContentTab && (() => {
          const activeSubject = MULTI_SUBJECTS.find((s) => s.key === activeSubjectKey);
          return (
            <View style={[styles.subjectContentNav, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.subjectContentNavHeader}>
                <View style={[styles.subjectContentNavBadge, { backgroundColor: Colors.light.primary + "18" }]}>
                  <SubjectIcon subject={activeSubject || getSubjectMeta(activeSubjectKey)} size={16} color={Colors.light.primary} />
                  <Text style={styles.subjectContentNavTitle}>{activeSubject?.label || activeSubjectKey} content</Text>
                </View>
                <Text style={[styles.subjectContentNavHint, { color: colors.textMuted }]}>Switch subject in the header above</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.subjectContentTabsRow}>
                {MULTI_CONTENT_TABS.map((tab) => {
                  const selected = activeTab === tab.key;
                  return (
                    <Pressable
                      key={tab.key}
                      style={[styles.subjectContentTab, selected && styles.subjectContentTabActive]}
                      onPress={() => setActiveTab(tab.key)}
                    >
                      <Ionicons name={tab.icon} size={14} color={selected ? "#fff" : Colors.light.primary} />
                      <Text style={[styles.subjectContentTabText, selected && styles.subjectContentTabTextActive]}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          );
        })()}

        {effectiveTab === "about" && !isTestSeries && (
          <View style={[styles.section, styles.aboutSectionWrap]}>
            <LinearGradient colors={["#EEF2FF", "#F8FAFC"]} style={[styles.itemCard, styles.aboutPanel, { borderWidth: 0 }]}>
              <View style={styles.sectionHeader}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={[styles.sectionTitle, { fontSize: 22 }]}>About Course</Text>
                  <Text style={[styles.infoText, { marginTop: 6 }]}>Shown on the student about page. Use bold, clear copy for course promise, features, and teachers.</Text>
                </View>
                <Pressable
                  style={[styles.addBtn, { opacity: saveAboutMutation.isPending ? 0.6 : 1 }]}
                  disabled={saveAboutMutation.isPending}
                  onPress={() => saveAboutMutation.mutate(aboutForm)}
                >
                  {saveAboutMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="save-outline" size={16} color="#fff" />}
                  <Text style={styles.addBtnText}>Save About</Text>
                </Pressable>
              </View>
            </LinearGradient>

            <View style={[styles.itemCard, styles.aboutPanel]}>
              <FormField
                label="Course Description"
                placeholder="Write what students will learn, batch goals, and course promise..."
                value={aboutForm.description}
                onChangeText={(v) => setAboutForm((p) => ({ ...p, description: v }))}
                multiline
                tall
              />
              <FormField
                label="Course Features"
                placeholder={"One feature per line\ne.g., Live doubt support\ne.g., Chapter-wise PYQs"}
                value={aboutForm.features}
                onChangeText={(v) => setAboutForm((p) => ({ ...p, features: v }))}
                multiline
                tall
              />
            </View>

            <View style={[styles.sectionHeader, styles.aboutTeachersHeader]}>
              <Text style={styles.sectionTitle}>Teachers ({aboutForm.teachers.length})</Text>
              <Pressable
                style={[styles.addBtn, { backgroundColor: "#7C3AED" }]}
                onPress={() => setAboutForm((p) => ({ ...p, teachers: [...p.teachers, { name: "", imageUrl: "", bio: "" }] }))}
              >
                <Ionicons name="person-add-outline" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Teacher</Text>
              </Pressable>
            </View>
            <View style={styles.aboutTeacherGrid}>
            {aboutForm.teachers.map((teacher, index) => (
              <View key={`teacher-${index}`} style={[styles.itemCard, styles.aboutPanel, styles.aboutTeacherCard]}>
                <View style={styles.aboutTeacherTopRow}>
                  {teacher.imageUrl ? (
                    <Image source={{ uri: teacher.imageUrl }} style={styles.aboutTeacherAvatar} />
                  ) : (
                    <View style={styles.aboutTeacherAvatarFallback}>
                      <Ionicons name="person" size={30} color={Colors.light.primary} />
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <FormField
                      label={`Teacher ${index + 1} Name`}
                      placeholder="Teacher name"
                      value={teacher.name}
                      onChangeText={(v) => setAboutForm((p) => ({ ...p, teachers: p.teachers.map((t, i) => i === index ? { ...t, name: v } : t) }))}
                    />
                  </View>
                  {aboutForm.teachers.length > 1 ? (
                    <Pressable
                      style={styles.deleteItemBtn}
                      onPress={() => setAboutForm((p) => ({ ...p, teachers: p.teachers.filter((_, i) => i !== index) }))}
                    >
                      <Ionicons name="trash-outline" size={16} color="#EF4444" />
                    </Pressable>
                  ) : null}
                </View>
                <FormField
                  label="Teacher Photo URL"
                  placeholder="Paste URL or upload to R2"
                  value={teacher.imageUrl}
                  onChangeText={(v) => setAboutForm((p) => ({ ...p, teachers: p.teachers.map((t, i) => i === index ? { ...t, imageUrl: v } : t) }))}
                />
                <Pressable
                  style={[styles.aboutUploadBtn, { opacity: uploading ? 0.6 : 1 }]}
                  disabled={uploading}
                  onPress={() => pickFileAndUpload("images", "image/*", (url) => {
                    setAboutForm((p) => ({ ...p, teachers: p.teachers.map((t, i) => i === index ? { ...t, imageUrl: url } : t) }));
                  })}
                >
                  {uploading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : <Ionicons name="cloud-upload-outline" size={17} color={Colors.light.primary} />}
                  <Text style={styles.aboutUploadBtnText}>{uploading ? "Uploading..." : "Upload Teacher Photo to R2"}</Text>
                </Pressable>
                <FormField
                  label="Teacher Description"
                  placeholder="Experience, achievements, teaching style..."
                  value={teacher.bio}
                  onChangeText={(v) => setAboutForm((p) => ({ ...p, teachers: p.teachers.map((t, i) => i === index ? { ...t, bio: v } : t) }))}
                  multiline
                  tall
                />
              </View>
            ))}
            </View>
          </View>
        )}

        {effectiveTab === "lectures" && !isTestSeries && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Lectures ({courseLectures.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => { setNewFolderParentId(null); setShowFolderPicker("lecture"); }}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowAddLecture(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Add Lecture</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
              <Text style={styles.infoText}>Tap a folder to open it. Or add lectures directly without a folder.</Text>
            </View>
            {/* Folder cards */}
            {(() => {
              const lectureFolderNames = sortFolderNamesByOrder(
                [...new Set([
                  ...courseLectures.map((l: any) => l.section_title).filter(Boolean),
                  ...safeFolders.filter((f: any) => f.type === "lecture" && !f.parent_id).map(folderFullName),
                ].map((n: string) => getLectureRootName(n)))],
                "lecture"
              );
              return (
              <SortableList
                ids={lectureFolderNames}
                onReorder={(a, o) => reorderFoldersByDrag("lecture", lectureFolderNames, a, o)}
              >
              {lectureFolderNames.map((folderName: any) => {
              const count = courseLectures.filter((l: any) => {
                const sec = typeof l.section_title === "string" ? l.section_title : "";
                return sec === folderName || sec.startsWith(`${folderName} /`);
              }).length;
              const folder = findFolderByPath(folderName, "lecture");
              return (
                <SortableItem key={folderName} id={folderName}>
                <View style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#EEF2FF" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => openFolder(folderName, "lecture")}>
                    <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.primary + "20", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={folder?.is_hidden ? "folder-outline" : "folder"} size={22} color={folder?.is_hidden ? Colors.light.textMuted : Colors.light.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder?.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{folderName}{folder?.is_hidden ? " (Hidden)" : ""}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{count} lecture{count !== 1 ? "s" : ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                  <Pressable style={{ padding: 8 }} onPress={async () => {
                    const f = await ensureLectureFolderByPath(folderName);
                    if (f) setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
                </SortableItem>
              );
              })}
              </SortableList>
              );
            })()}
            {/* Lectures without folder */}
            {(() => {
              const ungroupedLectures = courseLectures.filter((l: any) => !l.section_title);
              return (
              <SortableList
                ids={ungroupedLectures.map((l: any) => l.id)}
                onReorder={(a, o) => reorderByDrag("lecture", ungroupedLectures, a, o)}
              >
              {ungroupedLectures.map((lecture: any) => (
                <SortableItem key={lecture.id} id={lecture.id}>
                <View style={styles.itemCard}>
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
                  {(lecture.video_type === "r2" || inferLectureVideoType(lecture.video_url || "") === "r2") && !!lecture.video_url && (
                    <Pressable
                      style={[styles.deleteItemBtn, { backgroundColor: "#ECFDF5", marginRight: 6 }]}
                      onPress={() => void downloadAdminContent("lecture", lecture.id, `${lecture.title}.mp4`)}
                    >
                      <Ionicons name="download-outline" size={16} color="#059669" />
                    </Pressable>
                  )}
                  <Pressable
                    style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 6 }]}
                    onPress={() => {
                      const parts = splitLectureSectionPath(lecture.section_title);
                      setEditLecture({
                        ...lecture,
                        section_title: parts.root || "",
                        lecture_subfolder_title: parts.subfolder || "",
                      });
                    }}
                  >
                    <Ionicons name="pencil-outline" size={16} color={Colors.light.primary} />
                  </Pressable>
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
                </SortableItem>
              ))}
              </SortableList>
              );
            })()}
          </View>
        )}

        {effectiveTab === "tests" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{testSectionLabel} ({courseTests.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => { setNewFolderParentId(null); setShowFolderPicker("test"); }}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => {
                  const preset = activeTab === "pyqs" ? "pyq" : activeTab === "mocks" ? "mock" : "practice";
                  setNewTest((p) => ({ ...p, testType: preset, subjectKey: isMultiSubjectCourse ? activeSubjectKey : p.subjectKey }));
                  setShowAddTest(true);
                }}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Add {activeTab === "pyqs" ? "PYQ" : activeTab === "mocks" ? "Mock" : "Test"}</Text>
                </Pressable>
              </View>
            </View>
            {/* Folder cards for tests */}
            {(() => {
              const testFolderNames = sortFolderNamesByOrder(
                [...new Set([
                  ...courseTests.map((t: any) => getContentFolderRootName(t.folder_name)).filter(Boolean),
                  // PYQ/Mock tabs: only folders that actually contain tests of that type.
                  // Main Tests tab may also list empty DB folders so admin can add content.
                  ...(activeTestType ? [] : safeFolders.filter((f: any) => f.type === "test" && !f.parent_id).map(folderFullName)),
                ])],
                "test"
              );
              return (
              <SortableList
                ids={testFolderNames}
                onReorder={(a, o) => reorderFoldersByDrag("test", testFolderNames, a, o)}
              >
              {testFolderNames.map((folderName: any) => {
              const count = courseTests.filter((t: any) => testMatchesFolder(t, folderName)).length;
              if (count === 0) return null;
              const folder = findFolderByPath(folderName, "test");
              return (
                <SortableItem key={folderName} id={folderName}>
                <View style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#EEF2FF" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => openFolder(folderName, "test")}>
                    <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.primary + "20", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={folder?.is_hidden ? "folder-outline" : "folder"} size={22} color={folder?.is_hidden ? Colors.light.textMuted : Colors.light.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder?.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{folderName}{folder?.is_hidden ? " (Hidden)" : ""}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{count} test{count !== 1 ? "s" : ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                  <Pressable style={{ padding: 8 }} onPress={async () => {
                    let f = findFolderByPath(folderName, "test");
                    if (!f) { const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: folderName, type: "test" }); f = await r.json(); refetchFolders(); }
                    setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
                </SortableItem>
              );
              })}
              </SortableList>
              );
            })()}
            {(() => {
              const ungroupedTests = courseTests.filter((t: any) => !t.folder_name);
              return (
              <SortableList
                ids={ungroupedTests.map((t: any) => t.id)}
                onReorder={(a, o) => reorderByDrag("test", ungroupedTests, a, o)}
              >
              {ungroupedTests.map((test: any, idx: number) => (
                <SortableItem key={test.id} id={test.id}>
                <Pressable style={styles.testCard} onPress={() => openAdminTestAttempts(test)}>
                  <View style={styles.testCardRow}>
                    <Text style={styles.testCardTitle}>{test.title}</Text>
                    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                      {/* Up/Down reorder buttons (native only; web uses drag handle) */}
                      {Platform.OS !== "web" && (
                        <>
                          <Pressable
                            style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === 0 ? 0.3 : 1 }]}
                            disabled={idx === 0 || reorderMutation.isPending}
                            onPress={(e) => { e.stopPropagation?.(); moveItem("test", ungroupedTests, idx, "up"); }}
                          >
                            <Ionicons name="chevron-up" size={14} color={Colors.light.text} />
                          </Pressable>
                          <Pressable
                            style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === ungroupedTests.length - 1 ? 0.3 : 1 }]}
                            disabled={idx === ungroupedTests.length - 1 || reorderMutation.isPending}
                            onPress={(e) => { e.stopPropagation?.(); moveItem("test", ungroupedTests, idx, "down"); }}
                          >
                            <Ionicons name="chevron-down" size={14} color={Colors.light.text} />
                          </Pressable>
                        </>
                      )}
                      <Pressable
                        style={[styles.deleteItemBtn, { backgroundColor: "#ECFDF5" }]}
                        onPress={(e) => { e.stopPropagation?.(); void downloadAdminContent("test", test.id, `${test.title}.pdf`); }}
                      >
                        <Ionicons name="download-outline" size={14} color="#059669" />
                      </Pressable>
                      <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={(e) => { e.stopPropagation?.(); setEditTest({ ...test, durationMinutes: String(test.duration_minutes), difficulty: test.difficulty || "moderate" }); }}>
                        <Ionicons name="pencil-outline" size={14} color={Colors.light.primary} />
                      </Pressable>
                      <Pressable style={styles.deleteItemBtn} onPress={(e) => {
                        e.stopPropagation?.();
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
                  </View>
                  <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
                  <View style={styles.testUploadRow}>
                    <Pressable style={styles.testUploadBtn} onPress={(e) => { e.stopPropagation?.(); resumeQuestionsModalAfterAddRef.current = null; setShowAddQuestion(test.id); }}>
                      <Ionicons name="add-circle-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.testUploadBtnText}>Add Questions</Text>
                    </Pressable>
                    <Pressable style={[styles.testUploadBtn, { backgroundColor: "#FFF3E0" }]} onPress={(e) => { e.stopPropagation?.(); setShowBulkUpload(test.id); }}>
                      <Ionicons name="cloud-upload" size={16} color="#FF6B35" />
                      <Text style={[styles.testUploadBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                    </Pressable>
                    <Pressable style={[styles.testUploadBtn, { backgroundColor: "#DCFCE7" }]} onPress={(e) => { e.stopPropagation?.(); setShowViewQuestions(test.id); loadQuestions(test.id); }}>
                      <Ionicons name="list" size={16} color="#16A34A" />
                      <Text style={[styles.testUploadBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                    </Pressable>
                  </View>
                </Pressable>
                </SortableItem>
              ))}
              </SortableList>
              );
            })()}
          </View>
        )}

        {effectiveTab === "materials" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Materials ({courseMaterials.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => { setNewFolderParentId(null); setShowFolderPicker("material"); }}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowAddMaterial(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Add Material</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
              <Text style={styles.infoText}>Add PDFs, notes, or reference links. Use "Folder Name" to organize materials into folders.</Text>
            </View>
            {/* Folder cards for materials */}
            {(() => {
              const materialFolderNames = sortFolderNamesByOrder(
                [...new Set([
                  ...courseMaterials.map((m: any) => getContentFolderRootName(m.section_title)).filter(Boolean),
                  ...safeFolders.filter((f: any) => f.type === "material" && !f.parent_id).map(folderFullName),
                ])],
                "material"
              );
              return (
              <SortableList
                ids={materialFolderNames}
                onReorder={(a, o) => reorderFoldersByDrag("material", materialFolderNames, a, o)}
              >
              {materialFolderNames.map((folderName: any) => {
              const count = courseMaterials.filter((m: any) => m.section_title === folderName || String(m.section_title || "").startsWith(`${folderName} /`)).length;
              const folder = findFolderByPath(folderName, "material");
              return (
                <SortableItem key={folderName} id={folderName}>
                <View style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#FFF1F2" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => openFolder(folderName, "material")}>
                    <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "#DC262620", alignItems: "center", justifyContent: "center" }}>
                      <Ionicons name={folder?.is_hidden ? "folder-outline" : "folder"} size={22} color={folder?.is_hidden ? Colors.light.textMuted : "#DC2626"} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: folder?.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{folderName}{folder?.is_hidden ? " (Hidden)" : ""}</Text>
                      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{count} item{count !== 1 ? "s" : ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                  <Pressable style={{ padding: 8 }} onPress={async () => {
                    let f = findFolderByPath(folderName, "material");
                    if (!f) { const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: folderName, type: "material" }); f = await r.json(); refetchFolders(); }
                    setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
                </SortableItem>
              );
              })}
              </SortableList>
              );
            })()}
            {(() => {
              const ungroupedMaterials = courseMaterials.filter((m: any) => !m.section_title);
              return (
              <SortableList
                ids={ungroupedMaterials.map((m: any) => m.id)}
                onReorder={(a, o) => reorderByDrag("material", ungroupedMaterials, a, o)}
              >
              {ungroupedMaterials.map((mat: any, idx: number) => (
                <SortableItem key={mat.id} id={mat.id}>
                <View style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <View style={[styles.itemIcon, { backgroundColor: "#FEE2E2" }]}>
                      <Ionicons name="document-text" size={16} color="#DC2626" />
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{mat.title}</Text>
                      <Text style={styles.itemMeta}>{mat.file_type?.toUpperCase() || "PDF"}{mat.description ? ` · ${mat.description}` : ""}</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                      {/* Up/Down reorder buttons (native only; web uses drag handle) */}
                      {Platform.OS !== "web" && (
                        <>
                          <Pressable
                            style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === 0 ? 0.3 : 1 }]}
                            disabled={idx === 0 || reorderMutation.isPending}
                            onPress={() => moveItem("material", ungroupedMaterials, idx, "up")}
                          >
                            <Ionicons name="chevron-up" size={14} color={Colors.light.text} />
                          </Pressable>
                          <Pressable
                            style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === ungroupedMaterials.length - 1 ? 0.3 : 1 }]}
                            disabled={idx === ungroupedMaterials.length - 1 || reorderMutation.isPending}
                            onPress={() => moveItem("material", ungroupedMaterials, idx, "down")}
                          >
                            <Ionicons name="chevron-down" size={14} color={Colors.light.text} />
                          </Pressable>
                        </>
                      )}
                      {!!mat.file_url && (
                        <Pressable
                          style={[styles.deleteItemBtn, { backgroundColor: "#ECFDF5" }]}
                          onPress={() => void downloadAdminContent("material", mat.id, mat.title)}
                        >
                          <Ionicons name="download-outline" size={16} color="#059669" />
                        </Pressable>
                      )}
                      <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => setEditMaterial({ ...mat, sectionTitle: mat.section_title || "", downloadAllowed: mat.download_allowed || false })}>
                        <Ionicons name="pencil-outline" size={16} color={Colors.light.primary} />
                      </Pressable>
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
                </View>
                </SortableItem>
              ))}
              </SortableList>
              );
            })()}
          </View>
        )}

        {effectiveTab === "live" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Live Classes ({scopedCourseLiveClasses.length})</Text>
            </View>
            {courseLivePending && scopedCourseLiveClasses.length === 0 ? (
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 10 }}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Loading schedule…</Text>
              </View>
            ) : null}
            {!courseLivePending && scopedCourseLiveClasses.length === 0 && (
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                <Text style={styles.infoText}>Schedule live classes from the Courses tab → Upcoming Class panel in the admin dashboard.</Text>
              </View>
            )}
            {scopedCourseLiveClasses.map((lc) => (
              <View key={lc.id} style={[styles.itemCard, { gap: 6 }]}>
                <View style={styles.itemRow}>
                  <View style={[styles.itemIcon, { backgroundColor: lc.is_live ? "#FEE2E2" : lc.is_completed ? "#F3F4F6" : Colors.light.secondary }]}>
                    <Ionicons name={lc.is_live ? "radio" : lc.is_completed ? "checkmark-circle" : "calendar"} size={16} color={lc.is_live ? "#DC2626" : lc.is_completed ? "#9CA3AF" : Colors.light.primary} />
                  </View>
                  <View style={styles.itemInfo}>
                    <View style={styles.liveRow}>
                      <Text style={[styles.itemTitle, lc.is_completed && { color: Colors.light.textMuted }]} numberOfLines={1}>{lc.title}</Text>
                      {lc.is_live && <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>LIVE</Text></View>}
                      {lc.is_completed && <View style={[styles.liveBadge, { backgroundColor: "#9CA3AF" }]}><Text style={styles.liveBadgeText}>ENDED</Text></View>}
                      {!lc.is_live && !lc.is_completed && <View style={[styles.liveBadge, { backgroundColor: Colors.light.primary }]}><Text style={styles.liveBadgeText}>SCHEDULED</Text></View>}
                    </View>
                    <Text style={styles.itemMeta}>{lc.scheduled_at ? new Date(Number(lc.scheduled_at) > 1e12 ? Number(lc.scheduled_at) : lc.scheduled_at).toLocaleString() : "Not scheduled"}</Text>
                    <Text style={[styles.itemMeta, { color: lc.is_public ? "#22C55E" : "#F59E0B" }]}>{lc.is_public ? "All Students" : "Enrolled Only"}</Text>
                    {/* R2 badge if recording is on R2 */}
                    {lc.youtube_url && (lc.youtube_url.includes("/api/media/") || lc.youtube_url.includes("r2")) && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <Ionicons name="shield-checkmark" size={12} color="#22C55E" />
                        <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#22C55E" }}>Secure R2 Recording</Text>
                      </View>
                    )}
                  </View>
                </View>
                {/* Action buttons for completed classes */}
                {lc.is_completed && (
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {/* Upload Recording to R2 (optional — replaces YouTube URL with secure R2 URL) */}
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, opacity: uploading ? 0.5 : 1 }}
                      disabled={uploading}
                      onPress={() => {
                        pickFileAndUpload("lectures", "video/*,.mp4,.mov,.mkv", (url) => {
                          updateLiveClassMutation.mutate({ lcId: lc.id, youtubeUrl: url });
                          Alert.alert("Recording Uploaded", "The recording is now served securely from R2.");
                        });
                      }}
                    >
                      {uploading ? <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload" size={14} color={Colors.light.primary} />}
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading ${uploadProgress}%` : "Upload to R2"}</Text>
                    </Pressable>
                    {/* Convert to Lecture */}
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                      onPress={() => {
                        const hasRecording = !!(
                          lc.recording_url ||
                          lc.youtube_url ||
                          lc.cf_playback_hls ||
                          lc.board_snapshot_url
                        );
                        if (!hasRecording) {
                          const hint =
                            String(lc.stream_type || "").toLowerCase() === "classroom"
                              ? "Interactive Classroom has no recording yet. Tap Upload to R2 and upload a video (or board export), then Save as Lecture."
                              : "Upload a recording first (Upload to R2), then Save as Lecture.";
                          if (Platform.OS === "web") window.alert(hint);
                          else Alert.alert("No recording", hint);
                          return;
                        }
                        const run = () =>
                          updateLiveClassMutation.mutate({
                            lcId: lc.id,
                            convertToLecture: true,
                            sectionTitle: "Live Class Recordings",
                          });
                        if (Platform.OS === "web") {
                          if (window.confirm("Save this recording as a lecture under Lectures → Live Class Recordings?")) run();
                        } else {
                          Alert.alert("Convert to Lecture", "Save this recording as a lecture in the Lectures tab?", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Convert", onPress: run },
                          ]);
                        }
                      }}
                    >
                      <Ionicons name="swap-horizontal" size={14} color="#16A34A" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>Save as Lecture</Text>
                    </Pressable>
                    {/* Delete */}
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                      onPress={() => {
                        if (Platform.OS === "web") {
                          if (window.confirm("Delete this live class? This cannot be undone.")) deleteLiveClassMutation.mutate(lc.id);
                        } else {
                          Alert.alert("Delete", "Delete this live class?", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteLiveClassMutation.mutate(lc.id) },
                          ]);
                        }
                      }}
                    >
                      <Ionicons name="trash" size={14} color="#DC2626" />
                      <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>Delete</Text>
                    </Pressable>
                  </View>
                )}
                {/* Action buttons for scheduled/live classes */}
                {!lc.is_completed && (
                  <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
                    {lc.is_live && (
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DC2626", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                        onPress={() =>
                          router.push(
                            (String((lc as any).stream_type || "").toLowerCase() === "classroom"
                              ? `/admin/classroom/${lc.id}`
                              : `/admin/broadcast/${lc.id}`) as any
                          )
                        }
                      >
                        <Ionicons name="radio" size={14} color="#fff" />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Enter Live Studio</Text>
                      </Pressable>
                    )}
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                      onPress={() => {
                        if (Platform.OS === "web") {
                          if (window.confirm("Delete this live class? This cannot be undone.")) deleteLiveClassMutation.mutate(lc.id);
                        } else {
                          Alert.alert("Delete", "Delete this live class?", [
                            { text: "Cancel", style: "cancel" },
                            { text: "Delete", style: "destructive", onPress: () => deleteLiveClassMutation.mutate(lc.id) },
                          ]);
                        }
                      }}
                    >
                      <Ionicons name="trash" size={14} color="#DC2626" />
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {activeTab === "enrolled" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Enrolled Students ({enrolledStudents.length})</Text>
            </View>
            {enrolledStudentsPending && enrolledStudents.length === 0 ? (
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 10 }}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Loading enrolled students…</Text>
              </View>
            ) : null}
            {!enrolledStudentsPending && enrolledStudents.length === 0 && (
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                <Text style={styles.infoText}>No students enrolled yet.</Text>
              </View>
            )}
            {enrolledStudents.map((student) => (
              <View key={student.id} style={[styles.itemCard, { flexDirection: "row", alignItems: "stretch" }]}>
                <Pressable
                  style={{ flex: 1 }}
                  onPress={() => router.push({ pathname: "/admin/course/[id]/student/[userId]", params: { id: String(id), userId: String(student.user_id) } } as any)}
                >
                  <View style={styles.itemRow}>
                    <View style={[styles.itemIcon, { backgroundColor: "#EEF2FF" }]}>
                      <Ionicons name="person" size={16} color={Colors.light.primary} />
                    </View>
                    <View style={styles.itemInfo}>
                      <Text style={styles.itemTitle}>{student.name || "Unknown"}</Text>
                      <Text style={styles.itemMeta}>{student.email || student.phone || ""}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: (student as any).status === "inactive" ? "#EF4444" : "#22C55E" }} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: (student as any).status === "inactive" ? "#EF4444" : "#22C55E" }}>
                          {(student as any).status === "inactive" ? "Inactive" : "Active"}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: Colors.light.primary, fontFamily: "Inter_500Medium", marginTop: 4 }}>View lecture and test progress →</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{student.progress_percent || 0}%</Text>
                      <Text style={{ fontSize: 10, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Progress</Text>
                    </View>
                  </View>
                </Pressable>
                <Pressable style={{ padding: 8, alignSelf: "center" }} onPress={() => setStudentActionSheet(student)}>
                  <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Folder Action Sheet (root course view only) */}
      <Modal visible={folderActionSheet !== null && openAdminFolder === null} animationType="slide" transparent>
        <Pressable style={styles.modalOverlay} onPress={() => setFolderActionSheet(null)}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>{folderActionSheet?.name}</Text>
              <Pressable onPress={() => setFolderActionSheet(null)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#EEF2FF", marginBottom: 8 }}
              onPress={() => {
                const folder = folderActionSheet;
                if (!folder) return;
                const resolved = folder.id ?? findFolderByPath(folderFullName(folder) || folder.name, folder.type)?.id ?? null;
                setEditFolderName(folderLocalName(folder));
                setEditingFolderId(resolved);
                setEditFolderModal(true);
                setFolderActionSheet(null);
              }}
            >
              <Ionicons name="pencil" size={20} color={Colors.light.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Edit Folder</Text>
                <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Rename this folder</Text>
              </View>
            </Pressable>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#F0FDF4", marginBottom: 8 }}
              onPress={() => {
                if (!folderActionSheet) return;
                setNewFolderName("");
                setNewFolderParentId(folderActionSheet.id);
                setShowFolderPicker(folderActionSheet.type);
                setFolderActionSheet(null);
              }}
            >
              <Ionicons name="folder-open" size={20} color="#16A34A" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Create Subfolder</Text>
                <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Add a folder inside this folder</Text>
              </View>
            </Pressable>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: Colors.light.background, marginBottom: 8 }}
              onPress={async () => {
                if (!folderActionSheet) return;
                await updateFolderMutation.mutateAsync({ folderId: folderActionSheet.id, isHidden: !folderActionSheet.is_hidden });
                setFolderActionSheet(null);
              }}
            >
              <Ionicons name={folderActionSheet?.is_hidden ? "eye" : "eye-off"} size={20} color={Colors.light.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                  {folderActionSheet?.is_hidden ? "Show Folder" : "Hide Folder"}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                  {folderActionSheet?.is_hidden ? "Make visible to students" : "Hide from students (admin can still see it)"}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#FEE2E2" }}
              onPress={() => {
                if (!folderActionSheet) return;
                const doDelete = async () => {
                  await deleteFolderMutation.mutateAsync(folderActionSheet.id);
                  setFolderActionSheet(null);
                };
                if (Platform.OS === "web") {
                  if (window.confirm(`Delete folder "${folderActionSheet.name}" and all its content?`)) doDelete();
                } else {
                  Alert.alert("Delete Folder", `Delete "${folderActionSheet.name}" and all its content permanently?`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: doDelete },
                  ]);
                }
              }}
            >
              <Ionicons name="trash" size={20} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Delete Folder</Text>
                <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular", opacity: 0.7 }}>Permanently deletes folder and all content inside</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Edit Lecture Modal — outside folder (root level) */}
      <Modal visible={!!editLecture} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Lecture</Text>
              <Pressable onPress={() => setEditLecture(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <FormField label="Lecture Title *" placeholder="e.g., Introduction" value={editLecture?.title || ""} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, title: v }))} />
              <FormField label="Video URL (YouTube or uploaded)" placeholder="https://youtube.com/watch?v=..." value={editLecture?.video_url || ""} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, video_url: v }))} />
              <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                disabled={uploading}
                onPress={() => pickFileAndUpload("lectures", "video/*,.mp4,.mov", (url) => setEditLecture((p: any) => ({ ...p, video_url: url, video_type: "r2" })))}>
                {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload Video"}</Text>
              </Pressable>
              <FormField label="Description" placeholder="What students will learn" value={editLecture?.description || ""} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, description: v }))} />
              <FormField label="Folder/Section (optional)" placeholder="e.g., Chapter 1" value={editLecture?.section_title || ""} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, section_title: v }))} />
              <FormField
                label="Subfolder (optional)"
                placeholder="e.g., Number System"
                value={editLecture?.lecture_subfolder_title || ""}
                onChangeText={(v) => setEditLecture((p: any) => ({ ...p, lecture_subfolder_title: v }))}
              />
              <FormField label="Duration (minutes)" placeholder="45" value={String(editLecture?.duration_minutes || "")} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, duration_minutes: v }))} numeric />
              <FormField label="Order Index" placeholder="1" value={String(editLecture?.order_index || "")} onChangeText={(v) => setEditLecture((p: any) => ({ ...p, order_index: v }))} numeric />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Switch value={editLecture?.is_free_preview || false} onValueChange={(v) => setEditLecture((p: any) => ({ ...p, is_free_preview: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Free Preview</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Switch value={editLecture?.download_allowed || false} onValueChange={(v) => setEditLecture((p: any) => ({ ...p, download_allowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
              </View>
            </ScrollView>
            <ActionButton label="Save Changes" onPress={() => editLecture && updateLectureMutation.mutate({ id: editLecture.id, title: editLecture.title, description: editLecture.description || "", videoUrl: editLecture.video_url, videoType: editLecture.video_type || "youtube", durationMinutes: parseInt(editLecture.duration_minutes) || 0, orderIndex: parseInt(editLecture.order_index) || 0, isFreePreview: editLecture.is_free_preview, sectionTitle: composeLectureSectionPath(editLecture.section_title, editLecture.lecture_subfolder_title), lectureSubfolderTitle: editLecture.lecture_subfolder_title || null, downloadAllowed: editLecture.download_allowed || false, courseId: editLecture.course_id || parseInt(id) })} disabled={!editLecture?.title} loading={updateLectureMutation.isPending} />
          </View>
        </View>
      </Modal>

      {/* Edit Test Modal — outside folder (root level) */}
      <Modal visible={!!editTest} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Test</Text>
              <Pressable onPress={() => setEditTest(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <FormField label="Test Title *" placeholder="e.g., Chapter 1 Test" value={editTest?.title || ""} onChangeText={(v) => setEditTest((p: any) => ({ ...p, title: v }))} />
              <FormField label="Description" placeholder="Test description" value={editTest?.description || ""} onChangeText={(v) => setEditTest((p: any) => ({ ...p, description: v }))} />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Category</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {TEST_TYPES.map((t) => (
                  <Pressable key={t} onPress={() => setEditTest((p: any) => ({ ...p, test_type: t }))} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: editTest?.test_type === t ? Colors.light.primary : "#F3F4F6", borderWidth: 1, borderColor: editTest?.test_type === t ? Colors.light.primary : "#E5E7EB" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: editTest?.test_type === t ? "#fff" : Colors.light.text, textTransform: "uppercase" }}>{t === "pyq" ? "PYQs" : t}</Text>
                  </Pressable>
                ))}
              </View>
              <FormField label="Folder (optional)" placeholder="e.g., Algebra" value={editTest?.folder_name || ""} onChangeText={(v) => setEditTest((p: any) => ({ ...p, folder_name: v }))} />
              <FormField label="Duration (minutes)" placeholder="60" value={editTest?.durationMinutes || ""} onChangeText={(v) => setEditTest((p: any) => ({ ...p, durationMinutes: v }))} numeric />
              <FormField label="Total Marks" placeholder="100" value={editTest?.totalMarks || ""} onChangeText={(v) => setEditTest((p: any) => ({ ...p, totalMarks: v }))} numeric />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Difficulty</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {["easy", "moderate", "hard"].map((d) => (
                  <Pressable key={d} onPress={() => setEditTest((p: any) => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: (editTest?.difficulty || "moderate") === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6", borderWidth: 1, borderColor: (editTest?.difficulty || "moderate") === d ? "transparent" : "#E5E7EB" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (editTest?.difficulty || "moderate") === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <ActionButton label="Save Changes" onPress={() => editTest && updateTestMutation.mutate({ id: editTest.id, title: editTest.title, description: editTest.description || "", durationMinutes: parseInt(editTest.durationMinutes) || 60, totalMarks: parseInt(editTest.totalMarks) || 100, testType: editTest.test_type, folderName: editTest.folder_name || null, difficulty: editTest.difficulty || "moderate", courseId: editTest.course_id || parseInt(id) })} disabled={!editTest?.title} loading={updateTestMutation.isPending} />
          </View>
        </View>
      </Modal>

      {/* Edit Material Modal — outside folder (root level) */}
      <Modal visible={!!editMaterial} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Material</Text>
              <Pressable onPress={() => setEditMaterial(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <FormField label="Title *" placeholder="Material title" value={editMaterial?.title || ""} onChangeText={(v) => setEditMaterial((p: any) => ({ ...p, title: v }))} />
              <FormField label="File URL" placeholder="https://..." value={editMaterial?.file_url || editMaterial?.fileUrl || ""} onChangeText={(v) => setEditMaterial((p: any) => ({ ...p, file_url: v, fileUrl: v }))} />
              <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                disabled={uploading}
                onPress={() => pickFileAndUpload("materials", ".pdf,.doc,.docx,video/*,.mp4,.mov", (url) => {
                  const ext = url.split(".").pop()?.toLowerCase() || "";
                  const ft = ext === "pdf" ? "pdf" : ["doc","docx"].includes(ext) ? "doc" : "video";
                  setEditMaterial((p: any) => ({ ...p, file_url: url, fileUrl: url, file_type: ft, fileType: ft }));
                })}>
                {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload New File"}</Text>
              </Pressable>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>File Type</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {["pdf", "video", "doc", "link"].map(t => (
                  <Pressable key={t} onPress={() => setEditMaterial((p: any) => ({ ...p, file_type: t, fileType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: (editMaterial?.file_type || editMaterial?.fileType) === t ? Colors.light.primary : "#F3F4F6" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (editMaterial?.file_type || editMaterial?.fileType) === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <FormField label="Folder/Section (optional)" placeholder="e.g., Chapter 1" value={editMaterial?.sectionTitle || editMaterial?.section_title || ""} onChangeText={(v) => setEditMaterial((p: any) => ({ ...p, sectionTitle: v, section_title: v }))} />
              <FormField label="Description" placeholder="Short description" value={editMaterial?.description || ""} onChangeText={(v) => setEditMaterial((p: any) => ({ ...p, description: v }))} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <Switch value={editMaterial?.downloadAllowed || editMaterial?.download_allowed || false} onValueChange={(v) => setEditMaterial((p: any) => ({ ...p, downloadAllowed: v, download_allowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
              </View>
            </ScrollView>
            <ActionButton label="Save Changes" onPress={() => editMaterial && updateMaterialMutation.mutate({ id: editMaterial.id, title: editMaterial.title, description: editMaterial.description || "", fileUrl: editMaterial.file_url || editMaterial.fileUrl, fileType: editMaterial.file_type || editMaterial.fileType || "pdf", isFree: editMaterial.is_free || false, sectionTitle: editMaterial.sectionTitle || editMaterial.section_title || null, downloadAllowed: editMaterial.downloadAllowed || editMaterial.download_allowed || false })} disabled={!editMaterial?.title} loading={updateMaterialMutation.isPending} />
          </View>
        </View>
      </Modal>

      {/* Student Action Sheet */}
      <Modal visible={studentActionSheet !== null} animationType="slide" transparent>
        <Pressable style={styles.modalOverlay} onPress={() => setStudentActionSheet(null)}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{studentActionSheet?.name}</Text>
                <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{studentActionSheet?.phone || studentActionSheet?.email || ""}</Text>
              </View>
              <Pressable onPress={() => setStudentActionSheet(null)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: Colors.light.background, marginBottom: 8 }}
              onPress={async () => {
                if (!studentActionSheet) return;
                const newStatus = (studentActionSheet as any).status === "inactive" ? "active" : "inactive";
                await apiRequest("PUT", `/api/admin/enrollments/${studentActionSheet.id}`, { status: newStatus });
                qc.invalidateQueries({ queryKey: ["/api/admin/courses", id, "enrolled"] });
                setStudentActionSheet(null);
              }}
            >
              <Ionicons name={(studentActionSheet as any)?.status === "inactive" ? "checkmark-circle-outline" : "pause-circle-outline"} size={22} color={Colors.light.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                  {(studentActionSheet as any)?.status === "inactive" ? "Activate Student" : "Make Inactive"}
                </Text>
                <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                  {(studentActionSheet as any)?.status === "inactive" ? "Restore access to this course" : "Temporarily block access"}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#FEE2E2" }}
              onPress={() => {
                if (!studentActionSheet) return;
                const doRemove = async () => {
                  await apiRequest("DELETE", `/api/admin/enrollments/${studentActionSheet.id}`);
                  qc.invalidateQueries({ queryKey: ["/api/admin/courses", id, "enrolled"] });
                  setStudentActionSheet(null);
                };
                if (Platform.OS === "web") {
                  if (window.confirm(`Remove "${studentActionSheet.name}" from this course?`)) doRemove();
                } else {
                  Alert.alert("Remove Student", `Remove "${studentActionSheet.name}" from this course?`, [
                    { text: "Cancel", style: "cancel" },
                    { text: "Remove", style: "destructive", onPress: doRemove },
                  ]);
                }
              }}
            >
              <Ionicons name="person-remove" size={20} color="#EF4444" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Remove from Course</Text>
                <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular", opacity: 0.7 }}>Permanently removes enrollment</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

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
              <FormField label="Video URL (YouTube or uploaded)" placeholder="https://youtube.com/watch?v=..." value={newLecture.videoUrl} onChangeText={(v) => setNewLecture(p => ({ ...p, videoUrl: v }))} />
              <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                disabled={uploading}
                onPress={() => pickFileAndUpload("lectures", "video/*,.mp4,.mov,.mkv", (url) => setNewLecture(p => ({ ...p, videoUrl: url, videoType: "r2" })))}>
                {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload Video from Device"}</Text>
              </Pressable>
              <FormField label="Description" placeholder="What students will learn" value={newLecture.description} onChangeText={(v) => setNewLecture(p => ({ ...p, description: v }))} multiline />
              <FormField label="Duration (minutes)" placeholder="45" value={newLecture.durationMinutes} onChangeText={(v) => setNewLecture(p => ({ ...p, durationMinutes: v }))} numeric />
              <FormField label="Order Index (lower = first)" placeholder="1" value={newLecture.orderIndex} onChangeText={(v) => setNewLecture(p => ({ ...p, orderIndex: v }))} numeric />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Free Preview (visible without enrollment)</Text>
                <Switch value={newLecture.isFreePreview} onValueChange={(v) => setNewLecture(p => ({ ...p, isFreePreview: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Allow Download</Text>
                <Switch value={(newLecture as any).downloadAllowed || false} onValueChange={(v) => setNewLecture(p => ({ ...p, downloadAllowed: v } as any))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
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
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Category</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {TEST_TYPES.map((t) => (
                  <Pressable key={t} onPress={() => setNewTest(p => ({ ...p, testType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: newTest.testType === t ? Colors.light.primary : "#F3F4F6", borderWidth: 1, borderColor: newTest.testType === t ? Colors.light.primary : "#E5E7EB" }}>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: newTest.testType === t ? "#fff" : Colors.light.text, textTransform: "uppercase" }}>{t === "pyq" ? "PYQs" : t}</Text>
                  </Pressable>
                ))}
              </View>
              <FormField label="Folder (optional)" placeholder="e.g., Algebra, Geometry" value={newTest.folderName} onChangeText={(v) => setNewTest(p => ({ ...p, folderName: v }))} />
              <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: -8, marginBottom: 12 }}>
                Or pick existing: {[...new Set(dbFolders.filter((f: any) => f.type === "test").map((f: any) => f.name))].map((name: any) => (
                  <Text key={name} onPress={() => setNewTest(p => ({ ...p, folderName: name }))} style={{ color: Colors.light.primary, fontFamily: "Inter_600SemiBold" }}> [{name}]</Text>
                ))}
              </Text>
              <FormField label="Duration (minutes)" placeholder="60" value={newTest.durationMinutes} onChangeText={(v) => setNewTest(p => ({ ...p, durationMinutes: v }))} numeric />
              <FormField label="Total Marks" placeholder="100" value={newTest.totalMarks} onChangeText={(v) => setNewTest(p => ({ ...p, totalMarks: v }))} numeric />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Difficulty</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {["easy", "moderate", "hard"].map((d) => (
                  <Pressable key={d} onPress={() => setNewTest(p => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: newTest.difficulty === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6", borderWidth: 1, borderColor: newTest.difficulty === d ? "transparent" : "#E5E7EB" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: newTest.difficulty === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                  </Pressable>
                ))}
              </View>
              <FormField label="Schedule Date & Time (optional)" placeholder="2026-04-15 18:00" value={newTest.scheduledAt} onChangeText={(v) => setNewTest(p => ({ ...p, scheduledAt: v }))} />
            </ScrollView>
            <ActionButton label="Create Test" onPress={() => addTestMutation.mutate(newTest)} disabled={!newTest.title} loading={addTestMutation.isPending} />
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
              {/* File picker */}
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>File *</Text>
                {newMaterial.fileUrl ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#BBF7D0" }}>
                    <Ionicons name="document-text" size={20} color="#16A34A" />
                    <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#166534" }} numberOfLines={1}>{newMaterial.fileUrl.startsWith("data:") ? "File selected (local)" : newMaterial.fileUrl.includes("cdn.3ilearning") ? "Uploaded to cloud ✓" : newMaterial.fileUrl}</Text>
                    <Pressable onPress={() => setNewMaterial(p => ({ ...p, fileUrl: "" }))}><Ionicons name="close-circle" size={20} color="#16A34A" /></Pressable>
                  </View>
                ) : (
                  <>
                    <Pressable
                      style={{ borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, padding: 14, alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", marginBottom: 6, opacity: uploading ? 0.5 : 1 }}
                      disabled={uploading}
                      onPress={() => pickFileAndUpload("materials", ".pdf,.doc,.docx,video/*,.mp4,.mov", (url) => {
                        const ext = url.split(".").pop()?.toLowerCase() || "";
                        const ft = ext === "pdf" ? "pdf" : ["doc","docx"].includes(ext) ? "doc" : ["mp4","mov","mkv","avi"].includes(ext) ? "video" : "pdf";
                        setNewMaterial(p => ({ ...p, fileUrl: url, fileType: ft }));
                      })}>
                      {uploading ? <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={22} color={Colors.light.primary} />}
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload File (PDF/DOC/Video)"}</Text>
                      <Text style={{ fontSize: 10, color: Colors.light.textMuted }}>{uploading ? "" : "Uploads to Cloudflare R2"}</Text>
                    </Pressable>
                    <FormField label="" placeholder="Or paste file URL..." value={newMaterial.fileUrl} onChangeText={(v) => setNewMaterial(p => ({ ...p, fileUrl: v }))} />
                  </>
                )}
              </View>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 4 }}>File Type</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {["pdf", "video", "doc", "link"].map(t => (
                  <Pressable key={t} onPress={() => setNewMaterial(p => ({ ...p, fileType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: newMaterial.fileType === t ? Colors.light.primary : "#F3F4F6" }}>
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: newMaterial.fileType === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <FormField label="Description" placeholder="Short description of the material" value={newMaterial.description} onChangeText={(v) => setNewMaterial(p => ({ ...p, description: v }))} />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Allow Download</Text>
                <Switch value={newMaterial.downloadAllowed} onValueChange={(v) => setNewMaterial(p => ({ ...p, downloadAllowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton label="Add Material" onPress={() => addMaterialMutation.mutate(newMaterial)} disabled={!newMaterial.title || !(newMaterial.fileUrl || "").trim()} loading={addMaterialMutation.isPending} />
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
              <FormField label="YouTube Live/Stream URL *" placeholder="Paste YouTube live stream share link here" value={newLiveClass.youtubeUrl} onChangeText={(v) => setNewLiveClass(p => ({ ...p, youtubeUrl: v }))} />
              <FormField label="Description" placeholder="What will be covered" value={newLiveClass.description} onChangeText={(v) => setNewLiveClass(p => ({ ...p, description: v }))} />
              <FormField label="Scheduled Date & Time" placeholder="2026-03-15 18:00" value={newLiveClass.scheduledAt} onChangeText={(v) => setNewLiveClass(p => ({ ...p, scheduledAt: v }))} />
              {isMultiSubjectCourse && (
                <View style={{ gap: 8, padding: 10, borderRadius: 12, backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: Colors.light.border, marginBottom: 10 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Subject, folder and subfolder</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {MULTI_SUBJECTS.map((subject) => (
                      <Pressable
                        key={subject.key}
                        onPress={() => setNewLiveClass((p) => ({ ...p, subjectKey: subject.key, lectureSectionTitle: "Live Class Recordings", lectureSubfolderTitle: "" }))}
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: (newLiveClass.subjectKey || activeSubjectKey) === subject.key ? Colors.light.primary : "#EEF2FF" }}
                      >
                        <SubjectIcon subject={subject} size={14} color={(newLiveClass.subjectKey || activeSubjectKey) === subject.key ? "#fff" : Colors.light.primary} />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: (newLiveClass.subjectKey || activeSubjectKey) === subject.key ? "#fff" : Colors.light.primary }}>{subject.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ gap: 6 }}>
                    <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Folder</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <Pressable onPress={() => setNewLiveClass((p) => ({ ...p, lectureSectionTitle: "", lectureSubfolderTitle: "" }))} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !newLiveClass.lectureSectionTitle ? Colors.light.primary : "#E5E7EB" }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !newLiveClass.lectureSectionTitle ? "#fff" : Colors.light.text }}>Default</Text>
                      </Pressable>
                      {livePlacementRootFolders.map((folder: any) => {
                        const name = folderFullName(folder);
                        return (
                          <Pressable key={folder.id || name} onPress={() => setNewLiveClass((p) => ({ ...p, lectureSectionTitle: name, lectureSubfolderTitle: "" }))} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: newLiveClass.lectureSectionTitle === name ? Colors.light.primary : "#E5E7EB" }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: newLiveClass.lectureSectionTitle === name ? "#fff" : Colors.light.text }}>{folder.name || name}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                  {newLiveClass.lectureSectionTitle ? (
                    <View style={{ gap: 6 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Subfolder</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        <Pressable onPress={() => setNewLiveClass((p) => ({ ...p, lectureSubfolderTitle: "" }))} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: !newLiveClass.lectureSubfolderTitle ? Colors.light.primary : "#E5E7EB" }}>
                          <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: !newLiveClass.lectureSubfolderTitle ? "#fff" : Colors.light.text }}>No Subfolder</Text>
                        </Pressable>
                        {livePlacementChildFolders(newLiveClass.lectureSectionTitle).map((folder: any) => {
                          const fullName = folderFullName(folder);
                          const localName = String(folder.name || fullName.replace(`${newLiveClass.lectureSectionTitle} / `, ""));
                          return (
                            <Pressable key={folder.id || fullName} onPress={() => setNewLiveClass((p) => ({ ...p, lectureSubfolderTitle: localName }))} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: newLiveClass.lectureSubfolderTitle === localName ? Colors.light.primary : "#E5E7EB" }}>
                              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: newLiveClass.lectureSubfolderTitle === localName ? "#fff" : Colors.light.text }}>{localName}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}
                </View>
              )}
              <FormField
                label="Main recording section"
                placeholder="Default: Live Class Recordings"
                value={newLiveClass.lectureSectionTitle}
                onChangeText={(v) => setNewLiveClass(p => ({ ...p, lectureSectionTitle: v }))}
              />
              <FormField
                label="Subfolder (optional, e.g. chapter)"
                placeholder='e.g. Chapter 1 — saved under "Main / Subfolder"'
                value={newLiveClass.lectureSubfolderTitle}
                onChangeText={(v) => setNewLiveClass(p => ({ ...p, lectureSubfolderTitle: v }))}
              />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Accessible to All Students</Text>
                <Text style={{ fontSize: 11, color: Colors.light.textMuted, marginBottom: 4, fontFamily: "Inter_400Regular" }}>If ON, all students can watch. If OFF, only enrolled students can access.</Text>
                <Switch value={newLiveClass.isPublic} onValueChange={(v) => setNewLiveClass(p => ({ ...p, isPublic: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Is Live Right Now?</Text>
                <Switch value={newLiveClass.isLive} onValueChange={(v) => setNewLiveClass(p => ({ ...p, isLive: v }))} trackColor={{ false: Colors.light.border, true: "#DC2626" }} thumbColor="#fff" />
              </View>
            </ScrollView>
            <ActionButton
              label="Add Live Class"
              onPress={() => addLiveClassMutation.mutate(newLiveClass)}
              disabled={!newLiveClass.title}
              loading={addLiveClassMutation.isPending}
              color="#DC2626"
            />
          </View>
        </View>
      </Modal>

      <Modal visible={showEditCourse} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{isTestSeries ? "Edit Test Series" : "Edit Course"}</Text>
              <Pressable onPress={() => setShowEditCourse(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <FormField label="Course Title *" placeholder="e.g., NDA Mathematics" value={editForm.title} onChangeText={(v) => setEditForm(p => ({ ...p, title: v }))} />
              <FormField label="Category *" placeholder="e.g., NDA, CDS, AFCAT" value={editForm.category} onChangeText={(v) => setEditForm(p => ({ ...p, category: v }))} />
              <FormField label="Subject" placeholder="e.g., Mathematics, English, GK" value={editForm.subject} onChangeText={(v) => setEditForm(p => ({ ...p, subject: v }))} />
              {!isMultiSubjectCourse && (
                <FormField label="Teacher Name" placeholder="e.g., Pankaj Sir" value={editForm.teacherName} onChangeText={(v) => setEditForm(p => ({ ...p, teacherName: v }))} />
              )}
              {!isMultiSubjectCourse && (
                <>
                  <FormField label="Course Card Banner Image URL" placeholder="https://... (shown at top of home course card)" value={editForm.thumbnail} onChangeText={(v) => setEditForm(p => ({ ...p, thumbnail: v }))} />
                  {editForm.thumbnail ? (
                    <Image source={{ uri: editForm.thumbnail }} style={{ width: "100%", height: 120, borderRadius: 12, marginBottom: 8, backgroundColor: "#F8FAFC" }} resizeMode="cover" />
                  ) : null}
                  <Pressable
                    style={{ borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#EEF2FF", marginBottom: 10, opacity: uploading ? 0.6 : 1 }}
                    disabled={uploading}
                    onPress={() => pickFileAndUpload("images", "image/*", (url) => setEditForm((p) => ({ ...p, thumbnail: url })))}
                  >
                    {uploading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : <Ionicons name="cloud-upload-outline" size={17} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploading ? "Uploading..." : "Upload Banner to R2"}</Text>
                  </Pressable>
                  <FormField label="Language" placeholder="e.g., HINGLISH, Hindi, English" value={editForm.courseLanguage} onChangeText={(v) => setEditForm(p => ({ ...p, courseLanguage: v }))} />
                </>
              )}
              {isMultiSubjectCourse && (
                <>
                  <FormField label="Course Card Banner Image URL" placeholder="https://... (shown at top of multi-subject card)" value={editForm.thumbnail} onChangeText={(v) => setEditForm(p => ({ ...p, thumbnail: v }))} />
                  {editForm.thumbnail ? (
                    <Image source={{ uri: editForm.thumbnail }} style={{ width: "100%", height: 120, borderRadius: 12, marginBottom: 8, backgroundColor: "#F8FAFC" }} resizeMode="cover" />
                  ) : null}
                  <Pressable
                    style={{ borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, paddingVertical: 11, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#EEF2FF", marginBottom: 10, opacity: uploading ? 0.6 : 1 }}
                    disabled={uploading}
                    onPress={() => pickFileAndUpload("images", "image/*", (url) => setEditForm((p) => ({ ...p, thumbnail: url })))}
                  >
                    {uploading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : <Ionicons name="cloud-upload-outline" size={17} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploading ? "Uploading..." : "Upload Banner to R2"}</Text>
                  </Pressable>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginTop: -8, marginBottom: 10 }}>
                    Recommended banner size: 1200 × 450 px (8:3 ratio). This image appears at the top of the vertical multi-subject course card.
                  </Text>
                  <FormField label="Language" placeholder="e.g., HINGLISH, Hindi, English" value={editForm.courseLanguage} onChangeText={(v) => setEditForm(p => ({ ...p, courseLanguage: v }))} />
                  <View style={styles.formField}>
                    <Text style={styles.formLabel}>Batch Status</Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {(["live", "recorded"] as const).map((status) => (
                        <Pressable
                          key={status}
                          onPress={() => setEditForm((p) => ({ ...p, batchStatus: status }))}
                          style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderColor: editForm.batchStatus === status ? Colors.light.primary : Colors.light.border, backgroundColor: editForm.batchStatus === status ? "#EEF2FF" : "transparent", alignItems: "center" }}
                        >
                          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: editForm.batchStatus === status ? Colors.light.primary : Colors.light.textMuted }}>{status.toUpperCase()}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </>
              )}
              <FormField label="Level" placeholder="beginner / intermediate / advanced" value={editForm.level} onChangeText={(v) => setEditForm(p => ({ ...p, level: v }))} />
              {!isTestSeries && (
                <>
                  <FormField label="Start Date" placeholder="e.g., 15 Mar 2026" value={editForm.startDate} onChangeText={(v) => setEditForm(p => ({ ...p, startDate: v }))} />
                  <FormField label="End Date" placeholder="e.g., 15 Jun 2026" value={editForm.endDate} onChangeText={(v) => setEditForm(p => ({ ...p, endDate: v }))} />
                </>
              )}
              <FormField label="Validity (months)" placeholder="e.g., 6" value={editForm.validityMonths} onChangeText={(v) => setEditForm(p => ({ ...p, validityMonths: v }))} numeric />
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

      {/* Admin Folder Detail Modal - Full Screen */}
      <Modal visible={openAdminFolder !== null} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable
              style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}
              onPress={() => {
                const current = openAdminFolder ? findFolderByPath(openAdminFolder.name, openAdminFolder.type) : null;
                if (current?.parent_id) {
                  const parent = safeFolders.find((f: any) => Number(f.id) === Number(current.parent_id));
                  if (parent) {
                    setOpenAdminFolder({ id: parent.id, name: folderFullName(parent), type: openAdminFolder!.type });
                    setFolderAddModal(false);
                    return;
                  }
                }
                if (openAdminFolder?.type === "lecture" && openAdminFolder.name.includes(" / ")) {
                  const parent = openAdminFolder.name.split(" / ").slice(0, -1).join(" / ");
                  const parentFolder = findFolderByPath(parent, "lecture");
                  setOpenAdminFolder({ id: parentFolder?.id, name: parent, type: "lecture" });
                  setFolderAddModal(false);
                  return;
                }
                setOpenAdminFolder(null);
                setFolderAddModal(false);
              }}
            >
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={1}>{openAdminFolder?.name}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>
                {openAdminFolder?.type === "test" ? "Test Folder" : openAdminFolder?.type === "lecture" ? "Lecture Folder" : "Material Folder"}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
              {openAdminFolder?.type === "lecture" &&
                (openAdminFolder.name === DEFAULT_LIVE_RECORDING_SECTION ||
                  openAdminFolder.name.startsWith(`${DEFAULT_LIVE_RECORDING_SECTION} /`)) && (
                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" }}
                  onPress={() => {
                    setLectureSubfolderLeafName("");
                    setShowLectureSubfolderModal(true);
                  }}
                >
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Add Subfolder</Text>
                </Pressable>
              )}
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" }}
                onPress={() => {
                  if (!openAdminFolder) return;
                  const current = findFolderByPath(openAdminFolder.name, openAdminFolder.type) || (openAdminFolder.id ? findFolderById(openAdminFolder.id) : null);
                  setEditFolderName(folderLocalName(current || openAdminFolder));
                  setEditingFolderId(current?.id ?? openAdminFolder.id ?? null);
                  setEditFolderModal(true);
                }}
              >
                <Ionicons name="pencil" size={16} color="#fff" />
              </Pressable>
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" }}
                onPress={async () => {
                  const folderType = openAdminFolder?.type || null;
                  if (!folderType || !openAdminFolder?.name) return;
                  let parentId = openAdminFolder.id || findFolderByPath(openAdminFolder.name, folderType)?.id || null;
                  if (!parentId) {
                    const ensuredParent = await createFolderMutation.mutateAsync({ name: openAdminFolder.name, type: folderType });
                    parentId = ensuredParent?.id || null;
                    if (parentId) {
                      setOpenAdminFolder({ id: parentId, name: ensuredParent?.full_name || openAdminFolder.name, type: folderType });
                    }
                  }
                  setNewFolderName("");
                  setNewFolderParentId(parentId);
                  setShowFolderPicker(folderType);
                }}
              >
                <Ionicons name="folder-open" size={16} color="#fff" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Subfolder</Text>
              </Pressable>
              <Pressable
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                onPress={() => {
                  if (openAdminFolder?.type === "test") {
                    const preset = activeTab === "pyqs" ? "pyq" : activeTab === "mocks" ? "mock" : "practice";
                    setNewTest({ ...emptyTest, testType: preset, folderName: openAdminFolder!.name, subjectKey: isMultiSubjectCourse ? activeSubjectKey : "" });
                  } else if (openAdminFolder?.type === "lecture") setNewLecture({ ...emptyLecture, sectionTitle: openAdminFolder!.name });
                  else if (openAdminFolder?.type === "material") setNewMaterial({ ...emptyMaterial, sectionTitle: openAdminFolder!.name });
                  setFolderAddModal(true);
                }}
              >
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>
                  {openAdminFolder?.type === "test" ? "Add Test" : openAdminFolder?.type === "lecture" ? "Add Lecture" : "Add Material"}
                </Text>
              </Pressable>
            </View>
          </LinearGradient>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPadding + 40 }}>
              {openAdminFolder && (() => {
                const parentId = openAdminFolder.id || findFolderByPath(openAdminFolder.name, openAdminFolder.type)?.id;
                const childFolders = safeFolders.filter((f: any) => f.type === openAdminFolder.type && Number(f.parent_id || 0) === Number(parentId || 0));
                if (!parentId || childFolders.length === 0 || openAdminFolder.type === "lecture") return null;
                return (
                  <View style={{ marginBottom: 12 }}>
                    {childFolders.map((child: any) => (
                      <Pressable
                        key={child.id}
                        style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: child?.is_hidden ? "#F3F4F6" : "#EEF2FF" }]}
                        onPress={() => setOpenAdminFolder({ id: child.id, name: folderFullName(child), type: openAdminFolder.type })}
                      >
                        <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.primary + "20", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name={child?.is_hidden ? "folder-outline" : "folder"} size={22} color={child?.is_hidden ? Colors.light.textMuted : Colors.light.primary} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: child?.is_hidden ? Colors.light.textMuted : Colors.light.text }}>{folderLocalName(child)}{child?.is_hidden ? " (Hidden)" : ""}</Text>
                          <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{folderFullName(child)}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                      </Pressable>
                    ))}
                  </View>
                );
              })()}
              {openAdminFolder?.type === "test" && (() => {
                const folderTests = courseTests.filter((t: any) => testMatchesFolder(t, openAdminFolder!.name));
                return (
                <>
                  {folderTests.length === 0 && !folderAddModal && (
                    <View style={[styles.infoCard, { marginBottom: 12 }]}>
                      <Ionicons name="folder-open-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>This folder is empty. Tap "Add Test" to add tests.</Text>
                    </View>
                  )}
                  <SortableList
                    ids={folderTests.map((t: any) => t.id)}
                    onReorder={(a, o) => reorderByDrag("test", folderTests, a, o)}
                  >
                  {folderTests.map((test: any, idx: number) => (
                      <SortableItem key={test.id} id={test.id}>
                      <View style={{ marginBottom: 8 }}>
                        <Pressable style={[styles.testCard]} onPress={() => openAdminTestAttempts(test)}>
                          <View style={styles.testCardRow}>
                            <Text style={styles.testCardTitle}>{test.title}</Text>
                            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                              {Platform.OS !== "web" && (
                                <>
                                  <Pressable
                                    style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === 0 ? 0.3 : 1 }]}
                                    disabled={idx === 0 || reorderMutation.isPending}
                                    onPress={(e) => { e.stopPropagation?.(); moveItem("test", folderTests, idx, "up"); }}
                                  >
                                    <Ionicons name="chevron-up" size={13} color={Colors.light.text} />
                                  </Pressable>
                                  <Pressable
                                    style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === folderTests.length - 1 ? 0.3 : 1 }]}
                                    disabled={idx === folderTests.length - 1 || reorderMutation.isPending}
                                    onPress={(e) => { e.stopPropagation?.(); moveItem("test", folderTests, idx, "down"); }}
                                  >
                                    <Ionicons name="chevron-down" size={13} color={Colors.light.text} />
                                  </Pressable>
                                </>
                              )}
                              <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={(e) => {
                                e.stopPropagation?.();
                                setFolderEditTest({ ...test, durationMinutes: String(test.duration_minutes), totalMarks: String(test.total_marks), difficulty: test.difficulty || "moderate" });
                              }}>
                                <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                              </Pressable>
                              <Pressable style={styles.deleteItemBtn} onPress={(e) => {
                                e.stopPropagation?.();
                                if (Platform.OS === "web") { if (window.confirm(`Delete "${test.title}"?`)) deleteTestMutation.mutate(test.id); }
                                else Alert.alert("Delete Test", `Delete "${test.title}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) }]);
                              }}>
                                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                              </Pressable>
                            </View>
                          </View>
                          <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
                          <View style={styles.testUploadRow}>
                            <Pressable style={styles.testUploadBtn} onPress={(e) => { e.stopPropagation?.(); setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => { resumeQuestionsModalAfterAddRef.current = null; setShowAddQuestion(test.id); }, 300); }}>
                              <Ionicons name="add-circle-outline" size={16} color={Colors.light.primary} />
                              <Text style={styles.testUploadBtnText}>Add Questions</Text>
                            </Pressable>
                            <Pressable style={[styles.testUploadBtn, { backgroundColor: "#FFF3E0" }]} onPress={(e) => { e.stopPropagation?.(); setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => { setShowBulkUpload(test.id); }, 300); }}>
                              <Ionicons name="cloud-upload" size={16} color="#FF6B35" />
                              <Text style={[styles.testUploadBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                            </Pressable>
                            <Pressable style={[styles.testUploadBtn, { backgroundColor: "#DCFCE7" }]} onPress={(e) => { e.stopPropagation?.(); setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => { setShowViewQuestions(test.id); loadQuestions(test.id); }, 300); }}>
                              <Ionicons name="list" size={16} color="#16A34A" />
                              <Text style={[styles.testUploadBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                            </Pressable>
                          </View>
                        </Pressable>
                      </View>
                      </SortableItem>
                    ))}
                  </SortableList>
                </>
                );
              })()}
              {openAdminFolder?.type === "lecture" && (
                <>
                  {(() => {
                    const subfolders = sortFolderNamesByOrder(getDirectLectureSubfolders(openAdminFolder.name), "lecture");
                    return (
                    <SortableList
                      ids={subfolders}
                      onReorder={(a, o) => reorderFoldersByDrag("lecture", subfolders, a, o)}
                    >
                    {subfolders.map((childName) => {
                    const childCount = course?.lectures?.filter((l: any) => l.section_title === childName).length || 0;
                    return (
                      <SortableItem key={childName} id={childName}>
                      <View style={[styles.itemCard, { marginBottom: 8 }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <Pressable
                            style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                            onPress={() => {
                              const childFolder = findFolderByPath(childName, "lecture");
                              setOpenAdminFolder({ id: childFolder?.id, name: childName, type: "lecture" });
                            }}
                          >
                            <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.primary + "20", alignItems: "center", justifyContent: "center" }}>
                              <Ionicons name="folder" size={22} color={Colors.light.primary} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text }}>
                                {childName.replace(`${openAdminFolder.name} / `, "")}
                              </Text>
                              <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                                {childCount} lecture{childCount !== 1 ? "s" : ""}
                              </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                          </Pressable>
                          <Pressable
                            style={{ padding: 8 }}
                            onPress={async () => {
                              const f = await ensureLectureFolderByPath(childName);
                              if (f) setFolderActionSheet(f);
                            }}
                          >
                            <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                          </Pressable>
                        </View>
                      </View>
                      </SortableItem>
                    );
                    })}
                    </SortableList>
                    );
                  })()}
                  {course?.lectures?.filter((l: any) => l.section_title === openAdminFolder.name).length === 0 &&
                    getDirectLectureSubfolders(openAdminFolder.name).length === 0 &&
                    !folderAddModal && (
                    <View style={[styles.infoCard, { marginBottom: 12 }]}>
                      <Ionicons name="folder-open-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>This folder is empty. Tap "Add Lecture" to add lectures.</Text>
                    </View>
                  )}
                  {(() => {
                    const folderLectures = course?.lectures?.filter((l: any) => l.section_title === openAdminFolder.name) || [];
                    return (
                    <SortableList
                      ids={folderLectures.map((l: any) => l.id)}
                      onReorder={(a, o) => reorderByDrag("lecture", folderLectures, a, o)}
                    >
                    {folderLectures.map((lecture: any, idx: number) => (
                    <SortableItem key={lecture.id} id={lecture.id}>
                    <View style={[styles.itemCard, { marginBottom: 8 }]}>
                      <View style={styles.itemRow}>
                        <View style={styles.itemIcon}><Ionicons name="videocam" size={16} color={Colors.light.primary} /></View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle}>{lecture.title}</Text>
                          <Text style={styles.itemMeta}>{lecture.duration_minutes}min · Order {lecture.order_index}</Text>
                        </View>
                        {Platform.OS !== "web" && (
                          <>
                            <Pressable
                              style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === 0 ? 0.3 : 1, marginRight: 4 }]}
                              disabled={idx === 0 || reorderMutation.isPending}
                              onPress={() => moveItem("lecture", folderLectures, idx, "up")}
                            >
                              <Ionicons name="chevron-up" size={13} color={Colors.light.text} />
                            </Pressable>
                            <Pressable
                              style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === folderLectures.length - 1 ? 0.3 : 1, marginRight: 4 }]}
                              disabled={idx === folderLectures.length - 1 || reorderMutation.isPending}
                              onPress={() => moveItem("lecture", folderLectures, idx, "down")}
                            >
                              <Ionicons name="chevron-down" size={13} color={Colors.light.text} />
                            </Pressable>
                          </>
                        )}
                        {(lecture.video_type === "r2" || inferLectureVideoType(lecture.video_url || "") === "r2") && !!lecture.video_url && (
                          <Pressable
                            style={[styles.deleteItemBtn, { backgroundColor: "#ECFDF5", marginRight: 4 }]}
                            onPress={() => void downloadAdminContent("lecture", lecture.id, `${lecture.title}.mp4`)}
                          >
                            <Ionicons name="download-outline" size={14} color="#059669" />
                          </Pressable>
                        )}
                        <Pressable
                          style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 4 }]}
                          onPress={() => {
                            setFolderEditLecture({
                              ...lecture,
                              durationMinutes: String(lecture.duration_minutes || 0),
                              orderIndex: String(lecture.order_index || 0),
                              videoUrl: lecture.video_url || "",
                              // Inside folder edit, keep the current folder path as base.
                              // Subfolder input should append relative path from this location.
                              sectionTitle: String(lecture.section_title || ""),
                              section_title: String(lecture.section_title || ""),
                              lecture_subfolder_title: "",
                            });
                          }}
                        >
                          <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                        </Pressable>
                        <Pressable style={styles.deleteItemBtn} onPress={() => deleteLectureMutation.mutate(lecture.id)}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                    </SortableItem>
                    ))}
                    </SortableList>
                    );
                  })()}
                </>
              )}
              {openAdminFolder?.type === "material" && (
                <>
                  {course?.materials?.filter((m: any) => m.section_title === openAdminFolder.name).length === 0 && !folderAddModal && (
                    <View style={[styles.infoCard, { marginBottom: 12 }]}>
                      <Ionicons name="folder-open-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>This folder is empty. Tap "Add Material" to add materials.</Text>
                    </View>
                  )}
                  {(() => {
                    const folderMaterials = course?.materials?.filter((m: any) => m.section_title === openAdminFolder.name) || [];
                    return (
                    <SortableList
                      ids={folderMaterials.map((m: any) => m.id)}
                      onReorder={(a, o) => reorderByDrag("material", folderMaterials, a, o)}
                    >
                    {folderMaterials.map((mat: any, idx: number) => (
                      <SortableItem key={mat.id} id={mat.id}>
                      <View style={[styles.itemCard, { marginBottom: 8 }]}>
                        <View style={styles.itemRow}>
                          <View style={[styles.itemIcon, { backgroundColor: "#FEE2E2" }]}><Ionicons name="document-text" size={16} color="#DC2626" /></View>
                          <View style={styles.itemInfo}>
                            <Text style={styles.itemTitle}>{mat.title}</Text>
                            <Text style={styles.itemMeta}>{mat.file_type?.toUpperCase() || "PDF"}</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                            {Platform.OS !== "web" && (
                              <>
                                <Pressable
                                  style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === 0 ? 0.3 : 1 }]}
                                  disabled={idx === 0 || reorderMutation.isPending}
                                  onPress={() => moveItem("material", folderMaterials, idx, "up")}
                                >
                                  <Ionicons name="chevron-up" size={13} color={Colors.light.text} />
                                </Pressable>
                                <Pressable
                                  style={[styles.deleteItemBtn, { backgroundColor: "#F3F4F6", opacity: idx === folderMaterials.length - 1 ? 0.3 : 1 }]}
                                  disabled={idx === folderMaterials.length - 1 || reorderMutation.isPending}
                                  onPress={() => moveItem("material", folderMaterials, idx, "down")}
                                >
                                  <Ionicons name="chevron-down" size={13} color={Colors.light.text} />
                                </Pressable>
                              </>
                            )}
                            <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => setFolderEditMaterial({ ...mat, fileUrl: mat.file_url || "", fileType: mat.file_type || "pdf", sectionTitle: mat.section_title || "", description: mat.description || "", downloadAllowed: mat.download_allowed || false })}>
                              <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                            </Pressable>
                            <Pressable style={styles.deleteItemBtn} onPress={() => deleteMaterialMutation.mutate(mat.id)}>
                              <Ionicons name="trash-outline" size={16} color="#EF4444" />
                            </Pressable>
                          </View>
                        </View>
                      </View>
                      </SortableItem>
                    ))}
                    </SortableList>
                    );
                  })()}
                </>
              )}
          </ScrollView>

          {/* Add Lecture Modal — inside folder */}
          {openAdminFolder?.type === "lecture" && (
            <Modal visible={folderAddModal} animationType="slide" transparent>
              <View style={styles.modalOverlay}>
                <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Add Lecture</Text>
                    <Pressable onPress={() => setFolderAddModal(false)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                    <FormField label="Lecture Title *" placeholder="e.g., Introduction" value={newLecture.title} onChangeText={(v) => setNewLecture(p => ({ ...p, title: v }))} />
                    <FormField label="Video URL (YouTube or uploaded)" placeholder="https://youtube.com/watch?v=..." value={newLecture.videoUrl} onChangeText={(v) => setNewLecture(p => ({ ...p, videoUrl: v }))} />
                    <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                      disabled={uploading}
                      onPress={() => pickFileAndUpload("lectures", "video/*,.mp4,.mov", (url) => setNewLecture(p => ({ ...p, videoUrl: url, videoType: "r2" } as any)))}>
                      {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload Video"}</Text>
                    </Pressable>
                    <FormField label="Description" placeholder="What students will learn" value={newLecture.description} onChangeText={(v) => setNewLecture(p => ({ ...p, description: v }))} />
                    <FormField label="Duration (minutes)" placeholder="45" value={newLecture.durationMinutes} onChangeText={(v) => setNewLecture(p => ({ ...p, durationMinutes: v }))} numeric />
                    <FormField label="Order Index" placeholder="1" value={newLecture.orderIndex} onChangeText={(v) => setNewLecture(p => ({ ...p, orderIndex: v }))} numeric />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <Switch value={newLecture.isFreePreview} onValueChange={(v) => setNewLecture(p => ({ ...p, isFreePreview: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Free Preview</Text>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <Switch value={(newLecture as any).downloadAllowed || false} onValueChange={(v) => setNewLecture(p => ({ ...p, downloadAllowed: v } as any))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
                    </View>
                  </ScrollView>
                  <ActionButton label="Add Lecture" onPress={() => { addLectureMutation.mutate({ ...newLecture, sectionTitle: openAdminFolder!.name }); setFolderAddModal(false); }} disabled={!newLecture.title || !newLecture.videoUrl} loading={addLectureMutation.isPending} />
                </View>
              </View>
            </Modal>
          )}

          {/* Add Test Modal — inside folder */}
          {openAdminFolder?.type === "test" && (
            <Modal visible={folderAddModal} animationType="slide" transparent>
              <View style={styles.modalOverlay}>
                <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Create Test</Text>
                    <Pressable onPress={() => setFolderAddModal(false)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                    <FormField label="Test Title *" placeholder="e.g., Chapter 1 Test" value={newTest.title} onChangeText={(v) => setNewTest(p => ({ ...p, title: v }))} />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Category</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                      {TEST_TYPES.map((t) => (
                        <Pressable key={t} onPress={() => setNewTest(p => ({ ...p, testType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: newTest.testType === t ? Colors.light.primary : "#F3F4F6", borderWidth: 1, borderColor: newTest.testType === t ? Colors.light.primary : "#E5E7EB" }}>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: newTest.testType === t ? "#fff" : Colors.light.text, textTransform: "uppercase" }}>{t === "pyq" ? "PYQs" : t}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <FormField label="Duration (minutes)" placeholder="60" value={newTest.durationMinutes} onChangeText={(v) => setNewTest(p => ({ ...p, durationMinutes: v }))} numeric />
                    <FormField label="Total Marks" placeholder="100" value={newTest.totalMarks} onChangeText={(v) => setNewTest(p => ({ ...p, totalMarks: v }))} numeric />
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Difficulty</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                      {["easy", "moderate", "hard"].map((d) => (
                        <Pressable key={d} onPress={() => setNewTest(p => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: newTest.difficulty === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6", borderWidth: 1, borderColor: newTest.difficulty === d ? "transparent" : "#E5E7EB" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: newTest.difficulty === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                  <ActionButton label="Create Test" onPress={() => { addTestMutation.mutate({ ...newTest, folderName: openAdminFolder!.name }); setFolderAddModal(false); }} disabled={!newTest.title} loading={addTestMutation.isPending} />
                </View>
              </View>
            </Modal>
          )}

          {/* Add Material Modal — inside folder */}
          {openAdminFolder?.type === "material" && (
            <Modal visible={folderAddModal} animationType="slide" transparent>
              <View style={styles.modalOverlay}>
                <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>Add Material</Text>
                    <Pressable onPress={() => setFolderAddModal(false)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                    <FormField label="Title *" placeholder="e.g., Chapter 1 Notes" value={newMaterial.title} onChangeText={(v) => setNewMaterial(p => ({ ...p, title: v }))} />
                    <View style={{ marginBottom: 12 }}>
                      <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>File *</Text>
                      {newMaterial.fileUrl ? (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F0FDF4", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#BBF7D0" }}>
                          <Ionicons name="document-text" size={20} color="#16A34A" />
                          <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: "#166534" }} numberOfLines={1}>{newMaterial.fileUrl.includes("cdn.3ilearning") ? "Uploaded to cloud ✓" : newMaterial.fileUrl}</Text>
                          <Pressable onPress={() => setNewMaterial(p => ({ ...p, fileUrl: "" }))}><Ionicons name="close-circle" size={20} color="#16A34A" /></Pressable>
                        </View>
                      ) : (
                        <>
                          <Pressable style={{ borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, borderRadius: 10, padding: 14, alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", marginBottom: 6, opacity: uploading ? 0.5 : 1 }}
                            disabled={uploading}
                            onPress={() => pickFileAndUpload("materials", ".pdf,.doc,.docx,video/*,.mp4,.mov", (url) => {
                              const ext = url.split(".").pop()?.toLowerCase() || "";
                              const ft = ext === "pdf" ? "pdf" : ["doc","docx"].includes(ext) ? "doc" : "video";
                              setNewMaterial(p => ({ ...p, fileUrl: url, fileType: ft }));
                            })}>
                            {uploading ? <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={22} color={Colors.light.primary} />}
                            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload File (PDF/DOC/Video)"}</Text>
                          </Pressable>
                          <FormField label="" placeholder="Or paste file URL..." value={newMaterial.fileUrl} onChangeText={(v) => setNewMaterial(p => ({ ...p, fileUrl: v }))} />
                        </>
                      )}
                    </View>
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>File Type</Text>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                      {["pdf", "video", "doc", "link"].map(t => (
                        <Pressable key={t} onPress={() => setNewMaterial(p => ({ ...p, fileType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: newMaterial.fileType === t ? Colors.light.primary : "#F3F4F6" }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: newMaterial.fileType === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <Switch value={newMaterial.downloadAllowed} onValueChange={(v) => setNewMaterial(p => ({ ...p, downloadAllowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
                    </View>
                  </ScrollView>
                  <ActionButton label="Add Material" onPress={() => { addMaterialMutation.mutate({ ...newMaterial, sectionTitle: openAdminFolder!.name }); setFolderAddModal(false); }} disabled={!newMaterial.title || !(newMaterial.fileUrl || "").trim()} loading={addMaterialMutation.isPending} />
                </View>
              </View>
            </Modal>
          )}

          {/* Edit Lecture Modal — inside folder */}
          <Modal visible={!!folderEditLecture} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Lecture</Text>
                  <Pressable onPress={() => setFolderEditLecture(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  <FormField label="Lecture Title *" placeholder="e.g., Introduction" value={folderEditLecture?.title || ""} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, title: v }))} />
                  <FormField label="Video URL (YouTube or uploaded)" placeholder="https://youtube.com/watch?v=..." value={folderEditLecture?.video_url || ""} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, video_url: v }))} />
                  <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                    disabled={uploading}
                    onPress={() => pickFileAndUpload("lectures", "video/*,.mp4,.mov", (url) => setFolderEditLecture((p: any) => ({ ...p, video_url: url, video_type: "r2" })))}>
                    {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload Video"}</Text>
                  </Pressable>
                  <FormField label="Description" placeholder="What students will learn" value={folderEditLecture?.description || ""} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, description: v }))} />
                  <FormField label="Folder/Section (optional)" placeholder="e.g., Live Class Recordings" value={folderEditLecture?.section_title || ""} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, section_title: v }))} />
                  <FormField label="Subfolder (optional)" placeholder="e.g., Number System" value={folderEditLecture?.lecture_subfolder_title || ""} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, lecture_subfolder_title: v }))} />
                  <FormField label="Duration (minutes)" placeholder="45" value={String(folderEditLecture?.duration_minutes || "")} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, duration_minutes: v }))} numeric />
                  <FormField label="Order Index" placeholder="1" value={String(folderEditLecture?.order_index || "")} onChangeText={(v) => setFolderEditLecture((p: any) => ({ ...p, order_index: v }))} numeric />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Switch value={folderEditLecture?.is_free_preview || false} onValueChange={(v) => setFolderEditLecture((p: any) => ({ ...p, is_free_preview: v }))} trackColor={{ false: Colors.light.border, true: Colors.light.primary }} thumbColor="#fff" />
                    <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Free Preview</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Switch value={folderEditLecture?.download_allowed || false} onValueChange={(v) => setFolderEditLecture((p: any) => ({ ...p, download_allowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                    <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
                  </View>
                </ScrollView>
                <ActionButton label="Save Changes" onPress={() => folderEditLecture && updateLectureMutation.mutate({ id: folderEditLecture.id, title: folderEditLecture.title, description: folderEditLecture.description || "", videoUrl: folderEditLecture.video_url, videoType: folderEditLecture.video_type || "youtube", durationMinutes: parseInt(folderEditLecture.duration_minutes) || 0, orderIndex: parseInt(folderEditLecture.order_index) || 0, isFreePreview: folderEditLecture.is_free_preview, sectionTitle: composeLectureSectionPath(folderEditLecture.section_title, folderEditLecture.lecture_subfolder_title), lectureSubfolderTitle: folderEditLecture.lecture_subfolder_title || null, downloadAllowed: folderEditLecture.download_allowed || false })} disabled={!folderEditLecture?.title} loading={updateLectureMutation.isPending} />
              </View>
            </View>
          </Modal>

          {/* Edit Test Modal — inside folder */}
          <Modal visible={!!folderEditTest} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Test</Text>
                  <Pressable onPress={() => setFolderEditTest(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  <FormField label="Test Title *" placeholder="e.g., Chapter 1 Test" value={folderEditTest?.title || ""} onChangeText={(v) => setFolderEditTest((p: any) => ({ ...p, title: v }))} />
                  <FormField label="Description" placeholder="Test description" value={folderEditTest?.description || ""} onChangeText={(v) => setFolderEditTest((p: any) => ({ ...p, description: v }))} />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Category</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                    {TEST_TYPES.map((t) => (
                      <Pressable key={t} onPress={() => setFolderEditTest((p: any) => ({ ...p, test_type: t }))} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: folderEditTest?.test_type === t ? Colors.light.primary : "#F3F4F6", borderWidth: 1, borderColor: folderEditTest?.test_type === t ? Colors.light.primary : "#E5E7EB" }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: folderEditTest?.test_type === t ? "#fff" : Colors.light.text, textTransform: "uppercase" }}>{t === "pyq" ? "PYQs" : t}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <FormField label="Duration (minutes)" placeholder="60" value={folderEditTest?.durationMinutes || ""} onChangeText={(v) => setFolderEditTest((p: any) => ({ ...p, durationMinutes: v }))} numeric />
                  <FormField label="Total Marks" placeholder="100" value={folderEditTest?.totalMarks || ""} onChangeText={(v) => setFolderEditTest((p: any) => ({ ...p, totalMarks: v }))} numeric />
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>Difficulty</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                    {["easy", "moderate", "hard"].map((d) => (
                      <Pressable key={d} onPress={() => setFolderEditTest((p: any) => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: (folderEditTest?.difficulty || "moderate") === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6", borderWidth: 1, borderColor: (folderEditTest?.difficulty || "moderate") === d ? "transparent" : "#E5E7EB" }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (folderEditTest?.difficulty || "moderate") === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
                <ActionButton label="Save Changes" onPress={() => folderEditTest && updateTestMutation.mutate({ id: folderEditTest.id, title: folderEditTest.title, description: folderEditTest.description || "", durationMinutes: parseInt(folderEditTest.durationMinutes) || 60, totalMarks: parseInt(folderEditTest.totalMarks) || 100, testType: folderEditTest.test_type, folderName: folderEditTest.folder_name || null, difficulty: folderEditTest.difficulty || "moderate", courseId: folderEditTest.course_id || parseInt(id) })} disabled={!folderEditTest?.title} loading={updateTestMutation.isPending} />
              </View>
            </View>
          </Modal>

          {/* Edit Material Modal — inside folder */}
          <Modal visible={!!folderEditMaterial} animationType="slide" transparent>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Edit Material</Text>
                  <Pressable onPress={() => setFolderEditMaterial(null)}><Ionicons name="close" size={24} color={Colors.light.text} /></Pressable>
                </View>
                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  <FormField label="Title *" placeholder="Material title" value={folderEditMaterial?.title || ""} onChangeText={(v) => setFolderEditMaterial((p: any) => ({ ...p, title: v }))} />
                  <FormField label="File URL" placeholder="https://..." value={folderEditMaterial?.file_url || folderEditMaterial?.fileUrl || ""} onChangeText={(v) => setFolderEditMaterial((p: any) => ({ ...p, file_url: v, fileUrl: v }))} />
                  <Pressable style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#EEF2FF", borderRadius: 10, paddingVertical: 10, borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed" as any, marginBottom: 12, opacity: uploading ? 0.5 : 1 }}
                    disabled={uploading}
                    onPress={() => pickFileAndUpload("materials", ".pdf,.doc,.docx,video/*,.mp4,.mov", (url) => {
                      const ext = url.split(".").pop()?.toLowerCase() || "";
                      const ft = ext === "pdf" ? "pdf" : ["doc","docx"].includes(ext) ? "doc" : "video";
                      setFolderEditMaterial((p: any) => ({ ...p, file_url: url, fileUrl: url, file_type: ft, fileType: ft }));
                    })}>
                    {uploading ? <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{uploadProgress}%</Text> : <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />}
                    <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploading ? `Uploading... ${uploadProgress}%` : "Upload New File"}</Text>
                  </Pressable>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 6 }}>File Type</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                    {["pdf", "video", "doc", "link"].map(t => (
                      <Pressable key={t} onPress={() => setFolderEditMaterial((p: any) => ({ ...p, file_type: t, fileType: t }))} style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: (folderEditMaterial?.file_type || folderEditMaterial?.fileType) === t ? Colors.light.primary : "#F3F4F6" }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (folderEditMaterial?.file_type || folderEditMaterial?.fileType) === t ? "#fff" : Colors.light.text }}>{t.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <FormField label="Description" placeholder="Short description" value={folderEditMaterial?.description || ""} onChangeText={(v) => setFolderEditMaterial((p: any) => ({ ...p, description: v }))} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Switch value={folderEditMaterial?.downloadAllowed || folderEditMaterial?.download_allowed || false} onValueChange={(v) => setFolderEditMaterial((p: any) => ({ ...p, downloadAllowed: v, download_allowed: v }))} trackColor={{ false: Colors.light.border, true: "#22C55E" }} thumbColor="#fff" />
                    <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>Allow Download</Text>
                  </View>
                </ScrollView>
                <ActionButton label="Save Changes" onPress={() => folderEditMaterial && updateMaterialMutation.mutate({ id: folderEditMaterial.id, title: folderEditMaterial.title, description: folderEditMaterial.description || "", fileUrl: folderEditMaterial.file_url || folderEditMaterial.fileUrl, fileType: folderEditMaterial.file_type || folderEditMaterial.fileType || "pdf", isFree: folderEditMaterial.is_free || false, sectionTitle: folderEditMaterial.sectionTitle || folderEditMaterial.section_title || null, downloadAllowed: folderEditMaterial.downloadAllowed || folderEditMaterial.download_allowed || false })} disabled={!folderEditMaterial?.title} loading={updateMaterialMutation.isPending} />
              </View>
            </View>
          </Modal>

          <Modal visible={showLectureSubfolderModal} animationType="fade" transparent onRequestClose={() => setShowLectureSubfolderModal(false)}>
            <View style={styles.modalOverlay}>
              <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>New subfolder</Text>
                  <Pressable onPress={() => setShowLectureSubfolderModal(false)}>
                    <Ionicons name="close" size={24} color={Colors.light.text} />
                  </Pressable>
                </View>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginBottom: 8 }}>
                  Creates a nested path under the current folder so you can group chapter live classes (e.g. {DEFAULT_LIVE_RECORDING_SECTION} / Chapter 1).
                </Text>
                <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 6 }} numberOfLines={2}>
                  Parent: {openAdminFolder?.name || "—"}
                </Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 4 }}>Subfolder name *</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Chapter 1 — Trigonometry"
                  placeholderTextColor={Colors.light.textMuted}
                  value={lectureSubfolderLeafName}
                  onChangeText={setLectureSubfolderLeafName}
                />
                {openAdminFolder ? (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 8 }} numberOfLines={2}>
                    Full path:{" "}
                    <Text style={{ fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                      {lectureSubfolderLeafName.trim()
                        ? `${openAdminFolder.name} / ${lectureSubfolderLeafName.trim()}`
                        : openAdminFolder.name}
                    </Text>
                  </Text>
                ) : null}
                <ActionButton
                  label="Create subfolder"
                  loading={createFolderMutation.isPending}
                  onPress={async () => {
                    const parent = openAdminFolder?.name;
                    if (!parent) return;
                    const leaf = lectureSubfolderLeafName.trim();
                    if (!leaf) {
                      if (Platform.OS === "web") window.alert("Enter a subfolder name");
                      else Alert.alert("Required", "Enter a subfolder name");
                      return;
                    }
                    if (leaf.includes(" / ")) {
                      if (Platform.OS === "web") window.alert('Subfolder name cannot contain " / "');
                      else Alert.alert("Invalid", 'Use a single segment (no " / " in the name).');
                      return;
                    }
                    const full = `${parent} / ${leaf}`;
                    if (full.length > MAX_FOLDER_NAME_LEN) {
                      if (Platform.OS === "web") window.alert(`Path is too long (max ${MAX_FOLDER_NAME_LEN} characters).`);
                      else Alert.alert("Too long", `Path is too long (max ${MAX_FOLDER_NAME_LEN} characters).`);
                      return;
                    }
                    try {
                      const parentId = openAdminFolder?.id || findFolderByPath(parent, "lecture")?.id || null;
                      const created = await createFolderMutation.mutateAsync({ name: parentId ? leaf : full, type: "lecture", parentId });
                      setOpenAdminFolder({ id: created?.id, name: created?.full_name || full, type: "lecture" });
                      setShowLectureSubfolderModal(false);
                      setLectureSubfolderLeafName("");
                    } catch {
                      if (Platform.OS === "web") window.alert("Could not create folder. It may already exist.");
                      else Alert.alert("Error", "Could not create folder. It may already exist.");
                    }
                  }}
                />
              </View>
            </View>
          </Modal>

          {/* Folder Action Sheet (inside open folder modal) */}
          <Modal visible={folderActionSheet !== null && openAdminFolder !== null} animationType="slide" transparent>
            <Pressable style={styles.modalOverlay} onPress={() => setFolderActionSheet(null)}>
              <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle} numberOfLines={1}>{folderActionSheet?.name}</Text>
                  <Pressable onPress={() => setFolderActionSheet(null)}>
                    <Ionicons name="close" size={24} color={Colors.light.text} />
                  </Pressable>
                </View>
                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#EEF2FF", marginBottom: 8 }}
                  onPress={() => {
                    const folder = folderActionSheet;
                    if (!folder) return;
                    const resolved = folder.id ?? findFolderByPath(folderFullName(folder) || folder.name, folder.type)?.id ?? null;
                    setEditFolderName(folderLocalName(folder));
                    setEditingFolderId(resolved);
                    setEditFolderModal(true);
                    setFolderActionSheet(null);
                  }}
                >
                  <Ionicons name="pencil" size={20} color={Colors.light.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Edit Folder</Text>
                    <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>Rename this folder</Text>
                  </View>
                </Pressable>
                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: Colors.light.background, marginBottom: 8 }}
                  onPress={async () => {
                    if (!folderActionSheet) return;
                    await updateFolderMutation.mutateAsync({ folderId: folderActionSheet.id, isHidden: !folderActionSheet.is_hidden });
                    setFolderActionSheet(null);
                  }}
                >
                  <Ionicons name={folderActionSheet?.is_hidden ? "eye" : "eye-off"} size={20} color={Colors.light.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                      {folderActionSheet?.is_hidden ? "Show Folder" : "Hide Folder"}
                    </Text>
                    <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
                      {folderActionSheet?.is_hidden ? "Make visible to students" : "Hide from students (admin can still see it)"}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderRadius: 12, backgroundColor: "#FEE2E2" }}
                  onPress={() => {
                    if (!folderActionSheet) return;
                    const doDelete = async () => {
                      await deleteFolderMutation.mutateAsync(folderActionSheet.id);
                      setFolderActionSheet(null);
                    };
                    if (Platform.OS === "web") {
                      if (window.confirm(`Delete folder "${folderActionSheet.name}" and all its content?`)) doDelete();
                    } else {
                      Alert.alert("Delete Folder", `Delete "${folderActionSheet.name}" and all its content permanently?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: doDelete },
                      ]);
                    }
                  }}
                >
                  <Ionicons name="trash" size={20} color="#EF4444" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Delete Folder</Text>
                    <Text style={{ fontSize: 12, color: "#EF4444", fontFamily: "Inter_400Regular", opacity: 0.7 }}>Permanently deletes folder and all content inside</Text>
                  </View>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        </View>
      </Modal>

      {/* Test Attempts Modal — after folder detail so attempts open on top of an open folder. */}
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
                    style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12 }]}
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

      {/* Folder Picker Modal: declared after folder detail so nested folder creation stays in front. */}
      <Modal visible={showFolderPicker !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Manage Folders</Text>
              <Pressable onPress={() => { setShowFolderPicker(null); setNewFolderName(""); setNewFolderParentId(null); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {dbFolders.filter((f: any) => f.type === showFolderPicker).map((folder: any) => (
                <Pressable
                  key={folder.id}
                  style={[styles.itemCard, { flexDirection: "row", alignItems: "center", padding: 12, gap: 10, marginBottom: 8 }]}
                  onPress={() => {
                    setOpenAdminFolder({ id: folder.id, name: folderFullName(folder), type: showFolderPicker! });
                    setShowFolderPicker(null);
                    setNewFolderName("");
                    setNewFolderParentId(null);
                  }}
                >
                  <Ionicons name="folder" size={20} color={Colors.light.primary} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{folderFullName(folder)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
                </Pressable>
              ))}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{newFolderParentId ? "New Subfolder Name" : "New Folder Name"}</Text>
                {newFolderParentId ? (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 6 }}>
                    Parent: {openAdminFolder?.name || folderFullName(findFolderById(newFolderParentId)) || folderFullName(folderActionSheet)}
                  </Text>
                ) : null}
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g., Chapter 1, Algebra"
                  placeholderTextColor={Colors.light.textMuted}
                  value={newFolderName}
                  onChangeText={setNewFolderName}
                />
              </View>
            </ScrollView>
            <ActionButton
              label="Create & Select Folder"
              onPress={async () => {
                const name = newFolderName.trim();
                const folderType = showFolderPicker!;
                if (!name) return;
                const parentFolder = findFolderById(newFolderParentId) || (newFolderParentId && openAdminFolder ? { id: openAdminFolder.id, full_name: openAdminFolder.name, name: openAdminFolder.name } : null);
                const parentName = parentFolder ? folderFullName(parentFolder) : "";
                const created = await createFolderMutation.mutateAsync({ name, type: folderType, parentId: newFolderParentId });
                setOpenAdminFolder({ id: created?.id, name: created?.full_name || (parentName ? `${parentName} / ${name}` : name), type: folderType });
                setShowFolderPicker(null);
                setNewFolderName("");
                setNewFolderParentId(null);
              }}
              disabled={!newFolderName.trim()}
              loading={createFolderMutation.isPending}
            />
          </View>
        </View>
      </Modal>

      {/* View/Edit Questions + Add Question + BulkUpload: after folder modal so they stack above on web */}
      {/* View/Edit Questions Modal */}
      <Modal visible={showViewQuestions !== null} animationType="slide" transparent={false} style={Platform.OS === "web" ? { zIndex: 100002 } : undefined}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12, zIndex: 10, elevation: 10, position: "relative" }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => {
              if (editQuestion != null) { setEditQuestion(null); return; }
              setShowViewQuestions(null); setQuestionsList([]); setEditQuestion(null);
            }}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 }}>
              {editQuestion != null ? "Edit question" : `Questions (${questionsList.length})`}
            </Text>
            {editQuestion == null && (
              <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
                onPress={() => {
                  if (showViewQuestions) {
                    resumeQuestionsModalAfterAddRef.current = showViewQuestions;
                    setAddQuestionAfterId(null);
                    setShowAddQuestion(showViewQuestions);
                    setShowViewQuestions(null);
                  }
                }}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Add</Text>
              </Pressable>
            )}
          </LinearGradient>
          {questionsLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
          ) : (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
              {questionsList.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
                  <Ionicons name="help-circle-outline" size={48} color={Colors.light.textMuted} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No questions yet</Text>
    </View>
              )}
              {questionsList.map((q: any, idx: number) => (
                <View key={q.id} style={{ gap: 8 }}>
                <View style={{
                  gap: 8,
                  ...(editQuestion?.id === q.id ? { zIndex: 1000, elevation: 24, position: "relative" as const } : {}),
                  backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.light.border,
                }}>
                  {editQuestion?.id === q.id ? (
                    <View style={{ gap: 10 }}>
                        {/* Question text */}
                        <TextInput style={[styles.formInput, { minHeight: 70, textAlignVertical: "top" }]} multiline value={editQuestion.question_text} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, question_text: v }))} placeholder="Question text" placeholderTextColor={Colors.light.textMuted} />
                        {/* Question image URL */}
                        <View style={{ gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Question Image (optional)</Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion.image_url || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, image_url: v }))} placeholder="Paste URL or upload" placeholderTextColor={Colors.light.textMuted} autoCapitalize="none" />
                            <Pressable style={{ backgroundColor: "#EEF2FF", borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}
                              onPress={() => pickFileAndUpload("images", "image/*", (url) => setEditQuestion((p: any) => ({ ...p, image_url: url })))}>
                              <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />
                            </Pressable>
                          </View>
                          {!!editQuestion.image_url && (
                            <View style={{ position: "relative" }}>
                              <Image source={{ uri: editQuestion.image_url }} style={{ width: "100%", height: 120, borderRadius: 8 }} resizeMode="contain" />
                              <Pressable onPress={() => setEditQuestion((p: any) => ({ ...p, image_url: "" }))} style={{ position: "absolute", top: 4, right: 4, backgroundColor: "#EF4444", borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
                                <Ionicons name="close" size={14} color="#fff" />
                              </Pressable>
                            </View>
                          )}
                        </View>
                        {/* Options */}
                        {["A","B","C","D"].map((opt) => (
                          <View key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Pressable onPress={() => setEditQuestion((p: any) => ({ ...p, correct_option: opt }))} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: editQuestion.correct_option === opt ? "#22C55E" : "#F3F4F6", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: editQuestion.correct_option === opt ? "#22C55E" : "#E5E7EB" }}>
                              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: editQuestion.correct_option === opt ? "#fff" : Colors.light.text }}>{opt}</Text>
                            </Pressable>
                            <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion[`option_${opt.toLowerCase()}`]} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, [`option_${opt.toLowerCase()}`]: v }))} placeholder={`Option ${opt}`} placeholderTextColor={Colors.light.textMuted} />
                          </View>
                        ))}
                        {/* Explanation */}
                        <TextInput style={[styles.formInput, { minHeight: 50, textAlignVertical: "top" }]} multiline value={editQuestion.explanation || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, explanation: v }))} placeholder="Explanation (optional)" placeholderTextColor={Colors.light.textMuted} />
                        {/* Solution image URL */}
                        <View style={{ gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Solution Image (optional)</Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <TextInput style={[styles.formInput, { flex: 1 }]} value={editQuestion.solution_image_url || ""} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, solution_image_url: v }))} placeholder="Paste URL or upload" placeholderTextColor={Colors.light.textMuted} autoCapitalize="none" />
                            <Pressable style={{ backgroundColor: "#EEF2FF", borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }}
                              onPress={() => pickFileAndUpload("images", "image/*", (url) => setEditQuestion((p: any) => ({ ...p, solution_image_url: url })))}>
                              <Ionicons name="cloud-upload-outline" size={18} color={Colors.light.primary} />
                            </Pressable>
                          </View>
                          {!!editQuestion.solution_image_url && (
                            <View style={{ position: "relative" }}>
                              <Image source={{ uri: editQuestion.solution_image_url }} style={{ width: "100%", height: 120, borderRadius: 8 }} resizeMode="contain" />
                              <Pressable onPress={() => setEditQuestion((p: any) => ({ ...p, solution_image_url: "" }))} style={{ position: "absolute", top: 4, right: 4, backgroundColor: "#EF4444", borderRadius: 12, width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
                                <Ionicons name="close" size={14} color="#fff" />
                              </Pressable>
                            </View>
                          )}
                        </View>
                        {/* Difficulty */}
                        <View style={{ gap: 4 }}>
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Difficulty</Text>
                          <View style={{ flexDirection: "row", gap: 8 }}>
                            {["easy","moderate","hard"].map((d) => (
                              <Pressable key={d} onPress={() => setEditQuestion((p: any) => ({ ...p, difficulty: d }))} style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center", backgroundColor: (editQuestion.difficulty || "moderate") === d ? (d === "easy" ? "#22C55E" : d === "moderate" ? "#F59E0B" : "#EF4444") : "#F3F4F6" }}>
                                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: (editQuestion.difficulty || "moderate") === d ? "#fff" : Colors.light.text, textTransform: "capitalize" }}>{d}</Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                        {/* Marks row */}
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Correct Marks</Text>
                            <TextInput style={styles.formInput} value={String(editQuestion.marks ?? 4)} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, marks: v }))} keyboardType="numeric" placeholder="4" placeholderTextColor={Colors.light.textMuted} />
                          </View>
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Negative Marks</Text>
                            <TextInput style={styles.formInput} value={String(editQuestion.negative_marks ?? 1)} onChangeText={(v) => setEditQuestion((p: any) => ({ ...p, negative_marks: v }))} keyboardType="numeric" placeholder="1" placeholderTextColor={Colors.light.textMuted} />
                          </View>
                        </View>
                        {/* Save / Cancel */}
                        <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
                          <Pressable style={{ flex: 1, backgroundColor: Colors.light.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center" }} onPress={() => updateQuestionMutation.mutate({ id: editQuestion.id, questionText: editQuestion.question_text, optionA: editQuestion.option_a, optionB: editQuestion.option_b, optionC: editQuestion.option_c, optionD: editQuestion.option_d, correctOption: editQuestion.correct_option, explanation: editQuestion.explanation || "", topic: editQuestion.topic || "", marks: parseFloat(editQuestion.marks) || 4, negativeMarks: parseFloat(editQuestion.negative_marks) || 1, difficulty: editQuestion.difficulty || "moderate", imageUrl: editQuestion.image_url || null, solutionImageUrl: editQuestion.solution_image_url || null })}>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Save</Text>
                          </Pressable>
                          <Pressable style={{ flex: 1, backgroundColor: "#F3F4F6", borderRadius: 10, paddingVertical: 12, alignItems: "center" }} onPress={() => setEditQuestion(null)}>
                            <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Cancel</Text>
                          </Pressable>
                        </View>
                    </View>
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: Colors.light.textMuted, minWidth: 24 }}>Q{idx + 1}.</Text>
                        <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{q.question_text}</Text>
                      </View>
                      {["A","B","C","D"].map((opt) => (
                        <View key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 24 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: q.correct_option === opt ? "#DCFCE7" : "#F3F4F6", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: q.correct_option === opt ? "#16A34A" : Colors.light.textMuted }}>{opt}</Text>
                          </View>
                          <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: q.correct_option === opt ? "#16A34A" : Colors.light.text }}>{q[`option_${opt.toLowerCase()}`]}</Text>
                        </View>
                      ))}
                      <View style={{ flexDirection: "row", gap: 8, paddingTop: 4 }}>
                        <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }} onPress={() => setEditQuestion({ ...q })}>
                          <Ionicons name="pencil-outline" size={14} color={Colors.light.primary} />
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Edit</Text>
                        </Pressable>
                        <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }} onPress={() => {
                          if (Platform.OS === "web") { if (window.confirm("Delete this question?")) deleteQuestionMutation.mutate(q.id); }
                          else Alert.alert("Delete", "Delete this question?", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteQuestionMutation.mutate(q.id) }]);
                        }}>
                          <Ionicons name="trash-outline" size={14} color="#EF4444" />
                          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#EF4444" }}>Delete</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
                {editQuestion?.id !== q.id && showViewQuestions !== null ? (
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 4 }}>
                    <Pressable
                      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: Colors.light.primary, backgroundColor: `${Colors.light.primary}10` }}
                      onPress={() => {
                        if (showViewQuestions != null) resumeQuestionsModalAfterAddRef.current = showViewQuestions;
                        setAddQuestionAfterId(q.id);
                        setNewQuestion(emptyQuestion);
                        setShowAddQuestion(showViewQuestions);
                        setShowViewQuestions(null);
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
                          testId: showViewQuestions!,
                          insertAfterQuestionId: q.id,
                          duplicateRefresh: true,
                          data: {
                            questionText: q.question_text || "",
                            optionA: q.option_a || "",
                            optionB: q.option_b || "",
                            optionC: q.option_c || "",
                            optionD: q.option_d || "",
                            correctOption: ["A", "B", "C", "D"].includes(co) ? co : "A",
                            explanation: q.explanation || "",
                            topic: q.topic || "",
                            marks: String(q.marks ?? 4),
                            negativeMarks: String(q.negative_marks ?? 1),
                            difficulty: q.difficulty || "moderate",
                            imageUrl: q.image_url || "",
                            solutionImageUrl: q.solution_image_url || "",
                          },
                        });
                      }}
                    >
                      <Ionicons name="copy-outline" size={17} color="#9333EA" />
                      <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#9333EA" }}>Duplicate below</Text>
                    </Pressable>
                  </View>
                ) : null}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Add Question Modal */}
      <Modal visible={showAddQuestion !== null} animationType="slide" transparent onRequestClose={closeAddQuestionModal} style={Platform.OS === "web" ? { zIndex: 100003 } : undefined}>
        <View style={[styles.modalOverlay, Platform.OS === "web" ? { zIndex: 100003, elevation: 120 } : { elevation: 120 }]}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{addQuestionAfterId ? "Add Question Below" : "Add Question"}</Text>
                {!!addQuestionAfterId && (
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 }}>Inserted after the selected question when you save.</Text>
                )}
              </View>
              <Pressable onPress={closeAddQuestionModal}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <FormField label="Question *" placeholder="Enter the question text" value={newQuestion.questionText} onChangeText={(v) => setNewQuestion(p => ({ ...p, questionText: v }))} multiline />
              <FormField label="Option A *" placeholder="First option" value={newQuestion.optionA} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionA: v }))} />
              <FormField label="Option B *" placeholder="Second option" value={newQuestion.optionB} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionB: v }))} />
              <FormField label="Option C" placeholder="Third option" value={newQuestion.optionC} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionC: v }))} />
              <FormField label="Option D" placeholder="Fourth option" value={newQuestion.optionD} onChangeText={(v) => setNewQuestion(p => ({ ...p, optionD: v }))} />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Correct Option</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {["A", "B", "C", "D"].map((opt) => (
                    <Pressable key={opt} onPress={() => setNewQuestion(p => ({ ...p, correctOption: opt }))}
                      style={{ flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 2, alignItems: "center",
                        borderColor: newQuestion.correctOption === opt ? "#22C55E" : Colors.light.border,
                        backgroundColor: newQuestion.correctOption === opt ? "#DCFCE7" : "transparent" }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: newQuestion.correctOption === opt ? "#16A34A" : Colors.light.textMuted }}>{opt}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <FormField label="Topic" placeholder="e.g., Trigonometry" value={newQuestion.topic} onChangeText={(v) => setNewQuestion(p => ({ ...p, topic: v }))} />
              <FormField label="Explanation (optional)" placeholder="Solution explanation" value={newQuestion.explanation} onChangeText={(v) => setNewQuestion(p => ({ ...p, explanation: v }))} multiline />
              <View style={styles.formField}>
                <Text style={styles.formLabel}>Difficulty</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(["easy", "moderate", "hard"] as const).map((d) => {
                    const diffColors: Record<string, string> = { easy: "#22C55E", moderate: "#F59E0B", hard: "#EF4444" };
                    const active = (newQuestion as any).difficulty === d;
                    return (
                      <Pressable key={d} onPress={() => setNewQuestion(p => ({ ...p, difficulty: d } as any))}
                        style={{ flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 2, alignItems: "center",
                          borderColor: active ? diffColors[d] : Colors.light.border,
                          backgroundColor: active ? diffColors[d] + "18" : "transparent" }}>
                        <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: active ? diffColors[d] : Colors.light.textMuted, textTransform: "capitalize" }}>{d}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <FormField label="Marks for correct" placeholder="4" value={newQuestion.marks} onChangeText={(v) => setNewQuestion(p => ({ ...p, marks: v }))} numeric />
              <FormField label="Negative marks for wrong" placeholder="1" value={newQuestion.negativeMarks} onChangeText={(v) => setNewQuestion(p => ({ ...p, negativeMarks: v }))} numeric />
              {/* Question Image */}
              <Text style={styles.formLabel}>Question Image (optional)</Text>
              <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 6 }}>Recommended: 800×400px, JPG/PNG, max 2MB</Text>
              <AdminImageBox imageUrl={newQuestion.imageUrl} onUrlChange={(v) => setNewQuestion(p => ({ ...p, imageUrl: v }))} />
              {/* Solution Image */}
              <Text style={styles.formLabel}>Solution Image (optional)</Text>
              <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 6 }}>Recommended: 800×400px, JPG/PNG, max 2MB</Text>
              <AdminImageBox imageUrl={newQuestion.solutionImageUrl} onUrlChange={(v) => setNewQuestion(p => ({ ...p, solutionImageUrl: v }))} />
            </ScrollView>
            <ActionButton
              label="Add Question"
              onPress={() => {
                if (showAddQuestion) {
                  addQuestionMutation.mutate({
                    testId: showAddQuestion,
                    data: newQuestion,
                    insertAfterQuestionId: addQuestionAfterId ?? undefined,
                  });
                }
              }}
              disabled={!newQuestion.questionText || !newQuestion.optionA || !newQuestion.optionB}
              loading={addQuestionMutation.isPending}
            />
          </View>
        </View>
      </Modal>

      <BulkUploadModal
        visible={showBulkUpload !== null}
        testId={showBulkUpload}
        onClose={() => setShowBulkUpload(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] }); setShowBulkUpload(null); }}
        bottomPadding={bottomPadding}
        modalStyle={Platform.OS === "web" ? { zIndex: 100004 } : undefined}
      />

      {/* Edit Folder Modal — after folder detail so rename form stacks on top */}
      <Modal visible={editFolderModal} animationType="slide" transparent style={Platform.OS === "web" ? { zIndex: 100005 } : undefined}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end", ...(Platform.OS === "web" ? { zIndex: 100005 } : {}) }}>
          <Pressable style={{ flex: 1 }} onPress={() => setEditFolderModal(false)} />
          <View
            style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPadding + 20, gap: 16 }}
            onStartShouldSetResponder={() => true}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Edit Folder</Text>
              <Pressable onPress={() => setEditFolderModal(false)}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Folder Name</Text>
            <TextInput
              style={{ backgroundColor: Colors.light.background, borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.light.text }}
              value={editFolderName}
              onChangeText={setEditFolderName}
              placeholder="Enter folder name"
              placeholderTextColor={Colors.light.textMuted}
              autoFocus
            />
            <Pressable
              style={{ backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: !editFolderName.trim() ? 0.5 : 1 }}
              disabled={!editFolderName.trim() || renameFolderMutation.isPending}
              onPress={async () => {
                if (!editFolderName.trim()) return;
                let folderId = editingFolderId;
                if (!folderId && folderActionSheet) {
                  folderId = folderActionSheet.id ?? findFolderByPath(folderFullName(folderActionSheet) || folderActionSheet.name, folderActionSheet.type)?.id ?? null;
                }
                if (!folderId && openAdminFolder) {
                  folderId = openAdminFolder.id ?? findFolderByPath(openAdminFolder.name, openAdminFolder.type)?.id ?? null;
                }
                if (!folderId) {
                  Alert.alert("Error", "This folder can't be renamed (missing folder reference). Please reopen the folder and try again.");
                  return;
                }
                try {
                  await renameFolderMutation.mutateAsync({ folderId, name: editFolderName.trim() });
                  setEditFolderModal(false);
                  setEditFolderName("");
                  setEditingFolderId(null);
                } catch {
                  // error surfaced by mutation onError
                }
              }}
            >
              {renameFolderMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Save Changes</Text>
              }
            </Pressable>
          </View>
        </View>
      </Modal>

    </View>
  );
}

function AdminImageBox({ imageUrl, onUrlChange }: { imageUrl: string; onUrlChange: (v: string) => void }) {
  const [showInput, setShowInput] = useState(false);
  const [urlText, setUrlText] = useState(imageUrl);
  const pickImage = () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = (e: any) => {
        const file = e.target?.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { const d = ev.target?.result as string; onUrlChange(d); setUrlText(d); };
        reader.readAsDataURL(file);
      };
      input.click();
    } else {
      import("expo-image-picker").then(async (ImagePicker) => {
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
        if (!result.canceled && result.assets?.[0]) { onUrlChange(result.assets[0].uri); setUrlText(result.assets[0].uri); }
      }).catch(() => Alert.alert("Error", "Could not open image picker"));
    }
  };
  return (
    <View style={{ marginBottom: 12 }}>
      {imageUrl ? (
        <View style={{ borderRadius: 10, overflow: "hidden", borderWidth: 1, borderColor: Colors.light.border, marginBottom: 6 }}>
          <Image source={{ uri: imageUrl }} style={{ width: "100%", height: 140 }} resizeMode="contain" />
          <Pressable style={{ position: "absolute", top: 6, right: 6, backgroundColor: "#EF4444", borderRadius: 14, width: 26, height: 26, alignItems: "center", justifyContent: "center" }} onPress={() => { onUrlChange(""); setUrlText(""); }}>
            <Ionicons name="close" size={14} color="#fff" />
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: Colors.light.border }} onPress={pickImage}>
          <Ionicons name="image-outline" size={15} color={Colors.light.primary} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Upload</Text>
        </Pressable>
        <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 9, borderRadius: 8, backgroundColor: Colors.light.secondary, borderWidth: 1, borderColor: Colors.light.border }} onPress={() => setShowInput(v => !v)}>
          <Ionicons name="link-outline" size={15} color={Colors.light.primary} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>URL</Text>
        </Pressable>
      </View>
      {showInput && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
          <TextInput style={[styles.formInput, { flex: 1, marginBottom: 0 }]} placeholder="https://..." placeholderTextColor={Colors.light.textMuted} value={urlText} onChangeText={setUrlText} autoCapitalize="none" />
          <Pressable style={{ backgroundColor: Colors.light.primary, borderRadius: 8, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }} onPress={() => { onUrlChange(urlText); setShowInput(false); }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>Set</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function FormField({
  label, placeholder, value, onChangeText, multiline, numeric, autoCapitalize, tall,
}: {
  label: string; placeholder: string; value: string;
  onChangeText: (v: string) => void; multiline?: boolean; numeric?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters"; tall?: boolean;
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.formLabel}>{label}</Text>
      <TextInput
        style={[styles.formInput, multiline && styles.formInputMulti, tall && styles.formInputMultiTall]}
        placeholder={placeholder}
        placeholderTextColor={Colors.light.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        blurOnSubmit={multiline ? false : undefined}
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
  subjectContentNav: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12, marginBottom: 4 },
  subjectContentNavHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" },
  subjectContentNavBadge: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  subjectContentNavTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  subjectContentNavHint: { fontSize: 11, fontFamily: "Inter_500Medium" },
  subjectContentTabsRow: { gap: 8, paddingVertical: 2 },
  subjectContentTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#DBEAFE" },
  subjectContentTabActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  subjectContentTabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  subjectContentTabTextActive: { color: "#fff", fontFamily: "Inter_700Bold" },
  content: { padding: 16, gap: 12 },
  section: { gap: 10 },
  aboutSectionWrap: { gap: 16 },
  aboutPanel: { padding: 16 },
  aboutTeachersHeader: { marginTop: 4 },
  aboutTeacherGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  aboutTeacherCard: { width: Platform.OS === "web" ? "49%" : "100%", gap: 4 },
  aboutTeacherTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, marginBottom: 4 },
  aboutTeacherAvatar: { width: 72, height: 72, borderRadius: 18, backgroundColor: "#F8FAFC" },
  aboutTeacherAvatarFallback: { width: 72, height: 72, borderRadius: 18, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" },
  aboutUploadBtn: { borderWidth: 1.5, borderColor: Colors.light.primary, borderStyle: "dashed", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, backgroundColor: "#EEF2FF", marginBottom: 4 },
  aboutUploadBtnText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
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
  formInputMultiTall: { minHeight: 100, height: undefined },
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
