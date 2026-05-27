import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function hashOtpValue(otp: string): string {
  // No fallback: a missing OTP_HMAC_SECRET must be a hard startup error, not a silent
  // downgrade to a known/guessable secret. If the env var is absent, secret is undefined
  // and createHmac will throw, surfacing the misconfiguration immediately at call time.
  const secret = process.env.OTP_HMAC_SECRET;
  return createHmac("sha256", secret).update(otp).digest("hex");
}

export function verifyOtpValue(storedOtp: string | null | undefined, providedOtp: string): boolean {
  if (!storedOtp || !providedOtp) return false;

  const hashedProvided = hashOtpValue(providedOtp);
  try {
    const storedBuffer = Buffer.from(storedOtp, "utf8");
    const providedBuffer = Buffer.from(hashedProvided, "utf8");
    if (storedBuffer.length === providedBuffer.length) {
      return timingSafeEqual(storedBuffer, providedBuffer);
    }
  } catch {
    // Hash comparison failed (e.g. buffer length mismatch or encoding error).
    return false;
  }

  return false;
}

