import { useState, useCallback, useRef } from "react";

export interface UseMediaRecorderReturn {
  isRecording: boolean;
  startRecording: (stream: MediaStream) => void;
  stopRecording: () => Promise<Blob>;
  error: string | null;
}

export function useMediaRecorder(): UseMediaRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null);

  const startRecording = useCallback((stream: MediaStream) => {
    if (typeof MediaRecorder === "undefined") {
      setError(
        "MediaRecorder is not supported in your browser. Recording is unavailable."
      );
      return;
    }

    // Determine supported mime type
    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")) {
      mimeType = "video/webm;codecs=vp9,opus";
    } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")) {
      mimeType = "video/webm;codecs=vp8,opus";
    } else if (!MediaRecorder.isTypeSupported("video/webm")) {
      setError("Your browser does not support WebM recording.");
      return;
    }

    try {
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        if (stopResolveRef.current) {
          stopResolveRef.current(blob);
          stopResolveRef.current = null;
        }
      };

      recorder.onerror = () => {
        setError("Recording failed unexpectedly.");
        setIsRecording(false);
      };

      recorderRef.current = recorder;
      recorder.start(1000); // collect chunks every second
      setIsRecording(true);
      setError(null);
    } catch (err: any) {
      setError(`Failed to start recording: ${err?.message || "Unknown error"}`);
    }
  }, []);

  const stopRecording = useCallback((): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state === "inactive") {
        reject(new Error("No active recording to stop."));
        return;
      }

      stopResolveRef.current = resolve;
      recorder.stop();
      setIsRecording(false);
      recorderRef.current = null;
    });
  }, []);

  return {
    isRecording,
    startRecording,
    stopRecording,
    error,
  };
}
