import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

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
  export function getApiUrl(): string {
  return "https://api.3ilearning.in/api";
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    let text: string;
    try {
      text = await res.text();
    } catch {
      text = res.statusText;
    }
    throw new Error(`${res.status}: ${text}`);
  }
}

async function doFetch(url: string, options?: RequestInit): Promise<Response> {
  if (Platform.OS === "web") {
    return globalThis.fetch(url, options);
  }
  const { fetch: expoFetch } = await import("expo/fetch");
  const { body, ...rest } = options || {};
  return expoFetch(url, { ...rest, body: body ?? undefined } as any);
}

// ✅ SSR-safe token fetch
async function getStoredToken(): Promise<string | null> {
  try {
    if (typeof window === "undefined") return null;

    if (Platform.OS === "web") {
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

// ✅ SSR-safe userId fetch
async function getStoredUserId(): Promise<number | null> {
  try {
    if (typeof window === "undefined") return null;

    if (Platform.OS === "web") {
      const stored = window.localStorage.getItem("user");
      if (stored) return JSON.parse(stored)?.id || null;
    } else {
      const { default: AsyncStorage } = await import("@react-native-async-storage/async-storage");
      const stored = await AsyncStorage.getItem("user");
      if (stored) return JSON.parse(stored)?.id || null;
    }
  } catch (e) {
    console.log("UserId error:", e);
  }
  return null;
}

// Authenticated fetch
export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = await getStoredToken();
  const userId = await getStoredUserId();

  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (userId) headers["X-User-Id"] = String(userId);

  const res = await doFetch(url, {
    ...options,
    headers,
    credentials: "include",
  });

  return res;
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const token = await getStoredToken();
  const userId = await getStoredUserId();

  const headers: Record<string, string> = {};

  if (data) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (userId) headers["X-User-Id"] = String(userId);

  const res = await doFetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
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

    const res = await doFetch(url.toString(), {
      credentials: "include",
      headers,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
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