import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Tldraw, type Editor, type TLAssetStore } from "tldraw";
import { useSync } from "@tldraw/sync";
import { View, ActivityIndicator, StyleSheet, Text, Platform } from "react-native";
import "@tldraw/tldraw/tldraw.css";
import { buildClassroomSyncUriWithAuth, CLASSROOM_SYNC_URI_REFRESH_MS } from "@/lib/classroom/syncUri";
import { installClassroomDomGuards } from "@/lib/classroom/installClassroomDomGuards";
import { getTldrawLicenseKey, tldrawLicenseHint } from "@/lib/tldrawLicense";
import { createClassroomAssetStore } from "@/lib/classroom/classroomAssetStore";
import {
  setupClassroomSlideEditor,
  getPageCount,
  getPageIndex,
  goToPageIndex,
  addClassroomPage,
  removeClassroomPage,
  clearCurrentPageShapes,
} from "@/lib/classroom/classroomSlideEditor";
import {
  classroomTeachingComponents,
  getClassroomTeachingOverrides,
} from "@/lib/classroom/tldrawTeachingUi";
import { restoreClassroomBoardCheckpoint } from "@/lib/classroom/useClassroomBoardCheckpoint";
import Colors from "@/constants/colors";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";

export type { TldrawClassroomHandle } from "./TldrawClassroom.types";

const TLDRAW_LICENSE_KEY = getTldrawLicenseKey();
const TLDRAW_LICENSE_HINT = tldrawLicenseHint(TLDRAW_LICENSE_KEY);

// Install before tldraw attaches gesture listeners (module load + mount).
installClassroomDomGuards();

type Props = {
  liveClassId: string;
  readonly?: boolean;
  preview?: boolean;
  onEditorReady?: (editor: Editor | null) => void;
};

function TldrawClassroomConnected({
  uri,
  readonly,
  preview,
  liveClassId,
  editorRef,
  onEditorReady,
}: {
  uri: string;
  readonly: boolean;
  preview: boolean;
  liveClassId: string;
  editorRef: React.MutableRefObject<Editor | null>;
  onEditorReady?: (editor: Editor | null) => void;
}) {
  const lockViewport = !readonly && !preview;
  const teachingOverrides = lockViewport
    ? getClassroomTeachingOverrides(true)
    : getClassroomTeachingOverrides(false);
  const [slowConnect, setSlowConnect] = useState(false);
  const [mountedEditor, setMountedEditor] = useState<Editor | null>(null);
  const assets: TLAssetStore = React.useMemo(
    () => createClassroomAssetStore(liveClassId),
    [liveClassId]
  );
  const store = useSync({
    uri,
    assets,
  });

  const syncReady = store.status !== "loading" && store.status !== "error";

  useEffect(() => {
    if (!syncReady || readonly || preview || !mountedEditor) return;
    void restoreClassroomBoardCheckpoint(liveClassId, mountedEditor);
  }, [syncReady, readonly, preview, liveClassId, mountedEditor]);

  useEffect(() => {
    if (store.status !== "loading") {
      setSlowConnect(false);
      return;
    }
    const t = setTimeout(() => setSlowConnect(true), 8000);
    return () => clearTimeout(t);
  }, [store.status]);

  if (store.status === "loading") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Connecting whiteboard…</Text>
        {slowConnect ? (
          <Text style={styles.hintSub}>
            Still connecting? The board uses wss://api.3ilearning.in — redeploy the web app and
            ensure EC2 is on the latest main (classroom-sync).
          </Text>
        ) : null}
      </View>
    );
  }

  if (store.status === "error") {
    const msg = store.error?.message || "Whiteboard sync failed";
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {msg.includes("timeout")
            ? "Whiteboard could not connect (timed out). Check EXPO_PUBLIC_API_BASE_URL points to your API server, deploy the latest backend (classroom-sync auth fix), and confirm the board WebSocket is reachable."
            : msg}
        </Text>
      </View>
    );
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        background: "#0a0a0a",
        overscrollBehavior: "contain",
        touchAction: "none",
      }}
    >
      <style>{`
        .tl-container,
        .tl-canvas,
        .tl-html-layer,
        .tl-overlays,
        .tlui-layout {
          overscroll-behavior: contain !important;
          touch-action: none !important;
        }
      `}</style>
      <Tldraw
        {...(TLDRAW_LICENSE_KEY ? { licenseKey: TLDRAW_LICENSE_KEY } : {})}
        store={store.store}
        hideUi={readonly}
        overrides={readonly ? undefined : teachingOverrides}
        components={readonly ? undefined : classroomTeachingComponents}
        onMount={(editor: Editor) => {
          editorRef.current = editor;
          setMountedEditor(editor);
          setupClassroomSlideEditor(editor, !!readonly, { lockViewport });
          onEditorReady?.(editor);
        }}
      />
    </div>
  );
}

