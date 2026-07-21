import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track, type RemoteParticipant } from "livekit-client";
import type { Editor } from "tldraw";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import {
  loadClassroomMediaDevices,
  normalizePipPosition,
  parseClassroomTeacherStreamMeta,
  serializeClassroomTeacherStreamMeta,
  type ClassroomPipPosition,
  type ClassroomTeacherStreamMeta,
} from "./mediaDevices";
import {
  isClassroomBoardCaptureReady,
  startClassroomPublishBundle,
  type ClassroomPublishBundle,
  type ClassroomCompositeHandle,
} from "./classroomCompositeStream";
import {
  LIVEKIT_PARTICIPANT_METADATA_CHANGED,
  LIVEKIT_TRACK_MUTED,
  LIVEKIT_TRACK_PUBLISHED,
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
  composite?: MediaStreamTrack;
};

function findTeacherParticipant(room: Room): RemoteParticipant | undefined {
  for (const participant of room.remoteParticipants.values()) {
    const hasCam = participant.getTrackPublication(Track.Source.Camera);
    const hasMic = participant.getTrackPublication(Track.Source.Microphone);
    if (hasCam || hasMic) return participant;
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
  editor: Editor | null = null,
  /** DB pip_position fallback when sessionStorage is empty. */
  liveClassPipPosition?: string
) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectGenRef = useRef(0);
  const publishBundleRef = useRef<ClassroomPublishBundle | null>(null);
  const recordingCompositeRef = useRef<ClassroomCompositeHandle | null>(null);
  const publishedTracksRef = useRef<PublishedTracks>({});
  const publishingRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const intentionalDisconnectRef = useRef(false);
  // boardEl / tokenPayload.token change often (slide frame remounts, JWT
  // refresh), and having them in the connect-effect deps caused a full
  // Room.disconnect() + reconnect loop. Track them in refs so the connect
  // effect only re-runs when the LiveKit URL or the publish flag changes.
  const boardElRef = useRef<HTMLElement | null>(boardEl);
  const tokenRef = useRef<ClassroomTokenPayload | undefined>(tokenPayload);
  useEffect(() => {
    boardElRef.current = boardEl;
  }, [boardEl]);
  useEffect(() => {
    tokenRef.current = tokenPayload;
  }, [tokenPayload]);
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
  const liveClassPipPositionRef = useRef(liveClassPipPosition);
  useEffect(() => {
    liveClassPipPositionRef.current = liveClassPipPosition;
  }, [liveClassPipPosition]);

  const resolvePipPosition = useCallback((override?: string) => {
    const prefs = loadClassroomMediaDevices();
    return normalizePipPosition(
      override ?? prefs.pipPosition ?? liveClassPipPositionRef.current
    );
  }, []);

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
    const previewEl = bundle?.recording.previewEl ?? recordingCompositeRef.current?.previewEl;
    if (previewEl?.srcObject) {
      el.srcObject = previewEl.srcObject;
      void el.play().catch(() => {});
    }
  }, []);

  const publishTeacherMeta = useCallback(async (room: Room, cameraEnabled: boolean, pipOverride?: string) => {
    const prefs = loadClassroomMediaDevices();
    const meta: ClassroomTeacherStreamMeta = {
      pipPosition: resolvePipPosition(pipOverride),
      greenScreen: !!prefs.greenScreenEnabled,
      cameraEnabled,
    };
    if (tokenPayload?.canPublish) {
      setTeacherStreamMeta(meta);
    }
    await publishTeacherStreamMeta(room, serializeClassroomTeacherStreamMeta(meta));
  }, [tokenPayload?.canPublish, resolvePipPosition]);

  const republishTeacherStreamMetaRef = useRef<(pipOverride?: string) => Promise<void>>(async () => {});

  const attachRemoteTeacher = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    const teacher = findTeacherParticipant(room);
    if (!teacher) {
      setTeacherCameraActive(false);
      return;
    }

    const camPub = teacher.getTrackPublication(Track.Source.Camera);
    const camTrack = camPub?.videoTrack;
    if (camTrack && remoteVideoRef.current) {
      camTrack.attach(remoteVideoRef.current);
    } else if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
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
    const composite = publishedTracksRef.current.composite;
    if (composite) await localParticipant.unpublishTrack(composite, true);
    publishedTracksRef.current = {};
  }, []);

  const unpublishCameraTrackOnly = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    const composite = publishedTracksRef.current.composite;
    if (!composite) return;
    await localParticipant.unpublishTrack(composite, false);
    publishedTracksRef.current = {};
    void publishTeacherMeta(room, false);
  }, [publishTeacherMeta]);

  const publishCameraTrackOnly = useCallback(async (): Promise<boolean> => {
    const room = roomRef.current;
    const bundle = publishBundleRef.current;
    if (!room || !bundle) return false;
    const compositeTrack = bundle.recording.stream.getVideoTracks()[0];
    if (!compositeTrack || compositeTrack.readyState !== "live") return false;
    const localParticipant = room.localParticipant as unknown as LocalPublisher;
    if (publishedTracksRef.current.composite) {
      await localParticipant
        .unpublishTrack(publishedTracksRef.current.composite, false)
        .catch(() => {});
    }
    await localParticipant.publishTrack(compositeTrack, {
      source: Track.Source.Camera,
      simulcast: true,
    });
    publishedTracksRef.current = { composite: compositeTrack };
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

      const bundle = await startClassroomPublishBundle({
        editor,
        boardEl,
        cameraId: prefs.cameraId,
        greenScreen: prefs.greenScreenEnabled,
        pipPosition: resolvePipPosition(),
        fps: 30,
      });
      publishBundleRef.current = bundle;
      recordingCompositeRef.current = bundle.recording;
      setCompositeStream(bundle.recording.stream);

      const recTrack = bundle.recording.stream.getVideoTracks()[0];
      if (!recTrack) throw new Error("Missing composite video track");

      await localParticipant.publishTrack(recTrack, {
        source: Track.Source.Camera,
        simulcast: true,
      });
      publishedTracksRef.current = { composite: recTrack };
      setBoardStreaming(true);
      void publishTeacherMeta(room, true);

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
    resolvePipPosition,
  ]);

  useEffect(() => {
    republishTeacherStreamMetaRef.current = async (pipOverride?: string) => {
      const room = roomRef.current;
      if (!room || !tokenPayload?.canPublish) return;
      // Move the teacher cutout in the live composite paint loop directly
      // instead of restarting the whole publish bundle — restarting caused
      // "createOffer with closed peer connection" errors and brief video
      // stalls for students every time the admin picked a new corner.
      if (pipOverride) {
        const nextPos = normalizePipPosition(pipOverride) as ClassroomPipPosition;
        publishBundleRef.current?.setPipPosition(nextPos);
      }
      await publishTeacherMeta(room, camEnabled, pipOverride);
    };
  }, [tokenPayload?.canPublish, camEnabled, publishTeacherMeta]);

  const republishTeacherStreamMeta = useCallback(async (pipOverride?: string) => {
    await republishTeacherStreamMetaRef.current(pipOverride);
  }, []);

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && (publishBundleRef.current || recordingCompositeRef.current)) {
        attachLocalCameraPreview();
      }
    },
    [attachLocalCameraPreview],
  );

  const setRemoteVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteVideoRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  /** @deprecated alias for setRemoteVideoEl */
  const setRemoteBoardEl = setRemoteVideoEl;
  const setRemoteCameraEl = setRemoteVideoEl;

  const setRemoteAudioEl = useCallback(
    (el: HTMLAudioElement | null) => {
      remoteAudioRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  useEffect(() => {
    if (!enabled || !tokenPayload?.url) return;
    // Read the latest token from the ref so a JWT rotation does not trigger a
    // full disconnect/reconnect. We only rebuild the Room when the LiveKit
    // server URL or publish permission actually changes.
    const initialToken = tokenRef.current?.token;
    if (!initialToken) return;

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
    room.on(LIVEKIT_TRACK_PUBLISHED as RoomEvent, onRemoteTracksChanged);
    room.on(LIVEKIT_TRACK_UNPUBLISHED as RoomEvent, onRemoteTracksChanged);
    room.on(LIVEKIT_TRACK_MUTED as RoomEvent, onTrackMuted);
    room.on(LIVEKIT_TRACK_UNMUTED as RoomEvent, onTrackUnmuted);
    room.on(LIVEKIT_PARTICIPANT_METADATA_CHANGED as RoomEvent, onParticipantMetadataChanged);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);

    const connect = async () => {
      try {
        await room.connect(tokenPayload.url!, initialToken);
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
          // Read the latest boardEl at connect time: it may still be null on
          // first connect (slide frame not yet mounted). If it is, publish the
          // plain camera track; the composite-publish effect will republish
          // once the board is ready.
          if (!boardElRef.current) {
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
      room.off(LIVEKIT_TRACK_PUBLISHED as RoomEvent, onRemoteTracksChanged);
      room.off(LIVEKIT_TRACK_UNPUBLISHED as RoomEvent, onRemoteTracksChanged);
      room.off(LIVEKIT_TRACK_MUTED as RoomEvent, onTrackMuted);
      room.off(LIVEKIT_TRACK_UNMUTED as RoomEvent, onTrackUnmuted);
      room.off(LIVEKIT_PARTICIPANT_METADATA_CHANGED as RoomEvent, onParticipantMetadataChanged);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      // Serialize teardown: await the track unpublish + composite stop before
      // calling room.disconnect(). Racing these caused "createOffer with
      // closed peer connection" warnings whenever the effect cleaned up.
      void (async () => {
        try {
          await unpublishCompositeTracks();
        } catch {
          /* peer connection may already be closed */
        }
        stopComposite();
        try {
          await room.disconnect();
        } catch {
          /* already disconnected */
        }
      })();
      roomRef.current = null;
      setConnected(false);
      setTeacherCameraActive(false);
    };
    // Intentionally exclude tokenPayload.token, boardEl and the stable
    // callback refs (attachRemoteTeacher, syncTeacherStreamMeta,
    // unpublishCompositeTracks, stopComposite): including them caused the
    // whole LiveKit room to tear down and reconnect on every JWT refresh or
    // slide-frame remount. See boardElRef / tokenRef above.
  }, [enabled, tokenPayload?.url, tokenPayload?.canPublish, reconnectNonce]);

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
    republishTeacherStreamMeta,
    attachRemoteTeacher,
    room: roomRef,
  };
};
