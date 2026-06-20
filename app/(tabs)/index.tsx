import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  RefreshControl, Platform, ActivityIndicator, FlatList, Image, useWindowDimensions, Animated,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useOptionalBottomTabBarHeight } from "@/lib/useOptionalBottomTabBarHeight";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { getApiUrl, authFetch } from "@/lib/query-client";
import { useCoursePurchase } from "@/lib/use-course-purchase";
import { getCourseAccentColor } from "@shared/courseTheme";
import { liveClassQueryKey, notificationsQueryKey } from "@/lib/query-keys";
import { useDocumentVisibility } from "@/lib/useDocumentVisibility";
import { fetch } from "expo/fetch";
import CourseBannerImage from "@/components/CourseBannerImage";
import { COURSE_BANNER_ASPECT } from "@/constants/courseBanner";
import { buildHomeCategoryChips, filterCoursesByHomeCategory } from "@/constants/homeCategories";
import { getCourseExplorePath } from "@/lib/course-explore-path";

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
  daily_mission_count?: number;
  cover_color?: string;
  course_language?: string;
  batch_status?: string;
  validity_months?: number | string | null;
  enrollmentValidUntil?: number | null;
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
  parent_id?: number | null;
  full_name?: string;
}

interface LiveClass {
  id: number;
  title: string;
  description: string;
  youtube_url: string;
  is_live: boolean;
  scheduled_at: number;
}

function formatCourseDate(value?: string | number | null): string {
  if (value == null || value === "") return "";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function parseCourseDateMs(value?: string | number | null): number | null {
  if (value == null || value === "") return null;
  const date = typeof value === "number" ? new Date(value) : new Date(String(value).trim());
  const ms = date.getTime();
  return Number.isFinite(ms) ? ms : null;
}

type MultiSubjectCardPhase = "upcoming" | "live" | "recorded";

function getMultiSubjectCardPhase(course: Course, now = Date.now()): MultiSubjectCardPhase {
  const batchStatus = String(course.batch_status || "ongoing").toLowerCase();
  if (batchStatus === "completed" || batchStatus === "recorded") return "recorded";

  const endMs = parseCourseDateMs(course.end_date);
  if (endMs != null && endMs < now) return "recorded";

  const startMs = parseCourseDateMs(course.start_date);
  if (startMs != null && now < startMs) return "upcoming";

  return "live";
}

function multiStatusLabel(course: Course, now = Date.now()): string {
  const phase = getMultiSubjectCardPhase(course, now);
  if (phase === "recorded") return "RECORDED";
  if (phase === "upcoming") return "UPCOMING";
  return "LIVE";
}

function getMultiSubjectScheduleText(course: Course, now = Date.now()): string {
  const phase = getMultiSubjectCardPhase(course, now);

  if (phase === "upcoming" && course.start_date) {
    return `Starts ${formatCourseDate(course.start_date)}`;
  }
  if (course.enrollmentValidUntil) {
    return `Valid till ${formatCourseDate(course.enrollmentValidUntil)}`;
  }
  if (course.end_date && phase === "live") {
    return `Ends ${formatCourseDate(course.end_date)}`;
  }
  if (course.validity_months) {
    return `${course.validity_months} months validity`;
  }
  return "";
}

function getMultiSubjectContentCounts(course: Course) {
  const totalTests = Math.max(0, Number(course.total_tests) || 0);
  const mock = Math.max(0, Number(course.mock_count) || 0);
  const pyq = Math.max(0, Number(course.pyq_count) || 0);
  const practice = Math.max(0, Number(course.practice_count) || 0);
  const regularTests = practice > 0 ? practice : Math.max(0, totalTests - mock - pyq);
  return {
    lectures: Math.max(0, Number(course.total_lectures) || 0),
    tests: regularTests,
    materials: Math.max(0, Number(course.total_materials) || 0),
  };
}

function getCourseBannerColors(course: Course): [string, string] {
  const accent = getCourseAccentColor(course.id);
  const cover = course.cover_color || accent;
  return [cover, `${cover}CC`];
}

function CourseBanner({ course }: { course: Course }) {
  const bannerColors = getCourseBannerColors(course);
  return (
    <CourseBannerImage
      uri={course.thumbnail}
      fallbackColors={bannerColors}
    />
  );
}

function normalCourseStatusLabel(course: Course, now = Date.now()): string {
  const phase = getMultiSubjectCardPhase(course, now);
  if (phase === "upcoming") return "UPCOMING";
  if (phase === "recorded") return "RECORDED";
  if ((course.course_type || "live") === "recorded") return "RECORDED";
  return "LIVE";
}

function getRegularTestCount(course: Course): number {
  const mock = Number(course.mock_count) || 0;
  const pyq = Number(course.pyq_count) || 0;
  const practice = Number(course.practice_count);
  if (Number.isFinite(practice) && practice > 0) return practice;
  return Math.max(0, (Number(course.total_tests) || 0) - mock - pyq);
}

/** Home card "Tests" = regular tests + mock + daily missions (normal courses only). */
function getHomeCombinedTestCount(course: Course): number {
  return getRegularTestCount(course) + (Number(course.mock_count) || 0) + (Number(course.daily_mission_count) || 0);
}

function NormalCourseCardStats({
  course,
  color,
  colors,
  muted = false,
}: {
  course: Course;
  color?: string;
  colors: { textSecondary: string; textMuted: string };
  muted?: boolean;
}) {
  const iconColor = muted ? colors.textMuted : (color || Colors.light.primary);
  const textColor = muted ? colors.textMuted : colors.textSecondary;
  const statRow = (icon: keyof typeof Ionicons.glyphMap, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 1 }}>
      <Ionicons name={icon} size={12} color={iconColor} />
      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: textColor }} numberOfLines={1}>{label}</Text>
    </View>
  );
  const dot = <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted, flexShrink: 0 }} />;
  const combinedTests = getHomeCombinedTestCount(course);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {statRow("videocam", `${course.total_lectures || 0} Lectures`)}
      {dot}
      {statRow("document-text", `${combinedTests} Tests`)}
      {dot}
      {statRow("folder", `${course.total_materials || 0} Materials`)}
    </View>
  );
}

