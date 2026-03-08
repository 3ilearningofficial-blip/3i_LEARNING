import { Platform } from "react-native";
import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function getApiUrl(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const host = window.location.host;
    const protocol = window.location.protocol;

    if (process.env.EXPO_PUBLIC_DOMAIN) {
      return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
    }

    return `${protocol}//${host}/`;
  }

  let host = process.env.EXPO_PUBLIC_DOMAIN;
  if (!host) {
    throw new Error("EXPO_PUBLIC_DOMAIN is not set");
  }

  return `https://${host}`;
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
  return expoFetch(url, options);
}

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown | undefined,
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);

  const res = await doFetch(url.toString(), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
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

    const res = await doFetch(url.toString(), {
      credentials: "include",
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
