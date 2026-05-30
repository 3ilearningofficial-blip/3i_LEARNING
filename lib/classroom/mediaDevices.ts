const STORAGE_KEY = "classroom_media_devices";

/** Corner where the teacher PiP sits over the board (student view + recording). */
export type ClassroomPipPosition = "top-right" | "bottom-right";

export const DEFAULT_PIP_POSITION: ClassroomPipPosition = "top-right";

export function normalizePipPosition(value: unknown): ClassroomPipPosition {
  return value === "bottom-right" ? "bottom-right" : DEFAULT_PIP_POSITION;
}

export type ClassroomMediaDevices = {
  cameraId?: string;
  microphoneId?: string;
  greenScreenEnabled?: boolean;
  pipPosition?: ClassroomPipPosition;
};

export function saveClassroomMediaDevices(devices: ClassroomMediaDevices): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  } catch {
    /* ignore quota */
  }
}

export function loadClassroomMediaDevices(): ClassroomMediaDevices {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ClassroomMediaDevices;
  } catch {
    return {};
  }
}
