export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export type AccessTokenOptions = {
  identity: string;
  name?: string;
  ttl?: string;
};

type LiveKitSdkModule = {
  WebhookReceiver?: new (apiKey: string, apiSecret: string) => {
    receive: (body: string, authHeader: string) => Promise<unknown>;
  };
  AccessToken?: new (
    apiKey: string,
    apiSecret: string,
    options?: AccessTokenOptions
  ) => {
    addGrant: (grant: Record<string, unknown>) => void;
    toJwt: () => Promise<string>;
  };
};

let cachedSdk: LiveKitSdkModule | null | undefined;
let cachedWebhookReceiver: InstanceType<
  NonNullable<LiveKitSdkModule["WebhookReceiver"]>
> | null | undefined;
let webhookReceiverLoadFailed = false;

export function getLiveKitConfig(): LiveKitConfig | null {
  const url = String(process.env.LIVEKIT_URL || "").trim();
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export function isLiveKitWebhookConfigured(): boolean {
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  return !!(apiKey && apiSecret);
}

async function loadLiveKitSdk(): Promise<LiveKitSdkModule | null> {
  if (cachedSdk !== undefined) return cachedSdk;
  try {
    const mod = (await import("livekit-server-sdk")) as LiveKitSdkModule;
    cachedSdk = mod;
    return mod;
  } catch (err) {
    console.error("[LiveKit] Failed to load livekit-server-sdk:", err);
    cachedSdk = null;
    return null;
  }
}

function resolveWebhookReceiverClass(
  mod: LiveKitSdkModule
): LiveKitSdkModule["WebhookReceiver"] | null {
  const ctor = mod.WebhookReceiver;
  if (typeof ctor === "function") return ctor;
  console.error("[LiveKit] livekit-server-sdk WebhookReceiver export is missing or invalid");
  return null;
}

function resolveAccessTokenClass(mod: LiveKitSdkModule): LiveKitSdkModule["AccessToken"] | null {
  const ctor = mod.AccessToken;
  if (typeof ctor === "function") return ctor;
  return null;
}

export async function getWebhookReceiver(): Promise<InstanceType<
  NonNullable<LiveKitSdkModule["WebhookReceiver"]>
> | null> {
  if (cachedWebhookReceiver !== undefined) return cachedWebhookReceiver;
  if (webhookReceiverLoadFailed) return null;

  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!apiKey || !apiSecret) {
    cachedWebhookReceiver = null;
    return null;
  }

  const mod = await loadLiveKitSdk();
  if (!mod) {
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }

  const WebhookReceiver = resolveWebhookReceiverClass(mod);
  if (!WebhookReceiver) {
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }

  try {
    cachedWebhookReceiver = new WebhookReceiver(apiKey, apiSecret);
    return cachedWebhookReceiver;
  } catch (err) {
    console.error("[LiveKit] Failed to create WebhookReceiver:", err);
    webhookReceiverLoadFailed = true;
    cachedWebhookReceiver = null;
    return null;
  }
}

export async function createAccessToken(
  apiKey: string,
  apiSecret: string,
  options: AccessTokenOptions
): Promise<InstanceType<NonNullable<LiveKitSdkModule["AccessToken"]>>> {
  const mod = await loadLiveKitSdk();
  if (!mod) {
    throw new Error("livekit-server-sdk failed to load");
  }

  const AccessToken = resolveAccessTokenClass(mod);
  if (!AccessToken) {
    throw new Error("livekit-server-sdk AccessToken export is missing or invalid");
  }

  return new AccessToken(apiKey, apiSecret, options);
}

/** Test-only: reset module caches between test cases. */
export function resetLiveKitSdkCacheForTests(): void {
  cachedSdk = undefined;
  cachedWebhookReceiver = undefined;
  webhookReceiverLoadFailed = false;
}
