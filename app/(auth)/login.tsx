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
  Image,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const sendViaServer = async (phoneNumber: string) => {
    const { apiRequest } = await import("@/lib/query-client");
    const res = await apiRequest("POST", "/api/auth/send-otp", {
      identifier: phoneNumber,
      type: "phone",
    });
    const data = await res.json();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      pathname: "/(auth)/otp",
      params: { phone: phoneNumber, method: "server", devOtp: data.devOtp || "" },
    });
  };

  const handleSendOTP = async () => {
    if (!phone.trim()) {
      Alert.alert("Error", "Enter your phone number");
      return;
    }
    if (phone.length !== 10) {
      Alert.alert("Error", "Enter a valid 10-digit phone number");
      return;
    }

    setIsLoading(true);
    const phoneNumber = phone.trim();

    try {
      if (Platform.OS === "web") {
        try {
          const { auth, RecaptchaVerifier, signInWithPhoneNumber } = await import("@/lib/firebase");

          if ((window as any).recaptchaVerifier) {
            try { (window as any).recaptchaVerifier.clear(); } catch {}
            (window as any).recaptchaVerifier = null;
          }
          const existing = document.getElementById("recaptcha-container");
          if (existing) existing.remove();

          const container = document.createElement("div");
          container.id = "recaptcha-container";
          container.style.position = "fixed";
          container.style.bottom = "10px";
          container.style.left = "50%";
          container.style.transform = "translateX(-50%)";
          container.style.zIndex = "99999";
          document.body.appendChild(container);

          const verifier = new RecaptchaVerifier(auth, container, {
            size: "invisible",
            callback: () => {},
            "expired-callback": () => {
              (window as any).recaptchaVerifier = null;
            },
          });
          (window as any).recaptchaVerifier = verifier;

          const confirmation = await signInWithPhoneNumber(
            auth,
            `+91${phoneNumber}`,
            verifier
          );

          (window as any).__firebaseConfirmation = confirmation;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push({
            pathname: "/(auth)/otp",
            params: { phone: phoneNumber, method: "firebase" },
          });
          return;
        } catch (firebaseErr: any) {
          console.warn("Firebase auth failed, using server OTP:", firebaseErr?.code, firebaseErr?.message);
          (window as any).recaptchaVerifier = null;
          const existing = document.getElementById("recaptcha-container");
          if (existing) existing.remove();

          if (firebaseErr?.code === "auth/too-many-requests") {
            Alert.alert("Too Many Attempts", "Please wait a few minutes and try again.");
            setIsLoading(false);
            return;
          }
          if (firebaseErr?.code === "auth/invalid-phone-number") {
            Alert.alert("Invalid Number", "Please enter a valid phone number.");
            setIsLoading(false);
            return;
          }
        }
      }

      await sendViaServer(phoneNumber);
    } catch (err: any) {
      console.error("Send OTP error:", err);
      Alert.alert("Error", "Failed to send OTP. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <LinearGradient colors={["#0A1628", "#1A2E50", "#0A1628"]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) + 40, paddingBottom: insets.bottom + (Platform.OS === "web" ? 34 : 0) + 20 }]} keyboardShouldPersistTaps="handled" bounces={false}>
          <View style={styles.logoSection}>
            <View style={styles.logoContainer}>
              <Image source={require("@/assets/images/logo.png")} style={styles.logoImage} resizeMode="cover" />
            </View>
            <Text style={styles.appName}>3i Learning</Text>
            <Text style={styles.tagline}>Innovate | Interest | Intellect</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome</Text>
            <Text style={styles.cardSubtitle}>Sign in with your phone number to continue</Text>

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
                onChangeText={setPhone}
                returnKeyType="done"
                onSubmitEditing={handleSendOTP}
              />
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
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.3)",
    overflow: "hidden",
  },
  logoImage: {
    width: 100, height: 100,
  },
  appName: { fontSize: 32, fontFamily: "Inter_700Bold", color: "#fff" },
  tagline: { fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
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
  footerText: { fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },
});
