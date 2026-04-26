import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  RefreshControl, Platform, ActivityIndicator, FlatList, Image, useWindowDimensions,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface Course {
  id: number;
  title: string;
  description: string;
  teacher_name: string;
  price: string;
  original_price: string;
  category: string;
  subject?: string;
  thumbnail?: string;
  is_free: boolean;
  total_lectures: number;
  total_tests: number;
  total_students: number;
  total_materials: number;
  level: string;
  duration_hours: string;
  isEnrolled?: boolean;
  progress?: number;
  course_type?: string;
  start_date?: string;
  end_date?: string;
  pyq_count?: number;
  mock_count?: number;
  practice_count?: number;
}

interface StudyMaterial {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_type: string;
  is_free: boolean;
  section_title?: string;
}

interface MaterialFolder {
  id: number;
  name: string;
  type: string;
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

function ScheduledLiveCard({ lc }: { lc: any }) {
  const scheduledMs = Number(lc.scheduled_at);
  const [status, setStatus] = React.useState<"countdown" | "waiting">("countdown");
  const [countdown, setCountdown] = React.useState("");
  React.useEffect(() => {
    const tick = () => {
      const diff = scheduledMs - Date.now();
      if (diff <= 0) {
        setStatus("waiting");
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
      setStatus("countdown");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [scheduledMs]);

  const scheduleDate = new Date(scheduledMs);
  const dateStr = scheduleDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const timeStr = scheduleDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={{ backgroundColor: status === "waiting" ? "#FFFBEB" : "#F8FAFC", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: status === "waiting" ? "#FDE68A" : "#F1F5F9" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: status === "waiting" ? "#FEF3C7" : "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={status === "waiting" ? "hourglass" : "calendar"} size={20} color={status === "waiting" ? "#D97706" : "#DC2626"} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text }} numberOfLines={1}>{lc.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {lc.course_title ? (
              <View style={{ backgroundColor: "#EEF2FF", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 }}>
                <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{lc.course_title}</Text>
              </View>
            ) : null}
            {lc.is_enrolled === false && !lc.course_is_free && !lc.is_public && !lc.is_free_preview && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#F3F4F6", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Ionicons name="lock-closed" size={9} color={Colors.light.textMuted} />
                <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted }}>Enroll to join</Text>
              </View>
            )}
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{dateStr} at {timeStr}</Text>
          </View>
        </View>
        <View style={{ alignItems: "center", gap: 2 }}>
          {status === "waiting" ? (
            <View style={{ backgroundColor: "#FEF3C7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" }}>
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#D97706" }}>Not</Text>
              <Text style={{ fontSize: 9, fontFamily: "Inter_500Medium", color: "#D97706" }}>live yet</Text>
            </View>
          ) : (
            <View style={{ backgroundColor: "#FEE2E2", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignItems: "center" }}>
              <Ionicons name="time-outline" size={11} color="#DC2626" />
              <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626" }}>{countdown}</Text>
            </View>
          )}
        </View>
      </View>
      {status === "waiting" && (
        <View style={{ marginTop: 8, backgroundColor: "#FEF3C7", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#92400E", textAlign: "center" }}>⏳ Waiting for teacher to start...</Text>
        </View>
      )}
    </View>
  );
}

function EnrolledCourseCard({ course, index }: { course: Course; index: number }) {
  const color = COURSE_COLORS[index % COURSE_COLORS.length];
  const progress = course.progress || 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.courseCard, { overflow: "hidden" }, pressed && { opacity: 0.93, transform: [{ scale: 0.98 }] }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(`/course/${course.id}`); }}
    >
      {/* Dark gradient header with category/type/subject badges */}
      <LinearGradient colors={[color, `${color}DD`]} style={{ paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <View style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>{course.category}</Text>
        </View>
        <View style={{ backgroundColor: (course.course_type || "live") === "live" ? "rgba(239,68,68,0.7)" : "rgba(139,92,246,0.7)", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>
            {(course.course_type || "live") === "live" ? "LIVE" : "RECORDED"}
          </Text>
        </View>
        {course.subject ? (
          <View style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 10, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.9)" }}>{course.subject}</Text>
          </View>
        ) : null}
        <View style={{ backgroundColor: "#22C55E", borderRadius: 5, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3 }}>
          <Ionicons name="checkmark-circle" size={10} color="#fff" />
          <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>Enrolled</Text>
        </View>
      </LinearGradient>

      {/* White body */}
      <View style={{ padding: 12, gap: 8, backgroundColor: "#fff" }}>
        {/* Title */}
        <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, lineHeight: 20 }} numberOfLines={2}>{course.title}</Text>

        {/* Teacher */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="person-outline" size={12} color={Colors.light.textMuted} />
          <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }} numberOfLines={1}>{course.teacher_name}</Text>
        </View>

