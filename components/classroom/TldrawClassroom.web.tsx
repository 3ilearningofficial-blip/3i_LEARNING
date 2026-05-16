import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Tldraw, type Editor, type TLAsset, type TLAssetStore } from "tldraw";
import { useSync } from "@tldraw/sync";
import { View, ActivityIndicator, StyleSheet, Text, Platform } from "react-native";
import "@tldraw/tldraw/tldraw.css";
import { buildClassroomSyncUriWithAuth } from "@/lib/classroom/syncUri";
import Colors from "@/constants/colors";
import type { TldrawClassroomHandle } from "./TldrawClassroom.types";

export type { TldrawClassroomHandle } from "./TldrawClassroom.types";

const TLDRAW_LICENSE_KEY =
  process.env.EXPO_PUBLIC_TLDRAW_LICENSE_KEY ||
  process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY ||
  "";

type Props = {
  liveClassId: string;
  readonly?: boolean;
  preview?: boolean;
};

const assetStore: TLAssetStore = {
  async upload(_asset: TLAsset, file: File) {
    const src = URL.createObjectURL(file);
    return { src };
  },
  resolve(asset: TLAsset) {
    return asset.props.src;
  },
};

function TldrawClassroomConnected({
  uri,
  readonly,
  editorRef,
}: {
  uri: string;
  readonly: boolean;
  editorRef: React.MutableRefObject<Editor | null>;
}) {
  const store = useSync({
    uri,
    assets: assetStore,
  });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#0a0a0a" }}>
      <Tldraw
        licenseKey={TLDRAW_LICENSE_KEY}
        store={store}
        onMount={(editor: Editor) => {
          editorRef.current = editor;
          if (readonly) {
            editor.updateInstanceState({ isReadonly: true });
          }
          editor.user.updateUserPreferences({ colorScheme: "dark" });
        }}
      />
    </div>
  );
}

const TldrawClassroomWeb = forwardRef<TldrawClassroomHandle, Props>(function TldrawClassroomWeb(
  { liveClassId, readonly = false, preview = false },
  ref
) {
  const editorRef = useRef<Editor | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [uriError, setUriError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    getEditor: () => editorRef.current,
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

  if (needsLicense) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>
          Whiteboard needs a tldraw license on HTTPS. Add EXPO_PUBLIC_TLDRAW_LICENSE_KEY to Vercel and
          EC2 env (get a key at tldraw.dev).
        </Text>
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
      <TldrawClassroomConnected uri={uri} readonly={!!readonly} editorRef={editorRef} />
    </View>
  );
});

export default TldrawClassroomWeb;

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 200, backgroundColor: "#0a0a0a" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: Colors.light.textMuted },
  errorText: { fontSize: 14, color: Colors.light.error, textAlign: "center", padding: 16 },
});
