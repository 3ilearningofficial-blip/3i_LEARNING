import React, { useState, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert, Modal, Image,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { fetch } from "expo/fetch";
import { useAuth } from "@/context/AuthContext";
import { WebView } from "react-native-webview";
import { DownloadButton } from "@/components/DownloadButton";

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
  duration_minutes?: number;
  section_title?: string;
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
  progress: number;
  lectures: Lecture[];
  tests: CourseTest[];
  materials: Material[];
  pyq_count?: number;
  mock_count?: number;
  practice_count?: number;
  thumbnail?: string;
  cover_color?: string;
}

const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", chapter: "#059669", weekly: "#7C3AED", test: "#059669", pyq: "#F59E0B",
};

const TEST_SERIES_SECTIONS = [
  { key: "practice", label: "Practice", icon: "fitness" as const, color: "#1A56DB" },
  { key: "test", label: "Test", icon: "document-text" as const, color: "#059669" },
  { key: "pyq", label: "PYQs", icon: "time" as const, color: "#F59E0B" },
  { key: "mock", label: "Mock", icon: "trophy" as const, color: "#DC2626" },
];

export default function CourseDetailScreen() {
  useScreenProtection(true);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState("About");
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [expandedTestSection, setExpandedTestSection] = useState<string | null>(null);
  // Folder modal
  const [openFolder, setOpenFolder] = useState<{ name: string; type: "lectures" | "materials" | "live" | "tests"; color: string; items: any[] } | null>(null);
  const [paymentWebViewHtml, setPaymentWebViewHtml] = useState<string | null>(null);
  const [testTypeFilter, setTestTypeFilter] = useState<string>("all");
  const [folderTestTypeFilter, setFolderTestTypeFilter] = useState<string>("all");
  const [isPaymentPending, setIsPaymentPending] = useState(false);
  const [enrollError, setEnrollError] = useState("");
  const [enrollSuccess, setEnrollSuccess] = useState(false);
  const [studentActionStudent, setStudentActionStudent] = useState<any>(null);

  const trackDownload = async (itemType: "material" | "lecture", itemId: number) => {
    try {
      await apiRequest("POST", "/api/my-downloads", { itemType, itemId });
      qc.invalidateQueries({ queryKey: ["/api/my-downloads"] });
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

  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error("Failed to load course");
      return res.json();
    },
    staleTime: 0,
    refetchInterval: 30000,
  });

  const { data: liveClasses = [] } = useQuery<LiveClass[]>({
    queryKey: ["/api/live-classes", id],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/live-classes?courseId=${id}`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeTab === "Live",
    refetchInterval: activeTab === "Live" ? 10000 : false,
  });

  const { data: attemptSummary = {} } = useQuery<Record<number, any>>({
    queryKey: ["/api/my-attempts/summary"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-attempts/summary", baseUrl).toString());
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!user,
    staleTime: 0,
  });

  const { data: courseFolders = [] } = useQuery<any[]>({
    queryKey: ["/api/courses", id, "folders"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/courses/${id}/folders`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && id !== "undefined",
  });

  const { data: enrolledStudents = [] } = useQuery<EnrolledStudent[]>({
    queryKey: ["/api/admin/courses", id, "enrollments"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/admin/courses/${id}/enrollments`, baseUrl);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: isAdmin && activeTab === "Enrolled",
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
      const res = await apiRequest("POST", `/api/courses/${id}/enroll`, { userId: user?.id });
      return res.json();
    },
    onSuccess: () => {
      setEnrollError("");
      setEnrollSuccess(true);
      // Optimistically update the course detail cache — don't wait for refetch
      qc.setQueryData(["/api/courses", id], (old: any) => {
        if (!old) return old;
        return { ...old, isEnrolled: true, progress: 0 };
      });
      // Also update the courses list cache optimistically
      qc.setQueriesData({ queryKey: ["/api/courses"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((c: any) => c.id === parseInt(id as string) ? { ...c, isEnrolled: true } : c);
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
        qc.invalidateQueries({ queryKey: ["/api/courses"] });
        qc.refetchQueries({ queryKey: ["/api/courses"], type: "all" });
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
    setIsPaymentPending(true);
    try {
      const orderRes = await apiRequest("POST", "/api/payments/create-order", { courseId: parseInt(id as string) });
      const orderData = await orderRes.json();

      if (Platform.OS === "web") {
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
                courseId: parseInt(id as string),
              });
              qc.invalidateQueries({ queryKey: ["/api/courses", id] });
              qc.invalidateQueries({ queryKey: ["/api/courses"] });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Success!", "Payment successful! You are now enrolled.");
            } catch {
              Alert.alert("Error", "Payment was received but enrollment failed. Please contact support.");
            }
          },
          prefill: {
            contact: user?.phone ? `+91${user.phone}` : "",
          },
          theme: { color: "#1A56DB" },
          modal: { ondismiss: () => {} },
        };

        const rzp = new (window as any).Razorpay(options);
        rzp.open();
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
}, 500);
</script></body></html>`;
        setPaymentWebViewHtml(checkoutHtml);
      }
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("Already enrolled")) {
        Alert.alert("Already Enrolled", "You are already enrolled in this course.");
        qc.invalidateQueries({ queryKey: ["/api/courses", id] });
      } else {
        Alert.alert("Error", "Failed to initiate payment. Please try again.");
      }
    } finally {
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

  const handleLecture = (lecture: Lecture) => {
    const isLiveRecording = lecture.section_title === "Live Class Recordings";
    // Free preview lectures are accessible to all; everything else requires enrollment
    const canAccess = isAdmin || course?.isEnrolled || lecture.is_free_preview;
    if (!canAccess) {
      Alert.alert(
        course?.is_free ? "Enroll Required" : "Purchase Required",
        course?.is_free
          ? "Please enroll for free to access this lecture."
          : "Please purchase this course to access all lectures.",
        [
          { text: "Cancel", style: "cancel" },
          { text: course?.is_free ? "Enroll Free" : "Buy Now", onPress: handleEnroll },
        ]
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/lecture/[id]",
      params: { id: lecture.id, courseId: id, videoUrl: lecture.video_url || "", title: lecture.title },
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding }]}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  if (!course) {
    return (
      <View style={[styles.centered, { paddingTop: topPadding }]}>
        <Text style={styles.errorText}>Course not found</Text>
      </View>
    );
  }

  const renderTestItem = (test: CourseTest, courseData: CourseDetail) => {
    const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
    const attempt = attemptSummary[test.id];
    const handlePress = () => {
      if (!courseData.isEnrolled && !courseData.is_free) {
        Alert.alert("Purchase Required", "Please purchase this course to access tests.");
        return;
      }
      if (attempt) {
        setOpenFolder(null);
        setTimeout(() => {
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
        }, 50);
      } else {
        setOpenFolder(null);
        setTimeout(() => router.push(`/test/${test.id}`), 50);
      }
    };
    return (
      <Pressable
        key={test.id}
        style={({ pressed }) => [styles.testCard, pressed && { opacity: 0.85 }]}
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
        {!courseData.isEnrolled && !courseData.is_free ? (
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
  const TABS = isTestSeriesCourse
    ? (isAdmin ? ["About", "Tests", "Enrolled"] : ["About", "Tests"])
    : isAdmin
    ? ["About", "Lectures", "Tests", "Materials", "Live", "Enrolled"]
    : ["About", "Lectures", "Tests", "Materials", "Live"];

  const discount = course.original_price && parseFloat(course.original_price) > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;

  const firstTab = TABS[0];
  const currentActiveTab = TABS.includes(activeTab) ? activeTab : firstTab;

  return (
    <View style={styles.container}>
      {(() => {
        const c1 = course.cover_color || "#1A56DB";
        const c2 = c1 + "CC";
        return (
          <LinearGradient colors={["#0A1628", c1, c2]} style={[styles.header, { paddingTop: topPadding + 4 }]}>
            {/* Thumbnail overlay if set */}
            {course.thumbnail ? (
              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                <Image source={{ uri: course.thumbnail }} style={styles.headerThumbnail} resizeMode="cover" />
              </View>
            ) : null}
            <View style={styles.headerTop}>
              <Pressable style={styles.backBtn} onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/(tabs)"); }}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </Pressable>
              <View style={styles.headerBadges}>
                {course.is_free && <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>}
                {isTestSeriesCourse && <View style={styles.testSeriesBadge}><Text style={styles.testSeriesBadgeText}>TEST SERIES</Text></View>}
                {!course.is_free && discount > 0 && <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>}
              </View>
            </View>

            {!course.thumbnail && (
              <View style={styles.courseIconArea}>
                <MaterialCommunityIcons
                  name={isTestSeriesCourse ? "clipboard-check" : "math-compass"}
                  size={48} color="rgba(255,255,255,0.25)"
                />
              </View>
            )}

            <Text style={styles.courseCategory}>{course.category}</Text>
            <Text style={styles.courseTitle}>{course.title}</Text>

            <View style={styles.instructorRow}>
              <View style={styles.instructorAvatar}>
                <Ionicons name="person" size={14} color="#fff" />
              </View>
              <Text style={styles.instructorName}>{course.teacher_name}</Text>
              <View style={styles.levelChip}><Text style={styles.levelChipText}>{course.level}</Text></View>
            </View>

            {(course.course_type || "live") === "live" && (course.start_date || course.end_date) && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Ionicons name="calendar" size={14} color="rgba(255,255,255,0.9)" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.9)" }}>
                  {course.start_date || "TBD"} → {course.end_date || "TBD"}
                </Text>
              </View>
            )}

            <View style={styles.courseQuickStats}>
          {!isTestSeriesCourse && (
            <View style={styles.quickStat}>
              <Ionicons name="videocam" size={16} color="rgba(255,255,255,0.8)" />
              <Text style={styles.quickStatText}>{course.total_lectures} Lectures</Text>
            </View>
          )}
          {isTestSeriesCourse ? (
            <>
              <View style={styles.quickStat}>
                <Ionicons name="layers" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.total_tests || 0} Tests</Text>
              </View>
              <View style={styles.quickStat}>
                <Ionicons name="document-text" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.pyq_count || 0} PYQ</Text>
              </View>
              <View style={styles.quickStat}>
                <Ionicons name="clipboard" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.mock_count || 0} Mock</Text>
              </View>
              <View style={styles.quickStat}>
                <Ionicons name="create" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.practice_count || 0} Practice</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.quickStat}>
                <Ionicons name="document-text" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.total_tests} Tests</Text>
              </View>
              <View style={styles.quickStat}>
                <Ionicons name="folder" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.total_materials || 0} Materials</Text>
              </View>
              <View style={styles.quickStat}>
                <Ionicons name="time" size={16} color="rgba(255,255,255,0.8)" />
                <Text style={styles.quickStatText}>{course.duration_hours}h</Text>
              </View>
            </>
          )}
        </View>

        {course.isEnrolled && (
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
        style={styles.tabBarScroll}
        contentContainerStyle={styles.tabBarContent}
      >
        {TABS.map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tabItem, currentActiveTab === tab && styles.tabItemActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, currentActiveTab === tab && styles.tabTextActive]}>{tab}</Text>
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
              <View style={styles.aboutSection}>
                <View style={styles.aboutSectionHeader}>
                  <Ionicons name="information-circle" size={20} color={Colors.light.primary} />
                  <Text style={styles.aboutSectionTitle}>About this Course</Text>
                </View>
                <View style={{ gap: 10 }}>
                  {course.description.split("\n").filter((l) => l.trim()).map((line, i) => (
                    <View key={i} style={styles.aboutIncludeItem}>
                      <Ionicons name="checkmark-circle" size={18} color={Colors.light.primary} />
                      <Text style={styles.aboutIncludeText}>{line.trim()}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Key Details */}
            <View style={styles.aboutSection}>
              <View style={styles.aboutSectionHeader}>
                <Ionicons name="list" size={20} color={Colors.light.primary} />
                <Text style={styles.aboutSectionTitle}>Course Details</Text>
              </View>
              <View style={styles.aboutDetailGrid}>
                <View style={styles.aboutDetailItem}>
                  <Ionicons name="person" size={16} color={Colors.light.textMuted} />
                  <View>
                    <Text style={styles.aboutDetailLabel}>Instructor</Text>
                    <Text style={styles.aboutDetailValue}>{course.teacher_name}</Text>
                  </View>
                </View>
                <View style={styles.aboutDetailItem}>
                  <Ionicons name="bar-chart" size={16} color={Colors.light.textMuted} />
                  <View>
                    <Text style={styles.aboutDetailLabel}>Level</Text>
                    <Text style={styles.aboutDetailValue}>{course.level}</Text>
                  </View>
                </View>
                {!isTestSeriesCourse && (
                  <View style={styles.aboutDetailItem}>
                    <Ionicons name="time" size={16} color={Colors.light.textMuted} />
                    <View>
                      <Text style={styles.aboutDetailLabel}>Duration</Text>
                      <Text style={styles.aboutDetailValue}>{course.duration_hours}h total</Text>
                    </View>
                  </View>
                )}
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
              </View>
            </View>

            {/* What's Included */}
            <View style={styles.aboutSection}>
              <View style={styles.aboutSectionHeader}>
                <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                <Text style={styles.aboutSectionTitle}>What's Included</Text>
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
                <View style={styles.aboutIncludeItem}>
                  <Ionicons name="phone-portrait" size={18} color="#7C3AED" />
                  <Text style={styles.aboutIncludeText}>Access on mobile & web</Text>
                </View>
              </View>
            </View>

            {/* Price */}
            {!course.isEnrolled && (
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
                      if (!folderMap.has(lec.section_title)) folderMap.set(lec.section_title, []);
                      folderMap.get(lec.section_title)!.push(lec);
                    } else {
                      unfolderedLectures.push(lec);
                    }
                  }
                  // Also include empty DB folders
                  for (const f of courseFolders.filter((f: any) => f.type === "lecture")) {
                    if (!folderMap.has(f.name)) folderMap.set(f.name, []);
                  }
                  const folders = Array.from(folderMap.entries());
                  return (
                    <>
                      {folders.map(([folderKey, lectures]) => {
                        const folderName = folderKey;
                        const isLiveFolder = folderKey === "Live Class Recordings";
                        const folderColor = isLiveFolder ? "#DC2626" : "#1A56DB";
                        const folderBg = isLiveFolder ? "#FEE2E2" : "#EEF2FF";
                        const isLocked = !course.isEnrolled && !course.is_free;
                        return (
                          <Pressable key={folderKey}
                            style={[styles.testSectionCard, { borderLeftColor: folderColor }]}
                            onPress={() => setOpenFolder({ name: folderName, type: "lectures", color: folderColor, items: lectures })}
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
                        const canAccess = isAdmin || course.isEnrolled || lec.is_free_preview;
                        return (
                          <View key={lec.id} style={[styles.testCard, { flexDirection: "row", alignItems: "center" }]}>
                            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => {
                                if (!canAccess) return;
                                router.push({ pathname: "/lecture/[id]", params: { id: lec.id, courseId: id, videoUrl: lec.video_url || "", title: lec.title } });
                              }}>
                              <View style={[styles.testColorBar, { backgroundColor: "#1A56DB" }]} />
                              <View style={styles.testItemIcon}><Ionicons name="videocam" size={22} color="#1A56DB" /></View>
                              <View style={styles.testItemInfo}>
                                <Text style={styles.testItemTitle}>{lec.title}</Text>
                                <Text style={styles.testItemMeta}>{lec.duration_minutes || 0}min{lec.is_free_preview ? " · Free Preview" : ""}{lec.download_allowed ? " · Download" : ""}</Text>
                              </View>
                              {!canAccess ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : <Ionicons name="play-circle" size={20} color="#1A56DB" />}
                            </Pressable>
                            <DownloadButton
                              itemType="lecture"
                              itemId={lec.id}
                              downloadAllowed={lec.download_allowed || false}
                              isEnrolled={course.isEnrolled}
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

        {currentActiveTab === "Tests" && (
          <View style={styles.list}>
            {course.tests.length === 0 && courseFolders.filter((f: any) => f.type === "test").length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No tests available</Text>
              </View>
            ) : (
              <View style={{ gap: 12, padding: 16 }}>
                {/* Test folders from DB (including empty ones) */}
                {(() => {
                  const testFolderNames = new Set([
                    ...(course.tests || []).map((t: any) => t.folder_name).filter(Boolean),
                    ...courseFolders.filter((f: any) => f.type === "test").map((f: any) => f.name),
                  ]);
                  return Array.from(testFolderNames).map((folderName: any) => {
                    const folderTests = (course.tests || []).filter((t: any) => t.folder_name === folderName);
                    const isLocked = !course.isEnrolled && !course.is_free;
                    const testFolderColor = "#16A34A";
                    return (
                      <Pressable key={`folder_${folderName}`}
                        style={[styles.testSectionCard, { borderLeftColor: testFolderColor }]}
                        onPress={() => { setFolderTestTypeFilter("all"); setOpenFolder({ name: folderName, type: "tests", color: testFolderColor, items: folderTests }); }}
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
                {/* Tests grouped by type (no folder) — only for test series courses */}
                {isTestSeriesCourse && TEST_SERIES_SECTIONS.map((section) => {
                  if (testTypeFilter !== "all" && section.key !== testTypeFilter) return null;
                  const sectionTests = course.tests.filter((t) => t.test_type === section.key && !t.folder_name);
                  if (sectionTests.length === 0) return null;
                  return (
                    <Pressable key={section.key}
                      style={[styles.testSectionCard, { borderLeftColor: section.color }]}
                      onPress={() => { setFolderTestTypeFilter("all"); setOpenFolder({ name: section.label, type: "tests", color: section.color, items: sectionTests }); }}
                    >
                      <View style={[styles.testSectionIconWrap, { backgroundColor: section.color + "18" }]}>
                        <Ionicons name={section.icon} size={22} color={section.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.testSectionTitle}>{section.label}</Text>
                        <Text style={styles.testSectionCount}>{sectionTests.length} {sectionTests.length === 1 ? "test" : "tests"}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
                    </Pressable>
                  );
                })}
                {/* Tests without folder — show directly as individual cards (non-test-series) */}
                {!isTestSeriesCourse && course.tests.filter((t: any) => !t.folder_name).map((test: any) => {
                  const color = TEST_TYPE_COLORS[test.test_type] || "#1A56DB";
                  const attempt = attemptSummary[test.id];
                  const handlePress = () => {
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
                    <Pressable key={test.id} style={styles.testCard} onPress={handlePress}>
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
                      {!course.isEnrolled && !course.is_free ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : attempt ? <Ionicons name="bar-chart" size={18} color={Colors.light.primary} /> : <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />}
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
                      if (!folderMap.has(mat.section_title)) folderMap.set(mat.section_title, []);
                      folderMap.get(mat.section_title)!.push(mat);
                    } else {
                      unfolderedMaterials.push(mat);
                    }
                  }
                  // Also include empty DB folders
                  for (const f of courseFolders.filter((f: any) => f.type === "material")) {
                    if (!folderMap.has(f.name)) folderMap.set(f.name, []);
                  }
                  const folders = Array.from(folderMap.entries());
                  return (
                    <>
                      {folders.map(([folderKey, materials]) => {
                        const folderName = folderKey;
                        const folderColor = "#DC2626";
                        const isLocked = !course.isEnrolled && !course.is_free;
                        return (
                          <Pressable key={folderKey}
                            style={[styles.testSectionCard, { borderLeftColor: folderColor }]}
                            onPress={() => setOpenFolder({ name: folderName, type: "materials", color: folderColor, items: materials })}
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
                        const canAccess = isAdmin || course.isEnrolled || course.is_free;
                        return (
                          <View key={mat.id} style={[styles.testCard, { flexDirection: "row", alignItems: "center" }]}>
                            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center" }}
                              onPress={() => { if (!canAccess) return; router.push(`/material/${mat.id}`); }}>
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
            {liveClasses.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No live classes scheduled</Text>
                <Text style={styles.emptySubText}>Check back soon for upcoming live sessions</Text>
              </View>
            ) : (
              (() => {
                // Group by section_title
                const folderMap = new Map<string, LiveClass[]>();
                for (const lc of liveClasses) {
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
                          onPress={() => setOpenFolder({ name: folderName!, type: "live", color: "#DC2626", items: classes })}
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
                          onPress={() => router.push({ pathname: "/live-class/[id]", params: { id: lc.id, videoUrl: lc.youtube_url, title: lc.title } })}
                        >
                          <LinearGradient
                            colors={lc.is_live ? ["#DC2626", "#EF4444"] : lc.is_completed ? ["#1A56DB", "#3B82F6"] : ["#6B7280", "#9CA3AF"]}
                            style={styles.liveStatusBadge}
                          >
                            {lc.is_live ? (
                              <><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>
                            ) : lc.is_completed ? (
                              <Ionicons name="play" size={14} color="#fff" />
                            ) : (
                              <Ionicons name="time" size={14} color="#fff" />
                            )}
                          </LinearGradient>
                          <View style={styles.liveClassInfo}>
                            <Text style={styles.liveClassTitle}>{lc.title}</Text>
                            {lc.description ? <Text style={styles.liveClassDesc} numberOfLines={1}>{lc.description}</Text> : null}
                            <Text style={styles.liveClassTime}>
                              {lc.is_live ? "Happening now" : lc.is_completed ? "Recording available" : new Date(Number(lc.scheduled_at)).toLocaleString()}
                            </Text>
                            {lc.is_completed && lc.duration_minutes && lc.duration_minutes > 0 && (
                              <View style={styles.lectureMetaRow}>
                                <Ionicons name="time-outline" size={12} color={Colors.light.textMuted} />
                                <Text style={styles.lectureMeta}>{lc.duration_minutes}min</Text>
                              </View>
                            )}
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
            {enrolledStudents.length === 0 ? (
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

      {!course.isEnrolled && !enrollSuccess && (
        <View style={[styles.enrollBar, { paddingBottom: bottomPadding + 12 }]}>
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
              {enrollMutation.isPending ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.enrollBtnText}>
                  {course.is_free ? "Enroll for Free" : "Buy Now"}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}

      {paymentWebViewHtml && Platform.OS !== "web" && (
        <Modal visible animationType="slide" onRequestClose={() => setPaymentWebViewHtml(null)}>
          <View style={{ flex: 1, backgroundColor: "#0A1628" }}>
            <View style={{ flexDirection: "row", alignItems: "center", paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: "#0A1628" }}>
              <Pressable onPress={() => setPaymentWebViewHtml(null)} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="close" size={22} color="#fff" />
              </Pressable>
              <Text style={{ flex: 1, textAlign: "center", fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff", marginRight: 36 }}>Payment</Text>
            </View>
            <WebView
              source={{ html: paymentWebViewHtml, baseUrl: "https://api.razorpay.com" }}
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
                    await apiRequest("POST", "/api/payments/verify", {
                      razorpay_order_id: data.razorpay_order_id,
                      razorpay_payment_id: data.razorpay_payment_id,
                      razorpay_signature: data.razorpay_signature,
                      courseId: parseInt(id as string),
                    });
                    qc.invalidateQueries({ queryKey: ["/api/courses", id] });
                    qc.invalidateQueries({ queryKey: ["/api/courses"] });
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert("Success!", "Payment successful! You are now enrolled.");
                  } else if (data.type === "payment_dismissed") {
                    setPaymentWebViewHtml(null);
                  } else if (data.type === "payment_failed") {
                    setPaymentWebViewHtml(null);
                    Alert.alert("Payment Failed", data.error || "Payment could not be completed.");
                  }
                } catch (_e) {}
              }}
            />
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

      {/* Folder Content Modal */}
      <Modal visible={!!openFolder} animationType="slide" onRequestClose={() => setOpenFolder(null)}>
        <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
          {/* Header */}
          <LinearGradient colors={["#0A1628", "#1A2E50"]} style={{ paddingTop: topPadding + 8, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => setOpenFolder(null)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={1}>{openFolder?.name}</Text>
              <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>{openFolder?.items.length} {openFolder?.type === "lectures" ? "videos" : openFolder?.type === "materials" ? "files" : openFolder?.type === "tests" ? "tests" : "classes"}</Text>
            </View>
            {course && !course.isEnrolled && !course.is_free && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(239,68,68,0.2)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                <Ionicons name="lock-closed" size={14} color="#FCA5A5" />
                <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FCA5A5" }}>Locked</Text>
              </View>
            )}
          </LinearGradient>
          {/* Lock banner for non-enrolled */}
          {course && !course.isEnrolled && !course.is_free && (
            <View style={{ backgroundColor: "#FEF3C7", flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: "#FDE68A" }}>
              <Ionicons name="lock-closed" size={18} color="#D97706" />
              <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E" }}>
                Enroll in this course to access all content
              </Text>
            </View>
          )}
          {/* Content */}
          <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding + 20 }}>
            {openFolder?.type === "lectures" && openFolder.items.map((lecture: any, idx: number) => {
              const isLocked = course && !course.isEnrolled && !course.is_free && !lecture.is_free_preview;
              return (
                <View key={lecture.id} style={styles.lectureItem}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => {
                    if (isLocked) { Alert.alert("Locked", "Enroll in this course to watch this lecture."); return; }
                    setOpenFolder(null); handleLecture(lecture);
                  }}>
                    <View style={[styles.lectureNumber, lecture.isCompleted && styles.lectureNumberDone]}>
                      {lecture.isCompleted ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text style={styles.lectureNumberText}>{idx + 1}</Text>}
                    </View>
                    <View style={styles.lectureInfo}>
                      <Text style={styles.lectureTitle}>{lecture.title}</Text>
                      <View style={styles.lectureMetaRow}>
                        <Ionicons name="time-outline" size={12} color={Colors.light.textMuted} />
                        <Text style={styles.lectureMeta}>{lecture.duration_minutes > 0 ? `${lecture.duration_minutes}min` : "—"}</Text>
                        {lecture.is_free_preview && <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Preview</Text></View>}
                      </View>
                    </View>
                    {isLocked ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : <Ionicons name="play-circle" size={22} color={openFolder.color} />}
                  </Pressable>
                  <DownloadButton
                    itemType="lecture"
                    itemId={lecture.id}
                    downloadAllowed={lecture.download_allowed || false}
                    isEnrolled={course.isEnrolled}
                  />
                </View>
              );
            })}
            {openFolder?.type === "materials" && openFolder.items.map((mat: any) => {
              const canAccess = isAdmin || (course?.isEnrolled ?? false);
              return (
                <View key={mat.id} style={[styles.materialItem, !canAccess && { opacity: 0.5 }]}>
                  <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
                    onPress={() => { if (!canAccess) { Alert.alert("Locked", "Enroll to access."); return; } setOpenFolder(null); router.push(`/material/${mat.id}`); }}>
                    <View style={styles.materialIcon}><Ionicons name={!canAccess ? "lock-closed" : mat.file_type === "video" ? "videocam" : mat.file_type === "link" ? "link" : "document-text"} size={22} color={!canAccess ? Colors.light.textMuted : "#DC2626"} /></View>
                    <View style={styles.materialInfo}>
                      <Text style={styles.materialTitle}>{mat.title}</Text>
                      {mat.description && <Text style={styles.materialDesc} numberOfLines={1}>{mat.description}</Text>}
                      <Text style={styles.materialType}>{(mat.file_type || "pdf").toUpperCase()}{!mat.download_allowed ? " · View Only" : ""}</Text>
                    </View>
                  </Pressable>
                  <DownloadButton
                    itemType="material"
                    itemId={mat.id}
                    downloadAllowed={mat.download_allowed || false}
                    isEnrolled={course.isEnrolled}
                  />
                </View>
              );
            })}
            {openFolder?.type === "tests" && course && (() => {
              const TEST_SECTIONS = [
                { key: "practice", label: "Practice", icon: "fitness" as const, color: "#1A56DB" },
                { key: "test", label: "Test", icon: "document-text" as const, color: "#059669" },
                { key: "pyq", label: "PYQs", icon: "time" as const, color: "#F59E0B" },
                { key: "mock", label: "Mock", icon: "trophy" as const, color: "#DC2626" },
              ];
              const allItems = openFolder.items;
              const filtered = folderTestTypeFilter === "all" ? allItems : allItems.filter((t: any) => t.test_type === folderTestTypeFilter);
              return (
                <>
                  {/* Filter chips */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", maxHeight: 56 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" }}>
                    <Pressable
                      style={[styles.filterChip, folderTestTypeFilter === "all" && styles.filterChipActive]}
                      onPress={() => setFolderTestTypeFilter("all")}
                    >
                      <Text style={[styles.filterChipText, folderTestTypeFilter === "all" && styles.filterChipTextActive]}>All ({allItems.length})</Text>
                    </Pressable>
                    {TEST_SECTIONS.map((s) => {
                      const count = allItems.filter((t: any) => t.test_type === s.key).length;
                      if (count === 0) return null;
                      return (
                        <Pressable key={s.key}
                          style={[styles.filterChip, folderTestTypeFilter === s.key && styles.filterChipActive, folderTestTypeFilter === s.key && { backgroundColor: s.color, borderColor: s.color }]}
                          onPress={() => setFolderTestTypeFilter(s.key)}
                        >
                          <Ionicons name={s.icon} size={13} color={folderTestTypeFilter === s.key ? "#fff" : s.color} />
                          <Text style={[styles.filterChipText, folderTestTypeFilter === s.key && { color: "#fff" }]}>{s.label} ({count})</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  {filtered.length === 0 ? (
                    <View style={{ paddingVertical: 40, alignItems: "center", gap: 8 }}>
                      <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                      <Text style={{ fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>No tests in this category</Text>
                    </View>
                  ) : (
                    filtered.map((test: any) => renderTestItem(test, course!))
                  )}
                </>
              );
            })()}
            {openFolder?.type === "live" && openFolder.items.map((lc: any) => (              <Pressable key={lc.id} style={({ pressed }) => [styles.liveClassItem, pressed && { opacity: 0.85 }]}
                onPress={() => { setOpenFolder(null); router.push({ pathname: "/live-class/[id]", params: { id: lc.id, videoUrl: lc.youtube_url, title: lc.title } }); }}>
                <LinearGradient colors={lc.is_live ? ["#DC2626", "#EF4444"] : lc.is_completed ? ["#1A56DB", "#3B82F6"] : ["#6B7280", "#9CA3AF"]} style={styles.liveStatusBadge}>
                  {lc.is_live ? (<><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>) : lc.is_completed ? <Ionicons name="play" size={14} color="#fff" /> : <Ionicons name="time" size={14} color="#fff" />}
                </LinearGradient>
                <View style={styles.liveClassInfo}>
                  <Text style={styles.liveClassTitle}>{lc.title}</Text>
                  {lc.description ? <Text style={styles.liveClassDesc} numberOfLines={1}>{lc.description}</Text> : null}
                  <Text style={styles.liveClassTime}>{lc.is_live ? "Happening now" : lc.is_completed ? "Recording available" : new Date(Number(lc.scheduled_at)).toLocaleString()}</Text>
                </View>
                <Ionicons name={lc.is_live || lc.is_completed ? "play-circle" : "calendar"} size={24} color={lc.is_live ? "#DC2626" : lc.is_completed ? Colors.light.primary : Colors.light.textMuted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 8, overflow: "hidden" },
  headerThumbnail: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
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
  courseCategory: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium", textTransform: "uppercase", letterSpacing: 1 },
  courseTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 30, maxWidth: "85%" },
  instructorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  instructorAvatar: { width: 24, height: 24, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  instructorName: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_500Medium" },
  levelChip: { backgroundColor: Colors.light.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  levelChipText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  courseQuickStats: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  quickStat: { flexDirection: "row", alignItems: "center", gap: 5 },
  quickStatText: { fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular" },
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
