import React from "react";
import { View, Text, StyleSheet, FlatList } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";

interface LiveStudentsPanelProps {
  liveClassId: string;
  showViewerCount: boolean;
}

interface Viewer {
  user_id: number;
  user_name: string;
}

interface ViewersResponse {
  viewers: Viewer[];
  count: number;
}

export default function LiveStudentsPanel({ liveClassId, showViewerCount }: LiveStudentsPanelProps) {
  const { data } = useQuery<ViewersResponse>({
    queryKey: [`/api/live-classes/${liveClassId}/viewers`],
    refetchInterval: 10000,
  });

  const viewers = data?.viewers ?? [];
  const count = data?.count ?? 0;

  const renderItem = ({ item }: { item: Viewer }) => (
    <View style={styles.studentRow}>
      <View style={styles.studentIcon}>
        <Ionicons name="person" size={14} color={Colors.light.primary} />
      </View>
      <Text style={styles.studentName}>{item.user_name || "Student"}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="people" size={16} color={Colors.light.primary} />
        <Text style={styles.headerText}>Students</Text>
        {showViewerCount && (
          <View style={styles.countBadge}>
            <Text style={styles.countText}>{count} online</Text>
          </View>
        )}
      </View>

      <FlatList
        data={viewers}
        keyExtractor={(item, index) => (item.user_id != null ? String(item.user_id) : String(index))}
        renderItem={renderItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={28} color="#ccc" />
            <Text style={styles.emptyText}>No students watching yet</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.light.border,
  },
  headerText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, flex: 1 },
  countBadge: {
    backgroundColor: Colors.light.secondary,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  countText: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.primary },
  list: { flex: 1 },
  listContent: { padding: 10, gap: 6 },
  studentRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: Colors.light.backgroundSecondary,
    borderRadius: 8,
  },
  studentIcon: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.light.secondary,
    alignItems: "center", justifyContent: "center",
  },
  studentName: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text },
  empty: { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 12, color: "#999", fontFamily: "Inter_400Regular" },
});
