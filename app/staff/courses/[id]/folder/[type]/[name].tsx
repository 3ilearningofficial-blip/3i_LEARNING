import React, { useMemo } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LectureListPreview } from "@/components/LectureListPreview";
import { getContentFolderChildDisplayName } from "@shared/recordingSection";
import { courseFolderFullName } from "@shared/courseFolderOrder";

type FolderType = "lectures" | "tests" | "materials";

export default function StaffCourseFolderScreen() {
  const params = useLocalSearchParams<{
    id: string;
    type: string;
    name: string;
    color?: string;
    testType?: string;
  }>();
  const id = String(params.id || "");
  const type = String(params.type || "") as FolderType;
  const folderName = decodeURIComponent(String(params.name || ""));
  const color = String(params.color || Colors.light.primary);
  const routeTestType = String(params.testType || "").trim().toLowerCase();

  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const { data, isLoading } = useQuery({
    queryKey: ["/api/staff/courses", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/staff/courses/${id}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const courseFolders = data?.folders || [];

  const items = useMemo(() => {
    if (!data) return [];
    const testType = (t: string) => String(t || "").toLowerCase();
    if (type === "lectures") {
      return (data.lectures || []).filter((l: any) => {
        const sec = String(l.section_title || "");
        return sec === folderName || sec.startsWith(`${folderName} /`);
      });
    }
    if (type === "materials") {
      return (data.materials || []).filter((m: any) => {
        const sec = String(m.section_title || "");
        return sec === folderName || sec.startsWith(`${folderName} /`);
      });
    }
    const tests = (data.tests || []).filter((t: any) => {
      const tt = testType(t.test_type);
      if (routeTestType === "pyq") return tt === "pyq";
      if (routeTestType === "mock") return tt === "mock";
      if (routeTestType === "practice") return tt === "practice";
      if (routeTestType === "regular") return !["pyq", "mock"].includes(tt);
      return true;
    });
    return tests.filter((t: any) => {
      const fn = String(t.folder_name || "");
      return fn === folderName || fn.startsWith(`${folderName} /`);
    });
  }, [data, type, folderName, routeTestType]);

  const subfolders = useMemo(() => {
    const prefix = `${folderName} / `;
    const fromItems = items
      .map((row: any) => (type === "tests" ? row.folder_name : row.section_title))
      .filter((n: any) => typeof n === "string" && n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${folderName} / ${head}` : "";
      })
      .filter(Boolean);
    const folderType = type === "lectures" ? "lecture" : type === "materials" ? "material" : "test";
    const fromDb = courseFolders
      .filter((f: any) => f.type === folderType)
      .map((f: any) => courseFolderFullName(f))
      .filter((n: string) => n.startsWith(prefix))
      .map((n: string) => {
        const rest = n.slice(prefix.length);
        const head = rest.split(" / ")[0]?.trim();
        return head ? `${folderName} / ${head}` : "";
      })
      .filter(Boolean);
    return [...new Set([...fromItems, ...fromDb])];
  }, [items, courseFolders, folderName, type]);

  const directItems = useMemo(() => {
    if (type === "lectures") {
      return items.filter((l: any) => String(l.section_title || "") === folderName);
    }
    if (type === "materials") {
      return items.filter((m: any) => String(m.section_title || "") === folderName);
    }
    return items.filter((t: any) => String(t.folder_name || "") === folderName);
  }, [items, type, folderName]);

  const openSubfolder = (childName: string) => {
    router.push({
      pathname: "/staff/courses/[id]/folder/[type]/[name]",
      params: { id, type, name: encodeURIComponent(childName), color, testType: routeTestType },
    } as any);
  };

  if (isLoading || !data) {
    return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={colors.text} />
        <Text style={[styles.backText, { color: colors.text }]} numberOfLines={1}>{folderName}</Text>
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {subfolders.map((child) => (
          <Pressable
            key={child}
            style={[styles.folderCard, { backgroundColor: colors.card, borderLeftColor: color }]}
            onPress={() => openSubfolder(child)}
          >
            <Ionicons name="folder" size={20} color={color} />
            <Text style={[styles.folderTitle, { color: colors.text }]}>
              {getContentFolderChildDisplayName(child, folderName)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}

        {type === "lectures" ? (
          directItems.map((lecture: any, idx: number) => (
            <Pressable
              key={lecture.id}
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={() =>
                router.push({
                  pathname: "/lecture/[id]",
                  params: {
                    id: lecture.id,
                    courseId: id,
                    videoUrl: lecture.video_url || "",
                    title: lecture.title,
                  },
                } as any)
              }
            >
              <View style={styles.lectureNumber}>
                <Text style={styles.lectureNumberText}>{idx + 1}</Text>
              </View>
              <LectureListPreview
                videoUrl={lecture.video_url}
                pdfUrl={lecture.pdf_url}
                progressPercent={lecture.watch_percent}
                completed={lecture.isCompleted}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={2}>{lecture.title}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: "Inter_400Regular" }}>
                  {lecture.duration_minutes || 0} min
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          ))
        ) : (
          directItems.map((item: any) => (
            <View key={item.id} style={[styles.row, { borderBottomColor: colors.border }]}>
              <Ionicons name={type === "materials" ? "document" : "document-text"} size={18} color={Colors.light.primary} />
              <Text style={[styles.rowTitle, { color: colors.text }]}>{item.title}</Text>
            </View>
          ))
        )}

        {subfolders.length === 0 && directItems.length === 0 && (
          <Text style={[styles.empty, { color: colors.textMuted }]}>This folder is empty.</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  back: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  backText: { fontFamily: "Inter_700Bold", fontSize: 16, flex: 1 },
  folderCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  folderTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 15 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 },
  lectureNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#EEF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  lectureNumberText: { fontFamily: "Inter_700Bold", fontSize: 12, color: Colors.light.primary },
  empty: { textAlign: "center", padding: 24, fontFamily: "Inter_400Regular" },
});
