export const WELCOME_BANNER_SETTINGS_KEY = "welcome_banner_images_json";
export const MAX_WELCOME_BANNERS = 10;

export function parseWelcomeBannerUrls(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, MAX_WELCOME_BANNERS);
  } catch {
    return [];
  }
}

export function serializeWelcomeBannerUrls(urls: string[]): string {
  const cleaned = urls
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, MAX_WELCOME_BANNERS);
  return JSON.stringify(cleaned);
}

export function validateWelcomeBannerJsonForSave(settings: Record<string, string>): string | null {
  const raw = settings[WELCOME_BANNER_SETTINGS_KEY];
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return "Banner images must be a JSON array of URL strings.";
    if (parsed.length > MAX_WELCOME_BANNERS) {
      return `Maximum ${MAX_WELCOME_BANNERS} banner images allowed.`;
    }
    for (const item of parsed) {
      if (typeof item !== "string") return "Each banner entry must be a URL string.";
    }
  } catch {
    return "Banner images JSON is invalid.";
  }
  return null;
}
