import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices } from "./mediaDevices";
import { startChromaCameraPublish, type ChromaPublishCleanup } from "./useChromaPublish";

export function useLiveKitRoom(
  tokenPayload: ClassroomTokenPayload | undefined,
  enabled: boolean
) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectGenRef = useRef(0);
  const chromaCleanupRef = useRef<ChromaPublishCleanup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);

  const attachLocal = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack;
    if (track && localVideoRef.current) track.attach(localVideoRef.current);
  }, []);

  const attachRemoteTeacher = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const pub = participant.getTrackPublication(Track.Source.Camera);
      const track = pub?.videoTrack;
      if (track && remoteVideoRef.current) {
        track.attach(remoteVideoRef.current);
        return;
      }
    }
  }, []);

  const ensureChromaPublish = useCallback(async () => {
    const room = roomRef.current;
    const el = localVideoRef.current;
    if (!room || !el) return;
    const prefs = loadClassroomMediaDevices();
    if (!prefs.greenScreenEnabled || chromaCleanupRef.current) return;
    chromaCleanupRef.current = await startChromaCameraPublish(room, prefs.cameraId, el);
    setCamEnabled(true);
  }, []);

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (!el || !roomRef.current) return;
      const prefs = loadClassroomMediaDevices();
      if (prefs.greenScreenEnabled) {
        void ensureChromaPublish();
      } else {
        attachLocal();
      }
    },
    [attachLocal, ensureChromaPublish]
  );

  const setRemoteVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteVideoRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  useEffect(() => {
    if (!enabled || !tokenPayload?.token || !tokenPayload.url) return;

    const gen = ++connectGenRef.current;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    const onLocalPublished = () => attachLocal();
    const onRemoteSubscribed = () => attachRemoteTeacher();

    room.on(RoomEvent.LocalTrackPublished, onLocalPublished);
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
          if (!prefs.greenScreenEnabled) {
            await room.localParticipant.setCameraEnabled(true, {
              deviceId: prefs.cameraId,
            });
            setCamEnabled(room.localParticipant.isCameraEnabled);
            attachLocal();
          } else {
            setCamEnabled(true);
          }
          setMicEnabled(room.localParticipant.isMicrophoneEnabled);
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
      chromaCleanupRef.current?.();
      chromaCleanupRef.current = null;
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tokenPayload?.token, tokenPayload?.url, tokenPayload?.canPublish]);

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
    const prefs = loadClassroomMediaDevices();
    if (prefs.greenScreenEnabled) {
      const next = !camEnabled;
      if (next) {
        chromaCleanupRef.current?.();
        chromaCleanupRef.current = await startChromaCameraPublish(
          room,
          prefs.cameraId,
          localVideoRef.current
        );
      } else {
        chromaCleanupRef.current?.();
        chromaCleanupRef.current = null;
      }
      setCamEnabled(next);
      return;
    }
    const next = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(next);
    setCamEnabled(next);
  };

  return {
    error,
    connected,
    micEnabled,
    camEnabled,
    setLocalVideoEl,
    setRemoteVideoEl,
    toggleMic,
    toggleCam,
    room: roomRef,
  };
}
