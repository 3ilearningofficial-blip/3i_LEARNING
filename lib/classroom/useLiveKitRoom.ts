import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, Track } from "livekit-client";
import type { ClassroomTokenPayload } from "./useClassroomToken";
import { loadClassroomMediaDevices } from "./mediaDevices";
import {
  startClassroomCompositeStream,
  type ClassroomCompositeHandle,
} from "./classroomCompositeStream";

type LocalPublisher = {
  publishTrack(
    track: MediaStreamTrack,
    options?: { source?: Track.Source; simulcast?: boolean }
  ): Promise<unknown>;
  unpublishTrack(track: MediaStreamTrack, stopOnUnpublish?: boolean): Promise<unknown>;
};

export function useLiveKitRoom(
  tokenPayload: ClassroomTokenPayload | undefined,
  enabled: boolean,
  /** When set, teacher publishes board+camera composite instead of raw camera. */
  boardEl: HTMLElement | null = null
) {
  const roomRef = useRef<Room | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const connectGenRef = useRef(0);
  const compositeRef = useRef<ClassroomCompositeHandle | null>(null);
  const publishedCompositeTrackRef = useRef<MediaStreamTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [compositeStream, setCompositeStream] = useState<MediaStream | null>(null);

  const attachLocalCompositePreview = useCallback(() => {
    const handle = compositeRef.current;
    const el = localVideoRef.current;
    if (!handle || !el) return;
    el.srcObject = handle.previewEl.srcObject;
    void el.play().catch(() => {});
  }, []);

  const attachRemoteTeacher = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    for (const participant of room.remoteParticipants.values()) {
      const camPub = participant.getTrackPublication(Track.Source.Camera);
      const camTrack = camPub?.videoTrack;
      if (camTrack && remoteVideoRef.current) {
        camTrack.attach(remoteVideoRef.current);
      }
      const micPub = participant.getTrackPublication(Track.Source.Microphone);
      const micTrack = micPub?.audioTrack;
      if (micTrack && remoteAudioRef.current) {
        micTrack.attach(remoteAudioRef.current);
      } else if (micTrack && remoteVideoRef.current) {
        micTrack.attach(remoteVideoRef.current);
      }
      if (camTrack || micTrack) return;
    }
  }, []);

  const stopComposite = useCallback(() => {
    compositeRef.current?.stop();
    compositeRef.current = null;
    publishedCompositeTrackRef.current = null;
    setCompositeStream(null);
  }, []);

  const startCompositePublish = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !boardEl || !tokenPayload?.canPublish) return;

    const prefs = loadClassroomMediaDevices();
    stopComposite();

    try {
      await room.localParticipant.setCameraEnabled(false);

      const handle = await startClassroomCompositeStream({
        boardEl,
        cameraId: prefs.cameraId,
        greenScreen: prefs.greenScreenEnabled,
      });
      compositeRef.current = handle;
      setCompositeStream(handle.stream);

      const videoTrack = handle.stream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No composite video track");

      const localParticipant = room.localParticipant as unknown as LocalPublisher;
      await localParticipant.publishTrack(videoTrack, {
        source: Track.Source.Camera,
        simulcast: true,
      });
      publishedCompositeTrackRef.current = videoTrack;
      setCamEnabled(true);
      attachLocalCompositePreview();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start composite stream");
      setCamEnabled(false);
    }
  }, [boardEl, tokenPayload?.canPublish, stopComposite, attachLocalCompositePreview]);

  const setLocalVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      localVideoRef.current = el;
      if (el && compositeRef.current) attachLocalCompositePreview();
    },
    [attachLocalCompositePreview]
  );

  const setRemoteVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      remoteVideoRef.current = el;
      if (el && roomRef.current) attachRemoteTeacher();
    },
    [attachRemoteTeacher]
  );

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
    if (compositeRef.current) return;
    void startCompositePublish();
  }, [connected, boardEl, tokenPayload?.canPublish, startCompositePublish]);

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
    if (boardEl && compositeRef.current) {
      if (next) {
        await startCompositePublish();
      } else {
        const track = publishedCompositeTrackRef.current;
        if (track) {
          const localParticipant = room.localParticipant as unknown as LocalPublisher;
          await localParticipant.unpublishTrack(track, true);
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
    setRemoteAudioEl,
    toggleMic,
    toggleCam,
    room: roomRef,
  };
}
