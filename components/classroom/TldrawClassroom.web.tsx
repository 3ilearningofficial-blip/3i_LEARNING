import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { Tldraw } from "@tldraw/tldraw";
import { useSync } from "@tldraw/sync";
import type { TLAssetStore } from "tldraw";
import "@tldraw/tldraw/tldraw.css";
import { buildClassroomSyncUriWithAuth } from "@/lib/classroom/syncUri";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  readonly?: boolean;
  preview?: boolean;
};

const assetStore: TLAssetStore = {
  async upload(_asset, file) {
    const src = URL.createObjectURL(file);
    return { src };
  },
  resolve(asset) {
    return asset.props.src;
  },
};

function TldrawClassroomConnected({
  uri,
  readonly,
}: {
  uri: string;
  readonly: boolean;
}) {
  const store = useSync({
    uri,
    assets: assetStore,
  });

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "#0a0a0a" }}>
      <Tldraw
        store={store}
        onMount={(editor) => {
          if (readonly) {
            editor.updateInstanceState({ isReadonly: true });
          }
          editor.user.updateUserPreferences({ colorScheme: "dark" });
        }}
      />
    </div>
  );
}

export default function TldrawClassroomWeb({ liveClassId, readonly = false, preview = false }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [uriError, setUriError] = useState<string | null>(null);

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
      <TldrawClassroomConnected uri={uri} readonly={!!readonly} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 200, backgroundColor: "#0a0a0a" },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: Colors.light.textMuted },
  errorText: { fontSize: 14, color: Colors.light.error, textAlign: "center", padding: 16 },
});
