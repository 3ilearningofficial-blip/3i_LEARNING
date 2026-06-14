import React, { useCallback, useState } from "react";
import { Alert, Modal, Platform, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import { invalidateAccessCaches } from "@/lib/invalidate-access-caches";
import { apiRequest, getBaseUrl } from "@/lib/query-client";

type UseCoursePurchaseOptions = {
  courseId: number;
  courseTitle?: string;
  isFree?: boolean;
  price?: string | number | null;
};

export function useCoursePurchase({ courseId, courseTitle, isFree, price }: UseCoursePurchaseOptions) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [paymentWebViewHtml, setPaymentWebViewHtml] = useState<string | null>(null);
  const [isPaymentPending, setIsPaymentPending] = useState(false);

  const enrollMutation = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(courseId)) throw new Error("Invalid course id");
      const res = await apiRequest("POST", `/api/courses/${courseId}/enroll`, { userId: user?.id });
      return res.json();
    },
    onSuccess: () => {
      qc.setQueryData(["/api/courses", String(courseId)], (old: any) => (old ? { ...old, isEnrolled: true, progress: 0 } : old));
      qc.setQueriesData({ queryKey: ["/api/courses"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((c: any) => (c.id === courseId ? { ...c, isEnrolled: true, progress: 0 } : c));
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Enrolled!", "You have successfully enrolled in this course.");
      setTimeout(() => invalidateAccessCaches(qc, { userId: user?.id, courseId }), 2000);
    },
    onError: (err: any) => {
      const msg = String(err?.message || "").replace(/^\d+: /, "");
      Alert.alert("Error", msg || "Failed to enroll. Please try again.");
    },
  });

  const handleRazorpayPayment = useCallback(async () => {
    if (isPaymentPending) return;
    if (!Number.isFinite(courseId)) {
      Alert.alert("Error", "Invalid course. Please reopen this page.");
      return;
    }
    setIsPaymentPending(true);
    try {
      const orderRes = await apiRequest("POST", "/api/payments/create-order", { courseId });
      const orderData = await orderRes.json();

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
                courseId,
              });
              invalidateAccessCaches(qc, { userId: user?.id, courseId });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert("Success!", "Payment successful! You are now enrolled.");
            } catch {
              Alert.alert("Error", "Payment was received but enrollment failed. Please contact support.");
            } finally {
              setIsPaymentPending(false);
            }
          },
          prefill: { contact: user?.phone ? `+91${user.phone}` : "" },
          theme: { color: "#1A56DB" },
          ...(useRedirectCheckout
            ? { redirect: true, callback_url: `${getBaseUrl()}/api/payments/verify-redirect` }
            : {}),
          modal: { ondismiss: () => setIsPaymentPending(false) },
        };

        const rzp = new (window as any).Razorpay(options);
        if (!useRedirectCheckout) {
          rzp.on("payment.failed", (response: { error?: { description?: string; code?: string } }) => {
            apiRequest("POST", "/api/payments/track-failure", {
              courseId,
              razorpay_order_id: orderData.orderId,
              reason: response?.error?.description || response?.error?.code || "Payment failed",
              error: response?.error || null,
            }).catch(() => {});
            setIsPaymentPending(false);
            Alert.alert("Payment failed", String(response?.error?.description || response?.error?.code || "Payment could not be completed."));
          });
        }
        rzp.open();
        return;
      }

      const checkoutHtml = `<!DOCTYPE html>
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
  description: "Purchase: ${String(orderData.courseName || courseTitle || "Course").replace(/"/g, '\\"')}",
  order_id: "${orderData.orderId}",
  handler: function(response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: "payment_success",
      razorpay_order_id: response.razorpay_order_id,
      razorpay_payment_id: response.razorpay_payment_id,
      razorpay_signature: response.razorpay_signature
    }));
  },
  prefill: { contact: "${user?.phone ? `+91${user.phone}` : ""}" },
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
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("Already enrolled")) {
        Alert.alert("Already Enrolled", "You are already enrolled in this course.");
        invalidateAccessCaches(qc, { userId: user?.id, courseId });
      } else {
        Alert.alert("Error", "Failed to initiate payment. Please try again.");
      }
      setIsPaymentPending(false);
    }
  }, [courseId, courseTitle, isPaymentPending, qc, user?.id, user?.phone]);

  const purchase = useCallback(() => {
    if (!user) {
      router.push("/(auth)/login");
      return;
    }
    const free = isFree || parseFloat(String(price || "0")) <= 0;
    if (free) {
      enrollMutation.mutate();
      return;
    }
    apiRequest("POST", "/api/payments/track-click", { courseId }).catch(() => {});
    if (Platform.OS === "web") {
      void handleRazorpayPayment();
      return;
    }
    Alert.alert(
      "Purchase Course",
      `Buy "${courseTitle || "this course"}" for ₹${parseFloat(String(price || "0")).toFixed(0)}?\n\nYou will be redirected to secure payment.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Pay Now", onPress: () => { void handleRazorpayPayment(); } },
      ]
    );
  }, [courseId, courseTitle, enrollMutation, handleRazorpayPayment, isFree, price, user]);

  const closePaymentModal = useCallback(() => {
    setPaymentWebViewHtml(null);
    setIsPaymentPending(false);
  }, []);

  const paymentModal = paymentWebViewHtml && Platform.OS !== "web" ? (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closePaymentModal}
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
                    courseId,
                  });
                  invalidateAccessCaches(qc, { userId: user?.id, courseId });
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  Alert.alert("Success!", "Payment successful! You are now enrolled.");
                } catch {
                  Alert.alert("Error", "Payment was received but enrollment failed. Please contact support.");
                } finally {
                  setIsPaymentPending(false);
                }
              } else if (data.type === "payment_dismissed") {
                closePaymentModal();
              } else if (data.type === "payment_failed") {
                apiRequest("POST", "/api/payments/track-failure", {
                  courseId,
                  reason: data.error || "Payment failed",
                  error: data || null,
                }).catch(() => {});
                closePaymentModal();
                Alert.alert("Payment Failed", data.error || "Payment could not be completed.");
              }
            } catch {
              // ignore malformed messages
            }
          }}
        />
        <Pressable
          onPress={closePaymentModal}
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
  ) : null;

  return {
    purchase,
    isPending: isPaymentPending || enrollMutation.isPending,
    paymentModal,
  };
}
