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

type SnapshotBoardStats = { pageCount: number; shapeCount: number };

/**
 * Editor `getSnapshot()` JSON has document.store.records (or store.records).
 * Server auto-checkpoints are tldraw RoomSnapshots with a top-level `documents` array.
 * Client `loadSnapshot` only accepts the editor shape.
 */
export function isEditorBoardSnapshot(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const s = snapshot as Record<string, unknown>;
  if (Array.isArray(s.documents)) return false;
  const records =
    (s.document as { store?: { records?: unknown } } | undefined)?.store?.records ??
    (s.store as { records?: unknown } | undefined)?.records;
  return !!records && typeof records === "object";
}

function getEditorSnapshotRecords(
  snapshot: unknown
): Record<string, { typeName?: string }> | null {
  if (!isEditorBoardSnapshot(snapshot)) return null;
  const s = snapshot as {
    document?: { store?: { records?: Record<string, { typeName?: string }> } };
    store?: { records?: Record<string, { typeName?: string }> };
  };
  return s.document?.store?.records ?? s.store?.records ?? null;
}

function getSnapshotBoardStats(snapshot: unknown): SnapshotBoardStats {
  const records = getEditorSnapshotRecords(snapshot);
  if (!records) return { pageCount: 0, shapeCount: 0 };
  let pageCount = 0;
  let shapeCount = 0;
  for (const r of Object.values(records)) {
    if (r?.typeName === "page") pageCount += 1;
    if (r?.typeName === "shape") shapeCount += 1;
  }
  return { pageCount, shapeCount };
}

function countLocalBoardState(editor: Editor): SnapshotBoardStats {
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
  meta: CheckpointMeta | null
): Promise<unknown | null> {
  const publicUrl = String(meta?.checkpointUrl || "").trim();
  const checkpointAt = Number(meta?.checkpointAt) || 0;

  // On a fresh session the server has not written any checkpoint yet, so
  // hitting /snapshot is guaranteed to 404 and DevTools paints a red row
  // even though we handle it. Skip the proxy call entirely in that case
  // to keep the console clean.
  if (!publicUrl && checkpointAt <= 0) {
    return null;
  }

  const proxyRes = await authFetch(
    `${getApiUrl()}/admin/live-classes/${encodeURIComponent(liveClassId)}/classroom/board-checkpoint/snapshot`
  );
  if (proxyRes.ok) {
    const fromProxy = await parseJsonSnapshotResponse(proxyRes, "snapshot proxy");
    if (fromProxy && isEditorBoardSnapshot(fromProxy)) return fromProxy;
  } else if (proxyRes.status !== 404) {
    console.warn(`[Classroom] snapshot proxy failed (${proxyRes.status})`);
  }

  if (!publicUrl) return null;
  const snapRes = await fetch(toHttpsMediaUrl(publicUrl), { cache: "no-store" });
  if (!snapRes.ok) {
    console.warn(`[Classroom] checkpoint restore: public URL fetch failed (${snapRes.status})`);
    return null;
  }
  const parsed = await parseJsonSnapshotResponse(snapRes, publicUrl);
  if (parsed && isEditorBoardSnapshot(parsed)) return parsed;
  return null;
}

function shouldRestoreFromCheckpoint(
  editor: Editor,
  snapshot: unknown,
  checkpointAt: number
): boolean {
  if (!isEditorBoardSnapshot(snapshot)) return false;
  if (!(checkpointAt > 0)) return false;
  const local = countLocalBoardState(editor);
  if (local.shapeCount === 0) return true;
  const remote = getSnapshotBoardStats(snapshot);
  return remote.pageCount > local.pageCount || remote.shapeCount > local.shapeCount;
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
    const snapshot = await fetchCheckpointSnapshot(liveClassId, meta);
    if (!snapshot) return false;
    if (!shouldRestoreFromCheckpoint(editor, snapshot, meta?.checkpointAt ?? 0)) return false;

    // loadSnapshot expects editor-shaped JSON only (never RoomSnapshot).
    editor.loadSnapshot(snapshot as Parameters<Editor["loadSnapshot"]>[0]);
    return true;
  } catch (e) {
    console.warn("[Classroom] checkpoint restore failed:", e);
    return false;
  }
}
