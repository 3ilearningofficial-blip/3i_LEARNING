import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";

export default function StaffHomeScreen() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/staff/dashboard"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/dashboard", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 0,
  });

  if (isLoading) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 24 }}>
      <LinearGradient colors={[Colors.light.primary, "#1e40af"]} style={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: 20 }}>
        <Text style={styles.headerTitle}>Teacher Portal</Text>
        <Text style={styles.headerSub}>Dashboard</Text>
      </LinearGradient>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Today's Classes</Text>
        {(data?.todayClasses || []).length === 0 ? (
          <Text style={{ color: colors.textMuted }}>No classes today</Text>
        ) : (
          data.todayClasses.map((lc: any) => (
            <View key={lc.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{lc.title}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{lc.course_title}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Upcoming</Text>
        {(data?.upcomingClasses || []).slice(0, 5).map((lc: any) => (
          <View key={lc.id} style={[styles.card, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{lc.title}</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {lc.scheduled_at ? new Date(Number(lc.scheduled_at)).toLocaleString() : "TBD"}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Assigned Courses</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {(data?.courses || []).map((c: any) => (
            <Pressable key={c.id} style={[styles.courseCard, { backgroundColor: colors.surfaceAlt }]} onPress={() => router.push(`/staff/courses/${c.id}` as any)}>
              <Text style={{ color: colors.text, fontFamily: "Inter_700Bold" }} numberOfLines={2}>{c.title}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
        <View style={styles.quickRow}>
          <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/courses" as any)}>
            <Ionicons name="calendar" size={20} color="#fff" />
            <Text style={styles.quickText}>Schedule</Text>
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/tests" as any)}>
            <Ionicons name="create" size={20} color="#fff" />
            <Text style={styles.quickText}>Add Test</Text>
          </Pressable>
          <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/materials" as any)}>
            <Ionicons name="cloud-upload" size={20} color="#fff" />
            <Text style={styles.quickText}>Material</Text>
          </Pressable>
        </View>
      </View>

      {(data?.pendingRequests || []).length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Pending Requests</Text>
          {data.pendingRequests.map((r: any) => (
            <Text key={r.id} style={{ color: colors.textMuted }}>{r.request_type} — {r.status}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { color: "#fff", fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4, fontFamily: "Inter_400Regular" },
  section: { padding: 16 },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 10 },
  card: { padding: 12, borderRadius: 10, marginBottom: 8 },
  courseCard: { width: Platform.OS === "web" ? 180 : "46%", minHeight: 80, padding: 12, borderRadius: 10 },
  quickRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  quickBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, padding: 12, alignItems: "center", minWidth: 90 },
  quickText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 4 },
});
