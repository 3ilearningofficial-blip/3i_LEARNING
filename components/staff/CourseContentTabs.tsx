import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { LiveClassSchedulePanel } from "./LiveClassSchedulePanel";
import { CourseFolderSectionList } from "@/components/course/CourseFolderSectionList";
import {
  ContentFolderKind,
  getStaffTestsForTab,
  staffFolderRoute,
} from "@/lib/course-content-layout";

type Props = {
  course: any;
  assignment: any;
  lectures: any[];
  tests: any[];
  materials: any[];
  liveClasses: any[];
  courseFolders?: any[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
};

const BASE_TABS = ["Lectures", "Tests", "Mock", "Materials"];
const MULTI_EXTRA = ["Practice", "PYQ"];

const TEST_TAB_COLORS: Record<string, { color: string; iconBg: string; testType?: string }> = {
  Tests: { color: "#059669", iconBg: "#D1FAE5", testType: "regular" },
  Mock: { color: "#DC2626", iconBg: "#FEE2E2", testType: "mock" },
  Practice: { color: "#1A56DB", iconBg: "#EEF2FF", testType: "practice" },
  PYQ: { color: "#F59E0B", iconBg: "#FEF3C7", testType: "pyq" },
};

export function CourseContentTabs({
  course,
  assignment,
  lectures,
  tests,
  materials,
  liveClasses,
  courseFolders = [],
  activeTab,
  onTabChange,
  onRefresh,
}: Props) {
  const { colors } = useAppTheme();
  const isMulti = String(course?.course_type || "").toLowerCase() === "multi_subject";
  const tabs = isMulti ? [...BASE_TABS, ...MULTI_EXTRA] : BASE_TABS;
  const courseId = course.id;

  const openFolder = (type: ContentFolderKind, folder: { name: string; color: string }, testType?: string) => {
    router.push(staffFolderRoute(courseId, type, folder.name, { color: folder.color, testType }) as any);
  };

  const renderTabContent = () => {
    if (activeTab === "Lectures") {
      return (
        <>
          <Text style={[styles.hint, { color: colors.textMuted }]}>
            View lectures only. Upload recorded lectures is not permitted.
          </Text>
          <CourseFolderSectionList
            items={lectures}
            type="lectures"
            courseFolders={courseFolders}
            mode="staff"
            emptyIcon="videocam-outline"
            emptyText="No lectures in your scope yet."
            onOpenFolder={(folder) => openFolder("lectures", folder)}
            onOpenItem={(item) =>
              router.push({
                pathname: "/lecture/[id]",
                params: { id: item.id, courseId: String(courseId), videoUrl: item.video_url || "", title: item.title },
              } as any)
            }
          />
        </>
      );
    }

    if (activeTab === "Materials") {
      return (
        <CourseFolderSectionList
          items={materials}
          type="materials"
          courseFolders={courseFolders}
          mode="staff"
          emptyIcon="folder-open-outline"
          emptyText="No materials in your scope yet."
          onOpenFolder={(folder) => openFolder("materials", folder)}
        />
      );
    }

    const tabTests = getStaffTestsForTab(tests, activeTab, course?.course_type);
    const palette = TEST_TAB_COLORS[activeTab] || TEST_TAB_COLORS.Tests;
    return (
      <CourseFolderSectionList
        items={tabTests}
        type="tests"
        folderColor={palette.color}
        folderIconBg={palette.iconBg}
        mode="staff"
        emptyIcon="document-text-outline"
        emptyText={`No ${activeTab.toLowerCase()} in your scope yet.`}
        onOpenFolder={(folder) => openFolder("tests", folder, palette.testType)}
      />
    );
  };

  const canAdd = activeTab !== "Lectures";

  return (
    <View style={{ flex: 1 }}>
      <LiveClassSchedulePanel
        courseId={course.id}
        assignment={assignment}
        liveClasses={liveClasses}
        onScheduled={onRefresh}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
        {tabs.map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, activeTab === t && { backgroundColor: Colors.light.primary + "22" }]}
            onPress={() => onTabChange(t)}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {renderTabContent()}
        {canAdd && (
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push(`/staff/courses/${course.id}?add=${activeTab.toLowerCase()}` as any)}
          >
            <Ionicons name="add-circle" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add {activeTab}</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: { maxHeight: 44, marginVertical: 10 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.06)" },
  tabText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  hint: { fontFamily: "Inter_400Regular", fontSize: 13, marginVertical: 8, paddingHorizontal: 16 },
  addBtn: {
    marginTop: 4,
    marginHorizontal: 16,
    backgroundColor: Colors.light.primary,
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  addBtnText: { color: "#fff", fontFamily: "Inter_700Bold" },
});
