import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { Alert, Platform } from "react-native";
import { router, usePathname } from "expo-router";
import {
  apiRequest,
  getApiUrl,
  getStoredToken,
  queryClient,
  setUnauthorizedHandler,
  attachInstallationHeaders,
} from "@/lib/query-client";
import {
  getStoredAuthUser,
  removeStoredAuthUser,
  storeAuthUser,
  type StoredAuthUser,
} from "@/lib/auth-storage";
import { registerPushForCurrentUser, unregisterPushForCurrentUser } from "@/lib/pushNotifications";
import { fetch } from "expo/fetch";

interface AuthUser extends StoredAuthUser {}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const pathname = usePathname();

  const refreshUser = async () => {
    try {
      const stored = await getStoredAuthUser();
      const token = await getStoredToken();

      // No persisted session — on web still try cookie-only /api/auth/me once.
      if (!token && !stored) {
        if (Platform.OS !== "web") {
          setUser(null);
          return;
        }
      }

      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/me", baseUrl);
      const buildHeaders = async (): Promise<Record<string, string>> => {
        const headers: Record<string, string> = {};
        const t = await getStoredToken();
        if (t) headers["Authorization"] = `Bearer ${t}`;
        await attachInstallationHeaders(headers);
        return headers;
      };

      const fetchMe = async () =>
        fetch(url.toString(), { credentials: "include", headers: await buildHeaders() });

      let res: Response;
      if (Platform.OS === "web") {
        try {
          res = await fetchMe();
        } catch {
          await new Promise((r) => setTimeout(r, 400));
          res = await fetchMe();
        }
      } else {
        res = await fetchMe();
      }
      // One retry on web for transient cookie/network races after navigation or tab restore.
      if (Platform.OS === "web" && !res.ok && (res.status === 401 || res.status === 403 || res.status === 502)) {
        await new Promise((r) => setTimeout(r, 400));
        res = await fetchMe();
      }

      if (res.ok) {
        const data = await res.json();
        if (typeof data?.id !== "number") {
          if (Platform.OS !== "web" && stored) {
            // Native safety: if secure token lookup is temporarily unavailable,
            // keep last known session instead of force-logging out.
            setUser(stored);
            return;
          }
          if (Platform.OS === "web" && stored?.role === "admin" && token) {
            await new Promise((r) => setTimeout(r, 400));
            const retryRes = await fetchMe();
            if (retryRes.ok) {
              const retryData = await retryRes.json();
              if (typeof retryData?.id === "number") {
                if (retryData.sessionToken) {
                  setUser(retryData);
                  await storeAuthUser(retryData);
                } else {
                  retryData.sessionToken = token;
                  setUser(retryData);
                  await storeAuthUser(retryData);
                }
                return;
              }
            }
            setUser(stored);
            return;
          }
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
          return;
        }
        // Always update stored token with what server returns
        if (data.sessionToken) {
          setUser(data);
          await storeAuthUser(data);
        } else if (token) {
          // Server didn't return token — preserve the one we sent
          data.sessionToken = token;
          setUser(data);
          await storeAuthUser(data);
        } else {
          setUser(data);
          await storeAuthUser(data);
        }
      } else {
        const errorData = await res.json().catch(() => null);
        const msg = errorData?.message as string | undefined;
        if (msg === "device_binding_mismatch") {
          Alert.alert(
            "Access Restricted",
            "This account's paid subscription is tied to the device used at purchase. Sign in using that same installation, or contact support.",
            [{ text: "OK" }]
          );
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (msg === "active_on_other_platform") {
          const other = errorData?.activePlatform === "mobile" ? "the mobile app" : "the web browser";
          Alert.alert(
            "Signed in elsewhere",
            `Your account is active on ${other}. Sign in here to switch to this device.`,
            [{ text: "OK" }]
          );
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (msg === "logged_in_elsewhere") {
          Alert.alert("Session Expired", "Your account has been logged in on another device.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (msg === "account_blocked") {
          Alert.alert("Account Blocked", "Your account has been blocked by the admin. Please contact support.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (msg === "account_deleted") {
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (Platform.OS === "web") {
          // Keep last known user on transient failures (refresh during live class, admin classroom, etc.).
          const tok = await getStoredToken();
          if (stored) {
            setUser(stored);
            return;
          }
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        } else if (stored) {
          // Native fallback keeps offline usability when transient auth errors happen.
          setUser(stored);
        } else {
          setUser(null);
          await removeStoredAuthUser();
          queryClient.clear();
        }
      }
    } catch {
      const stored = await getStoredAuthUser();
      const tok = await getStoredToken();
      if (Platform.OS === "web") {
        if (stored && tok) {
          setUser(stored);
          return;
        }
        setUser(null);
        await removeStoredAuthUser();
        queryClient.clear();
      } else if (stored) {
        setUser(stored);
      } else {
        setUser(null);
        await removeStoredAuthUser();
        queryClient.clear();
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      await refreshUser();
      setIsLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    if (!user || Platform.OS === "web") return;
    registerPushForCurrentUser().catch((err) => {
      console.warn("[Push] register failed:", err);
    });
  }, [user?.id]);

  useEffect(() => {
    setUnauthorizedHandler(async () => {
      if (Platform.OS === "web") {
        // Playback + admin: background calls may 401 during flaky API; don't hard-logout immediately.
        const suppressHardLogoutRoute =
          pathname.startsWith("/lecture/") ||
          pathname.startsWith("/live-class/") ||
          pathname.startsWith("/material/") ||
          pathname.startsWith("/admin");
        if (suppressHardLogoutRoute) return;
        // Confirm whether session is actually invalid before clearing user on web.
        // This avoids false logout from endpoint-specific/transient 401s.
        const storedForMe = await getStoredAuthUser();
        const tokenForMe = await getStoredToken();
        try {
          const meUrl = new URL("/api/auth/me", getApiUrl());
          const headers: Record<string, string> = {};
          const bearer = await getStoredToken();
          if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
          await attachInstallationHeaders(headers);
          const meRes = await fetch(meUrl.toString(), { credentials: "include", headers });
          if (meRes.ok) {
            const me = await meRes.json().catch(() => null);
            if (typeof me?.id === "number") {
              setUser(me);
              await storeAuthUser(me);
              return;
            }
          }
          const transient = meRes.status === 502 || meRes.status === 503 || meRes.status === 504;
          if (transient && storedForMe && tokenForMe) return;
        } catch {
          if (storedForMe && tokenForMe) return;
        }
        setUser(null);
        await removeStoredAuthUser();
        queryClient.clear();
        router.replace("/welcome");
        return;
      }
      // Native: avoid aggressive auto-logout on intermittent 401s from background/unstable networks.
      // Hard invalid-session cases are still handled explicitly in refreshUser().
      const stored = await getStoredAuthUser();
      if (stored) {
        setUser(stored);
        return;
      }
      setUser(null);
      await removeStoredAuthUser();
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [pathname]);

  const login = async (userData: AuthUser) => {
    queryClient.clear();
    setUser(userData);
    await storeAuthUser(userData);
  };

  const updateUser = (updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      storeAuthUser(updated);
      return updated;
    });
  };

  const logout = async () => {
    try {
      await unregisterPushForCurrentUser();
    } catch (_e) {}
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (_e) {}
    setUser(null);
    await removeStoredAuthUser();
    queryClient.clear();
  };

  const value = useMemo(
    () => ({
      user,
      isLoading,
      isAdmin: user?.role === "admin",
      login,
      logout,
      refreshUser,
      updateUser,
    }),
    [user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
