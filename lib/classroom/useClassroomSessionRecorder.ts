import { useCallback, useEffect, useRef } from "react";
import { useMediaRecorder } from "@/lib/useMediaRecorder";
import type { Room } from "livekit-client";
import { Track } from "livekit-client";

export type ClassroomSessionRecorder = {
  isRecording: boolean;
  startSessionRecording: (
    compositeStream: MediaStream | null,
    room: Room | null
  ) => void;
  stopAndGetBlob: () => Promise<Blob | null>;
  error: string | null;
};

function getPublicationMediaTrack(
  room: Room | null,
  source: Track.Source.Microphone
): MediaStreamTrack | null {
  if (!room) return null;
  const pub = room.localParticipant.getTrackPublication(source) as
    | { track?: { mediaStreamTrack?: MediaStreamTrack } }
    | undefined;
  return pub?.track?.mediaStreamTrack ?? null;
}

function buildRecordingStream(compositeStream: MediaStream | null, room: Room | null): MediaStream | null {
  const tracks: MediaStreamTrack[] = [];

  const mic = getPublicationMediaTrack(room, Track.Source.Microphone);
  if (mic) tracks.push(mic);

  const videoTrack = compositeStream?.getVideoTracks()[0] ?? null;
  if (videoTrack) tracks.unshift(videoTrack);

  if (tracks.length === 0) return null;
  return new MediaStream(tracks);
}

export function useClassroomSessionRecorder(enabled: boolean): ClassroomSessionRecorder {
  const recorder = useMediaRecorder();
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const startedRef = useRef(false);

  const startSessionRecording = useCallback(
    (compositeStream: MediaStream | null, room: Room | null) => {
      if (!enabled || startedRef.current || recorder.isRecording) return;
      compositeStreamRef.current = compositeStream;
      roomRef.current = room;
      const stream = buildRecordingStream(compositeStream, room);
      if (!stream) return;
      recorder.startRecording(stream);
      startedRef.current = true;
    },
    [enabled, recorder]
  );

  const stopAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    if (!recorder.isRecording && !startedRef.current) return null;
    try {
      return await recorder.stopRecording();
    } finally {
      startedRef.current = false;
      compositeStreamRef.current = null;
      roomRef.current = null;
    }
  }, [recorder]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (recorder.isRecording) {
        void recorder.stopRecording();
      }
    };
  }, [enabled, recorder]);

  return {
    isRecording: recorder.isRecording,
    startSessionRecording,
    stopAndGetBlob,
    error: recorder.error,
  };
}
