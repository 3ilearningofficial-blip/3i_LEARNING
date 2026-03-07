import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  RefreshControl, Platform, ActivityIndicator, FlatList, Image,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface Course {
  id: number;
  title: string;
  description: string;
  teacher_name: string;
  price: string;
  original_price: string;
  category: string;
  thumbnail?: string;
  is_free: boolean;
  total_lectures: number;
  total_tests: number;
  total_students: number;
  level: string;
  duration_hours: string;
  isEnrolled?: boolean;
  progress?: number;
}

interface StudyMaterial {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  is_free: boolean;
}

interface LiveClass {
  id: number;
  title: string;
  description: string;
  youtube_url: string;
  is_live: boolean;
  scheduled_at: number;
}

const DEFAULT_CATEGORIES = ["All", "NDA", "CDS", "AFCAT"];

const COURSE_COLORS = ["#1A56DB", "#7C3AED", "#DC2626", "#059669", "#D97706", "#0891B2"];

function CourseCard({ course, index }: { course: Course; index: number }) {
  const color = COURSE_COLORS[index % COURSE_COLORS.length];
  const discount = course.original_price && parseFloat(course.original_price) > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.courseCard, pressed && { opacity: 0.92, transform: [{ scale: 0.98 }] }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/course/${course.id}`); }}
    >
      <LinearGradient colors={[color, `${color}CC`]} style={styles.courseCardHeader}>
        <View style={styles.courseCardBadgeRow}>
          {course.is_free ? (
            <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>
          ) : discount > 0 ? (
            <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>
          ) : null}
          {course.isEnrolled ? (
            <View style={styles.enrolledBadge}><Ionicons name="checkmark-circle" size={14} color="#22C55E" /><Text style={styles.enrolledBadgeText}>Enrolled</Text></View>
          ) : null}
        </View>
        <Text style={styles.courseCategory}>{course.category}</Text>
        <View style={styles.courseIconArea}>
          <MaterialCommunityIcons name="math-compass" size={36} color="rgba(255,255,255,0.3)" />
        </View>
      </LinearGradient>
      <View style={styles.courseCardBody}>
        <Text style={styles.courseTitle} numberOfLines={2}>{course.title}</Text>
        <Text style={styles.courseTeacher}>
          <Ionicons name="person" size={12} color={Colors.light.textSecondary} /> {course.teacher_name}
        </Text>
        <View style={styles.courseStats}>
          <View style={styles.courseStat}>
            <Ionicons name="videocam" size={13} color={Colors.light.textMuted} />
            <Text style={styles.courseStatText}>{course.total_lectures} lectures</Text>
          </View>
          <View style={styles.courseStatDot} />
          <View style={styles.courseStat}>
            <Ionicons name="document-text" size={13} color={Colors.light.textMuted} />
            <Text style={styles.courseStatText}>{course.total_tests} tests</Text>
          </View>
          <View style={styles.courseStatDot} />
          <View style={styles.courseStat}>
            <Ionicons name="people" size={13} color={Colors.light.textMuted} />
            <Text style={styles.courseStatText}>{course.total_students}</Text>
          </View>
        </View>
        {course.isEnrolled && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${course.progress || 0}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.progressText}>{course.progress || 0}%</Text>
          </View>
        )}
        <View style={styles.coursePriceRow}>
          {course.is_free ? (
            <Text style={styles.coursePrice}>Free</Text>
          ) : (
            <>
              <Text style={styles.coursePrice}>₹{parseFloat(course.price).toFixed(0)}</Text>
              {parseFloat(course.original_price) > 0 && (
                <Text style={styles.courseOriginalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text>
              )}
            </>
          )}
          <View style={styles.levelBadge}>
            <Text style={styles.levelText}>{course.level}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, isAdmin, logout } = useAuth();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);

  const topPadding = Platform.OS === "web" ? 67 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: allCourses = [], refetch: refetchCourses, isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
    staleTime: 0,
  });

  const dynamicCategories = React.useMemo(() => {
    const courseCategories = [...new Set(allCourses.map((c) => c.category).filter(Boolean))];
    const combined = [...DEFAULT_CATEGORIES];
    courseCategories.forEach((cat) => {
      if (!combined.includes(cat)) combined.push(cat);
    });
    return combined;
  }, [allCourses]);

  const courses = React.useMemo(() => {
    let filtered = allCourses;
    if (selectedCategory && selectedCategory !== "All") filtered = filtered.filter((c) => c.category === selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
    }
    return filtered;
  }, [allCourses, selectedCategory, search]);

  const { data: freeMaterials = [] } = useQuery<StudyMaterial[]>({
    queryKey: ["/api/study-materials", "free"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/study-materials", baseUrl);
      url.searchParams.set("free", "true");
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const { data: liveClasses = [] } = useQuery<LiveClass[]>({
    queryKey: ["/api/live-classes"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/live-classes", baseUrl);
      const res = await fetch(url.toString(), { credentials: "include" });
      return res.json();
    },
  });

  const myCourses = courses.filter((c) => c.isEnrolled);
  const freeCourses = courses.filter((c) => c.is_free && !c.isEnrolled);
  const allOtherCourses = courses.filter((c) => !c.isEnrolled && !c.is_free);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchCourses();
    setRefreshing(false);
  }, []);

  const liveClass = liveClasses.find((lc) => lc.is_live);

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <View style={styles.headerTop}>
          <View style={styles.headerLeft}>
            <View style={styles.headerLogo}>
              <Image source={require("@/assets/images/logo.png")} style={styles.headerLogoImage} resizeMode="contain" />
            </View>
            <View>
              <Text style={styles.greeting}>Hello, {user?.name?.split(" ")[0] || "Student"}</Text>
              <Text style={styles.subGreeting}>Ready to learn today?</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {isAdmin && (
              <Pressable style={styles.adminBtn} onPress={() => router.push("/admin")}>
                <Ionicons name="settings" size={20} color="#fff" />
              </Pressable>
            )}
            <Pressable style={styles.notifBtn} onPress={() => {}}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={20} color={Colors.light.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search courses, topics..."
            placeholderTextColor={Colors.light.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={20} color={Colors.light.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPadding + 80 }]}
      >
        {liveClass && (
          <Pressable style={styles.liveClassBanner} onPress={() => router.push(`/lecture/${liveClass.id}`)}>
            <LinearGradient colors={["#DC2626", "#EF4444"]} style={styles.liveClassGradient}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE NOW</Text>
              <Text style={styles.liveTitle} numberOfLines={1}>{liveClass.title}</Text>
              <Ionicons name="chevron-forward" size={18} color="#fff" />
            </LinearGradient>
          </Pressable>
        )}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll} contentContainerStyle={styles.categoryContent}>
          {dynamicCategories.map((cat) => (
            <Pressable key={cat} style={[styles.categoryChip, selectedCategory === cat && styles.categoryChipActive]} onPress={() => setSelectedCategory(cat)}>
              <Text style={[styles.categoryChipText, selectedCategory === cat && styles.categoryChipTextActive]}>{cat}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={styles.loadingText}>Loading courses...</Text>
          </View>
        ) : (
          <>
            {freeMaterials.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Free Study Material</Text>
                  <Ionicons name="book-outline" size={18} color={Colors.light.primary} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.materialsList}>
                  {freeMaterials.map((mat) => (
                    <Pressable key={mat.id} style={styles.materialCard} onPress={() => {}}>
                      <View style={styles.materialIconBg}>
                        <Ionicons name="document-text" size={22} color={Colors.light.primary} />
                      </View>
                      <View style={styles.materialInfo}>
                        <Text style={styles.materialTitle} numberOfLines={2}>{mat.title}</Text>
                        <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {myCourses.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>My Courses</Text>
                  <Text style={styles.seeAll}>See All</Text>
                </View>
                <FlatList
                  data={myCourses}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(c) => c.id.toString()}
                  renderItem={({ item, index }) => (
                    <View style={{ width: 280, marginRight: 14 }}>
                      <CourseCard course={item} index={index} />
                    </View>
                  )}
                  contentContainerStyle={{ paddingHorizontal: 20 }}
                  scrollEnabled={myCourses.length > 1}
                />
              </View>
            )}

            {freeCourses.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Free Courses</Text>
                  <Ionicons name="gift-outline" size={18} color={Colors.light.success} />
                </View>
                {freeCourses.map((course, index) => (
                  <CourseCard key={course.id} course={course} index={index + 2} />
                ))}
              </View>
            )}

            {allOtherCourses.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>All Courses</Text>
                </View>
                {allOtherCourses.map((course, index) => (
                  <CourseCard key={course.id} course={course} index={index} />
                ))}
              </View>
            )}

            {courses.length === 0 && !isLoading && (
              <View style={styles.emptyState}>
                <Ionicons name="search" size={48} color={Colors.light.textMuted} />
                <Text style={styles.emptyTitle}>No courses found</Text>
                <Text style={styles.emptySubtitle}>Try a different search or category</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerLogo: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  },
  headerLogoImage: { width: 36, height: 36 },
  greeting: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  subGreeting: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  adminBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: Colors.light.accent, alignItems: "center", justifyContent: "center",
  },
  notifBtn: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text },
  scrollView: { flex: 1 },
  scrollContent: { gap: 8 },
  liveClassBanner: { marginHorizontal: 20, marginTop: 16, borderRadius: 14, overflow: "hidden" },
  liveClassGradient: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  liveTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", color: "#fff" },
  categoryScroll: { marginTop: 8 },
  categoryContent: { paddingHorizontal: 20, gap: 8, paddingVertical: 4 },
  categoryChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#fff", borderWidth: 1, borderColor: Colors.light.border,
  },
  categoryChipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  categoryChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  categoryChipTextActive: { color: "#fff" },
  section: { paddingHorizontal: 20, gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  seeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  courseCard: {
    backgroundColor: "#fff", borderRadius: 20, overflow: "hidden",
    marginBottom: 4, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  courseCardHeader: { height: 90, padding: 14, justifyContent: "space-between" },
  courseCardBadgeRow: { flexDirection: "row", gap: 8 },
  freeBadge: { backgroundColor: "#22C55E", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  freeBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  discountBadge: { backgroundColor: Colors.light.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  discountBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  enrolledBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  enrolledBadgeText: { color: "#22C55E", fontSize: 10, fontFamily: "Inter_600SemiBold" },
  courseCategory: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "Inter_500Medium" },
  courseIconArea: { position: "absolute", right: 12, bottom: 8 },
  courseCardBody: { padding: 14, gap: 6 },
  courseTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, lineHeight: 20 },
  courseTeacher: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular" },
  courseStats: { flexDirection: "row", alignItems: "center", gap: 6 },
  courseStat: { flexDirection: "row", alignItems: "center", gap: 3 },
  courseStatText: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  courseStatDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.light.textMuted },
  progressContainer: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressBar: { flex: 1, height: 4, backgroundColor: Colors.light.background, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.textSecondary, width: 28 },
  coursePriceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  coursePrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  courseOriginalPrice: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textDecorationLine: "line-through", marginLeft: 4 },
  levelBadge: { backgroundColor: Colors.light.secondary, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  levelText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 60 },
  loadingText: { color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 60 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySubtitle: { fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  materialsList: { gap: 12, paddingVertical: 4 },
  materialCard: {
    width: 180, flexDirection: "row", gap: 10, padding: 12,
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: Colors.light.border,
    alignItems: "flex-start",
  },
  materialIconBg: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center",
  },
  materialInfo: { flex: 1, gap: 6 },
  materialTitle: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  freePill: { backgroundColor: "#DCFCE7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  freePillText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#15803D" },
});
