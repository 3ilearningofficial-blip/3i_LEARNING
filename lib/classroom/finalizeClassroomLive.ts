import { apiRequest } from "@/lib/query-client";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import { buildRecordingLectureSectionTitle } from "@shared/recordingSection";
import { isBoardSnapshotImageUrl, isVideoRecordingUrl } from "@/lib/classroom/recordingUrl";
import { exportClassroomBoardAllPagesPng } from "@/lib/classroom/exportClassroomBoardViewport";
import { saveClassroomBoardToCourseMaterials } from "@/lib/classroom/saveClassroomBoardMaterial";
import type { EndSessionArchive } from "@/lib/classroom/uploadClassroomBoardArchive";
import type { Editor } from "tldraw";

export type LiveClassRecordingMeta = {
  id: number | string;
  title?: string | null;
  course_id?: number | null;
  subject_key?: string | null;
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

async function linkBoardPdfToCourseMaterials(opts: {
  liveTitle: string;
  boardPdfUrl: string;
  pageCount: number;
  courseId: number;
  subjectKey?: string | null;
}): Promise<string | undefined> {
  const normalizedSubjectKey =
    typeof opts.subjectKey === "string" && opts.subjectKey.trim()
      ? opts.subjectKey.trim().toLowerCase()
      : undefined;
  const body = {
    title: `${opts.liveTitle} — Board notes`,
    description: `Whiteboard export from interactive classroom — ${opts.pageCount} page(s), ${new Date().toLocaleString()}.`,
    fileUrl: opts.boardPdfUrl,
    fileType: "pdf",
    courseId: opts.courseId,
    isFree: false,
    sectionTitle: null,
    downloadAllowed: false,
    ...(normalizedSubjectKey ? { subjectKey: normalizedSubjectKey } : {}),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await apiRequest("POST", "/api/admin/study-materials", body);
      if (res.ok) return opts.boardPdfUrl;
    } catch (e) {
      if (attempt === 1) console.warn("[Classroom] board PDF material link failed:", e);
    }
  }
  return undefined;
}

export async function finalizeClassroomLiveSession(
  liveClassId: string,
  liveClass: LiveClassRecordingMeta,
  editor: Editor | null,
  opts?: {
    videoRecordingUrl?: string | null;
    boardEl?: HTMLElement | null;
    boardArchive?: EndSessionArchive | null;
    /** Client editor getSnapshot() JSON URL — must not overwrite server RoomSnapshot column. */
    boardClientCheckpointUrl?: string | null;
  }
): Promise<{
  savedToLectures: boolean;
  recordingUrl?: string;
  boardSnapshotUrl?: string;
  boardMaterialUrl?: string;
  boardPdfUrl?: string;
  boardMaterialSaveFailed?: boolean;
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
  const subjectKey = String(liveClass.subject_key || "").trim() || undefined;

  let boardMaterialUrl: string | undefined;
  let boardMaterialSaveFailed = false;
  if (courseId > 0) {
    if (opts?.boardArchive?.boardPdfUrl) {
      const pageCount = opts.boardArchive.boardPageUrls?.length ?? 0;
      boardMaterialUrl = await linkBoardPdfToCourseMaterials({
        liveTitle,
        boardPdfUrl: opts.boardArchive.boardPdfUrl,
        pageCount,
        courseId,
        subjectKey,
      });
      if (!boardMaterialUrl && editor) {
        try {
          const material = await saveClassroomBoardToCourseMaterials({
            courseId,
            liveClassTitle: liveTitle,
            editor,
            boardEl: opts?.boardEl ?? null,
            subjectKey,
          });
          boardMaterialUrl = material?.fileUrl;
        } catch (e) {
          console.warn("[Classroom] board PDF material fallback save failed:", e);
        }
      }
      if (!boardMaterialUrl) boardMaterialSaveFailed = true;
    } else if (editor) {
      try {
        const material = await saveClassroomBoardToCourseMaterials({
          courseId,
          liveClassTitle: liveTitle,
          editor,
          boardEl: opts?.boardEl ?? null,
          subjectKey,
        });
        boardMaterialUrl = material?.fileUrl;
        if (!boardMaterialUrl) boardMaterialSaveFailed = true;
      } catch (e) {
        console.warn("[Classroom] board PDF material save failed:", e);
        boardMaterialSaveFailed = true;
      }
    }
  }

  let recordingUrl = String(opts?.videoRecordingUrl || "").trim();
  if (!recordingUrl && isVideoRecordingUrl(existingRecording)) {
    recordingUrl = existingRecording;
  }

  let boardSnapshotUrl =
    opts?.boardArchive?.boardSnapshotUrl ||
    (isBoardSnapshotImageUrl(existingBoard)
      ? existingBoard
      : isBoardSnapshotImageUrl(existingRecording)
        ? existingRecording
        : "");

  if (!boardSnapshotUrl && editor && !opts?.boardArchive) {
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    const blob = await exportClassroomBoardPng(editor, opts?.boardEl ?? null);
    if (shapeIds.length > 0 && !blob) {
      const hasCheckpoint = Boolean(String(opts?.boardClientCheckpointUrl || "").trim());
      const hasArchive =
        Boolean(opts?.boardArchive?.boardSnapshotUrl) ||
        Boolean(opts?.boardArchive?.boardPdfUrl) ||
        (opts?.boardArchive?.boardPageUrls?.length ?? 0) > 0;
      if (!hasCheckpoint && !hasArchive) {
        console.warn(
          "[Classroom] PNG snapshot export failed; ending class with checkpoint/archive only if available"
        );
      }
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
      } catch (e) {
        // Non-fatal: a failed snapshot upload (e.g. R2 CORS / transient) must not
        // abort finalize — the class still ends and saves using the sync
        // checkpoint / archive passed below.
        console.warn("[Classroom] board snapshot upload failed; finalizing with checkpoint/archive:", e);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/classroom/finalize`, {
    recordingUrl: recordingUrl || undefined,
    boardSnapshotUrl: boardSnapshotUrl || undefined,
    boardPdfUrl: opts?.boardArchive?.boardPdfUrl || undefined,
    boardPages: opts?.boardArchive?.boardPageUrls || undefined,
    boardClientCheckpointUrl: opts?.boardClientCheckpointUrl || undefined,
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
    boardPdfUrl: data.boardPdfUrl || opts?.boardArchive?.boardPdfUrl,
    boardMaterialSaveFailed,
    lectureIds: data.lectureIds,
  };
}
