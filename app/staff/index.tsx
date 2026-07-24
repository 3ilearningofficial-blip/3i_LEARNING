import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import { CourseCard, type CourseHomeCardCourse } from "@/components/course/CourseHomeCards";
import { backToApp } from "@/lib/admin/adminNavigation";
import { useStaffPermissions } from "@/lib/staff/useStaffPermissions";

function assignmentSubjects(course: any): string[] {
  return (course.assignments || [])
    .map((a: any) => a.subject_key)
    .filter((k: string) => k && String(k).trim());
}

export default function StaffHomeScreen() {
  const { colors, isDarkMode } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;
  const cardWidth = isWide ? 360 : Math.min(width - 40, 420);
  const { can, canAny } = useStaffPermissions();
  const canSchedule = can("live.schedule") || can("live.start");
  const canTests = canAny("tests.create", "tests.edit");
  const canMaterials = canAny(
    "materials.course.create",
    "materials.course.edit",
    "materials.free.create",
    "materials.free.edit",
  );

  const { data, isLoading } = useQuery({
    queryKey: ["/api/staff/dashboard"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/staff/dashboard", getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 0,
  });

  const topPadding = Platform.OS === "web" ? 16 : insets.top;

  if (isLoading) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  const courses: CourseHomeCardCourse[] = (data?.courses || []).map((c: any) => ({
    ...c,
    teacher_name: c.teacher_name || user?.name,
  }));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 24 }}>
      <LinearGradient
        colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
        style={{ paddingTop: topPadding + 12, paddingHorizontal: 20, paddingBottom: 22 }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerGreeting}>Hello, {user?.name?.split(" ")[0] || "Teacher"}</Text>
            <Text style={styles.headerSub}>Teacher Dashboard</Text>
          </View>
          {Platform.OS !== "web" ? (
            <Pressable
              onPress={() => backToApp(router)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 12,
                height: 36,
                borderRadius: 18,
                backgroundColor: "rgba(255,255,255,0.18)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.3)",
              }}
            >
              <Ionicons name="arrow-back" size={15} color="#fff" />
              <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" }}>App</Text>
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>

      {courses.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Assigned Courses</Text>
            <Pressable onPress={() => router.push("/staff/courses" as any)}>
              <Text style={styles.seeAll}>See all</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
            {courses.map((item) => (
              <View key={item.id} style={{ width: cardWidth, marginRight: 14 }}>
                <CourseCard
                  course={item}
                  variant="staff"
                  assignmentSubjects={assignmentSubjects(item)}
                  onPress={() => router.push(`/staff/courses/${item.id}` as any)}
                />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

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
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
        <View style={styles.quickRow}>
          {canSchedule ? (
            <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/courses" as any)}>
              <Ionicons name="calendar" size={20} color="#fff" />
              <Text style={styles.quickText}>Schedule</Text>
            </Pressable>
          ) : null}
          {canTests ? (
            <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/tests" as any)}>
              <Ionicons name="create" size={20} color="#fff" />
              <Text style={styles.quickText}>Add Test</Text>
            </Pressable>
          ) : null}
          {canMaterials ? (
            <Pressable style={styles.quickBtn} onPress={() => router.push("/staff/materials" as any)}>
              <Ionicons name="cloud-upload" size={20} color="#fff" />
              <Text style={styles.quickText}>Material</Text>
            </Pressable>
          ) : null}
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
  headerGreeting: { color: "#fff", fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  headerSub: { color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4, fontFamily: "Inter_400Regular" },
  section: { paddingHorizontal: 20, paddingTop: 16 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  seeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  card: { padding: 12, borderRadius: 10, marginBottom: 8 },
  quickRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  quickBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, padding: 12, alignItems: "center", minWidth: 90 },
  quickText: { color: "#fff", fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 4 },
});
