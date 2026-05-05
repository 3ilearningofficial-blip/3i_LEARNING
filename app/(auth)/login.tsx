import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable,
  ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert, Image,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { apiRequest } from "@/lib/query-client";
import { getInstallationId } from "@/lib/installation-id";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { navigateToProfileSetupWithNotice } from "@/lib/profile-completion-ui";
import { navigateBackFromAuth } from "@/lib/navigate-auth-back";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [devOtp, setDevOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState("");
  const [resendCountdown, setResendCountdown] = useState(0);
  const resendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendCountdown = () => {
    if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    setResendCountdown(60);
    resendTimerRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (resendTimerRef.current) {
            clearInterval(resendTimerRef.current);
            resendTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (resendTimerRef.current) clearInterval(resendTimerRef.current);
    };
  }, []);

  const handleSendOTP = async () => {
    const trimmed = phone.trim();
    setError("");
    if (!trimmed || trimmed.length !== 10 || !/^\d{10}$/.test(trimmed)) {
      setError("Enter a valid 10-digit phone number");
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/send-otp", {
        identifier: trimmed,
        type: "phone",
      });
      const data = await res.json();

      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setOtpSent(true);
      setDevOtp(data.devOtp || "");
      startResendCountdown();
    } catch (err: any) {
      const msg = (err?.message || "").replace(/^\d+:\s*/, "");
      setError(msg || "Could not send OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length < 4) { setError("Enter the OTP sent to your phone"); return; }
    setError("");
    setIsVerifying(true);
    try {
      const deviceId = await getInstallationId();
      const res = await apiRequest("POST", "/api/auth/verify-otp", {
        identifier: phone.trim(),
        type: "phone",
        otp: otp.trim(),
        deviceId,
      });
      const data = await res.json();

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login(data.user);

      if (!data.user.profileComplete) {
        navigateToProfileSetupWithNotice();
      } else {
        router.replace("/(tabs)");
      }
    } catch (err: any) {
      const msg = (err?.message || "").replace(/^\d+:\s*/, "");
      if (msg.includes("blocked") || msg.includes("Blocked")) {
        setError("This account is blocked. Contact support/admin.");
      } else if (msg.includes("registered device") || msg.includes("another device")) {
        setError("This account is active on another device/browser. Use the original one or contact support.");
      } else {
        setError(msg || "Invalid OTP. Please try again.");
      }
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <Pressable style={{ alignSelf: "flex-start", marginBottom: 8 }} onPress={() => navigateBackFromAuth()}>
            <Ionicons name="arrow-back" size={22} color={Colors.light.text} />
          </Pressable>

          <View style={styles.logoSection}>
            <View style={styles.logoContainer}>
              <Image source={require("@/assets/images/logo.png")} style={styles.logoImage} resizeMode="cover" />
            </View>
            <Text style={styles.appName}>3i Learning</Text>
            <Text style={styles.tagline}>Innovate Interest, Inspire Excellence</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{otpSent ? "Verify OTP" : "Welcome"}</Text>
            <Text style={styles.cardSubtitle}>
              {otpSent ? `OTP sent to +91 ${phone}` : "Enter your phone number to continue"}
            </Text>

            {/* Phone input */}
            <View style={styles.inputContainer}>
              <View style={styles.phonePrefix}>
                <Text style={styles.phonePrefixText}>+91</Text>
              </View>
              <TextInput
                style={[styles.input, styles.phoneInput]}
                placeholder="Enter mobile number"
                placeholderTextColor={Colors.light.textMuted}
                keyboardType="phone-pad"
                maxLength={10}
                value={phone}
                onChangeText={(t) => { setPhone(t); if (otpSent) { setOtpSent(false); setOtp(""); } }}
                editable={!otpSent}
                returnKeyType="done"
              />
              {otpSent && (
                <Pressable onPress={() => { setOtpSent(false); setOtp(""); setError(""); }} style={{ paddingHorizontal: 8 }}>
                  <Ionicons name="pencil" size={16} color={Colors.light.primary} />
                </Pressable>
              )}
            </View>

            {/* OTP input — shows after Send OTP */}
            {otpSent && (
              <View style={{ gap: 8 }}>
                <TextInput
                  style={[styles.input, { textAlign: "center", fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: 8, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, paddingVertical: 14, backgroundColor: Colors.light.background }]}
                  placeholder="Enter OTP"
                  placeholderTextColor={Colors.light.textMuted}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={otp}
                  onChangeText={setOtp}
                  autoFocus
                />
                {devOtp ? (
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "#22C55E", textAlign: "center" }}>Dev OTP: {devOtp}</Text>
                ) : null}
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textAlign: "center" }}>
                  {resendCountdown > 0 ? `Resend OTP in ${resendCountdown}s` : "Didn't receive OTP?"}
                </Text>
                <Pressable onPress={handleSendOTP} disabled={isLoading || resendCountdown > 0}>
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: "Inter_500Medium",
                      color: (isLoading || resendCountdown > 0) ? Colors.light.textMuted : Colors.light.primary,
                      textAlign: "center",
                    }}
                  >
                    {isLoading ? "Sending..." : "Resend OTP"}
                  </Text>
                </Pressable>
              </View>
            )}

            {/* Error */}
            {!!error && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", borderRadius: 10, padding: 12 }}>
                <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626" }}>{error}</Text>
              </View>
            )}

            {/* Action button */}
            <Pressable
              style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed, (isLoading || isVerifying) && styles.sendBtnDisabled]}
              onPress={otpSent ? handleVerifyOTP : handleSendOTP}
              disabled={isLoading || isVerifying}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.sendBtnGradient}>
                {(isLoading || isVerifying) ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.sendBtnText}>{otpSent ? "Verify & Continue" : "Send OTP"}</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 4 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Already registered?</Text>
              <Pressable onPress={() => router.replace("/(auth)/email-login" as any)}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Sign In</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color={Colors.light.textMuted} />
            <Text style={styles.footerText}>Secure login with OTP verification</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center", gap: 32 },
  logoSection: { alignItems: "center", gap: 12 },
  logoContainer: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "#fff", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: Colors.light.border, overflow: "hidden",
  },
  logoImage: { width: 100, height: 100 },
  appName: { fontSize: 32, fontFamily: "Inter_700Bold", color: Colors.light.text },
  tagline: { fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text },
  cardSubtitle: { fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", marginTop: -8 },
  inputContainer: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.light.background, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.light.border,
  },
  phonePrefix: {
    paddingHorizontal: 14, paddingVertical: 16,
    borderRightWidth: 1, borderRightColor: Colors.light.border,
  },
  phonePrefixText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  input: {
    flex: 1, paddingHorizontal: 14, paddingVertical: 16,
    fontSize: 16, fontFamily: "Inter_400Regular", color: Colors.light.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  phoneInput: { paddingLeft: 14 },
  sendBtn: { borderRadius: 14, overflow: "hidden" },
  sendBtnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  sendBtnDisabled: { opacity: 0.7 },
  sendBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  sendBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
});
