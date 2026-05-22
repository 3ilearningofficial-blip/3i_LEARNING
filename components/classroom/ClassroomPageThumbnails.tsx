import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ScrollView } from "react-native";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";

type Props = {
  boardRef: React.RefObject<TldrawClassroomHandle | null>;
};

export default function ClassroomPageThumbnails({ boardRef }: Props) {
  const [pageCount, setPageCount] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const h = boardRef.current;
      if (!h) return;
      setPageCount(h.getPageCount());
      setPageIndex(h.getPageIndex());
    };
    refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [boardRef]);

  if (Platform.OS !== "web" || pageCount <= 1) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {Array.from({ length: pageCount }, (_, i) => (
        <Pressable
          key={i}
          style={[styles.chip, i === pageIndex && styles.chipActive]}
          onPress={() => {
            boardRef.current?.goToPage(i);
            setPageIndex(i);
          }}
        >
          <Text style={[styles.chipText, i === pageIndex && styles.chipTextActive]}>{i + 1}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chip: {
    minWidth: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: "#1f2937",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#374151",
  },
  chipActive: { borderColor: "#3B82F6", backgroundColor: "#1E3A5F" },
  chipText: { fontSize: 12, fontWeight: "700", color: "#9CA3AF" },
  chipTextActive: { color: "#93C5FD" },
});
