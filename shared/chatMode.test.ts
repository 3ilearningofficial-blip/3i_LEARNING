import { describe, it, expect } from "vitest";
import { normalizeChatMode, parseChatModeInput } from "./chatMode";

describe("normalizeChatMode", () => {
  it("defaults unknown values to public", () => {
    expect(normalizeChatMode(undefined)).toBe("public");
    expect(normalizeChatMode("")).toBe("public");
    expect(normalizeChatMode("foo")).toBe("public");
  });

  it("accepts public, private, disabled", () => {
    expect(normalizeChatMode("public")).toBe("public");
    expect(normalizeChatMode("PRIVATE")).toBe("private");
    expect(normalizeChatMode("disabled")).toBe("disabled");
  });
});

describe("parseChatModeInput", () => {
  it("rejects invalid write values", () => {
    expect(parseChatModeInput("nope")).toBeNull();
    expect(parseChatModeInput(null)).toBeNull();
  });

  it("accepts allowlisted modes", () => {
    expect(parseChatModeInput("disabled")).toBe("disabled");
  });
});
