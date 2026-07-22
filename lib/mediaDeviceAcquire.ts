/** Reliable getUserMedia for classroom setup — handles slow USB cameras (e.g. Insta360). */

export const USB_CAMERA_RELEASE_MS = 500;
/** Per-attempt budget. Prefer failing fast over waiting 25s on a hung Blink open. */
export const MEDIA_GUM_TIMEOUT_MS = 4_000;
export const MEDIA_GUM_MAX_ATTEMPTS = 2;
export const MEDIA_GUM_RETRY_DELAY_MS = 350;

export function mediaDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Race getUserMedia against a timeout. If GUM resolves after the timeout, stop
 * its tracks so a zombie exclusive hold does not block later attempts.
 */
export function withMediaTimeout<T extends MediaStream>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let settled = false;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new DOMException(`${label} timed out after ${Math.round(ms / 1000)}s`, "TimeoutError"));
    }, ms);

    promise
      .then((stream) => {
        if (settled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(stream);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function buildVideoConstraintAttempts(deviceId?: string): MediaTrackConstraints[] {
  // Fast path first: deviceId only (no 1280×720 ideals — those slow UVC init).
  // Put heavier / exact constraints last; Blink often hangs ~10s on exact+high ideals.
  if (!deviceId) {
    return [
      { facingMode: "user" },
      { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } },
    ];
  }
  return [
    { deviceId: { ideal: deviceId } },
    {
      deviceId: { ideal: deviceId },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 60 },
    },
    { deviceId: { exact: deviceId } },
  ];
}

/** Per-attempt constraint passed to getUserMedia for one track kind. */
export type MediaTrackConstraintAttempt = boolean | MediaTrackConstraints;

export function buildAudioConstraintAttempts(deviceId?: string): MediaTrackConstraintAttempt[] {
  if (!deviceId) return [true];
  return [
    { deviceId: { ideal: deviceId } },
    { deviceId: { exact: deviceId } },
    true,
  ];
}

function isRetryableMediaError(err: unknown): boolean {
  const name = String((err as { name?: string })?.name || "");
  return (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "TimeoutError" ||
    name === "OverconstrainedError"
  );
}

async function acquireTrack(
  kind: "video" | "audio",
  attempts: MediaTrackConstraintAttempt[],
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
        // Permission / missing device: don't burn more attempts.
        const name = String((err as { name?: string })?.name || "");
        if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "NotFoundError") {
          throw err;
        }
        if (!isRetryableMediaError(err)) {
          throw err;
        }
      }
    }
    if (round < MEDIA_GUM_MAX_ATTEMPTS - 1) {
      await mediaDelay(MEDIA_GUM_RETRY_DELAY_MS * (round + 1));
    }
  }
  throw lastError ?? new Error(`Could not open ${label.toLowerCase()}`);
}

/** Video-only acquire with ideal→fallback ladder and short timeouts (classroom composite). */
export async function acquireVideoOnlyStream(cameraId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported in this browser.");
  }
  const videoTrack = await acquireTrack(
    "video",
    buildVideoConstraintAttempts(cameraId),
    "Camera",
  );
  return new MediaStream([videoTrack]);
}

export async function acquireCameraMicrophoneStream(opts?: {
  cameraId?: string;
  microphoneId?: string;
}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera access is not supported in this browser.");
  }

  // Open A/V in parallel — serial open roughly doubles setup "Starting camera…" time.
  const [videoResult, audioResult] = await Promise.allSettled([
    acquireTrack("video", buildVideoConstraintAttempts(opts?.cameraId), "Camera"),
    acquireTrack("audio", buildAudioConstraintAttempts(opts?.microphoneId), "Microphone"),
  ]);

  if (videoResult.status === "rejected") {
    if (audioResult.status === "fulfilled") audioResult.value.stop();
    throw videoResult.reason;
  }
  if (audioResult.status === "rejected") {
    videoResult.value.stop();
    throw audioResult.reason;
  }

  return new MediaStream([videoResult.value, audioResult.value]);
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