        {/* Stats — compact */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="videocam" size={12} color={color} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>{course.total_lectures} Lectures</Text>
          </View>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: Colors.light.textMuted }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="document-text" size={12} color={color} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>{course.total_tests} Tests</Text>
          </View>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: Colors.light.textMuted }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="folder" size={12} color={color} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>{course.total_materials || 0} Materials</Text>
          </View>
        </View>

        {/* Progress */}
        <View style={{ gap: 4 }}>
          <View style={{ height: 4, backgroundColor: "#F1F5F9", borderRadius: 2, overflow: "hidden" }}>
            <View style={{ height: 4, backgroundColor: color, borderRadius: 2, width: `${progress}%` as any, minWidth: progress > 0 ? 4 : 0 }} />
          </View>
          <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>{progress}% complete</Text>
        </View>
      </View>
    </Pressable>
  );
}

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
          <View style={styles.categoryBadge}><Text style={styles.categoryBadgeText}>{course.category}</Text></View>
          <View style={{ backgroundColor: (course.course_type || "live") === "live" ? "#EF4444" : (course.course_type === "test_series" ? "#F59E0B" : "#8B5CF6"), paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
            <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>
              {(course.course_type || "live") === "live" ? "LIVE" : (course.course_type === "test_series" ? "TEST SERIES" : "RECORDED")}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          {course.is_free ? (
            <View style={styles.freeBadge}><Text style={styles.freeBadgeText}>FREE</Text></View>
          ) : discount > 0 ? (
            <View style={styles.discountBadge}><Text style={styles.discountBadgeText}>{discount}% OFF</Text></View>
          ) : null}
        </View>
        {course.subject ? (
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={styles.courseSubject}>{course.subject}</Text>
            {course.isEnrolled && (
              <View style={styles.enrolledBadge}><Ionicons name="checkmark-circle" size={14} color="#22C55E" /><Text style={styles.enrolledBadgeText}>Enrolled</Text></View>
            )}
          </View>
        ) : course.isEnrolled ? (
          <View style={styles.enrolledBadge}><Ionicons name="checkmark-circle" size={14} color="#22C55E" /><Text style={styles.enrolledBadgeText}>Enrolled</Text></View>
        ) : null}
      </LinearGradient>
      <View style={styles.courseCardBody}>
        <Text style={styles.courseTitle} numberOfLines={2}>{course.title}</Text>
        <Text style={styles.courseTeacher}>
          <Ionicons name="person" size={12} color={Colors.light.textSecondary} /> {course.teacher_name}
        </Text>
        <View style={styles.courseStats}>
          {course.course_type === "test_series" ? (
            <>
              <View style={styles.courseStat}>
                <Ionicons name="document-text" size={13} color={Colors.light.textMuted} />
                <Text style={styles.courseStatText}>{course.total_tests || 0} Tests</Text>
              </View>
              <View style={styles.courseStatDot} />
              <View style={styles.courseStat}>
                <Ionicons name="clipboard" size={13} color={Colors.light.textMuted} />
                <Text style={styles.courseStatText}>{course.mock_count || 0} Mock</Text>
              </View>
              <View style={styles.courseStatDot} />
              <View style={styles.courseStat}>
                <Ionicons name="create" size={13} color={Colors.light.textMuted} />
                <Text style={styles.courseStatText}>{course.practice_count || 0} Practice</Text>
              </View>
            </>
          ) : (
            <>
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
                <Ionicons name="folder" size={13} color={Colors.light.textMuted} />
                <Text style={styles.courseStatText}>{course.total_materials || 0} materials</Text>
              </View>
            </>
          )}
        </View>
        {(course.course_type || "live") === "live" && (course.start_date || course.end_date) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="calendar-outline" size={12} color={Colors.light.textMuted} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>
              {course.start_date || "TBD"} → {course.end_date || "TBD"}
            </Text>
          </View>
        )}
        {course.isEnrolled && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, {
                width: `${course.progress || 0}%` as any,
                backgroundColor: color,
                minWidth: (course.progress || 0) > 0 ? 2 : 0,
              }]} />
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
  const { width: screenWidth } = useWindowDimensions();
  const isWideScreen = screenWidth >= 768;
  const { user, isAdmin, logout } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showAllScheduled, setShowAllScheduled] = useState(false);

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  useEffect(() => {
    if (Platform.OS !== "web" || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement?.closest('[aria-hidden="true"]')) activeElement.blur();
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-hidden"],
    });
    return () => observer.disconnect();
  }, []);

  const { data: allCourses = [], refetch: refetchCourses, isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses", user?.id ?? "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      url.searchParams.set("_t", String(Date.now()));
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30000,
    // Always fetch — even unauthenticated users can see published courses
  });

  // Refetch when user logs in so isEnrolled reflects actual state
  useEffect(() => {
    if (user) {
      refetchCourses();
    }
  }, [user?.id]);

  // Refetch when home tab comes into focus (e.g. navigating back from course detail)
  useFocusEffect(
    useCallback(() => {
      refetchCourses();
    }, [user?.id])
  );

  const dynamicCategories = React.useMemo(() => {
    const combined = [...DEFAULT_CATEGORIES];
    const lowerSet = new Set(combined.map((c) => c.trim().toLowerCase()));
    const courseCategories = [...new Set(allCourses.map((c) => (c.category || "").trim()).filter(Boolean))];
    courseCategories.forEach((cat) => {
      const lower = cat.trim().toLowerCase();
      if (!lowerSet.has(lower)) {
        lowerSet.add(lower);
        combined.push(cat.trim());
      }
    });
    return combined;
  }, [allCourses]);

  const courses = React.useMemo(() => {
    let filtered = allCourses;
    if (selectedCategory && selectedCategory !== "All") filtered = filtered.filter((c) => (c.category || "").trim().toLowerCase() === selectedCategory.trim().toLowerCase());
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
    }
    return filtered;
  }, [allCourses, selectedCategory, search]);

  const { data: freeMaterialsData } = useQuery<{ materials: StudyMaterial[]; folders: MaterialFolder[] }>({
    queryKey: ["/api/study-materials", "free"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/study-materials", baseUrl);
      url.searchParams.set("free", "true");
      const res = await authFetch(url.toString());
      const data = await res.json().catch(() => ({ materials: [], folders: [] }));
      if (Array.isArray(data)) return { materials: data, folders: [] };
      return {
        materials: Array.isArray((data as any)?.materials) ? (data as any).materials : [],
        folders: Array.isArray((data as any)?.folders) ? (data as any).folders : [],
      };
    },
  });
  const freeMaterials = freeMaterialsData?.materials || [];
  const materialFolders = freeMaterialsData?.folders || [];

  const { data: liveClasses = [] } = useQuery<LiveClass[]>({
    queryKey: ["/api/live-classes"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/live-classes", baseUrl);
      const res = await authFetch(url.toString());
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    },
    refetchInterval: 30000,
  });

  const { data: homeNotifications = [] } = useQuery<any[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/notifications", baseUrl).toString());
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user, // only fetch when logged in — prevents 401 on welcome page
    refetchInterval: 30000,
    staleTime: 10000,
  });
  const unreadNotifCount = homeNotifications.filter((n: any) => !n.is_read).length;

  const myCourses = courses.filter((c) => c.isEnrolled && c.course_type !== "test_series");
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
            <Pressable style={styles.headerAvatar} onPress={() => router.push("/profile")}>
              {user?.photo_url ? (
                <Image source={{ uri: user.photo_url as string }} style={styles.headerAvatarImg} />
              ) : (
                <View style={styles.headerAvatarPlaceholder}>
                  <Text style={styles.headerAvatarInitial}>
                    {user?.name?.charAt(0)?.toUpperCase() || "S"}
                  </Text>
                </View>
              )}
              {/* Pencil badge — hints that tapping opens profile */}
              <View style={styles.headerAvatarBadge}>
                <Ionicons name="pencil" size={9} color="#fff" />
              </View>
            </Pressable>
            <View>
              <Text style={styles.greeting}>Hello, {user?.name?.split(" ")[0] || "Student"}</Text>
              <Text style={styles.subGreeting}>Ready to learn today?</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {isAdmin && (
              <Pressable style={styles.adminBtn} onPress={() => router.push("/admin")}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="grid" size={15} color="#fff" />
                  <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.3 }}>Admin</Text>
                </View>
              </Pressable>
            )}
            <Pressable style={styles.notifBtn} onPress={() => router.push("/notifications")}>
              <Ionicons name="notifications-outline" size={22} color="#fff" />
              {unreadNotifCount > 0 && (
                <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: "#EF4444", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: "#0A1628" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</Text>
                </View>
              )}
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
          <Pressable style={styles.liveClassBanner} onPress={() => router.push({
            pathname: `/live-class/${liveClass.id}` as any,
            params: { videoUrl: liveClass.youtube_url, title: liveClass.title },
          })}>
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
            {(freeMaterials.length > 0 || materialFolders.length > 0) && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Free Study Material</Text>
                  <Ionicons name="book-outline" size={18} color={Colors.light.primary} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.materialsList}>
                  {/* Folder cards first */}
                  {materialFolders.map((folder) => (
                    <Pressable key={`folder-${folder.id}`} style={styles.materialCard} onPress={() => router.push(`/material-folder/${encodeURIComponent(folder.name)}` as any)}>
                      <View style={[styles.materialIconBg, { backgroundColor: "#FEF3C7" }]}>
                        <Ionicons name="folder" size={22} color="#D97706" />
                      </View>
                      <View style={styles.materialInfo}>
                        <Text style={styles.materialTitle} numberOfLines={2}>{folder.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>FOLDER</Text>
                        </View>
                      </View>
                      <View style={{ position: "absolute", right: 10, top: "50%", marginTop: -10 }}>
                        <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
                      </View>
                    </Pressable>
                  ))}
                  {/* Individual material cards */}
                  {freeMaterials.filter((m) => !m.section_title).map((mat) => (
                    <Pressable key={mat.id} style={styles.materialCard} onPress={() => router.push(`/material/${mat.id}`)}>
                      <View style={styles.materialIconBg}>
                        <Ionicons name={mat.file_type === "pdf" ? "document-text" : mat.file_type === "video" ? "videocam" : mat.file_type === "doc" ? "document" : "link"} size={22} color={Colors.light.primary} />
                      </View>
                      <View style={styles.materialInfo}>
                        <Text style={styles.materialTitle} numberOfLines={2}>{mat.title}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>{(mat.file_type || "file").toUpperCase()}</Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Scheduled Live Classes */}
            {(() => {
              // Show until teacher actually goes live (is_live) or class ends — not only before scheduled_at
              const scheduled = liveClasses
                .filter((lc: any) => !lc.is_live && !lc.is_completed && lc.scheduled_at)
                .sort((a: any, b: any) => Number(a.scheduled_at) - Number(b.scheduled_at));
              if (scheduled.length === 0) return null;
              const visible = showAllScheduled ? scheduled : scheduled.slice(0, 2);
              return (
                <View style={styles.section}>
                  <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#E5E7EB", padding: 14, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Upcoming Live Classes</Text>
                      <View style={{ backgroundColor: "#FEE2E2", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="radio" size={12} color="#DC2626" />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" }}>{scheduled.length}</Text>
                      </View>
                    </View>
                    {visible.map((lc: any) => (
                      <ScheduledLiveCard key={lc.id} lc={lc} />
                    ))}
                    {scheduled.length > 2 && (
                      <Pressable onPress={() => setShowAllScheduled(!showAllScheduled)}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9", marginTop: 4 }}>
                        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>
                          {showAllScheduled ? "Show Less" : `View All ${scheduled.length} Classes`}
                        </Text>
                        <Ionicons name={showAllScheduled ? "chevron-up" : "chevron-down"} size={16} color={Colors.light.primary} />
                      </Pressable>
                    )}
                  </View>
                </View>
              );
            })()}

            {myCourses.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>My Courses</Text>
                </View>
                <FlatList
                  data={myCourses}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(c) => c.id.toString()}
                  renderItem={({ item, index }) => (
                    <View style={{ width: isWideScreen ? 280 : Math.min(screenWidth * 0.72, 280), marginRight: 14 }}>
                      <EnrolledCourseCard course={item} index={index} />
                    </View>
                  )}
                  contentContainerStyle={{ paddingLeft: 20, paddingRight: 8 }}
                  scrollEnabled={myCourses.length > 1}
                />
              </View>
            )}

            {freeCourses.length > 0 && (
              <View style={[styles.section, !isWideScreen && { paddingHorizontal: 10 }]}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Free Courses</Text>
                  <Ionicons name="gift-outline" size={18} color={Colors.light.success} />
                </View>
                <View style={isWideScreen ? styles.courseGrid : { paddingHorizontal: 10, gap: 14 }}>
                  {freeCourses.map((course, index) => (
                    <View key={course.id} style={isWideScreen ? styles.courseGridItem : undefined}>
                      <CourseCard course={course} index={index + 2} />
                    </View>
                  ))}
                </View>
              </View>
            )}

            {allOtherCourses.length > 0 && (
              <View style={[styles.section, !isWideScreen && { paddingHorizontal: 10 }]}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>All Courses</Text>
                </View>
                <View style={isWideScreen ? styles.courseGrid : { paddingHorizontal: 10, gap: 14 }}>
                  {allOtherCourses.map((course, index) => (
                    <View key={course.id} style={isWideScreen ? styles.courseGridItem : undefined}>
                      <CourseCard course={course} index={index} />
                    </View>
                  ))}
                </View>
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
  headerAvatar: {
    width: 52, height: 52, borderRadius: 26,
    overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,0.4)",
    position: "relative",
  },
  headerAvatarImg: { width: 52, height: 52 },
  headerAvatarPlaceholder: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
  },
  headerAvatarInitial: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerAvatarBadge: {
    position: "absolute", bottom: 0, right: 0,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.light.accent,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#fff",
  },
  greeting: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  subGreeting: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 2 },
  headerActions: { flexDirection: "row", gap: 8 },
  adminBtn: {
    paddingHorizontal: 12, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center", justifyContent: "center",
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
  courseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  courseGridItem: { width: "31%" as any, minWidth: 280 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12 },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  seeAll: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  courseCard: {
    backgroundColor: "#fff", borderRadius: 20, overflow: "hidden",
    marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  courseCardHeader: { height: 100, padding: 12, justifyContent: "space-between" },
  courseCardBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  categoryBadge: { backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  categoryBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  freeBadge: { backgroundColor: "#22C55E", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  freeBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  discountBadge: { backgroundColor: Colors.light.accent, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  discountBadgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  enrolledBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.35)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  enrolledBadgeText: { color: "#22C55E", fontSize: 10, fontFamily: "Inter_600SemiBold" },
  courseSubject: { color: "rgba(255,255,255,0.85)", fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
