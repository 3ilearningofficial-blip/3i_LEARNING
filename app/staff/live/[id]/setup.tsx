import React, { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView, Platform, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

/** Web-only: create CF stream via staff API and show RTMP details. */
export default function StaffLiveSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState<any>(null);
  const [error, setError] = useState("");

  if (Platform.OS !== "web") {
    return (
      <View style={styles.centered}>
        <Text style={styles.msg}>Start live classes from the web Teacher Portal.</Text>
        <Pressable onPress={() => router.back()}><Text style={styles.link}>Go back</Text></Pressable>
      </View>
    );
  }

  const startStream = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiRequest("POST", `/api/staff/live-classes/${id}/stream/create`, {});
      const data = await res.json();
      setStream(data);
    } catch (e: any) {
      setError(e?.message || "Failed to start stream");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={() => router.back()}><Text style={styles.link}>← Back</Text></Pressable>
      <Text style={styles.title}>Live Class Setup</Text>
      {!stream ? (
        <Pressable style={styles.btn} onPress={startStream} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Stream & Go Live</Text>}
        </Pressable>
      ) : (
        <View style={styles.box}>
          <Text style={styles.label}>RTMP URL</Text>
          <Text selectable>{stream.rtmpUrl}</Text>
          <Text style={styles.label}>Stream Key</Text>
          <Text selectable>{stream.streamKey}</Text>
          <Text style={styles.label}>Playback HLS</Text>
          <Text selectable>{stream.playbackHls}</Text>
        </View>
      )}
      {!!error && <Text style={styles.err}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  msg: { textAlign: "center", color: Colors.light.textMuted, marginBottom: 16 },
  container: { padding: 24, maxWidth: 720, alignSelf: "center", width: "100%" },
  title: { fontSize: 22, fontFamily: "Inter_800ExtraBold", marginVertical: 16 },
  btn: { backgroundColor: Colors.light.primary, padding: 14, borderRadius: 10, alignItems: "center" },
  btnText: { color: "#fff", fontFamily: "Inter_700Bold" },
  box: { backgroundColor: "rgba(0,0,0,0.04)", padding: 16, borderRadius: 10, gap: 8 },
  label: { fontFamily: "Inter_700Bold", marginTop: 8 },
  link: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold" },
  err: { color: "#dc2626", marginTop: 12 },
});
