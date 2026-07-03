import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { Editor } from "tldraw";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import {
  loadClassroomMediaDevices,
  normalizePipPosition,
  parseClassroomTeacherStreamMeta,
  serializeClassroomTeacherStreamMeta,
  type ClassroomTeacherStreamMeta,
} from "./mediaDevices";
import {
  CLASSROOM_SPLIT_STREAM,
  isClassroomBoardCaptureReady,
  startClassroomPublishBundle,
  startClassroomRecordingComposite,
  type ClassroomPublishBundle,
  type ClassroomCompositeHandle,
} from "./classroomCompositeStream";
import {
  LIVEKIT_PARTICIPANT_METADATA_CHANGED,
  LIVEKIT_TRACK_MUTED,
  LIVEKIT_TRACK_UNMUTED,
  LIVEKIT_TRACK_UNPUBLISHED,
  publishTeacherStreamMeta,
  readParticipantMeta,
} from "./livekitParticipantMeta";

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

function findTeacherParticipant(room: Room): RemoteParticipant | undefined {
  for (const participant of room.remoteParticipants.values()) {
    const hasBoard = participant.getTrackPublication(Track.Source.ScreenShare);
    const hasCam = participant.getTrackPublication(Track.Source.Camera);
    const hasMic = participant.getTrackPublication(Track.Source.Microphone);
    if (hasBoard || hasCam || hasMic) return participant;
  }
  return undefined;
}

type CameraPublication = {
  videoTrack?: unknown;
  isMuted?: boolean;
};

