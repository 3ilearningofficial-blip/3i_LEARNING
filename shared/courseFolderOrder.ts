export type CourseFolderType = "lecture" | "test" | "material";

export function courseFolderFullName(folder: { full_name?: string | null; name?: string | null }): string {
  return String(folder?.full_name || folder?.name || "").trim();
}

function findFolderByPath(
  folders: any[],
  name: string,
  type: CourseFolderType,
  subjectKey?: string
): any | undefined {
  const sk = subjectKey?.trim().toLowerCase();
  return folders.find((f) => {
    if (f.type !== type) return false;
    if (sk && String(f.subject_key || "").toLowerCase() !== sk) return false;
    return courseFolderFullName(f) === name;
  });
}

export function sortFolderNamesByOrder(
  names: string[],
  type: CourseFolderType,
  folders: any[],
  opts?: { subjectKey?: string }
): string[] {
  const subjectKey = opts?.subjectKey;
  return [...names].sort((a, b) => {
    const fa = findFolderByPath(folders, a, type, subjectKey);
    const fb = findFolderByPath(folders, b, type, subjectKey);
    const oa = fa?.order_index ?? Number.MAX_SAFE_INTEGER;
    const ob = fb?.order_index ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
}

export function sortCourseFolderRows<T extends { order_index?: number | null }>(folders: T[]): T[] {
  return [...folders].sort((a, b) => {
    const oa = a.order_index ?? Number.MAX_SAFE_INTEGER;
    const ob = b.order_index ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return 0;
  });
}
