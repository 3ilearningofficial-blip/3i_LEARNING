/** Reliable getUserMedia for classroom setup — handles slow USB cameras (e.g. Insta360). */

export const USB_CAMERA_RELEASE_MS = 500;
export const MEDIA_GUM_TIMEOUT_MS = 25_000;
export const MEDIA_GUM_MAX_ATTEMPTS = 3;
export const MEDIA_GUM_RETRY_DELAY_MS = 700;

export function mediaDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withMediaTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new DOMException(`${label} timed out after ${Math.round(ms / 1000)}s`, "TimeoutError"));
      }, ms);
    }),
  ]);
}

export function buildVideoConstraintAttempts(deviceId?: string): MediaTrackConstraints[] {
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
  };
  if (!deviceId) return [base];
  return [
    { ...base, deviceId: { exact: deviceId } },
    { ...base, deviceId: { ideal: deviceId } },
    base,
  ];
}

export function buildAudioConstraintAttempts(deviceId?: string): MediaTrackConstraints[] {
  if (!deviceId) return [true as MediaTrackConstraints];
  return [
    { deviceId: { exact: deviceId } },
    { deviceId: { ideal: deviceId } },
    true as MediaTrackConstraints,
  ];
}

async function acquireTrack(
  kind: "video" | "audio",
  attempts: MediaTrackConstraints[],
  label: string,
): Promise<MediaStreamTrack> {
  let lastError: unknown = null;
  for (let round = 0; round < MEDIA_GUM_MAX_ATTEMPTS; round++) {
    for (const constraints of attempts) {
      try {
        const constraintsArg: MediaStreamConstraints =
          kind === "video"
            ? { video: constraints, audio: false }
            : { video: false, audio: constraints };
        const stream = await withMediaTimeout(
          navigator.mediaDevices.getUserMedia(constraintsArg),
          MEDIA_GUM_TIMEOUT_MS,
          label,
        );
        const tracks = kind === "video" ? stream.getVideoTracks() : stream.getAudioTracks();
        const track = tracks[0];
        if (!track) {
          stream.getTracks().forEach((t) => t.stop());
          continue;
        }
        stream.getTracks().forEach((t) => {
          if (t !== track) t.stop();
        });
        return track;
      } catch (err) {
        lastError = err;
      }
    }
    if (round < MEDIA_GUM_MAX_ATTEMPTS - 1) {
      await mediaDelay(MEDIA_GUM_RETRY_DELAY_MS * (round + 1));
    }
  }
  throw lastError ?? new Error(`Could not open ${label.toLowerCase()}`);
}

export async function acquireCameraMicrophoneStream(opts?: {
  cameraId?: string;
  microphoneId?: string;
}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported in this browser.");
  }

  const videoTrack = await acquireTrack(
    "video",
    buildVideoConstraintAttempts(opts?.cameraId),
    "Camera",
  );

  let audioTrack: MediaStreamTrack | null = null;
  try {
    audioTrack = await acquireTrack(
      "audio",
      buildAudioConstraintAttempts(opts?.microphoneId),
      "Microphone",
    );
  } catch (err) {
    videoTrack.stop();
    throw err;
  }

  return new MediaStream([videoTrack, audioTrack]);
}

export function formatMediaAccessError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") {
    return "Camera/microphone permission denied. Please allow access in your browser settings and reload.";
  }
  if (e?.name === "NotFoundError" || e?.name === "DevicesNotFoundError") {
    return "No camera or microphone found. Please connect a device and try again.";
  }
  if (e?.name === "NotReadableError" || e?.name === "TrackStartError") {
    return "Camera is in use by another app or still starting. Close other apps using the camera, wait a few seconds, then select it again.";
  }
  if (e?.name === "TimeoutError" || String(e?.message || "").toLowerCase().includes("timeout")) {
    return "Camera is taking too long to start (common with external webcams). Wait a few seconds and select the camera again, or try a different USB port.";
  }
  if (e?.name === "OverconstrainedError") {
    return "Could not open the selected camera with the requested settings. Try another camera from the list.";
  }
  return `Failed to access camera/microphone: ${e?.message || "Unknown error"}`;
}

export function pickDeviceId(
  preferredId: string | undefined,
  devices: MediaDeviceInfo[],
): string | undefined {
  if (!devices.length) return undefined;
  if (preferredId && devices.some((d) => d.deviceId === preferredId)) return preferredId;
  return devices[0]?.deviceId;
}