function isTeacherCameraActive(participant: RemoteParticipant): boolean {
  const camPub = participant.getTrackPublication(Track.Source.Camera) as CameraPublication | undefined;
  if (!camPub?.videoTrack) return false;
  if (camPub.isMuted === true) return false;
  return true;
}

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
  const [teacherCameraActive, setTeacherCameraActive] = useState(false);

  const syncTeacherStreamMeta = useCallback(() => {
    const room = roomRef.current;
    if (!room || tokenPayload?.canPublish) return;
    const teacher = findTeacherParticipant(room);
    if (!teacher) return;
    setTeacherStreamMeta(parseClassroomTeacherStreamMeta(readParticipantMeta(teacher)));
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

  const publishTeacherMeta = useCallback(async (room: Room, cameraEnabled: boolean) => {
    const prefs = loadClassroomMediaDevices();
    const meta: ClassroomTeacherStreamMeta = {
      pipPosition: normalizePipPosition(prefs.pipPosition),
      greenScreen: !!prefs.greenScreenEnabled,
      cameraEnabled,
    };
    if (tokenPayload?.canPublish) {
      setTeacherStreamMeta(meta);
    }
    await publishTeacherStreamMeta(room, serializeClassroomTeacherStreamMeta(meta));
  }, [tokenPayload?.canPublish]);

  const attachRemoteTeacher = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const teacher = findTeacherParticipant(room);
    if (!teacher) {
      setTeacherCameraActive(false);
      return;
    }

    const screenPub = teacher.getTrackPublication(Track.Source.ScreenShare);
    const screenTrack = screenPub?.videoTrack;
    if (screenTrack && remoteBoardRef.current) {
      screenTrack.attach(remoteBoardRef.current);
    }

    const camPub = teacher.getTrackPublication(Track.Source.Camera);
    const camTrack = camPub?.videoTrack;
    if (camTrack && remoteCameraRef.current) {
      camTrack.attach(remoteCameraRef.current);
    } else if (remoteCameraRef.current) {
      remoteCameraRef.current.srcObject = null;
    }

    const micPub = teacher.getTrackPublication(Track.Source.Microphone);
    const micTrack = micPub?.audioTrack;
    if (micTrack && remoteAudioRef.current) {
      micTrack.attach(remoteAudioRef.current);
    }

    setTeacherCameraActive(isTeacherCameraActive(teacher));
    syncTeacherStreamMeta();
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
    // Keep local capture alive for fast re-publish and recording composite.
    await localParticipant.unpublishTrack(cam, false);
    const { board, legacy } = publishedTracksRef.current;
    publishedTracksRef.current = { board, legacy };
    void publishTeacherMeta(room, false);
  }, [publishTeacherMeta]);

  const publishCameraTrackOnly = useCallback(async (): Promise<boolean> => {
    const room = roomRef.current;
    const bundle = publishBundleRef.current;
    if (!room || !bundle || !CLASSROOM_SPLIT_STREAM) return false;
    const cameraTrack = bundle.camera.livePublishTrack;
    if (!cameraTrack || cameraTrack.readyState !== "live") return false;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    if (publishedTracksRef.current.camera) {
      await localParticipant.unpublishTrack(publishedTracksRef.current.camera, false).catch(() => {});
    }
    await localParticipant.publishTrack(cameraTrack, {
      source: Track.Source.Camera,
      simulcast: true,
    });
    publishedTracksRef.current = {
      ...publishedTracksRef.current,
      camera: cameraTrack,
    };
    void publishTeacherMeta(room, true);
    attachLocalCameraPreview();
    return true;
  }, [attachLocalCameraPreview, publishTeacherMeta]);

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
        setBoardStreaming(true);
        void publishTeacherMeta(room, true);
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
        setBoardStreaming(true);
        void publishTeacherMeta(room, true);
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
    publishTeacherMeta,
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

    const onRemoteTracksChanged = () => attachRemoteTeacher();
    const onParticipantMetadataChanged = () => {
      syncTeacherStreamMeta();
      attachRemoteTeacher();
    };

    const onTrackMuted = (...args: unknown[]) => {
      const pub = args[0] as { source?: Track.Source };
      if (pub.source === Track.Source.Camera) attachRemoteTeacher();
    };
    const onTrackUnmuted = (...args: unknown[]) => {
      const pub = args[0] as { source?: Track.Source };
      if (pub.source === Track.Source.Camera) attachRemoteTeacher();
    };

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
    const onDisconnected = () => {
      if (connectGenRef.current !== gen) return;
      setConnected(false);
      setTeacherCameraActive(false);
      if (intentionalDisconnectRef.current || !enabled) return;
      const attempt = reconnectAttemptsRef.current++;
      const delay = Math.min(1000 * 2 ** attempt, 15000);
      setReconnecting(true);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => setReconnectNonce((n) => n + 1), delay);
    };

    room.on(RoomEvent.TrackSubscribed, onRemoteTracksChanged);
    room.on(RoomEvent.TrackPublished, onRemoteTracksChanged);
    room.on(LIVEKIT_TRACK_UNPUBLISHED as RoomEvent, onRemoteTracksChanged);
    room.on(LIVEKIT_TRACK_MUTED as RoomEvent, onTrackMuted);
    room.on(LIVEKIT_TRACK_UNMUTED as RoomEvent, onTrackUnmuted);
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
      room.off(RoomEvent.TrackSubscribed, onRemoteTracksChanged);
      room.off(RoomEvent.TrackPublished, onRemoteTracksChanged);
      room.off(LIVEKIT_TRACK_UNPUBLISHED as RoomEvent, onRemoteTracksChanged);
      room.off(LIVEKIT_TRACK_MUTED as RoomEvent, onTrackMuted);
      room.off(LIVEKIT_TRACK_UNMUTED as RoomEvent, onTrackUnmuted);
      room.off(LIVEKIT_PARTICIPANT_METADATA_CHANGED as RoomEvent, onParticipantMetadataChanged);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      void unpublishCompositeTracks();
      stopComposite();
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
      setTeacherCameraActive(false);
    };
  }, [
    enabled,
    tokenPayload?.token,
    tokenPayload?.url,
    tokenPayload?.canPublish,
    reconnectNonce,
    attachRemoteTeacher,
    syncTeacherStreamMeta,
    unpublishCompositeTracks,
    stopComposite,
    boardEl,
  ]);

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
    if (boardEl && tokenPayload?.canPublish) {
      if (next) {
        const republished = await publishCameraTrackOnly();
        if (!republished) await startCompositePublish();
      } else {
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
    teacherCameraActive,
    setLocalVideoEl,
    setRemoteVideoEl,
    setRemoteBoardEl,
    setRemoteCameraEl,
    setRemoteAudioEl,
    toggleMic,
    toggleCam,
    room: roomRef,
  };
};
