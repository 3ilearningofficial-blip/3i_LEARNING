import type { Editor } from "tldraw";

export type TldrawClassroomHandle = {
  getEditor: () => Editor | null;
};
