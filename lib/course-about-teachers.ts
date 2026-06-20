export type AboutTeacher = {
  name: string;
  imageUrl: string;
  bio: string;
};

export const MULTI_TEACHER_NARROW_BREAKPOINT = 768;
export const MULTI_TEACHER_GAP = 12;
export const MULTI_TEACHER_H_PADDING = 40;

export function parseCourseAboutMeta(value: unknown): { features: string[]; teachers: AboutTeacher[] } {
  const raw = typeof value === "string"
    ? (() => { try { return JSON.parse(value); } catch { return value; } })()
    : value;

  const normalizeTeacher = (t: unknown): AboutTeacher => ({
    name: String((t as any)?.name || "").trim(),
    imageUrl: String((t as any)?.imageUrl || (t as any)?.image_url || "").trim(),
    bio: String((t as any)?.bio || (t as any)?.description || "").trim(),
  });

  if (Array.isArray(raw)) {
    return {
      features: [],
      teachers: raw.map(normalizeTeacher).filter((t) => t.name || t.imageUrl || t.bio),
    };
  }
  if (raw && typeof raw === "object") {
    const features = Array.isArray((raw as any).features)
      ? (raw as any).features.map((f: unknown) => String(f || "").trim()).filter(Boolean)
      : [];
    const teachers = Array.isArray((raw as any).teachers)
      ? (raw as any).teachers.map(normalizeTeacher).filter((t: AboutTeacher) => t.name || t.imageUrl || t.bio)
      : [];
    return { features, teachers };
  }
  return { features: [], teachers: [] };
}

export function resolveCourseTeachers(
  teacherDetailsJson: unknown,
  legacy?: { teacher_name?: string | null; teacher_image_url?: string | null; teacher_bio?: string | null },
): AboutTeacher[] {
  const meta = parseCourseAboutMeta(teacherDetailsJson);
  if (meta.teachers.length > 0) return meta.teachers;
  const name = String(legacy?.teacher_name || "").trim();
  const imageUrl = String(legacy?.teacher_image_url || "").trim();
  const bio = String(legacy?.teacher_bio || "").trim();
  if (!name && !imageUrl && !bio) return [];
  return [{ name, imageUrl, bio }];
}

/** ~2 teacher cards visible in horizontal scroll on narrow screens. */
export function multiTeacherScrollCardWidth(viewportWidth: number): number {
  return Math.max(160, (viewportWidth - MULTI_TEACHER_H_PADDING - MULTI_TEACHER_GAP) / 2);
}

export function isMultiTeacherNarrowLayout(viewportWidth: number): boolean {
  return viewportWidth < MULTI_TEACHER_NARROW_BREAKPOINT;
}