function CourseProgressBar({ progress, color, colors }: { progress: number; color: string; colors: { surfaceAlt: string; textMuted: string } }) {
  const pct = Math.max(0, Math.min(100, Number(progress) || 0));
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 4, backgroundColor: colors.surfaceAlt, borderRadius: 2, overflow: "hidden" }}>
        <View style={{ height: 4, backgroundColor: color, borderRadius: 2, width: `${pct}%` as any, minWidth: pct > 0 ? 4 : 0 }} />
      </View>
      <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textMuted }}>{pct}% complete</Text>
    </View>
  );
}

function MultiSubjectCourseCard({ course, enrolled = false }: { course: Course; enrolled?: boolean }) {
  const { colors } = useAppTheme();
  const livePulse = React.useRef(new Animated.Value(1)).current;
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price) > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;
  const cover = course.cover_color || "#B7F2D5";
  const language = (course.course_language || "HINGLISH").toUpperCase();
  const level = course.level || "Beginner";
  const status = multiStatusLabel(course);
  const scheduleText = getMultiSubjectScheduleText(course);
  const bannerColors: [string, string] = course.thumbnail ? [cover, `${cover}CC`] : [getCourseAccentColor(course.id), `${getCourseAccentColor(course.id)}CC`];

  useEffect(() => {
    if (status !== "LIVE") {
      livePulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        Animated.timing(livePulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [livePulse, status]);

  return (
    <Pressable
      style={({ pressed }) => [styles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(getCourseExplorePath(course) as any); }}
    >
      <CourseBannerImage
        uri={course.thumbnail}
        fallbackColors={bannerColors}
      />
      <View style={styles.multiCourseBody}>
        <View style={styles.multiTopRow}>
          <View style={[styles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={styles.multiCategory}>{course.category || "Course"}</Text>
            <Text style={styles.multiLevel}>{level}</Text>
          </View>
          <View style={styles.multiTopRightGroup}>
            {enrolled ? (
              <View style={styles.multiEnrolledBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                <Text style={styles.multiEnrolledBadgeText}>Enrolled</Text>
              </View>
            ) : null}
            <View style={styles.multiLanguagePill}><Text style={styles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        <Text style={[styles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
        <View style={styles.courseTeacherRow}>
          <Ionicons name="people" size={13} color={colors.textSecondary} />
          <Text style={[styles.courseTeacher, { color: colors.textSecondary }]} numberOfLines={1}>
            {`|  ${course.teacher_name?.trim() || "Pankaj Sir & Team"}`}
          </Text>
        </View>
        <View style={styles.multiMetaRow}>
          {status === "LIVE" ? (
            <Animated.View style={[styles.multiLiveDot, { opacity: livePulse, transform: [{ scale: livePulse }] }]} />
          ) : null}
          <Text
            style={[
              styles.multiMetaText,
              styles.multiStatusText,
              status === "UPCOMING" && { color: "#D97706" },
              status === "RECORDED" && { color: colors.textSecondary },
            ]}
          >
            {status}
          </Text>
          {scheduleText ? <Text style={[styles.multiMetaText, { color: colors.textSecondary }]}>| {scheduleText}</Text> : null}
        </View>
        {enrolled ? (
          <View style={[styles.multiPriceRow, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <CourseProgressBar
                progress={Number(course.progress) || 0}
                color={getCourseAccentColor(course.id)}
                colors={{ surfaceAlt: colors.surfaceAlt, textMuted: colors.textMuted }}
              />
            </View>
            <Pressable style={styles.multiArrowBtn} onPress={() => router.push(getCourseExplorePath(course) as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.multiPriceRow}>
            {course.is_free || parseFloat(course.price || "0") <= 0 ? (
              <Text style={styles.multiPrice}>Free</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={styles.multiPrice}>₹{parseFloat(course.price).toFixed(0)}</Text>
                {parseFloat(course.original_price || "0") > 0 ? <Text style={styles.multiOriginalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text> : null}
              </View>
            )}
            {discount > 0 ? <Text style={styles.multiDiscount}>{discount}% OFF</Text> : null}
            <View style={{ flex: 1 }} />
            <Pressable
              style={styles.multiBuyBtn}
              disabled={isPending}
              onPress={(e) => {
                e?.stopPropagation?.();
                purchase();
              }}
            >
              <LinearGradient colors={["#B91C1C", "#EF4444"]} style={styles.multiBuyGradient}>
                <Text style={styles.multiBuyText}>
                  {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.multiArrowBtn} onPress={() => router.push(getCourseExplorePath(course) as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        )}
      </View>
      {paymentModal}
    </Pressable>
  );
}

function getNormalCourseDateRange(course: Course): string {
  if (!course.start_date && !course.end_date) return "";
  const start = formatCourseDate(course.start_date) || "TBD";
  const end = formatCourseDate(course.end_date) || "TBD";
  return `${start} → ${end}`;
}

function NormalCourseCard({ course, enrolled = false }: { course: Course; enrolled?: boolean }) {
  const { colors } = useAppTheme();
  const livePulse = React.useRef(new Animated.Value(1)).current;
  const color = getCourseAccentColor(course.id);
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price) > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;
  const language = (course.course_language || "HINGLISH").toUpperCase();
  const level = course.level || "Beginner";
  const status = normalCourseStatusLabel(course);
  const dateRange = getNormalCourseDateRange(course);
  const explorePath = getCourseExplorePath(course);

  useEffect(() => {
    if (status !== "LIVE") {
      livePulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(livePulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
        Animated.timing(livePulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [livePulse, status]);

  return (
    <Pressable
      style={({ pressed }) => [styles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(explorePath as any); }}
    >
      <CourseBanner course={course} />
      <View style={[styles.multiCourseBody, { backgroundColor: colors.card }]}>
        <View style={styles.multiTopRow}>
          <View style={[styles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={[styles.multiCategory, { color }]}>{course.category || "Course"}</Text>
            <Text style={styles.multiLevel}>{level}</Text>
          </View>
          <View style={styles.multiTopRightGroup}>
            {enrolled ? (
              <View style={styles.multiEnrolledBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                <Text style={styles.multiEnrolledBadgeText}>Enrolled</Text>
              </View>
            ) : null}
            <View style={styles.multiLanguagePill}><Text style={styles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        <Text style={[styles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
        {(course.teacher_name || course.subject) ? (
          <View style={styles.courseTeacherRow}>
            <Ionicons name="person" size={12} color={colors.textSecondary} />
            <Text style={[styles.courseTeacher, { color: colors.textSecondary }]} numberOfLines={1}>
              {course.teacher_name || ""}
              {course.teacher_name && course.subject ? "  |  " : ""}
              {course.subject ? `Subject - ${course.subject}` : ""}
            </Text>
          </View>
        ) : null}
        <NormalCourseCardStats course={course} color={color} colors={colors} muted />
        <View style={styles.multiMetaRow}>
          {status === "LIVE" ? (
            <Animated.View style={[styles.multiLiveDot, { opacity: livePulse, transform: [{ scale: livePulse }] }]} />
          ) : null}
          <Text
            style={[
              styles.multiMetaText,
              status === "LIVE" && styles.multiStatusText,
              status === "UPCOMING" && { color: "#D97706", fontFamily: "Inter_700Bold" },
              status === "RECORDED" && { color: "#7C3AED", fontFamily: "Inter_700Bold" },
            ]}
          >
            {status}
          </Text>
          {dateRange ? (
            <>
              <Text style={[styles.multiMetaText, { color: colors.textMuted }]}>|</Text>
              <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
              <Text style={[styles.multiMetaText, { color: colors.textMuted }]}>{dateRange}</Text>
            </>
          ) : null}
        </View>
        {enrolled ? (
          <View style={[styles.multiPriceRow, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <CourseProgressBar
                progress={Number(course.progress) || 0}
                color={color}
                colors={{ surfaceAlt: colors.surfaceAlt, textMuted: colors.textMuted }}
              />
            </View>
            <Pressable style={styles.multiArrowBtn} onPress={() => router.push(explorePath as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.multiPriceRow}>
            {course.is_free || parseFloat(course.price || "0") <= 0 ? (
              <Text style={styles.multiPrice}>Free</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={styles.multiPrice}>₹{parseFloat(course.price).toFixed(0)}</Text>
                {parseFloat(course.original_price || "0") > 0 ? <Text style={styles.multiOriginalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text> : null}
              </View>
            )}
            {discount > 0 ? <Text style={styles.multiDiscount}>{discount}% OFF</Text> : null}
            <View style={{ flex: 1 }} />
            <Pressable
              style={styles.multiBuyBtn}
              disabled={isPending}
              onPress={(e) => {
                e?.stopPropagation?.();
                purchase();
              }}
            >
              <LinearGradient colors={["#B91C1C", "#EF4444"]} style={styles.multiBuyGradient}>
                <Text style={styles.multiBuyText}>
                  {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={styles.multiArrowBtn} onPress={() => router.push(explorePath as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        )}
      </View>
      {paymentModal}
    </Pressable>
  );
}

function ScheduledLiveCard({ lc, nowMs }: { lc: any; nowMs: number }) {
  const { colors, isDarkMode } = useAppTheme();
  const scheduledMs = Number(lc.scheduled_at);
  const diff = scheduledMs - nowMs;
  const status: "countdown" | "waiting" = diff <= 0 ? "waiting" : "countdown";
  const countdown = React.useMemo(() => {
    if (diff <= 0) return "";
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  }, [diff]);

  const scheduleDate = new Date(scheduledMs);
  const dateStr = scheduleDate.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const timeStr = scheduleDate.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={{ backgroundColor: isDarkMode ? colors.surfaceAlt : status === "waiting" ? "#FFFBEB" : "#F8FAFC", borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: isDarkMode ? colors.border : status === "waiting" ? "#FDE68A" : "#F1F5F9" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: status === "waiting" ? "#FEF3C7" : "#FEE2E2", alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={status === "waiting" ? "hourglass" : "calendar"} size={20} color={status === "waiting" ? "#D97706" : "#DC2626"} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: colors.text }} numberOfLines={1}>{lc.title}</Text>
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
            <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: colors.textMuted }}>{dateStr} at {timeStr}</Text>
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

function getTestSeriesRegularCount(course: Course): number {
  const mock = Number(course.mock_count) || 0;
  const pyq = Number(course.pyq_count) || 0;
  const practice = Number(course.practice_count) || 0;
  return Math.max(0, (Number(course.total_tests) || 0) - mock - pyq - practice);
}

function TestSeriesHomeCard({ course }: { course: Course }) {
  const { colors } = useAppTheme();
  const color = getCourseAccentColor(course.id);
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price) > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price) / parseFloat(course.original_price)) * 100)
    : 0;
  const language = (course.course_language || "HINGLISH").toUpperCase();
  const level = course.level || "Beginner";
  const tests = getTestSeriesRegularCount(course);
  const practice = Number(course.practice_count) || 0;
  const pyq = Number(course.pyq_count) || 0;
  const mock = Number(course.mock_count) || 0;
  const explorePath = getCourseExplorePath(course);

  return (
    <Pressable
      style={({ pressed }) => [styles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(explorePath as any); }}
    >
      <CourseBanner course={course} />
      <View style={[styles.multiCourseBody, { backgroundColor: colors.card }]}>
        <View style={styles.multiTopRow}>
          <View style={[styles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={[styles.multiCategory, { color }]}>{course.category || "Test Series"}</Text>
            <Text style={styles.multiLevel}>{level}</Text>
          </View>
          <View style={styles.multiTopRightGroup}>
            <View style={styles.multiLanguagePill}><Text style={styles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        <Text style={[styles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="document-text" size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textSecondary }}>{tests} Tests</Text>
          </View>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="create" size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textSecondary }}>{practice} Practice</Text>
          </View>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="school" size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textSecondary }}>{pyq} PYQs</Text>
          </View>
          <View style={{ width: 2, height: 2, borderRadius: 1, backgroundColor: colors.textMuted }} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="clipboard" size={12} color={colors.textSecondary} />
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: colors.textSecondary }}>{mock} Mocks</Text>
          </View>
        </View>
        <View style={styles.multiPriceRow}>
          {isFreeCourse ? (
            <Text style={styles.multiPrice}>Free</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={styles.multiPrice}>₹{parseFloat(course.price).toFixed(0)}</Text>
              {parseFloat(course.original_price || "0") > 0 ? <Text style={styles.multiOriginalPrice}>₹{parseFloat(course.original_price).toFixed(0)}</Text> : null}
            </View>
          )}
          {discount > 0 ? <Text style={styles.multiDiscount}>{discount}% OFF</Text> : null}
          <View style={{ flex: 1 }} />
          <Pressable
            style={styles.multiBuyBtn}
            disabled={isPending}
            onPress={(e) => {
              e?.stopPropagation?.();
              purchase();
            }}
          >
            <LinearGradient colors={["#B91C1C", "#EF4444"]} style={styles.multiBuyGradient}>
              <Text style={styles.multiBuyText}>
                {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
      {paymentModal}
    </Pressable>
  );
}

function EnrolledCourseCard({ course, index }: { course: Course; index: number }) {
  return <CourseCard course={{ ...course, isEnrolled: true }} index={index} />;
}

function CourseCard({ course, index }: { course: Course; index: number }) {
  if (course.course_type === "multi_subject") {
    return <MultiSubjectCourseCard course={course} enrolled={!!course.isEnrolled} />;
  }

  if (course.course_type !== "test_series") {
    return <NormalCourseCard course={course} enrolled={!!course.isEnrolled} />;
  }

  return <TestSeriesHomeCard course={course} />;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useOptionalBottomTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const isWideScreen = screenWidth >= 768;
  const isNative = Platform.OS !== "web";
  const isNativePhone = isNative && !isWideScreen;
  const { user, isAdmin, logout } = useAuth();
  const { colors, isDarkMode } = useAppTheme();
  const qc = useQueryClient();
  const tabVisible = useDocumentVisibility();
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [refreshing, setRefreshing] = useState(false);
  const [showAllScheduled, setShowAllScheduled] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;
  const headerTopInset = topPadding + (isNative ? 8 : 12);
  const scrollBottomPad = Platform.OS === "web" ? bottomPadding + 80 : bottomPadding + tabBarHeight + 8;
  const avatarSize = isNativePhone ? 40 : 52;
  const avatarBadgeSize = isNativePhone ? 15 : 18;
  const enrolledCardWidth = isWideScreen
    ? 360
    : Math.min(screenWidth - 40, 420);

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

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: allCourses = [], refetch: refetchCourses, isLoading } = useQuery<Course[]>({
    queryKey: ["/api/courses", user?.id ?? "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/courses", baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10 * 1000,
    gcTime: 25 * 60 * 1000,
    refetchInterval: Platform.OS === "web" ? false : tabVisible ? 60 * 1000 : 3 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: Platform.OS !== "web",
    // Always fetch — even unauthenticated users can see published courses
  });

  // Refetch when user logs in so isEnrolled reflects actual state
  useEffect(() => {
    if (user) {
      refetchCourses();
    }
  }, [user?.id]);

  // Keep course cards fresh when returning from another screen (e.g. admin/content updates).
  useFocusEffect(
    useCallback(() => {
      void refetchCourses();
    }, [refetchCourses]),
  );

  useEffect(() => {
    const raw = typeof categoryParam === "string" ? categoryParam : Array.isArray(categoryParam) ? categoryParam[0] : "";
    if (raw?.trim()) setSelectedCategory(decodeURIComponent(raw.trim()));
  }, [categoryParam]);

  const dynamicCategories = React.useMemo(() => {
    const courseCategories = [...new Set(allCourses.map((c) => (c.category || "").trim()).filter(Boolean))];
    return buildHomeCategoryChips(courseCategories);
  }, [allCourses]);

  const courses = React.useMemo(() => {
    let filtered = filterCoursesByHomeCategory(allCourses, selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((c) => c.title.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q));
    }
    return filtered;
  }, [allCourses, selectedCategory, search]);

  useEffect(() => {
    if (!user?.id) return;
    const baseUrl = getApiUrl();
    const hotCourses = allCourses.slice(0, 4);
    hotCourses.forEach((course: any) => {
      qc.prefetchQuery({
        queryKey: ["/api/courses", String(course.id)],
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/courses/${course.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch course failed");
          return res.json();
        },
        staleTime: 5 * 60 * 1000,
      });
    });
  }, [allCourses, qc, user?.id]);

  const { data: freeMaterialsData, refetch: refetchFreeMaterials } = useQuery<{ materials: StudyMaterial[]; folders: MaterialFolder[] }>({
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
    staleTime: 5 * 60 * 1000,
    gcTime: 25 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const freeMaterials = freeMaterialsData?.materials || [];
  const materialFolders = freeMaterialsData?.folders || [];

  const { data: liveClasses = [], refetch: refetchLiveClasses } = useQuery<LiveClass[]>({
    queryKey: ["/api/live-classes"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/live-classes", baseUrl);
      const res = await authFetch(url.toString());
      const data = await res.json().catch(() => []);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 10_000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: tabVisible ? 15 * 1000 : false,
    refetchOnMount: true,
    refetchOnWindowFocus: Platform.OS !== "web",
  });

  useEffect(() => {
    if (!user?.id) return;
    const baseUrl = getApiUrl();
    const hotLive = (liveClasses || []).slice(0, 3);
    hotLive.forEach((lc) => {
      qc.prefetchQuery({
        queryKey: liveClassQueryKey(lc.id),
        queryFn: async () => {
          const res = await authFetch(new URL(`/api/live-classes/${lc.id}`, baseUrl).toString());
          if (!res.ok) throw new Error("prefetch live failed");
          return res.json();
        },
        staleTime: 15_000,
      });
    });
  }, [liveClasses, qc, user?.id]);

  const { data: homeNotifications = [], refetch: refetchHomeNotifications } = useQuery<any[]>({
    queryKey: user?.id ? notificationsQueryKey(user.id) : ["/api/notifications", "guest"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/notifications", baseUrl).toString());
        if (res.status === 401) return [];
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user?.id,
    refetchInterval: !!user?.id ? (tabVisible ? 90_000 : false) : false,
    staleTime: 60000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const unreadNotifCount = homeNotifications.filter((n: any) => !n.is_read).length;

  const myCourses = courses.filter((c) => c.isEnrolled && c.course_type !== "test_series");
  const freeCourses = courses.filter((c) => c.is_free && !c.isEnrolled);
  const allOtherCourses = courses.filter((c) => !c.isEnrolled && !c.is_free);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      refetchCourses(),
      refetchLiveClasses(),
      refetchFreeMaterials(),
      ...(user?.id ? [refetchHomeNotifications()] : []),
    ]);
    setRefreshing(false);
  }, [refetchCourses, refetchLiveClasses, refetchFreeMaterials, refetchHomeNotifications, user?.id]);

  const liveClass = liveClasses.find((lc) => lc.is_live);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]}
        style={[
          styles.header,
          { paddingTop: headerTopInset },
          isNativePhone && styles.headerNativePhone,
        ]}
      >
        <View style={styles.headerTop}>
          <View style={[styles.headerLeft, isNativePhone && styles.headerLeftNativePhone]}>
            <Pressable
              style={[
                styles.headerAvatar,
                { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
              ]}
              onPress={() => router.push("/profile")}
            >
              {user?.photo_url ? (
                <Image
                  source={{ uri: user.photo_url as string }}
                  style={[styles.headerAvatarImg, { width: avatarSize, height: avatarSize }]}
                />
              ) : (
                <View
                  style={[
                    styles.headerAvatarPlaceholder,
                    { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 },
                  ]}
                >
                  <Text style={[styles.headerAvatarInitial, isNativePhone && styles.headerAvatarInitialNativePhone]}>
                    {user?.name?.charAt(0)?.toUpperCase() || "S"}
                  </Text>
                </View>
              )}
              {/* Pencil badge — hints that tapping opens profile */}
              <View
                style={[
                  styles.headerAvatarBadge,
                  { width: avatarBadgeSize, height: avatarBadgeSize, borderRadius: avatarBadgeSize / 2 },
                ]}
              >
                <Ionicons name="pencil" size={isNativePhone ? 8 : 9} color="#fff" />
              </View>
            </Pressable>
            <View>
              <Text
                style={[styles.greeting, isNativePhone && styles.greetingNativePhone]}
                maxFontSizeMultiplier={isNativePhone ? 1.1 : undefined}
              >
                Hello, {user?.name?.split(" ")[0] || "Student"}
              </Text>
              <Text
                style={[styles.subGreeting, isNativePhone && styles.subGreetingNativePhone]}
                maxFontSizeMultiplier={isNativePhone ? 1.1 : undefined}
              >
                Ready to learn today?
              </Text>
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
            <Pressable
              style={[styles.notifBtn, isNativePhone && styles.notifBtnNativePhone]}
              onPress={() => router.push("/notifications")}
            >
              <Ionicons name="notifications-outline" size={isNativePhone ? 20 : 22} color="#fff" />
              {unreadNotifCount > 0 && (
                <View style={{ position: "absolute", top: -4, right: -4, backgroundColor: "#EF4444", borderRadius: 9, minWidth: 18, height: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderWidth: 2, borderColor: "#0A1628" }}>
                  <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" }}>{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <View style={[styles.searchBar, { backgroundColor: colors.card }, isNative && styles.searchBarNative]}>
          <Ionicons name="search-outline" size={isNative ? 18 : 20} color={colors.textMuted} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }, isNative && styles.searchInputNative]}
            placeholder="Search courses, topics..."
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            maxFontSizeMultiplier={isNative ? 1.1 : undefined}
          />
          {search ? (
            <Pressable onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={isNative ? 18 : 20} color={colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </LinearGradient>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
      >
        {liveClass && (
          <Pressable style={styles.liveClassBanner} onPress={() => router.push({
            pathname: `/live-class/${liveClass.id}` as any,
            params: {
              videoUrl: liveClass.youtube_url ?? "",
              title: liveClass.title ?? "",
              listIsLive: "1",
            },
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
            <Pressable
              key={cat}
              style={[
                styles.categoryChip,
                { backgroundColor: colors.card, borderColor: colors.border },
                selectedCategory === cat && styles.categoryChipActive,
              ]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={[styles.categoryChipText, { color: colors.textSecondary }, selectedCategory === cat && styles.categoryChipTextActive]}>{cat}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={Colors.light.primary} />
            <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading courses...</Text>
          </View>
        ) : (
          <>
            {(freeMaterials.length > 0 || materialFolders.length > 0) && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Free Study Material</Text>
                  <Ionicons name="book-outline" size={18} color={Colors.light.primary} />
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.materialsList}>
                  {/* Folder cards first */}
                  {materialFolders.filter((folder) => !folder.parent_id).map((folder) => (
                    <Pressable key={`folder-${folder.id}`} style={[styles.materialCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push(`/material-folder/${encodeURIComponent(folder.full_name || folder.name)}` as any)}>
                      <View style={[styles.materialIconBg, { backgroundColor: "#FEF3C7" }]}>
                        <Ionicons name="folder" size={22} color="#D97706" />
                      </View>
                      <View style={styles.materialInfo}>
                        <Text style={[styles.materialTitle, { color: colors.text }]} numberOfLines={2}>{folder.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: colors.textMuted }}>FOLDER</Text>
                        </View>
                      </View>
                      <View style={{ position: "absolute", right: 10, top: "50%", marginTop: -10 }}>
                        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
                      </View>
                    </Pressable>
                  ))}
                  {/* Individual material cards */}
                  {freeMaterials.filter((m) => !m.section_title).map((mat) => (
                    <Pressable key={mat.id} style={[styles.materialCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => router.push(`/material/${mat.id}`)}>
                      <View style={styles.materialIconBg}>
                        <Ionicons name={mat.file_type === "pdf" ? "document-text" : mat.file_type === "video" ? "videocam" : mat.file_type === "doc" ? "document" : "link"} size={22} color={Colors.light.primary} />
                      </View>
                      <View style={styles.materialInfo}>
                        <Text style={[styles.materialTitle, { color: colors.text }]} numberOfLines={2}>{mat.title}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <View style={styles.freePill}><Text style={styles.freePillText}>FREE</Text></View>
                          <Text style={{ fontSize: 10, fontFamily: "Inter_500Medium", color: colors.textMuted }}>{(mat.file_type || "file").toUpperCase()}</Text>
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
                  <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: colors.text }}>Upcoming Live Classes</Text>
                      <View style={{ backgroundColor: "#FEE2E2", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="radio" size={12} color="#DC2626" />
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626" }}>{scheduled.length}</Text>
                      </View>
                    </View>
                    {visible.map((lc: any) => (
                      <ScheduledLiveCard key={lc.id} lc={lc} nowMs={nowMs} />
                    ))}
                    {scheduled.length > 2 && (
                      <Pressable onPress={() => setShowAllScheduled(!showAllScheduled)}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 4 }}>
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
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>My Courses</Text>
                </View>
                <FlatList
                  data={myCourses}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(c) => c.id.toString()}
                  renderItem={({ item, index }) => (
                    <View style={{ width: enrolledCardWidth, marginRight: 14 }}>
                      <EnrolledCourseCard course={item} index={index} />
                    </View>
                  )}
                  contentContainerStyle={{ paddingLeft: 10, paddingRight: 8 }}
                  scrollEnabled={myCourses.length > 1}
                />
              </View>
            )}

            {freeCourses.length > 0 && (
              <View style={[styles.section, !isWideScreen && { paddingHorizontal: 10 }]}>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Free Courses</Text>
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
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>All Courses</Text>
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
                <Ionicons name="search" size={48} color={colors.textMuted} />
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No courses found</Text>
                <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>Try a different search or category</Text>
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
  headerNativePhone: { paddingBottom: 12, gap: 8 },
  headerLeftNativePhone: { gap: 10 },
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
  headerAvatarInitialNativePhone: { fontSize: 16 },
  headerAvatarBadge: {
    position: "absolute", bottom: 0, right: 0,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.light.accent,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: "#fff",
  },
  greeting: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#fff" },
  greetingNativePhone: { fontSize: 18 },
  subGreeting: { fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", marginTop: 2 },
  subGreetingNativePhone: { fontSize: 12, marginTop: 1 },
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
  notifBtnNativePhone: { width: 34, height: 34, borderRadius: 10 },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: "#fff", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  searchBarNative: {
    minHeight: 42,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text },
  searchInputNative: Platform.select({
    android: {
      height: 36,
      paddingVertical: 0,
      includeFontPadding: false,
      textAlignVertical: "center",
    },
    ios: {
      height: 36,
      paddingVertical: 0,
    },
    default: {
      height: 36,
      paddingVertical: 0,
    },
  }),
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
    backgroundColor: "#fff", borderRadius: 20, overflow: "hidden", minHeight: 268,
    marginBottom: 14, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  enrolledCourseCard: {
    backgroundColor: "#fff", borderRadius: 20, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  multiCourseCard: {
    borderRadius: 20, overflow: "hidden", borderWidth: 1, marginBottom: 14, minHeight: 294,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  multiCourseBanner: { width: "100%", aspectRatio: COURSE_BANNER_ASPECT, overflow: "hidden" },
  multiCourseBody: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  multiTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  multiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  multiTopRightGroup: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 8 },
  multiCategory: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626", textTransform: "uppercase" },
  multiSubject: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  multiLevel: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#4F46E5", backgroundColor: "#EEF2FF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  multiLanguagePill: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4, backgroundColor: "#fff" },
  multiLanguageText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#0F172A" },
  multiEnrolledBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#ECFDF5", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "#BBF7D0" },
  multiEnrolledBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" },
  multiTitle: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_700Bold" },
  multiMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  multiMetaText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  multiStatusText: { color: "#DC2626", fontFamily: "Inter_700Bold" },
  multiLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#DC2626" },
  multiPriceRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 34 },
  multiEnrolledStats: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  multiEnrolledStat: { flexDirection: "row", alignItems: "center", gap: 3 },
  multiEnrolledStatText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  multiEnrolledStatDot: { width: 2, height: 2, borderRadius: 1 },
  multiPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  multiOriginalPrice: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#64748B", textDecorationLine: "line-through" },
  multiDiscount: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" },
  multiBuyBtn: { borderRadius: 8, overflow: "hidden" },
  multiBuyGradient: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  multiBuyText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  multiArrowBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  courseCardHeader: { height: 128, padding: 14, justifyContent: "space-between" },
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
  courseCardBody: { padding: 16, gap: 9, minHeight: 140 },
  courseTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text, lineHeight: 21 },
  courseTeacher: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", flexShrink: 1 },
  courseTeacherRow: { flexDirection: "row", alignItems: "center", gap: 4 },
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
