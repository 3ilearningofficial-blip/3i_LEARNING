import { describe, expect, it } from "vitest";
import {
  AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS,
  AUTO_NOTIFICATION_TTL_MS,
  autoNotificationExpiresAt,
  computeAutoNotificationHideAfterAt,
} from "./auto-notification-expiry";

describe("auto-notification-expiry", () => {
  it("sets expires_at 12 hours ahead", () => {
    const now = 1_700_000_000_000;
    expect(autoNotificationExpiresAt(now)).toBe(now + AUTO_NOTIFICATION_TTL_MS);
  });

  it("keeps tapped-before-expiry notifications until the 12-hour mark", () => {
    const createdAt = 1_700_000_000_000;
    const expiresAt = createdAt + AUTO_NOTIFICATION_TTL_MS;
    const tappedAt = createdAt + 2 * 60 * 60 * 1000;
    expect(computeAutoNotificationHideAfterAt(tappedAt, expiresAt)).toBe(expiresAt);
  });

  it("keeps post-expiry taps visible for one more hour", () => {
    const createdAt = 1_700_000_000_000;
    const expiresAt = createdAt + AUTO_NOTIFICATION_TTL_MS;
    const tappedAt = expiresAt + 5 * 60 * 1000;
    expect(computeAutoNotificationHideAfterAt(tappedAt, expiresAt)).toBe(
      tappedAt + AUTO_NOTIFICATION_POST_EXPIRY_TAP_GRACE_MS
    );
  });

  it("returns null when expires_at is missing", () => {
    expect(computeAutoNotificationHideAfterAt(Date.now(), null)).toBeNull();
  });
});
