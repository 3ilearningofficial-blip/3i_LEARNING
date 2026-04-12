import { Platform } from "react-native";
import { apiRequest, getApiUrl } from "./query-client";

export type UploadFolder = "lectures" | "materials" | "books" | "images" | "uploads";

export interface UploadResult {
  publicUrl: string;
  key: string;
}

/**
 * Upload a file to Cloudflare R2 with progress tracking.
 * Videos: direct browser → R2 via presigned URL (supports large files, needs CORS)
 * Other files: browser → server → R2 (no CORS needed, limited to ~500MB)
 */
export async function uploadToR2(
  fileUri: string,
  filename: string,
  contentType: string,
  folder: UploadFolder = "uploads",
  onProgress?: (pct: number) => void,
  presignEndpoint: string = "/api/upload/presign"
): Promise<UploadResult> {
  if (Platform.OS !== "web") {
    // Native: always use presigned URL (no CORS issues on native)
    let presignRes;
    try {
      presignRes = await apiRequest("POST", presignEndpoint, { filename, contentType, folder });
    } catch (err: any) {
      throw new Error(`Presign failed: ${err?.message || "Unknown error"}`);
    }
    const { uploadUrl, publicUrl, key } = await presignRes.json();
    await fetch(uploadUrl, {
      method: "PUT",
      body: { uri: fileUri, type: contentType, name: filename } as any,
      headers: { "Content-Type": contentType },
    });
    if (onProgress) onProgress(100);
    return { publicUrl, key };
  }

  // Web: convert fileUri to Blob
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

  const isVideo = contentType.startsWith("video/") || blob.size > 100 * 1024 * 1024; // videos or >100MB

  if (isVideo) {
    // Large files: direct upload to R2 via presigned URL (bypasses server memory)
    let presignRes;
    try {
      presignRes = await apiRequest("POST", presignEndpoint, { filename, contentType, folder });
    } catch (err: any) {
      throw new Error(`Presign failed: ${err?.message || "Unknown error"}`);
    }
    const { uploadUrl, publicUrl, key } = await presignRes.json();

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`R2 upload failed: ${xhr.status}. Make sure CORS is configured on R2 bucket.`));
      };
      xhr.onerror = () => reject(new Error("R2 upload failed — CORS not configured on R2 bucket. Go to Cloudflare Dashboard → R2 → Settings → CORS Policy and add AllowedOrigins: [\"*\"]"));
      xhr.send(blob);
    });

    if (onProgress) onProgress(100);
    return { publicUrl, key };
  } else {
    // Small files: upload via server (no CORS needed)
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("folder", folder);

    const baseUrl = getApiUrl();
    let token: string | null = null;
    let userId: string | null = null;
    try {
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem("user");
        if (stored) {
          const parsed = JSON.parse(stored);
          token = parsed?.sessionToken || null;
          userId = parsed?.id ? String(parsed.id) : null;
        }
      }
    } catch {}

    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${baseUrl}/api/upload/to-r2`);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (userId) xhr.setRequestHeader("X-User-Id", userId);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (onProgress) onProgress(100);
            resolve({ publicUrl: data.publicUrl, key: data.key });
          } catch { reject(new Error("Invalid server response")); }
        } else {
          reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload network error"));
      xhr.send(formData);
    });
  }
}

export function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] || "application/octet-stream";
}
