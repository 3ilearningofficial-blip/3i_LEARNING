import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import type { Room } from "livekit-client";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { liveClassQueryKey, liveClassesQueryKey } from "@/lib/query-keys";
import TldrawClassroom from "@/components/classroom/TldrawClassroom";
import type { TldrawClassroomHandle } from "@/components/classroom/TldrawClassroom.types";
import ClassroomSlideShell, {
  type ClassroomSlideShellHandle,
} from "@/components/classroom/ClassroomSlideShell";
import ClassroomSlideToolbar from "@/components/classroom/ClassroomSlideToolbar";
import ClassroomPageThumbnails from "@/components/classroom/ClassroomPageThumbnails";
import ClassroomEndSessionModal from "@/components/classroom/ClassroomEndSessionModal";
import type { EndSessionArchive } from "@/lib/classroom/uploadClassroomBoardArchive";
import { finalizeClassroomLiveSession } from "@/lib/classroom/finalizeClassroomLive";
import { importImageToCurrentSlide } from "@/lib/classroom/importSlideImage";
import { useClassroomBoardCheckpoint } from "@/lib/classroom/useClassroomBoardCheckpoint";
import type { Editor } from "tldraw";
import { useClassroomSessionRecorder } from "@/lib/classroom/useClassroomSessionRecorder";
import { uploadToR2 } from "@/lib/r2-upload";
import { getAdminCoursesSectionRoute } from "@/lib/admin/courseAdminRoutes";
import { adminGoBack } from "@/lib/admin/adminNavigation";
import TeacherVideoPanel from "@/components/classroom/TeacherVideoPanel";
import LiveClassRecordingTimer from "@/components/LiveClassRecordingTimer";
import ClassroomEngagementSidebar from "@/components/classroom/ClassroomEngagementSidebar";
import ClassroomLiveOverlays from "@/components/classroom/ClassroomLiveOverlays";
import ClassroomHeaderActivityTimer from "@/components/classroom/ClassroomHeaderActivityTimer";
import { useLiveEngagementSse } from "@/lib/useLiveEngagementSse";
import { isTruthyDbFlag } from "@/lib/live-class/dbFlags";
import Colors from "@/constants/colors";


