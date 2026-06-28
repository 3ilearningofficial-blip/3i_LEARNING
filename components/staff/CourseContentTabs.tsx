import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { LiveClassSchedulePanel } from "./LiveClassSchedulePanel";

type Props = {
  course: any;
  assignment: any;
  lectures: any[];
  tests: any[];
  materials: any[];
  liveClasses: any[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
};

const BASE_TABS = ["Lectures", "Tests", "Mock", "Materials"];
const MULTI_EXTRA = ["Practice", "PYQ"];

export function CourseContentTabs({
  course,
  assignment,
  lectures,
  tests,
  materials,
  liveClasses,
  activeTab,
  onTabChange,
  onRefresh,
}: Props) {
  const isMulti = String(course?.course_type || "").toLowerCase() === "multi_subject";
  const tabs = isMulti ? [...BASE_TABS, ...MULTI_EXTRA] : BASE_TABS;

  const filterTests = (type: string) =>
    tests.filter((t) => String(t.test_type || "practice").toLowerCase() === type);

  const listForTab = () => {
    if (activeTab === "Lectures") return lectures;
    if (activeTab === "Tests") return filterTests("practice").concat(filterTests("test"));
    if (activeTab === "Mock") return filterTests("mock");
    if (activeTab === "Practice") return filterTests("practice");
    if (activeTab === "PYQ") return filterTests("pyq");
    if (activeTab === "Materials") return materials;
    return [];
  };

  const items = listForTab();

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
          <Pressable key={t} style={[styles.tab, activeTab === t && styles.tabActive]} onPress={() => onTabChange(t)}>
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }}>
        {activeTab === "Lectures" ? (
          <>
            <Text style={styles.hint}>View lectures only. Upload recorded lectures is not permitted.</Text>
            {lectures.map((l) => (
              <View key={l.id} style={styles.row}>
                <Ionicons name="play-circle" size={18} color={Colors.light.primary} />
                <Text style={styles.rowTitle}>{l.title}</Text>
              </View>
            ))}
          </>
        ) : (
          items.map((item) => (
            <View key={item.id} style={styles.row}>
              <Ionicons name="document-text" size={18} color={Colors.light.primary} />
              <Text style={styles.rowTitle}>{item.title}</Text>
            </View>
          ))
        )}
        {items.length === 0 && activeTab !== "Lectures" && (
          <Text style={styles.hint}>No {activeTab.toLowerCase()} in your scope yet.</Text>
        )}
        {activeTab !== "Lectures" && (
          <Pressable
            style={styles.addBtn}
            onPress={() => router.push(`/staff/courses/${course.id}?add=${activeTab.toLowerCase()}` as any)}
          >
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
  tabActive: { backgroundColor: Colors.light.primary + "22" },
  tabText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.light.textSecondary },
  tabTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(0,0,0,0.08)" },
  rowTitle: { fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 },
  hint: { color: Colors.light.textMuted, fontFamily: "Inter_400Regular", fontSize: 13, marginVertical: 8 },
  addBtn: { marginTop: 12, backgroundColor: Colors.light.primary, borderRadius: 10, padding: 12, alignItems: "center" },
  addBtnText: { color: "#fff", fontFamily: "Inter_700Bold" },
});
