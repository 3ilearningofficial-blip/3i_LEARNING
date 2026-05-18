import { apiRequest } from "@/lib/query-client";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import { buildRecordingLectureSectionTitle } from "@/lib/recordingSection";
import { isBoardSnapshotImageUrl, isVideoRecordingUrl } from "@/lib/classroom/recordingUrl";
import {
  exportClassroomBoardAllPagesPng,
  exportClassroomBoardViewportPng,
} from "@/lib/classroom/exportClassroomBoardViewport";
import { saveClassroomBoardToCourseMaterials } from "@/lib/classroom/saveClassroomBoardMaterial";
import type { Editor } from "tldraw";

export type LiveClassRecordingMeta = {
  id: number | string;
  title?: string | null;
  course_id?: number | null;
  lecture_section_title?: string | null;
  lecture_subfolder_title?: string | null;
  recording_url?: string | null;
  board_snapshot_url?: string | null;
};

export async function exportClassroomBoardPng(
  editor: Editor | null,
  boardEl?: HTMLElement | null
): Promise<Blob | null> {
  const pages = await exportClassroomBoardAllPagesPng(editor, boardEl ?? null);
  if (!pages?.length) return null;
  return pages[pages.length - 1]?.blob ?? null;
}

export async function finalizeClassroomLiveSession(
  liveClassId: string,
  liveClass: LiveClassRecordingMeta,
  editor: Editor | null,
  opts?: {
    videoRecordingUrl?: string | null;
    boardEl?: HTMLElement | null;
  }
): Promise<{
  savedToLectures: boolean;
  recordingUrl?: string;
  boardSnapshotUrl?: string;
  boardMaterialUrl?: string;
  lectureIds?: number[];
}> {
  const subfolder = String(liveClass.lecture_subfolder_title || "").trim() || undefined;
  const sectionTitle = buildRecordingLectureSectionTitle(
    liveClass.lecture_section_title,
    liveClass.lecture_subfolder_title
  );

  const existingRecording = String(liveClass.recording_url || "").trim();
  const existingBoard = String(liveClass.board_snapshot_url || "").trim();
  const courseId = Number(liveClass.course_id || 0);
  const liveTitle = String(liveClass.title || "Live class").trim();

  let boardMaterialUrl: string | undefined;
  if (courseId > 0 && editor) {
    try {
      const material = await saveClassroomBoardToCourseMaterials({
        courseId,
        liveClassTitle: liveTitle,
        editor,
        boardEl: opts?.boardEl ?? null,
      });
      boardMaterialUrl = material?.fileUrl;
    } catch (e) {
      console.warn("[Classroom] board PDF material save failed:", e);
    }
  }

  let recordingUrl = String(opts?.videoRecordingUrl || "").trim();
  if (!recordingUrl && isVideoRecordingUrl(existingRecording)) {
    recordingUrl = existingRecording;
  }

  let boardSnapshotUrl = isBoardSnapshotImageUrl(existingBoard)
    ? existingBoard
    : isBoardSnapshotImageUrl(existingRecording)
      ? existingRecording
      : "";

  if (!boardSnapshotUrl && editor) {
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    const blob = await exportClassroomBoardPng(editor, opts?.boardEl ?? null);
    if (shapeIds.length > 0 && !blob) {
      throw new Error("Could not save board snapshot. Try again before ending class.");
    }
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
        boardSnapshotUrl = publicUrl;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/classroom/finalize`, {
    recordingUrl: recordingUrl || undefined,
    boardSnapshotUrl: boardSnapshotUrl || undefined,
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
    boardSnapshotUrl: data.boardSnapshotUrl || boardSnapshotUrl || undefined,
    boardMaterialUrl,
    lectureIds: data.lectureIds,
  };
}
