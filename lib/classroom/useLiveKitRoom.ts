import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices } from "./mediaDevices";

export function useLiveKitRoom(
  tokenPayload: ClassroomTokenPayload | undefined,
  enabled: boolean
) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const connectGenRef = useRef(0);
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

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && roomRef.current) attachLocal();
    },
    [attachLocal]
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
          await room.localParticipant.setCameraEnabled(true, {
            deviceId: prefs.cameraId,
          });
          setMicEnabled(room.localParticipant.isMicrophoneEnabled);
          setCamEnabled(room.localParticipant.isCameraEnabled);
          attachLocal();
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
