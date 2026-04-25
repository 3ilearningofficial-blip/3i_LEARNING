import React from "react";
import {
  View, Text, StyleSheet, Pressable, Image, Platform,
  ScrollView, useWindowDimensions, Linking, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";

const DEFAULT_FEATURES = [
  { icon: "videocam", color: "#1A56DB", title: "Video Courses", desc: "Structured courses for NDA, CDS, AFCAT with live & recorded lectures" },
  { icon: "document-text", color: "#EF4444", title: "OMR-Style Tests", desc: "Full-length mock tests with negative marking and instant results" },
  { icon: "flame", color: "#F59E0B", title: "Daily Missions", desc: "Practice daily with XP rewards to build consistency" },
  { icon: "sparkles", color: "#8B5CF6", title: "AI Tutor", desc: "Get instant step-by-step solutions for any doubt" },
  { icon: "radio", color: "#DC2626", title: "Live Classes", desc: "Join live sessions with real-time interaction" },
];

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 640;
  const { user } = useAuth();

  const { data: cfg = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/site-settings"],
    queryFn: async () => {
      try {
        const res = await authFetch(new URL("/api/site-settings", getApiUrl()).toString());
        if (res.ok) return res.json();
      } catch {}
      return {};
    },
    staleTime: 60000,
  });

  const s = (key: string, fallback: string) => cfg[key] || fallback;
  const on = (key: string) => s(key, "true") === "true";

  const handleLogin = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/login" as any);
  };

  const googlePlayUrl = s("welcome_google_play_url", "https://play.google.com/store/apps/details?id=com.learning.threeI");

  const handleGooglePlay = () => {
    if (Platform.OS === "web") window.open(googlePlayUrl, "_blank");
    else Linking.openURL(googlePlayUrl).catch(() => {});
  };

  const handleOpenWebApp = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/login" as any);
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={styles.gradient}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Logo + Brand */}
          <View style={styles.hero}>
            <View style={styles.logoBadge}>
              <View style={styles.logoCircle}>
                <Image source={require("@/assets/images/logo.png")} style={styles.logoImg} resizeMode="cover" />
              </View>
              <Text style={styles.logoLabel}>3i Learning</Text>
            </View>

            <Text style={styles.headline}>{s("welcome_headline", "Master Mathematics\nUnder Pankaj Sir Guidance")}</Text>
            <Text style={styles.subheadline}>{s("welcome_subheadline", "Courses, live classes, OMR tests, daily missions and AI tutoring — everything to ace your exams.")}</Text>

            <View style={styles.ctaRow}>
              <Pressable style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.9 }]} onPress={handleLogin}>
                <LinearGradient colors={["#FF6B35", "#EF4444"]} style={styles.loginGradient}>
                  <Ionicons name="log-in-outline" size={18} color="#fff" />
                  <Text style={styles.loginText}>{s("welcome_login_btn", "Login — It's Free")}</Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>

          {/* Features */}
          {on("welcome_show_features") && (
            <View style={[styles.featuresGrid, isWide && styles.featuresGridWide]}>
              {DEFAULT_FEATURES.map((f) => (
                <View key={f.title} style={[styles.featureCard, isWide && styles.featureCardWide]}>
                  <View style={[styles.featureIcon, { backgroundColor: f.color + "22" }]}>
                    <Ionicons name={f.icon as any} size={22} color={f.color} />
                  </View>
                  <Text style={styles.featureTitle}>{f.title}</Text>
                  <Text style={styles.featureDesc}>{f.desc}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Get the App */}
          {on("welcome_show_get_app") && (
            <View style={styles.getAppSection}>
              <Text style={styles.getAppTitle}>Get the App</Text>
              <Text style={styles.getAppSub}>Available on Android and web</Text>
              <View style={[styles.getAppCards, isWide && styles.getAppCardsWide]}>
                {on("welcome_show_google_play") && (
                  <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                    <Text style={styles.getAppCardTitle}>Download</Text>
                    <Text style={styles.getAppCardDesc}>Get the app from the Google Play Store</Text>
                    <Pressable style={({ pressed }) => [styles.darkBtn, pressed && { opacity: 0.85 }]} onPress={handleGooglePlay}>
                      <Ionicons name="logo-google-playstore" size={18} color="#fff" />
                      <Text style={styles.darkBtnText}>Google Play</Text>
                    </Pressable>
                  </View>
                )}
                {on("welcome_show_web_app") && (
                  <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                    <Text style={styles.getAppCardTitle}>Use on Web</Text>
                    <Text style={styles.getAppCardDesc}>Access directly from your browser</Text>
                    <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={handleOpenWebApp}>
                      <Ionicons name="desktop-outline" size={18} color="#fff" />
                      <Text style={styles.primaryBtnText}>Open Web App</Text>
                    </Pressable>
                  </View>
                )}
                {on("welcome_show_web_download") && (
                  <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                    <Text style={styles.getAppCardTitle}>Download for Web</Text>
                    <Text style={styles.getAppCardDesc}>Install as a web app on your device</Text>
                    <Pressable style={({ pressed }) => [styles.darkBtn, pressed && { opacity: 0.85 }]} onPress={() => {
                      if (Platform.OS === "web" && typeof window !== "undefined") window.open(window.location.origin, "_blank");
                    }}>
                      <Ionicons name="download-outline" size={18} color="#fff" />
                      <Text style={styles.darkBtnText}>Install Web App</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          )}

          <View style={styles.footerRow}>
            <Text style={styles.footer}>{s("welcome_footer", "© 2026 3i Learning. All rights reserved.")}</Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 32 },
  hero: { alignItems: "center", gap: 16 },
  logoBadge: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
    borderRadius: 50, paddingVertical: 8, paddingHorizontal: 16,
  },
  logoCircle: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", backgroundColor: "#fff" },
  logoImg: { width: 36, height: 36 },
  logoLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  headline: { fontSize: 34, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center", lineHeight: 42 },
  subheadline: { fontSize: 15, color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 22, maxWidth: 340 },
  ctaRow: { flexDirection: "row", marginTop: 4, width: "100%" },
  loginBtn: { flex: 1, borderRadius: 14, overflow: "hidden" },
  loginGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  loginText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  featuresGrid: { gap: 12 },
  featuresGridWide: { flexDirection: "row", flexWrap: "wrap" },
  featureCard: {
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", borderRadius: 16, padding: 18, gap: 8,
  },
  featureCardWide: { flex: 1, minWidth: 160 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  featureDesc: { fontSize: 12, color: "rgba(255,255,255,0.55)", lineHeight: 18 },
  getAppSection: { alignItems: "center", gap: 16 },
  getAppTitle: { fontSize: 24, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  getAppSub: { fontSize: 14, color: "rgba(255,255,255,0.55)", textAlign: "center" },
  getAppCards: { width: "100%", gap: 16 },
  getAppCardsWide: { flexDirection: "row" },
  getAppCard: {
    width: "100%", backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20, padding: 24, alignItems: "center", gap: 10,
  },
  getAppCardTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  getAppCardDesc: { fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center" },
  darkBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#374151", width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  darkBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.light.primary, width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  footerRow: { alignItems: "center", gap: 4, paddingTop: 8 },
  footer: { fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" },
});
