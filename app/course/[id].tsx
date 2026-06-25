import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, Modal, Image, useWindowDimensions,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { repairEnrollmentAccess, isSessionPlatformMismatchError } from "@/lib/enrollment-repair";
import { invalidateAccessCaches } from "@/lib/invalidate-access-caches";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl, getBaseUrl, authFetch } from "@/lib/query-client";
import {
  liveClassQueryKey,
  liveClassesForCourseQueryKey,
  myAttemptsSummaryQueryKey,
  myDownloadsQueryKey,
  testQueryKey,
} from "@/lib/query-keys";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { fetch } from "expo/fetch";
import { useAuth } from "@/context/AuthContext";
import { WebView } from "react-native-webview";
import { DownloadButton } from "@/components/DownloadButton";
import { DEFAULT_LIVE_RECORDING_SECTION, getContentFolderRootName } from "@shared/recordingSection";
import { isMissionCompleted } from "@/lib/mission-types";
import { sortFolderNamesByOrder } from "@shared/courseFolderOrder";
import { getCourseAccentColor } from "@shared/courseTheme";
import { COURSE_BANNER_ASPECT } from "@/constants/courseBanner";
import { useDocumentVisibility } from "@/lib/useDocumentVisibility";
import { getCourseCategoryLabel } from "@/lib/course-category-label";

interface Lecture {
  id: number;
  title: string;
  description: string;
  video_url: string;
  video_type: string;
  duration_minutes: number;
  order_index: number;
  is_free_preview: boolean;
  section_title?: string;
  isCompleted?: boolean;
  pdf_url?: string;
  download_allowed?: boolean;
  /** Set when row is from DB (e.g. recording added at) */
  created_at?: number;
}

interface CourseTest {
  id: number;
  title: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  test_type: string;
  folder_name?: string;
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

interface LiveClass {
  id: number;
  title: string;
  description: string;
  youtube_url: string;
  is_live: boolean;
  is_completed: boolean;
  scheduled_at: number;
  ended_at?: number;
  duration_minutes?: number;
  section_title?: string;
  /** True when this class is a scheduled recording (not a live interactive session). */
  is_recording_mode?: boolean;
}

interface EnrolledStudent {
  id: number;
  user_id: number;
  user_name: string;
  user_phone: string;
  enrolled_at: number;
  progress_percent: number;
  status: string;
}

interface CourseDetail {
  id: number;
  title: string;
  description: string;
  teacher_name: string;
  price: string;
  original_price: string;
  category: string;
  subject?: string;
  exam?: string;
  course_language?: string;
  validity_months?: number | string | null;
  is_free: boolean;
  course_type?: string;
  start_date?: string;
  end_date?: string;
  total_lectures: number;
  total_tests: number;
  total_students: number;
  total_materials: number;
  level: string;
  duration_hours: string;
  isEnrolled: boolean;
  accessExpired?: boolean;
  progress: number;
  lectures: Lecture[];
  tests: CourseTest[];
  materials: Material[];
  pyq_count?: number;
  mock_count?: number;
  practice_count?: number;
  daily_mission_count?: number;
  thumbnail?: string;
  cover_color?: string;
}

const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", chapter: "#059669", weekly: "#7C3AED", test: "#059669", pyq: "#F59E0B",
};

