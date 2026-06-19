import { Platform, Alert, Share } from "react-native";
import * as FileSystem from "expo-file-system";
import { getApiUrl, prepareAuthorizedFetchHeaders } from "@/lib/query-client";

const legacyFs = FileSystem as typeof FileSystem & {
  cacheDirectory?: string | null;
  downloadAsync?: (
    uri: string,
    fileUri: string,
    options?: { headers?: Record<string, string> },
  ) => Promise<{ status: number; uri: string }>;
};

export type AdminExportKind = "test" | "material" | "lecture" | "mission";

function exportPath(kind: AdminExportKind, id: number): string {
  if (kind === "test") return `/api/admin/export/test/${id}.pdf`;
  if (kind === "mission") return `/api/admin/export/mission/${id}.pdf`;
  if (kind === "material") return `/api/admin/export/material/${id}`;
  return `/api/admin/export/lecture/${id}.mp4`;
}

function defaultFilename(kind: AdminExportKind, id: number): string {
  if (kind === "test" || kind === "mission") return `export-${kind}-${id}.pdf`;
  if (kind === "material") return `export-material-${id}`;
  return `export-lecture-${id}.mp4`;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      /* fall through */
    }
  }
  const plain = header.match(/filename="([^"]+)"/i) || header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim() || null;
}

function showExportError(message: string): void {
  if (Platform.OS === "web") window.alert(message);
  else Alert.alert("Export failed", message);
}

export async function downloadAdminContent(
  kind: AdminExportKind,
  id: number,
  suggestedFilename?: string,
): Promise<void> {
  const baseUrl = getApiUrl();
  const path = exportPath(kind, id);
  const url = new URL(path, baseUrl).toString();
  const { headers } = await prepareAuthorizedFetchHeaders();
  const fallbackName = suggestedFilename || defaultFilename(kind, id);

  try {
    if (Platform.OS === "web") {
      const res = await globalThis.fetch(url, {
        method: "GET",
        credentials: "include",
        headers,
        redirect: "follow",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const downloadName = filenameFromDisposition(res.headers.get("Content-Disposition")) || fallbackName;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }

    const cacheDir = legacyFs.cacheDirectory;
    if (!cacheDir || !legacyFs.downloadAsync) {
      throw new Error("File download is not available on this device");
    }
    const dest = `${cacheDir}${fallbackName.replace(/[^\w.\- ()[\]]+/g, "_")}`;
    const download = await legacyFs.downloadAsync(url, dest, { headers });
    if (download.status < 200 || download.status >= 300) {
      throw new Error(`Download failed (${download.status})`);
    }
    try {
      await Share.share({ url: download.uri, title: fallbackName });
    } catch {
      Alert.alert("Downloaded", `Saved to ${download.uri}`);
    }
  } catch (err: any) {
    showExportError(err?.message || "Could not download file");
  }
}
