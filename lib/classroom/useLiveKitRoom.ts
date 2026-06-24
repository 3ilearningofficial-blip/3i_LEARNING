import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { Editor } from "tldraw";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices, normalizePipPosition, parseClassroomTeacherStreamMeta, serializeClassroomTeacherStreamMeta, type ClassroomTeacherStreamMeta } from "./mediaDevices";
import {
  CLASSROOM_SPLIT_STREAM,
  isClassroomBoardCaptureReady,
  startClassroomPublishBundle,
  startClassroomRecordingComposite,
  type ClassroomPublishBundle,
  type ClassroomCompositeHandle,
} from "./classroomCompositeStream";
import { LIVEKIT_PARTICIPANT_METADATA_CHANGED, publishTeacherStreamMeta, readParticipantMeta } from "./livekitParticipantMeta";

type LocalPublisher = {
  publishTrack(
    track: MediaStreamTrack,
    options?: { source?: Track.Source; simulcast?: boolean }
  ): Promise<unknown>;
  unpublishTrack(track: MediaStreamTrack, stopOnUnpublish?: boolean): Promise<unknown>;
};

type PublishedTracks = {
  board?: MediaStreamTrack;
  camera?: MediaStreamTrack;
  legacy?: MediaStreamTrack;
};

export function useLiveKitRoom(
  tokenPayload: ClassroomTokenPayload | undefined,
  enabled: boolean,
  /** Slide frame + tldraw editor for board capture. */
  boardEl: HTMLElement | null = null,
  editor: Editor | null = null
) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteBoardRef = useRef<HTMLVideoElement | null>(null);
  const remoteCameraRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectGenRef = useRef(0);
  const publishBundleRef = useRef<ClassroomPublishBundle | null>(null);
  const recordingCompositeRef = useRef<ClassroomCompositeHandle | null>(null);
  const publishedTracksRef = useRef<PublishedTracks>({});
  const publishingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  /** Recording composite only — not for teacher sidebar preview. */
  const [compositeStream, setCompositeStream] = useState<MediaStream | null>(null);
  const [boardStreaming, setBoardStreaming] = useState(false);
  const [teacherStreamMeta, setTeacherStreamMeta] = useState<ClassroomTeacherStreamMeta>({});

  const syncTeacherStreamMeta = useCallback(() => {
    const room = roomRef.current;
    if (!room || tokenPayload?.canPublish) return;
    for (const participant of room.remoteParticipants.values()) {
      const hasBoard = participant.getTrackPublication(Track.Source.ScreenShare);
      const hasCam = participant.getTrackPublication(Track.Source.Camera);
      if (hasBoard || hasCam) {
        setTeacherStreamMeta(parseClassroomTeacherStreamMeta(readParticipantMeta(participant)));
        return;
      }
    }
  }, [tokenPayload?.canPublish]);

  const attachLocalCameraPreview = useCallback(() => {
    const el = localVideoRef.current;
    if (!el) return;
    const bundle = publishBundleRef.current;
    if (CLASSROOM_SPLIT_STREAM && bundle?.camera.previewEl?.srcObject) {
      el.srcObject = bundle.camera.previewEl.srcObject;
    } else {
      const handle = recordingCompositeRef.current;
      if (handle?.previewEl?.srcObject) {
        el.srcObject = handle.previewEl.srcObject;
      }
    }
    void el.play().catch(() => {});
  }, []);

  const attachRemoteTeacher = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const screenPub = participant.getTrackPublication(Track.Source.ScreenShare);
      const screenTrack = screenPub?.videoTrack;
      if (screenTrack && remoteBoardRef.current) {
        screenTrack.attach(remoteBoardRef.current);
      }

      const camPub = participant.getTrackPublication(Track.Source.Camera);
      const camTrack = camPub?.videoTrack;
      if (camTrack && remoteCameraRef.current) {
        camTrack.attach(remoteCameraRef.current);
      }

      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      const micTrack = micPub?.audioTrack;
      if (micTrack && remoteAudioRef.current) {
        micTrack.attach(remoteAudioRef.current);
      }

      if (screenTrack || camTrack || micTrack) {
        syncTeacherStreamMeta();
        return;
      }
    }
  }, [syncTeacherStreamMeta]);

  const unpublishCompositeTracks = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    const published = publishedTracksRef.current;
    for (const track of [published.board, published.camera, published.legacy]) {
      if (track) await localParticipant.unpublishTrack(track, true);
    }
    publishedTracksRef.current = {};
  }, []);

  const unpublishCameraTrackOnly = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    const cam = publishedTracksRef.current.camera;
    if (!cam) return;
    await localParticipant.unpublishTrack(cam, true);
    const { board, legacy } = publishedTracksRef.current;
    publishedTracksRef.current = { board, legacy };
  }, []);

  const publishCameraTrackOnly = useCallback(async (): Promise<boolean> => {
    const room = roomRef.current;
    const bundle = publishBundleRef.current;
    if (!room || !bundle || !CLASSROOM_SPLIT_STREAM) return false;
    const cameraTrack = bundle.camera.livePublishTrack;
    if (!cameraTrack || cameraTrack.readyState !== "live") return false;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    if (publishedTracksRef.current.camera) {
      await localParticipant.unpublishTrack(publishedTracksRef.current.camera, true).catch(() => {});
    }
    await localParticipant.publishTrack(cameraTrack, {
      source: Track.Source.Camera,
      simulcast: true,
    });
    publishedTracksRef.current = {
      ...publishedTracksRef.current,
      camera: cameraTrack,
    };
    attachLocalCameraPreview();
    return true;
  }, [attachLocalCameraPreview]);

  const stopComposite = useCallback(() => {
    publishBundleRef.current?.stop();
    publishBundleRef.current = null;
    recordingCompositeRef.current = null;
    publishedTracksRef.current = {};
    setCompositeStream(null);
    setBoardStreaming(false);
  }, []);

  const startCompositePublish = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !boardEl || !editor || !tokenPayload?.canPublish) return;
    if (!isClassroomBoardCaptureReady(editor, boardEl)) return;
    if (publishingRef.current) return;

    publishingRef.current = true;
    const prefs = loadClassroomMediaDevices();

    try {
      await unpublishCompositeTracks();
      stopComposite();
      await room.localParticipant.setCameraEnabled(false);

      const localParticipant = room.localParticipant as unknown as LocalPublisher;

      if (CLASSROOM_SPLIT_STREAM) {
        const bundle = await startClassroomPublishBundle({
          editor,
          boardEl,
          cameraId: prefs.cameraId,
          greenScreen: prefs.greenScreenEnabled,
          pipPosition: prefs.pipPosition,
          fps: 30,
        });
        publishBundleRef.current = bundle;
        recordingCompositeRef.current = bundle.recording;
        setCompositeStream(bundle.recording.stream);

        const boardTrack = bundle.board.stream.getVideoTracks()[0];
        const cameraTrack = bundle.camera.livePublishTrack;
        if (!boardTrack || !cameraTrack) throw new Error("Missing publish tracks");

        await localParticipant.publishTrack(boardTrack, {
          source: Track.Source.ScreenShare,
          simulcast: true,
        });
        publishedTracksRef.current = { board: boardTrack };
        await localParticipant.publishTrack(cameraTrack, {
          source: Track.Source.Camera,
          simulcast: true,
        });
        publishedTracksRef.current = { board: boardTrack, camera: cameraTrack };
        await publishTeacherStreamMeta(
          room,
          serializeClassroomTeacherStreamMeta({
            pipPosition: normalizePipPosition(prefs.pipPosition),
            greenScreen: !!prefs.greenScreenEnabled,
          })
        );
        setBoardStreaming(true);
      } else {
        const handle = await startClassroomRecordingComposite({
          editor,
          boardEl,
          cameraId: prefs.cameraId,
          greenScreen: prefs.greenScreenEnabled,
          pipPosition: prefs.pipPosition,
        });
        recordingCompositeRef.current = handle;
        setCompositeStream(handle.stream);
        const videoTrack = handle.stream.getVideoTracks()[0];
        if (!videoTrack) throw new Error("No composite video track");
        await localParticipant.publishTrack(videoTrack, {
          source: Track.Source.Camera,
          simulcast: true,
        });
        publishedTracksRef.current = { legacy: videoTrack };
        await publishTeacherStreamMeta(
          room,
          serializeClassroomTeacherStreamMeta({
            pipPosition: normalizePipPosition(prefs.pipPosition),
            greenScreen: !!prefs.greenScreenEnabled,
          })
        );
        setBoardStreaming(true);
      }

      setCamEnabled(true);
      setError(null);
      attachLocalCameraPreview();
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : "Failed to start board stream";
      setError(`${detail}. Board stream failed — refresh the page.`);
      setCamEnabled(false);
      setBoardStreaming(false);
      await unpublishCompositeTracks().catch(() => {});
      stopComposite();
    } finally {
      publishingRef.current = false;
    }
  }, [
    boardEl,
    editor,
    tokenPayload?.canPublish,
    stopComposite,
    unpublishCompositeTracks,
    attachLocalCameraPreview,
  ]);

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && (publishBundleRef.current || recordingCompositeRef.current)) {
        attachLocalCameraPreview();
      }
    },
    [attachLocalCameraPreview],
  );

  const setRemoteBoardEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteBoardRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  const setRemoteCameraEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteCameraRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  /** @deprecated use setRemoteBoardEl — kept for single-track fallback */
  const setRemoteVideoEl = setRemoteBoardEl;

  const setRemoteAudioEl = useCallback(
    (el: HTMLAudioElement | null) => {
      remoteAudioRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  useEffect(() => {
    if (!enabled || !tokenPayload?.token || !tokenPayload.url) return;

    const gen = ++connectGenRef.current;
    intentionalDisconnectRef.current = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onRemoteSubscribed = () => attachRemoteTeacher();
    const onParticipantMetadataChanged = () => syncTeacherStreamMeta();

    // LiveKit's own ICE-restart recovery (transient blips).
    const onReconnecting = () => {
      if (connectGenRef.current === gen) setReconnecting(true);
    };
    const onReconnected = () => {
      if (connectGenRef.current !== gen) return;
      setReconnecting(false);
      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
      attachRemoteTeacher();
    };
    // Hard drop: rebuild a fresh Room with capped backoff (unless we tore down on purpose).
    const onDisconnected = () => {
      if (connectGenRef.current !== gen) return;
      setConnected(false);
      if (intentionalDisconnectRef.current || !enabled) return;
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      setReconnecting(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => setReconnectNonce((n) => n + 1), delay);
    };

    room.on(RoomEvent.TrackSubscribed, onRemoteSubscribed);
    room.on(LIVEKIT_PARTICIPANT_METADATA_CHANGED as RoomEvent, onParticipantMetadataChanged);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);

    const connect = async () => {
      try {
        await room.connect(tokenPayload.url, tokenPayload.token);
        if (connectGenRef.current !== gen) return;

        setConnected(true);
        setReconnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;

        const prefs = loadClassroomMediaDevices();
        if (tokenPayload.canPublish) {
          await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: prefs.microphoneId,
          });
          setMicEnabled(room.localParticipant.isMicrophoneEnabled);
          if (!boardEl) {
            await room.localParticipant.setCameraEnabled(true, {
              deviceId: prefs.cameraId,
            });
            setCamEnabled(room.localParticipant.isCameraEnabled);
            const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
            const track = pub?.videoTrack;
            if (track && localVideoRef.current) track.attach(localVideoRef.current);
          }
        } else {
          attachRemoteTeacher();
        }
      } catch (e: unknown) {
        if (connectGenRef.current !== gen) return;
        setConnected(false);
        // Retry the initial connect too (e.g. server warm-up / transient 5xx).
        if (!intentionalDisconnectRef.current && enabled) {
          const attempt = reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * 2 ** attempt, 15000);
          setReconnecting(true);
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => setReconnectNonce((n) => n + 1), delay);
        } else {
          setError(e instanceof Error ? e.message : "Failed to connect video");
        }
      }
    };

    void connect();

    return () => {
      intentionalDisconnectRef.current = true;
      if (connectGenRef.current === gen) {
        connectGenRef.current += 1;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      room.off(RoomEvent.TrackSubscribed, onRemoteSubscribed);
      room.off(LIVEKIT_PARTICIPANT_METADATA_CHANGED as RoomEvent, onParticipantMetadataChanged);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      void unpublishCompositeTracks();
      stopComposite();
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
  }, [enabled, tokenPayload?.token, tokenPayload?.url, tokenPayload?.canPublish, reconnectNonce]);

  useEffect(() => {
    if (!connected || !boardEl || !editor || !tokenPayload?.canPublish) return;

    if (isClassroomBoardCaptureReady(editor, boardEl)) {
      void startCompositePublish();
      return;
    }

    const t1 = setTimeout(() => {
      if (editor && boardEl && isClassroomBoardCaptureReady(editor, boardEl)) {
        void startCompositePublish();
      }
    }, 500);

    const t2 = setTimeout(() => {
      if (editor && boardEl) void startCompositePublish();
    }, 1500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [connected, boardEl, editor, tokenPayload?.canPublish, startCompositePublish]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !camEnabled;
    // Classroom teachers always publish canvas composite tracks when boardEl is set.
    if (boardEl && tokenPayload?.canPublish) {
      if (next) {
        const republished = await publishCameraTrackOnly();
        if (!republished) await startCompositePublish();
      } else {
        // Keep recording composite running; only unpublish student camera track.
        await unpublishCameraTrackOnly();
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
      }
      setCamEnabled(next);
      return;
    }
    const nextCam = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(nextCam);
    setCamEnabled(nextCam);
  };

  return {
    error,
    connected,
    reconnecting,
    micEnabled,
    camEnabled,
    compositeStream,
    boardStreaming,
    teacherStreamMeta,
    setLocalVideoEl,
    setRemoteVideoEl,
    setRemoteBoardEl,
    setRemoteCameraEl,
    setRemoteAudioEl,
    toggleMic,
    toggleCam,
    room: roomRef,
  };
}
