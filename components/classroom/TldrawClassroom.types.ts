import type { Editor } from "tldraw";

export type TldrawClassroomHandle = {
  getEditor: () => Editor | null;
  getPageCount: () => number;
  getPageIndex: () => number;
  goToPage: (index: number) => void;
  addPage: () => void;
  removePage: () => boolean;
  clearCurrentPage: () => void;
  onEditorReady?: (editor: Editor | null) => void;
};
