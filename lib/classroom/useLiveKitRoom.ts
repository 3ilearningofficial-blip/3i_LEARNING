import { useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ClassroomTokenPayload } from "./useClassroomToken";

export function useLiveKitRoom(
  tokenPayload: ClassroomTokenPayload | undefined,
  enabled: boolean
) {
  const roomRef = useRef<Room | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [localVideoEl, setLocalVideoEl] = useState<HTMLVideoElement | null>(null);
  const [remoteVideoEl, setRemoteVideoEl] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!enabled || !tokenPayload?.token || !tokenPayload.url) return;

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    let cancelled = false;

    const attachLocal = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const track = pub?.videoTrack;
      if (track && localVideoEl) track.attach(localVideoEl);
    };

    const attachRemoteTeacher = () => {
      for (const participant of room.remoteParticipants.values()) {
        const pub = participant.getTrackPublication(Track.Source.Camera);
        const track = pub?.videoTrack;
        if (track && remoteVideoEl) {
          track.attach(remoteVideoEl);
          return;
        }
      }
    };

    room.on(RoomEvent.TrackSubscribed, () => {
      attachRemoteTeacher();
    });
    room.on(RoomEvent.LocalTrackPublished, () => {
      attachLocal();
    });

    void room
      .connect(tokenPayload.url, tokenPayload.token)
      .then(async () => {
        if (cancelled) return;
        setConnected(true);
        if (tokenPayload.canPublish) {
          await room.localParticipant.setCameraEnabled(true);
          await room.localParticipant.setMicrophoneEnabled(true);
          attachLocal();
        } else {
          attachRemoteTeacher();
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to connect video");
      });

    return () => {
      cancelled = true;
      void room.disconnect();
      roomRef.current = null;
      setConnected(false);
    };
  }, [enabled, tokenPayload?.token, tokenPayload?.url, tokenPayload?.canPublish, localVideoEl, remoteVideoEl]);

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabledMic = room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(!enabledMic);
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabledCam = room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(!enabledCam);
  };

  return {
    error,
    connected,
    setLocalVideoEl,
    setRemoteVideoEl,
    toggleMic,
    toggleCam,
    room: roomRef,
  };
}
