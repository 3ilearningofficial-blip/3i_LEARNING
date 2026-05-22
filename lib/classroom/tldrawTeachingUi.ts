import type { TLComponents, TLUiOverrides } from "tldraw";

const TEACHING_TOOL_IDS = new Set([
  "select",
  "hand",
  "draw",
  "highlight",
  "eraser",
  "line",
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "arrow",
  "text",
  "note",
  "laser",
]);

export const classroomTeachingOverrides: TLUiOverrides = {
  tools(_editor, tools) {
    const filtered: typeof tools = {};
    for (const [id, item] of Object.entries(tools)) {
      if (TEACHING_TOOL_IDS.has(id)) filtered[id] = item;
    }
    return filtered;
  },
};

export const classroomTeachingComponents: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  Minimap: null,
  HelpMenu: null,
  SharePanel: null,
  NavigationPanel: null,
  DebugMenu: null,
  DebugPanel: null,
};
