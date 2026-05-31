import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Tldraw, type Editor, type TLAssetStore } from "tldraw";
import { useSync } from "@tldraw/sync";
import { View, ActivityIndicator, StyleSheet, Text, Platform } from "react-native";
import "@tldraw/tldraw/tldraw.css";
import { buildClassroomSyncUriWithAuth } from "@/lib/classroom/syncUri";
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
  classroomTeachingOverrides,
} from "@/lib/classroom/tldrawTeachingUi";
import { restoreClassroomBoardCheckpoint } from "@/lib/classroom/useClassroomBoardCheckpoint";
import Colors from "@/constants/colors";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";

export type { TldrawClassroomHandle } from "./TldrawClassroom.types";

const TLDRAW_LICENSE_KEY = getTldrawLicenseKey();
const TLDRAW_LICENSE_HINT = tldrawLicenseHint(TLDRAW_LICENSE_KEY);
let classroomTouchPatchInstalled = false;

function installClassroomNonPassiveTouchPatch() {
  if (Platform.OS !== "web" || typeof EventTarget === "undefined" || classroomTouchPatchInstalled) return;
  classroomTouchPatchInstalled = true;

  const proto = EventTarget.prototype as typeof EventTarget.prototype & {
    __classroomAddEventListener?: EventTarget["addEventListener"];
  };
  if (proto.__classroomAddEventListener) return;

  const original = proto.addEventListener;
  proto.__classroomAddEventListener = original;
  proto.addEventListener = function patchedAddEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) {
    if ((type === "touchstart" || type === "touchmove" || type === "touchend") && options !== false) {
      const nextOptions =
        typeof options === "object" && options !== null
          ? { ...options, passive: false }
          : { capture: options === true, passive: false };
      return original.call(this, type, listener, nextOptions);
    }
    return original.call(this, type, listener, options);
  };
}

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
        overrides={readonly ? undefined : classroomTeachingOverrides}
        components={readonly ? undefined : classroomTeachingComponents}
        onMount={(editor: Editor) => {
          editorRef.current = editor;
          setMountedEditor(editor);
          setupClassroomSlideEditor(editor, !!readonly);
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
  installClassroomNonPassiveTouchPatch();
  const editorRef = useRef<Editor | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [uriError, setUriError] = useState<string | null>(null);

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
        if (!cancelled) setUri(u);
      })
      .catch((e) => {
        if (!cancelled) setUriError(e?.message || "Failed to connect to board");
      });
    return () => {
      cancelled = true;
    };
  }, [liveClassId, preview]);

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
