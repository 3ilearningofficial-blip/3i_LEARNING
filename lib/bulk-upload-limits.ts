export const MAX_FILES_PER_BATCH = 50;
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MAX_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_DOC_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024 * 1024;
export const UPLOAD_CONCURRENCY = 2;

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export const BULK_LIMITS_FOOTER =
  `Up to ${MAX_FILES_PER_BATCH} files · Max ${formatBytes(MAX_VIDEO_BYTES)} per video · Max ${formatBytes(MAX_PDF_BYTES)} per PDF · Max ${formatBytes(MAX_BATCH_BYTES)} total per batch`;
