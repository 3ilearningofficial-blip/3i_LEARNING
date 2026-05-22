import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { Editor } from "tldraw";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";

const CHECKPOINT_INTERVAL_MS = 120_000;
const DEBOUNCE_MS = 30_000;

export function useClassroomBoardCheckpoint(
  liveClassId: string,
  editor: Editor | null,
  enabled: boolean
) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUploadRef = useRef(0);

  const uploadCheckpoint = useCallback(async () => {
    if (Platform.OS !== "web" || !editor || !liveClassId) return;
    try {
      const snapshot = editor.getSnapshot();
      const json = JSON.stringify(snapshot);
      const blob = new Blob([json], { type: "application/json" });
      const filename = `classroom-sync-${liveClassId}-${Date.now()}.json`;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const { publicUrl } = await uploadToR2(
          objectUrl,
          filename,
          "application/json",
          "live-class-recording",
          undefined,
          "/api/upload/presign"
        );
        await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}/classroom/board-checkpoint`, {
          checkpointUrl: publicUrl,
        });
        lastUploadRef.current = Date.now();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (e) {
      console.warn("[Classroom] checkpoint upload failed:", e);
    }
  }, [editor, liveClassId]);

  const scheduleDebounced = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void uploadCheckpoint();
    }, DEBOUNCE_MS);
  }, [uploadCheckpoint]);

  useEffect(() => {
    if (!enabled || Platform.OS !== "web" || !editor || !liveClassId) return;

    const interval = setInterval(() => {
      void uploadCheckpoint();
    }, CHECKPOINT_INTERVAL_MS);

    const unsub = editor.store.listen(() => {
      scheduleDebounced();
    });

    return () => {
      clearInterval(interval);
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editor, enabled, liveClassId, uploadCheckpoint, scheduleDebounced]);

  return { uploadCheckpoint };
}

export async function restoreClassroomBoardCheckpoint(
  liveClassId: string,
  editor: Editor
): Promise<boolean> {
  if (Platform.OS !== "web") return false;
  try {
    const res = await authFetch(
      `${getApiUrl()}/api/admin/live-classes/${encodeURIComponent(liveClassId)}/classroom/board-checkpoint`
    );
    if (!res.ok) return false;
    const data = await res.json();
    const url = String(data.checkpointUrl || "").trim();
    if (!url) return false;

    const snapRes = await fetch(url);
    if (!snapRes.ok) return false;
    const snapshot = await snapRes.json();
    const pages = editor.getPages();
    const shapeCount = pages.reduce((n, p) => {
      editor.setCurrentPage(p.id);
      return n + editor.getCurrentPageShapeIds().size;
    }, 0);
    if (shapeCount > 0) return false;

    editor.loadSnapshot(snapshot);
    return true;
  } catch (e) {
    console.warn("[Classroom] checkpoint restore failed:", e);
    return false;
  }
}
