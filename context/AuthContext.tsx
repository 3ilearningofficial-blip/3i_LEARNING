import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Platform } from "react-native";
import { router } from "expo-router";
import { apiRequest, getApiUrl } from "@/lib/query-client";
import { fetch } from "expo/fetch";

interface AuthUser {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role: "student" | "admin";
  deviceId?: string;
  sessionToken?: string;
  profileComplete?: boolean;
  date_of_birth?: string;
  photo_url?: string;
}

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

const storageKey = "user";

async function storeUser(userData: AuthUser) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey, JSON.stringify(userData));
  } else {
    await AsyncStorage.setItem(storageKey, JSON.stringify(userData));
  }
}

async function getStoredUser(): Promise<AuthUser | null> {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : null;
    }
    const stored = await AsyncStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

async function removeStoredUser() {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.removeItem(storageKey);
  } else {
    await AsyncStorage.removeItem(storageKey);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = async () => {
    try {
      const baseUrl = getApiUrl();
      const url = new URL("/api/auth/me", baseUrl);
      // Send stored token as Bearer header for cross-origin dev support
      const stored = Platform.OS === "web" && typeof localStorage !== "undefined"
        ? localStorage.getItem("user")
        : null;
      const token = stored ? JSON.parse(stored)?.sessionToken : null;
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(url.toString(), { credentials: "include", headers });
      if (res.ok) {
        const data = await res.json();
        // Always update stored token with what server returns
        if (data.sessionToken) {
          setUser(data);
          await storeUser(data);
        } else if (token) {
          // Server didn't return token — preserve the one we sent
          data.sessionToken = token;
          setUser(data);
          await storeUser(data);
        } else {
          setUser(data);
          await storeUser(data);
        }
      } else {
        const errorData = await res.json().catch(() => null);
        if (errorData?.message === "logged_in_elsewhere") {
          Alert.alert("Session Expired", "Your account has been logged in on another device.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredUser();
        } else if (errorData?.message === "account_blocked") {
          Alert.alert("Account Blocked", "Your account has been blocked by the admin. Please contact support.", [{ text: "OK" }]);
          setUser(null);
          await removeStoredUser();
        } else if (errorData?.message === "account_deleted") {
          setUser(null);
          await removeStoredUser();
        } else {
          // 401 with stale token — fall back to stored user so app stays usable
          const stored = await getStoredUser();
          if (stored) {
            setUser(stored);
          } else {
            setUser(null);
            await removeStoredUser();
          }
        }
      }
    } catch {
      // Network error — use stored user as fallback
      const stored = await getStoredUser();
      if (stored) {
        setUser(stored);
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

  // Web: redirect to OTP after 1 hour of inactivity (don't fully logout)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const TIMEOUT = 60 * 60 * 1000; // 1 hour
    let timer: ReturnType<typeof setTimeout>;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (user) {
          // Don't logout — just redirect to OTP so they re-verify
          // Keep user data so profile isn't lost
          router.replace("/(auth)/login");
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
    storeUser(userData);
  };

  const updateUser = (updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      storeUser(updated);
      return updated;
    });
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (_e) {}
    setUser(null);
    await removeStoredUser();
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
