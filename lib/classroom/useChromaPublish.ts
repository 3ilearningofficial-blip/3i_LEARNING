import type { Room } from "livekit-client";
import { Track } from "livekit-client";

type LocalPublisher = {
  publishTrack(
    track: MediaStreamTrack,
    options?: { source?: Track.Source; simulcast?: boolean }
  ): Promise<unknown>;
  unpublishTrack(track: MediaStreamTrack, stopOnUnpublish?: boolean): Promise<unknown>;
};
import { drawVideoWithChromaKey } from "./chromaKey";

export type ChromaPublishCleanup = () => void;

/** Publish a chroma-keyed camera track (physical green screen) to LiveKit. */
export async function startChromaCameraPublish(
  room: Room,
  cameraId: string | undefined,
  previewEl: HTMLVideoElement | null
): Promise<ChromaPublishCleanup> {
  const rawStream = await navigator.mediaDevices.getUserMedia({
    video: cameraId ? { deviceId: { exact: cameraId } } : true,
    audio: false,
  });

  const sourceVideo = document.createElement("video");
  sourceVideo.srcObject = rawStream;
  sourceVideo.muted = true;
  sourceVideo.playsInline = true;
  await sourceVideo.play();

  const canvas = document.createElement("canvas");
  // willReadFrequently: chroma keying calls getImageData every frame.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not supported");

  const outputStream = canvas.captureStream(30);
  const outputTrack = outputStream.getVideoTracks()[0];
  if (!outputTrack) throw new Error("Could not create chroma video track");

  if (previewEl) {
    previewEl.srcObject = outputStream;
    void previewEl.play().catch(() => {});
  }

  let raf = 0;
  const paint = () => {
    drawVideoWithChromaKey(sourceVideo, canvas, ctx);
    raf = requestAnimationFrame(paint);
  };
  paint();

  const localParticipant = room.localParticipant as unknown as LocalPublisher;
  await localParticipant.publishTrack(outputTrack, {
    source: Track.Source.Camera,
    simulcast: true,
  });

  return () => {
    cancelAnimationFrame(raf);
    outputTrack.stop();
    rawStream.getTracks().forEach((t) => t.stop());
    void localParticipant.unpublishTrack(outputTrack, true);
    if (previewEl) previewEl.srcObject = null;
  };
}
