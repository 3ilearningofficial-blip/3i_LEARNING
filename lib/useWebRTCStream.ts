import { useState, useCallback, useRef, useEffect } from "react";
import { Platform } from "react-native";

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

export function useWebRTCStream(): UseWebRTCStreamReturn {
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

  const isWeb = Platform.OS === "web";

  const enumerateDevices = useCallback(async () => {
    if (!isWeb || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const cameras = allDevices.filter((d) => d.kind === "videoinput");
      const microphones = allDevices.filter((d) => d.kind === "audioinput");
      setDevices({ cameras, microphones });

      if (cameras.length > 0 && !selectedCamera) {
        setSelectedCameraState(cameras[0].deviceId);
      }
      if (microphones.length > 0 && !selectedMicrophone) {
        setSelectedMicrophoneState(microphones[0].deviceId);
      }
    } catch {
      // silently fail — devices will be empty
    }
  }, [isWeb, selectedCamera, selectedMicrophone]);

  const startStream = useCallback(
    async (cameraId?: string, micId?: string) => {
      if (!isWeb) {
        setError("WebRTC is only supported on web browsers.");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(
          "Your browser does not support camera access. Please use Chrome, Firefox, or Edge."
        );
        return;
      }

      // Stop existing stream tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      try {
        const constraints: MediaStreamConstraints = {
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: micId ? { deviceId: { exact: micId } } : true,
        };
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = newStream;
        setStream(newStream);
        setIsVideoEnabled(true);
        setIsAudioEnabled(true);
        setError(null);

        // Re-enumerate after permission grant (labels become available)
        await enumerateDevices();
      } catch (err: any) {
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          setError(
            "Camera/microphone permission denied. Please allow access in your browser settings and reload."
          );
        } else if (err?.name === "NotFoundError") {
          setError(
            "No camera or microphone found. Please connect a device and try again."
          );
        } else {
          setError(`Failed to access camera/microphone: ${err?.message || "Unknown error"}`);
        }
      }
    },
    [isWeb, enumerateDevices]
  );

  // Initialize stream and devices on mount (web only)
  useEffect(() => {
    if (isWeb) {
      enumerateDevices();
      startStream();
    }
    return () => {
      // cleanup on unmount
      streamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeb]);

  const setSelectedCamera = useCallback(
    (deviceId: string) => {
      setSelectedCameraState(deviceId);
      startStream(deviceId, selectedMicrophone || undefined);
    },
    [startStream, selectedMicrophone]
  );

  const setSelectedMicrophone = useCallback(
    (deviceId: string) => {
      setSelectedMicrophoneState(deviceId);
      startStream(selectedCamera || undefined, deviceId);
    },
    [startStream, selectedCamera]
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
        "Your browser does not support screen sharing. Please use Chrome, Firefox, or Edge."
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

      // Listen for the user stopping screen share via browser UI
      displayStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        screenStreamRef.current = null;
        setScreenStream(null);
        setIsScreenSharing(false);
      });

      return displayStream;
    } catch (err: any) {
      // User cancelled — not an error
      if (err?.name === "AbortError" || err?.name === "NotAllowedError") {
        throw err; // let caller handle cancellation
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