const TldrawClassroomWeb = forwardRef<TldrawClassroomHandle, Props>(function TldrawClassroomWeb(
  { liveClassId, readonly = false, preview = false, onEditorReady },
  ref
) {
  installClassroomDomGuards();
  const editorRef = useRef<Editor | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [uriError, setUriError] = useState<string | null>(null);
  const [uriNonce, setUriNonce] = useState(0);

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
    getPageCount: () => getPageCount(editorRef.current),
    getPageIndex: () => getPageIndex(editorRef.current),
    goToPage: (index: number) => goToPageIndex(editorRef.current, index),
    addPage: () => {
      addClassroomPage(editorRef.current);
    },
    removePage: () => removeClassroomPage(editorRef.current),
    clearCurrentPage: () => clearCurrentPageShapes(editorRef.current),
  }));

  useEffect(() => {
    let cancelled = false;
    void buildClassroomSyncUriWithAuth(liveClassId, preview)
      .then((u) => {
        if (!cancelled) {
          setUri(u);
          setUriError(null);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        // Keep an existing live board up if a mid-session token refresh fails.
        setUri((prev) => {
          if (prev) {
            console.warn("[Classroom] sync token refresh failed:", e?.message || e);
            return prev;
          }
          setUriError(e?.message || "Failed to connect to board");
          return prev;
        });
      });
    return () => {
      cancelled = true;
    };
  }, [liveClassId, preview, uriNonce]);

  // Refresh the path token before it expires so mid-class reconnects stay authenticated.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const id = setInterval(() => setUriNonce((n) => n + 1), CLASSROOM_SYNC_URI_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // After a long background (laptop sleep), refresh auth once so reconnect does not
  // reuse an expired path token. Ignore short tab switches to avoid remount churn.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    let hiddenAt = 0;
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt > 0 && Date.now() - hiddenAt > 2 * 60 * 1000) {
        setUriNonce((n) => n + 1);
      }
      hiddenAt = 0;
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  const needsLicense =
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    !TLDRAW_LICENSE_KEY;

  if (needsLicense || TLDRAW_LICENSE_HINT) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          {TLDRAW_LICENSE_HINT ||
            "Whiteboard needs a tldraw license on HTTPS. Add EXPO_PUBLIC_TLDRAW_LICENSE_KEY on Vercel (Production + Preview), redeploy, and get a key at tldraw.dev/get-a-license/trial."}
        </Text>
        {typeof window !== "undefined" ? (
          <Text style={styles.hintSub}>Current host: {window.location.hostname}</Text>
        ) : null}
      </View>
    );
  }

  if (uriError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{uriError}</Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Connecting whiteboard…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <TldrawClassroomConnected
        uri={uri}
        readonly={!!readonly}
        preview={!!preview}
        liveClassId={liveClassId}
        editorRef={editorRef}
        onEditorReady={onEditorReady}
      />
    </View>
  );
});

export default TldrawClassroomWeb;

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 200, backgroundColor: "#0a0a0a", width: "100%", height: "100%" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: Colors.light.textMuted },
  errorText: { fontSize: 14, color: Colors.light.error, textAlign: "center", padding: 16 },
  hintSub: { fontSize: 12, color: Colors.light.textMuted, textAlign: "center", paddingHorizontal: 16 },
});
