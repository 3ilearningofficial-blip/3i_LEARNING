import type { Editor, TLPage, TLPageId } from "tldraw";

type PageBoundsLike = { x: number; y: number; w: number; h: number };

const EXPORT_SCALE = 2;
const CONTENT_PADDING = 24;

function getBoardAspect(boardEl: HTMLElement | null): number {
  if (boardEl && typeof boardEl.getBoundingClientRect === "function") {
    const rect = boardEl.getBoundingClientRect();
    if (rect.width > 8 && rect.height > 8) {
      return rect.width / rect.height;
    }
  }
  return 16 / 9;
}

/** Expand content bounds to board preview aspect ratio (PPT-style slide frame). */
function fitBoundsToSlideAspect(bounds: PageBoundsLike, aspect: number): PageBoundsLike {
  let { x, y, w, h } = bounds;
  x -= CONTENT_PADDING;
  y -= CONTENT_PADDING;
  w += CONTENT_PADDING * 2;
  h += CONTENT_PADDING * 2;

  if (w <= 0 || h <= 0) {
    w = 800;
    h = w / aspect;
    return { x: 0, y: 0, w, h };
  }

  const currentAspect = w / h;
  if (currentAspect > aspect) {
    const newH = w / aspect;
    y -= (newH - h) / 2;
    h = newH;
  } else {
    const newW = h * aspect;
    x -= (newW - w) / 2;
    w = newW;
  }

  return { x, y, w, h };
}

function boxToBounds(box: { x: number; y: number; w: number; h: number }): PageBoundsLike {
  return { x: box.x, y: box.y, w: box.w, h: box.h };
}

async function createBlankSlidePng(width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Blank slide export failed"))), "image/png");
  });
}

export type BoardPageExport = {
  blob: Blob;
  width: number;
  height: number;
  pageName: string;
};

/**
 * Export every tldraw board page (Page 1, Page 2, …) as one slide image.
 * Each slide uses the board preview aspect ratio — not the infinite canvas.
 */
export async function exportClassroomBoardAllPagesPng(
  editor: Editor | null,
  boardEl: HTMLElement | null
): Promise<BoardPageExport[] | null> {
  if (!editor || typeof document === "undefined") return null;

  const pages = editor.getPages();
  if (pages.length === 0) return null;

  const aspect = getBoardAspect(boardEl);
  const originalPageId = editor.getCurrentPageId();
  const exports: BoardPageExport[] = [];

  try {
    for (const page of pages) {
      const slide = await exportSingleBoardPage(editor, page, aspect);
      if (slide) exports.push(slide);
    }
  } finally {
    if (originalPageId) {
      try {
        editor.setCurrentPage(originalPageId);
      } catch {
        /* page may have been deleted */
      }
    }
  }

  return exports.length > 0 ? exports : null;
}

async function exportSingleBoardPage(
  editor: Editor,
  page: TLPage,
  aspect: number
): Promise<BoardPageExport | null> {
  editor.setCurrentPage(page.id as TLPageId);

  const shapeIds = [...editor.getPageShapeIds(page.id)];
  const pageName = String((page as { name?: string }).name || "Page").trim() || "Page";

  let bounds: PageBoundsLike;
  const contentBounds = editor.getCurrentPageBounds();
  if (contentBounds && contentBounds.w > 0 && contentBounds.h > 0) {
    bounds = fitBoundsToSlideAspect(boxToBounds(contentBounds), aspect);
  } else {
    bounds = fitBoundsToSlideAspect({ x: 0, y: 0, w: 800, h: 800 / aspect }, aspect);
  }

  const width = Math.max(1, Math.round(bounds.w * EXPORT_SCALE));
  const height = Math.max(1, Math.round(bounds.h * EXPORT_SCALE));

  if (shapeIds.length === 0) {
    const blob = await createBlankSlidePng(width, height);
    return { blob, width, height, pageName };
  }

  try {
    const { blob } = await editor.toImage(shapeIds, {
      format: "png",
      bounds: bounds as never,
      background: true,
      scale: EXPORT_SCALE,
      padding: 0,
    });
    if (!blob) return null;
    return { blob, width, height, pageName };
  } catch (e) {
    console.warn("[Classroom] page export failed:", pageName, e);
    return null;
  }
}

/** @deprecated Use exportClassroomBoardAllPagesPng — exports only the active viewport. */
export async function exportClassroomBoardViewportPng(
  editor: Editor | null,
  boardEl: HTMLElement | null
): Promise<{ blob: Blob; width: number; height: number } | null> {
  const all = await exportClassroomBoardAllPagesPng(editor, boardEl);
  if (!all?.length) return null;
  const first = all[0];
  return { blob: first.blob, width: first.width, height: first.height };
}
