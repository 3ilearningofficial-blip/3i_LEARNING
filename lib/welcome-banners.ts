export const WELCOME_BANNER_SETTINGS_KEY = "welcome_banner_images_json";
export const MAX_WELCOME_BANNERS = 10;

export type WelcomeBannerSlideUrls = {
  mobile: string;
  desktop: string;
};

const EMPTY_SLIDE: WelcomeBannerSlideUrls = { mobile: "", desktop: "" };

function normalizeSlide(item: unknown): WelcomeBannerSlideUrls | null {
  if (typeof item === "string") {
    const url = item.trim();
    if (!url) return null;
    return { mobile: url, desktop: url };
  }
  if (item && typeof item === "object") {
    const row = item as Record<string, unknown>;
    const mobile = String(row.mobile ?? "").trim();
    const desktop = String(row.desktop ?? "").trim();
    if (!mobile && !desktop) return null;
    return { mobile, desktop };
  }
  return null;
}

/** Parse carousel slides (mobile + desktop URLs per slide). Legacy string[] → both fields set. */
export function parseWelcomeBannerSlides(raw: string | undefined | null): WelcomeBannerSlideUrls[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeSlide)
      .filter((s): s is WelcomeBannerSlideUrls => s != null)
      .slice(0, MAX_WELCOME_BANNERS);
  } catch {
    return [];
  }
}

export function serializeWelcomeBannerSlides(slides: WelcomeBannerSlideUrls[]): string {
  const cleaned = slides
    .map((s) => ({
      mobile: String(s.mobile || "").trim(),
      desktop: String(s.desktop || "").trim(),
    }))
    .filter((s) => s.mobile || s.desktop)
    .slice(0, MAX_WELCOME_BANNERS);
  return JSON.stringify(cleaned);
}

/** @deprecated Use parseWelcomeBannerSlides — returns resolved URL per slide (mobile preferred). */
export function parseWelcomeBannerUrls(raw: string | undefined | null): string[] {
  return parseWelcomeBannerSlides(raw)
    .map((s) => s.mobile || s.desktop)
    .filter(Boolean);
}

/** @deprecated Use serializeWelcomeBannerSlides */
export function serializeWelcomeBannerUrls(urls: string[]): string {
  return serializeWelcomeBannerSlides(
    urls.map((u) => {
      const url = String(u || "").trim();
      return { mobile: url, desktop: url };
    }),
  );
}

export function isWelcomeBannerSlideEmpty(slide: WelcomeBannerSlideUrls): boolean {
  return !slide.mobile.trim() && !slide.desktop.trim();
}

export function welcomeBannerSlideHasContent(slides: WelcomeBannerSlideUrls[]): boolean {
  return slides.some((s) => !isWelcomeBannerSlideEmpty(s));
}

export function validateWelcomeBannerJsonForSave(settings: Record<string, string>): string | null {
  const raw = settings[WELCOME_BANNER_SETTINGS_KEY];
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "Banner images must be a JSON array.";
    if (parsed.length > MAX_WELCOME_BANNERS) {
      return `Maximum ${MAX_WELCOME_BANNERS} banner images allowed.`;
    }
    for (const item of parsed) {
      if (typeof item === "string") continue;
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        if (row.mobile != null && typeof row.mobile !== "string") {
          return "Each banner mobile URL must be a string.";
        }
        if (row.desktop != null && typeof row.desktop !== "string") {
          return "Each banner desktop URL must be a string.";
        }
        continue;
      }
      return "Each banner entry must be a URL string or { mobile, desktop } object.";
    }
  } catch {
    return "Banner images JSON is invalid.";
  }
  return null;
}
