import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  Alert,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useWebRTCStream } from "@/lib/useWebRTCStream";
import { useMediaRecorder } from "@/lib/useMediaRecorder";
import { getYouTubeVideoId } from "@/lib/youtube-utils";
import { uploadToR2 } from "@/lib/r2-upload";
import LiveChatPanel from "@/components/LiveChatPanel";
import LiveStudentsPanel from "@/components/LiveStudentsPanel";
import Colors from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";

type StreamType = "webrtc" | "rtmp" | "cloudflare";

type SideTab = "chat" | "students";

function buildYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&cc_load_policy=0&fs=1&disablekb=0&controls=1`;
}

function buildHlsPlayerHtml(hlsUrl: string): string {
  // Also try the live manifest variant
  const liveHlsUrl = hlsUrl.includes('/manifest/video.m3u8')
    ? hlsUrl.replace('/manifest/video.m3u8', '/manifest/video.m3u8')
    : hlsUrl;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
video { width: 100%; height: 100%; object-fit: contain; background: #000; }
#overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0a0a0a; color: #fff; font-family: sans-serif; gap: 16px; }
#overlay.hidden { display: none; }
.spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #F6821F; border-radius: 50%; animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.msg { font-size: 14px; color: #aaa; text-align: center; line-height: 1.6; }
.live-badge { background: #ef4444; color: #fff; font-size: 12px; font-weight: 700; padding: 4px 12px; border-radius: 4px; letter-spacing: 1px; display: none; position: absolute; top: 12px; left: 12px; }
.live-badge.show { display: block; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #fff; margin-right: 6px; animation: blink 1s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.3} }
</style>
</head>
<body>
<video id="v" autoplay controls playsinline></video>
<div id="overlay">
  <div class="spinner"></div>
  <div class="msg" id="msg">OBS is streaming...<br><small style="color:#666">Waiting for Cloudflare to process stream<br>(takes 15–30 seconds)</small></div>
</div>
<div class="live-badge" id="liveBadge"><span class="dot"></span>LIVE</div>
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js"></script>
<script>
var video = document.getElementById('v');
var overlay = document.getElementById('overlay');
var msg = document.getElementById('msg');
var liveBadge = document.getElementById('liveBadge');
var hlsUrl = '${liveHlsUrl}';
var hlsInstance = null;
var retryCount = 0;
var maxRetries = 60; // 5 minutes max

function showLive() {
  overlay.classList.add('hidden');
  liveBadge.classList.add('show');
}

function tryLoad() {
  if (retryCount >= maxRetries) {
    msg.innerHTML = 'Stream not detected after 5 minutes.<br><small style="color:#666">Check OBS is streaming to the correct RTMP URL</small>';
    return;
  }
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  
  if (Hls.isSupported()) {
    var hls = new Hls({
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 6,
      manifestLoadingMaxRetry: 2,
      manifestLoadingRetryDelay: 1000,
      levelLoadingMaxRetry: 2,
    });
    hlsInstance = hls;
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      video.play().then(showLive).catch(function() {
        video.muted = true; video.play().then(showLive);
      });
    });
    hls.on(Hls.Events.ERROR, function(e, d) {
      if (d.fatal) {
        retryCount++;
        var secs = retryCount * 5;
        msg.innerHTML = 'OBS is streaming...<br><small style="color:#666">Waiting for Cloudflare (' + secs + 's elapsed)<br>This takes 15–30 seconds</small>';
        setTimeout(tryLoad, 5000);
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = hlsUrl;
    video.addEventListener('loadedmetadata', showLive);
    video.play().catch(function() { setTimeout(tryLoad, 5000); });
  } else {
    msg.textContent = 'HLS not supported. Use Chrome or Safari.';
  }
}

tryLoad();
</script>
</body>
</html>`;
}

