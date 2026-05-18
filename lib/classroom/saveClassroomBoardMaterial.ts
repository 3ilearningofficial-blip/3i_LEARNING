import { apiRequest } from "@/lib/query-client";
import { uploadToR2 } from "@/lib/r2-upload";
import type { Editor } from "tldraw";
import { exportClassroomBoardAllPagesPng } from "@/lib/classroom/exportClassroomBoardViewport";
import { pngSlidesToPdfBlob } from "@/lib/classroom/pngBlobToPdf";

export type SaveBoardMaterialResult = {
  materialId?: number;
  fileUrl: string;
};

/**
 * Export each tldraw board page (Page 1, 2, …) as one PDF page and add to course Materials (no folder).
 */
export async function saveClassroomBoardToCourseMaterials(opts: {
  courseId: number;
  liveClassTitle: string;
  editor: Editor | null;
  boardEl: HTMLElement | null;
}): Promise<SaveBoardMaterialResult | null> {
  const courseId = Number(opts.courseId);
  if (!Number.isFinite(courseId) || courseId <= 0) return null;

  const pageExports = await exportClassroomBoardAllPagesPng(opts.editor, opts.boardEl);
  if (!pageExports?.length) return null;

  const pdfBlob = await pngSlidesToPdfBlob(
    pageExports.map((p) => ({ blob: p.blob, width: p.width, height: p.height }))
  );
  const pageCount = pageExports.length;
  const safeTitle = String(opts.liveClassTitle || "Live class").trim() || "Live class";
  const filename = `classroom-board-${safeTitle.replace(/[^\w.-]+/g, "-").slice(0, 48)}-${Date.now()}.pdf`;
  const objectUrl = URL.createObjectURL(pdfBlob);

  try {
    const { publicUrl } = await uploadToR2(
      objectUrl,
      filename,
      "application/pdf",
      "materials"
    );

    const res = await apiRequest("POST", "/api/admin/study-materials", {
      title: `${safeTitle} — Board notes`,
      description: `Whiteboard export from interactive classroom — ${pageCount} page(s), ${new Date().toLocaleString()}. Each board page is one PDF page. Edit to merge or move into a folder.`,
      fileUrl: publicUrl,
      fileType: "pdf",
      courseId,
      isFree: false,
      sectionTitle: null,
      downloadAllowed: false,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.message || "Failed to add board PDF to materials");
    }

    const row = await res.json();
    const materialId = Number(row?.id ?? row?.data?.id ?? 0) || undefined;
    return { materialId, fileUrl: publicUrl };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
