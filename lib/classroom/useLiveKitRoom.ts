import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { Editor } from "tldraw";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices } from "./mediaDevices";
import {
  CLASSROOM_SPLIT_STREAM,
  startClassroomBoardStream,
  startClassroomCameraStream,
  startClassroomRecordingComposite,
  type BoardStreamHandle,
  type CameraStreamHandle,
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
  const boardHandleRef = useRef<BoardStreamHandle | null>(null);
  const cameraHandleRef = useRef<CameraStreamHandle | null>(null);
  const recordingCompositeRef = useRef<ClassroomCompositeHandle | null>(null);
  const publishedTracksRef = useRef<PublishedTracks>({});
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
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
      } else if (camTrack && remoteBoardRef.current && !screenTrack) {
        camTrack.attach(remoteBoardRef.current);
      }

      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      const micTrack = micPub?.audioTrack;
      if (micTrack && remoteAudioRef.current) {
        micTrack.attach(remoteAudioRef.current);
      }

      if (screenTrack || camTrack || micTrack) return;
    }
  }, []);

  const stopComposite = useCallback(() => {
    boardHandleRef.current?.stop();
    boardHandleRef.current = null;
    cameraHandleRef.current?.stop();
    cameraHandleRef.current = null;
    recordingCompositeRef.current?.stop();
    recordingCompositeRef.current = null;
    publishedTracksRef.current = {};
    setCompositeStream(null);
  }, []);

  const startCompositePublish = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !boardEl || !tokenPayload?.canPublish) return;

    const prefs = loadClassroomMediaDevices();
    stopComposite();

    try {
      await room.localParticipant.setCameraEnabled(false);

      const localParticipant = room.localParticipant as unknown as LocalPublisher;

      if (CLASSROOM_SPLIT_STREAM) {
        const boardHandle = await startClassroomBoardStream({
          editor,
          boardEl,
          fps: 30,
        });
        boardHandleRef.current = boardHandle;

        const cameraHandle = await startClassroomCameraStream({
          cameraId: prefs.cameraId,
          greenScreen: prefs.greenScreenEnabled,
          fps: 30,
        });
        cameraHandleRef.current = cameraHandle;

        const recordingHandle = await startClassroomRecordingComposite({
          editor,
          boardEl,
          cameraId: prefs.cameraId,
          greenScreen: prefs.greenScreenEnabled,
          fps: 30,
        });
        recordingCompositeRef.current = recordingHandle;
        setCompositeStream(recordingHandle.stream);

        const boardTrack = boardHandle.stream.getVideoTracks()[0];
        const cameraTrack = cameraHandle.stream.getVideoTracks()[0];
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
      attachLocalCompositePreview();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start composite stream");
      setCamEnabled(false);
      stopComposite();
    }
  }, [boardEl, editor, tokenPayload?.canPublish, stopComposite, attachLocalCompositePreview]);

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
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onRemoteSubscribed = () => attachRemoteTeacher();

    room.on(RoomEvent.TrackSubscribed, onRemoteSubscribed);

    const connect = async () => {
      try {
        await room.connect(tokenPayload.url, tokenPayload.token);
        if (connectGenRef.current !== gen) return;

        setConnected(true);
        setError(null);

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
        setError(e instanceof Error ? e.message : "Failed to connect video");
        setConnected(false);
      }
    };

    void connect();

    return () => {
      if (connectGenRef.current === gen) {
        connectGenRef.current += 1;
      }
      stopComposite();
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tokenPayload?.token, tokenPayload?.url, tokenPayload?.canPublish]);

  useEffect(() => {
    if (!connected || !boardEl || !tokenPayload?.canPublish) return;
    if (boardHandleRef.current || recordingCompositeRef.current) return;
    void startCompositePublish();
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
    if (boardEl && (boardHandleRef.current || recordingCompositeRef.current)) {
      if (next) {
        await startCompositePublish();
      } else {
        const localParticipant = room.localParticipant as unknown as LocalPublisher;
        const published = publishedTracksRef.current;
        for (const track of [published.board, published.camera, published.legacy]) {
          if (track) await localParticipant.unpublishTrack(track, true);
        }
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
