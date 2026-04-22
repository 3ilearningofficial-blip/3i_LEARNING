import { Platform } from "react-native";
import { apiRequest } from "./query-client";

export type UploadFolder =
  | "lectures"
  | "materials"
  | "books"
  | "images"
  | "uploads";

export interface UploadResult {
  publicUrl: string;
  key: string;
}

export async function uploadToR2(
  fileUri: string,
  filename: string,
  contentType: string,
  folder: UploadFolder = "uploads",
  onProgress?: (pct: number) => void,
  presignEndpoint: string = "/upload/presign"
): Promise<UploadResult> {
  let presignRes;

  // =========================
  // 🔑 STEP 1: Get presigned URL
  // =========================
  try {
    presignRes = await apiRequest("POST", presignEndpoint, {
      filename,
      contentType,
      folder,
    });
  } catch (err: any) {
    throw new Error(`Presign failed: ${err?.message || "Unknown error"}`);
  }

  const { uploadUrl, publicUrl, key } = await presignRes.json();

  // =========================
  // 📱 MOBILE (React Native)
  // =========================
  if (Platform.OS !== "web") {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType);

      xhr.timeout = 1000 * 60 * 10;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (onProgress) onProgress(100);
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error("Upload error"));
      xhr.ontimeout = () => reject(new Error("Upload timeout"));

      xhr.send({
        uri: fileUri,
        type: contentType || "application/octet-stream",
        name: filename || "upload",
      } as any);
    });

    return { publicUrl, key };
  }

  // =========================
  // 🌐 WEB
  // =========================

  // Convert fileUri → Blob
  let blob: Blob;

  if (fileUri.startsWith("data:")) {
    const [, b64] = fileUri.split(",");
    const byteString = atob(b64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);

    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }

    blob = new Blob([ab], { type: contentType });
  } else {
    const response = await fetch(fileUri);
    blob = await response.blob();
  }

  // =========================
  // 🚀 Upload using XHR (for progress)
  // =========================
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);

    xhr.timeout = 1000 * 60 * 10;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `R2 upload failed: ${xhr.status}. Check R2 CORS settings.`
          )
        );
      }
    };

    xhr.onerror = () =>
      reject(
        new Error(
          "Upload failed — check Cloudflare R2 CORS configuration."
        )
      );

    xhr.ontimeout = () => reject(new Error("Upload timeout"));

    xhr.send(blob);
  });

  return { publicUrl, key };
}

// =========================
// 📎 MIME TYPE HELPER
// =========================

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