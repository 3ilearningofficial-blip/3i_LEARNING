import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { liveClassQueryKey } from "@/lib/query-keys";
import { normalizeStreamType, type StreamType, type ChatMode } from "@/lib/live-stream/types";
import { getAdminChooseStreamRoute, getAdminLiveSessionRoute } from "@/lib/live-stream/liveRoutes";
import { validateSetupBeforeGoLive } from "@/lib/live-stream/setup-config";
import { useWebRTCStream } from "@/lib/useWebRTCStream";
import { useClassroomConfig } from "@/lib/classroom/useClassroomToken";
import SharedLiveSettings from "@/components/live-setup/SharedLiveSettings";
import ClassroomSetupPreview from "@/components/live-setup/ClassroomSetupPreview";
import CloudflareSetupPreview, { type CfStreamInfo } from "@/components/live-setup/CloudflareSetupPreview";
import RtmpSetupPreview from "@/components/live-setup/RtmpSetupPreview";
import WebrtcSetupPreview from "@/components/live-setup/WebrtcSetupPreview";
import Colors from "@/constants/colors";

export default function LiveSetupPage() {
  const { id, type: typeParam } = useLocalSearchParams<{ id: string; type?: string }>();
  const liveClassId = String(id || "");
  const streamType = normalizeStreamType(typeParam) || "cloudflare";

  const [chatMode, setChatMode] = useState<ChatMode>("public");
  const [showViewerCount, setShowViewerCount] = useState(true);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cfStreamInfo, setCfStreamInfo] = useState<CfStreamInfo | null>(null);
  const [cfReady, setCfReady] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isGoingLive, setIsGoingLive] = useState(false);

  const webrtc = useWebRTCStream();
  const { data: classroomConfig } = useClassroomConfig(liveClassId);

  const { data: liveClass, isLoading } = useQuery({
    queryKey: liveClassQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}`);
      if (!res.ok) throw new Error("Failed to load live class");
      const payload = await res.json();
      return payload?.data ?? payload;
    },
    enabled: !!liveClassId,
  });

  useEffect(() => {
    if (!liveClass) return;
    if (liveClass.chat_mode) setChatMode(liveClass.chat_mode);
    if (liveClass.show_viewer_count !== undefined) setShowViewerCount(liveClass.show_viewer_count);
    if (liveClass.youtube_url) setYoutubeUrl(liveClass.youtube_url);
    if (liveClass.cf_stream_uid) {
      setCfStreamInfo({
        uid: liveClass.cf_stream_uid,
        rtmpUrl: liveClass.cf_stream_rtmp_url || "",
        streamKey: liveClass.cf_stream_key || "",
        playbackHls: liveClass.cf_playback_hls || "",
      });
      setCfReady(true);
    }
  }, [liveClass]);

  const renderPreview = () => {
    switch (streamType) {
      case "classroom":
        return <ClassroomSetupPreview livekitConfigured={!!classroomConfig?.livekitConfigured} />;
      case "cloudflare":
        return (
          <CloudflareSetupPreview
            liveClassId={liveClassId}
            initialCf={cfStreamInfo}
            youtubeUrl={youtubeUrl}
            onYoutubeUrlChange={setYoutubeUrl}
            onCfReadyChange={setCfReady}
          />
        );
      case "rtmp":
        return <RtmpSetupPreview youtubeUrl={youtubeUrl} onYoutubeUrlChange={setYoutubeUrl} />;
      case "webrtc":
        return <WebrtcSetupPreview />;
      default:
        return null;
    }
  };

  const handleGoLive = useCallback(async () => {
    setValidationError(null);
    const check = validateSetupBeforeGoLive(streamType, {
      youtubeUrl: youtubeUrl || liveClass?.youtube_url,
      cfStreamReady: cfReady,
      livekitConfigured: classroomConfig?.livekitConfigured,
    });
    if (!check.ok) {
      setValidationError(check.message);
      return;
    }

    setIsGoingLive(true);
    try {
      const body: Record<string, unknown> = {
        isLive: true,
        streamType,
        chatMode,
        showViewerCount,
      };
      if (streamType === "rtmp") {
        body.youtubeUrl = (youtubeUrl || liveClass?.youtube_url || "").trim();
      } else if (streamType === "cloudflare" && youtubeUrl.trim()) {
        body.youtubeUrl = youtubeUrl.trim();
      }

      await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, body);

      if (streamType === "webrtc") {
        webrtc.cleanup();
      }

      router.replace(getAdminLiveSessionRoute({ id: liveClassId, stream_type: streamType }) as any);
    } catch (err: any) {
      setValidationError(err?.message || "Failed to go live");
      setIsGoingLive(false);
    }
  }, [
    streamType,
    youtubeUrl,
    liveClass,
    cfReady,
    classroomConfig,
    chatMode,
    showViewerCount,
    liveClassId,
    webrtc,
  ]);

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2A4A"]} style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => router.replace(getAdminChooseStreamRoute(liveClassId) as any)}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {liveClass?.title || "Preview"}
          </Text>
          <Text style={styles.headerSub}>Check everything before going live</Text>
        </View>
        <View style={styles.setupBadge}>
          <Text style={styles.setupBadgeText}>SETUP</Text>
        </View>
      </LinearGradient>

      <View style={styles.main}>
        <View style={styles.previewArea}>{renderPreview()}</View>

        <View style={styles.sidePanel}>
          <ScrollView style={styles.sideScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.streamLabel}>Stream: {streamType}</Text>
            <SharedLiveSettings
              chatMode={chatMode}
              onChatModeChange={setChatMode}
              showViewerCount={showViewerCount}
              onShowViewerCountChange={setShowViewerCount}
            />
            {validationError ? <Text style={styles.validationError}>{validationError}</Text> : null}
          </ScrollView>

          <Pressable
            style={[styles.goLiveButton, isGoingLive && styles.goLiveDisabled]}
            onPress={handleGoLive}
            disabled={isGoingLive}
          >
            {isGoingLive ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="radio" size={20} color="#fff" />
                <Text style={styles.goLiveText}>Go Live</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "web" ? 12 : 44,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: "700", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.7)", marginTop: 2 },
  setupBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  setupBadgeText: { fontSize: 10, fontWeight: "800", color: "#fff", letterSpacing: 1 },
  main: { flex: 1, flexDirection: "row" },
  previewArea: {
    flex: 3,
    margin: 12,
    marginRight: 0,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  sidePanel: {
    flex: 1,
    margin: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  sideScroll: { flex: 1 },
  streamLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.textMuted,
    marginBottom: 12,
    textTransform: "capitalize",
  },
  validationError: { fontSize: 13, color: Colors.light.error, marginBottom: 8, lineHeight: 18 },
  goLiveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#DC2626",
    borderRadius: 10,
    paddingVertical: 14,
    marginTop: 8,
  },
  goLiveDisabled: { opacity: 0.7 },
  goLiveText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
