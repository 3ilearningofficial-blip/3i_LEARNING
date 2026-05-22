import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import { pngSlidesToPdfBlob } from "@/lib/classroom/pngBlobToPdf";
import type { BoardPageExport } from "@/lib/classroom/exportClassroomBoardViewport";

export type BoardPageUrl = { name: string; url: string };

export type EndSessionArchive = {
  boardPdfUrl: string;
  boardPageUrls: BoardPageUrl[];
  boardSnapshotUrl: string;
};

export type ClassroomBoardArchiveResult = {
  boardPdfUrl: string;
  boardPageUrls: BoardPageUrl[];
  boardSnapshotUrl: string;
};

export async function uploadClassroomBoardArchive(
  liveClassId: string,
  pageExports: BoardPageExport[],
  subfolder?: string
): Promise<ClassroomBoardArchiveResult | null> {
  if (!pageExports.length) return null;

  const pdfBlob = await pngSlidesToPdfBlob(
    pageExports.map((p) => ({ blob: p.blob, width: p.width, height: p.height }))
  );
  const ts = Date.now();
  const pdfFilename = `classroom-board-${liveClassId}-${ts}.pdf`;
  const pdfObjectUrl = URL.createObjectURL(pdfBlob);

  let boardPdfUrl: string;
  try {
    const { publicUrl } = await uploadToR2(
      pdfObjectUrl,
      pdfFilename,
      "application/pdf",
      "live-class-recording",
      undefined,
      "/api/upload/presign",
      subfolder
    );
    boardPdfUrl = publicUrl;
  } finally {
    URL.revokeObjectURL(pdfObjectUrl);
  }

  const boardPageUrls: BoardPageUrl[] = [];
  for (let i = 0; i < pageExports.length; i++) {
    const page = pageExports[i];
    const safeName = page.pageName.replace(/[^\w.-]+/g, "-").slice(0, 40) || `page-${i + 1}`;
    const pngFilename = `classroom-board-${liveClassId}-${ts}-${safeName}.png`;
    const pngUrl = URL.createObjectURL(page.blob);
    try {
      const { publicUrl } = await uploadToR2(
        pngUrl,
        pngFilename,
        "image/png",
        "live-class-recording",
        undefined,
        "/api/upload/presign",
        subfolder
      );
      boardPageUrls.push({ name: page.pageName, url: publicUrl });
    } finally {
      URL.revokeObjectURL(pngUrl);
    }
  }

  const last = pageExports[pageExports.length - 1];
  const snapFilename = `classroom-board-snapshot-${liveClassId}-${ts}.png`;
  const snapObjectUrl = URL.createObjectURL(last.blob);
  let boardSnapshotUrl: string;
  try {
    const { publicUrl } = await uploadToR2(
      snapObjectUrl,
      snapFilename,
      "image/png",
      "live-class-recording",
      undefined,
      "/api/upload/presign",
      subfolder
    );
    boardSnapshotUrl = publicUrl;
  } finally {
    URL.revokeObjectURL(snapObjectUrl);
  }

  return { boardPdfUrl, boardPageUrls, boardSnapshotUrl };
}

/** Trigger browser download of board PDF or PNGs (local copy before end). */
export function downloadBoardPdfLocal(pdfBlob: Blob, title: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(pdfBlob);
  a.download = `${title.replace(/[^\w.-]+/g, "-").slice(0, 48)}-board.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function downloadBoardPngsLocal(pages: BoardPageExport[], title: string) {
  pages.forEach((p, i) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(p.blob);
    a.download = `${title.replace(/[^\w.-]+/g, "-").slice(0, 32)}-page-${i + 1}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}
