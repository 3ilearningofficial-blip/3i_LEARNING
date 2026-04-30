import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, FlatList, Alert, Modal,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getApiUrl, getBaseUrl, authFetch, apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { WebView } from "react-native-webview";

interface Test {
  id: number;
  title: string;
  description: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  passing_marks: number;
  test_type: string;
  difficulty?: string;
  scheduled_at?: number;
  isLocked?: boolean;
  course_is_free?: boolean;
  course_price?: string;
  course_title?: string;
  course_id?: number;
  price?: number;
}

const TEST_TYPES = ["All", "practice", "test", "pyq", "mock"];
const TEST_TYPE_LABELS: Record<string, string> = {
  All: "All", practice: "Practice", test: "Test", pyq: "PYQs", mock: "Mock",
};
const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", test: "#059669", pyq: "#F59E0B", chapter: "#059669", weekly: "#7C3AED",
};

function ScheduledTestCard({ test, onStart, now }: { test: Test; onStart: () => void; now: number }) {
  const scheduledMs = Number(test.scheduled_at);
  const durationMs = (test.duration_minutes || 60) * 60 * 1000;
  const endMs = scheduledMs + durationMs;

  const diff = scheduledMs - now;
  const isLive = now >= scheduledMs && now < endMs;
  const isOver = now >= endMs;
  const isUpcoming = diff > 0;

  const countdown = (() => {
    if (!isUpcoming) return "";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  })();

  const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;

  if (isOver) return null;

  return (
    <View style={{ backgroundColor: "#F3E8FF", borderRadius: 14, padding: 14, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: "#7C3AED" }}>
      {/* Top row: badges + live badge + calendar icon */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {isLive && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#DC2626", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" }} />
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>LIVE TEST</Text>
            </View>
          )}
          <View style={{ backgroundColor: `${color}18`, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color }}>{TEST_TYPE_LABELS[test.test_type] || test.test_type}</Text>
          </View>
          {test.course_title && (
            <View style={{ backgroundColor: "rgba(124,58,237,0.12)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#7C3AED" }}>{test.course_title}</Text>
            </View>
          )}
          {test.course_is_free !== undefined && (
            <View style={{ backgroundColor: test.course_is_free ? "#DCFCE7" : "#FEF3C7", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: test.course_is_free ? "#16A34A" : "#D97706" }}>
                {test.course_is_free ? "FREE" : `₹${parseFloat(test.course_price || "0").toFixed(0)}`}
              </Text>
            </View>
          )}
        </View>
        <Ionicons name="calendar" size={18} color="#7C3AED" />
      </View>

      {/* Title */}
      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 4 }}>{test.title}</Text>

      {/* Meta: questions + duration */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="help-circle-outline" size={13} color={Colors.light.textMuted} />
          <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{test.total_questions} questions</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="time-outline" size={13} color={Colors.light.textMuted} />
          <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{test.duration_minutes}min</Text>
        </View>
      </View>

      {/* Date */}
      <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 10 }}>
        {new Date(scheduledMs).toLocaleString()}
      </Text>

      {/* Action button */}
      {isLive ? (
        <Pressable
          style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#DC2626", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignSelf: "flex-start" }}
          onPress={onStart}
        >
          <Ionicons name="play-circle" size={16} color="#fff" />
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Start Test</Text>
        </Pressable>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#7C3AED", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" }}>
          <Ionicons name="time" size={14} color="#fff" />
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#fff" }}>Starts in {countdown}</Text>
        </View>
      )}
    </View>
  );
}

