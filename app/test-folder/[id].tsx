import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  ActivityIndicator, Alert, Modal,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch, apiRequest, getBaseUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";
import { WebView } from "react-native-webview";

export default function TestFolderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = React.useState(false);
  const [paymentWebViewHtml, setPaymentWebViewHtml] = React.useState<string | null>(null);
  const [pendingFolderId, setPendingFolderId] = React.useState<number | null>(null);
  const [payingFolderId, setPayingFolderId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get("payment");
    if (!p) return;
    if (p === "success") {
      Alert.alert("Success!", "Payment successful! You can now access this test folder.");
      qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
      qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
    } else if (p === "failed") {
      Alert.alert("Payment", "We could not complete the payment. Please try again.");
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("payment");
    const next = url.pathname + (url.search || "") + url.hash;
    window.history.replaceState({}, document.title, next);
  }, [id, qc]);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/test-folders", id],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/test-folders/${id}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id,
  });

  const folder = data || {};
  const tests: any[] = folder.tests || [];
  const attempts: Record<number, any> = folder.attempts || {};
  const isPurchased = folder.is_purchased;
  const totalTests = tests.length;
  const completedTests = Object.keys(attempts).length;
  const progressPct = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;

  const handleEnroll = async () => {
    if (!user) { router.push("/(auth)/email-login" as any); return; }
    setEnrolling(true);
    try {
      await apiRequest("POST", `/api/test-folders/${id}/enroll`);
      qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
      qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      const msg = err?.message || "Failed to enroll";
      if (Platform.OS === "web") alert(msg); else Alert.alert("Error", msg);
    }
    setEnrolling(false);
  };

  const clearFolderPaymentUi = () => {
    setPaymentWebViewHtml(null);
    setPendingFolderId(null);
    setPayingFolderId(null);
  };

  const startFolderPayment = async () => {
    if (!user) { router.push("/(auth)/email-login" as any); return; }
    if (payingFolderId) return;
    setPayingFolderId(Number(id));
    try {
      const orderRes = await apiRequest("POST", "/api/test-folders/create-order", { folderId: Number(id) });
      const orderData = await orderRes.json();
      if (orderData.alreadyPurchased) {
        clearFolderPaymentUi();
        qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
        qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
        return;
      }

      if (Platform.OS === "web") {
        const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
        const useRedirectCheckout = /iPhone|iPad|iPod|Android/i.test(ua);
        if (!document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')) {
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
          description: `Purchase: ${orderData.folderName || "Test Folder"}`,
          order_id: orderData.orderId,
          handler: async (response: any) => {
            try {
              await apiRequest("POST", "/api/test-folders/verify-payment", {
                folderId: Number(id),
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              });
              qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
              qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
              Alert.alert("Success!", "Payment successful! You can now attempt tests.");
            } catch {
              Alert.alert("Error", "Payment received but verification failed. Contact support.");
            } finally {
              clearFolderPaymentUi();
            }
          },
          prefill: { contact: user?.phone ? `+91${user.phone}` : "" },
          theme: { color: "#1A56DB" },
          ...(useRedirectCheckout
            ? { redirect: true, callback_url: `${getBaseUrl()}/api/test-folders/verify-redirect` }
            : {}),
          modal: { ondismiss: clearFolderPaymentUi },
        };
        const rzp = new (window as any).Razorpay(options);
        if (!useRedirectCheckout) {
          rzp.on("payment.failed", (response: { error?: { description?: string; code?: string } }) => {
            const err = response?.error?.description || response?.error?.code || "Payment could not be completed.";
            clearFolderPaymentUi();
            Alert.alert("Payment failed", String(err));
          });
        }
        rzp.open();
        return;
      }

      const checkoutHtml = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0A1628;font-family:sans-serif;color:#fff;}
.loading{text-align:center}.spinner{border:3px solid rgba(255,255,255,0.2);border-top:3px solid #1A56DB;border-radius:50%;width:40px;height:40px;animation:spin 0.8s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style>
</head><body>
<div class="loading"><div class="spinner"></div><p>Opening payment...</p></div>
<script>
var options={key:"${orderData.keyId}",amount:${orderData.amount},currency:"${orderData.currency}",name:"3i Learning",
description:"Purchase: ${(orderData.folderName || "Test Folder").replace(/"/g,'\\"')}",order_id:"${orderData.orderId}",
handler:function(r){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_success",razorpay_order_id:r.razorpay_order_id,razorpay_payment_id:r.razorpay_payment_id,razorpay_signature:r.razorpay_signature}))},
prefill:{contact:"${user?.phone ? `+91${user.phone}` : ""}"},theme:{color:"#1A56DB"},
modal:{ondismiss:function(){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_dismissed"}))}}};
setTimeout(function(){var rzp=new Razorpay(options);rzp.on("payment.failed",function(resp){window.ReactNativeWebView.postMessage(JSON.stringify({type:"payment_failed",error:resp.error.description}))});rzp.open()},0);
</script></body></html>`;
      setPendingFolderId(Number(id));
      setPaymentWebViewHtml(checkoutHtml);
    } catch (err: any) {
      const msg = (err?.message || "").replace(/^\d+:\s*/, "").trim();
      Alert.alert("Payment Error", msg || "Failed to start payment. Please try again.");
      clearFolderPaymentUi();
    }
  };

  const handleStartTest = (test: any) => {
    if (!isPurchased) {
      if (folder.is_free) handleEnroll();
      else { if (Platform.OS === "web") alert("Purchase required"); else Alert.alert("Locked", "Purchase this pack to access tests."); }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const attempt = attempts[test.id];
    if (attempt) {
      router.push({ pathname: "/test-result/[id]", params: { id: String(test.id), score: String(attempt.score ?? 0), totalMarks: String(attempt.total_marks ?? 0), attemptId: String(attempt.attempt_id ?? ""), testType: test.test_type ?? "" } } as any);
    } else {
      router.push(`/test/${test.id}`);
    }
  };

  const topPad = Platform.OS === "web" ? 16 : insets.top;

  if (isLoading) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background }}>
      <ActivityIndicator size="large" color={Colors.light.primary} />
    </View>
  );

  const discount = folder.original_price && parseFloat(folder.original_price) > 0
    ? Math.round((1 - parseFloat(folder.price) / parseFloat(folder.original_price)) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      {/* Header */}
      <LinearGradient colors={["#1E1B4B", "#4C1D95"]} style={{ paddingTop: topPad + 12, paddingBottom: 20, paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={2}>{folder.name}</Text>
            {folder.description ? <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }} numberOfLines={2}>{folder.description}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {folder.category && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{folder.category}</Text>
            </View>
          )}
          <View style={{ backgroundColor: folder.is_free ? "#22C55E" : "#F59E0B", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{folder.is_free ? "FREE" : `₹${parseFloat(folder.price || "0").toFixed(0)}`}</Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" }}>{totalTests} tests</Text>
        </View>
        {/* Progress */}
        {isPurchased && totalTests > 0 && (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" }}>{completedTests}/{totalTests} completed</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{progressPct}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 3 }}>
              <View style={{ height: 6, backgroundColor: "#22C55E", borderRadius: 3, width: `${progressPct}%` as any }} />
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 10 }}>
        {tests.map((test: any) => {
          const attempt = attempts[test.id];
          const locked = !isPurchased;
          return (
            <Pressable key={test.id} style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", flexDirection: "row", borderWidth: 1, borderColor: "#E5E7EB", opacity: locked ? 0.7 : 1 }}
              onPress={() => handleStartTest(test)}>
              <View style={{ width: 5, backgroundColor: attempt ? "#22C55E" : locked ? "#9CA3AF" : Colors.light.primary }} />
              <View style={{ flex: 1, padding: 14, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {locked && <Ionicons name="lock-closed" size={14} color="#9CA3AF" />}
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: locked ? Colors.light.textMuted : Colors.light.text }} numberOfLines={2}>{test.title}</Text>
                  {attempt && (
                    <View style={{ backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>{attempt.score}/{attempt.total_marks}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{test.total_questions || 0} Q · {test.duration_minutes}min · {test.total_marks} marks</Text>
                  {test.test_type && (
                    <View style={{ backgroundColor: "#F3F4F6", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted }}>{test.test_type}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })}
        {tests.length === 0 && (
          <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
            <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
            <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No tests in this pack yet</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      {!isPurchased && (
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
          {folder.is_free ? (
            <Pressable onPress={handleEnroll} disabled={enrolling} style={{ backgroundColor: "#22C55E", borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: enrolling ? 0.6 : 1 }}>
              {enrolling ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Enroll for Free</Text>}
            </Pressable>
          ) : (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text }}>₹{parseFloat(folder.price || "0").toFixed(0)}</Text>
                {discount > 0 && (
                  <>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textDecorationLine: "line-through" }}>₹{parseFloat(folder.original_price).toFixed(0)}</Text>
                    <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#EF4444" }}>{discount}% OFF</Text>
                    </View>
                  </>
                )}
              </View>
              <Pressable
                style={{ backgroundColor: "#F59E0B", borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: payingFolderId ? 0.7 : 1 }}
                onPress={startFolderPayment}
                disabled={!!payingFolderId}
              >
                {payingFolderId ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Buy Now</Text>
                )}
              </Pressable>
            </View>
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
          onRequestClose={clearFolderPaymentUi}
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
                    const folderId = pendingFolderId;
                    setPendingFolderId(null);
                    try {
                      await apiRequest("POST", "/api/test-folders/verify-payment", {
                        folderId,
                        razorpay_order_id: data.razorpay_order_id,
                        razorpay_payment_id: data.razorpay_payment_id,
                        razorpay_signature: data.razorpay_signature,
                      });
                      qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
                      qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
                      Alert.alert("Success!", "Payment successful! You can now attempt tests.");
                    } catch {
                      Alert.alert("Error", "Payment received but verification failed. Contact support.");
                    } finally {
                      setPayingFolderId(null);
                    }
                  } else if (data.type === "payment_dismissed") {
                    clearFolderPaymentUi();
                  } else if (data.type === "payment_failed") {
                    clearFolderPaymentUi();
                    Alert.alert("Payment Failed", data.error || "Payment could not be completed.");
                  }
                } catch {
                  /* ignore */
                }
              }}
            />
            <Pressable
              onPress={clearFolderPaymentUi}
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
