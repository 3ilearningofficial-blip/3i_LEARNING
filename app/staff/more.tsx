import React, { useMemo } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { backToApp } from "@/lib/admin/adminNavigation";
import { useStaffPermissions } from "@/lib/staff/useStaffPermissions";

export default function StaffMoreScreen() {
  const { logout } = useAuth();
  const insets = useSafeAreaInsets();
  const { canAny } = useStaffPermissions();

  const links = useMemo(() => {
    const items: { label: string; href: string; icon: "flame" | "hand-left" }[] = [];
    if (canAny("missions.create", "missions.edit")) {
      items.push({ label: "Daily Missions", href: "/staff/missions", icon: "flame" });
    }
    items.push({ label: "Access Requests", href: "/staff/requests", icon: "hand-left" });
    return items;
  }, [canAny]);

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
      <Pressable onPress={() => router.back()} style={{ marginBottom: 16 }}>
        <Ionicons name="arrow-back" size={24} color={Colors.light.text} />
      </Pressable>
      <Text style={styles.title}>More</Text>
      {links.map((l) => (
        <Pressable key={l.href} style={styles.row} onPress={() => router.push(l.href as any)}>
          <Ionicons name={l.icon} size={22} color={Colors.light.primary} />
          <Text style={styles.rowText}>{l.label}</Text>
          <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
        </Pressable>
      ))}
      <Pressable style={[styles.row, { marginTop: 12 }]} onPress={() => backToApp(router)}>
        <Ionicons name="home-outline" size={22} color={Colors.light.primary} />
        <Text style={styles.rowText}>Back to App</Text>
        <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
      </Pressable>
      <Pressable style={[styles.row, { marginTop: 24 }]} onPress={() => logout()}>
        <Ionicons name="log-out" size={22} color="#dc2626" />
        <Text style={[styles.rowText, { color: "#dc2626" }]}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 22, fontFamily: "Inter_800ExtraBold", marginBottom: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  rowText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 16 },
});
