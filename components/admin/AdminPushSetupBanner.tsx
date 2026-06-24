import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useSegments } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/AppThemeContext";
import { useAdminPushRegistration } from "@/lib/useAdminPushRegistration";
import Colors from "@/constants/colors";

/**
 * Fixed banner on admin routes prompting web admins to enable browser push (user gesture required).
 */
export default function AdminPushSetupBanner() {
  const { user } = useAuth();
  const segments = useSegments();
  const { colors, isDarkMode } = useAppTheme();
  const isAdminRoute = String(segments[0] || "") === "admin";
  const isAdmin = user?.role === "admin";
  const enabled = isAdminRoute && isAdmin;

  const { webPushStatus, enabling, showBanner, showConnected, enablePush, dismissConnectedBanner } =
    useAdminPushRegistration(enabled);

  if (Platform.OS !== "web" || !enabled) return null;
  if (!showBanner && !showConnected) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {showBanner ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: isDarkMode ? "#1E293B" : "#FFFBEB",
              borderColor: isDarkMode ? "#334155" : "#FDE68A",
            },
          ]}
        >
          <Ionicons name="notifications-outline" size={20} color="#D97706" />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerTitle, { color: colors.text }]}>
              {webPushStatus?.permission !== "granted"
                ? "Browser notifications are off"
                : "Browser push not connected"}
            </Text>
            <Text style={[styles.bannerSub, { color: colors.textSecondary }]}>
              {webPushStatus?.permission !== "granted"
                ? "Allow notifications for this site in browser settings, then tap Enable."
                : "Enable OS alerts for registrations, purchases, and support messages while you teach."}
            </Text>
          </View>
          <Pressable
            onPress={() => void enablePush()}
            disabled={enabling}
            style={[styles.enableBtn, enabling && { opacity: 0.6 }]}
          >
            <Text style={styles.enableBtnText}>{enabling ? "..." : "Enable"}</Text>
          </Pressable>
        </View>
      ) : null}
      {showConnected ? (
        <View
          style={[
            styles.okRow,
            {
              backgroundColor: isDarkMode ? "#052E16" : "#ECFDF5",
              borderColor: isDarkMode ? "#14532D" : "#BBF7D0",
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
          <Text style={[styles.okText, { flex: 1 }]}>Browser push connected</Text>
          <Pressable
            onPress={dismissConnectedBanner}
            hitSlop={8}
            style={styles.closeBtn}
            accessibilityLabel="Dismiss"
          >
            <Ionicons name="close" size={18} color="#16A34A" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    paddingTop: 8,
    ...(Platform.OS === "web" ? { pointerEvents: "box-none" as const } : {}),
  },
  banner: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  bannerSub: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  enableBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  enableBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  okRow: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  okText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#16A34A" },
  closeBtn: { padding: 2 },
});
