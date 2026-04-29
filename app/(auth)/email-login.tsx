import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable,
  ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator,
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

export default function EmailLoginScreen() {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    const identifier = email.trim().toLowerCase();
    if (!identifier) { setError("Please enter your phone number or email."); return; }
    if (!password) { setError("Please enter your password."); return; }

    setIsLoading(true);
    try {
      const installationId = await getInstallationId();
      const res = await apiRequest("POST", "/api/auth/email-login", {
        email: identifier,
        password,
        deviceId: installationId,
      });
      const data = await res.json();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      login(data.user);
      // All users including admin must complete profile before accessing the app
      if (!data.user.profileComplete) {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          (window as any).__allowProfileSetupOnce = "1";
        }
        router.replace("/profile-setup");
      } else {
        router.replace("/(tabs)");
      }
    } catch (err: any) {
      const msg = (err?.message || "").replace(/^\d+:\s*/, "");
      if (msg.includes("blocked") || msg.includes("Blocked")) {
        setError("This account is blocked. Contact support/admin.");
      } else if (msg.includes("registered device") || msg.includes("another device")) {
        setError("This account is active on another device/browser. Use the original one or contact support.");
      } else if (msg.includes("not found") || msg.includes("Not found") || msg.includes("404")) {
        setError("Account not found. Please sign up first.");
      } else if (msg.includes("401") || msg.includes("Invalid") || msg.includes("incorrect") || msg.includes("Incorrect")) {
        setError("Incorrect password. Try again or use Phone OTP.");
      } else if (msg.includes("No password")) {
        setError("No password set. Please use Phone OTP to sign in, then set a password in Profile.");
      } else {
        setError(msg || "Login failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#0A1628", "#1A2E50", "#0A1628"]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="mail" size={36} color="#fff" />
          </View>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in with your phone/email and password</Text>

          <View style={styles.card}>
            {/* Phone or Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Phone Number or Email</Text>
              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter phone number or email"
                  placeholderTextColor={Colors.light.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.light.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={Colors.light.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <Pressable onPress={() => setShowPassword(p => !p)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            </View>

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.9 }]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.loginBtnGrad}>
                {isLoading ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={styles.loginBtnText}>Sign In</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => router.replace("/(auth)/login")} style={styles.otpLink}>
              <Text style={styles.otpLinkText}>Sign in with Phone OTP instead</Text>
            </Pressable>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingTop: 4 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>Don't have an account?</Text>
              <Pressable onPress={() => router.replace("/(auth)/login")}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Sign Up</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 20 },
  backBtn: { alignSelf: "flex-start", marginBottom: 8 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
    alignSelf: "center",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.6)", textAlign: "center", fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: Colors.light.background, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.light.border,
    paddingHorizontal: 12, paddingVertical: 13,
  },
  input: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEE2E2", borderRadius: 10, padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626" },
  loginBtn: { borderRadius: 14, overflow: "hidden" },
  loginBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  loginBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  otpLink: { alignItems: "center", paddingVertical: 4 },
  otpLinkText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.primary },
});
