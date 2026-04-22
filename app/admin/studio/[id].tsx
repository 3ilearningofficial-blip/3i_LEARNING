import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  Platform,
  ScrollView,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { useWebRTCStream } from "@/lib/useWebRTCStream";
import { getYouTubeVideoId } from "@/lib/youtube-utils";
import Colors from "@/constants/colors";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";

type StreamType = "webrtc" | "rtmp" | "cloudflare";
type ChatMode = "public" | "private";

export default function StudioSetupPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const liveClassId = id;

  // Fetch live class data — poll every 5s to detect when stream goes live
  const { data: liveClass, isLoading: isLoadingClass } = useQuery<any>({
    queryKey: ["/api/live-classes", liveClassId],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(`${baseUrl}/api/live-classes/${liveClassId}`);
      if (!res.ok) throw new Error("Failed to fetch live class");
      return res.json();
    },
    enabled: !!liveClassId,
    refetchInterval: 5000,
    staleTime: 0,
  });

  // State — restore from localStorage on refresh
  const storageKey = `studio_state_${liveClassId}`;
  const getSavedState = () => {
    try {
      if (Platform.OS === "web" && typeof localStorage !== "undefined") {
        const saved = localStorage.getItem(storageKey);
        return saved ? JSON.parse(saved) : null;
      }
    } catch { return null; }
    return null;
  };
  const savedState = getSavedState();

  const [streamType, setStreamTypeState] = useState<StreamType>(savedState?.streamType || "webrtc");
  const [youtubeUrl, setYoutubeUrlState] = useState(savedState?.youtubeUrl || "");
  const [cfStreamInfo, setCfStreamInfo] = useState<{
    uid: string; rtmpUrl: string; streamKey: string; playbackHls: string;
  } | null>(null);
  const [cfStreamLoading, setCfStreamLoading] = useState(false);
  const [showViewerCount, setShowViewerCountState] = useState(savedState?.showViewerCount ?? true);
  const [chatMode, setChatModeState] = useState<ChatMode>(savedState?.chatMode || "public");
  const [isGoingLive, setIsGoingLive] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Persist state to localStorage on every change
  const persistState = useCallback((updates: Record<string, any>) => {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      try {
        const current = getSavedState() || {};
        localStorage.setItem(storageKey, JSON.stringify({ ...current, ...updates }));
      } catch {}
    }
  }, [storageKey]);

  const setStreamType = (v: StreamType) => { setStreamTypeState(v); persistState({ streamType: v }); };
  const setYoutubeUrl = (v: string) => { setYoutubeUrlState(v); persistState({ youtubeUrl: v }); };
  const setShowViewerCount = (v: boolean) => { setShowViewerCountState(v); persistState({ showViewerCount: v }); };
  const setChatMode = (v: ChatMode) => { setChatModeState(v); persistState({ chatMode: v }); };

  // WebRTC hook
  const webrtc = useWebRTCStream();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Sync fetched data into local state
  useEffect(() => {
    if (liveClass) {
      if (liveClass.stream_type) setStreamType(liveClass.stream_type);
      if (liveClass.youtube_url) setYoutubeUrl(liveClass.youtube_url);
      if (liveClass.show_viewer_count !== undefined)
        setShowViewerCount(liveClass.show_viewer_count);
      if (liveClass.chat_mode) setChatMode(liveClass.chat_mode);
      // Restore CF stream info if already created
      if (liveClass.cf_stream_uid) {
        setCfStreamInfo({
          uid: liveClass.cf_stream_uid,
          rtmpUrl: liveClass.cf_stream_rtmp_url || "",
          streamKey: liveClass.cf_stream_key || "",
          playbackHls: liveClass.cf_playback_hls || "",
        });
      }
    }
  }, [liveClass]);

  // Attach WebRTC stream to video element
  useEffect(() => {
    if (
      Platform.OS === "web" &&
      videoRef.current &&
      webrtc.stream &&
      streamType === "webrtc"
    ) {
      videoRef.current.srcObject = webrtc.stream;
    }
  }, [webrtc.stream, streamType]);

  // Cleanup WebRTC on unmount
  useEffect(() => {
    return () => {
      webrtc.cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Create Cloudflare Stream live input when switching to cloudflare mode
  const handleCreateCfStream = useCallback(async () => {
    if (cfStreamInfo) return; // already created
    setCfStreamLoading(true);
    setValidationError(null);
    try {
      const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/stream/create`, {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to create stream");
      setCfStreamInfo(data);
    } catch (err: any) {
      setValidationError(err?.message || "Failed to create Cloudflare Stream live input");
    } finally {
      setCfStreamLoading(false);
    }
  }, [cfStreamInfo, liveClassId]);

  // Auto-create CF stream when switching to cloudflare mode
  useEffect(() => {
    if (streamType === "cloudflare" && !cfStreamInfo && liveClassId) {
      handleCreateCfStream();
    }
  }, [streamType, cfStreamInfo, liveClassId, handleCreateCfStream]);

  const handleGoLive = useCallback(async () => {
    setValidationError(null);

    if (streamType === "rtmp") {
      const videoId = getYouTubeVideoId(youtubeUrl);
      if (!videoId) {
        setValidationError(
          "Please enter a valid YouTube URL (e.g. https://youtube.com/live/...)"
        );
        return;
      }
    }

    if (streamType === "cloudflare" && !cfStreamInfo) {
      setValidationError("Cloudflare Stream is not ready yet. Please wait.");
      return;
    }

    setIsGoingLive(true);
    try {
      const body: any = {
        isLive: true,
        streamType: streamType,
        chatMode: chatMode,
        showViewerCount: showViewerCount,
      };
      if (streamType === "rtmp") {
        body.youtubeUrl = youtubeUrl.trim();
      }

      await apiRequest("PUT", `/api/admin/live-classes/${liveClassId}`, body);

      // Stop the preview stream before navigating (broadcast page will start its own)
      if (streamType === "webrtc") {
        webrtc.cleanup();
      }

      router.replace(
        `/admin/broadcast/${liveClassId}?streamType=${streamType}` as any
      );
    } catch (err: any) {
      setValidationError(err?.message || "Failed to go live. Please try again.");
      setIsGoingLive(false);
    }
  }, [streamType, youtubeUrl, chatMode, showViewerCount, liveClassId, webrtc]);

  if (isLoadingClass) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
        <Text style={styles.loadingText}>Loading studio...</Text>
      </View>
    );
  }

  const classTitle = liveClass?.title || "Live Class";

  return (
    <View style={styles.container}>
      {/* Header */}
      <LinearGradient
        colors={["#0A1628", "#162544"]}
        style={styles.header}
      >
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {classTitle}
        </Text>
        <View style={styles.headerBadge}>
          <Text style={styles.headerBadgeText}>STUDIO</Text>
        </View>
      </LinearGradient>

      {/* Main content: 3/4 preview + 1/4 control panel */}
      <View style={styles.main}>
        {/* Preview Area (3/4) */}
        <View style={styles.previewArea}>
          {streamType === "webrtc" ? (
            webrtc.error ? (
              <View style={styles.previewPlaceholder}>
                <Ionicons
                  name="warning-outline"
                  size={48}
                  color={Colors.light.error}
                />
                <Text style={styles.previewErrorText}>{webrtc.error}</Text>
              </View>
            ) : Platform.OS === "web" ? (
              <video
                ref={videoRef as any}
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  backgroundColor: "#000",
                  borderRadius: 12,
                  transform: "scaleX(-1)",
                }}
              />
            ) : (
              <View style={styles.previewPlaceholder}>
                <Ionicons
                  name="videocam-outline"
                  size={48}
                  color={Colors.light.textMuted}
                />
                <Text style={styles.previewPlaceholderText}>
                  WebRTC preview is only available on web
                </Text>
              </View>
            )
          ) : streamType === "cloudflare" ? (
            // Cloudflare Stream preview — show HLS player if stream is live, else show ready state
            <View style={styles.previewPlaceholder}>
              {cfStreamLoading ? (
                <>
                  <ActivityIndicator size="large" color="#F6821F" />
                  <Text style={styles.previewPlaceholderText}>Creating Cloudflare Stream...</Text>
                </>
              ) : cfStreamInfo?.playbackHls && Platform.OS === "web" ? (
                // Show HLS preview once OBS starts streaming
                <iframe
                  srcDoc={`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:contain;background:#000}#ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;font-family:sans-serif;gap:12px}#ov.h{display:none}.sp{width:36px;height:36px;border:3px solid #333;border-top-color:#F6821F;border-radius:50%;animation:spin 0.8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.msg{font-size:13px;color:#aaa;text-align:center}.lb{background:#ef4444;color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:4px;letter-spacing:1px;display:none;position:absolute;top:10px;left:10px}.lb.s{display:block}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#fff;margin-right:5px;animation:blink 1s infinite}@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}</style></head><body><video id="v" autoplay controls playsinline></video><div id="ov"><div class="sp"></div><div class="msg" id="msg">OBS streaming...<br><small style="color:#666">Waiting for Cloudflare (15-30s)</small></div></div><div class="lb" id="lb"><span class="dot"></span>LIVE</div><script src="https://cdn.jsdelivr.net/npm/hls.js@latest/dist/hls.min.js"></script><script>var v=document.getElementById('v'),ov=document.getElementById('ov'),msg=document.getElementById('msg'),lb=document.getElementById('lb'),url='${cfStreamInfo.playbackHls}',r=0;function show(){ov.classList.add('h');lb.classList.add('s');}function load(){if(r>60)return;if(Hls.isSupported()){var h=new Hls({liveSyncDurationCount:2,liveMaxLatencyDurationCount:6});h.loadSource(url);h.attachMedia(v);h.on(Hls.Events.MANIFEST_PARSED,function(){v.play().then(show).catch(function(){v.muted=true;v.play().then(show);});});h.on(Hls.Events.ERROR,function(e,d){if(d.fatal){r++;msg.innerHTML='OBS streaming...<br><small style="color:#666">Waiting ('+r*5+'s)</small>';setTimeout(load,5000);}});}else if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=url;v.addEventListener('loadedmetadata',show);v.play().catch(function(){setTimeout(load,5000);});}}load();</script></body></html>`}
                  style={{ position: "absolute" as any, top: 0, left: 0, width: "100%", height: "100%", border: "none" }}
                  allow="autoplay; fullscreen"
                />
              ) : cfStreamInfo ? (
                <>
                  <Text style={{ fontSize: 48 }}>☁️</Text>
                  <View style={styles.cfReadyBadge}>
                    <Text style={styles.cfReadyText}>✓ Stream Ready</Text>
                  </View>
                  <Text style={styles.previewPlaceholderText}>
                    Copy the RTMP URL and Stream Key from the panel →{"\n"}Paste into OBS and start streaming{"\n"}Preview will appear here automatically
                  </Text>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 48 }}>☁️</Text>
                  <Text style={styles.previewPlaceholderText}>
                    Select Cloudflare Stream to generate your RTMP credentials
                  </Text>
                </>
              )}
            </View>
          ) : (
            // RTMP / YouTube: show embed if URL entered, otherwise placeholder
            (() => {
              const videoId = getYouTubeVideoId(youtubeUrl);
              if (videoId && Platform.OS === "web") {
                return (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&playsinline=1&rel=0&modestbranding=1&showinfo=0&iv_load_policy=3&cc_load_policy=0&fs=1&controls=1`}
                    style={{ position: "absolute" as any, top: 0, left: 0, width: "100%", height: "100%", border: "none", borderRadius: 12 }}
                    allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
                );
              }
              return (
                <View style={styles.previewPlaceholder}>
                  <Ionicons name="logo-youtube" size={64} color="#FF0000" />
                  <Text style={styles.previewPlaceholderText}>
                    {youtubeUrl ? "Loading preview..." : "Enter YouTube Live URL to see preview"}
                  </Text>
                </View>
              );
            })()
          )}
        </View>

        {/* Control Panel (1/4) */}
        <View style={styles.controlPanel}>
          <ScrollView
            style={styles.controlScroll}
            contentContainerStyle={styles.controlScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Stream Source Selector */}
            <Text style={styles.sectionLabel}>Stream Source</Text>
            <View style={styles.radioGroup}>
              <Pressable
                style={[
                  styles.radioOption,
                  streamType === "webrtc" && styles.radioOptionActive,
                ]}
                onPress={() => setStreamType("webrtc")}
              >
                <View
                  style={[
                    styles.radioCircle,
                    streamType === "webrtc" && styles.radioCircleActive,
                  ]}
                >
                  {streamType === "webrtc" && (
                    <View style={styles.radioCircleInner} />
                  )}
                </View>
                <View style={styles.radioTextContainer}>
                  <Text
                    style={[
                      styles.radioLabel,
                      streamType === "webrtc" && styles.radioLabelActive,
                    ]}
                  >
                    WebRTC
                  </Text>
                  <Text style={styles.radioDescription}>
                    Stream from your browser
                  </Text>
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.radioOption,
                  streamType === "rtmp" && styles.radioOptionActive,
                ]}
                onPress={() => setStreamType("rtmp")}
              >
                <View
                  style={[
                    styles.radioCircle,
                    streamType === "rtmp" && styles.radioCircleActive,
                  ]}
                >
                  {streamType === "rtmp" && (
                    <View style={styles.radioCircleInner} />
                  )}
                </View>
                <View style={styles.radioTextContainer}>
                  <Text
                    style={[
                      styles.radioLabel,
                      streamType === "rtmp" && styles.radioLabelActive,
                    ]}
                  >
                    RTMP / YouTube
                  </Text>
                  <Text style={styles.radioDescription}>
                    Stream via YouTube Live
                  </Text>
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.radioOption,
                  streamType === "cloudflare" && styles.radioOptionActive,
                ]}
                onPress={() => setStreamType("cloudflare")}
              >
                <View
                  style={[
                    styles.radioCircle,
                    streamType === "cloudflare" && styles.radioCircleActive,
                  ]}
                >
                  {streamType === "cloudflare" && (
                    <View style={styles.radioCircleInner} />
                  )}
                </View>
                <View style={styles.radioTextContainer}>
                  <Text
                    style={[
                      styles.radioLabel,
                      streamType === "cloudflare" && styles.radioLabelActive,
                    ]}
                  >
                    ☁️ Cloudflare Stream
                  </Text>
                  <Text style={styles.radioDescription}>
                    Professional RTMP + HLS
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Cloudflare Stream RTMP credentials */}
            {streamType === "cloudflare" && (
              <View style={styles.cfStreamSection}>
                {cfStreamLoading ? (
                  <View style={styles.cfStreamLoading}>
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                    <Text style={styles.cfStreamLoadingText}>Creating live stream...</Text>
                  </View>
                ) : cfStreamInfo ? (
                  <>
                    <Text style={styles.sectionLabel}>RTMP URL</Text>
                    <View style={styles.cfCredentialBox}>
                      <Text style={styles.cfCredentialText} selectable>{cfStreamInfo.rtmpUrl}</Text>
                    </View>
                    <Text style={[styles.sectionLabel, { marginTop: 12 }]}>Stream Key</Text>
                    <View style={styles.cfCredentialBox}>
                      <Text style={styles.cfCredentialText} selectable>{cfStreamInfo.streamKey}</Text>
                    </View>
                    <Text style={styles.cfHint}>
                      Enter these in OBS or any RTMP encoder to start streaming.
                    </Text>
                  </>
                ) : (
                  <Pressable style={styles.cfRetryButton} onPress={handleCreateCfStream}>
                    <Ionicons name="refresh" size={16} color={Colors.light.primary} />
                    <Text style={styles.cfRetryText}>Retry creating stream</Text>
                  </Pressable>
                )}
              </View>
            )}

            {/* WebRTC Device Selectors */}
            {streamType === "webrtc" && (
              <View style={styles.deviceSection}>
                <Text style={styles.sectionLabel}>Camera</Text>
                {Platform.OS === "web" ? (
                  <View style={styles.selectWrapper}>
                    <select
                      value={webrtc.selectedCamera}
                      onChange={(e: any) =>
                        webrtc.setSelectedCamera(e.target.value)
                      }
                      style={selectStyle}
                    >
                      {webrtc.devices.cameras.map((cam) => (
                        <option key={cam.deviceId} value={cam.deviceId}>
                          {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                      {webrtc.devices.cameras.length === 0 && (
                        <option value="">No cameras found</option>
                      )}
                    </select>
                  </View>
                ) : (
                  <Text style={styles.deviceFallbackText}>
                    Device selection available on web only
                  </Text>
                )}

                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
                  Microphone
                </Text>
                {Platform.OS === "web" ? (
                  <View style={styles.selectWrapper}>
                    <select
                      value={webrtc.selectedMicrophone}
                      onChange={(e: any) =>
                        webrtc.setSelectedMicrophone(e.target.value)
                      }
                      style={selectStyle}
                    >
                      {webrtc.devices.microphones.map((mic) => (
                        <option key={mic.deviceId} value={mic.deviceId}>
                          {mic.label ||
                            `Microphone ${mic.deviceId.slice(0, 8)}`}
                        </option>
                      ))}
                      {webrtc.devices.microphones.length === 0 && (
                        <option value="">No microphones found</option>
                      )}
                    </select>
                  </View>
                ) : (
                  <Text style={styles.deviceFallbackText}>
                    Device selection available on web only
                  </Text>
                )}
              </View>
            )}

            {/* RTMP YouTube URL Input */}
            {streamType === "rtmp" && (
              <View style={styles.rtmpSection}>
                <Text style={styles.sectionLabel}>YouTube Live URL</Text>
                <TextInput
                  style={styles.urlInput}
                  placeholder="https://youtube.com/live/..."
                  placeholderTextColor={Colors.light.textMuted}
                  value={youtubeUrl}
                  onChangeText={(text) => {
                    setYoutubeUrl(text);
                    if (validationError) setValidationError(null);
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
            )}

            {/* Divider */}
            <View style={styles.divider} />

            {/* Viewer Count Toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleInfo}>
                <Ionicons
                  name="eye-outline"
                  size={18}
                  color={Colors.light.text}
                />
                <Text style={styles.toggleLabel}>Show Viewer Count</Text>
              </View>
              <Pressable
                style={[
                  styles.toggleSwitch,
                  showViewerCount && styles.toggleSwitchActive,
                ]}
                onPress={() => setShowViewerCount(!showViewerCount)}
              >
                <View
                  style={[
                    styles.toggleKnob,
                    showViewerCount && styles.toggleKnobActive,
                  ]}
                />
              </Pressable>
            </View>

            {/* Chat Mode Selector */}
            <Text style={[styles.sectionLabel, { marginTop: 16 }]}>
              Chat Mode
            </Text>
            <View style={styles.chatModeRow}>
              <Pressable
                style={[
                  styles.chatModeButton,
                  chatMode === "public" && styles.chatModeButtonActive,
                ]}
                onPress={() => setChatMode("public")}
              >
                <Ionicons
                  name="globe-outline"
                  size={16}
                  color={
                    chatMode === "public" ? "#fff" : Colors.light.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.chatModeText,
                    chatMode === "public" && styles.chatModeTextActive,
                  ]}
                >
                  Public
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.chatModeButton,
                  chatMode === "private" && styles.chatModeButtonActive,
                ]}
                onPress={() => setChatMode("private")}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={16}
                  color={
                    chatMode === "private"
                      ? "#fff"
                      : Colors.light.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.chatModeText,
                    chatMode === "private" && styles.chatModeTextActive,
                  ]}
                >
                  Private
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Validation Error */}
          {validationError && (
            <View style={styles.errorContainer}>
              <Ionicons
                name="alert-circle"
                size={16}
                color={Colors.light.error}
              />
              <Text style={styles.errorText}>{validationError}</Text>
            </View>
          )}

          {/* Go Live Button */}
          <Pressable
            style={[
              styles.goLiveButton,
              isGoingLive && styles.goLiveButtonDisabled,
            ]}
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

// Native <select> style for web
const selectStyle: any = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: `1px solid ${Colors.light.border}`,
  backgroundColor: Colors.light.background,
  fontSize: 14,
  color: Colors.light.text,
  outline: "none",
  cursor: "pointer",
  appearance: "none",
  WebkitAppearance: "none",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.light.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Colors.light.background,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: Colors.light.textSecondary,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
  headerBadge: {
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  headerBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 1,
  },

  // Main layout
  main: {
    flex: 1,
    flexDirection: "row",
  },

  // Preview area (3/4)
  previewArea: {
    flex: 3,
    backgroundColor: "#000",
    margin: 12,
    marginRight: 0,
    borderRadius: 12,
    overflow: "hidden",
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#0D1B2A",
    gap: 12,
  },
  previewPlaceholderText: {
    fontSize: 15,
    color: Colors.light.textMuted,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  previewErrorText: {
    fontSize: 14,
    color: Colors.light.error,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 20,
  },

  // Control panel (1/4)
  controlPanel: {
    flex: 1,
    backgroundColor: "#fff",
    margin: 12,
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  controlScroll: {
    flex: 1,
  },
  controlScrollContent: {
    paddingBottom: 8,
  },

  // Section labels
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.light.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },

  // Radio group
  radioGroup: {
    gap: 8,
    marginBottom: 20,
  },
  radioOption: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    gap: 10,
  },
  radioOptionActive: {
    borderColor: Colors.light.primary,
    backgroundColor: "#F0F5FF",
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.light.border,
    justifyContent: "center",
    alignItems: "center",
  },
  radioCircleActive: {
    borderColor: Colors.light.primary,
  },
  radioCircleInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.light.primary,
  },
  radioTextContainer: {
    flex: 1,
  },
  radioLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.light.text,
  },
  radioLabelActive: {
    color: Colors.light.primary,
  },
  radioDescription: {
    fontSize: 12,
    color: Colors.light.textMuted,
    marginTop: 1,
  },

  // Device selectors
  deviceSection: {
    marginBottom: 20,
  },
  selectWrapper: {
    marginBottom: 4,
  },
  deviceFallbackText: {
    fontSize: 13,
    color: Colors.light.textMuted,
    fontStyle: "italic",
  },

  // RTMP section
  rtmpSection: {
    marginBottom: 20,
  },

  // Cloudflare Stream section
  cfStreamSection: {
    marginBottom: 20,
    gap: 4,
  },
  cfStreamLoading: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 12,
  },
  cfStreamLoadingText: {
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  cfCredentialBox: {
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  cfCredentialText: {
    fontSize: 12,
    color: Colors.light.text,
  },
  cfHint: {
    fontSize: 12,
    color: Colors.light.textMuted,
    marginTop: 8,
    lineHeight: 16,
  },
  cfRetryButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 10,
  },
  cfRetryText: {
    fontSize: 13,
    color: Colors.light.primary,
    fontWeight: "600" as const,
  },
  cfReadyBadge: {
    backgroundColor: "#D1FAE5",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 8,
  },
  cfReadyText: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: "#065F46",
  },

  urlInput: {
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.light.text,
    backgroundColor: Colors.light.background,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: Colors.light.border,
    marginVertical: 16,
  },

  // Toggle row
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  toggleInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: Colors.light.text,
  },
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#D1D5DB",
    padding: 2,
    justifyContent: "center",
  },
  toggleSwitchActive: {
    backgroundColor: Colors.light.primary,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  toggleKnobActive: {
    alignSelf: "flex-end",
  },

  // Chat mode
  chatModeRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  chatModeButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.background,
  },
  chatModeButtonActive: {
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.primary,
  },
  chatModeText: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.light.textSecondary,
  },
  chatModeTextActive: {
    color: "#fff",
  },

  // Error
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  errorText: {
    fontSize: 13,
    color: Colors.light.error,
    flex: 1,
  },

  // Go Live button
  goLiveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.light.error,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 8,
  },
  goLiveButtonDisabled: {
    opacity: 0.6,
  },
  goLiveText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});
