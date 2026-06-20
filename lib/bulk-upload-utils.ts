import {
  MAX_BATCH_BYTES,
  MAX_DOC_BYTES,
  MAX_FILES_PER_BATCH,
  MAX_PDF_BYTES,
  MAX_VIDEO_BYTES,
  formatBytes,
} from "./bulk-upload-limits";

export type BulkContentKind = "lecture" | "material";

export interface BulkFileLike {
  name: string;
  size: number;
  type?: string;
  /** Web folder picker / drag-drop relative path */
  webkitRelativePath?: string;
}

export interface BatchValidationResult {
  ok: boolean;
  error?: string;
  files: BulkFileLike[];
}

export interface FileValidationResult {
  ok: boolean;
  reason?: "too_large" | "wrong_type";
  message?: string;
}

export function titleFromFilename(name: string): string {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  return base
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sectionFromRelativePath(relativePath: string): string {
  const parts = String(relativePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return "";
  return parts[parts.length - 2] || "";
}

export function resolveDefaultSection(opts: {
  parentFolderName?: string | null;
  relativePath?: string;
}): string {
  const parent = String(opts.parentFolderName || "").trim();
  if (parent) return parent;
  return sectionFromRelativePath(opts.relativePath || "");
}

const VIDEO_EXT = new Set(["mp4", "mov", "mkv", "webm", "avi", "m4v"]);
const PDF_EXT = new Set(["pdf"]);
const DOC_EXT = new Set(["doc", "docx"]);

export function inferMaterialFileType(filename: string, mime?: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const m = String(mime || "").toLowerCase();
  if (ext === "pdf" || m === "application/pdf") return "pdf";
  if (DOC_EXT.has(ext) || m.includes("word") || m.includes("msword")) return "doc";
  if (VIDEO_EXT.has(ext) || m.startsWith("video/")) return "video";
  return "pdf";
}

function isVideoFile(file: BulkFileLike): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const m = String(file.type || "").toLowerCase();
  return VIDEO_EXT.has(ext) || m.startsWith("video/");
}

function isMaterialFile(file: BulkFileLike): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const m = String(file.type || "").toLowerCase();
  return (
    PDF_EXT.has(ext) ||
    DOC_EXT.has(ext) ||
    VIDEO_EXT.has(ext) ||
    m === "application/pdf" ||
    m.includes("word") ||
    m.startsWith("video/")
  );
}

export function maxBytesForFile(kind: BulkContentKind, file: BulkFileLike): number {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const m = String(file.type || "").toLowerCase();
  if (kind === "lecture") return MAX_VIDEO_BYTES;
  if (PDF_EXT.has(ext) || m === "application/pdf") return MAX_PDF_BYTES;
  if (DOC_EXT.has(ext) || m.includes("word")) return MAX_DOC_BYTES;
  if (VIDEO_EXT.has(ext) || m.startsWith("video/")) return MAX_VIDEO_BYTES;
  return MAX_PDF_BYTES;
}

export function validateFileForKind(kind: BulkContentKind, file: BulkFileLike): FileValidationResult {
  if (kind === "lecture" && !isVideoFile(file)) {
    return { ok: false, reason: "wrong_type", message: "Lectures must be video files" };
  }
  if (kind === "material" && !isMaterialFile(file)) {
    return { ok: false, reason: "wrong_type", message: "Materials must be PDF, DOC, or video" };
  }
  const cap = maxBytesForFile(kind, file);
  if (file.size > cap) {
    return {
      ok: false,
      reason: "too_large",
      message: `Too large (${formatBytes(file.size)} > ${formatBytes(cap)} limit)`,
    };
  }
  return { ok: true };
}

export function validateBatch(files: BulkFileLike[], kind: BulkContentKind): BatchValidationResult {
  if (files.length === 0) return { ok: false, error: "No files selected", files: [] };
  if (files.length > MAX_FILES_PER_BATCH) {
    return {
      ok: false,
      error: `Maximum ${MAX_FILES_PER_BATCH} files per batch`,
      files: files.slice(0, MAX_FILES_PER_BATCH),
    };
  }
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MAX_BATCH_BYTES) {
    return {
      ok: false,
      error: `Total batch size ${formatBytes(total)} exceeds ${formatBytes(MAX_BATCH_BYTES)} limit`,
      files,
    };
  }
  return { ok: true, files };
}

export function probeVideoDurationWeb(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    };
    video.onloadedmetadata = () => {
      const secs = Number(video.duration);
      cleanup();
      if (!Number.isFinite(secs) || secs <= 0) {
        resolve(0);
        return;
      }
      resolve(Math.ceil(secs / 60));
    };
    video.onerror = () => {
      cleanup();
      resolve(0);
    };
    video.src = url;
  });
}

export function computeBaseOrderIndex(
  items: Array<{ section_title?: string | null; order_index?: number | null; subject_key?: string | null }>,
  opts: { sectionTitle?: string | null; subjectKey?: string | null },
): number {
  const section = String(opts.sectionTitle || "").trim();
  const subject = opts.subjectKey ? String(opts.subjectKey).trim().toLowerCase() : null;
  const scoped = items.filter((row) => {
    const rowSection = String(row.section_title || "").trim();
    if (section && rowSection !== section) return false;
    if (subject) {
      const rowSubject = String(row.subject_key || "").trim().toLowerCase();
      if (rowSubject !== subject) return false;
    }
    return true;
  });
  const max = scoped.reduce((m, row) => Math.max(m, Number(row.order_index) || 0), -1);
  return max + 1;
}

/** Walk web FileSystemEntry tree from drag-drop or folder input. */
export async function collectFilesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (f) => resolve([f]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: File[] = [];
  const readBatch = (): Promise<FileSystemEntry[]> =>
    new Promise((resolve) => {
      reader.readEntries(resolve, () => resolve([]));
    });
  let batch = await readBatch();
  while (batch.length > 0) {
    for (const child of batch) {
      const nested = await collectFilesFromEntry(child);
      all.push(...nested);
    }
    batch = await readBatch();
  }
  return all;
}

export async function collectFilesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = dt.items;
  if (items && items.length > 0) {
    const out: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = item.webkitGetAsEntry?.();
      if (entry) {
        out.push(...(await collectFilesFromEntry(entry)));
      } else {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }
  return Array.from(dt.files || []);
}
