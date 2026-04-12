import React from "react";
import { View, Text, StyleSheet, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Colors from "@/constants/colors";

const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.threelearning.app";

export default function AndroidWebGate() {
  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={styles.gradient}>
        <View style={styles.iconWrap}>
          <Ionicons name="phone-portrait-outline" size={56} color="#fff" />
        </View>
        <Text style={styles.title}>Use Our App for Best Experience</Text>
        <Text style={styles.subtitle}>
          For security and the best learning experience, this content is only available in the 3i Learning app.
        </Text>
        <Pressable
          style={styles.downloadBtn}
          onPress={() => {
            if (Platform.OS === "web") window.open(PLAY_STORE_URL, "_blank");
            else Linking.openURL(PLAY_STORE_URL).catch(() => {});
          }}
        >
          <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.downloadBtnGrad}>
            <Ionicons name="logo-google-playstore" size={22} color="#fff" />
            <Text style={styles.downloadBtnText}>Download from Google Play</Text>
          </LinearGradient>
        </Pressable>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color="rgba(255,255,255,0.7)" />
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  gradient: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 20 },
  iconWrap: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 22 },
  downloadBtn: { borderRadius: 14, overflow: "hidden", width: "100%", marginTop: 8 },
  downloadBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 10 },
  downloadBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12 },
  backBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" },
});