function TestCard({ test, attempt, onPress, paymentLoading, now }: { test: Test; attempt?: any; onPress: () => void; paymentLoading?: boolean; now: number }) {
  const color = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
  const hours = Math.floor(test.duration_minutes / 60);
  const mins = test.duration_minutes % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins > 0 ? `${mins}m` : ""}` : `${mins}m`;
  const scheduledMs = test.scheduled_at ? Number(test.scheduled_at) : null;
  const diff = scheduledMs ? scheduledMs - now : 0;
  const isUpcoming = scheduledMs ? diff > 0 : false;
  const isLocked = !!test.isLocked;
  const isPaid = !test.isLocked && (test.price ?? 0) > 0; // standalone paid test
  const countdown = (() => {
    if (!scheduledMs || !isUpcoming) return "";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  })();

  return (
    <Pressable
      style={({ pressed }) => [styles.testCard, (isLocked || isPaid) && styles.testCardLocked, pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] }]}
      onPress={isLocked ? () => {
        if (Platform.OS === "web") {
          window.alert(test.course_title
            ? `This test is part of "${test.course_title}". Purchase the course to access it.`
            : "Purchase required to access this test.");
        } else {
          Alert.alert(
            "Purchase Required",
            test.course_title
              ? `This test is part of "${test.course_title}".\n\nPurchase the course to unlock all tests.`
              : "Purchase required to access this test.",
            [{ text: "OK" }]
          );
        }
      } : onPress}
    >
      <View style={[styles.testTypeBar, { backgroundColor: isLocked ? "#9CA3AF" : color }]} />
      <View style={styles.testCardContent}>
        <View style={styles.testCardHeader}>
          <View style={[styles.testTypeBadge, { backgroundColor: isLocked ? "#F3F4F6" : `${color}18` }]}>
            <Text style={[styles.testTypeBadgeText, { color: isLocked ? "#9CA3AF" : color }]}>{TEST_TYPE_LABELS[test.test_type] || test.test_type}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isLocked && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Ionicons name="lock-closed" size={11} color="#EF4444" />
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#EF4444" }}>
                  {test.course_price ? `₹${parseFloat(test.course_price).toFixed(0)}` : "PAID"}
                </Text>
              </View>
            )}
            {isPaid && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#FEF3C7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Ionicons name="cash-outline" size={11} color="#D97706" />
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#D97706" }}>₹{parseFloat(String(test.price)).toFixed(0)}</Text>
              </View>
            )}
            {!isLocked && !isPaid && (test.price ?? 0) === 0 && !test.course_id && (
              <View style={{ backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>FREE</Text>
              </View>
            )}
            <View style={styles.testDuration}>
              <Ionicons name="time-outline" size={13} color={Colors.light.textMuted} />
              <Text style={styles.testDurationText}>{durationStr}</Text>
            </View>
          </View>
        </View>
        <Text style={[styles.testTitle, isLocked && { color: Colors.light.textSecondary }]}>{test.title}</Text>
        {isLocked && test.course_title && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="book-outline" size={12} color={Colors.light.textMuted} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }} numberOfLines={1}>
              {test.course_title}
            </Text>
          </View>
        )}
        {test.description && !isLocked ? <Text style={styles.testDesc} numberOfLines={2}>{test.description}</Text> : null}
        {scheduledMs && !isLocked && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="calendar-outline" size={13} color={isUpcoming ? "#7C3AED" : Colors.light.textMuted} />
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: isUpcoming ? "#7C3AED" : Colors.light.textMuted }}>
              {isUpcoming ? `Scheduled: ${new Date(scheduledMs).toLocaleString()}` : `Was scheduled: ${new Date(scheduledMs).toLocaleDateString()}`}
            </Text>
          </View>
        )}
        {!isLocked && (
          <View style={styles.testStats}>
            <View style={styles.testStat}>
              <Ionicons name="help-circle-outline" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.testStatText}>{test.total_questions} Questions</Text>
            </View>
            <View style={styles.testStatDot} />
            <View style={styles.testStat}>
              <Ionicons name="trophy-outline" size={14} color={Colors.light.textSecondary} />
              <Text style={styles.testStatText}>{test.total_marks} Marks</Text>
            </View>
            {attempt && (
              <>
                <View style={styles.testStatDot} />
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>
                    {attempt.score}/{attempt.total_marks}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}
        {isLocked ? (
          <Pressable
            style={[styles.startTestBtn, { backgroundColor: "#FEE2E2", borderColor: "#EF4444" }]}
            onPress={() => test.course_id && router.push(`/course/${test.course_id}`)}
          >
            <Ionicons name="lock-closed" size={14} color="#EF4444" />
            <Text style={[styles.startTestBtnText, { color: "#EF4444" }]}>
              {test.course_title ? "Purchase Course" : "Purchase to Unlock"}
            </Text>
          </Pressable>
        ) : isPaid ? (
          <Pressable
            style={[styles.startTestBtn, { backgroundColor: "#FEF3C7", borderColor: "#D97706", opacity: paymentLoading ? 0.75 : 1 }]}
            onPress={() => onPress()}
            disabled={!!paymentLoading}
          >
            {paymentLoading ? (
              <ActivityIndicator size="small" color="#D97706" />
            ) : (
              <>
                <Ionicons name="cash-outline" size={14} color="#D97706" />
                <Text style={[styles.startTestBtnText, { color: "#D97706" }]}>Buy ₹{parseFloat(String(test.price)).toFixed(0)}</Text>
              </>
            )}
          </Pressable>
        ) : isUpcoming ? (
          <Pressable style={[styles.startTestBtn, { backgroundColor: "#F3E8FF", borderColor: "#7C3AED" }]} onPress={undefined}>
            <Ionicons name="time" size={14} color="#7C3AED" />
            <Text style={[styles.startTestBtnText, { color: "#7C3AED" }]}>Starts in {countdown}</Text>
          </Pressable>
        ) : (
          <Pressable style={[styles.startTestBtn, { backgroundColor: attempt ? "#EFF6FF" : `${color}18`, borderColor: attempt ? Colors.light.primary : color }]} onPress={onPress}>
            {attempt ? (
              <>
                <Ionicons name="bar-chart" size={14} color={Colors.light.primary} />
                <Text style={[styles.startTestBtnText, { color: Colors.light.primary }]}>View Result</Text>
              </>
            ) : (
              <>
                <Text style={[styles.startTestBtnText, { color }]}>Start Test</Text>
                <Ionicons name="arrow-forward" size={14} color={color} />
              </>
            )}
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export default function TestSeriesScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState("All");
  const [paymentWebViewHtml, setPaymentWebViewHtml] = useState<string | null>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [payingTestId, setPayingTestId] = useState<number | null>(null);
  const pendingTestIdRef = useRef<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // After Razorpay redirect (iOS / Android web), show result and clean URL
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("payment");
    if (!p) return;
    if (p === "success") {
      Alert.alert("Success!", "Payment successful! You can now attempt this test.");
      qc.invalidateQueries({ queryKey: ["/api/tests"] });
    } else if (p === "failed") {
      Alert.alert("Payment", "We could not complete the payment. Please try again.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    url.searchParams.delete("testId");
    const next = url.pathname + (url.search || "") + url.hash;
    window.history.replaceState({}, document.title, next);
  }, [qc]);

  const clearTestPaymentUi = () => {
    setPaymentPending(false);
    setPayingTestId(null);
    pendingTestIdRef.current = null;
  };

  const handleTestPayment = async (test: Test) => {
    if (!user) { router.push("/(auth)/email-login" as any); return; }
    if (paymentPending) return;
    setPaymentPending(true);
    setPayingTestId(test.id);
    pendingTestIdRef.current = test.id;
    try {
      const orderRes = await apiRequest("POST", "/api/tests/create-order", { testId: test.id });
      const orderData = await orderRes.json();
      if (orderData.alreadyPurchased) {
        clearTestPaymentUi();
        qc.invalidateQueries({ queryKey: ["/api/tests"] });
        return;
      }
      if (Platform.OS === "web") {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
        const useRedirectCheckout = /iPhone|iPad|iPod|Android/i.test(ua);
        const script = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
        if (!script) {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          document.head.appendChild(s);
          await new Promise((resolve) => { s.onload = resolve; });
        }
        const options = {
          key: orderData.keyId, amount: orderData.amount, currency: orderData.currency,
          name: "3i Learning", description: `Purchase: ${orderData.testName}`,
          order_id: orderData.orderId,
          handler: async (response: any) => {
            try {
              await apiRequest("POST", "/api/tests/verify-payment", {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                testId: test.id,
              });
              qc.invalidateQueries({ queryKey: ["/api/tests"] });
              Alert.alert("Success!", "Payment successful! You can now attempt this test.");
            } catch {
              Alert.alert("Error", "Payment received but verification failed. Contact support.");
            } finally {
              clearTestPaymentUi();
            }
          },
          prefill: { contact: user?.phone ? `+91${user.phone}` : "" },
          theme: { color: "#1A56DB" },
          ...(useRedirectCheckout
            ? {
                redirect: true,
                callback_url: `${getBaseUrl()}/api/tests/verify-redirect`,
              }
            : {}),
          modal: {
            ondismiss: () => {
              clearTestPaymentUi();
            },
          },
        };
        const rzp = new (window as any).Razorpay(options);
        if (!useRedirectCheckout) {
          rzp.on("payment.failed", (response: { error?: { description?: string; code?: string } }) => {
            clearTestPaymentUi();
            const err =
              response?.error?.description ||
              response?.error?.code ||
              "Payment could not be completed.";
            Alert.alert("Payment failed", String(err));
          });
        }
        rzp.open();
        return;
      }
      const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://checkout.razorpay.com/v1/checkout.js"></script><style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0A1628;color:#fff;font-family:sans-serif}.spinner{border:3px solid rgba(255,255,255,0.2);border-top:3px solid #1A56DB;border-radius:50%;width:40px;height:40px;animation:spin 0.8s linear infinite;margin:0 auto 16px}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div style="text-align:center"><div class="spinner"></div><p>Opening payment...</p></div><script>setTimeout(function(){var rzp=new Razorpay({key:"${orderData.keyId}",amount:${orderData.amount},currency:"${orderData.currency}",name:"3i Learning",description:"Purchase: ${(orderData.testName || "").replace(/"/g, '\\"')}",order_id:"${orderData.orderId}",handler:function(r){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_success",razorpay_order_id:r.razorpay_order_id,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature}))},prefill:{contact:"${user?.phone ? `+91${user.phone}` : ""}"},theme:{color:"#1A56DB"},modal:{ondismiss:function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_dismissed"}))}}});rzp.on("payment.failed",function(e){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_failed",error:e.error.description}))});rzp.open()},0);</script></body></html>`;
      setPaymentWebViewHtml(html);
      return;
    } catch {
      Alert.alert("Error", "Failed to initiate payment. Please try again.");
      clearTestPaymentUi();
    }
  };

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  const { data: allCourses = [] } = useQuery<any[]>({
    queryKey: ["/api/courses", user?.id ?? "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
    staleTime: 0,
  });

  const myTestSeries = useMemo(
    () => allCourses.filter((c) => c.course_type === "test_series" && c.isEnrolled),
    [allCourses]
  );
  const allTestSeries = useMemo(
    () => allCourses.filter((c: any) => c.course_type === "test_series"),
    [allCourses]
  );

  const { data: tests = [], isLoading } = useQuery<Test[]>({
    queryKey: ["/api/tests", selectedType],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/tests", baseUrl);
      if (selectedType !== "All") url.searchParams.set("type", selectedType);
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
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

  const handleStartTest = (test: Test) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const attempt = attemptSummary[test.id];
    if (attempt) {
      // Already attempted — go to result screen
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

  const scheduledActiveTests = useMemo(
    () =>
      tests.filter((t) => {
        if (!t.scheduled_at) return false;
        const ms = Number(t.scheduled_at);
        const endMs = ms + (t.duration_minutes || 60) * 60 * 1000;
        return now < endMs;
      }),
    [tests, now]
  );

  const regularTests = useMemo(
    () =>
      tests.filter((t) => {
        if (!t.scheduled_at) return true;
        const endMs = Number(t.scheduled_at) + (t.duration_minutes || 60) * 60000;
        return now >= endMs;
      }),
    [tests, now]
  );

  useEffect(() => {
    const baseUrl = getApiUrl();
    allTestSeries.slice(0, 4).forEach((course: any) => {
      qc.prefetchQuery({
        queryKey: ["/api/courses", String(course.id)],
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/courses/${course.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch test-series course failed");
          return res.json();
        },
        staleTime: 30000,
      });
    });
    regularTests.slice(0, 4).forEach((test) => {
      qc.prefetchQuery({
        queryKey: ["/api/tests", test.id],
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/tests/${test.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch test failed");
          return res.json();
        },
        staleTime: 30000,
      });
    });
  }, [allTestSeries, regularTests, qc]);

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <Text style={styles.headerTitle}>Test Series</Text>
        <Text style={styles.headerSub}>Practice, Improve, Excel</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterContent}>
          {TEST_TYPES.map((type) => (
            <Pressable
              key={type}
              style={[styles.filterChip, selectedType === type && styles.filterChipActive]}
              onPress={() => setSelectedType(type)}
            >
              <Text style={[styles.filterText, selectedType === type && styles.filterTextActive]}>
                {TEST_TYPE_LABELS[type] || type}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 80 }]}
      >
        {myTestSeries.length > 0 && (
          <View style={styles.section}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ width: 4, height: 20, backgroundColor: Colors.light.primary, borderRadius: 2 }} />
                <Text style={styles.sectionTitle}>Enrolled Test Series</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 4 }}>
              {myTestSeries.map((course, idx) => {
                const theme = { grad: ["#EEF2FF", "#E0E7FF"] as [string,string], accent: "#4F46E5", light: "#EEF2FF" };
                const totalTests = course.total_tests || 0;
                const progressPct = course.progress || 0;
                return (
                  <Pressable
                    key={course.id}
                    style={[styles.tsCardLarge, { shadowColor: theme.accent, shadowOpacity: 0.15, shadowRadius: 8, elevation: 3 }]}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/course/${course.id}`); }}
                  >
                    <LinearGradient colors={theme.grad} style={styles.tsCardLargeGrad}>
                      {/* Icon + badges row */}
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: theme.accent + "18", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="clipboard-outline" size={20} color={theme.accent} />
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          {course.category ? (
                            <View style={{ backgroundColor: theme.accent + "18", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4 }}>
                              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: theme.accent }}>{course.category}</Text>
                            </View>
                          ) : null}
                          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name="checkmark-circle" size={18} color="#16A34A" />
                          </View>
                        </View>
                      </View>
                      {/* Title */}
                      <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: "#111827", lineHeight: 19 }} numberOfLines={3}>{course.title}</Text>
                      {/* Progress */}
                      <View style={{ height: 5, backgroundColor: theme.accent + "20", borderRadius: 3, overflow: "hidden" }}>
                        <View style={{ height: 5, backgroundColor: theme.accent, borderRadius: 3, width: `${progressPct}%` as any }} />
                      </View>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#6B7280" }}>{progressPct}% complete · {totalTests} tests</Text>
                    </LinearGradient>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        {/* Browse Test Series (all — enrolled shows badge, unenrolled shows price) */}
        {allTestSeries.length > 0 && (
          <View style={[styles.section, { marginTop: myTestSeries.length > 0 ? 20 : 0 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ width: 4, height: 20, backgroundColor: "#F59E0B", borderRadius: 2 }} />
              <Text style={styles.sectionTitle}>Test Series</Text>
            </View>
            <View style={{ gap: 10 }}>
              {allTestSeries.map((course: any) => {
                const discount = course.original_price && parseFloat(course.original_price) > 0
                  ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100) : 0;
                return (
                  <Pressable key={course.id} style={styles.testCard}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/course/${course.id}`); }}>
                    <View style={{ width: 6, backgroundColor: course.isEnrolled ? "#22C55E" : "#F59E0B", borderTopLeftRadius: 16, borderBottomLeftRadius: 16 }} />
                    <View style={{ flex: 1, padding: 14, gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: course.isEnrolled ? "#DCFCE7" : "#F59E0B18", alignItems: "center", justifyContent: "center" }}>
                          <Ionicons name="clipboard-outline" size={22} color={course.isEnrolled ? "#16A34A" : "#F59E0B"} />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }} numberOfLines={2}>{course.title}</Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {course.category && (
                              <View style={{ backgroundColor: "#EEF2FF", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{course.category}</Text>
                              </View>
                            )}
                            {course.isEnrolled ? (
                              <View style={{ backgroundColor: "#DCFCE7", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
                                <Ionicons name="checkmark-circle" size={12} color="#16A34A" />
                                <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>Enrolled</Text>
                              </View>
                            ) : (
                              <>
                                <View style={{ backgroundColor: course.is_free ? "#DCFCE7" : "#FEF3C7", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
                                  <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: course.is_free ? "#16A34A" : "#D97706" }}>
                                    {course.is_free ? "FREE" : `₹${parseFloat(course.price || "0").toFixed(0)}`}
                                  </Text>
                                </View>
                                {discount > 0 && !course.is_free && (
                                  <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: "#EF4444", textDecorationLine: "line-through" }}>₹{parseFloat(course.original_price).toFixed(0)}</Text>
                                )}
                              </>
                            )}
                          </View>
                        </View>
                        <View style={{ alignItems: "center", gap: 2 }}>
                          <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: course.isEnrolled ? "#16A34A" : "#F59E0B" }}>{course.total_tests || 0}</Text>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>Tests</Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}
        <View style={[styles.section, { marginTop: myTestSeries.length > 0 ? 20 : 0 }]}>
          <Text style={styles.sectionTitle}>
            {selectedType === "All" ? "All Tests" : TEST_TYPE_LABELS[selectedType]}
            <Text style={styles.testCount}> ({regularTests.length})</Text>
          </Text>

          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={Colors.light.primary} />
            </View>
          ) : (
            <>
              {/* Scheduled tests (upcoming + currently live) */}
              {scheduledActiveTests.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <View style={{ width: 4, height: 20, backgroundColor: "#7C3AED", borderRadius: 2 }} />
                    <Text style={[styles.sectionTitle, { fontSize: 16 }]}>Scheduled Tests</Text>
                  </View>
                  {scheduledActiveTests.map((test) => (
                    <ScheduledTestCard key={test.id} test={test} now={now} onStart={() => handleStartTest(test)} />
                  ))}
                </View>
              )}
              {/* Regular tests */}
              {regularTests.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="document-text-outline" size={48} color={Colors.light.textMuted} />
                  <Text style={styles.emptyTitle}>No tests available</Text>
                  <Text style={styles.emptySubtitle}>Check back soon for new tests</Text>
                </View>
              ) : (
                regularTests.map((test) => (
                  <TestCard
                    key={test.id}
                    test={test}
                    now={now}
                    attempt={attemptSummary[test.id]}
                    paymentLoading={!!(paymentPending && payingTestId === test.id)}
                    onPress={() => ((test.price ?? 0) > 0 ? handleTestPayment(test) : handleStartTest(test))}
                  />
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Razorpay Payment WebView (mobile only) */}
      {paymentWebViewHtml && Platform.OS !== "web" && (
        <Modal
          visible
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent
          navigationBarTranslucent
          onRequestClose={() => { setPaymentWebViewHtml(null); clearTestPaymentUi(); }}
        >
          <View style={{ flex: 1, backgroundColor: "#0A1628", paddingBottom: Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0) }}>
            <WebView
              source={{ html: paymentWebViewHtml, baseUrl: "https://api.razorpay.com" }}
              style={{ flex: 1 }}
              javaScriptEnabled
              onMessage={async (e) => {
                try {
                  const data = JSON.parse(e.nativeEvent.data);
                  if (data.type === "payment_success") {
                    const testId = pendingTestIdRef.current;
                    setPaymentWebViewHtml(null);
                    try {
                      await apiRequest("POST", "/api/tests/verify-payment", {
                        razorpay_order_id: data.razorpay_order_id,
                        razorpay_payment_id: data.razorpay_payment_id,
                        razorpay_signature: data.razorpay_signature,
                        testId,
                      });
                      qc.invalidateQueries({ queryKey: ["/api/tests"] });
                      Alert.alert("Success!", "Payment successful! You can now attempt this test.");
                    } catch {
                      Alert.alert("Error", "Payment received but verification failed. Contact support.");
                    } finally {
                      clearTestPaymentUi();
                    }
                  } else if (data.type === "payment_dismissed") {
                    setPaymentWebViewHtml(null);
                    clearTestPaymentUi();
                  } else if (data.type === "payment_failed") {
                    setPaymentWebViewHtml(null);
                    clearTestPaymentUi();
                    Alert.alert("Payment Failed", data.error || "Payment could not be processed.");
                  }
                } catch {
                  /* ignore */
                }
              }}
            />
            <Pressable
              onPress={() => { setPaymentWebViewHtml(null); clearTestPaymentUi(); }}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  headerTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginBottom: 12 },
  filterContent: { gap: 8, paddingVertical: 4 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  filterChipActive: { backgroundColor: "#fff", borderColor: "#fff" },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
  filterTextActive: { color: Colors.light.primary },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, gap: 8 },
  section: { gap: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  testCount: { fontFamily: "Inter_400Regular", color: Colors.light.textMuted, fontSize: 16 },
  testCard: {
    backgroundColor: "#fff", borderRadius: 16, overflow: "hidden",
    flexDirection: "row", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 10, elevation: 3,
  },
  testCardLocked: { opacity: 0.85, backgroundColor: "#F9FAFB" },
  testTypeBar: { width: 4 },
  testCardContent: { flex: 1, padding: 14, gap: 8 },
  testCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  testTypeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  testTypeBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  testDuration: { flexDirection: "row", alignItems: "center", gap: 3 },
  testDurationText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  testTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, lineHeight: 21 },
  testDesc: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 },
  testStats: { flexDirection: "row", alignItems: "center", gap: 8 },
  testStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  testStatText: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  testStatDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.light.textMuted },
  startTestBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignSelf: "flex-start" },
  startTestBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  attemptsRow: { gap: 12 },
  attemptCard: { width: 100, alignItems: "center", gap: 6 },
  attemptCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  attemptPct: { fontSize: 15, fontFamily: "Inter_700Bold" },
  attemptTitle: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, textAlign: "center" },
  attemptScore: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  loadingContainer: { paddingVertical: 40, alignItems: "center" },
  emptyState: { alignItems: "center", gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  // My Test Series large cards
  tsCardLarge: { width: "47%", borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4 },
  tsCardLargeGrad: { padding: 14, gap: 10, minHeight: 160 },
  tsCardLargeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  tsCardLargeTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff", lineHeight: 20 },
  tsCardLargeProgress: { height: 4, backgroundColor: "rgba(255,255,255,0.3)", borderRadius: 2, overflow: "hidden", flexDirection: "row" },
  tsCardLargeProgressFill: { height: 4, backgroundColor: "#fff", borderRadius: 2 },
  tsCardLargeCount: { fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.85)" },
  // Legacy small card styles (kept for reference)
  tsCard: { width: 180, flexDirection: "row", gap: 10, padding: 12, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border, alignItems: "flex-start" },
  tsCardIconBg: { width: 40, height: 40, borderRadius: 10, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  tsCardInfo: { flex: 1, gap: 2 },
  tsCardTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text, lineHeight: 16 },
  tsCardCategoryBadge: { backgroundColor: Colors.light.secondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tsCardCategoryText: { fontSize: 10, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  tsCardPriceBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  tsCardPriceText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});