function CourseQuickStat({
  icon,
  count,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  count: number | string;
  label: string;
}) {
  return (
    <View style={styles.quickStat}>
      <Ionicons name={icon} size={16} color="rgba(255,255,255,0.8)" />
      <View style={styles.quickStatTextGroup}>
        <Text style={styles.quickStatNum}>{count}</Text>
        <Text style={styles.quickStatLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function CourseDetailScreen() {
  useScreenProtection(true);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isAdmin, isLoading: authLoading } = useAuth();
  const { colors, isDarkMode } = useAppTheme();
  const tabVisible = useDocumentVisibility();
  const [activeTab, setActiveTab] = useState("Live");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedTestSection, setExpandedTestSection] = useState<string | null>(null);
  const [paymentWebViewHtml, setPaymentWebViewHtml] = useState<string | null>(null);
  const [testTypeFilter, setTestTypeFilter] = useState<string>("all");
  const [isPaymentPending, setIsPaymentPending] = useState(false);
  const [headerWidth, setHeaderWidth] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const quickStatsGap = Platform.OS === "web" && windowWidth >= 768 ? 10 : 12;

  // After Razorpay redirect (iOS / Android web), show result and clean URL
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("payment");
    if (!p) return;
    if (p === "success") {
      Alert.alert("Success!", "Payment successful! You are now enrolled.");
      invalidateAccessCaches(qc, { userId: user?.id, courseId: id });
    } else if (p === "failed") {
      Alert.alert("Payment", "We could not complete the payment. Please try again.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    const next = url.pathname + (url.search || "") + url.hash;
    window.history.replaceState({}, document.title, next);
  }, [id, qc, user?.id]);
  const [enrollError, setEnrollError] = useState("");
  const [enrollSuccess, setEnrollSuccess] = useState(false);
  const [studentActionStudent, setStudentActionStudent] = useState<any>(null);
  const courseIdNum = Number(id);
  const enrollmentSyncAttempted = useRef(false);

  useEffect(() => {
    enrollmentSyncAttempted.current = false;
  }, [id]);

  const trackDownload = async (itemType: "material" | "lecture", itemId: number) => {
    try {
      await apiRequest("POST", "/api/my-downloads", { itemType, itemId });
      if (user?.id) qc.invalidateQueries({ queryKey: myDownloadsQueryKey(user.id) });
      else qc.invalidateQueries({ queryKey: ["/api/my-downloads"] });
    } catch {}
  };

  const openDownload = (url: string, itemType: "material" | "lecture", itemId: number) => {
    if (!url) { Alert.alert("Error", "No file URL available for this item."); return; }
    trackDownload(itemType, itemId);
    Alert.alert("Saved", "Added to My Downloads in your profile.");
    if (itemType === "material") {
      router.push(`/material/${itemId}`);
    } else {
      router.push({ pathname: "/lecture/[id]", params: { id: itemId, courseId: id, videoUrl: url, title: "" } } as any);
    }
  };

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  /** Include user in the key so enrollment refetches when auth becomes available (cached guest payload is not reused). */
  const courseDetailUserSegment = String(user?.id ?? "guest");

  const {
    data: course,
    isLoading,
    error: courseQueryError,
    fetchStatus: courseFetchStatus,
    refetch: refetchCourse,
  } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", String(id), courseDetailUserSegment],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      const res = await authFetch(url.toString());
      if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        if (body?.code === "SESSION_PLATFORM_MISMATCH") {
          throw new Error("SESSION_PLATFORM_MISMATCH");
        }
      }
      if (!res.ok) throw new Error("Failed to load course");
      return res.json();
    },
    enabled: !!id && id !== "undefined" && !authLoading,
    staleTime: 20 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: tabVisible ? 60_000 : 5 * 60_000,
    refetchOnWindowFocus: Platform.OS !== "web",
    refetchOnMount: true,
  });

  // Refresh course detail immediately when returning to this screen so counts/progress stay current.
  useFocusEffect(
    React.useCallback(() => {
      void refetchCourse();
    }, [refetchCourse]),
  );

  // Repair missing/expired enrollment access (paid sync + admin-granted renew). Idempotent.
  useEffect(() => {
    if (!user || !course || course.isEnrolled || course.accessExpired || isAdmin) return;
    if (enrollmentSyncAttempted.current) return;
    enrollmentSyncAttempted.current = true;
    repairEnrollmentAccess(courseIdNum)
      .then(async ({ fixed }) => {
        if (fixed) {
          qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
          qc.invalidateQueries({ queryKey: ["/api/courses"] });
        }
      })
      .catch(() => {});
  }, [user?.id, course?.isEnrolled, course?.accessExpired, courseIdNum, isAdmin, id, qc, course]);

  const { data: liveClasses = [], isPending: liveClassesPending } = useQuery<LiveClass[]>({
    queryKey: liveClassesForCourseQueryKey(id),
    queryFn: async () => {
      const baseUrl = getApiUrl();
      // Pass admin=true so admins see ALL scheduled classes (including non-free-preview
      // and recording-mode classes). Without this, admins would only see is_free_preview=TRUE
      // classes because they are not enrolled in the course.
      const url = new URL(
        `/api/live-classes?courseId=${id}${isAdmin ? "&admin=true" : ""}`,
        baseUrl
      );
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user && !!id && id !== "undefined",
    refetchInterval:
      !tabVisible
        ? 3 * 60_000
        : activeTab === "Live"
          ? 10_000
          : 20_000,
    staleTime: 10_000,
    gcTime: 15 * 60 * 1000,
  });

  /**
   * Live tab: show upcoming + currently live sessions.
   * For admins: also show scheduled recording-mode classes (is_recording_mode=true)
   * so they can confirm their scheduled recordings appear before publishing.
   * Completed classes are hidden here — their recordings appear under Lectures → Live Class Recordings.
   */
  const liveClassesForTab = useMemo(() => {
    return (liveClasses || []).filter((lc) => {
      if (lc.is_live) return true;
      if (lc.is_completed) return false;
      return true;
    });
  }, [liveClasses]);

  const { data: attemptSummary = {} } = useQuery<Record<number, any>>({
    queryKey: user?.id ? myAttemptsSummaryQueryKey(user.id) : ["/api/my-attempts/summary", "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-attempts/summary", baseUrl).toString());
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  const { data: courseFolders = [] } = useQuery<any[]>({
    queryKey: ["/api/courses", String(id), "folders"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/courses/${id}/folders`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && id !== "undefined",
  });

  const { data: courseMissions = [] } = useQuery<any[]>({
    queryKey: ["/api/daily-missions", "course", String(id)],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/daily-missions?type=all", getApiUrl()).toString());
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      return rows.filter((m: any) => Number(m.course_id) === courseIdNum);
    },
    enabled: !!id && id !== "undefined" && !!user?.id && course?.course_type !== "test_series",
    staleTime: 0,
  });

  const realCourseMissions = useMemo(
    () =>
      (courseMissions || []).filter((m: any) => {
        const qs = Array.isArray(m.questions) ? m.questions : [];
        return qs.some((q: any) => String(q?.question || "").trim().length > 0);
      }),
    [courseMissions],
  );

  const missionFolderNames = useMemo(() => {
    const names = new Set<string>();
    realCourseMissions.forEach((m: any) => {
      const root = getContentFolderRootName(m.folder_name);
      if (root) names.add(root);
    });
    return Array.from(names);
  }, [realCourseMissions]);

  const ungroupedCourseMissions = useMemo(
    () => realCourseMissions.filter((m: any) => !getContentFolderRootName(m.folder_name)),
    [realCourseMissions],
  );

  const folderFullName = (folder: any): string => String(folder?.full_name || folder?.name || "").trim();
  const folderLocalName = (folder: any): string => String(folder?.name || folder?.full_name || "").trim();

  // Warm likely next screens so tab/screen transitions feel instant for students.
  useEffect(() => {
    if (!user || !course || !id || id === "undefined") return;
    const baseUrl = getApiUrl();
    const primeLectures = (course.lectures || []).slice(0, 3);
    const primeMaterials = (course.materials || []).slice(0, 3);
    const primeTests = (course.tests || []).slice(0, 3);
    const primeLives = (liveClasses || []).slice(0, 2);

    primeLectures.forEach((lecture) => {
      qc.prefetchQuery({
        queryKey: ["/api/lectures", lecture.id],
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/lectures/${lecture.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch lecture failed");
          return res.json();
        },
        staleTime: 60000,
      });
    });

    primeMaterials.forEach((material) => {
      qc.prefetchQuery({
        queryKey: ["/api/study-materials", material.id],
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/study-materials/${material.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch material failed");
          return res.json();
        },
        staleTime: 60000,
      });
    });

    primeTests.forEach((test) => {
      qc.prefetchQuery({
        queryKey: testQueryKey(test.id),
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/tests/${test.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch test failed");
          return res.json();
        },
        staleTime: 30000,
      });
    });

    primeLives.forEach((lc) => {
      qc.prefetchQuery({
        queryKey: liveClassQueryKey(lc.id),
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/live-classes/${lc.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch live class failed");
          return res.json();
        },
        staleTime: 30_000,
      });
    });
  }, [user?.id, course, id, liveClasses, qc]);

  /** Push to the dedicated folder route so back navigation through nested content works correctly on Android. */
  const openFolderView = (next: { name: string; type: "lectures" | "materials" | "live" | "tests"; color: string; testType?: string }) => {
    router.push({
      pathname: "/course-folder/[id]/[type]/[name]",
      params: {
        id: String(id),
        type: next.type,
        name: encodeURIComponent(next.name),
        color: next.color,
        ...(next.testType ? { testType: next.testType } : {}),
      },
    } as any);
  };

  const openCourseMission = (missionId: number) => {
    router.push({
      pathname: "/course-mission/[id]",
      params: { id: String(missionId), courseId: String(id) },
    } as any);
  };

  const openCourseMissionFolder = (folderName: string) => {
    router.push({
      pathname: "/course-mission-folder/[courseId]/[name]",
      params: { courseId: String(id), name: encodeURIComponent(folderName) },
    } as any);
  };

  const { data: enrolledStudents = [], isPending: enrolledStudentsPending } = useQuery<EnrolledStudent[]>({
    queryKey: ["/api/admin/courses", id, "enrollments"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/admin/courses/${id}/enrollments`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin && !!id && id !== "undefined",
    staleTime: 60_000,
    gcTime: 15 * 60 * 1000,
  });

  const updateEnrollmentMutation = useMutation({
    mutationFn: async ({ enrollmentId, status }: { enrollmentId: number; status: string }) => {
      await apiRequest("PUT", `/api/admin/enrollments/${enrollmentId}`, { status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/courses", id, "enrollments"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Student status updated!");
    },
    onError: () => Alert.alert("Error", "Failed to update student status"),
  });

  const removeEnrollmentMutation = useMutation({
    mutationFn: async (enrollmentId: number) => {
      await apiRequest("DELETE", `/api/admin/enrollments/${enrollmentId}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/courses", id, "enrollments"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Success", "Student removed from course!");
    },
    onError: () => Alert.alert("Error", "Failed to remove student"),
  });

  const enrollMutation = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(courseIdNum)) throw new Error("Invalid course id");
      const res = await apiRequest("POST", `/api/courses/${id}/enroll`, { userId: user?.id });
      return res.json();
    },
    onSuccess: () => {
      setEnrollError("");
      setEnrollSuccess(true);
      // Optimistically update the course detail cache — don't wait for refetch
      qc.setQueryData(["/api/courses", String(id), courseDetailUserSegment], (old: any) => {
        if (!old) return old;
        return { ...old, isEnrolled: true, progress: 0 };
      });
      // Also update the courses list cache optimistically
      qc.setQueriesData({ queryKey: ["/api/courses"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((c: any) => c.id === courseIdNum ? { ...c, isEnrolled: true } : c);
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Show non-blocking success message
      if (Platform.OS === "web") {
        // Don't use window.alert — it blocks. Use the error state for success too
        setEnrollError(""); // clear any error
      } else {
        Alert.alert("Enrolled!", "You have successfully enrolled in this course.");
      }
      // Background refetch to sync with server — wait longer to ensure DB commit
      setTimeout(() => {
        invalidateAccessCaches(qc, { userId: user?.id, courseId: id });
        qc.invalidateQueries({ queryKey: ["/api/admin/courses", id] });
      }, 2000);
    },
    onError: (err: any) => {
      const raw = err?.message || "";
      const msg = raw.replace(/^\d+: /, "");
      console.error("Enroll error:", raw);
      setEnrollError(msg || "Failed to enroll. Please try again.");
    },
  });

  const handleRazorpayPayment = async () => {
    if (isPaymentPending) return;
    if (!Number.isFinite(courseIdNum)) {
      Alert.alert("Error", "Invalid course. Please reopen this page.");
      return;
    }
    setIsPaymentPending(true);
    try {
      const orderRes = await apiRequest("POST", "/api/payments/create-order", { courseId: courseIdNum });
      const orderData = await orderRes.json();

      if (Platform.OS === "web") {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
        // iOS + Android phone/tablet web: use hosted redirect (Safari/Chrome in-app are flaky with inline handler)
        const useRedirectCheckout = /iPhone|iPad|iPod|Android/i.test(ua);
        const script = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (!script) {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          document.head.appendChild(s);
          await new Promise((resolve) => { s.onload = resolve; });
        }

        const options = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: "3i Learning",
          description: `Purchase: ${orderData.courseName}`,
          order_id: orderData.orderId,
          handler: async (response: any) => {
            try {
              await apiRequest("POST", "/api/payments/verify", {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                courseId: courseIdNum,
              });
              invalidateAccessCaches(qc, { userId: user?.id, courseId: id });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Success!", "Payment successful! You are now enrolled.");
            } catch {
              Alert.alert("Error", "Payment was received but enrollment failed. Please contact support.");
            } finally {
              setIsPaymentPending(false);
            }
          },
          prefill: {
            contact: user?.phone ? `+91${user.phone}` : "",
          },
          theme: { color: "#1A56DB" },
          ...(useRedirectCheckout
            ? {
                redirect: true,
                callback_url: `${getBaseUrl()}/api/payments/verify-redirect`,
              }
            : {}),
          modal: {
            ondismiss: () => {
              setIsPaymentPending(false);
            },
          },
        };

        const rzp = new (window as any).Razorpay(options);
        if (!useRedirectCheckout) {
          rzp.on("payment.failed", (response: { error?: { description?: string; code?: string } }) => {
            apiRequest("POST", "/api/payments/track-failure", {
              courseId: courseIdNum,
              razorpay_order_id: orderData.orderId,
              reason: response?.error?.description || response?.error?.code || "Payment failed",
              error: response?.error || null,
            }).catch(() => {});
            setIsPaymentPending(false);
            const err =
              response?.error?.description ||
              response?.error?.code ||
              "Payment could not be completed.";
            Alert.alert("Payment failed", String(err));
          });
        }
        rzp.open();
        return;
      } else {
        const baseUrl = getApiUrl();
        const checkoutHtml = `
<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0A1628;font-family:sans-serif;color:#fff;}
.loading{text-align:center}.spinner{border:3px solid rgba(255,255,255,0.2);border-top:3px solid #1A56DB;border-radius:50%;width:40px;height:40px;animation:spin 0.8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body>
<div class="loading"><div class="spinner"></div><p>Opening payment...</p></div>
<script>
var options = {
  key: "${orderData.keyId}",
  amount: ${orderData.amount},
  currency: "${orderData.currency}",
  name: "3i Learning",
  description: "Purchase: ${orderData.courseName?.replace(/"/g, '\\"') || 'Course'}",
  order_id: "${orderData.orderId}",
  handler: function(response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: "payment_success",
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature
    }));
  },
  prefill: { contact: "${user?.phone ? `+91${user.phone}` : ''}" },
  theme: { color: "#1A56DB" },
  modal: {
    ondismiss: function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "payment_dismissed" }));
    }
  }
};
setTimeout(function() {
  var rzp = new Razorpay(options);
  rzp.on("payment.failed", function(resp) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "payment_failed", error: resp.error.description }));
  });
  rzp.open();
}, 0);
</script></body></html>`;
        setPaymentWebViewHtml(checkoutHtml);
        return;
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("Already enrolled")) {
        Alert.alert("Already Enrolled", "You are already enrolled in this course.");
        qc.invalidateQueries({ queryKey: ["/api/courses", String(id)] });
      } else {
        Alert.alert("Error", "Failed to initiate payment. Please try again.");
      }
      setIsPaymentPending(false);
    }
  };

  const handleEnroll = () => {
    if (!user) { router.push("/(auth)/login"); return; }
    if (course?.is_free) {
      enrollMutation.mutate();
    } else {
      // Track Buy Now click for analytics (fire-and-forget)
      apiRequest("POST", "/api/payments/track-click", { courseId: parseInt(id as string) }).catch(() => {});
      if (Platform.OS === "web") {
        handleRazorpayPayment();
      } else {
        Alert.alert(
          "Purchase Course",
          `Buy "${course?.title}" for ₹${parseFloat(course?.price || "0").toFixed(0)}?\n\nYou will be redirected to secure payment.`,
          [
            { text: "Cancel", style: "cancel" },
            { text: "Pay Now", onPress: handleRazorpayPayment },
          ]
        );
      }
    }
  };

  /** When course detail refetch failed, don't treat unknown enrollment as "must purchase". */
  const showEnrollmentOrPurchaseAlert = (showPurchase: () => void) => {
    if (user && !isAdmin && courseQueryError != null && courseFetchStatus !== "fetching") {
      Alert.alert(
        "Couldn't verify access",
        "We couldn't confirm your enrollment. Check your connection and tap Retry.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Retry", onPress: () => { void refetchCourse(); } },
        ]
      );
      return;
    }
    showPurchase();
  };

  const promptLockedCourseContent = () => {
    showEnrollmentOrPurchaseAlert(() => {
      Alert.alert(
        course?.is_free ? "Enroll Required" : "Purchase Required",
        course?.is_free
          ? "Please enroll in this course to access this content."
          : "Please purchase this course to access this content.",
        [
          { text: "Cancel", style: "cancel" },
          { text: course?.is_free ? "Enroll Free" : "Buy Now", onPress: handleEnroll },
        ],
      );
    });
  };

  const handleLecture = (lecture: Lecture) => {
    const st = lecture.section_title || "";
    const isLiveRecording =
      st === DEFAULT_LIVE_RECORDING_SECTION ||
      st.startsWith(`${DEFAULT_LIVE_RECORDING_SECTION} /`);
    const canAccess = isAdmin || course?.isEnrolled;
    if (!canAccess) {
      promptLockedCourseContent();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/lecture/[id]",
      params: { id: lecture.id, courseId: id, videoUrl: lecture.video_url || "", title: lecture.title },
    });
  };

  if (isLoading || authLoading) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding, backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!course) {
    const platformMismatch = isSessionPlatformMismatchError(courseQueryError);
    return (
      <View style={[styles.centered, { paddingTop: topPadding, backgroundColor: colors.background, paddingHorizontal: 24, gap: 12 }]}>
        <Text style={[styles.errorText, { color: colors.textMuted, textAlign: "center" }]}>
          {platformMismatch
            ? "Please log in again on this browser or app to access your courses."
            : "Course not found"}
        </Text>
        {platformMismatch ? (
          <Pressable onPress={() => router.push("/(auth)/login")} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: Colors.light.primary }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>Go to Login</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const renderTestItem = (test: CourseTest, courseData: CourseDetail) => {
    const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
    const attempt = attemptSummary[test.id];
    const isLocked = !isAdmin && !courseData.isEnrolled;
    const handlePress = () => {
      if (isLocked) {
        promptLockedCourseContent();
        return;
      }
      if (attempt) {
        router.push({
          pathname: "/test-result/[id]",
          params: {
            id: String(test.id),
            score: String(attempt.score ?? 0),
            totalMarks: String(attempt.total_marks ?? 0),
            correct: String(attempt.correct ?? 0),
            incorrect: String(attempt.incorrect ?? 0),
            totalAttempts: String(attempt.attempted ?? 0),
            totalQuestions: String(test.total_questions),
            percentage: String(attempt.percentage ?? "0"),
            weakTopics: "",
            attemptId: String(attempt.attempt_id ?? ""),
            testType: test.test_type ?? "",
            timeTakenSeconds: String(attempt.time_taken_seconds ?? 0),
          },
        });
      } else {
        router.push(`/test/${test.id}`);
      }
    };
    return (
      <Pressable
        key={test.id}
        style={({ pressed }) => [
          styles.testCard,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
          isLocked && { opacity: 0.6 },
          pressed && !isLocked && { opacity: 0.85 },
        ]}
        onPress={handlePress}
      >
        <View style={[styles.testColorBar, { backgroundColor: color }]} />
        <View style={styles.testItemIcon}>
          <Ionicons name="document-text" size={22} color={color} />
        </View>
        <View style={styles.testItemInfo}>
          <Text style={styles.testItemTitle}>{test.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={styles.testItemMeta}>
              {test.total_questions} questions · {test.duration_minutes}min · {test.total_marks} marks
            </Text>
            {attempt && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>
                  {attempt.score}/{attempt.total_marks}
                </Text>
              </View>
            )}
          </View>
        </View>
        {!isAdmin && !courseData.isEnrolled ? (
          <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />
        ) : attempt ? (
          <Ionicons name="bar-chart" size={18} color={Colors.light.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        )}
      </Pressable>
    );
  };

  const isTestSeriesCourse = course.course_type === "test_series";
  const isMockTestType = (test: { test_type?: string }) => String(test.test_type || "").toLowerCase() === "mock";
  const testsForTestsTab = isTestSeriesCourse
    ? course.tests.filter((t) => String(t.test_type || "").toLowerCase() === "test")
    : course.tests.filter((t) => !isMockTestType(t));
  const testsForPracticeTab = isTestSeriesCourse
    ? course.tests.filter((t) => String(t.test_type || "").toLowerCase() === "practice")
    : [];
  const testsForPyqTab = isTestSeriesCourse
    ? course.tests.filter((t) => String(t.test_type || "").toLowerCase() === "pyq")
    : [];
  const testsForMockTab = course.tests.filter((t) => isMockTestType(t));
  const missionTab = realCourseMissions.length > 0 ? ["Missions"] as const : [];
  const TABS = isTestSeriesCourse
    ? (isAdmin ? ["About", "Practice", "Tests", "PYQs", "Mock Tests", "Enrolled"] : ["About", "Practice", "Tests", "PYQs", "Mock Tests"])
    : isAdmin
    ? ["Live", "Lectures", ...missionTab, "Tests", "Mock Tests", "Materials", "Enrolled"]
    : ["Live", "Lectures", ...missionTab, "Tests", "Mock Tests", "Materials"];

  const renderTestSeriesTabList = (
    tabTests: CourseTest[],
    opts: { emptyIcon: keyof typeof Ionicons.glyphMap; emptyText: string; folderColor: string; testType: string },
  ) => {
    if (tabTests.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name={opts.emptyIcon} size={40} color={Colors.light.textMuted} />
          <Text style={styles.emptyText}>{opts.emptyText}</Text>
        </View>
      );
    }
    const testFolderNames = new Set(
      tabTests.map((t) => getContentFolderRootName(t.folder_name)).filter(Boolean),
    );
    return (
      <View style={{ gap: 12, padding: 16 }}>
        {Array.from(testFolderNames).map((folderName) => {
          const folderTests = tabTests.filter(
            (t) => t.folder_name === folderName || String(t.folder_name || "").startsWith(`${folderName} /`),
          );
          if (folderTests.length === 0) return null;
          const isLocked = !isAdmin && !course.isEnrolled;
          return (
            <Pressable
              key={`${opts.testType}_folder_${folderName}`}
              style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: opts.folderColor }]}
              onPress={() => {
                openFolderView({ name: folderName, type: "tests", color: opts.folderColor, testType: opts.testType });
              }}
            >
              <View style={[styles.testSectionIconWrap, { backgroundColor: opts.folderColor + "18" }]}>
                <Ionicons name="folder" size={22} color={opts.folderColor} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.testSectionTitle}>{folderName}</Text>
                <Text style={styles.testSectionCount}>{folderTests.length} {folderTests.length === 1 ? "test" : "tests"}</Text>
              </View>
              {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
            </Pressable>
          );
        })}
        {tabTests.filter((t) => !t.folder_name).map((test) => renderTestItem(test, course))}
      </View>
    );
  };

  const discount = course.original_price && parseFloat(course.original_price) > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;

  const firstTab = TABS[0];
  const currentActiveTab = TABS.includes(activeTab) ? activeTab : firstTab;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {(() => {
        const c1 = getCourseAccentColor(course.id);
        const c2 = c1 + "CC";
        const headerMinHeight = isTestSeriesCourse && course.thumbnail && headerWidth > 0
          ? Math.min(220, headerWidth / COURSE_BANNER_ASPECT)
          : undefined;
        return (
          <LinearGradient
            colors={isDarkMode ? ["#020617", c1, "#0F172A"] : ["#0A1628", c1, c2]}
            style={[
              styles.header,
              isTestSeriesCourse ? null : styles.headerCompact,
              { paddingTop: topPadding + 4 },
              headerMinHeight != null ? { minHeight: headerMinHeight } : null,
            ]}
            onLayout={(e) => setHeaderWidth(e.nativeEvent.layout.width)}
          >
            {course.thumbnail ? (
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Image
                  source={{ uri: course.thumbnail }}
                  style={[
                    styles.headerThumbnail,
                    Platform.OS === "web"
                      ? ({ objectFit: "cover", objectPosition: "center center", width: "100%", height: "100%" } as any)
                      : null,
                  ]}
                  resizeMode="cover"
                />
                <LinearGradient
                  colors={["rgba(10,22,40,0.55)", "rgba(10,22,40,0.75)"]}
                  style={StyleSheet.absoluteFillObject}
                />
              </View>
            ) : null}
            <View style={styles.headerTop}>
              <Pressable style={styles.backBtn} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)"); }}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </Pressable>
              {isTestSeriesCourse ? (
                <View style={styles.headerBadges}>
                  {course.is_free && <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>}
                  <View style={styles.testSeriesBadge}><Text style={styles.testSeriesBadgeText}>TEST SERIES</Text></View>
                  {!course.is_free && discount > 0 && <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>}
                </View>
              ) : null}
            </View>

            {isTestSeriesCourse ? (
              <>
                {!course.thumbnail && (
                  <View style={styles.courseIconArea}>
                    <MaterialCommunityIcons name="clipboard-check" size={48} color="rgba(255,255,255,0.25)" />
                  </View>
                )}
                <Text style={styles.courseTitle}>{course.title}</Text>
                <View style={styles.instructorRow}>
                  <View style={styles.instructorAvatar}>
                    <Ionicons name="person" size={14} color="#fff" />
                  </View>
                  <Text style={styles.instructorName}>{course.teacher_name}</Text>
                  <View style={styles.levelChip}><Text style={styles.levelChipText}>{course.level}</Text></View>
                </View>
                {(course.course_type || "live") === "live" && (course.start_date || course.end_date) && (
                  <View style={styles.courseDateRow}>
                    <Ionicons name="calendar" size={14} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.courseDateText}>
                      {course.start_date || "TBD"} → {course.end_date || "TBD"}
                    </Text>
                  </View>
                )}
                {isTestSeriesCourse && course.end_date && (
                  <View style={styles.courseDateRow}>
                    <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.9)" />
                    <Text style={styles.courseDateText}>Ends {course.end_date}</Text>
                  </View>
                )}
              </>
            ) : (
              <Text style={[styles.courseTitle, styles.courseTitleCompact]}>{course.title}</Text>
            )}

            <View style={[styles.courseQuickStats, { gap: quickStatsGap }]}>
          {!isTestSeriesCourse && (
            <CourseQuickStat icon="videocam" count={course.total_lectures} label="Lectures" />
          )}
          {isTestSeriesCourse ? (
            <>
              <CourseQuickStat icon="layers" count={course.total_tests || 0} label="Tests" />
              <CourseQuickStat icon="document-text" count={course.pyq_count || 0} label="PYQ" />
              <CourseQuickStat icon="clipboard" count={course.mock_count || 0} label="Mock" />
              <CourseQuickStat icon="create" count={course.practice_count || 0} label="Practice" />
            </>
          ) : (
            <>
              <CourseQuickStat icon="document-text" count={testsForTestsTab.length} label="Tests" />
              <CourseQuickStat icon="clipboard" count={course.mock_count ?? testsForMockTab.length} label="Mock" />
              <CourseQuickStat icon="flag" count={course.daily_mission_count || 0} label="Missions" />
              <CourseQuickStat icon="folder" count={course.total_materials || 0} label="Materials" />
            </>
          )}
        </View>

        {isTestSeriesCourse && course.isEnrolled && (
          <View style={styles.progressSection}>
            <View style={styles.progressRow}>
              <Text style={styles.progressLabel}>Your Progress</Text>
              <Text style={styles.progressPct}>{course.progress}%</Text>
            </View>
            <View style={[styles.progressBar, { flexDirection: "row" }]}>
              <View style={[styles.progressFill, { width: `${course.progress || 0}%` as any }]} />
            </View>
          </View>
        )}
          </LinearGradient>
        );
      })()}

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false}
        style={[styles.tabBarScroll, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tabItem, currentActiveTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, { color: colors.textSecondary }, currentActiveTab === tab && styles.tabTextActive]}>{tab}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Test type filter chips moved inside folder modal */}

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 100 }]}
      >
        {currentActiveTab === "About" && (
          <View style={{ padding: 20, gap: 20 }}>
            {/* Description — icon list style */}
            {course.description ? (
              <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
                <View style={styles.aboutSectionHeader}>
                  <Ionicons name="information-circle" size={20} color={Colors.light.primary} />
                  <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>
                    {isTestSeriesCourse ? "Description" : "About this Course"}
                  </Text>
                </View>
                <View style={{ gap: 10 }}>
                  {course.description.split("\n").filter((l) => l.trim()).map((line, i) => (
                    <View key={i} style={styles.aboutIncludeItem}>
                      <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />
                      <Text style={[styles.aboutIncludeText, { color: colors.text }]}>{line.trim()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Key Details */}
            <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
              <View style={styles.aboutSectionHeader}>
                <Ionicons name="list" size={20} color={Colors.light.primary} />
                <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>Course Details</Text>
              </View>
              <View style={styles.aboutDetailGrid}>
                {isTestSeriesCourse ? (
                  <>
                    {course.category || isTestSeriesCourse ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="bookmark" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Category</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{getCourseCategoryLabel(course)}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.exam ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="school" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Exam</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.exam}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.subject ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="book" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Subject</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.subject}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.level ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="bar-chart" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Level</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.level}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.course_language ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="language" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Language</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.course_language}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.teacher_name ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="person" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Instructor</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.teacher_name}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.end_date ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="calendar-outline" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>End Date</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.end_date}</Text>
                        </View>
                      </View>
                    ) : null}
                    {course.validity_months != null && String(course.validity_months).trim() !== "" ? (
                      <View style={styles.aboutDetailItem}>
                        <Ionicons name="time" size={16} color={Colors.light.textMuted} />
                        <View>
                          <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Validity</Text>
                          <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.validity_months} months</Text>
                        </View>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <>
                    <View style={styles.aboutDetailItem}>
                      <Ionicons name="person" size={16} color={Colors.light.textMuted} />
                      <View>
                        <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Instructor</Text>
                        <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.teacher_name}</Text>
                      </View>
                    </View>
                    <View style={styles.aboutDetailItem}>
                      <Ionicons name="bar-chart" size={16} color={Colors.light.textMuted} />
                      <View>
                        <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Level</Text>
                        <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.level}</Text>
                      </View>
                    </View>
                    <View style={styles.aboutDetailItem}>
                      <Ionicons name="time" size={16} color={Colors.light.textMuted} />
                      <View>
                        <Text style={[styles.aboutDetailLabel, { color: colors.textMuted }]}>Duration</Text>
                        <Text style={[styles.aboutDetailValue, { color: colors.text }]}>{course.duration_hours}h total</Text>
                      </View>
                    </View>
                    {(course.course_type || "live") === "live" && (course.start_date || course.end_date) && (
                      <>
                        {course.start_date && (
                          <View style={styles.aboutDetailItem}>
                            <Ionicons name="calendar" size={16} color={Colors.light.textMuted} />
                            <View>
                              <Text style={styles.aboutDetailLabel}>Start Date</Text>
                              <Text style={styles.aboutDetailValue}>{course.start_date}</Text>
                            </View>
                          </View>
                        )}
                        {course.end_date && (
                          <View style={styles.aboutDetailItem}>
                            <Ionicons name="calendar-outline" size={16} color={Colors.light.textMuted} />
                            <View>
                              <Text style={styles.aboutDetailLabel}>End Date</Text>
                              <Text style={styles.aboutDetailValue}>{course.end_date}</Text>
                            </View>
                          </View>
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
            </View>

            {/* What's Included */}
            <View style={[styles.aboutSection, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
              <View style={styles.aboutSectionHeader}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                <Text style={[styles.aboutSectionTitle, { color: colors.text }]}>What's Included</Text>
              </View>
              <View style={{ gap: 10 }}>
                {!isTestSeriesCourse && course.total_lectures > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="videocam" size={18} color={Colors.light.primary} />
                    <Text style={styles.aboutIncludeText}>{course.total_lectures} Video Lectures</Text>
                  </View>
                )}
                {course.total_tests > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="document-text" size={18} color="#F59E0B" />
                    <Text style={styles.aboutIncludeText}>{course.total_tests} Tests</Text>
                  </View>
                )}
                {isTestSeriesCourse && (course.pyq_count || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="time" size={18} color="#F59E0B" />
                    <Text style={styles.aboutIncludeText}>{course.pyq_count} Previous Year Questions</Text>
                  </View>
                )}
                {!isTestSeriesCourse && (course.mock_count || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="trophy" size={18} color="#DC2626" />
                    <Text style={styles.aboutIncludeText}>{course.mock_count} Mock Tests</Text>
                  </View>
                )}
                {isTestSeriesCourse && (course.mock_count || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="trophy" size={18} color="#DC2626" />
                    <Text style={styles.aboutIncludeText}>{course.mock_count} Mock Tests</Text>
                  </View>
                )}
                {isTestSeriesCourse && (course.practice_count || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="fitness" size={18} color="#1A56DB" />
                    <Text style={styles.aboutIncludeText}>{course.practice_count} Practice Sets</Text>
                  </View>
                )}
                {!isTestSeriesCourse && (course.total_materials || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="folder" size={18} color="#DC2626" />
                    <Text style={styles.aboutIncludeText}>{course.total_materials} Study Materials</Text>
                  </View>
                )}
                {(course.daily_mission_count || 0) > 0 && (
                  <View style={styles.aboutIncludeItem}>
                    <Ionicons name="flag" size={18} color="#7C3AED" />
                    <Text style={styles.aboutIncludeText}>{course.daily_mission_count} Daily Missions</Text>
                  </View>
                )}
                <View style={styles.aboutIncludeItem}>
                  <Ionicons name="phone-portrait" size={18} color="#7C3AED" />
                  <Text style={styles.aboutIncludeText}>Access on mobile & web</Text>
                </View>
              </View>
            </View>

            {/* Price */}
            {!isAdmin && !course.isEnrolled && (
              <View style={[styles.aboutSection, { backgroundColor: Colors.light.secondary }]}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View>
                    <Text style={styles.aboutDetailLabel}>Price</Text>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                      {course.is_free ? (
                        <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: "#22C55E" }}>Free</Text>
                      ) : (
                        <>
                          <Text style={{ fontSize: 24, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>
                            ₹{parseFloat(course.price).toFixed(0)}
                          </Text>
                          {parseFloat(course.original_price) > 0 && (
                            <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textDecorationLine: "line-through" }}>
                              ₹{parseFloat(course.original_price).toFixed(0)}
                            </Text>
                          )}
                        </>
                      )}
                    </View>
                  </View>
                  {discount > 0 && (
                    <View style={{ backgroundColor: Colors.light.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
                      <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" }}>{discount}% OFF</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* Terms & Conditions */}
            <View style={styles.aboutTncBlock}>
              <View style={styles.aboutSectionHeader}>
                <Ionicons name="shield-checkmark" size={18} color="#92400E" />
                <Text style={[styles.aboutSectionTitle, { color: "#92400E", fontSize: 14 }]}>Terms & Conditions</Text>
              </View>
              {[
                "Fee is non-refundable and non-transferable under any circumstances.",
                "If you are blocked or removed from the course, you will lose all further access. To regain access, you will need to purchase the course again.",
                "The validity of this course is fixed and cannot be extended under any circumstances.",
              ].map((point, i) => (
                <View key={i} style={styles.aboutTncItem}>
                  <Text style={styles.aboutTncBullet}>•</Text>
                  <Text style={styles.aboutTncText}>{point}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {currentActiveTab === "Lectures" && (
          <View style={styles.list}>
            {course.lectures.length === 0 && courseFolders.filter((f: any) => f.type === "lecture").length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No lectures added yet</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {(() => {
                  const sorted = [...course.lectures].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
                  // Group by section_title — only items WITH a section_title go into folders
                  const folderMap = new Map<string, Lecture[]>();
                  const unfolderedLectures: Lecture[] = [];
                  for (const lec of sorted) {
                    if (lec.section_title) {
                      const rootName = getContentFolderRootName(lec.section_title);
                      if (!folderMap.has(rootName)) folderMap.set(rootName, []);
                      folderMap.get(rootName)!.push(lec);
                    } else {
                      unfolderedLectures.push(lec);
                    }
                  }
                  // Also include empty DB folders
                  for (const f of courseFolders.filter((f: any) => f.type === "lecture" && !f.parent_id)) {
                    const rootName = getContentFolderRootName(folderFullName(f));
                    if (!folderMap.has(rootName)) folderMap.set(rootName, []);
                  }
                  const folderNames = sortFolderNamesByOrder(Array.from(folderMap.keys()), "lecture", courseFolders);
                  const folders = folderNames.map((name) => [name, folderMap.get(name)!] as const);
                  return (
                    <>
                      {folders.map(([folderKey, lectures]) => {
                        const folderName = folderKey;
                        const isLiveFolder = folderKey === "Live Class Recordings";
                        const folderColor = isLiveFolder ? "#DC2626" : "#1A56DB";
                        const folderBg = isLiveFolder ? "#FEE2E2" : "#EEF2FF";
                        const isLocked = !isAdmin && !course.isEnrolled;
                        return (
                          <Pressable key={folderKey}
                            style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: folderColor }]}
                            onPress={() => {
                              openFolderView({ name: folderName, type: "lectures", color: folderColor });
                            }}
                          >
                            <View style={[styles.testSectionIconWrap, { backgroundColor: folderBg }]}>
                              <Ionicons name={isLiveFolder ? "videocam" : "folder"} size={22} color={folderColor} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.testSectionTitle}>{folderName}</Text>
                              <Text style={styles.testSectionCount}>{lectures.length} {lectures.length === 1 ? "video" : "videos"}</Text>
                            </View>
                            {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
                          </Pressable>
                        );
                      })}
                      {/* Lectures without a folder — show directly */}
                      {unfolderedLectures.map((lec) => {
                        const canAccess = isAdmin || course.isEnrolled;
                        return (
                          <View key={lec.id} style={[styles.testCard, { backgroundColor: colors.card, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center" }]}>
                            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => {
                                if (!canAccess) {
                                  promptLockedCourseContent();
                                  return;
                                }
                                router.push({ pathname: "/lecture/[id]", params: { id: lec.id, courseId: id, videoUrl: lec.video_url || "", title: lec.title } });
                              }}>
                              <View style={[styles.testColorBar, { backgroundColor: "#1A56DB" }]} />
                              <View style={styles.testItemIcon}><Ionicons name="videocam" size={22} color="#1A56DB" /></View>
                              <View style={styles.testItemInfo}>
                                <Text style={styles.testItemTitle}>{lec.title}</Text>
                                <Text style={styles.testItemMeta}>
                                  {lec.section_title === "Live Class Recordings" && lec.created_at
                                    ? `${new Date(Number(lec.created_at)).toLocaleDateString(undefined, {
                                        year: "numeric",
                                        month: "short",
                                        day: "numeric",
                                      })} · ${lec.duration_minutes || 0} min`
                                    : `${lec.duration_minutes || 0} min`}
                                  {lec.is_free_preview ? " · Free Preview" : ""}
                                  {lec.download_allowed ? " · Download" : ""}
                                </Text>
                              </View>
                              {!canAccess ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : null}
                            </Pressable>
                          </View>
                        );
                      })}
                    </>
                  );
                })()}
              </View>
            )}
          </View>
        )}

        {currentActiveTab === "Missions" && (
          <View style={styles.list}>
            {realCourseMissions.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="flag-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No daily missions for this course yet</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {missionFolderNames.map((folderName) => {
                  const folderMissions = realCourseMissions.filter((m: any) => {
                    const root = getContentFolderRootName(m.folder_name);
                    return root === folderName && (m.folder_name === folderName || String(m.folder_name || "").startsWith(`${folderName} /`));
                  });
                  if (folderMissions.length === 0) return null;
                  const isLocked = !isAdmin && !course.isEnrolled;
                  const missionColor = "#0F766E";
                  const completedInFolder = folderMissions.filter((m: any) => isMissionCompleted(m)).length;
                  return (
                    <Pressable
                      key={`mission_folder_${folderName}`}
                      style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: missionColor }]}
                      onPress={() => {
                        if (isLocked) {
                          promptLockedCourseContent();
                          return;
                        }
                        openCourseMissionFolder(folderName);
                      }}
                    >
                      <View style={[styles.testSectionIconWrap, { backgroundColor: missionColor + "18" }]}>
                        <Ionicons name="folder" size={22} color={missionColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.testSectionTitle}>{folderName}</Text>
                        <Text style={styles.testSectionCount}>
                          {folderMissions.length} {folderMissions.length === 1 ? "mission" : "missions"}
                          {completedInFolder > 0 ? ` · ${completedInFolder} done` : ""}
                        </Text>
                      </View>
                      {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
                    </Pressable>
                  );
                })}
                {ungroupedCourseMissions.map((mission: any) => {
                  const qCount = Array.isArray(mission.questions)
                    ? mission.questions.filter((q: any) => String(q?.question || "").trim()).length
                    : 0;
                  const isLocked = !isAdmin && !course.isEnrolled;
                  const missionColor = "#0F766E";
                  const done = isMissionCompleted(mission);
                  return (
                    <View key={`mission-${mission.id}`} style={[styles.testCard, { backgroundColor: colors.card, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center" }, isLocked && { opacity: 0.6 }]}>
                      <Pressable
                        style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                        onPress={() => {
                          if (isLocked) {
                            promptLockedCourseContent();
                            return;
                          }
                          openCourseMission(mission.id);
                        }}
                      >
                        <View style={[styles.testColorBar, { backgroundColor: missionColor }]} />
                        <View style={styles.testItemIcon}><Ionicons name="flag" size={22} color={missionColor} /></View>
                        <View style={styles.testItemInfo}>
                          <Text style={styles.testItemTitle}>{mission.title}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <Text style={styles.testItemMeta}>{qCount} {qCount === 1 ? "question" : "questions"} · {mission.xp_reward || 50} XP</Text>
                            {done ? (
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                                <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>
                                  {mission.userScore ?? 0}/{qCount}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                        </View>
                        {isLocked ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : done ? <Ionicons name="bar-chart" size={18} color={Colors.light.primary} /> : <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {currentActiveTab === "Practice" && isTestSeriesCourse && (
          <View style={styles.list}>
            {renderTestSeriesTabList(testsForPracticeTab, {
              emptyIcon: "fitness-outline",
              emptyText: "No practice tests available",
              folderColor: "#1A56DB",
              testType: "practice",
            })}
          </View>
        )}

        {currentActiveTab === "Tests" && (
          <View style={styles.list}>
            {isTestSeriesCourse ? (
              renderTestSeriesTabList(testsForTestsTab, {
                emptyIcon: "document-text-outline",
                emptyText: "No tests available",
                folderColor: "#059669",
                testType: "test",
              })
            ) : testsForTestsTab.length === 0 && courseFolders.filter((f: any) => f.type === "test").length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No tests available</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {/* Test folders from DB (including empty ones) */}
                {(() => {
                  const testFolderNames = new Set([
                    ...(testsForTestsTab || []).map((t: any) => getContentFolderRootName(t.folder_name)).filter(Boolean),
                    ...courseFolders.filter((f: any) => f.type === "test" && !f.parent_id).map(folderFullName),
                  ]);
                  const sortedTestFolders = sortFolderNamesByOrder(Array.from(testFolderNames), "test", courseFolders);
                  return sortedTestFolders.map((folderName: any) => {
                    const folderTests = (testsForTestsTab || []).filter((t: any) => t.folder_name === folderName || String(t.folder_name || "").startsWith(`${folderName} /`));
                    if (folderTests.length === 0) return null;
                    const isLocked = !isAdmin && !course.isEnrolled;
                    const testFolderColor = "#16A34A";
                    return (
                      <Pressable key={`folder_${folderName}`}
                        style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: testFolderColor }]}
                        onPress={() => {
                          openFolderView({ name: folderName, type: "tests", color: testFolderColor, testType: "regular" });
                        }}
                      >
                        <View style={[styles.testSectionIconWrap, { backgroundColor: testFolderColor + "18" }]}>
                          <Ionicons name="folder" size={22} color={testFolderColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.testSectionTitle}>{folderName}</Text>
                          <Text style={styles.testSectionCount}>{folderTests.length} {folderTests.length === 1 ? "test" : "tests"}</Text>
                        </View>
                        {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
                      </Pressable>
                    );
                  });
                })()}
                {/* Tests without folder — show directly as individual cards (non-test-series) */}
                {!isTestSeriesCourse && testsForTestsTab.filter((t: any) => !t.folder_name).map((test: any) => {
                  const color = TEST_TYPE_COLORS[test.test_type] || "#1A56DB";
                  const attempt = attemptSummary[test.id];
                  const canAccess = isAdmin || course.isEnrolled;
                  const handlePress = () => {
                    if (!canAccess) {
                      promptLockedCourseContent();
                      return;
                    }
                    if (attempt) {
                      router.push({
                        pathname: "/test-result/[id]",
                        params: { id: test.id, score: String(attempt.score ?? 0), total: String(attempt.total_marks ?? test.total_marks), totalQuestions: String(test.total_questions), percentage: String(attempt.percentage ?? "0"), weakTopics: "", attemptId: String(attempt.attempt_id ?? ""), testType: test.test_type ?? "", timeTakenSeconds: String(attempt.time_taken_seconds ?? 0) },
                      });
                    } else {
                      router.push(`/test/${test.id}`);
                    }
                  };
                  return (
                    <Pressable key={test.id} style={[styles.testCard, { backgroundColor: colors.card, borderBottomColor: colors.border }, !canAccess && { opacity: 0.6 }]} onPress={handlePress}>
                      <View style={[styles.testColorBar, { backgroundColor: color }]} />
                      <View style={styles.testItemIcon}><Ionicons name="document-text" size={22} color={color} /></View>
                      <View style={styles.testItemInfo}>
                        <Text style={styles.testItemTitle}>{test.title}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text style={styles.testItemMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.total_marks} marks</Text>
                          {attempt && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>{attempt.score}/{attempt.total_marks}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {!canAccess ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : attempt ? <Ionicons name="bar-chart" size={18} color={Colors.light.primary} /> : <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {currentActiveTab === "PYQs" && isTestSeriesCourse && (
          <View style={styles.list}>
            {renderTestSeriesTabList(testsForPyqTab, {
              emptyIcon: "school-outline",
              emptyText: "No PYQs available",
              folderColor: "#F59E0B",
              testType: "pyq",
            })}
          </View>
        )}

        {currentActiveTab === "Mock Tests" && (
          <View style={styles.list}>
            {testsForMockTab.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="clipboard-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No mock tests available</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {(() => {
                  const mockFolderNames = new Set(
                    (testsForMockTab || []).map((t: any) => getContentFolderRootName(t.folder_name)).filter(Boolean)
                  );
                  return Array.from(mockFolderNames).map((folderName: any) => {
                    const folderTests = (testsForMockTab || []).filter((t: any) => t.folder_name === folderName || String(t.folder_name || "").startsWith(`${folderName} /`));
                    if (folderTests.length === 0) return null;
                    const isLocked = !isAdmin && !course.isEnrolled;
                    const mockFolderColor = "#DC2626";
                    return (
                      <Pressable key={`mock_folder_${folderName}`}
                        style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: mockFolderColor }]}
                        onPress={() => {
                          openFolderView({ name: folderName, type: "tests", color: mockFolderColor, testType: "mock" });
                        }}
                      >
                        <View style={[styles.testSectionIconWrap, { backgroundColor: mockFolderColor + "18" }]}>
                          <Ionicons name="folder" size={22} color={mockFolderColor} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.testSectionTitle}>{folderName}</Text>
                          <Text style={styles.testSectionCount}>{folderTests.length} {folderTests.length === 1 ? "test" : "tests"}</Text>
                        </View>
                        {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
                      </Pressable>
                    );
                  });
                })()}
                {testsForMockTab.filter((t: any) => !t.folder_name).map((test: any) => {
                  const color = TEST_TYPE_COLORS.mock;
                  const attempt = attemptSummary[test.id];
                  const canAccess = isAdmin || course.isEnrolled;
                  const handlePress = () => {
                    if (!canAccess) {
                      promptLockedCourseContent();
                      return;
                    }
                    if (attempt) {
                      router.push({
                        pathname: "/test-result/[id]",
                        params: { id: test.id, score: String(attempt.score ?? 0), total: String(attempt.total_marks ?? test.total_marks), totalQuestions: String(test.total_questions), percentage: String(attempt.percentage ?? "0"), weakTopics: "", attemptId: String(attempt.attempt_id ?? ""), testType: test.test_type ?? "", timeTakenSeconds: String(attempt.time_taken_seconds ?? 0) },
                      });
                    } else {
                      router.push(`/test/${test.id}`);
                    }
                  };
                  return (
                    <Pressable key={test.id} style={[styles.testCard, { backgroundColor: colors.card, borderBottomColor: colors.border }, !canAccess && { opacity: 0.6 }]} onPress={handlePress}>
                      <View style={[styles.testColorBar, { backgroundColor: color }]} />
                      <View style={styles.testItemIcon}><Ionicons name="clipboard" size={22} color={color} /></View>
                      <View style={styles.testItemInfo}>
                        <Text style={styles.testItemTitle}>{test.title}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <Text style={styles.testItemMeta}>{test.total_questions} questions · {test.duration_minutes}min · {test.total_marks} marks</Text>
                          {attempt && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                              <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>{attempt.score}/{attempt.total_marks}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      {!canAccess ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : attempt ? <Ionicons name="bar-chart" size={18} color={Colors.light.primary} /> : <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {currentActiveTab === "Materials" && (
          <View style={styles.list}>
            {course.materials.length === 0 && courseFolders.filter((f: any) => f.type === "material").length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No materials available</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {(() => {
                  const sorted = [...course.materials];
                  // Group by section_title — only items WITH a section_title go into folders
                  const folderMap = new Map<string, Material[]>();
                  const unfolderedMaterials: Material[] = [];
                  for (const mat of sorted) {
                    if (mat.section_title) {
                      const rootName = getContentFolderRootName(mat.section_title);
                      if (!folderMap.has(rootName)) folderMap.set(rootName, []);
                      folderMap.get(rootName)!.push(mat);
                    } else {
                      unfolderedMaterials.push(mat);
                    }
                  }
                  // Also include empty DB folders
                  for (const f of courseFolders.filter((f: any) => f.type === "material" && !f.parent_id)) {
                    const rootName = getContentFolderRootName(folderFullName(f));
                    if (!folderMap.has(rootName)) folderMap.set(rootName, []);
                  }
                  const folderNames = sortFolderNamesByOrder(Array.from(folderMap.keys()), "material", courseFolders);
                  const folders = folderNames.map((name) => [name, folderMap.get(name)!] as const);
                  return (
                    <>
                      {folders.map(([folderKey, materials]) => {
                        const folderName = folderKey;
                        const folderColor = "#DC2626";
                        const isLocked = !isAdmin && !course.isEnrolled;
                        return (
                          <Pressable key={folderKey}
                            style={[styles.testSectionCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: folderColor }]}
                            onPress={() => {
                              openFolderView({ name: folderName, type: "materials", color: folderColor });
                            }}
                          >
                            <View style={[styles.testSectionIconWrap, { backgroundColor: "#FEE2E2" }]}>
                              <Ionicons name="folder" size={22} color={folderColor} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.testSectionTitle}>{folderName}</Text>
                              <Text style={styles.testSectionCount}>{materials.length} {materials.length === 1 ? "file" : "files"}</Text>
                            </View>
                            {isLocked ? <Ionicons name="lock-closed" size={20} color={Colors.light.textMuted} /> : <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />}
                          </Pressable>
                        );
                      })}
                      {/* Materials without a folder — show directly */}
                      {unfolderedMaterials.map((mat) => {
                        const canAccess = isAdmin || course.isEnrolled;
                        return (
                          <View key={mat.id} style={[styles.testCard, { backgroundColor: colors.card, borderBottomColor: colors.border, flexDirection: "row", alignItems: "center" }]}>
                            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => {
                                if (!canAccess) {
                                  promptLockedCourseContent();
                                  return;
                                }
                                router.push(`/material/${mat.id}`);
                              }}>
                              <View style={[styles.testColorBar, { backgroundColor: "#DC2626" }]} />
                              <View style={styles.testItemIcon}><Ionicons name={mat.file_type === "pdf" ? "document-text" : mat.file_type === "video" ? "videocam" : "document"} size={22} color="#DC2626" /></View>
                              <View style={styles.testItemInfo}>
                                <Text style={styles.testItemTitle}>{mat.title}</Text>
                                <Text style={styles.testItemMeta}>{(mat.file_type || "file").toUpperCase()}</Text>
                              </View>
                              {!canAccess && <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />}
                            </Pressable>
                            <DownloadButton
                              itemType="material"
                              itemId={mat.id}
                              downloadAllowed={mat.download_allowed || false}
                              isEnrolled={course.isEnrolled}
                              title={mat.title || 'Material'}
                              fileType={mat.file_type || 'pdf'}
                            />
                          </View>
                        );
                      })}
                    </>
                  );
                })()}
              </View>
            )}
          </View>
        )}

        {currentActiveTab === "Live" && (
          <View style={styles.list}>
            {liveClassesPending && liveClassesForTab.length === 0 ? (
              <View style={[styles.emptyState, { gap: 12 }]}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={styles.emptyText}>Loading live schedule…</Text>
              </View>
            ) : liveClassesForTab.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No upcoming or live sessions</Text>
                <Text style={styles.emptySubText}>
                  Recordings from ended classes are under Lectures → Live Class Recordings
                </Text>
              </View>
            ) : (
              (() => {
                // Group by section_title
                const folderMap = new Map<string, LiveClass[]>();
                for (const lc of liveClassesForTab) {
                  const key = (lc as any).section_title || "__default__";
                  if (!folderMap.has(key)) folderMap.set(key, []);
                  folderMap.get(key)!.push(lc);
                }
                const folders = Array.from(folderMap.entries());
                return folders.map(([folderKey, classes]) => {
                  const folderName = folderKey === "__default__" ? null : folderKey;
                  const isExpanded = expandedSection === ("live_" + folderKey);
                  const hasFolder = !!folderName;
                  return (
                    <View key={folderKey}>
                      {hasFolder && (
                        <Pressable
                          style={[styles.folderHeader, { borderLeftColor: "#DC2626" }]}
                          onPress={() => {
                            const canAccess = isAdmin || course.isEnrolled;
                            if (!canAccess) {
                              showEnrollmentOrPurchaseAlert(() => {
                                Alert.alert(
                                  course.is_free ? "Enroll Required" : "Purchase Required",
                                  course.is_free ? "Please enroll for free to access live classes." : "Please purchase this course to access live classes.",
                                  [{ text: "Cancel", style: "cancel" }, { text: course.is_free ? "Enroll Free" : "Buy Now", onPress: handleEnroll }]
                                );
                              });
                              return;
                            }
                            openFolderView({ name: folderName!, type: "live", color: "#DC2626" });
                          }}
                        >
                          <View style={[styles.folderIconBox, { backgroundColor: "#FEE2E2" }]}>
                            <Ionicons name="folder" size={20} color="#DC2626" />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.folderName, { color: "#DC2626" }]}>{folderName}</Text>
                            <Text style={styles.folderCount}>{classes.length} {classes.length === 1 ? "class" : "classes"}</Text>
                          </View>
                          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                        </Pressable>
                      )}
                      {!hasFolder && classes.map((lc) => (
                        <Pressable
                          key={lc.id}
                          style={({ pressed }) => [styles.liveClassItem, pressed && { opacity: 0.85 }]}
                          onPress={() => {
                            // Check enrollment for non-free, non-public classes
                            const canAccess = isAdmin || course.isEnrolled;
                            if (!canAccess) {
                              showEnrollmentOrPurchaseAlert(() => {
                                Alert.alert(
                                  course.is_free ? "Enroll Required" : "Purchase Required",
                                  course.is_free
                                    ? "Please enroll for free to access this live class."
                                    : "Please purchase this course to access live classes.",
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    { text: course.is_free ? "Enroll Free" : "Buy Now", onPress: handleEnroll },
                                  ]
                                );
                              });
                              return;
                            }
                            router.push({
                              pathname: "/live-class/[id]",
                              params: {
                                id: lc.id,
                                videoUrl: lc.youtube_url ?? "",
                                title: lc.title ?? "",
                                listIsLive: lc.is_live ? "1" : "0",
                              },
                            });
                          }}
                        >
                          <LinearGradient
                            colors={
                              lc.is_live
                                ? ["#DC2626", "#EF4444"]
                                : lc.is_completed
                                  ? ["#1A56DB", "#3B82F6"]
                                  : (lc as any).is_recording_mode
                                    ? ["#7C3AED", "#8B5CF6"]
                                    : ["#6B7280", "#9CA3AF"]
                            }
                            style={styles.liveStatusBadge}
                          >
                            {lc.is_live ? (
                              <><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>
                            ) : lc.is_completed ? (
                              <Ionicons name="play" size={14} color="#fff" />
                            ) : (lc as any).is_recording_mode ? (
                              <><Ionicons name="radio" size={12} color="#fff" /><Text style={[styles.liveStatusText, { fontSize: 9 }]}> REC</Text></>
                            ) : (
                              <Ionicons name="time" size={14} color="#fff" />
                            )}
                          </LinearGradient>
                          <View style={styles.liveClassInfo}>
                            <Text style={styles.liveClassTitle}>{lc.title}</Text>
                            {lc.description ? <Text style={styles.liveClassDesc} numberOfLines={1}>{lc.description}</Text> : null}
                            <Text style={styles.liveClassTime}>
                              {lc.is_live
                                ? "Happening now"
                                : (() => {
                                    const d = new Date(Number(lc.scheduled_at));
                                    const dateStr = d.toLocaleDateString(undefined, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                    });
                                    const timeStr = d.toLocaleTimeString(undefined, {
                                      hour: "numeric",
                                      minute: "2-digit",
                                    });
                                    const dur =
                                      lc.duration_minutes && lc.duration_minutes > 0
                                        ? ` · ${lc.duration_minutes} min`
                                        : "";
                                    return `${dateStr} · ${timeStr}${dur}`;
                                  })()}
                            </Text>
                          </View>
                          <Ionicons name={lc.is_live || lc.is_completed ? "play-circle" : "calendar"} size={24} color={lc.is_live ? "#DC2626" : lc.is_completed ? Colors.light.primary : Colors.light.textMuted} />
                        </Pressable>
                      ))}
                    </View>
                  );
                });
              })()
            )}
          </View>
        )}

        {currentActiveTab === "Enrolled" && isAdmin && (
          <View style={styles.list}>
            {enrolledStudentsPending && enrolledStudents.length === 0 ? (
              <View style={[styles.emptyState, { gap: 12 }]}>
                <ActivityIndicator size="large" color={Colors.light.primary} />
                <Text style={styles.emptyText}>Loading enrolled students…</Text>
              </View>
            ) : enrolledStudents.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No enrolled students</Text>
                <Text style={styles.emptySubText}>Students who enroll will appear here</Text>
              </View>
            ) : (
              enrolledStudents.map((student) => (
                <View key={student.id} style={styles.studentCard}>
                  <View style={styles.studentAvatar}>
                    <Ionicons name="person" size={20} color="#fff" />
                  </View>
                  <View style={styles.studentInfo}>
                    <Text style={styles.studentName}>{student.user_name}</Text>
                    <Text style={styles.studentPhone}>{student.user_phone}</Text>
                    <View style={styles.studentMetaRow}>
                      <View style={[styles.studentStatusDot, { backgroundColor: student.status === "active" ? "#22C55E" : "#EF4444" }]} />
                      <Text style={styles.studentStatus}>{student.status === "active" ? "Active" : "Inactive"}</Text>
                      <Text style={styles.studentProgress}> · {student.progress_percent}% complete</Text>
                    </View>
                  </View>
                  <Pressable
                    style={styles.studentMenuBtn}
                    onPress={() => setStudentActionStudent(student)}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {enrollSuccess && (
        <View style={[styles.enrollBar, { paddingBottom: bottomPadding + 12, backgroundColor: "#DCFCE7" }]}>
          <Ionicons name="checkmark-circle" size={22} color="#16A34A" />
          <Text style={{ flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#15803D" }}>
            Enrolled successfully!
          </Text>
        </View>
      )}

      {!isAdmin && !course.isEnrolled && !enrollSuccess && (
        <View style={[styles.enrollBar, { paddingBottom: bottomPadding + 12 }]}>
          {course.accessExpired ? (
            <View style={{ flex: 1, gap: 8 }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>
                Course access has expired
              </Text>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>
                Contact support or your admin to renew access to this course.
              </Text>
            </View>
          ) : (
            <>
          {!!enrollError && (
            <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, padding: 8, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="alert-circle-outline" size={14} color="#DC2626" />
              <Text style={{ fontSize: 12, color: "#DC2626", fontFamily: "Inter_500Medium", flex: 1 }}>{enrollError}</Text>
            </View>
          )}
          <View style={styles.priceSection}>
            {course.is_free ? (
              <Text style={styles.priceText}>Free</Text>
            ) : (
              <>
                <Text style={styles.priceText}>₹{parseFloat(course.price).toFixed(0)}</Text>
                {parseFloat(course.original_price) > 0 && (
                  <Text style={styles.originalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text>
                )}
              </>
            )}
          </View>
          <Pressable
            style={({ pressed }) => [styles.enrollBtn, pressed && { opacity: 0.9 }]}
            onPress={handleEnroll}
            disabled={enrollMutation.isPending || isPaymentPending}
          >
            <LinearGradient
              colors={course.is_free ? ["#22C55E", "#16A34A"] : [Colors.light.accent, "#E55A25"]}
              style={styles.enrollBtnGradient}
            >
              {enrollMutation.isPending || isPaymentPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.enrollBtnText}>
                  {course.is_free ? "Enroll for Free" : "Buy Now"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
            </>
          )}
        </View>
      )}

      {paymentWebViewHtml && Platform.OS !== "web" && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => { setPaymentWebViewHtml(null); setIsPaymentPending(false); }}
        >
          <View style={{ flex: 1, backgroundColor: "#0A1628", paddingBottom: Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0) }}>
            <WebView
              source={{ html: paymentWebViewHtml, baseUrl: "https://api.razorpay.com" }}
              style={{ flex: 1 }}
              javaScriptEnabled
              domStorageEnabled
              mixedContentMode="compatibility"
              setSupportMultipleWindows={false}
              originWhitelist={["*"]}
              onMessage={async (event) => {
                try {
                  const data = JSON.parse(event.nativeEvent.data);
                  if (data.type === "payment_success") {
                    setPaymentWebViewHtml(null);
                    try {
                      await apiRequest("POST", "/api/payments/verify", {
                        razorpay_order_id: data.razorpay_order_id,
                        razorpay_payment_id: data.razorpay_payment_id,
                        razorpay_signature: data.razorpay_signature,
                        courseId: parseInt(id as string),
                      });
                      invalidateAccessCaches(qc, { userId: user?.id, courseId: id });
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      Alert.alert("Success!", "Payment successful! You are now enrolled.");
                    } catch {
                      Alert.alert("Error", "Payment was received but enrollment failed. Please contact support.");
                    } finally {
                      setIsPaymentPending(false);
                    }
                  } else if (data.type === "payment_dismissed") {
                    setPaymentWebViewHtml(null);
                    setIsPaymentPending(false);
                  } else if (data.type === "payment_failed") {
                    apiRequest("POST", "/api/payments/track-failure", {
                      courseId: parseInt(id as string),
                      reason: data.error || "Payment failed",
                      error: data || null,
                    }).catch(() => {});
                    setPaymentWebViewHtml(null);
                    setIsPaymentPending(false);
                    Alert.alert("Payment Failed", data.error || "Payment could not be completed.");
                  }
                } catch (_e) {}
              }}
            />
            <Pressable
              onPress={() => { setPaymentWebViewHtml(null); setIsPaymentPending(false); }}
              style={{
                position: "absolute",
                top: insets.top + 10,
                left: 14,
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: "rgba(10,22,40,0.55)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
          </View>
        </Modal>
      )}

      {/* Student Action Sheet */}
      <Modal visible={!!studentActionStudent} animationType="slide" transparent onRequestClose={() => setStudentActionStudent(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={() => setStudentActionStudent(null)}>
          <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 }}>
            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 4 }}>
              {studentActionStudent?.user_name}
            </Text>
            <Text style={{ fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: -8 }}>
              {studentActionStudent?.user_phone}
            </Text>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: Colors.light.secondary, borderRadius: 12 }}
              onPress={() => {
                if (studentActionStudent) {
                  updateEnrollmentMutation.mutate({ enrollmentId: studentActionStudent.id, status: studentActionStudent.status === "active" ? "inactive" : "active" });
                }
                setStudentActionStudent(null);
              }}
            >
              <Ionicons name={studentActionStudent?.status === "active" ? "pause-circle-outline" : "checkmark-circle-outline"} size={22} color={Colors.light.primary} />
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.text }}>
                {studentActionStudent?.status === "active" ? "Make Inactive" : "Activate Student"}
              </Text>
            </Pressable>
            <Pressable
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, backgroundColor: "#FEE2E2", borderRadius: 12 }}
              onPress={() => {
                if (studentActionStudent) removeEnrollmentMutation.mutate(studentActionStudent.id);
                setStudentActionStudent(null);
              }}
            >
              <Ionicons name="person-remove-outline" size={22} color="#EF4444" />
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: "#EF4444" }}>Remove from Course</Text>
            </Pressable>
            <Pressable style={{ padding: 14, alignItems: "center" }} onPress={() => setStudentActionStudent(null)}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 8, overflow: "hidden" },
  headerCompact: { paddingBottom: 8, gap: 4 },
  headerThumbnail: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.10 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerBadges: { flexDirection: "row", gap: 8 },
  freeBadge: { backgroundColor: "#22C55E", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  freeBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  testSeriesBadge: { backgroundColor: "#7C3AED", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  testSeriesBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  discountBadge: { backgroundColor: Colors.light.accent, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  discountBadgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  courseIconArea: { position: "absolute", right: 20, top: 60, opacity: 0.4 },
  courseTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 30, maxWidth: "85%" },
  courseTitleCompact: { marginTop: 4, maxWidth: "100%" },
  courseDateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  courseDateText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.9)" },
  instructorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  instructorAvatar: { width: 24, height: 24, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  instructorName: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_500Medium" },
  levelChip: { backgroundColor: Colors.light.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  courseQuickStats: { flexDirection: "row", flexWrap: "wrap" },
  quickStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  quickStatTextGroup: { flexDirection: "row", alignItems: "center", gap: 2 },
  quickStatNum: { fontSize: 13, color: "rgba(255,255,255,0.95)", fontFamily: "Inter_600SemiBold" },
  quickStatLabel: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
  progressSection: { gap: 6 },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 12, color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" },
  progressPct: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#22C55E" },
  progressBar: { height: 6, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: "#22C55E", borderRadius: 3 },
  tabBarScroll: { backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border, maxHeight: 52 },
  tabBarContent: { paddingHorizontal: 4 },
  tabItem: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabItemActive: { borderBottomColor: Colors.light.primary },
  tabText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  filterChipsScroll: { backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: Colors.light.border, maxHeight: 60 },
  filterChipsContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" },
  filterChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "#fff", borderWidth: 1, borderColor: Colors.light.border },
  filterChipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  filterChipTextActive: { color: "#fff" },
  scrollView: { flex: 1 },
  scrollContent: { gap: 0 },
  list: { gap: 0 },
  sectionHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#F0F4FF", paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  sectionHeaderText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lectureItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  lectureNumber: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center",
  },
  lectureNumberDone: { backgroundColor: "#22C55E" },
  lectureNumberText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lectureInfo: { flex: 1 },
  lectureTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  lectureMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lectureMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  previewBadge: { backgroundColor: "#DCFCE7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  previewBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#15803D" },
  testCard: { flexDirection: "row", alignItems: "center", gap: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  testColorBar: { width: 4, alignSelf: "stretch" },
  testItemIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center", margin: 12 },
  testItemInfo: { flex: 1, paddingVertical: 14, paddingRight: 12 },
  testItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  testItemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  testSectionCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
    borderRadius: 14, padding: 16, borderLeftWidth: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  testSectionIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  testSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  testSectionCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  testSectionContent: { backgroundColor: "#F9FAFB", borderRadius: 12, marginTop: 6, overflow: "hidden" },
  testFolderHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: "#F3F4F6", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  testFolderName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  testFolderCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  materialItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  materialIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  materialInfo: { flex: 1 },
  materialTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  materialDesc: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 2 },
  materialType: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626", backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, alignSelf: "flex-start" },
  liveClassItem: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  liveStatusBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  liveClassInfo: { flex: 1 },
  liveClassTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  liveClassDesc: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 2 },
  liveClassTime: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  folderHeader: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#F8FAFF", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
    borderLeftWidth: 4,
  },
  folderIconBox: {
    width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center",
  },
  folderName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  folderCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 1 },
  recordingsRow: {
    flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  recordingCard: {
    flex: 1, alignItems: "center", paddingVertical: 16, paddingHorizontal: 8,
    borderRadius: 14, borderWidth: 1.5, backgroundColor: "#fff",
  },
  recordingCardActive: {
    backgroundColor: "#F8FAFC",
  },
  recordingIconBox: {
    width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  recordingCardTitle: { fontSize: 13, fontFamily: "Inter_700Bold", marginBottom: 2 },
  recordingCardCount: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 15, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptySubText: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 20 },
  enrollBar: {
    backgroundColor: "#fff", paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.light.border,
    flexDirection: "row", alignItems: "center", gap: 16,
  },
  priceSection: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  priceText: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  originalPrice: { fontSize: 14, color: Colors.light.textMuted, textDecorationLine: "line-through", fontFamily: "Inter_400Regular" },
  enrollBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  enrollBtnGradient: { paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  enrollBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  studentCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  studentAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" },
  studentInfo: { flex: 1 },
  studentName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  studentPhone: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 4 },
  studentMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  studentStatusDot: { width: 6, height: 6, borderRadius: 3 },
  studentStatus: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  studentProgress: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  studentMenuBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  // About tab styles
  aboutSection: { backgroundColor: "#fff", borderRadius: 16, padding: 16, gap: 12, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  aboutDescBlock: {
    backgroundColor: "#EFF6FF", borderRadius: 14, padding: 16,
    borderLeftWidth: 4, borderLeftColor: Colors.light.primary,
  },
  aboutDescText: {
    fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text,
    lineHeight: 22,
  },
  aboutSectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  aboutSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  aboutDescription: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, lineHeight: 22 },
  aboutDetailGrid: { gap: 14 },
  aboutDetailItem: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  aboutDetailLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  aboutDetailValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginTop: 1 },
  aboutIncludeItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  aboutIncludeText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text },
  aboutTncBlock: {
    backgroundColor: "#FFFBEB", borderRadius: 14, padding: 16, gap: 10,
    borderWidth: 1, borderColor: "#FDE68A",
  },
  aboutTncItem: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  aboutTncBullet: { fontSize: 14, color: "#92400E", lineHeight: 20, marginTop: 1 },
  aboutTncText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", color: "#78350F", lineHeight: 20 },
});