export default function AdminClassroomPage() {
  const { id, autoEnd } = useLocalSearchParams<{ id: string; autoEnd?: string }>();
  const liveClassId = String(id || "");
  const qc = useQueryClient();
  const [isEnding, setIsEnding] = useState(false);
  const [endModalOpen, setEndModalOpen] = useState(false);
  const autoEndTriggeredRef = useRef(false);
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [compositeStream, setCompositeStream] = useState<MediaStream | null>(null);
  const [boardStreaming, setBoardStreaming] = useState(false);
  const boardRef = useRef<TldrawClassroomHandle>(null);
  const slideShellRef = useRef<ClassroomSlideShellHandle>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const sessionRecorder = useClassroomSessionRecorder(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: liveClass, isLoading } = useQuery({
    queryKey: liveClassQueryKey(liveClassId),
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}`);
      if (!res.ok) throw new Error("Failed to load");
      const payload = await res.json();
      return payload?.data ?? payload;
    },
    enabled: !!liveClassId,
    refetchInterval: (q) => ((q.state.data as any)?.is_live ? 15000 : false),
  });

  // Recording mode: private recording, not a live broadcast to students.
  const isRecordingMode = !!liveClass?.is_recording_mode;

  const { data: viewerData, refetch: refetchViewers } = useQuery<{
    count: number;
    viewers: { user_id: number; user_name: string }[];
  }>({
    queryKey: [`/api/live-classes/${liveClassId}/viewers`],
    queryFn: async () => {
      const res = await authFetch(
        `${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/viewers`
      );
      if (!res.ok) throw new Error("Failed to fetch viewers");
      return res.json();
    },
    refetchInterval: isTruthyDbFlag(liveClass?.is_live) && !isRecordingMode ? 2000 : false,
    enabled: !!liveClassId && isTruthyDbFlag(liveClass?.is_live) && !isRecordingMode,
  });

  useEffect(() => {
    if (!isTruthyDbFlag(liveClass?.is_live) || isRecordingMode || Platform.OS !== "web") return;
    const onFocus = () => {
      void refetchViewers();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [liveClass?.is_live, isRecordingMode, refetchViewers]);

  const sessionActive = liveClass && !isTruthyDbFlag(liveClass.is_completed);
  const isLive = sessionActive && isTruthyDbFlag(liveClass?.is_live);
  const startedAt = Number(liveClass?.started_at || 0) || null;

  const showViewerCount = liveClass?.show_viewer_count ?? true;

  useLiveEngagementSse({
    liveClassId,
    // Only run the engagement stream while the class is actually live. On a
    // scheduled-but-not-yet-live or already-ended class the /engagement/stream
    // endpoint returns 401/403 loops that flood the console; broadcast/[id]
    // gates on `isLive && tabVisible` for the same reason.
    enabled: !!isLive && !isRecordingMode && Platform.OS === "web",
    isAdmin: true,
  });

  // Dashboard "End Live" redirects here with autoEnd=1 so the class is always
  // ended through the studio (which runs the MediaRecorder stop + R2 upload +
  // board PDF flow). Fire once per navigation, and only after the class query
  // has resolved so the modal has real editor / boardEl values to work with.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (autoEndTriggeredRef.current) return;
    if (String(autoEnd || "") !== "1") return;
    if (!sessionActive) return;
    autoEndTriggeredRef.current = true;
    setEndModalOpen(true);
  }, [autoEnd, sessionActive]);

  const handleRoomReady = useCallback((room: Room | null) => {
    liveKitRoomRef.current = room;
  }, []);

  const getBoardDomElement = useCallback((): HTMLElement | null => {
    if (Platform.OS !== "web") return null;
    return slideShellRef.current?.getSlideFrameElement() ?? null;
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = getBoardDomElement();
    if (el) setBoardEl(el);
    // Also re-read when editor mounts: the slide frame is always in the DOM but we
    // want boardEl to be set as soon as both the DOM element and the tldraw editor
    // are available, so useLiveKitRoom can start the composite stream promptly.
  }, [sessionActive, getBoardDomElement, endModalOpen, editor]);

  const { uploadCheckpoint } = useClassroomBoardCheckpoint(
    liveClassId,
    editor,
    !!isLive && !!sessionActive
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const flush = () => {
      void uploadCheckpoint();
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [uploadCheckpoint]);

  const handleImportSlide = useCallback(() => {
    if (Platform.OS !== "web") return;
    if (!fileInputRef.current) {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/gif";
      input.onchange = async () => {
        const file = input.files?.[0];
        const ed = boardRef.current?.getEditor();
        if (file && ed) await importImageToCurrentSlide(ed, file, liveClassId);
      };
      input.click();
      return;
    }
    fileInputRef.current.click();
  }, [liveClassId]);

  useEffect(() => {
    if (!isLive || !sessionActive || !compositeStream || !boardStreaming) return;
    const t = setTimeout(() => {
      sessionRecorder.startSessionRecording(compositeStream, liveKitRoomRef.current);
    }, 1500);
    return () => clearTimeout(t);
  }, [isLive, sessionActive, boardStreaming, sessionRecorder.startSessionRecording, compositeStream]);

  const chatModeResolved = useMemo(
    () => (liveClass?.chat_mode as "public" | "private") || "public",
    [liveClass?.chat_mode]
  );

  const completeEndClass = useCallback(
    async (archive: EndSessionArchive | null) => {
      setIsEnding(true);
      let videoRecordingUrl: string | undefined;
      let checkpointUrl: string | undefined;
      let recordingStopError: string | null = null;

      try {
        let blob: Blob | null = null;
        try {
          blob = await sessionRecorder.stopAndGetBlob();
        } catch (e: unknown) {
          recordingStopError =
            e instanceof Error ? e.message : "Session recorder failed to stop";
          console.warn("[Classroom] stopAndGetBlob failed:", e);
        }
        if (sessionRecorder.error) {
          recordingStopError = recordingStopError || sessionRecorder.error;
        }
        if (!blob || blob.size === 0) {
          console.warn("[Classroom] session recording was empty — check composite stream / LiveKit publish");
        }
        if (blob && blob.size > 0) {
          const filename = `classroom-recording-${liveClassId}-${Date.now()}.webm`;
          const fileUri = URL.createObjectURL(blob);
          try {
            const subfolder = String(liveClass?.lecture_subfolder_title || "").trim() || undefined;
            const { publicUrl } = await uploadToR2(
              fileUri,
              filename,
              "video/webm",
              "live-class-recording",
              undefined,
              "/api/upload/presign",
              subfolder
            );
            videoRecordingUrl = publicUrl;
          } finally {
            URL.revokeObjectURL(fileUri);
          }
        }

        if (editor) {
          try {
            const snap = editor.getSnapshot();
            const jsonBlob = new Blob([JSON.stringify(snap)], { type: "application/json" });
            const snapUrl = URL.createObjectURL(jsonBlob);
            const { publicUrl } = await uploadToR2(
              snapUrl,
              `classroom-sync-${liveClassId}-${Date.now()}.json`,
              "application/json",
              "live-class-recording",
              undefined,
              "/api/upload/presign",
              String(liveClass?.lecture_subfolder_title || "").trim() || undefined
            );
            checkpointUrl = publicUrl;
            URL.revokeObjectURL(snapUrl);
          } catch {
            /* checkpoint optional */
          }
        }

        const result = await finalizeClassroomLiveSession(
          liveClassId,
          {
            id: liveClassId,
            title: liveClass?.title,
            course_id: liveClass?.course_id,
            subject_key: liveClass?.subject_key,
            lecture_section_title: liveClass?.lecture_section_title,
            lecture_subfolder_title: liveClass?.lecture_subfolder_title,
            recording_url: videoRecordingUrl || liveClass?.recording_url,
            board_snapshot_url: archive?.boardSnapshotUrl || liveClass?.board_snapshot_url,
          },
          boardRef.current?.getEditor() ?? null,
          {
            videoRecordingUrl,
            boardEl: getBoardDomElement(),
            boardArchive: archive,
            boardSyncCheckpointUrl: checkpointUrl,
          }
        );
        qc.invalidateQueries({ queryKey: liveClassesQueryKey() });
        qc.invalidateQueries({ queryKey: liveClassQueryKey(liveClassId) });

        const lines: string[] = ["Class ended."];
        if (!videoRecordingUrl && !result.recordingUrl) {
          lines.push(
            "No session video was saved. The lecture will not show a recording (board snapshot PNG is never used as video). Board checkpoint and snapshots were saved when available."
          );
          if (recordingStopError) {
            lines.push(`Recording error: ${recordingStopError}`);
          }
        }
        if (result.recordingUrl) lines.push(`Video (R2): ${result.recordingUrl}`);
        if (result.boardPdfUrl || archive?.boardPdfUrl) {
          lines.push(`Board PDF (R2): ${result.boardPdfUrl || archive?.boardPdfUrl}`);
        }
        if (result.boardMaterialUrl) lines.push("Board PDF linked in Course → Materials.");
        if (result.boardMaterialSaveFailed) {
          lines.push(
            "Board PDF uploaded to R2 but could not be linked in Materials — add it manually from the PDF URL above."
          );
        }
        if (result.boardSnapshotUrl) lines.push(`Board snapshot: ${result.boardSnapshotUrl}`);
        const msg = lines.join("\n");
        if (Platform.OS === "web") window.alert(msg);
        else Alert.alert("Class ended", msg);

        router.replace(getAdminCoursesSectionRoute() as any);
      } catch (err: any) {
        if (Platform.OS === "web") window.alert(err?.message || "Failed to end class");
        else Alert.alert("Error", err?.message || "Failed to end class");
        setIsEnding(false);
      }
    },
    [liveClassId, qc, liveClass, sessionRecorder, editor, getBoardDomElement]
  );

  const handleEndClass = useCallback(() => {
    if (Platform.OS === "web") setEndModalOpen(true);
  }, []);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.webOnly}>
        <Ionicons name="desktop-outline" size={48} color={Colors.light.primary} />
        <Text style={styles.webOnlyTitle}>Classroom requires web</Text>
        <Text style={styles.webOnlyText}>Open the admin panel in a desktop browser to teach with the whiteboard.</Text>
        <Pressable style={styles.backBtn} onPress={() => adminGoBack(router)}>
          <Text style={styles.backBtnText}>Go back</Text>
        </Pressable>
      </View>
    );
  }

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
        <Pressable style={styles.headerBack} onPress={() => adminGoBack(router)}>
          <Ionicons name="arrow-back" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {liveClass?.title || "Live class"}
        </Text>
        {sessionActive ? (
          <View style={styles.headerStatus}>
            <LiveClassRecordingTimer startedAt={startedAt} active={!!isLive} compact />
            {isLive ? (
              isRecordingMode ? (
                <View style={[styles.livePill, { backgroundColor: "#7C3AED" }]}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>REC</Text>
                </View>
              ) : (
                <View style={styles.livePill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>LIVE</Text>
                </View>
              )
            ) : null}
            {!isRecordingMode ? (
              <ClassroomHeaderActivityTimer
                liveClassId={liveClassId}
                isAdmin
                sessionActive={!!sessionActive}
              />
            ) : null}
            {isLive && !isRecordingMode ? (
              <View
                style={[
                  styles.boardStreamPill,
                  boardStreaming ? styles.boardStreamPillOn : styles.boardStreamPillOff,
                ]}
              >
                <View
                  style={[
                    styles.boardStreamDot,
                    { backgroundColor: boardStreaming ? "#4ADE80" : "#F87171" },
                  ]}
                />
                <Text style={styles.boardStreamText}>
                  {boardStreaming ? "Board live" : "Board off"}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Pressable style={styles.endBtn} onPress={handleEndClass} disabled={isEnding}>
          {isEnding ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.endBtnText}>
              {isRecordingMode ? "Stop Recording" : "End Class"}
            </Text>
          )}
        </Pressable>
      </LinearGradient>

      <ClassroomEndSessionModal
        visible={endModalOpen}
        liveClassId={liveClassId}
        title={String(liveClass?.title || "Live class")}
        editor={editor}
        boardEl={boardEl}
        subfolder={String(liveClass?.lecture_subfolder_title || "").trim() || undefined}
        isRecordingMode={isRecordingMode}
        onClose={() => setEndModalOpen(false)}
        onConfirmEnd={completeEndClass}
      />

      <View style={styles.main}>
        <View style={styles.boardArea}>
          {!isRecordingMode ? (
            <ClassroomLiveOverlays liveClassId={liveClassId} isAdmin sessionActive={!!sessionActive} />
          ) : null}
          <ClassroomSlideShell
            ref={slideShellRef}
            toolbar={
              <ClassroomSlideToolbar boardRef={boardRef} onImportSlide={handleImportSlide} />
            }
            thumbnails={<ClassroomPageThumbnails boardRef={boardRef} />}
          >
            <TldrawClassroom
              ref={boardRef}
              liveClassId={liveClassId}
              readonly={false}
              onEditorReady={setEditor}
            />
          </ClassroomSlideShell>
        </View>

        <View style={styles.sidePanel}>
          <TeacherVideoPanel
            liveClassId={liveClassId}
            enabled={!!sessionActive}
            boardEl={boardEl}
            editor={editor}
            liveClassPipPosition={liveClass?.pip_position}
            onRoomReady={handleRoomReady}
            onCompositeStream={setCompositeStream}
            onBoardStreamingChange={setBoardStreaming}
          />

          {/* Recording mode is a clean lecture recorder: no chat, polls, quiz, hands, or student list. */}
          {!isRecordingMode ? (
            <ClassroomEngagementSidebar
              liveClassId={liveClassId}
              chatMode={chatModeResolved}
              showViewerCount={showViewerCount}
              engagementEnabled={!!isLive}
              parentViewers={
                viewerData
                  ? { viewers: viewerData.viewers, count: viewerData.count }
                  : undefined
              }
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  webOnly: { flex: 1, justifyContent: "center", alignItems: "center", padding: 32, gap: 12 },
  webOnlyTitle: { fontSize: 18, fontWeight: "700", color: Colors.light.text },
  webOnlyText: { fontSize: 14, color: Colors.light.textMuted, textAlign: "center" },
  backBtn: {
    marginTop: 16,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#fff" },
  headerStatus: { flexDirection: "row", alignItems: "center", gap: 8 },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#DC2626",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#fff" },
  liveText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  boardStreamPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  boardStreamPillOn: { backgroundColor: "rgba(22,101,52,0.45)" },
  boardStreamPillOff: { backgroundColor: "rgba(127,29,29,0.45)" },
  boardStreamDot: { width: 6, height: 6, borderRadius: 3 },
  boardStreamText: { fontSize: 10, fontWeight: "700", color: "#fff" },
  endBtn: {
    backgroundColor: "#7F1D1D",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
  },
  endBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  main: { flex: 1, flexDirection: "row" },
  boardArea: {
    flex: 3,
    margin: 8,
    marginRight: 0,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#0a0a0a",
    position: "relative",
  },
  sidePanel: {
    flex: 1,
    margin: 8,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 10,
    minWidth: 420,
    maxWidth: 720,
  },
  colLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: Colors.light.textMuted,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  colBody: { flex: 1, minHeight: 140, paddingHorizontal: 4 },
});
