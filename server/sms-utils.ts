/**
 * sms-utils.ts
 * SMS delivery utility for OTP messages via Fast2SMS.
 * Extracted from server/routes.ts (Phase 2 refactor — T-04).
 *
 * Two delivery routes are attempted in order:
 *   1. Quick SMS route (POST with message body) — preferred
 *   2. OTP route (GET with variable substitution) — fallback
 *
 * Both have a 15-second timeout to prevent hanging the login flow.
 */

/**
 * Send an OTP code to an Indian phone number via Fast2SMS.
 * Returns true if the SMS was delivered successfully, false otherwise.
 * Failures are logged but never thrown — the caller decides how to handle delivery failure.
 */
export async function sendOTPviaSMS(phone: string, otp: string): Promise<boolean> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) {
    console.log("[SMS] No FAST2SMS_API_KEY set");
    return false;
  }

  // Attempt 1: Quick SMS route (POST with custom message)
  try {
    console.log("[SMS] Sending OTP via Quick SMS route");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        "authorization": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "q",
        message: `Your 3i Learning verification code is ${otp}. Valid for 10 minutes. Do not share this code.`,
        numbers: phone,
        flash: "0",
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    console.log("[SMS] Quick SMS response received");
    if (data.return === true) {
      console.log("[SMS] OTP sent successfully");
      return true;
    }
    console.error("[SMS] Quick SMS failed:", data.message || "provider_error");
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[SMS] Quick SMS timeout");
    } else {
      console.error(`[SMS] Quick SMS error:`, err);
    }
  }

  // Attempt 2: OTP route (GET with variable substitution) — fallback
  try {
    console.log("[SMS] Trying OTP route as fallback");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=otp&variables_values=${encodeURIComponent(otp)}&flash=0&numbers=${encodeURIComponent(phone)}`;
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    console.log("[SMS] OTP route response received");
    if (data.return === true) {
      console.log("[SMS] OTP route sent successfully");
      return true;
    }
    console.error("[SMS] OTP route failed:", data.message || "provider_error");
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.error("[SMS] OTP route timeout");
    } else {
      console.error(`[SMS] OTP route error:`, err);
    }
  }

  return false;
}
