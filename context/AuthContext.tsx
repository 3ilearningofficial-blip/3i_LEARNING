import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import {
  apiRequest,
  getApiUrl,
  getStoredToken,
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
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (updates: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const stored = await getStoredAuthUser();
      const token = await getStoredToken();

      // Avoid noisy expected 401s on public auth pages when no session exists.
      if (Platform.OS !== "web" && !token && !stored) {
        setUser(null);
        return;
      }

      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/me", baseUrl);
      // Native uses stored bearer token; web relies on HttpOnly cookie session.
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await attachInstallationHeaders(headers);
      const res = await fetch(url.toString(), { credentials: "include", headers });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.id !== "number") {
          setUser(null);
          await removeStoredAuthUser();
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
        if (errorData?.message === "device_binding_mismatch") {
          Alert.alert(
            "Access Restricted",
            "This account's paid subscription is tied to the device used at purchase. Sign in using that same installation, or contact support.",
            [{ text: "OK" }]
          );
          setUser(null);
          await removeStoredAuthUser();
        } else if (errorData?.message === "logged_in_elsewhere") {
          Alert.alert("Session Expired", "Your account has been logged in on another device.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredAuthUser();
        } else if (errorData?.message === "account_blocked") {
          Alert.alert("Account Blocked", "Your account has been blocked by the admin. Please contact support.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredAuthUser();
        } else if (errorData?.message === "account_deleted") {
          setUser(null);
          await removeStoredAuthUser();
        } else if (Platform.OS === "web") {
          setUser(null);
          await removeStoredAuthUser();
        } else if (stored) {
          // Native fallback keeps offline usability when transient auth errors happen.
          setUser(stored);
        } else {
          setUser(null);
          await removeStoredAuthUser();
        }
      }
    } catch {
      if (Platform.OS === "web") {
        setUser(null);
        await removeStoredAuthUser();
      } else {
        // Network error — use stored user as fallback on native.
        const stored = await getStoredAuthUser();
        if (stored) {
          setUser(stored);
        }
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
        setUser(null);
        await removeStoredAuthUser();
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
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Web: clear session and return to welcome after 1 hour inactivity (students only — admins may stay signed in on multiple devices).
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (user?.role === "admin") return;
    const TIMEOUT = 60 * 60 * 1000; // 1 hour
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (user) {
          setUser(null);
          await removeStoredAuthUser();
          router.replace("/welcome");
        }
      }, TIMEOUT);
    };

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [user]);

  const login = (userData: AuthUser) => {
    setUser(userData);
    storeAuthUser(userData);
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
