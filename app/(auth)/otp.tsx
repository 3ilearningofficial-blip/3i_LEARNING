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
import { useAuth } from "@/context/AuthContext";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

function generateDeviceId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export default function OTPScreen() {
  const insets = useSafeAreaInsets();
  const { phone, devOtp } = useLocalSearchParams<{ phone: string; devOtp?: string }>();
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const [canResend, setCanResend] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);
  const { login } = useAuth();

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) { setCanResend(true); clearInterval(timer); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  const handleVerify = async (otpValue?: string) => {
    const code = otpValue || otp.join("");
    if (code.length !== 6) { Alert.alert("Error", "Enter the 6-digit OTP"); return; }
    setIsLoading(true);
    try {
      const deviceId = generateDeviceId();
      const res = await apiRequest("POST", "/api/auth/verify-otp", {
        identifier: phone,
        type: "phone",
        otp: code,
        deviceId,
      });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.message || "Verification failed");
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login(data.user);
      router.replace("/(tabs)");
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Invalid OTP", err?.message || "The OTP you entered is incorrect. Please try again.");
      setOtp(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      const res = await apiRequest("POST", "/api/auth/send-otp", { identifier: phone, type: "phone" });
      const data = await res.json();
      if (!data.success) {
        Alert.alert("Error", data.message || "Failed to resend OTP");
        return;
      }
      setCountdown(30);
      setCanResend(false);
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) { setCanResend(true); clearInterval(timer); return 0; }
          return prev - 1;
        });
      }, 1000);
      Alert.alert("OTP Sent", "A new OTP has been sent to your phone.");
    } catch {
      Alert.alert("Error", "Failed to resend OTP. Please try again.");
    }
  };

  const maskedPhone = `+91 ******${phone?.slice(-4)}`;

  return (
    <LinearGradient colors={["#0A1628", "#1A2E50", "#0A1628"]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={[styles.content, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 20, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 }]}>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>

          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed" size={36} color="#fff" />
          </View>

          <Text style={styles.title}>Verify OTP</Text>
          <Text style={styles.subtitle}>Enter the 6-digit code sent to{"\n"}{maskedPhone}</Text>

          {devOtp ? (
            <View style={styles.devOtpContainer}>
              <Ionicons name="information-circle" size={16} color={Colors.light.warning} />
              <Text style={styles.devOtpText}>Dev OTP: {devOtp}</Text>
            </View>
          ) : null}

          <View style={styles.otpContainer}>
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => { inputs.current[index] = ref; }}
                style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
                value={digit}
                onChangeText={(val) => handleOtpChange(val, index)}
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
              <Pressable onPress={handleResend}>
                <Text style={styles.resendText}>Resend OTP</Text>
              </Pressable>
            ) : (
              <Text style={styles.countdownText}>Resend in {countdown}s</Text>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 24, alignItems: "center", gap: 20 },
  backBtn: { alignSelf: "flex-start" },
  iconContainer: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff" },
  subtitle: { fontSize: 15, color: "rgba(255,255,255,0.65)", textAlign: "center", fontFamily: "Inter_400Regular", lineHeight: 22 },
  devOtpContainer: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(245,158,11,0.15)", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  devOtpText: { color: Colors.light.warning, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  otpContainer: { flexDirection: "row", gap: 10, marginVertical: 8 },
  otpInput: {
    width: 48, height: 56, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.2)",
    textAlign: "center", fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff",
  },
  otpInputFilled: { borderColor: Colors.light.primary, backgroundColor: "rgba(26,86,219,0.2)" },
  verifyBtn: { width: "100%", borderRadius: 14, overflow: "hidden" },
  verifyBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  verifyBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  resendContainer: { alignItems: "center" },
  resendText: { color: Colors.light.accent, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  countdownText: { color: "rgba(255,255,255,0.5)", fontSize: 14, fontFamily: "Inter_400Regular" },
});
