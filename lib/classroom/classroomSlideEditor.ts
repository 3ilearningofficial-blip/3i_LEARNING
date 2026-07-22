import type { Editor, TLPageId } from "tldraw";
import { getSlideBounds, SLIDE_LOGICAL_H, SLIDE_LOGICAL_W } from "./slideConstants";

export function fitEditorToSlide(editor: Editor, opts?: { lock?: boolean }) {
  const bounds = getSlideBounds();
  // Live admin locks the camera after page 1. Without `force`, zoomToBounds /
  // setCamera no-op on later pages and each page keeps a different default
  // camera — admin writing area no longer matches the 16:9 student composite.
  try {
    editor.zoomToBounds(bounds, { inset: 0, animation: { duration: 0 }, force: true });
  } catch {
    editor.setCamera({ x: SLIDE_LOGICAL_W / 2, y: SLIDE_LOGICAL_H / 2, z: 1 }, { force: true });
  }
  if (opts?.lock) {
    editor.setCameraOptions({ isLocked: true });
  }
}

export function setupClassroomSlideEditor(
  editor: Editor,
  readonly: boolean,
  opts?: { lockViewport?: boolean },
) {
  editor.user.updateUserPreferences({ colorScheme: "dark" });
  if (readonly) {
    editor.updateInstanceState({ isReadonly: true });
    editor.setCameraOptions({ isLocked: true });
    return;
  }
  const lockViewport = !!opts?.lockViewport;
  fitEditorToSlide(editor, { lock: lockViewport });
}

export function getPageCount(editor: Editor | null): number {
  if (!editor) return 0;
  return editor.getPages().length;
}

export function getPageIndex(editor: Editor | null): number {
  if (!editor) return 0;
  const pages = editor.getPages();
  const current = editor.getCurrentPageId();
  const idx = pages.findIndex((p) => p.id === current);
  return idx >= 0 ? idx : 0;
}

export function goToPageIndex(editor: Editor | null, index: number) {
  if (!editor) return;
  const pages = editor.getPages();
  const page = pages[index];
  if (!page) return;
  const wasLocked = editor.getCameraOptions().isLocked;
  editor.setCurrentPage(page.id as TLPageId);
  fitEditorToSlide(editor);
  if (wasLocked) {
    editor.setCameraOptions({ isLocked: true });
  }
}

export function addClassroomPage(editor: Editor | null): number {
  if (!editor) return getPageCount(editor);
  const n = getPageCount(editor) + 1;
  editor.createPage({ name: `Page ${n}` });
  const pages = editor.getPages();
  const newPage = pages[pages.length - 1];
  if (newPage) {
    const wasLocked = editor.getCameraOptions().isLocked;
    editor.setCurrentPage(newPage.id as TLPageId);
    fitEditorToSlide(editor);
    if (wasLocked) editor.setCameraOptions({ isLocked: true });
  }
  return getPageIndex(editor);
}

export function removeClassroomPage(editor: Editor | null): boolean {
  if (!editor) return false;
  const pages = editor.getPages();
  if (pages.length <= 1) return false;
  const currentId = editor.getCurrentPageId();
  const wasLocked = editor.getCameraOptions().isLocked;
  editor.deletePage(currentId as TLPageId);
  fitEditorToSlide(editor);
  if (wasLocked) editor.setCameraOptions({ isLocked: true });
  return true;
}

export function clearCurrentPageShapes(editor: Editor | null) {
  if (!editor) return;
  const ids = [...editor.getCurrentPageShapeIds()];
  if (ids.length === 0) return;
  editor.deleteShapes(ids);
}
