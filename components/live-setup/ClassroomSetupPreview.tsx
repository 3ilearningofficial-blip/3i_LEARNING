import React, { useRef } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import TldrawClassroom from "@/components/classroom/TldrawClassroom";
import ClassroomSlideShell from "@/components/classroom/ClassroomSlideShell";
import ClassroomSlideToolbar from "@/components/classroom/ClassroomSlideToolbar";
import ClassroomPageThumbnails from "@/components/classroom/ClassroomPageThumbnails";
import type { TldrawClassroomHandle } from "@/components/classroom/TldrawClassroom.types";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
};

export default function ClassroomSetupPreview({ liveClassId }: Props) {
  const boardRef = useRef<TldrawClassroomHandle>(null);

  return (
    <View style={styles.wrap}>
      <View style={styles.boardStrip}>
        <Ionicons name="easel-outline" size={20} color="#FBBF24" />
        <Text style={styles.boardText}>
          Board preview — fixed 16:9 slides. Draw here to test sync before going live.
        </Text>
      </View>
      <View style={styles.boardArea}>
        {Platform.OS === "web" ? (
          <ClassroomSlideShell
            toolbar={<ClassroomSlideToolbar boardRef={boardRef} />}
            thumbnails={<ClassroomPageThumbnails boardRef={boardRef} />}
          >
            <TldrawClassroom liveClassId={liveClassId} preview readonly={false} />
          </ClassroomSlideShell>
        ) : (
          <View style={styles.nativePlaceholder}>
            <Text style={styles.nativeText}>Whiteboard preview requires the admin web app.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0a0a0a" },
  boardStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "#111827",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  boardText: { flex: 1, fontSize: 13, color: "#D1D5DB", lineHeight: 18 },
  boardArea: { flex: 1, minHeight: 280 },
  nativePlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  nativeText: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center" },
});
