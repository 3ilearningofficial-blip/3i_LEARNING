import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { apiRequest } from "@/lib/query-client";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

type LoginMode = "phone" | "email";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<LoginMode>("phone");
  const [identifier, setIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendOTP = async () => {
    if (!identifier.trim()) {
      Alert.alert("Error", mode === "phone" ? "Enter your phone number" : "Enter your email address");
      return;
    }
    if (mode === "phone" && identifier.length !== 10) {
      Alert.alert("Error", "Enter a valid 10-digit phone number");
      return;
    }
    if (mode === "email" && !identifier.includes("@")) {
      Alert.alert("Error", "Enter a valid email address");
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/send-otp", {
        identifier: identifier.trim(),
        type: mode,
      });
      const data = await res.json();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({
        pathname: "/(auth)/otp",
        params: { identifier: identifier.trim(), type: mode, devOtp: data.devOtp },
      });
    } catch (err) {
      Alert.alert("Error", "Failed to send OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#0A1628", "#1A2E50", "#0A1628"]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]} keyboardShouldPersistTaps="handled">
          <View style={styles.logoSection}>
            <View style={styles.logoContainer}>
              <MaterialCommunityIcons name="math-compass" size={40} color="#fff" />
            </View>
            <Text style={styles.appName}>3i Learning</Text>
            <Text style={styles.tagline}>Learn. Practice. Excel.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome Back</Text>
            <Text style={styles.cardSubtitle}>Sign in to continue your learning journey</Text>

            <View style={styles.toggleContainer}>
              <Pressable
                style={[styles.toggleBtn, mode === "phone" && styles.toggleBtnActive]}
                onPress={() => { setMode("phone"); setIdentifier(""); }}
              >
                <Ionicons name="call-outline" size={16} color={mode === "phone" ? "#fff" : Colors.light.textSecondary} />
                <Text style={[styles.toggleText, mode === "phone" && styles.toggleTextActive]}>Phone</Text>
              </Pressable>
              <Pressable
                style={[styles.toggleBtn, mode === "email" && styles.toggleBtnActive]}
                onPress={() => { setMode("email"); setIdentifier(""); }}
              >
                <Ionicons name="mail-outline" size={16} color={mode === "email" ? "#fff" : Colors.light.textSecondary} />
                <Text style={[styles.toggleText, mode === "email" && styles.toggleTextActive]}>Email</Text>
              </Pressable>
            </View>

            <View style={styles.inputContainer}>
              {mode === "phone" ? (
                <>
                  <View style={styles.phonePrefix}>
                    <Text style={styles.phonePrefixText}>+91</Text>
                  </View>
                  <TextInput
                    style={[styles.input, styles.phoneInput]}
                    placeholder="Enter mobile number"
                    placeholderTextColor={Colors.light.textMuted}
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={identifier}
                    onChangeText={setIdentifier}
                    returnKeyType="done"
                    onSubmitEditing={handleSendOTP}
                  />
                </>
              ) : (
                <TextInput
                  style={styles.input}
                  placeholder="Enter email address"
                  placeholderTextColor={Colors.light.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={identifier}
                  onChangeText={setIdentifier}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOTP}
                />
              )}
            </View>

            <Pressable
              style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed, isLoading && styles.sendBtnDisabled]}
              onPress={handleSendOTP}
              disabled={isLoading}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.sendBtnGradient}>
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Text style={styles.sendBtnText}>Send OTP</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </Pressable>

            <Text style={styles.adminHint}>
              Admin login: admin@3ilearning.com
            </Text>
          </View>

          <View style={styles.footer}>
            <Ionicons name="shield-checkmark-outline" size={16} color="rgba(255,255,255,0.5)" />
            <Text style={styles.footerText}>Secure login with OTP verification</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, justifyContent: "center", gap: 32 },
  logoSection: { alignItems: "center", gap: 12 },
  logoContainer: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  appName: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff" },
  tagline: { fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, gap: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text },
  cardSubtitle: { fontSize: 14, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", marginTop: -8 },
  toggleContainer: {
    flexDirection: "row", backgroundColor: Colors.light.background,
    borderRadius: 12, padding: 4,
  },
  toggleBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 10, borderRadius: 10, gap: 6,
  },
  toggleBtnActive: { backgroundColor: Colors.light.primary },
  toggleText: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  toggleTextActive: { color: "#fff" },
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
  },
  phoneInput: { paddingLeft: 14 },
  sendBtn: { borderRadius: 14, overflow: "hidden" },
  sendBtnPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  sendBtnDisabled: { opacity: 0.7 },
  sendBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  sendBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  adminHint: { fontSize: 11, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  footerText: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },
});
