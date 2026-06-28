import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("livekit-server-sdk", () => {
  class MockWebhookReceiver {
    receive = vi.fn(async () => ({ event: "room_finished", room: { name: "lc-1" } }));
    constructor(
      public apiKey: string,
      public apiSecret: string
    ) {}
  }

  class MockAccessToken {
    addGrant = vi.fn();
    toJwt = vi.fn(async () => "mock-jwt");
    constructor(
      public apiKey: string,
      public apiSecret: string,
      public options?: { identity?: string; name?: string; ttl?: string }
    ) {}
  }

  return {
    WebhookReceiver: MockWebhookReceiver,
    AccessToken: MockAccessToken,
  };
});

import {
  createAccessToken,
  getLiveKitConfig,
  getWebhookReceiver,
  isLiveKitWebhookConfigured,
  resetLiveKitSdkCacheForTests,
} from "./livekit-sdk";

describe("livekit-sdk config", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetLiveKitSdkCacheForTests();
  });

  afterEach(() => {
    process.env = { ...prev };
    resetLiveKitSdkCacheForTests();
  });

  it("getLiveKitConfig returns null when env vars are missing", () => {
    delete process.env.LIVEKIT_URL;
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    expect(getLiveKitConfig()).toBeNull();
  });

  it("getLiveKitConfig returns config when all env vars are set", () => {
    process.env.LIVEKIT_URL = "wss://livekit.example.com";
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    expect(getLiveKitConfig()).toEqual({
      url: "wss://livekit.example.com",
      apiKey: "key",
      apiSecret: "secret",
    });
  });

  it("isLiveKitWebhookConfigured is true when key and secret are set", () => {
    process.env.LIVEKIT_API_KEY = "key";
    process.env.LIVEKIT_API_SECRET = "secret";
    expect(isLiveKitWebhookConfigured()).toBe(true);
  });

  it("isLiveKitWebhookConfigured is false when key or secret is missing", () => {
    delete process.env.LIVEKIT_API_KEY;
    process.env.LIVEKIT_API_SECRET = "secret";
    expect(isLiveKitWebhookConfigured()).toBe(false);
  });
});

describe("livekit-sdk lazy loader", () => {
  const prev = { ...process.env };

  beforeEach(() => {
    resetLiveKitSdkCacheForTests();
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env = { ...prev };
    resetLiveKitSdkCacheForTests();
  });

  it("getWebhookReceiver caches the receiver instance", async () => {
    const first = await getWebhookReceiver();
    const second = await getWebhookReceiver();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it("createAccessToken returns a token instance with addGrant and toJwt", async () => {
    const token = await createAccessToken("k", "s", { identity: "user-1", ttl: "6h" });
    token.addGrant({ roomJoin: true });
    await expect(token.toJwt()).resolves.toBe("mock-jwt");
  });
});
