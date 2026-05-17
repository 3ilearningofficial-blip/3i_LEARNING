/**
 * tldraw license for production HTTPS. Must be set at build time on Vercel as
 * EXPO_PUBLIC_TLDRAW_LICENSE_KEY (Expo only inlines EXPO_PUBLIC_* into the web bundle).
 *
 * Get a key: https://tldraw.dev/get-a-license/trial
 * Allowed hosts must include your Vercel domain(s), e.g. *.vercel.app and 3ilearning.in
 */
export function getTldrawLicenseKey(): string {
  const candidates = [
    process.env.EXPO_PUBLIC_TLDRAW_LICENSE_KEY,
    process.env.NEXT_PUBLIC_TLDRAW_LICENSE_KEY,
    process.env.TLDRAW_LICENSE_KEY,
    process.env.REACT_APP_TLDRAW_LICENSE_KEY,
    process.env.VITE_TLDRAW_LICENSE_KEY,
    process.env.PUBLIC_TLDRAW_LICENSE_KEY,
  ];
  for (const raw of candidates) {
    const key = String(raw || "").trim();
    if (key && key !== "undefined" && key !== "null") return key;
  }
  return "";
}

/** Keys from other services accidentally pasted into TLDRAW_LICENSE_KEY. */
export function isLikelyWrongLicenseKey(key: string): boolean {
  if (!key) return false;
  const lower = key.toLowerCase();
  if (lower.startsWith("rzp_live_") || lower.startsWith("rzp_test_")) return true;
  if (lower.startsWith("sk-proj-") || lower.startsWith("sk-proj_")) return true;
  if (lower.startsWith("cfut_")) return true;
  if (lower.includes("api.3ilearning") || lower.includes("postgresql://")) return true;
  // Stripe secrets — not tldraw (tldraw keys are long JWT-like strings from tldraw.dev)
  if (lower.startsWith("sk_live_") && !lower.includes(".") && key.length < 80) return true;
  return key.length < 24;
}

export function tldrawLicenseHint(key: string): string | null {
  if (!key) {
    return "Add EXPO_PUBLIC_TLDRAW_LICENSE_KEY on Vercel (Production + Preview), then redeploy. Local: add the same line to .env and restart expo.";
  }
  if (isLikelyWrongLicenseKey(key)) {
    return "This value does not look like a tldraw license key from tldraw.dev. Do not use Razorpay, OpenAI, or Stripe keys. Request a trial key at tldraw.dev/get-a-license/trial.";
  }
  return null;
}
