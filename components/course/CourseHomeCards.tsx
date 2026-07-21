import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Animated, Platform } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useCoursePurchase } from "@/lib/use-course-purchase";
import { getCourseAccentColor } from "@shared/courseTheme";
import CourseBannerImage from "@/components/CourseBannerImage";
import { getCourseExplorePath } from "@/lib/course-explore-path";
import { getCourseCategoryLabel, getTestSeriesCardMetaLine } from "@/lib/course-category-label";

export interface CourseHomeCardCourse {
  id: number;
  title: string;
  description?: string;
  teacher_name?: string;
  price?: string;
  original_price?: string;
  category?: string;
  subject?: string;
  exam?: string;
  thumbnail?: string;
  is_free?: boolean;
  total_lectures?: number;
  total_tests?: number;
  total_students?: number;
  total_materials?: number;
  level?: string;
  duration_hours?: string;
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

export type CourseCardVariant = "student" | "staff";

export type CourseCardProps = {
  course: CourseHomeCardCourse;
  index?: number;
  variant?: CourseCardVariant;
  onPress?: () => void;
  assignmentSubjects?: string[];
};

type Course = CourseHomeCardCourse;

function StaffAssignmentBadge({ subjects }: { subjects?: string[] }) {
  const labels = (subjects || []).filter(Boolean);
  if (labels.length === 0) return null;
  return (
    <View style={{ backgroundColor: "#EEF2FF", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 140 }}>
      <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#4F46E5" }} numberOfLines={2}>
        {labels.join(", ")}
      </Text>
    </View>
  );
}

function StaffCardFooter({
  variant,
  onPress,
  assignmentSubjects,
  children,
}: {
  variant: CourseCardVariant;
  onPress?: () => void;
  assignmentSubjects?: string[];
  children?: React.ReactNode;
}) {
  if (variant !== "staff") return null;
  return (
    <View style={[cardStyles.multiPriceRow, { alignItems: "center" }]}>
      <View style={{ flex: 1 }}>{children}</View>
      <StaffAssignmentBadge subjects={assignmentSubjects} />
      <Pressable style={cardStyles.multiArrowBtn} onPress={onPress}>
        <Ionicons name="chevron-forward" size={18} color="#0F172A" />
      </Pressable>
    </View>
  );
}

function navigateToCourse(course: Course, onPress?: () => void) {
  if (onPress) {
    onPress();
    return;
  }
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  router.push(getCourseExplorePath(course) as any);
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

function MultiSubjectCourseCard({
  course,
  enrolled = false,
  variant = "student",
  onPress,
  assignmentSubjects,
}: {
  course: Course;
  enrolled?: boolean;
  variant?: CourseCardVariant;
  onPress?: () => void;
  assignmentSubjects?: string[];
}) {
  const { colors } = useAppTheme();
  const isStaff = variant === "staff";
  const livePulse = React.useRef(new Animated.Value(1)).current;
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price || "0") > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price || "0") / parseFloat(course.original_price || "0")) * 100)
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
        Animated.timing(livePulse, { toValue: 0.35, duration: 650, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(livePulse, { toValue: 1, duration: 650, useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [livePulse, status]);

  return (
    <Pressable
      style={({ pressed }) => [cardStyles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => navigateToCourse(course, onPress)}
    >
      <CourseBannerImage
        uri={course.thumbnail}
        fallbackColors={bannerColors}
      />
      <View style={cardStyles.multiCourseBody}>
        <View style={cardStyles.multiTopRow}>
          <View style={[cardStyles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={cardStyles.multiCategory}>{course.category || "Course"}</Text>
            <Text style={cardStyles.multiLevel}>{level}</Text>
          </View>
          <View style={cardStyles.multiTopRightGroup}>
            {enrolled ? (
              <View style={cardStyles.multiEnrolledBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                <Text style={cardStyles.multiEnrolledBadgeText}>Enrolled</Text>
              </View>
            ) : null}
            <View style={cardStyles.multiLanguagePill}><Text style={cardStyles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        <Text style={[cardStyles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
        <View style={cardStyles.courseTeacherRow}>
          <Ionicons name="people" size={13} color={colors.textSecondary} />
          <Text style={[cardStyles.courseTeacher, { color: colors.textSecondary }]} numberOfLines={1}>
            {`|  ${course.teacher_name?.trim() || "Pankaj Sir & Team"}`}
          </Text>
        </View>
        <View style={cardStyles.multiMetaRow}>
          {status === "LIVE" ? (
            <Animated.View style={[cardStyles.multiLiveDot, { opacity: livePulse, transform: [{ scale: livePulse }] }]} />
          ) : null}
          <Text
            style={[
              cardStyles.multiMetaText,
              cardStyles.multiStatusText,
              status === "UPCOMING" && { color: "#D97706" },
              status === "RECORDED" && { color: colors.textSecondary },
            ]}
          >
            {status}
          </Text>
          {scheduleText ? <Text style={[cardStyles.multiMetaText, { color: colors.textSecondary }]}>| {scheduleText}</Text> : null}
        </View>
        {isStaff ? (
          <StaffCardFooter
            variant={variant}
            onPress={() => navigateToCourse(course, onPress)}
            assignmentSubjects={assignmentSubjects}
          >
            <View style={cardStyles.multiEnrolledStats}>
              {(() => {
                const counts = getMultiSubjectContentCounts(course);
                return (
                  <>
                    <Text style={[cardStyles.multiEnrolledStatText, { color: colors.textSecondary }]}>{counts.lectures} Lectures</Text>
                    <Text style={[cardStyles.multiEnrolledStatText, { color: colors.textSecondary }]}>{counts.tests} Tests</Text>
                    <Text style={[cardStyles.multiEnrolledStatText, { color: colors.textSecondary }]}>{counts.materials} Materials</Text>
                  </>
                );
              })()}
            </View>
          </StaffCardFooter>
        ) : enrolled ? (
          <View style={[cardStyles.multiPriceRow, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <CourseProgressBar
                progress={Number(course.progress) || 0}
                color={getCourseAccentColor(course.id)}
                colors={{ surfaceAlt: colors.surfaceAlt, textMuted: colors.textMuted }}
              />
            </View>
            <Pressable style={cardStyles.multiArrowBtn} onPress={() => router.push(getCourseExplorePath(course) as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        ) : (
          <View style={cardStyles.multiPriceRow}>
            {course.is_free || parseFloat(course.price || "0") <= 0 ? (
              <Text style={cardStyles.multiPrice}>Free</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={cardStyles.multiPrice}>₹{parseFloat(course.price || "0").toFixed(0)}</Text>
                {parseFloat(course.original_price || "0") > 0 ? <Text style={cardStyles.multiOriginalPrice}>₹{parseFloat(course.original_price || "0").toFixed(0)}</Text> : null}
              </View>
            )}
            {discount > 0 ? <Text style={cardStyles.multiDiscount}>{discount}% OFF</Text> : null}
            <View style={{ flex: 1 }} />
            <Pressable
              style={cardStyles.multiBuyBtn}
              disabled={isPending}
              onPress={(e) => {
                e?.stopPropagation?.();
                purchase();
              }}
            >
              <LinearGradient colors={["#B91C1C", "#EF4444"]} style={cardStyles.multiBuyGradient}>
                <Text style={cardStyles.multiBuyText}>
                  {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={cardStyles.multiArrowBtn} onPress={() => router.push(getCourseExplorePath(course) as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        )}
      </View>
      {isStaff ? null : paymentModal}
    </Pressable>
  );
}

function getNormalCourseDateRange(course: Course): string {
  if (!course.start_date && !course.end_date) return "";
  const start = formatCourseDate(course.start_date) || "TBD";
  const end = formatCourseDate(course.end_date) || "TBD";
  return `${start} → ${end}`;
}

function NormalCourseCard({
  course,
  enrolled = false,
  variant = "student",
  onPress,
  assignmentSubjects,
}: {
  course: Course;
  enrolled?: boolean;
  variant?: CourseCardVariant;
  onPress?: () => void;
  assignmentSubjects?: string[];
}) {
  const { colors } = useAppTheme();
  const isStaff = variant === "staff";
  const livePulse = React.useRef(new Animated.Value(1)).current;
  const color = getCourseAccentColor(course.id);
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price || "0") > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price || "0") / parseFloat(course.original_price || "0")) * 100)
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
        Animated.timing(livePulse, { toValue: 0.35, duration: 650, useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(livePulse, { toValue: 1, duration: 650, useNativeDriver: Platform.OS !== "web" }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [livePulse, status]);

  return (
    <Pressable
      style={({ pressed }) => [cardStyles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => navigateToCourse(course, onPress)}
    >
      <CourseBanner course={course} />
      <View style={[cardStyles.multiCourseBody, { backgroundColor: colors.card }]}>
        <View style={cardStyles.multiTopRow}>
          <View style={[cardStyles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={[cardStyles.multiCategory, { color }]}>{course.category || "Course"}</Text>
            <Text style={cardStyles.multiLevel}>{level}</Text>
          </View>
          <View style={cardStyles.multiTopRightGroup}>
            {enrolled ? (
              <View style={cardStyles.multiEnrolledBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#22C55E" />
                <Text style={cardStyles.multiEnrolledBadgeText}>Enrolled</Text>
              </View>
            ) : null}
            <View style={cardStyles.multiLanguagePill}><Text style={cardStyles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        <Text style={[cardStyles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
        {(course.teacher_name || course.subject) ? (
          <View style={cardStyles.courseTeacherRow}>
            <Ionicons name="person" size={12} color={colors.textSecondary} />
            <Text style={[cardStyles.courseTeacher, { color: colors.textSecondary }]} numberOfLines={1}>
              {course.teacher_name || ""}
              {course.teacher_name && course.subject ? "  |  " : ""}
              {course.subject ? `Subject - ${course.subject}` : ""}
            </Text>
          </View>
        ) : null}
        <NormalCourseCardStats course={course} color={color} colors={colors} muted />
        <View style={cardStyles.multiMetaRow}>
          {status === "LIVE" ? (
            <Animated.View style={[cardStyles.multiLiveDot, { opacity: livePulse, transform: [{ scale: livePulse }] }]} />
          ) : null}
          <Text
            style={[
              cardStyles.multiMetaText,
              status === "LIVE" && cardStyles.multiStatusText,
              status === "UPCOMING" && { color: "#D97706", fontFamily: "Inter_700Bold" },
              status === "RECORDED" && { color: "#7C3AED", fontFamily: "Inter_700Bold" },
            ]}
          >
            {status}
          </Text>
          {dateRange ? (
            <>
              <Text style={[cardStyles.multiMetaText, { color: colors.textMuted }]}>|</Text>
              <Ionicons name="calendar-outline" size={12} color={colors.textMuted} />
              <Text style={[cardStyles.multiMetaText, { color: colors.textMuted }]}>{dateRange}</Text>
            </>
          ) : null}
        </View>
        {isStaff ? (
          <StaffCardFooter
            variant={variant}
            onPress={() => navigateToCourse(course, onPress)}
            assignmentSubjects={assignmentSubjects}
          />
        ) : enrolled ? (
          <View style={[cardStyles.multiPriceRow, { alignItems: "center" }]}>
            <View style={{ flex: 1 }}>
              <CourseProgressBar
                progress={Number(course.progress) || 0}
                color={color}
                colors={{ surfaceAlt: colors.surfaceAlt, textMuted: colors.textMuted }}
              />
            </View>
            <Pressable style={cardStyles.multiArrowBtn} onPress={() => router.push(explorePath as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        ) : (
          <View style={cardStyles.multiPriceRow}>
            {course.is_free || parseFloat(course.price || "0") <= 0 ? (
              <Text style={cardStyles.multiPrice}>Free</Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={cardStyles.multiPrice}>₹{parseFloat(course.price || "0").toFixed(0)}</Text>
                {parseFloat(course.original_price || "0") > 0 ? <Text style={cardStyles.multiOriginalPrice}>₹{parseFloat(course.original_price || "0").toFixed(0)}</Text> : null}
              </View>
            )}
            {discount > 0 ? <Text style={cardStyles.multiDiscount}>{discount}% OFF</Text> : null}
            <View style={{ flex: 1 }} />
            <Pressable
              style={cardStyles.multiBuyBtn}
              disabled={isPending}
              onPress={(e) => {
                e?.stopPropagation?.();
                purchase();
              }}
            >
              <LinearGradient colors={["#B91C1C", "#EF4444"]} style={cardStyles.multiBuyGradient}>
                <Text style={cardStyles.multiBuyText}>
                  {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
                </Text>
              </LinearGradient>
            </Pressable>
            <Pressable style={cardStyles.multiArrowBtn} onPress={() => router.push(explorePath as any)}>
              <Ionicons name="chevron-forward" size={18} color="#0F172A" />
            </Pressable>
          </View>
        )}
      </View>
      {isStaff ? null : paymentModal}
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

function TestSeriesHomeCard({
  course,
  variant = "student",
  onPress,
  assignmentSubjects,
}: {
  course: Course;
  variant?: CourseCardVariant;
  onPress?: () => void;
  assignmentSubjects?: string[];
}) {
  const { colors } = useAppTheme();
  const isStaff = variant === "staff";
  const color = getCourseAccentColor(course.id);
  const isFreeCourse = course.is_free || parseFloat(course.price || "0") <= 0;
  const { purchase, isPending, paymentModal } = useCoursePurchase({
    courseId: course.id,
    courseTitle: course.title,
    isFree: isFreeCourse,
    price: course.price,
  });
  const discount = course.original_price && parseFloat(course.original_price || "0") > 0 && parseFloat(course.price || "0") > 0
    ? Math.round((1 - parseFloat(course.price || "0") / parseFloat(course.original_price || "0")) * 100)
    : 0;
  const language = (course.course_language || "HINGLISH").toUpperCase();
  const level = course.level || "Beginner";
  const cardMetaLine = getTestSeriesCardMetaLine(course);
  const tests = getTestSeriesRegularCount(course);
  const practice = Number(course.practice_count) || 0;
  const pyq = Number(course.pyq_count) || 0;
  const mock = Number(course.mock_count) || 0;
  const explorePath = getCourseExplorePath(course);

  return (
    <Pressable
      style={({ pressed }) => [cardStyles.multiCourseCard, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.94, transform: [{ scale: 0.985 }] }]}
      onPress={() => navigateToCourse(course, onPress)}
    >
      <CourseBanner course={course} />
      <View style={[cardStyles.multiCourseBody, { backgroundColor: colors.card }]}>
        <View style={cardStyles.multiTopRow}>
          <View style={[cardStyles.multiBadgeRow, { flexShrink: 1 }]}>
            <Text style={[cardStyles.multiCategory, { color }]}>{getCourseCategoryLabel(course)}</Text>
            <Text style={cardStyles.multiLevel}>{level}</Text>
          </View>
          <View style={cardStyles.multiTopRightGroup}>
            <View style={cardStyles.multiLanguagePill}><Text style={cardStyles.multiLanguageText}>{language}</Text></View>
          </View>
        </View>
        {cardMetaLine ? (
          <Text style={[cardStyles.multiMetaText, { color: colors.textSecondary }]} numberOfLines={1}>{cardMetaLine}</Text>
        ) : null}
        <Text style={[cardStyles.multiTitle, { color: colors.text }]} numberOfLines={2}>{course.title}</Text>
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
        {isStaff ? (
          <StaffCardFooter
            variant={variant}
            onPress={() => navigateToCourse(course, onPress)}
            assignmentSubjects={assignmentSubjects}
          />
        ) : (
        <View style={cardStyles.multiPriceRow}>
          {isFreeCourse ? (
            <Text style={cardStyles.multiPrice}>Free</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
              <Text style={cardStyles.multiPrice}>₹{parseFloat(course.price || "0").toFixed(0)}</Text>
              {parseFloat(course.original_price || "0") > 0 ? <Text style={cardStyles.multiOriginalPrice}>₹{parseFloat(course.original_price || "0").toFixed(0)}</Text> : null}
            </View>
          )}
          {discount > 0 ? <Text style={cardStyles.multiDiscount}>{discount}% OFF</Text> : null}
          <View style={{ flex: 1 }} />
          <Pressable
            style={cardStyles.multiBuyBtn}
            disabled={isPending}
            onPress={(e) => {
              e?.stopPropagation?.();
              purchase();
            }}
          >
            <LinearGradient colors={["#B91C1C", "#EF4444"]} style={cardStyles.multiBuyGradient}>
              <Text style={cardStyles.multiBuyText}>
                {isPending ? "Please wait..." : isFreeCourse ? "Start Free" : "Buy Now"}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
        )}
      </View>
      {isStaff ? null : paymentModal}
    </Pressable>
  );
}

export function EnrolledCourseCard({ course, index, ...rest }: CourseCardProps) {
  return <CourseCard course={{ ...course, isEnrolled: true }} index={index} {...rest} />;
}

export function CourseCard({ course, index, variant = "student", onPress, assignmentSubjects }: CourseCardProps) {
  const common = { variant, onPress, assignmentSubjects };
  if (course.course_type === "multi_subject") {
    return <MultiSubjectCourseCard course={course} enrolled={!!course.isEnrolled} {...common} />;
  }

  if (course.course_type !== "test_series") {
    return <NormalCourseCard course={course} enrolled={!!course.isEnrolled} {...common} />;
  }

  return <TestSeriesHomeCard course={course} {...common} />;
}

export { ScheduledLiveCard };

const cardStyles = StyleSheet.create({
  multiCourseCard: {
    borderRadius: 20, overflow: "hidden", borderWidth: 1, marginBottom: 14, minHeight: 294,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4,
  },
  multiCourseBody: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  multiTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  multiBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, flexWrap: "wrap" },
  multiTopRightGroup: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: 8 },
  multiCategory: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#DC2626", textTransform: "uppercase" },
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
  multiEnrolledStatText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  multiPrice: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  multiOriginalPrice: { fontSize: 12, fontFamily: "Inter_400Regular", color: "#64748B", textDecorationLine: "line-through" },
  multiDiscount: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" },
  multiBuyBtn: { borderRadius: 8, overflow: "hidden" },
  multiBuyGradient: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 8 },
  multiBuyText: { color: "#fff", fontSize: 12, fontFamily: "Inter_700Bold" },
  multiArrowBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  courseTeacherRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  courseTeacher: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", flexShrink: 1 },
});
