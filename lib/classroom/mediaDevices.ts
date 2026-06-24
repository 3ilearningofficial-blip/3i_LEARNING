const STORAGE_KEY = "classroom_media_devices";

/** Corner where the teacher PiP sits over the board (student view + recording). */
export type ClassroomPipPosition = "top-right" | "bottom-right" | "top-left" | "bottom-left";

export const DEFAULT_PIP_POSITION: ClassroomPipPosition = "bottom-left";

export {
  normalizePipPosition,
  parseClassroomTeacherStreamMeta,
  serializeClassroomTeacherStreamMeta,
  type ClassroomTeacherStreamMeta,
} from "../../shared/classroomPipPosition";

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
