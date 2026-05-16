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
    const ids = [...editor.getCurrentPageShapeIds()];
    if (ids.length === 0) return null;
    const editorAny = editor as Editor & {
      toImage?: (shapeIds: string[], opts: { format: string; background: boolean }) => Promise<{ blob: Blob }>;
    };
    if (typeof editorAny.toImage === "function") {
      const { blob } = await editorAny.toImage(ids, { format: "png", background: true });
      return blob || null;
    }
  } catch {
    // fall through
  }
  return null;
}

export async function finalizeClassroomLiveSession(
  liveClassId: string,
  liveClass: LiveClassRecordingMeta,
  editor: Editor | null
): Promise<{ savedToLectures: boolean; recordingUrl?: string }> {
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

  if (recordingUrl) {
    await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/recording`, {
      recordingUrl,
      sectionTitle,
    });
    return { savedToLectures: true, recordingUrl };
  }

  await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, {
    isLive: false,
    isCompleted: true,
  });
  return { savedToLectures: true };
}
