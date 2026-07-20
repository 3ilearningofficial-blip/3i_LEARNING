import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Colors from "@/constants/colors";
import BulkUploadPanel from "@/components/admin/BulkUploadPanel";

export type AddContentMode = "single" | "bulk";

type Props = {
  mode: AddContentMode;
  onModeChange: (mode: AddContentMode) => void;
  courseId: number;
  parentFolderName?: string | null;
  subjectKey?: string | null;
  baseOrderIndex: number;
  existingLectures: {
    section_title?: string | null;
    order_index?: number | null;
    subject_key?: string | null;
  }[];
  onBulkSaved: () => void;
  onEnsureLectureFolder?: (path: string) => Promise<void>;
  singleContent: React.ReactNode;
};

export function SingleBulkModeToggle({
  mode,
  onModeChange,
}: {
  mode: AddContentMode;
  onModeChange: (mode: AddContentMode) => void;
}) {
  return (
    <View style={toggleStyles.row}>
      {(["single", "bulk"] as const).map((m) => (
        <Pressable
          key={m}
          style={[toggleStyles.btn, mode === m && toggleStyles.btnActive]}
          onPress={() => onModeChange(m)}
        >
          <Text style={[toggleStyles.btnText, mode === m && toggleStyles.btnTextActive]}>
            {m === "single" ? "Single" : "Bulk"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function AdminLectureAddBody({
  mode,
  onModeChange,
  courseId,
  parentFolderName,
  subjectKey,
  baseOrderIndex,
  existingLectures,
  onBulkSaved,
  onEnsureLectureFolder,
  singleContent,
}: Props) {
  return (
    <View style={{ gap: 12 }}>
      <SingleBulkModeToggle mode={mode} onModeChange={onModeChange} />
      {mode === "single" ? (
        singleContent
      ) : (
        <BulkUploadPanel
          kind="lecture"
          courseId={courseId}
          parentFolderName={parentFolderName}
          subjectKey={subjectKey}
          baseOrderIndex={baseOrderIndex}
          existingItems={existingLectures}
          onSaved={onBulkSaved}
          onEnsureLectureFolder={onEnsureLectureFolder}
        />
      )}
    </View>
  );
}

const toggleStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    borderRadius: 10,
    padding: 4,
    marginBottom: 4,
  },
  btn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  btnActive: {
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  btnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textMuted,
  },
  btnTextActive: {
    color: Colors.light.primary,
  },
});
