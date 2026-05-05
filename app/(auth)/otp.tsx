import React, { useState, useRef, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "@/lib/query-client";
import { getInstallationId } from "@/lib/installation-id";
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { navigateToProfileSetupWithNotice } from "@/lib/profile-completion-ui";
import { navigateBackFromAuth } from "@/lib/navigate-auth-back";

export default function OTPScreen() {
  const insets = useSafeAreaInsets();
  const { phone, smsSent, devOtp } = useLocalSearchParams<{ phone: string; smsSent?: string; devOtp?: string }>();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { login } = useAuth();

  const startResendCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    setCountdown(30);
    setCanResend(false);
    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setCanResend(true);
          if (countdownTimerRef.current) {
            clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    startResendCountdown();
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, []);

  // Show dev OTP box when SMS fails — user taps to fill
  useEffect(() => {
    if (devOtp && devOtp.length === 6) {
      const digits = devOtp.split("");
      setOtp(digits);
      // Don't auto-verify — let user see the OTP and tap Verify manually
    }
  }, [devOtp]);

  const handleOtpChange = (value: string, index: number) => {
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) inputs.current[index + 1]?.focus();
    if (!value && index > 0) inputs.current[index - 1]?.focus();
    if (newOtp.every((d) => d !== "") && newOtp.join("").length === 6) {
      handleVerify(newOtp.join(""));
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === "Backspace" && !otp[index] && index > 0) {
      const newOtp = [...otp];
      newOtp[index - 1] = "";
      setOtp(newOtp);
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (otpValue?: string) => {
    if (isLoading) return;
    const code = otpValue || otp.join("");
    if (code.length !== 6) { Alert.alert("Error", "Enter the 6-digit OTP"); return; }
    setIsLoading(true);
    try {
      const deviceId = await getInstallationId();
      const res = await apiRequest("POST", "/api/auth/verify-otp", {
        identifier: phone,
        type: "phone",
        otp: code,
        deviceId,
      });
      const data = await res.json();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await login(data.user);
      console.log("[OTP] user:", JSON.stringify({ id: data.user.id, role: data.user.role, profileComplete: data.user.profileComplete, name: data.user.name }));
      if (!data.user.profileComplete) {
        console.log("[OTP] → profile-setup");
        navigateToProfileSetupWithNotice();
      } else {
        console.log("[OTP] → tabs");
        router.replace("/(tabs)");
      }
    } catch (err: any) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = err?.message || "";
      if (msg.includes("blocked") || msg.includes("Blocked")) {
        Alert.alert("Account Blocked", "This account is blocked. Contact support/admin.");
      } else if (msg.includes("registered device") || msg.includes("another device")) {
        Alert.alert("Access Restricted", "This account is active on another device/browser. Use the original one or contact support.");
      } else if (msg.includes("429") || msg.includes("Too many")) {
        Alert.alert("Please Wait", "Too many attempts. Please try again after a few minutes.");
      } else {
        Alert.alert("Invalid OTP", "The OTP you entered is incorrect or expired. Please try again.");
      }
      setOtp(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const res = await apiRequest("POST", "/api/auth/send-otp", { identifier: phone, type: "phone" });
      const data = await res.json();
      startResendCountdown();
      setOtp(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
      Alert.alert("OTP Sent", data.smsSent ? "A new OTP has been sent to your phone." : "OTP sent. If SMS is delayed, please wait and try again.");
      if (data.devOtp) {
        const digits = data.devOtp.split("");
        setOtp(digits);
      }
    } catch {
      Alert.alert("Error", "Failed to resend OTP. Check your internet connection.");
    } finally {
      setResending(false);
    }
  };

  const maskedPhone = `+91 ******${phone?.slice(-4)}`;
  const smsWasSent = smsSent === "1";

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
          <Pressable style={styles.backBtn} onPress={navigateBackFromAuth}>
            <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
          </Pressable>

          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed" size={36} color={Colors.light.primary} />
          </View>

          <Text style={styles.title}>Verify OTP</Text>
          <Text style={styles.subtitle}>Enter the 6-digit code sent to{"\n"}{maskedPhone}</Text>

          {!smsWasSent && (
            <View style={styles.smsWarning}>
              <Ionicons name="information-circle" size={16} color={Colors.light.warning} />
              <Text style={styles.smsWarningText}>SMS may be delayed. Please wait or tap Resend below.</Text>
            </View>
          )}

          {!!devOtp && (
            <Pressable
              style={styles.devOtpBox}
              onPress={() => {
                const digits = devOtp.split("");
                setOtp(digits);
              }}
            >
              <Ionicons name="bug-outline" size={16} color="#22C55E" />
              <Text style={styles.devOtpText}>Dev OTP: <Text style={{ fontFamily: "Inter_700Bold", letterSpacing: 4 }}>{devOtp}</Text> (tap to fill)</Text>
            </Pressable>
          )}

          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => { inputs.current[index] = ref; }}
                style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
                value={digit}
                onChangeText={(val) => handleOtpChange(val, index)}
                onKeyPress={(e) => handleKeyPress(e, index)}
                keyboardType="number-pad"
                maxLength={1}
                selectTextOnFocus
                testID={`otp-input-${index}`}
              />
            ))}
          </View>

          <Pressable
            style={({ pressed }) => [styles.verifyBtn, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
            onPress={() => handleVerify()}
            disabled={isLoading}
            testID="verify-btn"
          >
            <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.verifyBtnGradient}>
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.verifyBtnText}>Verify & Login</Text>
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                </>
              )}
            </LinearGradient>
          </Pressable>

          <View style={styles.resendContainer}>
            {canResend ? (
              <Pressable onPress={handleResend} disabled={resending}>
                {resending ? (
                  <ActivityIndicator size="small" color={Colors.light.accent} />
                ) : (
                  <Text style={styles.resendText}>Resend OTP</Text>
                )}
              </Pressable>
            ) : (
              <Text style={styles.countdownText}>Resend in {countdown}s</Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  content: { flex: 1, paddingHorizontal: 24, alignItems: "center", gap: 20 },
  backBtn: { alignSelf: "flex-start" },
  iconContainer: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: Colors.light.secondary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: Colors.light.border,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: Colors.light.text },
  subtitle: { fontSize: 15, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 22 },
  smsWarning: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
  },
  smsWarningText: { color: Colors.light.warning, fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 },
  otpContainer: { flexDirection: "row", gap: 10, marginVertical: 8 },
  otpInput: {
    width: 48, height: 56, borderRadius: 14,
    backgroundColor: Colors.light.card,
    borderWidth: 1.5, borderColor: Colors.light.border,
    textAlign: "center", fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text,
  },
  otpInputFilled: { borderColor: Colors.light.primary, backgroundColor: Colors.light.secondary },
  verifyBtn: { width: "100%", borderRadius: 14, overflow: "hidden" },
  verifyBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  verifyBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  resendContainer: { alignItems: "center" },
  resendText: { color: Colors.light.accent, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  countdownText: { color: Colors.light.textMuted, fontSize: 14, fontFamily: "Inter_400Regular" },
  devOtpBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(34,197,94,0.15)", paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 10, borderWidth: 1, borderColor: "rgba(34,197,94,0.3)",
  },
  devOtpText: { color: "#22C55E", fontFamily: "Inter_500Medium", fontSize: 13 },
});
