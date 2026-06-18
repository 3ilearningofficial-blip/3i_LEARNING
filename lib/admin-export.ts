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

export type AdminExportKind = "test" | "material" | "lecture";

function exportPath(kind: AdminExportKind, id: number): string {
  if (kind === "test") return `/api/admin/export/test/${id}.pdf`;
  if (kind === "material") return `/api/admin/export/material/${id}`;
  return `/api/admin/export/lecture/${id}.mp4`;
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

  try {
    if (Platform.OS === "web") {
      const res = await globalThis.fetch(url, { method: "GET", credentials: "include", headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = suggestedFilename || `export-${kind}-${id}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      return;
    }

    const cacheDir = legacyFs.cacheDirectory;
    if (!cacheDir || !legacyFs.downloadAsync) {
      throw new Error("File download is not available on this device");
    }
    const dest = `${cacheDir}admin-export-${kind}-${id}-${Date.now()}`;
    const download = await legacyFs.downloadAsync(url, dest, { headers });
    if (download.status < 200 || download.status >= 300) {
      throw new Error(`Download failed (${download.status})`);
    }
    try {
      await Share.share({ url: download.uri, title: suggestedFilename || `export-${kind}-${id}` });
    } catch {
      Alert.alert("Downloaded", `Saved to ${download.uri}`);
    }
  } catch (err: any) {
    Alert.alert("Export failed", err?.message || "Could not download file");
  }
}
