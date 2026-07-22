import { useState, useCallback, useRef, useEffect } from "react";
import { Platform } from "react-native";
import { loadClassroomMediaDevices } from "@/lib/classroom/mediaDevices";
import {
  acquireCameraMicrophoneStream,
  formatMediaAccessError,
  mediaDelay,
  pickDeviceId,
  USB_CAMERA_RELEASE_MS,
} from "@/lib/mediaDeviceAcquire";

export interface UseWebRTCStreamReturn {
  stream: MediaStream | null;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  devices: { cameras: MediaDeviceInfo[]; microphones: MediaDeviceInfo[] };
  selectedCamera: string;
  selectedMicrophone: string;
  setSelectedCamera: (deviceId: string) => void;
  setSelectedMicrophone: (deviceId: string) => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  startScreenShare: () => Promise<MediaStream>;
  stopScreenShare: () => void;
  isScreenSharing: boolean;
  screenStream: MediaStream | null;
  error: string | null;
  cleanup: () => void;
}

export function useWebRTCStream(enabled = true): UseWebRTCStreamReturn {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [devices, setDevices] = useState<{
    cameras: MediaDeviceInfo[];
    microphones: MediaDeviceInfo[];
  }>({ cameras: [], microphones: [] });
  const [selectedCamera, setSelectedCameraState] = useState("");
  const [selectedMicrophone, setSelectedMicrophoneState] = useState("");
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const selectedCameraRef = useRef("");
  const selectedMicrophoneRef = useRef("");
  const startGenerationRef = useRef(0);

  const isWeb = Platform.OS === "web";

  const releaseCurrentStream = useCallback(async () => {
    const hadTracks = !!streamRef.current?.getTracks().length;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStream(null);
    // Only wait for USB release when we actually stopped tracks.
    if (hadTracks) {
      await mediaDelay(USB_CAMERA_RELEASE_MS);
    }
  }, []);

  const enumerateDevices = useCallback(async () => {
    if (!isWeb || !navigator.mediaDevices?.enumerateDevices) {
      return { cameras: [] as MediaDeviceInfo[], microphones: [] as MediaDeviceInfo[] };
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cameras = allDevices.filter((d) => d.kind === "videoinput");
      const microphones = allDevices.filter((d) => d.kind === "audioinput");
      setDevices({ cameras, microphones });
      return { cameras, microphones };
    } catch {
      return { cameras: [] as MediaDeviceInfo[], microphones: [] as MediaDeviceInfo[] };
    }
  }, [isWeb]);

  const startStream = useCallback(
    async (cameraId?: string, micId?: string) => {
      if (!isWeb) {
        setError("WebRTC is only supported on web browsers.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Your browser does not support camera access. Please use Chrome, Firefox, or Edge.",
        );
        return;
      }

      const generation = ++startGenerationRef.current;
      setError(null);

      try {
        await releaseCurrentStream();
        if (generation !== startGenerationRef.current) return;

        const listed = await enumerateDevices();
        if (generation !== startGenerationRef.current) return;

        const resolvedCamera = pickDeviceId(cameraId || selectedCameraRef.current, listed.cameras);
        const resolvedMic = pickDeviceId(micId || selectedMicrophoneRef.current, listed.microphones);

        if (resolvedCamera) {
          selectedCameraRef.current = resolvedCamera;
          setSelectedCameraState(resolvedCamera);
        }
        if (resolvedMic) {
          selectedMicrophoneRef.current = resolvedMic;
          setSelectedMicrophoneState(resolvedMic);
        }

        const newStream = await acquireCameraMicrophoneStream({
          cameraId: resolvedCamera,
          microphoneId: resolvedMic,
        });
        if (generation !== startGenerationRef.current) {
          newStream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = newStream;
        setStream(newStream);
        setIsVideoEnabled(true);
        setIsAudioEnabled(true);
        setError(null);
        await enumerateDevices();
      } catch (err: unknown) {
        if (generation !== startGenerationRef.current) return;
        setError(formatMediaAccessError(err));
      }
    },
    [isWeb, enumerateDevices, releaseCurrentStream],
  );

  // Initialize stream and devices on mount (web only, when enabled)
  useEffect(() => {
    if (!enabled || !isWeb) return;

    const prefs = loadClassroomMediaDevices();
    if (prefs.cameraId) {
      selectedCameraRef.current = prefs.cameraId;
      setSelectedCameraState(prefs.cameraId);
    }
    if (prefs.microphoneId) {
      selectedMicrophoneRef.current = prefs.microphoneId;
      setSelectedMicrophoneState(prefs.microphoneId);
    }

    void startStream(prefs.cameraId, prefs.microphoneId);

    const onDeviceChange = () => {
      void enumerateDevices();
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isWeb]);

  const setSelectedCamera = useCallback(
    (deviceId: string) => {
      selectedCameraRef.current = deviceId;
      setSelectedCameraState(deviceId);
      void startStream(deviceId, selectedMicrophoneRef.current || undefined);
    },
    [startStream],
  );

  const setSelectedMicrophone = useCallback(
    (deviceId: string) => {
      selectedMicrophoneRef.current = deviceId;
      setSelectedMicrophoneState(deviceId);
      void startStream(selectedCameraRef.current || undefined, deviceId);
    },
    [startStream],
  );

  const toggleVideo = useCallback(() => {
    if (!streamRef.current) return;
    const videoTracks = streamRef.current.getVideoTracks();
    videoTracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsVideoEnabled((prev) => !prev);
  }, []);

  const toggleAudio = useCallback(() => {
    if (!streamRef.current) return;
    const audioTracks = streamRef.current.getAudioTracks();
    audioTracks.forEach((t) => {
      t.enabled = !t.enabled;
    });
    setIsAudioEnabled((prev) => !prev);
  }, []);

  const startScreenShare = useCallback(async (): Promise<MediaStream> => {
    if (!isWeb) {
      throw new Error("Screen sharing is only supported on web browsers.");
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error(
        "Your browser does not support screen sharing. Please use Chrome, Firefox, or Edge.",
      );
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      screenStreamRef.current = displayStream;
      setScreenStream(displayStream);
      setIsScreenSharing(true);
      setError(null);

      displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        screenStreamRef.current = null;
        setScreenStream(null);
        setIsScreenSharing(false);
      });

      return displayStream;
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.name === "NotAllowedError") {
        throw err;
      }
      setError(`Screen share failed: ${err?.message || "Unknown error"}`);
      throw err;
    }
  }, [isWeb]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setScreenStream(null);
    setIsScreenSharing(false);
  }, []);

  const cleanup = useCallback(() => {
    startGenerationRef.current += 1;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    setStream(null);
    setScreenStream(null);
    setIsVideoEnabled(false);
    setIsAudioEnabled(false);
    setIsScreenSharing(false);
    setError(null);
  }, []);

  return {
    stream,
    isVideoEnabled,
    isAudioEnabled,
    devices,
    selectedCamera,
    selectedMicrophone,
    setSelectedCamera,
    setSelectedMicrophone,
    toggleVideo,
    toggleAudio,
    startScreenShare,
    stopScreenShare,
    isScreenSharing,
    screenStream,
    error,
    cleanup,
  };
}
