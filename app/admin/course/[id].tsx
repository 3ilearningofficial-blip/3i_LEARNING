import React, { useEffect, useState } from "react";
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
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import Colors from "@/constants/colors";
import { fetch } from "expo/fetch";
import BulkUploadModal from "@/components/BulkUploadModal";
import { DEFAULT_LIVE_RECORDING_SECTION } from "@/lib/recordingSection";

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
  folder_name?: string;
  difficulty?: string;
}

interface Material {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  section_title?: string;
  download_allowed?: boolean;
}

interface LiveClassItem {
  id: number;
  title: string;
  youtube_url: string;
  is_live: boolean;
  is_completed: boolean;
  is_public: boolean;
  scheduled_at: number;
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
}

interface NewLecture {
  title: string; description: string; videoUrl: string;
  videoType: string; durationMinutes: string; orderIndex: string;
  isFreePreview: boolean; sectionTitle: string;
}

interface NewTestForm {
  title: string; description: string; durationMinutes: string;
  totalMarks: string; testType: string; folderName: string; difficulty: string; scheduledAt: string;
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
  downloadAllowed: boolean;
}

interface NewLiveClass {
  title: string; description: string; youtubeUrl: string;
  scheduledAt: string; isLive: boolean; isPublic: boolean;
  /** Main section (e.g. "Live Class Recordings") for auto-saved recording */
  lectureSectionTitle: string;
  /** Optional subfolder segment (e.g. "Chapter 1") — full path = main + " / " + sub */
  lectureSubfolderTitle: string;
}

type AdminCourseTab = "lectures" | "tests" | "materials" | "live" | "enrolled";

const ADMIN_COURSE_TABS: { key: AdminCourseTab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "lectures", label: "Lectures", icon: "videocam" },
  { key: "tests", label: "Tests", icon: "document-text" },
  { key: "materials", label: "Materials", icon: "folder" },
  { key: "live", label: "Live", icon: "radio" },
  { key: "enrolled", label: "Students", icon: "people" },
];

const emptyLecture: NewLecture = { title: "", description: "", videoUrl: "", videoType: "youtube", durationMinutes: "0", orderIndex: "0", isFreePreview: false, sectionTitle: "" };
const TEST_TYPES = ["practice", "test", "pyq", "mock"];
const emptyTest: NewTestForm = { title: "", description: "", durationMinutes: "60", totalMarks: "100", testType: "practice", folderName: "", difficulty: "moderate", scheduledAt: "" };
const emptyQuestion: NewQuestion = { questionText: "", optionA: "", optionB: "", optionC: "", optionD: "", correctOption: "A", explanation: "", topic: "", marks: "4", negativeMarks: "1", imageUrl: "", solutionImageUrl: "", difficulty: "moderate" };
const emptyMaterial: NewMaterial = { title: "", description: "", fileUrl: "", fileType: "pdf", isFree: false, sectionTitle: "", downloadAllowed: false };
const emptyLiveClass: NewLiveClass = { title: "", description: "", youtubeUrl: "", scheduledAt: "", isLive: false, isPublic: false, lectureSectionTitle: "Live Class Recordings", lectureSubfolderTitle: "" };