function buildYouTubeHtml(videoId: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000; overflow: hidden; -webkit-user-select: none; user-select: none; }
.wrapper { position: relative; width: 100%; height: 100%; overflow: hidden; }
iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: none; }
.cover-tl { position: absolute; top: 0; left: 0; width: 25%; height: 56px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-tr { position: absolute; top: 0; right: 0; width: 130px; height: 56px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-bl { position: absolute; bottom: 0; left: 0; width: 70px; height: 60px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-fs { position: absolute; bottom: 78px; right: 0; width: 90px; height: 50px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
.cover-br { position: absolute; bottom: 0; right: 50px; width: 280px; height: 60px; background: #000; z-index: 9999; pointer-events: auto; cursor: default; }
@media (max-width: 600px) { .cover-tl { width: 55%; } .cover-tr { display: none; } .cover-fs { display: none; } .cover-br { width: 100%; right: 0; } }
</style>
</head>
<body>
<div class="wrapper">
<div class="cover-tl"></div>
<div class="cover-tr"></div>
<iframe src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=0&playsinline=1&rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&cc_load_policy=0&fs=1&disablekb=0&controls=1" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen></iframe>
<div class="cover-bl"></div>
<div class="cover-fs"></div>
<div class="cover-br"></div>
</div>
<script>document.addEventListener('contextmenu', function(e) { e.preventDefault(); });</script>
</body>
</html>`;
}

export default function BroadcastPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const params = useLocalSearchParams<{ id: string; streamType: string }>();
  const liveClassId = id;
  const { user } = useAuth();

  // Fetch live class data — poll every 5s so cfPlaybackHls updates when stream goes live
  const { data: liveClass, isLoading } = useQuery<any>({
    queryKey: ["/api/live-classes", liveClassId],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(`${baseUrl}/api/live-classes/${liveClassId}`);
      if (!res.ok) throw new Error("Failed to fetch live class");
      return res.json();
    },
    enabled: !!liveClassId,
    refetchInterval: 5000, // Poll every 5s to pick up cfPlaybackHls once OBS connects
    staleTime: 0,
  });

  const streamType = liveClass?.stream_type || params.streamType || "webrtc";
  const chatMode = liveClass?.chat_mode || "public";
  const showViewerCount = liveClass?.show_viewer_count ?? true;
  const youtubeUrl = liveClass?.youtube_url || "";
  const cfPlaybackHls = liveClass?.cf_playback_hls || "";

  // Side panel tab
  const [activeTab, setActiveTab] = useState<SideTab>("chat");
  const [isEnding, setIsEnding] = useState(false);

  // Upload state for End Class flow
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const retainedBlobRef = useRef<Blob | null>(null);

  // WebRTC
  const webrtc = useWebRTCStream();
  const recorder = useMediaRecorder();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Attach camera stream to video element
  useEffect(() => {
    if (Platform.OS === "web" && videoRef.current && webrtc.stream && streamType === "webrtc") {
      videoRef.current.srcObject = webrtc.stream;
    }
  }, [webrtc.stream, streamType]);

  // Attach screen share stream to video element
  useEffect(() => {
    if (Platform.OS === "web" && screenVideoRef.current && webrtc.screenStream) {
      screenVideoRef.current.srcObject = webrtc.screenStream;
    }
  }, [webrtc.screenStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamType === "webrtc") {
        webrtc.cleanup();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-record when screen share starts (Task 7.2)
  useEffect(() => {
    if (webrtc.isScreenSharing && webrtc.screenStream && !recorder.isRecording) {
      recorder.startRecording(webrtc.screenStream);
    }
    if (!webrtc.isScreenSharing && recorder.isRecording) {
      recorder.stopRecording().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webrtc.isScreenSharing, webrtc.screenStream]);

  const handleScreenShare = useCallback(async () => {
    if (webrtc.isScreenSharing) {
      webrtc.stopScreenShare();
    } else {
      try {
        await webrtc.startScreenShare();
      } catch {
        // User cancelled — ignore
      }
    }
  }, [webrtc]);

  const uploadRecordingAndFinish = useCallback(async (blob: Blob) => {
    setUploadStatus("Uploading recording...");
    setUploadProgress(0);
    setUploadError(null);

    try {
      const filename = `recording-${Date.now()}.webm`;
      const fileUri = URL.createObjectURL(blob);

      const { publicUrl } = await uploadToR2(
        fileUri,
        filename,
        "video/webm",
        "lectures",
        (pct) => setUploadProgress(pct),
      );

      URL.revokeObjectURL(fileUri);

      setUploadStatus("Saving lecture...");

      await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/recording`, {
        recordingUrl: publicUrl,
        sectionTitle: "Live Class Recordings",
      });

      retainedBlobRef.current = null;
      webrtc.cleanup();
      router.replace("/admin" as any);
    } catch (err: any) {
      // Keep blob in memory for retry, do NOT mark completed
      retainedBlobRef.current = blob;
      setUploadError(err?.message || "Upload failed. You can retry.");
      setUploadStatus(null);
      setIsEnding(false);
    }
  }, [liveClassId, webrtc]);

  const handleRetryUpload = useCallback(() => {
    const blob = retainedBlobRef.current;
    if (!blob) return;
    setIsEnding(true);
    uploadRecordingAndFinish(blob);
  }, [uploadRecordingAndFinish]);

  const handleEndClass = useCallback(async () => {
    // Use window.confirm on web (Alert.alert buttons don't work on web)
    const confirmed = Platform.OS === "web"
      ? window.confirm("End this live class?")
      : await new Promise<boolean>(resolve =>
          Alert.alert("End Class", "Are you sure you want to end this live class?", [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "End Class", style: "destructive", onPress: () => resolve(true) },
          ])
        );
    if (!confirmed) return;

    setIsEnding(true);
    setUploadError(null);
    try {
      if (streamType === "webrtc") {
        if (recorder.isRecording) {
          const blob = await recorder.stopRecording();
          retainedBlobRef.current = blob;
          await uploadRecordingAndFinish(blob);
        } else {
          await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, { isLive: false, isCompleted: true });
          webrtc.cleanup();
          router.replace("/admin" as any);
        }
      } else if (streamType === "cloudflare") {
        await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/stream/end`, {});
        if (cfPlaybackHls) {
          await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/recording`, {
            recordingUrl: cfPlaybackHls,
            sectionTitle: "Live Class Recordings",
          });
        } else {
          await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, { isLive: false, isCompleted: true });
        }
        router.replace("/admin" as any);
      } else {
        await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/recording`, {
          recordingUrl: youtubeUrl,
          sectionTitle: "Live Class Recordings",
        });
        router.replace("/admin" as any);
      }
    } catch (err: any) {
      if (Platform.OS === "web") window.alert(err?.message || "Failed to end class. Please try again.");
      else Alert.alert("Error", err?.message || "Failed to end class. Please try again.");
      setIsEnding(false);
    }
  }, [liveClassId, streamType, webrtc, recorder, youtubeUrl, cfPlaybackHls, uploadRecordingAndFinish]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Loading broadcast...</Text>
      </View>
    );
  }

  const youtubeVideoId = getYouTubeVideoId(youtubeUrl);

  return (
    <View style={styles.container}>
      {/* Main: 3/4 stream + 1/4 side panel */}
      <View style={styles.main}>
        {/* LEFT: Stream Area (3/4) */}
        <View style={styles.streamArea}>
          {streamType === "webrtc" ? (
            <>
              {/* WebRTC video feed */}
              {Platform.OS === "web" ? (
                webrtc.isScreenSharing && webrtc.screenStream ? (
                  <video
                    ref={screenVideoRef as any}
                    autoPlay
                    playsInline
                    style={videoStyle}
                  />
                ) : (
                  <video
                    ref={videoRef as any}
                    autoPlay
                    muted
                    playsInline
                    style={{ ...videoStyle, transform: "scaleX(-1)" }}
                  />
                )
              ) : (
                <View style={styles.noWebrtc}>
                  <Ionicons name="videocam-off-outline" size={48} color="#666" />
                  <Text style={styles.noWebrtcText}>
                    WebRTC is only available on web
                  </Text>
                </View>
              )}

              {/* REC indicator */}
              {recorder.isRecording && (
                <View style={styles.recIndicator}>
                  <View style={styles.recDot} />
                  <Text style={styles.recText}>REC</Text>
                </View>
              )}

              {/* Stream controls: cam, mic, screen share */}
              <View style={styles.streamControls}>
                <Pressable
                  style={[
                    styles.controlButton,
                    !webrtc.isVideoEnabled && styles.controlButtonOff,
                  ]}
                  onPress={webrtc.toggleVideo}
                >
                  <Ionicons
                    name={webrtc.isVideoEnabled ? "videocam" : "videocam-off"}
                    size={20}
                    color="#fff"
                  />
                </Pressable>

                <Pressable
                  style={[
                    styles.controlButton,
                    !webrtc.isAudioEnabled && styles.controlButtonOff,
                  ]}
                  onPress={webrtc.toggleAudio}
                >
                  <Ionicons
                    name={webrtc.isAudioEnabled ? "mic" : "mic-off"}
                    size={20}
                    color="#fff"
                  />
                </Pressable>

                <Pressable
                  style={[
                    styles.controlButton,
                    webrtc.isScreenSharing && styles.controlButtonActive,
                  ]}
                  onPress={handleScreenShare}
                >
                  <Ionicons
                    name={webrtc.isScreenSharing ? "stop-circle" : "desktop-outline"}
                    size={20}
                    color="#fff"
                  />
                </Pressable>
              </View>
            </>
          ) : streamType === "cloudflare" ? (
            /* Cloudflare Stream: HLS player */
            cfPlaybackHls ? (
              Platform.OS === "web" ? (
                <iframe
                  srcDoc={buildHlsPlayerHtml(cfPlaybackHls)}
                  style={{
                    position: "absolute" as any,
                    top: 0, left: 0, width: "100%", height: "100%", border: "none",
                  }}
                  allow="autoplay; fullscreen"
                  allowFullScreen
                />
              ) : (
                <View style={styles.noWebrtc}>
                  <Ionicons name="cloud-outline" size={64} color="#F6821F" />
                  <Text style={styles.noWebrtcText}>HLS playback available on web only</Text>
                </View>
              )
            ) : (
              <View style={styles.noWebrtc}>
                <Ionicons name="cloud-outline" size={48} color="#F6821F" />
                <Text style={styles.noWebrtcText}>Waiting for Cloudflare Stream...</Text>
              </View>
            )
          ) : (
            /* RTMP: YouTube embed */
            youtubeVideoId ? (
              Platform.OS === "web" ? (
                <iframe
                  srcDoc={buildYouTubeHtml(youtubeVideoId)}
                  style={{
                    position: "absolute" as any,
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: "none",
                  }}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                />
              ) : (
                <View style={styles.noWebrtc}>
                  <Ionicons name="logo-youtube" size={64} color="#FF0000" />
                  <Text style={styles.noWebrtcText}>
                    YouTube embed available on web only
                  </Text>
                </View>
              )
            ) : (
              <View style={styles.noWebrtc}>
                <Ionicons name="alert-circle-outline" size={48} color="#666" />
                <Text style={styles.noWebrtcText}>No YouTube URL configured</Text>
              </View>
            )
          )}
        </View>

        {/* RIGHT: Side Panel (1/4) */}
        <View style={styles.sidePanel}>
          {/* Tab switcher */}
          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tab, activeTab === "chat" && styles.tabActive]}
              onPress={() => setActiveTab("chat")}
            >
              <Ionicons
                name="chatbubbles-outline"
                size={16}
                color={activeTab === "chat" ? Colors.light.primary : Colors.light.textMuted}
              />
              <Text
                style={[styles.tabText, activeTab === "chat" && styles.tabTextActive]}
              >
                Chat
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, activeTab === "students" && styles.tabActive]}
              onPress={() => setActiveTab("students")}
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={activeTab === "students" ? Colors.light.primary : Colors.light.textMuted}
              />
              <Text
                style={[styles.tabText, activeTab === "students" && styles.tabTextActive]}
              >
                Students
              </Text>
            </Pressable>
          </View>

          {/* Tab content */}
          <View style={styles.tabContent}>
            {activeTab === "chat" ? (
              <LiveChatPanel
                liveClassId={liveClassId!}
                chatMode={chatMode}
                isAdmin={true}
              />
            ) : (
              <LiveStudentsPanel
                liveClassId={liveClassId!}
                showViewerCount={showViewerCount}
              />
            )}
          </View>

          {/* End Class button / Upload progress */}
          <View style={styles.endClassContainer}>
            {uploadError && (
              <View style={styles.uploadErrorContainer}>
                <Text style={styles.uploadErrorText}>{uploadError}</Text>
                <Pressable style={styles.retryButton} onPress={handleRetryUpload}>
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.retryButtonText}>Retry Upload</Text>
                </Pressable>
              </View>
            )}

            {uploadStatus && (
              <View style={styles.uploadProgressContainer}>
                <Text style={styles.uploadStatusText}>{uploadStatus}</Text>
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
                </View>
                <Text style={styles.uploadPercentText}>{uploadProgress}%</Text>
              </View>
            )}

            <Pressable
              style={[styles.endClassButton, (isEnding || !!uploadStatus) && styles.endClassButtonDisabled]}
              onPress={handleEndClass}
              disabled={isEnding || !!uploadStatus}
            >
              {isEnding && !uploadStatus && !uploadError ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="stop-circle" size={18} color="#fff" />
                  <Text style={styles.endClassText}>End Class</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

const videoStyle: any = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  backgroundColor: "#000",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#999",
  },
  main: {
    flex: 1,
    flexDirection: "row",
  },

  // Stream area (3/4)
  streamArea: {
    flex: 3,
    backgroundColor: "#000",
    position: "relative",
  },
  noWebrtc: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  noWebrtcText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    paddingHorizontal: 24,
  },

  // REC indicator
  recIndicator: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#EF4444",
  },
  recText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#EF4444",
    letterSpacing: 1,
  },

  // Stream controls
  streamControls: {
    position: "absolute",
    bottom: 20,
    left: 20,
    flexDirection: "row",
    gap: 10,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  controlButtonOff: {
    backgroundColor: "rgba(239,68,68,0.7)",
  },
  controlButtonActive: {
    backgroundColor: "rgba(26,86,219,0.7)",
  },

  // Side panel (1/4)
  sidePanel: {
    flex: 1,
    backgroundColor: "#fff",
  },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: {
    borderBottomColor: Colors.light.primary,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.light.textMuted,
  },
  tabTextActive: {
    color: Colors.light.primary,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },

  // End Class
  endClassContainer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.light.border,
  },
  endClassButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.light.error,
    paddingVertical: 12,
    borderRadius: 10,
  },
  endClassButtonDisabled: {
    opacity: 0.6,
  },
  endClassText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },

  // Upload progress
  uploadProgressContainer: {
    marginBottom: 10,
    gap: 4,
  },
  uploadStatusText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.text,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: Colors.light.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressBarFill: {
    height: 6,
    backgroundColor: Colors.light.primary,
    borderRadius: 3,
  },
  uploadPercentText: {
    fontSize: 11,
    color: Colors.light.textMuted,
    textAlign: "right",
  },

  // Upload error / retry
  uploadErrorContainer: {
    marginBottom: 10,
    padding: 10,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    gap: 8,
  },
  uploadErrorText: {
    fontSize: 12,
    color: Colors.light.error,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.light.primary,
    paddingVertical: 8,
    borderRadius: 6,
  },
  retryButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
});
