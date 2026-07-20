import React from "react";
import { View } from "react-native";
import BulkUploadPanel from "@/components/admin/BulkUploadPanel";
import { SingleBulkModeToggle, type AddContentMode } from "@/components/admin/AdminLectureAddBody";

type Props = {
  mode: AddContentMode;
  onModeChange: (mode: AddContentMode) => void;
  courseId: number;
  parentFolderName?: string | null;
  subjectKey?: string | null;
  baseOrderIndex: number;
  existingMaterials: {
    section_title?: string | null;
    order_index?: number | null;
    subject_key?: string | null;
  }[];
  onBulkSaved: () => void;
  singleContent: React.ReactNode;
};

export default function AdminMaterialAddBody({
  mode,
  onModeChange,
  courseId,
  parentFolderName,
  subjectKey,
  baseOrderIndex,
  existingMaterials,
  onBulkSaved,
  singleContent,
}: Props) {
  return (
    <View style={{ gap: 12 }}>
      <SingleBulkModeToggle mode={mode} onModeChange={onModeChange} />
      {mode === "single" ? (
        singleContent
      ) : (
        <BulkUploadPanel
          kind="material"
          courseId={courseId}
          parentFolderName={parentFolderName}
          subjectKey={subjectKey}
          baseOrderIndex={baseOrderIndex}
          existingItems={existingMaterials}
          onSaved={onBulkSaved}
        />
      )}
    </View>
  );
}
