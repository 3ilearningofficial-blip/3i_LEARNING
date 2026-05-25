/**
 * firebase-phone-utils.ts
 * Firebase Identity Toolkit helpers for phone-number verification.
 * Extracted from server/routes.ts (Phase 2 refactor — T-05).
 *
 * These functions call Firebase's REST API directly (not via the Admin SDK)
 * to initiate and verify phone number OTP flows — used when students choose
 * "Login with phone via Firebase" on the web platform.
 *
 * Note: The Admin SDK (server/firebase.ts) is used for token verification;
 * these helpers are specifically for the phone-verification REST flow.
 */

/**
 * Ask Firebase to send a phone verification SMS to the given number.
 * Returns the sessionInfo token needed for the verification step, or null on failure.
 */
export async function sendFirebasePhoneVerification(
  phone: string
): Promise<{ sessionInfo: string } | null> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) {
    console.error("[Firebase Phone] No FIREBASE_API_KEY set");
    return null;
  }
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: `+91${phone}`,
          recaptchaToken: "FIREBASE_ADMIN_BYPASS",
        }),
      }
    );
    const data = await res.json();
    if (data.sessionInfo) {
      console.log("[Firebase Phone] Verification sent");
      return { sessionInfo: data.sessionInfo };
    }
    console.error("[Firebase Phone] Failed:", data?.error?.message || "provider_error");
    return null;
  } catch (err) {
    console.error("[Firebase Phone] Error:", err);
    return null;
  }
}

/**
 * Verify a phone OTP code against a Firebase sessionInfo token.
 * Returns the idToken and phoneNumber on success, or null on failure.
 */
export async function verifyFirebasePhoneCode(
  sessionInfo: string,
  code: string
): Promise<{ idToken: string; phoneNumber: string } | null> {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionInfo, code }),
      }
    );
    const data = await res.json();
    if (data.idToken) {
      return { idToken: data.idToken, phoneNumber: data.phoneNumber || "" };
    }
    console.error("[Firebase Phone] Verify failed:", JSON.stringify(data.error || data));
    return null;
  } catch (err) {
    console.error("[Firebase Phone] Verify error:", err);
    return null;
  }
}
