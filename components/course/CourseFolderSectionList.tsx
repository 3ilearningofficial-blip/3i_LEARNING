import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import {
  ContentFolderKind,
  FolderGroup,
  groupLecturesByFolder,
  groupMaterialsByFolder,
  groupTestsByFolder,
} from "@/lib/course-content-layout";

type Props = {
  items: any[];
  type: ContentFolderKind;
  courseFolders?: any[];
  folderColor?: string;
  folderIconBg?: string;
  onOpenFolder: (folder: FolderGroup) => void;
  onOpenItem?: (item: any) => void;
  mode?: "student" | "staff";
  renderUnfolderedItem?: (item: any) => React.ReactNode;
  emptyIcon?: keyof typeof Ionicons.glyphMap;
  emptyText?: string;
};

export function CourseFolderSectionList({
  items,
  type,
  courseFolders = [],
  folderColor,
  folderIconBg,
  onOpenFolder,
  onOpenItem,
  mode = "student",
  renderUnfolderedItem,
  emptyIcon = "folder-open-outline",
  emptyText = "No content yet",
}: Props) {
  const { colors } = useAppTheme();

  const grouped = React.useMemo(() => {
    if (type === "lectures") return groupLecturesByFolder(items, courseFolders);
    if (type === "materials") return groupMaterialsByFolder(items, courseFolders);
    return groupTestsByFolder(items, { folderColor, iconBg: folderIconBg });
  }, [items, type, courseFolders, folderColor, folderIconBg]);

  if (grouped.folders.length === 0 && grouped.unfoldered.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name={emptyIcon} size={40} color={Colors.light.textMuted} />
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>{emptyText}</Text>
      </View>
    );
  }

  const defaultItem = (item: any) => (
    <Pressable
      key={String(item.id)}
      style={[styles.itemRow, { borderBottomColor: colors.border }]}
      onPress={() => onOpenItem?.(item)}
    >
      <Ionicons
        name={type === "lectures" ? "play-circle" : type === "materials" ? "document" : "document-text"}
        size={18}
        color={Colors.light.primary}
      />
      <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
      {mode === "staff" ? null : <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />}
    </Pressable>
  );

  return (
    <View style={{ gap: 12, padding: 16 }}>
      {grouped.folders.map((folder) => {
        const isLiveFolder = folder.name === "Live Class Recordings";
        return (
          <Pressable
            key={`${type}_${folder.name}`}
            style={[styles.folderCard, { backgroundColor: colors.card, shadowColor: colors.shadow, borderLeftColor: folder.color }]}
            onPress={() => onOpenFolder(folder)}
          >
            <View style={[styles.folderIconWrap, { backgroundColor: folder.iconBg }]}>
              <Ionicons name={isLiveFolder ? "videocam" : "folder"} size={22} color={folder.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.folderTitle, { color: colors.text }]}>{folder.name}</Text>
              <Text style={[styles.folderCount, { color: colors.textMuted }]}>{folder.countLabel}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.light.textMuted} />
          </Pressable>
        );
      })}
      {grouped.unfoldered.map((item) => (renderUnfolderedItem ? renderUnfolderedItem(item) : defaultItem(item)))}
    </View>
  );
}

const styles = StyleSheet.create({
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    padding: 16,
    borderLeftWidth: 4,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  folderIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  folderTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  folderCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemTitle: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 14 },
  emptyState: { alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 40 },
  emptyText: { fontFamily: "Inter_400Regular", fontSize: 14 },
});
