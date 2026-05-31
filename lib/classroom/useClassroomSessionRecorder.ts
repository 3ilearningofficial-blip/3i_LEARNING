import { useCallback, useEffect, useMemo, useRef } from "react";
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

type ClassroomReadyStream = MediaStream & { __classroomReady?: Promise<void> };

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
  const isRecordingRef = useRef(false);
  const compositeStreamRef = useRef<MediaStream | null>(null);
  const roomRef = useRef<Room | null>(null);
  const startedRef = useRef(false);
  const startingRef = useRef(false);

  useEffect(() => {
    isRecordingRef.current = recorder.isRecording;
  }, [recorder.isRecording]);

  const startSessionRecording = useCallback(
    (compositeStream: MediaStream | null, room: Room | null) => {
      if (!enabled || startedRef.current || startingRef.current || isRecordingRef.current) return;
      compositeStreamRef.current = compositeStream;
      roomRef.current = room;
      startingRef.current = true;
      const ready = (compositeStream as ClassroomReadyStream | null)?.__classroomReady;
      void (async () => {
        try {
          await ready;
          const stream = buildRecordingStream(compositeStream, room);
          const hasLiveVideo = stream
            ?.getVideoTracks()
            .some((track) => track.readyState === "live");
          if (!stream || !hasLiveVideo || startedRef.current || isRecordingRef.current) return;
          recorder.startRecording(stream);
          startedRef.current = true;
        } finally {
          startingRef.current = false;
        }
      })();
    },
    [enabled, recorder.startRecording]
  );

  const stopAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    if (!isRecordingRef.current && !startedRef.current) return null;
    try {
      return await recorder.stopRecording();
    } finally {
      startedRef.current = false;
      isRecordingRef.current = false;
      compositeStreamRef.current = null;
      roomRef.current = null;
      startingRef.current = false;
    }
  }, [recorder.stopRecording]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (isRecordingRef.current) {
        void recorder.stopRecording();
      }
    };
  }, [enabled, recorder.stopRecording]);

  return useMemo(
    () => ({
      isRecording: recorder.isRecording,
      startSessionRecording,
      stopAndGetBlob,
      error: recorder.error,
    }),
    [recorder.isRecording, startSessionRecording, stopAndGetBlob, recorder.error]
  );
}
