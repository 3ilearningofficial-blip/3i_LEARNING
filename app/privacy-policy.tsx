import React from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";

const DEFAULT_PRIVACY_POLICY_TITLE = "Privacy Policy";
const DEFAULT_PRIVACY_POLICY_CONTENT =
  "3i Learning respects your privacy. We collect only the information needed to provide learning services, manage your account, process purchases, improve app performance, and support students. We do not sell your personal information. For any privacy questions, contact us at 3ilearningofficial@gmail.com.";

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const { data: settings = {}, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/site-settings", "privacy-policy"],
    queryFn: async () => {
      const res = await fetch(new URL("/api/site-settings", getApiUrl()).toString());
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const title = (settings.privacy_policy_title || DEFAULT_PRIVACY_POLICY_TITLE).trim() || DEFAULT_PRIVACY_POLICY_TITLE;
  const content = (settings.privacy_policy_content || DEFAULT_PRIVACY_POLICY_CONTENT).trim() || DEFAULT_PRIVACY_POLICY_CONTENT;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable
            style={styles.backBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/welcome");
            }}
          >
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Text style={styles.headerSub}>3i Learning</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={styles.badgeIcon}>
              <Ionicons name="shield-checkmark-outline" size={20} color={Colors.light.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{title}</Text>
              <Text style={styles.cardSub}>Public policy for students and visitors</Text>
            </View>
          </View>

          {isLoading ? (
            <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 32 }} />
          ) : (
            <Text style={styles.policyText}>{content}</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 2 },
  content: { padding: 16 },
  card: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: Platform.OS === "web" ? 28 : 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 18 },
  badgeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  policyText: { fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, lineHeight: 24 },
});
