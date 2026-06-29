import { afterEach, describe, expect, it } from "vitest";
import { isNeonKeepaliveEnabled } from "./schedulers";

const ENV_KEY = "NEON_KEEPALIVE";

describe("isNeonKeepaliveEnabled", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("defaults to false when unset", () => {
    delete process.env[ENV_KEY];
    expect(isNeonKeepaliveEnabled()).toBe(false);
  });

  it("is true only for explicit truthy values", () => {
    for (const value of ["true", "TRUE", "1", "yes", "on"]) {
      process.env[ENV_KEY] = value;
      expect(isNeonKeepaliveEnabled()).toBe(true);
    }
  });

  it("is false for empty, false, or unknown values", () => {
    for (const value of ["", "false", "0", "no", "off", "maybe"]) {
      process.env[ENV_KEY] = value;
      expect(isNeonKeepaliveEnabled()).toBe(false);
    }
  });
});
