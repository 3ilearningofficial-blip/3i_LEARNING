import React from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const SUPPORT_EMAIL = "3ilearningofficial@gmail.com";

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  const openSupportEmail = () => {
    const subject = encodeURIComponent("Account deletion request - 3i Learning");
    const body = encodeURIComponent(
      "Hi 3i Learning Team,\n\nI want to delete my account.\n\nRegistered phone/email:\nReason (optional):\n\n"
    );
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    if (Platform.OS === "web") {
      window.location.href = url;
    } else {
      Linking.openURL(url).catch(() => {});
    }
  };

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
            <Text style={styles.headerTitle}>Delete Account</Text>
            <Text style={styles.headerSub}>3i Learning</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.card}>
          <View style={styles.badgeRow}>
            <View style={styles.badgeIcon}>
              <Ionicons name="person-remove-outline" size={20} color="#B91C1C" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Request or complete account deletion</Text>
              <Text style={styles.cardSub}>For students and app users</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Delete your account from the app</Text>
          <Text style={styles.bodyText}>
            You can delete your 3i Learning account directly from the app after signing in.
          </Text>
          <View style={styles.stepsBox}>
            {[
              "Open the 3i Learning app or website.",
              "Sign in to your student account.",
              "Go to Profile.",
              "Tap Delete Account.",
              "Confirm the deletion prompts.",
            ].map((step, index) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{index + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>What data is deleted</Text>
          <Text style={styles.bodyText}>
            Account deletion removes your profile and app activity associated with your account, including course access records, lecture progress, test attempts, daily mission activity, downloads, support messages, saved device/session records, and related app data.
          </Text>

          <Text style={styles.sectionTitle}>Data we may retain</Text>
          <Text style={styles.bodyText}>
            Some payment, invoice, tax, fraud-prevention, legal, or security records may be retained for the period required by law or legitimate business obligations. These retained records are not used to provide app access after your account is deleted.
          </Text>

          <Text style={styles.sectionTitle}>Need help?</Text>
          <Text style={styles.bodyText}>
            If you cannot access your account or need help deleting it, contact us from your registered phone/email.
          </Text>
          <Pressable style={styles.contactBtn} onPress={openSupportEmail}>
            <Ionicons name="mail-outline" size={18} color="#fff" />
            <Text style={styles.contactBtnText}>Email {SUPPORT_EMAIL}</Text>
          </Pressable>
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
    gap: 14,
  },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 4 },
  badgeIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, marginTop: 8 },
  bodyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textSecondary, lineHeight: 22 },
  stepsBox: { gap: 10, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.light.border },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" },
  stepNumText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  stepText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text },
  contactBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  contactBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
});
