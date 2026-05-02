import React from "react";
import {
  View, Text, StyleSheet, Pressable, Image, Platform,
  ScrollView, useWindowDimensions, Linking,
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

const DEFAULT_MY_COURSE_ITEMS = [
  { title: "CDS / AFCAT / NDA", desc: "Complete preparation with structured syllabus, live support, and full-length mocks." },
  { title: "Test Series", desc: "OMR-style tests with analytics, negative marking, and performance tracking." },
];

type MyCourseItem = { title: string; desc: string };
type ExtraSection = { title?: string; body?: string; imageUrl?: string };
type FeatureItem = { icon: string; color: string; title: string; desc: string };

function parseJsonArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw?.trim()) return fallback;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function getFeatures(cfg: Record<string, string>): FeatureItem[] {
  const raw = cfg.welcome_features_json;
  if (!raw?.trim()) return DEFAULT_FEATURES;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_FEATURES;
    return arr.map((x: any, i: number) => ({
      icon: typeof x.icon === "string" ? x.icon : DEFAULT_FEATURES[i % DEFAULT_FEATURES.length].icon,
      color: typeof x.color === "string" ? x.color : DEFAULT_FEATURES[0].color,
      title: String(x.title ?? ""),
      desc: String(x.desc ?? x.description ?? ""),
    })).filter((x) => x.title);
  } catch {
    return DEFAULT_FEATURES;
  }
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 640;
  const isWeb = Platform.OS === "web";
  const { user } = useAuth();

  const { data: cfg = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/site-settings"],
    queryFn: async () => {
      try {
        const res = await authFetch(new URL("/api/site-settings", getApiUrl()).toString());
        if (res.ok) return res.json();
      } catch { /* public */ }
      return {};
    },
    staleTime: 60000,
  });

  const s = (key: string, fallback: string) => (cfg[key] != null && cfg[key] !== "" ? cfg[key] : fallback);
  const on = (key: string) => s(key, "true") === "true";

  const tagline = s("welcome_tagline", s("welcome_headline", "Master Mathematics Under Pankaj Sir Guidance")).replace(/\n/g, " ");
  const navLine = s("welcome_nav_line", "Courses · Live Classes · OMR Tests · Daily Missions · AI Tutor");
  const brandText = s("welcome_brand_text", "3i Learning");
  const logoUrl = s("welcome_logo_url", "").trim();

  const aboutTitle = s("welcome_about_title", "About");
  const aboutBody = s("welcome_about_body", "");
  const aboutImage = s("welcome_about_image_url", "").trim();

  const myCourseTitle = s("welcome_my_course_title", "My Courses");
  const myCourseIntro = s("welcome_my_course_intro", "");
  const myCourseImage = s("welcome_my_course_image_url", "").trim();
  const myCourseItems = parseJsonArray<MyCourseItem>(
    cfg.welcome_my_course_json,
    DEFAULT_MY_COURSE_ITEMS
  );

  const extraSections = parseJsonArray<ExtraSection>(cfg.welcome_extra_sections_json, []);
  const features = getFeatures(cfg);

  const handleLogin = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/email-login" as any);
  };

  const handleSignup = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/login" as any);
  };

  const googlePlayUrl = s("welcome_google_play_url", "https://play.google.com/store/apps/details?id=com.learning.threeI");
  const appStoreUrl = s("welcome_app_store_url", "https://apps.apple.com");

  const handleGooglePlay = () => {
    if (Platform.OS === "web") window.open(googlePlayUrl, "_blank");
    else Linking.openURL(googlePlayUrl).catch(() => {});
  };
  const handleAppStore = () => {
    if (Platform.OS === "web") window.open(appStoreUrl, "_blank");
    else Linking.openURL(appStoreUrl).catch(() => {});
  };

  const handleOpenWebApp = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/email-login" as any);
  };

  const showAbout = on("welcome_show_about") && (!!aboutBody.trim() || !!aboutImage);
  const showMyCourse = on("welcome_show_my_course");
  const showSub = on("welcome_show_subheadline");

  const webHero = isWeb && isWide;

  const logoBlock = (
    <View style={[styles.logoBadge, webHero && styles.logoBadgeWeb]}>
      <View style={styles.logoCircle}>
        {logoUrl ? (
          <Image source={{ uri: logoUrl }} style={styles.logoImg} resizeMode="cover" />
        ) : (
          <Image source={require("@/assets/images/logo.png")} style={styles.logoImg} resizeMode="cover" />
        )}
      </View>
      <Text style={styles.logoLabel}>{brandText}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 },
          isWeb && styles.scrollWeb,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: web wide = logo + tagline row; else stacked */}
        {webHero ? (
          <View style={styles.heroRowWeb}>
            {logoBlock}
            <Text style={styles.taglineWeb} numberOfLines={2}>{tagline}</Text>
          </View>
        ) : (
          <View style={styles.heroCenter}>
            {logoBlock}
            <Text style={styles.headlineMobile}>{tagline}</Text>
          </View>
        )}

        {!!navLine.trim() && on("welcome_show_nav") && (
          <Text style={[styles.navLine, webHero && styles.navLineWeb]} accessibilityRole="text">{navLine}</Text>
        )}

        {showSub ? (
          <Text style={styles.subheadline}>{s("welcome_subheadline", "Courses, live classes, OMR tests, daily missions and AI tutoring — everything to ace your exams.")}</Text>
        ) : null}

        {/* CTAs */}
        <View style={[styles.ctaRow, webHero && styles.ctaRowWeb]}>
          <Pressable style={({ pressed }) => [styles.loginBtn, pressed && { opacity: 0.9 }]} onPress={handleLogin}>
            <LinearGradient colors={["#FF6B35", "#EF4444"]} style={styles.loginGradient}>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.loginText}>{s("welcome_login_btn", "Login — It's Free")}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.signupBtn, pressed && { opacity: 0.9 }]} onPress={handleSignup}>
            <Ionicons name="person-add-outline" size={18} color={Colors.light.primary} />
            <Text style={styles.signupText}>{s("welcome_signup_btn", "Sign Up")}</Text>
          </Pressable>
        </View>

        {/* About */}
        {showAbout && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{aboutTitle}</Text>
            {!!aboutBody.trim() && <Text style={styles.sectionBody}>{aboutBody}</Text>}
            {!!aboutImage && (
              <Image source={{ uri: aboutImage }} style={styles.sectionImage} resizeMode="cover" />
            )}
          </View>
        )}

        {/* My courses */}
        {showMyCourse && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{myCourseTitle}</Text>
            {!!myCourseIntro.trim() && <Text style={styles.sectionIntro}>{myCourseIntro}</Text>}
            {!!myCourseImage && (
              <Image source={{ uri: myCourseImage }} style={styles.sectionImage} resizeMode="cover" />
            )}
            <View style={styles.courseGrid}>
              {myCourseItems.map((c, idx) => (
                <View key={`${c.title}-${idx}`} style={styles.courseCard}>
                  <Text style={styles.courseCardTitle}>{c.title}</Text>
                  <Text style={styles.courseCardDesc}>{c.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Extra CMS sections */}
        {extraSections.map((sec, idx) => {
          if (!sec.title?.trim() && !sec.body?.trim() && !sec.imageUrl?.trim()) return null;
          return (
            <View key={`extra-${idx}`} style={styles.section}>
              {!!sec.title?.trim() && <Text style={styles.sectionTitle}>{sec.title}</Text>}
              {!!sec.body?.trim() && <Text style={styles.sectionBody}>{sec.body}</Text>}
              {!!sec.imageUrl?.trim() && (
                <Image source={{ uri: sec.imageUrl }} style={styles.sectionImage} resizeMode="cover" />
              )}
            </View>
          );
        })}

        {/* Features */}
        {on("welcome_show_features") && (
          <View style={[styles.featuresGrid, isWide && styles.featuresGridWide]}>
            {features.map((f) => (
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
        {isWeb && on("welcome_show_get_app") && (
          <View style={styles.getAppSection}>
            <Text style={styles.getAppTitle}>{s("welcome_get_app_title", "Get the App")}</Text>
            <Text style={styles.getAppSub}>{s("welcome_get_app_subtitle", "Available on Android, iOS, and web.")}</Text>
            <View style={[styles.getAppCards, isWide && styles.getAppCardsWide]}>
              {on("welcome_show_google_play") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_play_title", "Android")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_play_desc", "Get the app from the Google Play Store")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={handleGooglePlay}>
                    <Ionicons name="logo-google-playstore" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>Google Play</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_ios") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_ios_title", "iOS")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_ios_desc", "Download from the Apple App Store")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={handleAppStore}>
                    <Ionicons name="logo-apple" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>App Store</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_web_app") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_web_title", "Web")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_web_desc", "Use the full app in your browser")}</Text>
                  <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={handleOpenWebApp}>
                    <Ionicons name="desktop-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnText}>Open Web App</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_web_download") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_pwa_title", "Install")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_pwa_desc", "Add to home screen as a web app")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={() => {
                    if (Platform.OS === "web" && typeof window !== "undefined") window.open(window.location.origin, "_blank");
                  }}>
                    <Ionicons name="download-outline" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>Install</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  scroll: { paddingHorizontal: 20, gap: 20 },
  scrollWeb: { maxWidth: 960, width: "100%", alignSelf: "center" },
  heroCenter: { alignItems: "center", gap: 14 },
  heroRowWeb: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 20,
    flexWrap: "wrap",
  },
  logoBadge: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: Colors.light.card,
    borderWidth: 1, borderColor: Colors.light.border,
    borderRadius: 50, paddingVertical: 8, paddingHorizontal: 16,
  },
  logoBadgeWeb: { alignSelf: "flex-start" },
  logoCircle: { width: 36, height: 36, borderRadius: 18, overflow: "hidden", backgroundColor: "#fff" },
  logoImg: { width: 36, height: 36 },
  logoLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  taglineWeb: {
    flex: 1,
    flexShrink: 1,
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    lineHeight: 28,
    minWidth: 200,
  },
  headlineMobile: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "center", lineHeight: 32 },
  navLine: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  navLineWeb: { textAlign: "left", marginTop: -4 },
  subheadline: {
    fontSize: 15,
    color: Colors.light.textMuted,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 520,
    alignSelf: "center",
  },
  ctaRow: { flexDirection: "column", gap: 12, width: "100%" },
  ctaRowWeb: { flexDirection: "row", gap: 12, maxWidth: 520, alignSelf: "flex-start" },
  loginBtn: { flex: 1, borderRadius: 14, overflow: "hidden", minWidth: 140 },
  loginGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  loginText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  signupBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    minWidth: 140,
  },
  signupText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  section: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 20,
    gap: 12,
  },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  sectionIntro: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 21 },
  sectionBody: { fontSize: 15, color: Colors.light.textSecondary, lineHeight: 24 },
  sectionImage: { width: "100%", height: 200, borderRadius: 12, backgroundColor: Colors.light.background },
  courseGrid: { gap: 12, marginTop: 4 },
  courseCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 6,
  },
  courseCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  courseCardDesc: { fontSize: 14, color: Colors.light.textMuted, lineHeight: 20 },
  featuresGrid: { gap: 12 },
  featuresGridWide: { flexDirection: "row", flexWrap: "wrap" },
  featureCard: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  featureCardWide: { flex: 1, minWidth: 160 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text },
  featureDesc: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 18 },
  getAppSection: { alignItems: "stretch", gap: 12 },
  getAppTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "left" },
  getAppSub: { fontSize: 14, color: Colors.light.textMuted, textAlign: "left", marginBottom: 4 },
  getAppCards: { width: "100%", gap: 16 },
  getAppCardsWide: { flexDirection: "row", flexWrap: "wrap" },
  getAppCard: {
    width: "100%",
    minWidth: 200,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 20,
    padding: 20,
    alignItems: "stretch",
    gap: 10,
  },
  getAppCardTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text },
  getAppCardDesc: { fontSize: 13, color: Colors.light.textMuted },
  storeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#374151", width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  storeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.light.primary, width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  footerRow: { alignItems: "center", gap: 4, paddingTop: 8 },
  footer: { fontSize: 12, color: Colors.light.textMuted, textAlign: "center" },
});
