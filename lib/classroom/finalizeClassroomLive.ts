import { apiRequest } from "@/lib/query-client";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import { buildRecordingLectureSectionTitle } from "@/lib/recordingSection";
import type { Editor } from "tldraw";

export type LiveClassRecordingMeta = {
  id: number | string;
  lecture_section_title?: string | null;
  lecture_subfolder_title?: string | null;
  recording_url?: string | null;
  board_snapshot_url?: string | null;
};

export async function exportClassroomBoardPng(editor: Editor | null): Promise<Blob | null> {
  if (!editor) return null;
  try {
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    if (shapeIds.length === 0) return null;
    const { blob } = await editor.toImage(shapeIds, { format: "png", background: true });
    return blob || null;
  } catch (e) {
    console.warn("[Classroom] board export failed:", e);
    return null;
  }
}

export async function finalizeClassroomLiveSession(
  liveClassId: string,
  liveClass: LiveClassRecordingMeta,
  editor: Editor | null
): Promise<{ savedToLectures: boolean; recordingUrl?: string; lectureIds?: number[] }> {
  const subfolder = String(liveClass.lecture_subfolder_title || "").trim() || undefined;
  const sectionTitle = buildRecordingLectureSectionTitle(
    liveClass.lecture_section_title,
    liveClass.lecture_subfolder_title
  );

  let recordingUrl = String(
    liveClass.recording_url || liveClass.board_snapshot_url || ""
  ).trim();

  if (!recordingUrl && editor) {
    const blob = await exportClassroomBoardPng(editor);
    if (blob) {
      const filename = `classroom-board-${liveClassId}-${Date.now()}.png`;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const { publicUrl } = await uploadToR2(
          objectUrl,
          filename,
          getMimeType(filename),
          "live-class-recording",
          undefined,
          "/api/upload/presign",
          subfolder
        );
        recordingUrl = publicUrl;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/classroom/finalize`, {
    recordingUrl: recordingUrl || undefined,
    boardSnapshotUrl: recordingUrl || undefined,
    sectionTitle,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || "Failed to save class to lectures");
  }
  const data = await res.json();
  return {
    savedToLectures: true,
    recordingUrl: data.recordingUrl || recordingUrl || undefined,
    lectureIds: data.lectureIds,
  };
}
