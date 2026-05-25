import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function generateSecureToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function hashOtpValue(otp: string): string {
  const secret = process.env.OTP_HMAC_SECRET || process.env.SESSION_SECRET || "dev-otp-secret";
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
    // Fall through for legacy values.
  }

  // Backward compatibility for previously stored plain OTP values.
  return storedOtp === providedOtp;
}

