import { Platform } from "react-native";
import { apiRequest } from "./query-client";

export type UploadFolder =
  | "lectures"
  | "materials"
  | "books"
  | "images"
  | "uploads"
  /** R2 path prefix `live-class-recording/` (optional chapter subfolder via `subfolder`) */
  | "live-class-recording";

export interface UploadResult {
  publicUrl: string;
  key: string;
}

export interface UploadToR2Options {
  onProgress?: (pct: number) => void;
  presignEndpoint?: string;
  subfolder?: string;
  signal?: AbortSignal;
  contentLength?: number;
}

export async function deleteR2Orphan(key: string): Promise<void> {
  try {
    await apiRequest("DELETE", "/api/upload/file", { key });
  } catch {
    // Non-fatal — nightly sweep can catch stragglers
  }
}

export async function uploadToR2(
  fileUri: string,
  filename: string,
  contentType: string,
  folder: UploadFolder = "uploads",
  onProgressOrOptions?: ((pct: number) => void) | UploadToR2Options,
  presignEndpointLegacy?: string,
  subfolderLegacy?: string,
): Promise<UploadResult> {
  const opts: UploadToR2Options =
    typeof onProgressOrOptions === "function"
      ? {
          onProgress: onProgressOrOptions,
          presignEndpoint: presignEndpointLegacy,
          subfolder: subfolderLegacy,
        }
      : onProgressOrOptions || {};

  const {
    onProgress,
    presignEndpoint = "/api/upload/presign",
    subfolder,
    signal,
    contentLength,
  } = opts;

  if (signal?.aborted) {
    throw new DOMException("Upload aborted", "AbortError");
  }

  let presignRes;

  try {
    const body: Record<string, string | number> = {
      filename,
      contentType,
      folder,
    };
    if (folder === "live-class-recording" && subfolder && String(subfolder).trim() !== "") {
      body.subfolder = String(subfolder).trim();
    }
    if (contentLength != null && Number.isFinite(contentLength) && contentLength > 0) {
      body.contentLength = contentLength;
    }
    presignRes = await apiRequest("POST", presignEndpoint, body);
  } catch (err: any) {
    throw new Error(`Presign failed: ${err?.message || "Unknown error"}`);
  }

  const { uploadUrl, publicUrl, key } = await presignRes.json();

  const putWithXhr = (sendBody: Blob | { uri: string; type: string; name: string }) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const onAbort = () => {
        xhr.abort();
        finish(() => reject(new DOMException("Upload aborted", "AbortError")));
      };

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.timeout = 1000 * 60 * 60;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      xhr.onload = () => {
        signal?.removeEventListener("abort", onAbort);
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100);
          finish(resolve);
        } else {
          finish(() => reject(new Error(`Upload failed: ${xhr.status}`)));
        }
      };

      xhr.onerror = () => {
        signal?.removeEventListener("abort", onAbort);
        finish(() => reject(new Error("Upload error")));
      };

      xhr.ontimeout = () => {
        signal?.removeEventListener("abort", onAbort);
        finish(() => reject(new Error("Upload timeout")));
      };

      xhr.send(sendBody as any);
    });

  if (Platform.OS !== "web") {
    await putWithXhr({
      uri: fileUri,
      type: contentType || "application/octet-stream",
      name: filename || "upload",
    });
    return { publicUrl, key };
  }

  let blob: Blob;
  if (fileUri.startsWith("data:")) {
    const [, b64] = fileUri.split(",");
    const byteString = atob(b64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    blob = new Blob([ab], { type: contentType });
  } else {
    const response = await fetch(fileUri);
    blob = await response.blob();
  }

  try {
    await putWithXhr(blob);
  } catch (firstErr) {
    if (firstErr instanceof DOMException && firstErr.name === "AbortError") throw firstErr;
    await new Promise((r) => setTimeout(r, 800));
    if (signal?.aborted) throw new DOMException("Upload aborted", "AbortError");
    try {
      await putWithXhr(blob);
    } catch {
      throw firstErr;
    }
  }

  return { publicUrl, key };
}

export type BulkUploadJobFile =
  | File
  | { uri: string; name: string; mimeType: string; size: number };

export interface BulkUploadJob {
  id: string;
  file: BulkUploadJobFile;
  folder: UploadFolder;
}

export interface UploadManyCallbacks {
  onProgress: (id: string, pct: number) => void;
  onDone: (id: string, result: UploadResult) => void;
  onError: (id: string, err: Error) => void;
}

export interface UploadManyOptions {
  concurrency?: number;
  getSignal: (id: string) => AbortSignal | undefined;
}

export async function uploadManyToR2(
  jobs: BulkUploadJob[],
  callbacks: UploadManyCallbacks,
  options: UploadManyOptions,
): Promise<void> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  let cursor = 0;
  let active = 0;

  await new Promise<void>((resolve) => {
    const pump = () => {
      while (active < concurrency && cursor < jobs.length) {
        const job = jobs[cursor++];
        active++;
        void (async () => {
          try {
            const signal = options.getSignal(job.id);
            if (signal?.aborted) {
              callbacks.onError(job.id, new DOMException("Upload aborted", "AbortError"));
              return;
            }

            let fileUri: string;
            let filename: string;
            let contentType: string;
            let contentLength: number | undefined;

            if (job.file instanceof File) {
              fileUri = URL.createObjectURL(job.file);
              filename = job.file.name;
              contentType = job.file.type || getMimeType(job.file.name);
              contentLength = job.file.size;
            } else {
              fileUri = job.file.uri;
              filename = job.file.name;
              contentType = job.file.mimeType || getMimeType(job.file.name);
              contentLength = job.file.size;
            }

            const result = await uploadToR2(fileUri, filename, contentType, job.folder, {
              onProgress: (pct) => callbacks.onProgress(job.id, pct),
              signal,
              contentLength,
            });

            if (job.file instanceof File) URL.revokeObjectURL(fileUri);
            callbacks.onDone(job.id, result);
          } catch (err: any) {
            callbacks.onError(job.id, err instanceof Error ? err : new Error(String(err)));
          } finally {
            active--;
            if (cursor >= jobs.length && active === 0) resolve();
            else pump();
          }
        })();
      }
      if (cursor >= jobs.length && active === 0) resolve();
    };
    if (jobs.length === 0) resolve();
    else pump();
  });
}

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  const map: Record<string, string> = {
    pdf: "application/pdf",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    webm: "video/webm",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };

  return map[ext] || "application/octet-stream";
}
