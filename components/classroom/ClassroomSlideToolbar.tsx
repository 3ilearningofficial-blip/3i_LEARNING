import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";
import Colors from "@/constants/colors";

type Props = {
  boardRef: React.RefObject<TldrawClassroomHandle | null>;
  onImportSlide?: () => void;
};

export default function ClassroomSlideToolbar({ boardRef, onImportSlide }: Props) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const refresh = () => {
    const h = boardRef.current;
    if (!h) return;
    setPageIndex(h.getPageIndex());
    setPageCount(h.getPageCount());
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [boardRef]);

  const goPrev = () => {
    boardRef.current?.goToPage(Math.max(0, pageIndex - 1));
    refresh();
  };

  const goNext = () => {
    boardRef.current?.goToPage(Math.min(pageCount - 1, pageIndex + 1));
    refresh();
  };

  const addPage = () => {
    boardRef.current?.addPage();
    refresh();
  };

  const deletePage = () => {
    if (pageCount <= 1) return;
    const run = () => {
      boardRef.current?.removePage();
      refresh();
    };
    if (Platform.OS === "web") {
      if (window.confirm("Delete this page?")) run();
    } else {
      Alert.alert("Delete page", "Delete this page?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: run },
      ]);
    }
  };

  const clearPage = () => {
    const run = () => {
      boardRef.current?.clearCurrentPage();
      refresh();
    };
    if (Platform.OS === "web") {
      if (window.confirm("Clear all drawings on this page?")) run();
    } else {
      Alert.alert("Clear page", "Clear all drawings on this page?", [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: run },
      ]);
    }
  };

  if (Platform.OS !== "web") return null;

  return (
    <View style={styles.bar}>
      <Pressable style={[styles.btn, pageIndex <= 0 && styles.btnDisabled]} onPress={goPrev} disabled={pageIndex <= 0}>
        <Ionicons name="chevron-back" size={16} color="#fff" />
        <Text style={styles.btnText}>Prev</Text>
      </Pressable>
      <Text style={styles.pageLabel}>
        Page {pageIndex + 1} / {pageCount}
      </Text>
      <Pressable
        style={[styles.btn, pageIndex >= pageCount - 1 && styles.btnDisabled]}
        onPress={goNext}
        disabled={pageIndex >= pageCount - 1}
      >
        <Text style={styles.btnText}>Next</Text>
        <Ionicons name="chevron-forward" size={16} color="#fff" />
      </Pressable>
      <Pressable style={styles.btnAccent} onPress={addPage}>
        <Ionicons name="add" size={16} color="#fff" />
        <Text style={styles.btnText}>New page</Text>
      </Pressable>
      <Pressable style={styles.btnDanger} onPress={deletePage} disabled={pageCount <= 1}>
        <Ionicons name="trash-outline" size={14} color="#FCA5A5" />
      </Pressable>
      <Pressable style={styles.btn} onPress={clearPage}>
        <Ionicons name="refresh-outline" size={14} color="#FDE68A" />
        <Text style={styles.btnTextSmall}>Clear</Text>
      </Pressable>
      {onImportSlide ? (
        <Pressable style={styles.btn} onPress={onImportSlide}>
          <Ionicons name="image-outline" size={14} color="#93C5FD" />
          <Text style={styles.btnTextSmall}>Import</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexWrap: "wrap",
  },
  pageLabel: { fontSize: 13, fontWeight: "700", color: "#E5E7EB", minWidth: 100, textAlign: "center" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#1f2937",
  },
  btnAccent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: Colors.light.primary,
  },
  btnDanger: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#450a0a",
    opacity: 1,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 12, fontWeight: "600", color: "#fff" },
  btnTextSmall: { fontSize: 11, fontWeight: "600", color: "#E5E7EB" },
});
