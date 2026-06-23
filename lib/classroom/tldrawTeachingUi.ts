import type { TLComponents, TLUiOverrides } from "tldraw";

const TEACHING_TOOL_IDS_BASE = [
  "select",
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
] as const;

/** Setup / preview — includes hand pan. */
const TEACHING_TOOL_IDS_PREVIEW = new Set<string>([...TEACHING_TOOL_IDS_BASE, "hand"]);

/** Live admin classroom — no hand tool (pan breaks fixed slide capture). */
const TEACHING_TOOL_IDS_LIVE = new Set<string>(TEACHING_TOOL_IDS_BASE);

export function getClassroomTeachingOverrides(liveSession: boolean): TLUiOverrides {
  const allowed = liveSession ? TEACHING_TOOL_IDS_LIVE : TEACHING_TOOL_IDS_PREVIEW;
  return {
    tools(_editor, tools) {
      const filtered: typeof tools = {};
      for (const [id, item] of Object.entries(tools)) {
        if (allowed.has(id)) filtered[id as keyof typeof tools] = item;
      }
      return filtered;
    },
  };
}

/** @deprecated Use getClassroomTeachingOverrides(false) for setup preview. */
export const classroomTeachingOverrides: TLUiOverrides = getClassroomTeachingOverrides(false);

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
