import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import type { Editor, TLPageId } from "tldraw";
import { apiRequest, authFetch, getApiUrl, toHttpsMediaUrl } from "@/lib/query-client";
import { uploadToR2 } from "@/lib/r2-upload";

const CHECKPOINT_INTERVAL_MS = 120_000;
const DEBOUNCE_MS = 10_000;

type CheckpointMeta = {
  checkpointUrl: string | null;
  checkpointAt: number;
};

function getSnapshotPageCount(snapshot: unknown): number {
  const records =
    (snapshot as { document?: { store?: { records?: Record<string, { typeName?: string }> } } })
      ?.document?.store?.records ??
    (snapshot as { store?: { records?: Record<string, { typeName?: string }> } })?.store?.records;
  if (!records || typeof records !== "object") return 0;
  return Object.values(records).filter((r) => r?.typeName === "page").length;
}

function countLocalBoardState(editor: Editor): { pageCount: number; shapeCount: number } {
  const pages = editor.getPages();
  const originalPageId = editor.getCurrentPageId();
  let shapeCount = 0;
  for (const page of pages) {
    editor.setCurrentPage(page.id as TLPageId);
    shapeCount += editor.getCurrentPageShapeIds().size;
  }
  if (originalPageId) {
    try {
      editor.setCurrentPage(originalPageId);
    } catch {
      /* page may have been removed */
    }
  }
  return { pageCount: pages.length, shapeCount };
}

async function parseJsonSnapshotResponse(res: Response, source: string): Promise<unknown | null> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith("<")) {
    console.warn(
      `[Classroom] checkpoint restore: ${source} returned HTML (status ${res.status}), not JSON`
    );
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    console.warn(`[Classroom] checkpoint restore: ${source} returned non-JSON body (status ${res.status})`);
    return null;
  }
}

async function fetchCheckpointMeta(liveClassId: string): Promise<CheckpointMeta | null> {
  const res = await authFetch(
    `${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/classroom/board-checkpoint`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { checkpointUrl?: string; checkpointAt?: number };
  return {
    checkpointUrl: String(data.checkpointUrl || "").trim() || null,
    checkpointAt: Number(data.checkpointAt) || 0,
  };
}

async function fetchCheckpointSnapshot(
  liveClassId: string,
  publicUrl?: string | null
): Promise<unknown | null> {
  const proxyRes = await authFetch(
    `${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/classroom/board-checkpoint/snapshot`
  );
  if (proxyRes.ok) {
    const fromProxy = await parseJsonSnapshotResponse(proxyRes, "snapshot proxy");
    if (fromProxy) return fromProxy;
  } else if (proxyRes.status !== 404) {
    // 404 is expected on a fresh session — the server auto-checkpoint runs
    // only every ~2 minutes, so there is no snapshot to restore until then.
    // The browser still logs the 404 as a red "Failed to load resource" line
    // even though we handle it, but we don't want to add our own warn on top.
    console.warn(`[Classroom] snapshot proxy failed (${proxyRes.status})`);
  }

  const url = String(publicUrl || "").trim();
  if (!url) return null;
  const snapRes = await fetch(toHttpsMediaUrl(url), { cache: "no-store" });
  if (!snapRes.ok) {
    console.warn(`[Classroom] checkpoint restore: public URL fetch failed (${snapRes.status})`);
    return null;
  }
  return parseJsonSnapshotResponse(snapRes, url);
}

function shouldRestoreFromCheckpoint(
  editor: Editor,
  snapshot: unknown,
  checkpointAt: number
): boolean {
  const local = countLocalBoardState(editor);
  if (local.shapeCount === 0) return true;
  const remotePages = getSnapshotPageCount(snapshot);
  return remotePages > local.pageCount && checkpointAt > 0;
}

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
    const meta = await fetchCheckpointMeta(liveClassId);
    const snapshot = await fetchCheckpointSnapshot(liveClassId, meta?.checkpointUrl ?? null);
    if (!snapshot) return false;
    if (!shouldRestoreFromCheckpoint(editor, snapshot, meta?.checkpointAt ?? 0)) return false;

    editor.loadSnapshot(snapshot);
    return true;
  } catch (e) {
    console.warn("[Classroom] checkpoint restore failed:", e);
    return false;
  }
}
