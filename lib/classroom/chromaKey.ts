/** Simple green-screen chroma key for classroom teacher video (physical green backdrop). */

const GREEN_MIN = 80;
const GREEN_DOMINANCE = 1.35;

export function applyChromaKeyToImageData(data: ImageData): void {
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const isGreen =
      g > GREEN_MIN && g > r * GREEN_DOMINANCE && g > b * GREEN_DOMINANCE;
    if (isGreen) {
      px[i + 3] = 0;
    }
  }
}

export function drawVideoWithChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D
): void {
  if (video.videoWidth === 0) return;
  if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyChromaKeyToImageData(frame);
  ctx.putImageData(frame, 0, 0);
}
