const STORAGE_KEY = "classroom_media_devices";

export type ClassroomMediaDevices = {
  cameraId?: string;
  microphoneId?: string;
  greenScreenEnabled?: boolean;
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
