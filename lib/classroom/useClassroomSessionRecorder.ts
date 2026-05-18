import { useCallback, useEffect, useRef } from "react";
import { useMediaRecorder } from "@/lib/useMediaRecorder";
import type { Room } from "livekit-client";
import { Track } from "livekit-client";

export type ClassroomSessionRecorder = {
  isRecording: boolean;
  startSessionRecording: (boardEl: HTMLElement | null, room: Room | null) => void;
  stopAndGetBlob: () => Promise<Blob | null>;
  error: string | null;
};

function getPublicationMediaTrack(
  room: Room | null,
  source: Track.Source.Camera | Track.Source.Microphone
): MediaStreamTrack | null {
  if (!room) return null;
  const pub = room.localParticipant.getTrackPublication(source) as
    | { track?: { mediaStreamTrack?: MediaStreamTrack } }
    | undefined;
  return pub?.track?.mediaStreamTrack ?? null;
}

function getLocalMicTrack(room: Room | null): MediaStreamTrack | null {
  return getPublicationMediaTrack(room, Track.Source.Microphone);
}

function getLocalCameraTrack(room: Room | null): MediaStreamTrack | null {
  return getPublicationMediaTrack(room, Track.Source.Camera);
}

function buildRecordingStream(boardEl: HTMLElement | null, room: Room | null): MediaStream | null {
  const tracks: MediaStreamTrack[] = [];

  const mic = getLocalMicTrack(room);
  if (mic) tracks.push(mic);

  let videoTrack: MediaStreamTrack | null = null;
  if (boardEl && typeof (boardEl as HTMLElement & { captureStream?: (fps?: number) => MediaStream }).captureStream === "function") {
    try {
      const boardStream = (boardEl as HTMLElement & { captureStream: (fps?: number) => MediaStream }).captureStream(5);
      const vt = boardStream.getVideoTracks()[0];
      if (vt) videoTrack = vt;
    } catch {
      /* captureStream unsupported */
    }
  }

  if (!videoTrack) {
    videoTrack = getLocalCameraTrack(room);
  }

  if (videoTrack) tracks.unshift(videoTrack);

  if (tracks.length === 0) return null;
  return new MediaStream(tracks);
}

export function useClassroomSessionRecorder(enabled: boolean): ClassroomSessionRecorder {
  const recorder = useMediaRecorder();
  const boardElRef = useRef<HTMLElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const startedRef = useRef(false);

  const startSessionRecording = useCallback(
    (boardEl: HTMLElement | null, room: Room | null) => {
      if (!enabled || startedRef.current || recorder.isRecording) return;
      boardElRef.current = boardEl;
      roomRef.current = room;
      const stream = buildRecordingStream(boardEl, room);
      if (!stream) return;
      recorder.startRecording(stream);
      startedRef.current = true;
    },
    [enabled, recorder]
  );

  const stopAndGetBlob = useCallback(async (): Promise<Blob | null> => {
    if (!recorder.isRecording && !startedRef.current) return null;
    try {
      if (recorder.isRecording) {
        const blob = await recorder.stopRecording();
        startedRef.current = false;
        boardElRef.current = null;
        roomRef.current = null;
        return blob;
      }
    } catch {
      /* no active recording */
    }
    startedRef.current = false;
    return null;
  }, [recorder]);

  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (recorder.isRecording) {
        recorder.stopRecording().catch(() => {});
      }
      startedRef.current = false;
    };
  }, [enabled, recorder]);

  return {
    isRecording: recorder.isRecording,
    startSessionRecording,
    stopAndGetBlob,
    error: recorder.error,
  };
}
