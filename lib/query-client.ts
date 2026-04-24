import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

type UnauthorizedHandler = () => void | Promise<void>;
let onUnauthorized: UnauthorizedHandler | null = null;
let lastUnauthorizedAt = 0;

const RETRYABLE_STATUS_CODES = new Set([408, 429, 502, 503, 504]);
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 300;
const API_DEBUG =
  process.env.EXPO_PUBLIC_API_DEBUG === "1" ||
  process.env.EXPO_PUBLIC_API_DEBUG === "true";

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

async function notifyUnauthorized(): Promise<void> {
  if (!onUnauthorized) return;
  const now = Date.now();
  if (now - lastUnauthorizedAt < 1500) return;
  lastUnauthorizedAt = now;
  try {
    await onUnauthorized();
  } catch (_e) {}
}

export function getWebUrl(): string {
  // Web (browser)
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // Mobile / Expo fallback
  const host = process.env.EXPO_PUBLIC_DOMAIN;

  if (host) {
    return `https://${host}`;
  }

  // Final fallback
  return "https://3ilearning.in";
}

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api")) return trimmed.slice(0, -4);
  return trimmed;
}

// Returns base URL without /api suffix.
export function getBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL || process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return normalizeBaseUrl(explicit);

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "3ilearning.in" || host === "www.3ilearning.in") {
      return "https://api.3ilearning.in";
    }
    if (host === "localhost" || host === "127.0.0.1") {
      return "http://localhost:5000";
    }
    // Never default to frontend origin in web deployments.
    // This avoids accidental /api calls hitting Vercel app routes.
    return "https://api.3ilearning.in";
  }

  return "https://api.3ilearning.in";
}

export function getApiUrl(): string {
  return `${getBaseUrl()}/api`;
}

/** Upgrade http:// to https:// for non-localhost URLs to avoid mixed-content blocks in the browser. */
export function toHttpsMediaUrl(url: string): string {
  if (!url || !url.startsWith("http://")) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return url;
    u.protocol = "https:";
    return u.href;
  } catch {
    return url;
  }
}

async function getErrorMessage(res: Response): Promise<string> {
  const fallback = `Request failed (${res.status})`;
  try {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await res.clone().json();
      if (payload?.error) return String(payload.error);
      if (payload?.message) return String(payload.message);
      if (payload?.success === false && payload?.data?.message) return String(payload.data.message);
      return fallback;
    }
    const text = await res.clone().text();
    return text || fallback;
  } catch {
    return fallback;
  }
}

async function throwIfResNotOk(res: Response, method?: string, url?: string) {
  if (!res.ok) {
    const message = await getErrorMessage(res);
    const prefix = method && url ? `${method.toUpperCase()} ${url}` : "API request";
    throw new Error(`${prefix} -> ${res.status}: ${message}`);
  }
}

function unwrapApiEnvelope(payload: any): any {
  if (
    payload &&
    typeof payload === "object" &&
    typeof payload.success === "boolean" &&
    ("data" in payload || "message" in payload || "error" in payload)
  ) {
    if (!payload.success) {
      throw new Error(payload.error || payload.message || "Request failed");
    }
    if ("data" in payload) return payload.data;
    if ("message" in payload) return { message: payload.message };
    return payload;
  }
  return payload;
}

function withUnwrappedJson(res: Response): Response {
  const originalJson = res.json.bind(res);
  (res as any).json = async () => {
    const payload = await originalJson();
    return unwrapApiEnvelope(payload);
  };
  return res;
}

async function doFetch(url: string, options?: RequestInit): Promise<Response> {
  if (Platform.OS === "web") {
    return globalThis.fetch(url, options);
  }
  const { fetch: expoFetch } = await import("expo/fetch");
  const { body, ...rest } = options || {};
  return expoFetch(url, { ...rest, body: body ?? undefined } as any);
}

function canRetry(options?: RequestInit): boolean {
  const method = (options?.method || "GET").toUpperCase();
  return RETRYABLE_METHODS.has(method);
}

function retryDelay(attempt: number): number {
  const jitter = Math.floor(Math.random() * 120);
  return BASE_RETRY_DELAY_MS * Math.pow(2, attempt) + jitter;
}

function logApiDebug(event: string, details: Record<string, unknown>): void {
  if (!API_DEBUG) return;
  try {
    console.log(`[api] ${event}`, details);
  } catch (_e) {}
}

async function doFetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
  const retryable = canRetry(options);
  const method = (options?.method || "GET").toUpperCase();
  const startedAt = Date.now();
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await doFetch(url, options);
      const elapsedMs = Date.now() - startedAt;
      logApiDebug("response", {
        method,
        url,
        status: res.status,
        attempt,
        elapsedMs,
        retryable,
      });
      if (!retryable || !RETRYABLE_STATUS_CODES.has(res.status) || attempt === MAX_RETRIES) {
        if (attempt > 0) {
          logApiDebug("retry-complete", { method, url, attemptsUsed: attempt, finalStatus: res.status, elapsedMs });
        }
        return res;
      }
      logApiDebug("retry-scheduled", {
        method,
        url,
        attempt,
        status: res.status,
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    } catch (err) {
      lastError = err;
      const elapsedMs = Date.now() - startedAt;
      logApiDebug("network-error", {
        method,
        url,
        attempt,
        elapsedMs,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!retryable || attempt === MAX_RETRIES) throw err;
      logApiDebug("retry-scheduled", {
        method,
        url,
        attempt,
        reason: "network-error",
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
    }
  }
  throw lastError || new Error("Network request failed");
}

// ✅ SSR-safe token fetch
export async function getStoredToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      if (typeof window === "undefined") return null;
      const stored = window.localStorage.getItem("user");
      if (stored) return JSON.parse(stored)?.sessionToken || null;
    } else {
      const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
      const stored = await AsyncStorage.getItem("user");
      if (stored) return JSON.parse(stored)?.sessionToken || null;
    }
  } catch (e) {
    console.log("Token error:", e);
  }
  return null;
}

// Authenticated fetch
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await getStoredToken();

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await doFetchWithRetry(url, {
    ...options,
    headers,
    credentials: "include",
  });
  if (res.status === 401) await notifyUnauthorized();

  return withUnwrappedJson(res);
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const token = await getStoredToken();

  const headers: Record<string, string> = {};

  if (data) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await doFetchWithRetry(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  if (res.status === 401) await notifyUnauthorized();

  await throwIfResNotOk(res, method, url.toString());
  return withUnwrappedJson(res);
}

type UnauthorizedBehavior = "returnNull" | "throw";

export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const baseUrl = getApiUrl();
    const url = new URL(queryKey.join("/") as string, baseUrl);

    const token = await getStoredToken();

    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await doFetchWithRetry(url.toString(), {
      credentials: "include",
      headers,
    });
    if (res.status === 401) await notifyUnauthorized();

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, "GET", url.toString());
    return unwrapApiEnvelope(await res.json());
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 30000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});