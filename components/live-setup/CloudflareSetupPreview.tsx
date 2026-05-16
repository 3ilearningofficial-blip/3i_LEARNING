import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

export type CfStreamInfo = {
  uid: string;
  rtmpUrl: string;
  streamKey: string;
  playbackHls: string;
};

type Props = {
  liveClassId: string;
  initialCf?: CfStreamInfo | null;
  youtubeUrl: string;
  onYoutubeUrlChange: (v: string) => void;
  onCfReadyChange: (ready: boolean) => void;
};

export default function CloudflareSetupPreview({
  liveClassId,
  initialCf,
  youtubeUrl,
  onYoutubeUrlChange,
  onCfReadyChange,
}: Props) {
  const [cfStreamInfo, setCfStreamInfo] = useState<CfStreamInfo | null>(initialCf || null);
  const [loading, setLoading] = useState(false);

  const handleCreate = useCallback(async () => {
    if (cfStreamInfo) return;
    setLoading(true);
    try {
      const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/stream/create`, {});
      const data = await res.json();
      const info: CfStreamInfo = {
        uid: data.uid,
        rtmpUrl: data.rtmpUrl,
        streamKey: data.streamKey,
        playbackHls: data.playbackHls,
      };
      setCfStreamInfo(info);
      onCfReadyChange(true);
    } catch {
      onCfReadyChange(false);
    } finally {
      setLoading(false);
    }
  }, [liveClassId, cfStreamInfo, onCfReadyChange]);

  useEffect(() => {
    onCfReadyChange(!!cfStreamInfo);
  }, [cfStreamInfo, onCfReadyChange]);

  useEffect(() => {
    if (!cfStreamInfo && liveClassId) void handleCreate();
  }, [liveClassId]);

  return (
    <View style={styles.wrap}>
      <View style={styles.inner}>
        <Ionicons name="cloud-outline" size={48} color="#F6821F" />
        {loading ? (
          <ActivityIndicator size="small" color="#F6821F" style={{ marginTop: 12 }} />
        ) : cfStreamInfo ? (
          <>
            <Text style={styles.title}>RTMP credentials ready</Text>
            <Text style={styles.label}>RTMP URL</Text>
            <Text style={styles.credential} selectable>{cfStreamInfo.rtmpUrl}</Text>
            <Text style={styles.label}>Stream key</Text>
            <Text style={styles.credential} selectable>{cfStreamInfo.streamKey}</Text>
            <Text style={styles.hint}>Start OBS with these credentials, then tap Go Live.</Text>
          </>
        ) : (
          <Pressable style={styles.retry} onPress={handleCreate}>
            <Ionicons name="refresh" size={16} color={Colors.light.primary} />
            <Text style={styles.retryText}>Create Cloudflare stream</Text>
          </Pressable>
        )}
        <Text style={[styles.label, { marginTop: 16 }]}>Optional YouTube mirror URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://www.youtube.com/live/..."
          placeholderTextColor={Colors.light.textMuted}
          value={youtubeUrl}
          onChangeText={onYoutubeUrlChange}
          autoCapitalize="none"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#0D1B2A" },
  inner: { flex: 1, padding: 20, alignItems: "stretch", justifyContent: "center", gap: 6 },
  title: { fontSize: 16, fontWeight: "700", color: "#fff", marginTop: 8, textAlign: "center" },
  label: { fontSize: 11, fontWeight: "700", color: Colors.light.textMuted, textTransform: "uppercase", marginTop: 8 },
  credential: { fontSize: 12, color: "#E5E7EB", fontFamily: "monospace", backgroundColor: "#1F2937", padding: 8, borderRadius: 6 },
  hint: { fontSize: 12, color: Colors.light.textMuted, marginTop: 8, lineHeight: 17 },
  retry: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  retryText: { fontSize: 14, fontWeight: "600", color: Colors.light.primary },
  input: {
    backgroundColor: "#1F2937",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#fff",
    marginTop: 4,
  },
});
