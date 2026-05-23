import type { Editor } from "tldraw";

/** Prefer tldraw render canvas over the slide shell wrapper (div captureStream is empty). */
export function resolveBoardCaptureElement(
  editor: Editor | null | undefined,
  boardEl: HTMLElement | null | undefined
): HTMLElement | null {
  if (editor) {
    try {
      const container = editor.getContainer();
      const tlCanvas = container.querySelector(".tl-canvas") as HTMLCanvasElement | null;
      if (tlCanvas) return tlCanvas;
      const canvas = container.querySelector("canvas");
      if (canvas) return canvas as HTMLElement;
    } catch {
      /* editor container not ready */
    }
  }
  return boardEl ?? null;
}
