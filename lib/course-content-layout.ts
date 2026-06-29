import { getContentFolderRootName } from "@shared/recordingSection";
import { courseFolderFullName, sortFolderNamesByOrder } from "@shared/courseFolderOrder";

export type ContentFolderKind = "lectures" | "tests" | "materials";

export type FolderGroup = {
  name: string;
  items: any[];
  color: string;
  iconBg: string;
  countLabel: string;
};

export function folderFullName(f: { full_name?: string | null; name?: string | null }): string {
  return courseFolderFullName(f);
}

export function groupLecturesByFolder(
  lectures: Array<{ section_title?: string | null }>,
  courseFolders: any[] = [],
): { folders: FolderGroup[]; unfoldered: any[] } {
  const folderMap = new Map<string, any[]>();
  const unfoldered: any[] = [];
  for (const lec of lectures) {
    if (lec.section_title) {
      const root = getContentFolderRootName(lec.section_title);
      if (!folderMap.has(root)) folderMap.set(root, []);
      folderMap.get(root)!.push(lec);
    } else {
      unfoldered.push(lec);
    }
  }
  for (const f of courseFolders.filter((x) => x.type === "lecture" && !x.parent_id)) {
    const root = getContentFolderRootName(folderFullName(f));
    if (!folderMap.has(root)) folderMap.set(root, []);
  }
  const names = sortFolderNamesByOrder(Array.from(folderMap.keys()), "lecture", courseFolders);
  const folders = names.map((name) => {
    const isLive = name === "Live Class Recordings";
    const items = folderMap.get(name) || [];
    return {
      name,
      items,
      color: isLive ? "#DC2626" : "#1A56DB",
      iconBg: isLive ? "#FEE2E2" : "#EEF2FF",
      countLabel: `${items.length} ${items.length === 1 ? "video" : "videos"}`,
    };
  });
  return { folders, unfoldered };
}

export function groupMaterialsByFolder(
  materials: Array<{ section_title?: string | null }>,
  courseFolders: any[] = [],
): { folders: FolderGroup[]; unfoldered: any[] } {
  const folderMap = new Map<string, any[]>();
  const unfoldered: any[] = [];
  for (const mat of materials) {
    if (mat.section_title) {
      const root = getContentFolderRootName(mat.section_title);
      if (!folderMap.has(root)) folderMap.set(root, []);
      folderMap.get(root)!.push(mat);
    } else {
      unfoldered.push(mat);
    }
  }
  for (const f of courseFolders.filter((x) => x.type === "material" && !x.parent_id)) {
    const root = getContentFolderRootName(folderFullName(f));
    if (!folderMap.has(root)) folderMap.set(root, []);
  }
  const names = sortFolderNamesByOrder(Array.from(folderMap.keys()), "material", courseFolders);
  const folders = names.map((name) => {
    const items = folderMap.get(name) || [];
    return {
      name,
      items,
      color: "#059669",
      iconBg: "#D1FAE5",
      countLabel: `${items.length} ${items.length === 1 ? "file" : "files"}`,
    };
  });
  return { folders, unfoldered };
}

export function groupTestsByFolder(
  tests: Array<{ folder_name?: string | null }>,
  opts: { folderColor?: string; iconBg?: string } = {},
): { folders: FolderGroup[]; unfoldered: any[] } {
  const folderColor = opts.folderColor || "#059669";
  const iconBg = opts.iconBg || "#D1FAE5";
  const folderNames = new Set(
    tests.map((t) => getContentFolderRootName(t.folder_name)).filter(Boolean),
  );
  const folders: FolderGroup[] = Array.from(folderNames).map((folderName) => {
    const folderTests = tests.filter(
      (t) => t.folder_name === folderName || String(t.folder_name || "").startsWith(`${folderName} /`),
    );
    return {
      name: folderName,
      items: folderTests,
      color: folderColor,
      iconBg,
      countLabel: `${folderTests.length} ${folderTests.length === 1 ? "test" : "tests"}`,
    };
  });
  const unfoldered = tests.filter((t) => !t.folder_name);
  return { folders, unfoldered };
}

export function isMockTestType(test: { test_type?: string }) {
  return String(test.test_type || "").toLowerCase() === "mock";
}

export function getStaffTestsForTab(
  tests: any[],
  tab: string,
  courseType?: string,
): any[] {
  const isTestSeries = String(courseType || "").toLowerCase() === "test_series";
  const type = (t: string) => String(t || "").toLowerCase();
  if (tab === "Tests") {
    if (isTestSeries) return tests.filter((t) => type(t.test_type) === "test");
    return tests.filter((t) => !isMockTestType(t) && type(t.test_type) !== "pyq");
  }
  if (tab === "Mock") return tests.filter((t) => isMockTestType(t));
  if (tab === "Practice") return tests.filter((t) => type(t.test_type) === "practice");
  if (tab === "PYQ") return tests.filter((t) => type(t.test_type) === "pyq");
  return [];
}

export function staffFolderRoute(courseId: number | string, type: ContentFolderKind, name: string, extra?: { color?: string; testType?: string }) {
  const base = `/staff/courses/${courseId}/folder/${type}/${encodeURIComponent(name)}`;
  const params = new URLSearchParams();
  if (extra?.color) params.set("color", extra.color);
  if (extra?.testType) params.set("testType", extra.testType);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