export default function AdminCourseScreen() {
  useEffect(() => {
    if (Platform.OS !== "web" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('[aria-hidden="true"]')) activeElement.blur();
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["aria-hidden"] });
    return () => observer.disconnect();
  }, []);

  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<AdminCourseTab>("lectures");
  const [showAddLecture, setShowAddLecture] = useState(false);
  const [showAddTest, setShowAddTest] = useState(false);
  const [showAddQuestion, setShowAddQuestion] = useState<number | null>(null);
  const [showViewQuestions, setShowViewQuestions] = useState<number | null>(null); // test id for viewing questions
  const [questionsList, setQuestionsList] = useState<any[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [editQuestion, setEditQuestion] = useState<any>(null);
  const [showAddMaterial, setShowAddMaterial] = useState(false);
  const [showAddLiveClass, setShowAddLiveClass] = useState(false);
  const [showEditCourse, setShowEditCourse] = useState(false);
  const [editForm, setEditForm] = useState<EditCourseForm>({
    title: "", description: "", teacherName: "", price: "0", originalPrice: "0",
    category: "", subject: "", isFree: false, isPublished: true, level: "beginner", durationHours: "0", startDate: "", endDate: "", validityMonths: "",
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
  const [openAdminFolder, setOpenAdminFolder] = useState<{ name: string; type: "lecture" | "test" | "material" } | null>(null);
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
  // Edit items (inside folder — modals inside folder modal)
  const [folderEditLecture, setFolderEditLecture] = useState<any>(null);
  const [folderEditTest, setFolderEditTest] = useState<any>(null);
  const [folderEditMaterial, setFolderEditMaterial] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const courseIdNum = Number(id);

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

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
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
    queryKey: ["/api/courses", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
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
    refetchInterval: ["lectures", "tests", "materials"].includes(activeTab) ? 10000 : false,
  });

  const { data: courseLiveClasses = [], isPending: courseLivePending } = useQuery<LiveClassItem[]>({
    queryKey: ["/api/live-classes", id, "admin"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes?courseId=${id}&admin=true`, baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      if (!res.ok) return [];
      const raw = await res.json().catch(() => []);
      const payload = unwrapPayload(raw);
      return Array.isArray(payload) ? payload : [];
    },
    enabled: isValidId,
    staleTime: 30_000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: activeTab === "live" ? 8000 : false,
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

  const courseLectures = Array.isArray(course?.lectures) ? course.lectures : [];
  const courseTests = Array.isArray(course?.tests) ? course.tests : [];
  const courseMaterials = Array.isArray(course?.materials) ? course.materials : [];
  const safeFolders = Array.isArray(dbFolders) ? dbFolders : [];
  const LIVE_ROOT = DEFAULT_LIVE_RECORDING_SECTION;
  const getLectureRootName = (name: string) =>
    name.startsWith(`${LIVE_ROOT} /`) ? LIVE_ROOT : name;
  const getDirectLectureSubfolders = (parentName: string): string[] => {
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
      .map((f: any) => f.name)
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${parentName} / ${head}` : "";
      })
      .filter(Boolean);
    return [...new Set([...fromLectures, ...fromFolders])];
  };

  const MAX_FOLDER_NAME_LEN = 120;
  const createFolderMutation = useMutation({
    mutationFn: async ({ name, type }: { name: string; type: string }) => {
      const res = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name, type });
      return res.json();
    },
    onSuccess: () => {
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
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
    onSuccess: () => {
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: number) => {
      await apiRequest("DELETE", `/api/admin/courses/${id}/folders/${folderId}`);
    },
    onSuccess: () => {
      refetchFolders();
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
    },
  });

  const addLectureMutation = useMutation({
    mutationFn: async (data: NewLecture) => {
      if (!Number.isFinite(courseIdNum) || courseIdNum <= 0) throw new Error("Invalid course id");
      const title = (data.title || "").trim();
      const videoUrl = (data.videoUrl || "").trim();
      if (!title) throw new Error("Lecture title is required");
      if (!videoUrl) throw new Error("Video URL is required");
      await apiRequest("POST", "/api/admin/lectures", {
        ...data,
        courseId: courseIdNum,
        title,
        videoUrl,
        videoType: inferLectureVideoType(videoUrl),
        durationMinutes: parseInt(data.durationMinutes) || 0,
        orderIndex: parseInt(data.orderIndex) || 0,
        sectionTitle: data.sectionTitle || null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const updateLectureMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/lectures/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); setEditLecture(null); setFolderEditLecture(null); setFolderEditItem(null); },
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
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      refetchFolders();
      setShowAddTest(false); setFolderAddModal(false); setNewTest(emptyTest);
      Alert.alert("Success", "Test created!");
    },
    onError: () => Alert.alert("Error", "Failed to create test"),
  });

  const addQuestionMutation = useMutation({
    mutationFn: async ({ testId, data }: { testId: number; data: NewQuestion }) => {
      await apiRequest("POST", "/api/admin/questions", [{
        testId, ...data,
        marks: parseInt(data.marks), negativeMarks: parseFloat(data.negativeMarks),
        imageUrl: data.imageUrl || null, solutionImageUrl: data.solutionImageUrl || null,
      }]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      setShowAddQuestion(null); setNewQuestion(emptyQuestion);
      Alert.alert("Success", "Question added!");
    },
    onError: () => Alert.alert("Error", "Failed to add question"),
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/admin/tests/${testId}`);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const updateTestMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/tests/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); setEditTest(null); setFolderEditTest(null); setFolderEditItem(null); },
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
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/courses", id] });
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); qc.invalidateQueries({ queryKey: ["/api/courses"] }); },
  });

  const updateMaterialMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiRequest("PUT", `/api/admin/study-materials/${data.id}`, data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); setEditMaterial(null); setFolderEditMaterial(null); setFolderEditItem(null); },
    onError: () => Alert.alert("Error", "Failed to update material"),
  });

  const loadQuestions = async (testId: number) => {
    setQuestionsLoading(true);
    try {
      const res = await authFetch(new URL(`/api/admin/tests/${testId}/questions`, getApiUrl()).toString());
      if (res.ok) setQuestionsList(await res.json());
    } catch {}
    setQuestionsLoading(false);
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
    onSuccess: () => { if (showViewQuestions) loadQuestions(showViewQuestions); qc.invalidateQueries({ queryKey: ["/api/courses", id] }); },
  });

  const addLiveClassMutation = useMutation({
    mutationFn: async (data: NewLiveClass) => {
      await apiRequest("POST", "/api/admin/live-classes", {
        ...data,
        courseId: parseInt(id),
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt).getTime() : Date.now(),
        lectureSectionTitle: (data.lectureSectionTitle || "").trim() || undefined,
        lectureSubfolderTitle: (data.lectureSubfolderTitle || "").trim() || undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", id, "admin"] });
      qc.invalidateQueries({ queryKey: ["/api/live-classes"] });
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
        validityMonths: data.validityMonths || null,
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
        validityMonths: String((course as any).validity_months ?? ""),
      });
      setShowEditCourse(true);
    }
  };

  if (!isValidId) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
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
  const effectiveTab = isTestSeries && activeTab !== "enrolled" ? "tests" : activeTab;

  return (
    <View style={styles.container}>
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
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/admin" as any); }}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{course.title}</Text>
            <Text style={styles.headerSub}>
              {isTestSeries ? "Test Series" : `${Number(course.total_lectures) || courseLectures.length} lectures`} · {Number(course.total_tests) || courseTests.length} tests
            </Text>
          </View>
          <Pressable style={styles.editCourseBtn} onPress={openEditCourse}>
            <Ionicons name="create-outline" size={18} color="#fff" />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
          {ADMIN_COURSE_TABS.filter(t => !isTestSeries || t.key === "tests" || t.key === "enrolled").map((tab) => (
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
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + 80 }]}>
        {effectiveTab === "lectures" && !isTestSeries && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Lectures ({courseLectures.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => setShowFolderPicker("lecture")}>
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
            {[...new Set([
              ...courseLectures.map((l: any) => l.section_title).filter(Boolean),
              ...safeFolders.filter((f: any) => f.type === "lecture").map((f: any) => f.name),
            ].map((n: string) => getLectureRootName(n)))].map((folderName: any) => {
              const count = courseLectures.filter((l: any) => {
                const sec = typeof l.section_title === "string" ? l.section_title : "";
                return sec === folderName || sec.startsWith(`${folderName} /`);
              }).length;
              const folder = safeFolders.find((f: any) => f.name === folderName && f.type === "lecture");
              return (
                <View key={folderName} style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#EEF2FF" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => { setFolderAddMode(false); setOpenAdminFolder({ name: folderName, type: "lecture" }); }}>
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
                    let f = safeFolders.find((df: any) => df.name === folderName && df.type === "lecture");
                    if (!f) { const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: folderName, type: "lecture" }); f = await r.json(); refetchFolders(); }
                    setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
              );
            })}
            {/* Lectures without folder */}
            {courseLectures.filter((l: any) => !l.section_title).map((lecture) => (
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
                  <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 6 }]} onPress={() => setEditLecture({ ...lecture })}>
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
            ))}
          </View>
        )}

        {effectiveTab === "tests" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Tests ({courseTests.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => setShowFolderPicker("test")}>
                  <Ionicons name="folder-open" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Folder</Text>
                </Pressable>
                <Pressable style={styles.addBtn} onPress={() => setShowAddTest(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={styles.addBtnText}>Add Test</Text>
                </Pressable>
              </View>
            </View>
            {/* Folder cards for tests */}
            {[...new Set([
              ...courseTests.map((t: any) => t.folder_name).filter(Boolean),
              ...safeFolders.filter((f: any) => f.type === "test").map((f: any) => f.name),
            ])].map((folderName: any) => {
              const count = courseTests.filter((t: any) => t.folder_name === folderName).length;
              const folder = safeFolders.find((f: any) => f.name === folderName && f.type === "test");
              return (
                <View key={folderName} style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#EEF2FF" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => { setFolderAddMode(false); setOpenAdminFolder({ name: folderName, type: "test" }); }}>
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
                    let f = safeFolders.find((df: any) => df.name === folderName && df.type === "test");
                    if (!f) { const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: folderName, type: "test" }); f = await r.json(); refetchFolders(); }
                    setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
              );
            })}
            {courseTests.filter((test: any) => !test.folder_name).map((test) => (
              <View key={test.id} style={styles.testCard}>
                <View style={styles.testCardRow}>
                  <Text style={styles.testCardTitle}>{test.title}</Text>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => setEditTest({ ...test, durationMinutes: String(test.duration_minutes), difficulty: test.difficulty || "moderate" })}>
                      <Ionicons name="pencil-outline" size={14} color={Colors.light.primary} />
                    </Pressable>
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
                </View>
                <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
                <View style={styles.testUploadRow}>
                  <Pressable style={styles.testUploadBtn} onPress={() => setShowAddQuestion(test.id)}>
                    <Ionicons name="add-circle-outline" size={16} color={Colors.light.primary} />
                    <Text style={styles.testUploadBtnText}>Add Questions</Text>
                  </Pressable>
                  <Pressable style={[styles.testUploadBtn, { backgroundColor: "#FFF3E0" }]} onPress={() => setShowBulkUpload(test.id)}>
                    <Ionicons name="cloud-upload" size={16} color="#FF6B35" />
                    <Text style={[styles.testUploadBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                  </Pressable>
                  <Pressable style={[styles.testUploadBtn, { backgroundColor: "#DCFCE7" }]} onPress={() => { setShowViewQuestions(test.id); loadQuestions(test.id); }}>
                    <Ionicons name="list" size={16} color="#16A34A" />
                    <Text style={[styles.testUploadBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        )}

        {effectiveTab === "materials" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Materials ({courseMaterials.length})</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable style={[styles.addBtn, { backgroundColor: "#7C3AED" }]} onPress={() => setShowFolderPicker("material")}>
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
            {[...new Set([
              ...courseMaterials.map((m: any) => m.section_title).filter(Boolean),
              ...safeFolders.filter((f: any) => f.type === "material").map((f: any) => f.name),
            ])].map((folderName: any) => {
              const count = courseMaterials.filter((m: any) => m.section_title === folderName).length;
              const folder = safeFolders.find((f: any) => f.name === folderName && f.type === "material");
              return (
                <View key={folderName} style={[styles.itemCard, { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: folder?.is_hidden ? "#F3F4F6" : "#FFF1F2" }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => { setFolderAddMode(false); setOpenAdminFolder({ name: folderName, type: "material" }); }}>
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
                    let f = safeFolders.find((df: any) => df.name === folderName && df.type === "material");
                    if (!f) { const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: folderName, type: "material" }); f = await r.json(); refetchFolders(); }
                    setFolderActionSheet(f);
                  }}>
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
              );
            })}
            {courseMaterials.filter((m: any) => !m.section_title).map((mat) => (
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
                  <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 6 }]} onPress={() => setEditMaterial({ ...mat, sectionTitle: mat.section_title || "", downloadAllowed: mat.download_allowed || false })}>
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
            ))}
          </View>
        )}

        {effectiveTab === "live" && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Live Classes ({courseLiveClasses.length})</Text>
            </View>
            {courseLivePending && courseLiveClasses.length === 0 ? (
              <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 10 }}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Loading schedule…</Text>
              </View>
            ) : null}
            {!courseLivePending && courseLiveClasses.length === 0 && (
              <View style={styles.infoCard}>
                <Ionicons name="information-circle" size={16} color={Colors.light.primary} />
                <Text style={styles.infoText}>Schedule live classes from the Courses tab → Upcoming Class panel in the admin dashboard.</Text>
              </View>
            )}
            {courseLiveClasses.map((lc) => (
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
                        const run = () => updateLiveClassMutation.mutate({ lcId: lc.id, convertToLecture: true, sectionTitle: "Live Class Recordings" });
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
                    {!lc.is_live && (
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                        onPress={() => router.push(`/admin/studio/${lc.id}`)}
                      >
                        <Ionicons name="radio" size={14} color="#DC2626" />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#DC2626" }}>Start Live</Text>
                      </Pressable>
                    )}
                    {lc.is_live && (
                      <Pressable
                        style={{ flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#DC2626", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                        onPress={() => router.push(`/admin/broadcast/${lc.id}?streamType=${(lc as any).stream_type || 'rtmp'}` as any)}
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
                setEditFolderName(folderActionSheet?.name || "");
                setEditingFolderId(folderActionSheet?.id ?? null);
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
            <ActionButton label="Save Changes" onPress={() => editLecture && updateLectureMutation.mutate({ id: editLecture.id, title: editLecture.title, description: editLecture.description || "", videoUrl: editLecture.video_url, videoType: editLecture.video_type || "youtube", durationMinutes: parseInt(editLecture.duration_minutes) || 0, orderIndex: parseInt(editLecture.order_index) || 0, isFreePreview: editLecture.is_free_preview, sectionTitle: editLecture.section_title, downloadAllowed: editLecture.download_allowed || false, courseId: editLecture.course_id || parseInt(id) })} disabled={!editLecture?.title} loading={updateLectureMutation.isPending} />
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

      {/* Edit Folder Modal */}
      <Modal visible={editFolderModal} animationType="slide" transparent>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} onPress={() => setEditFolderModal(false)}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPadding + 20, gap: 16 }}>
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
                if (!editFolderName.trim() || !editingFolderId) return;
                await renameFolderMutation.mutateAsync({ folderId: editingFolderId, name: editFolderName.trim() });
                setEditFolderModal(false);
                setEditFolderName("");
                setEditingFolderId(null);
              }}
            >
              {renameFolderMutation.isPending
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Save Changes</Text>
              }
            </Pressable>
          </View>
        </Pressable>
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

      {/* View/Edit Questions Modal */}
      <Modal visible={showViewQuestions !== null} animationType="slide" transparent={false}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => { setShowViewQuestions(null); setQuestionsList([]); setEditQuestion(null); }}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 }}>Questions ({questionsList.length})</Text>
            <Pressable style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
              onPress={() => { if (showViewQuestions) setShowAddQuestion(showViewQuestions); setShowViewQuestions(null); }}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Add</Text>
            </Pressable>
          </LinearGradient>
          {questionsLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
              {questionsList.length === 0 && (
                <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
                  <Ionicons name="help-circle-outline" size={48} color={Colors.light.textMuted} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No questions yet</Text>
                </View>
              )}
              {questionsList.map((q: any, idx: number) => (
                <View key={q.id} style={{ backgroundColor: "#fff", borderRadius: 14, padding: 14, gap: 8, borderWidth: 1, borderColor: Colors.light.border }}>
                  {editQuestion?.id === q.id ? (
                    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 500 }}>
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
                    </ScrollView>
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
              ))}
            </ScrollView>
          )}
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

      <BulkUploadModal
        visible={showBulkUpload !== null}
        testId={showBulkUpload}
        onClose={() => setShowBulkUpload(null)}
        onSaved={() => { qc.invalidateQueries({ queryKey: ["/api/courses", id] }); setShowBulkUpload(null); }}
        bottomPadding={bottomPadding}
      />
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
              <FormField label="Description" placeholder="Course description" value={editForm.description} onChangeText={(v) => setEditForm(p => ({ ...p, description: v }))} multiline />
              <FormField label="Category *" placeholder="e.g., NDA, CDS, AFCAT" value={editForm.category} onChangeText={(v) => setEditForm(p => ({ ...p, category: v }))} />
              <FormField label="Subject" placeholder="e.g., Mathematics, English, GK" value={editForm.subject} onChangeText={(v) => setEditForm(p => ({ ...p, subject: v }))} />
              <FormField label="Teacher Name" placeholder="e.g., Pankaj Sir" value={editForm.teacherName} onChangeText={(v) => setEditForm(p => ({ ...p, teacherName: v }))} />
              <FormField label="Level" placeholder="beginner / intermediate / advanced" value={editForm.level} onChangeText={(v) => setEditForm(p => ({ ...p, level: v }))} />
              {!isTestSeries && (
                <>
                  <FormField label="Duration (hours)" placeholder="10" value={editForm.durationHours} onChangeText={(v) => setEditForm(p => ({ ...p, durationHours: v }))} numeric />
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

      {/* Folder Picker Modal */}
      <Modal visible={showFolderPicker !== null} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: bottomPadding + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Manage Folders</Text>
              <Pressable onPress={() => { setShowFolderPicker(null); setNewFolderName(""); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {dbFolders.filter((f: any) => f.type === showFolderPicker).map((folder: any) => (
                <Pressable
                  key={folder.id}
                  style={[styles.itemCard, { flexDirection: "row", alignItems: "center", padding: 12, gap: 10, marginBottom: 8 }]}
                  onPress={() => {
                    setOpenAdminFolder({ name: folder.name, type: showFolderPicker! });
                    setShowFolderPicker(null);
                    setNewFolderName("");
                  }}
                >
                  <Ionicons name="folder" size={20} color={Colors.light.primary} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{folder.name}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
                </Pressable>
              ))}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>New Folder Name</Text>
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
                await createFolderMutation.mutateAsync({ name, type: folderType });
                setOpenAdminFolder({ name, type: folderType });
                setShowFolderPicker(null);
                setNewFolderName("");
              }}
              disabled={!newFolderName.trim()}
              loading={createFolderMutation.isPending}
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
                if (openAdminFolder?.type === "lecture" && openAdminFolder.name.includes(" / ")) {
                  const parent = openAdminFolder.name.split(" / ").slice(0, -1).join(" / ");
                  setOpenAdminFolder({ name: parent, type: "lecture" });
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
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                onPress={() => {
                  if (openAdminFolder?.type === "test") setNewTest({ ...emptyTest, folderName: openAdminFolder!.name });
                  else if (openAdminFolder?.type === "lecture") setNewLecture({ ...emptyLecture, sectionTitle: openAdminFolder!.name });
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
              {openAdminFolder?.type === "test" && (
                <>
                  {course?.tests?.filter((test: any) => test.folder_name === openAdminFolder.name).length === 0 && !folderAddModal && (
                    <View style={[styles.infoCard, { marginBottom: 12 }]}>
                      <Ionicons name="folder-open-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>This folder is empty. Tap "Add Test" to add tests.</Text>
                    </View>
                  )}
                  {course?.tests?.filter((test: any) => test.folder_name === openAdminFolder.name).map((test: any) => (
                    <View key={test.id} style={{ marginBottom: 8 }}>
                        <View style={[styles.testCard]}>
                          <View style={styles.testCardRow}>
                            <Text style={styles.testCardTitle}>{test.title}</Text>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                              <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF" }]} onPress={() => {
                                setFolderEditTest({ ...test, durationMinutes: String(test.duration_minutes), totalMarks: String(test.total_marks), difficulty: test.difficulty || "moderate" });
                              }}>
                                <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                              </Pressable>
                              <Pressable style={styles.deleteItemBtn} onPress={() => {
                                if (Platform.OS === "web") { if (window.confirm(`Delete "${test.title}"?`)) deleteTestMutation.mutate(test.id); }
                                else Alert.alert("Delete Test", `Delete "${test.title}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteTestMutation.mutate(test.id) }]);
                              }}>
                                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                              </Pressable>
                            </View>
                          </View>
                          <Text style={styles.testCardMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.test_type}</Text>
                          <View style={styles.testUploadRow}>
                            <Pressable style={styles.testUploadBtn} onPress={() => { setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => setShowAddQuestion(test.id), 300); }}>
                              <Ionicons name="add-circle-outline" size={16} color={Colors.light.primary} />
                              <Text style={styles.testUploadBtnText}>Add Questions</Text>
                            </Pressable>
                            <Pressable style={[styles.testUploadBtn, { backgroundColor: "#FFF3E0" }]} onPress={() => { setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => { setShowBulkUpload(test.id); }, 300); }}>
                              <Ionicons name="cloud-upload" size={16} color="#FF6B35" />
                              <Text style={[styles.testUploadBtnText, { color: "#FF6B35" }]}>Bulk Upload</Text>
                            </Pressable>
                            <Pressable style={[styles.testUploadBtn, { backgroundColor: "#DCFCE7" }]} onPress={() => { setOpenAdminFolder(null); setFolderAddMode(false); setTimeout(() => { setShowViewQuestions(test.id); loadQuestions(test.id); }, 300); }}>
                              <Ionicons name="list" size={16} color="#16A34A" />
                              <Text style={[styles.testUploadBtnText, { color: "#16A34A" }]}>Edit Questions</Text>
                            </Pressable>
                          </View>
                        </View>
                    </View>
                  ))}
                </>
              )}
              {openAdminFolder?.type === "lecture" && (
                <>
                  {getDirectLectureSubfolders(openAdminFolder.name).map((childName) => {
                    const childCount = course?.lectures?.filter((l: any) => l.section_title === childName).length || 0;
                    return (
                      <View key={childName} style={[styles.itemCard, { marginBottom: 8 }]}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                          <Pressable
                            style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                            onPress={() => setOpenAdminFolder({ name: childName, type: "lecture" })}
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
                              let f = safeFolders.find((df: any) => df.name === childName && df.type === "lecture");
                              if (!f) {
                                const r = await apiRequest("POST", `/api/admin/courses/${id}/folders`, { name: childName, type: "lecture" });
                                f = await r.json();
                                refetchFolders();
                              }
                              setFolderActionSheet(f);
                            }}
                          >
                            <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                  {course?.lectures?.filter((l: any) => l.section_title === openAdminFolder.name).length === 0 &&
                    getDirectLectureSubfolders(openAdminFolder.name).length === 0 &&
                    !folderAddModal && (
                    <View style={[styles.infoCard, { marginBottom: 12 }]}>
                      <Ionicons name="folder-open-outline" size={16} color={Colors.light.primary} />
                      <Text style={styles.infoText}>This folder is empty. Tap "Add Lecture" to add lectures.</Text>
                    </View>
                  )}
                  {course?.lectures?.filter((l: any) => l.section_title === openAdminFolder.name).map((lecture: any) => (
                    <View key={lecture.id} style={[styles.itemCard, { marginBottom: 8 }]}>
                      <View style={styles.itemRow}>
                        <View style={styles.itemIcon}><Ionicons name="videocam" size={16} color={Colors.light.primary} /></View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle}>{lecture.title}</Text>
                          <Text style={styles.itemMeta}>{lecture.duration_minutes}min · Order {lecture.order_index}</Text>
                        </View>
                        <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 4 }]} onPress={() => setFolderEditLecture({ ...lecture, durationMinutes: String(lecture.duration_minutes || 0), orderIndex: String(lecture.order_index || 0), videoUrl: lecture.video_url || "", sectionTitle: lecture.section_title || "" })}>
                          <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                        </Pressable>
                        <Pressable style={styles.deleteItemBtn} onPress={() => deleteLectureMutation.mutate(lecture.id)}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                  ))}
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
                  {course?.materials?.filter((m: any) => m.section_title === openAdminFolder.name).map((mat: any) => (
                    <View key={mat.id} style={[styles.itemCard, { marginBottom: 8 }]}>
                      <View style={styles.itemRow}>
                        <View style={[styles.itemIcon, { backgroundColor: "#FEE2E2" }]}><Ionicons name="document-text" size={16} color="#DC2626" /></View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemTitle}>{mat.title}</Text>
                          <Text style={styles.itemMeta}>{mat.file_type?.toUpperCase() || "PDF"}</Text>
                        </View>
                        <Pressable style={[styles.deleteItemBtn, { backgroundColor: "#EEF2FF", marginRight: 4 }]} onPress={() => setFolderEditMaterial({ ...mat, fileUrl: mat.file_url || "", fileType: mat.file_type || "pdf", sectionTitle: mat.section_title || "", description: mat.description || "", downloadAllowed: mat.download_allowed || false })}>
                          <Ionicons name="pencil" size={14} color={Colors.light.primary} />
                        </Pressable>
                        <Pressable style={styles.deleteItemBtn} onPress={() => deleteMaterialMutation.mutate(mat.id)}>
                          <Ionicons name="trash-outline" size={16} color="#EF4444" />
                        </Pressable>
                      </View>
                    </View>
                  ))}
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
                <ActionButton label="Save Changes" onPress={() => folderEditLecture && updateLectureMutation.mutate({ id: folderEditLecture.id, title: folderEditLecture.title, description: folderEditLecture.description || "", videoUrl: folderEditLecture.video_url, videoType: folderEditLecture.video_type || "youtube", durationMinutes: parseInt(folderEditLecture.duration_minutes) || 0, orderIndex: parseInt(folderEditLecture.order_index) || 0, isFreePreview: folderEditLecture.is_free_preview, sectionTitle: folderEditLecture.section_title, downloadAllowed: folderEditLecture.download_allowed || false })} disabled={!folderEditLecture?.title} loading={updateLectureMutation.isPending} />
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
                      await createFolderMutation.mutateAsync({ name: full, type: "lecture" });
                      setOpenAdminFolder({ name: full, type: "lecture" });
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
                    setEditFolderName(folderActionSheet?.name || "");
                    setEditingFolderId(folderActionSheet?.id ?? null);
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
