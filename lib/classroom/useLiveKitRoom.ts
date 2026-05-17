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
      if (el) attachLocal();
    },
    [attachLocal]
  );

  const setRemoteVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteVideoRef.current = el;
      if (el) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

  useEffect(() => {
    if (!enabled || !tokenPayload?.token || !tokenPayload.url) return;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let cancelled = false;

    room.on(RoomEvent.TrackSubscribed, attachRemoteTeacher);
    room.on(RoomEvent.LocalTrackPublished, attachLocal);

    const mediaPrefs = loadClassroomMediaDevices();

    void room
      .connect(tokenPayload.url, tokenPayload.token)
      .then(async () => {
        if (cancelled) return;
        setConnected(true);
        if (tokenPayload.canPublish) {
          await room.localParticipant.setMicrophoneEnabled(true, {
            deviceId: mediaPrefs.microphoneId,
          });
          await room.localParticipant.setCameraEnabled(true, {
            deviceId: mediaPrefs.cameraId,
          });
          setMicEnabled(room.localParticipant.isMicrophoneEnabled);
          setCamEnabled(room.localParticipant.isCameraEnabled);
          attachLocal();
        } else {
          attachRemoteTeacher();
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to connect video";
          setError(msg);
        }
      });

    return () => {
      cancelled = true;
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
  }, [
    enabled,
    tokenPayload?.token,
    tokenPayload?.url,
    tokenPayload?.canPublish,
    attachLocal,
    attachRemoteTeacher,
  ]);

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
