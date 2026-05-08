import React, { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Platform, ActivityIndicator, Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { authFetch, getApiUrl } from "@/lib/query-client";
import {
  liveClassesForCourseQueryKey,
  myAttemptsSummaryQueryKey,
} from "@/lib/query-keys";
import Colors from "@/constants/colors";
import { useScreenProtection } from "@/lib/useScreenProtection";
import { useAuth } from "@/context/AuthContext";
import { DownloadButton } from "@/components/DownloadButton";
import { DEFAULT_LIVE_RECORDING_SECTION } from "@/lib/recordingSection";
import { useDocumentVisibility } from "@/lib/useDocumentVisibility";

type FolderType = "lectures" | "materials" | "live" | "tests";

interface Lecture {
  id: number;
  title: string;
  description?: string;
  video_url: string;
  video_type?: string;
  duration_minutes: number;
  order_index?: number;
  is_free_preview?: boolean;
  section_title?: string;
  isCompleted?: boolean;
  pdf_url?: string;
  download_allowed?: boolean;
  created_at?: number;
}

interface CourseTest {
  id: number;
  title: string;
  duration_minutes: number;
  total_questions: number;
  total_marks: number;
  test_type: string;
  folder_name?: string;
}

interface Material {
  id: number;
  title: string;
  description?: string;
  file_url: string;
  file_type: string;
  section_title?: string;
  download_allowed?: boolean;
}

interface LiveClass {
  id: number;
  title: string;
  description?: string;
  youtube_url: string;
  is_live: boolean;
  is_completed: boolean;
  scheduled_at: number;
  ended_at?: number;
  duration_minutes?: number;
  section_title?: string;
}

interface CourseDetail {
  id: number;
  title: string;
  is_free: boolean;
  isEnrolled: boolean;
  lectures: Lecture[];
  tests: CourseTest[];
  materials: Material[];
}

const TEST_TYPE_COLORS: Record<string, string> = {
  mock: "#DC2626", practice: "#1A56DB", chapter: "#059669", weekly: "#7C3AED", test: "#059669", pyq: "#F59E0B",
};

const TEST_SECTIONS = [
  { key: "practice", label: "Practice", icon: "fitness" as const, color: "#1A56DB" },
  { key: "test", label: "Test", icon: "document-text" as const, color: "#059669" },
  { key: "pyq", label: "PYQs", icon: "time" as const, color: "#F59E0B" },
  { key: "mock", label: "Mock", icon: "trophy" as const, color: "#DC2626" },
];

export default function CourseFolderScreen() {
  useScreenProtection(true);
  const params = useLocalSearchParams<{
    id: string;
    type: string;
    name: string;
    color?: string;
  }>();
  const id = String(params.id || "");
  const type = String(params.type || "") as FolderType;
  const folderName = decodeURIComponent(String(params.name || ""));
  const color = String(params.color || Colors.light.primary);

  const insets = useSafeAreaInsets();
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = Platform.OS === "web" ? 16 : insets.bottom;

  const { user, isAdmin } = useAuth();
  const tabVisible = useDocumentVisibility();
  const [folderTestTypeFilter, setFolderTestTypeFilter] = useState<string>("all");

  const courseDetailUserSegment = String(user?.id ?? "guest");

  /** Same key as /course/[id] so the cache is shared and there is no extra request when arriving from the course screen. */
  const { data: course, isLoading } = useQuery<CourseDetail>({
    queryKey: ["/api/courses", String(id), courseDetailUserSegment],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL(`/api/courses/${id}`, baseUrl);
      if (user?.id) url.searchParams.set("_uid", String(user.id));
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error("Failed to load course");
      return res.json();
    },
    staleTime: 20 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchInterval: tabVisible ? 60_000 : 5 * 60_000,
    enabled: !!id && id !== "undefined",
  });

  const { data: liveClasses = [] } = useQuery<LiveClass[]>({
    queryKey: liveClassesForCourseQueryKey(id),
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/live-classes?courseId=${id}`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user && !!id && id !== "undefined" && type === "live",
    staleTime: 10_000,
    gcTime: 15 * 60 * 1000,
  });

  const { data: attemptSummary = {} } = useQuery<Record<number, any>>({
    queryKey: user?.id ? myAttemptsSummaryQueryKey(user.id) : ["/api/my-attempts/summary", "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-attempts/summary", baseUrl).toString());
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!user?.id && type === "tests",
    staleTime: 30_000,
  });

  const { data: courseFolders = [] } = useQuery<any[]>({
    queryKey: ["/api/courses", String(id), "folders"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/courses/${id}/folders`, baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!id && id !== "undefined" && type === "lectures",
  });

  const liveClassesForTab = useMemo(() => {
    return (liveClasses || []).filter((lc) => {
      if (lc.is_live) return true;
      if (lc.is_completed) return false;
      return true;
    });
  }, [liveClasses]);

  const getDirectLectureSubfolders = (parentName: string): string[] => {
    const prefix = `${parentName} / `;
    const fromLectures = (course?.lectures || [])
      .map((l: any) => l.section_title)
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${parentName} / ${head}` : "";
      })
      .filter(Boolean);
    const fromFolders = (courseFolders || [])
      .filter((f: any) => f.type === "lecture")
      .map((f: any) => f.name)
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${parentName} / ${head}` : "";
      })
      .filter(Boolean);
    return [...new Set([...fromLectures, ...fromFolders])];
  };

  const goToCourse = () => {
    router.replace({ pathname: "/course/[id]", params: { id: String(id) } });
  };

  /** Send the user back to the course screen, which owns the enroll/buy flow. */
  const promptLockedCourseContent = () => {
    if (!course) {
      goToCourse();
      return;
    }
    Alert.alert(
      course.is_free ? "Enroll Required" : "Purchase Required",
      course.is_free
        ? "Please enroll in this course to access this content."
        : "Please purchase this course to access this content.",
      [
        { text: "Cancel", style: "cancel" },
        { text: course.is_free ? "Enroll Free" : "Buy Now", onPress: goToCourse },
      ],
    );
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else goToCourse();
  };

  const openSubfolder = (childName: string) => {
    router.push({
      pathname: "/course-folder/[id]/[type]/[name]",
      params: { id, type: "lectures", name: encodeURIComponent(childName), color },
    } as any);
  };

  const handleLecture = (lecture: Lecture) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: "/lecture/[id]",
      params: { id: lecture.id, courseId: id, videoUrl: lecture.video_url || "", title: lecture.title },
    } as any);
  };

  const items: any[] = useMemo(() => {
    if (!course) return [];
    if (type === "lectures") {
      return (course.lectures || []).filter((l: any) => {
        const sec = String(l.section_title || "");
        return sec === folderName || sec.startsWith(`${folderName} /`);
      });
    }
    if (type === "materials") {
      return (course.materials || []).filter((m: any) => String(m.section_title || "") === folderName);
    }
    if (type === "live") {
      return (liveClassesForTab || []).filter((lc: any) => String((lc as any).section_title || "") === folderName);
    }
    if (type === "tests") {
      const tests = course.tests || [];
      const byFolder = tests.filter((t: any) => String(t.folder_name || "") === folderName);
      if (byFolder.length > 0) return byFolder;
      const sectionKey = TEST_SECTIONS.find((s) => s.label === folderName)?.key;
      return sectionKey ? tests.filter((t: any) => t.test_type === sectionKey && !t.folder_name) : [];
    }
    return [];
  }, [course, liveClassesForTab, type, folderName]);

  const renderTestItem = (test: CourseTest) => {
    const tColor = TEST_TYPE_COLORS[test.test_type] || Colors.light.primary;
    const attempt = (attemptSummary as Record<number, any>)[test.id];
    const isLocked = !!(course && !isAdmin && !course.isEnrolled);
    const onPress = () => {
      if (isLocked) {
        promptLockedCourseContent();
        return;
      }
      if (attempt) {
        router.push({
          pathname: "/test-result/[id]",
          params: {
            id: String(test.id),
            score: String(attempt.score ?? 0),
            totalMarks: String(attempt.total_marks ?? 0),
            correct: String(attempt.correct ?? 0),
            incorrect: String(attempt.incorrect ?? 0),
            totalAttempts: String(attempt.attempted ?? 0),
            totalQuestions: String(test.total_questions),
            percentage: String(attempt.percentage ?? "0"),
            weakTopics: "",
            attemptId: String(attempt.attempt_id ?? ""),
            testType: test.test_type ?? "",
            timeTakenSeconds: String(attempt.time_taken_seconds ?? 0),
          },
        } as any);
      } else {
        router.push(`/test/${test.id}` as any);
      }
    };
    return (
      <Pressable
        key={test.id}
        style={({ pressed }) => [styles.testCard, isLocked && { opacity: 0.6 }, pressed && !isLocked && { opacity: 0.85 }]}
        onPress={onPress}
      >
        <View style={[styles.testColorBar, { backgroundColor: tColor }]} />
        <View style={styles.testItemIcon}>
          <Ionicons name="document-text" size={22} color={tColor} />
        </View>
        <View style={styles.testItemInfo}>
          <Text style={styles.testItemTitle}>{test.title}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Text style={styles.testItemMeta}>
              {test.total_questions} questions · {test.duration_minutes}min · {test.total_marks} marks
            </Text>
            {attempt && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#DCFCE7", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Ionicons name="checkmark-circle" size={11} color="#16A34A" />
                <Text style={{ fontSize: 10, fontFamily: "Inter_700Bold", color: "#16A34A" }}>
                  {attempt.score}/{attempt.total_marks}
                </Text>
              </View>
            )}
          </View>
        </View>
        {isLocked ? (
          <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} />
        ) : attempt ? (
          <Ionicons name="bar-chart" size={18} color={Colors.light.primary} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        )}
      </Pressable>
    );
  };

  if (isLoading || !course) {
    return (
      <View style={styles.container}>
        <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
          <Pressable style={styles.backBtn} onPress={goBack}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{folderName || "Folder"}</Text>
          </View>
        </LinearGradient>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.light.primary} />
        </View>
      </View>
    );
  }

  const isLocked = !isAdmin && !course.isEnrolled;
  const itemLabel =
    type === "lectures" ? (items.length === 1 ? "video" : "videos")
      : type === "materials" ? (items.length === 1 ? "file" : "files")
      : type === "tests" ? (items.length === 1 ? "test" : "tests")
      : (items.length === 1 ? "class" : "classes");

  // For lectures, separate subfolders and leaf items at this folder level
  const subfolders = type === "lectures" ? getDirectLectureSubfolders(folderName) : [];
  const leafLectures = type === "lectures"
    ? items.filter((l: any) => l.section_title === folderName)
    : [];

  // For tests, apply chip filter
  const filteredTests = type === "tests"
    ? (folderTestTypeFilter === "all" ? items : items.filter((t: any) => t.test_type === folderTestTypeFilter))
    : items;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{folderName}</Text>
          <Text style={styles.headerSubtitle}>{items.length} {itemLabel}</Text>
        </View>
        {isLocked && (
          <View style={styles.lockChip}>
            <Ionicons name="lock-closed" size={14} color="#FCA5A5" />
            <Text style={styles.lockChipText}>Locked</Text>
          </View>
        )}
      </LinearGradient>

      {isLocked && (
        <View style={styles.lockBanner}>
          <Ionicons name="lock-closed" size={18} color="#D97706" />
          <Text style={styles.lockBannerText}>Enroll in this course to access all content</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={{ paddingBottom: bottomPadding + 20 }}>
        {/* Lecture subfolders */}
        {type === "lectures" && subfolders.map((childName) => {
          const childItems = (course.lectures || []).filter((l: any) => {
            const sec = String(l.section_title || "");
            return sec === childName || sec.startsWith(`${childName} /`);
          });
          return (
            <Pressable
              key={childName}
              style={[styles.testSectionCard, { marginHorizontal: 12, marginTop: 12, borderLeftColor: color }]}
              onPress={() => openSubfolder(childName)}
            >
              <View style={[styles.testSectionIconWrap, { backgroundColor: color + "18" }]}>
                <Ionicons name="folder" size={22} color={color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.testSectionTitle}>{childName.replace(`${folderName} / `, "")}</Text>
                <Text style={styles.testSectionCount}>{childItems.length} {childItems.length === 1 ? "video" : "videos"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
            </Pressable>
          );
        })}

        {/* Leaf lectures at the current folder level */}
        {type === "lectures" && leafLectures.map((lecture: Lecture, idx: number) => {
          return (
            <View key={lecture.id} style={styles.lectureItem}>
              <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }} onPress={() => {
                if (isLocked) {
                  promptLockedCourseContent();
                  return;
                }
                handleLecture(lecture);
              }}>
                <View style={[styles.lectureNumber, lecture.isCompleted && styles.lectureNumberDone]}>
                  {lecture.isCompleted ? <Ionicons name="checkmark" size={16} color="#fff" /> : <Text style={styles.lectureNumberText}>{idx + 1}</Text>}
                </View>
                <View style={styles.lectureInfo}>
                  <Text style={styles.lectureTitle}>{lecture.title}</Text>
                  <View style={styles.lectureMetaRow}>
                    <Ionicons name="time-outline" size={12} color={Colors.light.textMuted} />
                    <Text style={styles.lectureMeta}>
                      {typeof lecture.section_title === "string" &&
                      lecture.section_title.startsWith(DEFAULT_LIVE_RECORDING_SECTION) &&
                      lecture.created_at
                        ? `${new Date(Number(lecture.created_at)).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })} · ${lecture.duration_minutes > 0 ? `${lecture.duration_minutes} min` : "—"}`
                        : lecture.duration_minutes > 0
                          ? `${lecture.duration_minutes} min`
                          : "—"}
                    </Text>
                    {lecture.is_free_preview && <View style={styles.previewBadge}><Text style={styles.previewBadgeText}>Preview</Text></View>}
                  </View>
                </View>
                {isLocked ? <Ionicons name="lock-closed" size={18} color={Colors.light.textMuted} /> : <Ionicons name="play-circle" size={22} color={color} />}
              </Pressable>
              <DownloadButton
                itemType="lecture"
                itemId={lecture.id}
                downloadAllowed={lecture.download_allowed || false}
                isEnrolled={course.isEnrolled}
                title={lecture.title || "Lecture"}
                fileType={lecture.pdf_url && !lecture.video_url ? "pdf" : "video"}
              />
            </View>
          );
        })}

        {type === "lectures" && subfolders.length === 0 && leafLectures.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.emptyText}>No lectures in this folder yet</Text>
          </View>
        )}

        {/* Materials */}
        {type === "materials" && items.map((mat: Material) => (
          <View key={mat.id} style={[styles.materialItem, isLocked && { opacity: 0.5 }]}>
            <Pressable style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12 }}
              onPress={() => {
                if (isLocked) {
                  promptLockedCourseContent();
                  return;
                }
                router.push(`/material/${mat.id}` as any);
              }}>
              <View style={styles.materialIcon}>
                <Ionicons
                  name={isLocked ? "lock-closed" : mat.file_type === "video" ? "videocam" : mat.file_type === "link" ? "link" : "document-text"}
                  size={22}
                  color={isLocked ? Colors.light.textMuted : "#DC2626"}
                />
              </View>
              <View style={styles.materialInfo}>
                <Text style={styles.materialTitle}>{mat.title}</Text>
                {mat.description && <Text style={styles.materialDesc} numberOfLines={1}>{mat.description}</Text>}
                <Text style={styles.materialType}>{(mat.file_type || "pdf").toUpperCase()}{!mat.download_allowed ? " · View Only" : ""}</Text>
              </View>
            </Pressable>
            <DownloadButton
              itemType="material"
              itemId={mat.id}
              downloadAllowed={mat.download_allowed || false}
              isEnrolled={course.isEnrolled}
              title={mat.title || "Material"}
              fileType={mat.file_type || "pdf"}
            />
          </View>
        ))}

        {type === "materials" && items.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.emptyText}>No materials in this folder yet</Text>
          </View>
        )}

        {/* Tests */}
        {type === "tests" && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", maxHeight: 56 }}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexDirection: "row" }}
            >
              <Pressable
                style={[styles.filterChip, folderTestTypeFilter === "all" && styles.filterChipActive]}
                onPress={() => setFolderTestTypeFilter("all")}
              >
                <Text style={[styles.filterChipText, folderTestTypeFilter === "all" && styles.filterChipTextActive]}>
                  All ({items.length})
                </Text>
              </Pressable>
              {TEST_SECTIONS.map((s) => {
                const count = items.filter((t: any) => t.test_type === s.key).length;
                if (count === 0) return null;
                return (
                  <Pressable
                    key={s.key}
                    style={[styles.filterChip, folderTestTypeFilter === s.key && styles.filterChipActive, folderTestTypeFilter === s.key && { backgroundColor: s.color, borderColor: s.color }]}
                    onPress={() => setFolderTestTypeFilter(s.key)}
                  >
                    <Ionicons name={s.icon} size={13} color={folderTestTypeFilter === s.key ? "#fff" : s.color} />
                    <Text style={[styles.filterChipText, folderTestTypeFilter === s.key && { color: "#fff" }]}>
                      {s.label} ({count})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {filteredTests.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
                <Text style={styles.emptyText}>No tests in this category</Text>
              </View>
            ) : (
              filteredTests.map((test: CourseTest) => renderTestItem(test))
            )}
          </>
        )}

        {/* Live classes */}
        {type === "live" && items.map((lc: LiveClass) => (
          <Pressable
            key={lc.id}
            style={({ pressed }) => [styles.liveClassItem, pressed && { opacity: 0.85 }]}
            onPress={() => {
              if (isLocked) {
                promptLockedCourseContent();
                return;
              }
              router.push({
                pathname: "/live-class/[id]",
                params: {
                  id: lc.id,
                  videoUrl: lc.youtube_url ?? "",
                  title: lc.title ?? "",
                  listIsLive: lc.is_live ? "1" : "0",
                },
              } as any);
            }}
          >
            <LinearGradient
              colors={lc.is_live ? ["#DC2626", "#EF4444"] : lc.is_completed ? ["#1A56DB", "#3B82F6"] : ["#6B7280", "#9CA3AF"]}
              style={styles.liveStatusBadge}
            >
              {lc.is_live ? (
                <><View style={styles.liveDot} /><Text style={styles.liveStatusText}>LIVE</Text></>
              ) : lc.is_completed ? (
                <Ionicons name="play" size={14} color="#fff" />
              ) : (
                <Ionicons name="time" size={14} color="#fff" />
              )}
            </LinearGradient>
            <View style={styles.liveClassInfo}>
              <Text style={styles.liveClassTitle}>{lc.title}</Text>
              {lc.description ? <Text style={styles.liveClassDesc} numberOfLines={1}>{lc.description}</Text> : null}
              <Text style={styles.liveClassTime}>
                {lc.is_live ? "Happening now" : lc.is_completed ? "Recording available" : new Date(Number(lc.scheduled_at)).toLocaleString()}
              </Text>
            </View>
            <Ionicons
              name={lc.is_live || lc.is_completed ? "play-circle" : "calendar"}
              size={24}
              color={lc.is_live ? "#DC2626" : lc.is_completed ? Colors.light.primary : Colors.light.textMuted}
            />
          </Pressable>
        ))}

        {type === "live" && items.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="videocam-outline" size={40} color={Colors.light.textMuted} />
            <Text style={styles.emptyText}>No live classes in this folder</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 16, paddingBottom: 14,
    flexDirection: "row", alignItems: "center", gap: 12,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSubtitle: { fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" },
  lockChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(239,68,68,0.2)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  lockChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FCA5A5" },
  lockBanner: {
    backgroundColor: "#FEF3C7", flexDirection: "row", alignItems: "center", gap: 10,
    padding: 12, borderBottomWidth: 1, borderBottomColor: "#FDE68A",
  },
  lockBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#92400E" },
  lectureItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  lectureNumber: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center",
  },
  lectureNumberDone: { backgroundColor: "#22C55E" },
  lectureNumberText: { fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary },
  lectureInfo: { flex: 1 },
  lectureTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  lectureMetaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  lectureMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  previewBadge: { backgroundColor: "#DCFCE7", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 },
  previewBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#15803D" },
  testCard: { flexDirection: "row", alignItems: "center", gap: 0, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  testColorBar: { width: 4, alignSelf: "stretch" },
  testItemIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center", margin: 12 },
  testItemInfo: { flex: 1, paddingVertical: 14, paddingRight: 12 },
  testItemTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 3 },
  testItemMeta: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  testSectionCard: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff",
    borderRadius: 14, padding: 16, borderLeftWidth: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 6, elevation: 2,
  },
  testSectionIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  testSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  testSectionCount: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  materialItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  materialIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#FEE2E2", alignItems: "center", justifyContent: "center" },
  materialInfo: { flex: 1 },
  materialTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  materialDesc: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginBottom: 2 },
  materialType: {
    fontSize: 10, fontFamily: "Inter_700Bold", color: "#DC2626",
    backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 4, alignSelf: "flex-start",
  },
  liveClassItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  liveStatusBadge: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
  liveStatusText: { fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" },
  liveClassInfo: { flex: 1 },
  liveClassTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  liveClassDesc: { fontSize: 12, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", marginBottom: 2 },
  liveClassTime: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#fff", borderWidth: 1, borderColor: Colors.light.border,
  },
  filterChipActive: { backgroundColor: Colors.light.primary, borderColor: Colors.light.primary },
  filterChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  filterChipTextActive: { color: "#fff" },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
});
