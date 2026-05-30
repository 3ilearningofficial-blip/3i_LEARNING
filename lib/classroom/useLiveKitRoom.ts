import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { Editor } from "tldraw";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices } from "./mediaDevices";
import {
  CLASSROOM_SPLIT_STREAM,
  isClassroomBoardCaptureReady,
  startClassroomPublishBundle,
  startClassroomRecordingComposite,
  type ClassroomPublishBundle,
  type ClassroomCompositeHandle,
} from "./classroomCompositeStream";

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
  const [compositeStream, setCompositeStream] = useState<MediaStream | null>(null);

  const attachLocalCompositePreview = useCallback(() => {
    const handle = recordingCompositeRef.current;
    const el = localVideoRef.current;
    if (!handle || !el) return;
    el.srcObject = handle.previewEl.srcObject;
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

      if (screenTrack || camTrack || micTrack) return;
    }
  }, []);

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

  const stopComposite = useCallback(() => {
    publishBundleRef.current?.stop();
    publishBundleRef.current = null;
    recordingCompositeRef.current = null;
    publishedTracksRef.current = {};
    setCompositeStream(null);
  }, []);

  const startCompositePublish = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !boardEl || !tokenPayload?.canPublish) return;
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
        const cameraTrack = bundle.camera.stream.getVideoTracks()[0];
        if (!boardTrack || !cameraTrack) throw new Error("Missing publish tracks");

        await localParticipant.publishTrack(boardTrack, {
          source: Track.Source.ScreenShare,
          simulcast: true,
        });
        await localParticipant.publishTrack(cameraTrack, {
          source: Track.Source.Camera,
          simulcast: true,
        });
        publishedTracksRef.current = { board: boardTrack, camera: cameraTrack };
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
      }

      setCamEnabled(true);
      setError(null);
      attachLocalCompositePreview();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start composite stream");
      setCamEnabled(false);
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
    attachLocalCompositePreview,
  ]);

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && recordingCompositeRef.current) attachLocalCompositePreview();
    },
    [attachLocalCompositePreview]
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
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      void unpublishCompositeTracks();
      stopComposite();
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tokenPayload?.token, tokenPayload?.url, tokenPayload?.canPublish, reconnectNonce]);

  useEffect(() => {
    if (!connected || !boardEl || !tokenPayload?.canPublish) return;

    // tldraw mounts its editor synchronously (onMount fires before React's next paint),
    // but the underlying <canvas> element may not have rendered its first frame yet —
    // isClassroomBoardCaptureReady checks for canvas.width > 0 which is 0 until paint.
    // If we return early without a retry, the PIP / composite stream never starts and
    // the teacher must toggle camera off/on to recover.
    //
    // Strategy: try immediately; if not ready, retry at 500 ms and again at 1500 ms.
    // By 1.5 s the canvas is always painted; startCompositePublish guards itself too.
    if (isClassroomBoardCaptureReady(editor, boardEl)) {
      void startCompositePublish();
      return;
    }

    const t1 = setTimeout(() => {
      if (isClassroomBoardCaptureReady(editor, boardEl)) void startCompositePublish();
    }, 500);

    const t2 = setTimeout(() => {
      // Unconditional at 1.5 s — startCompositePublish checks readiness internally
      // and guards against concurrent calls via publishingRef.
      void startCompositePublish();
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
        await startCompositePublish();
      } else {
        await unpublishCompositeTracks();
        stopComposite();
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
