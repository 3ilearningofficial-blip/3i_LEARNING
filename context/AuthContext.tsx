import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Platform } from "react-native";
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
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  login: (user: AuthUser) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const storageKey = "user";

async function storeUser(userData: AuthUser) {
  if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(storageKey, JSON.stringify(userData));
  } else {
    await AsyncStorage.setItem(storageKey, JSON.stringify(userData));
  }
}

async function getStoredUser(): Promise<AuthUser | null> {
  try {
    if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
      const stored = sessionStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : null;
    }
    const stored = await AsyncStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

async function removeStoredUser() {
  if (Platform.OS === "web" && typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(storageKey);
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
      const res = await fetch(url.toString(), { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        await storeUser(data);
      } else {
        const errorData = await res.json().catch(() => null);
        if (errorData?.message === "logged_in_elsewhere") {
          Alert.alert(
            "Session Expired",
            "Your account has been logged in on another device. You have been logged out.",
            [{ text: "OK" }]
          );
        }
        setUser(null);
        await removeStoredUser();
      }
    } catch {
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

  const login = (userData: AuthUser) => {
    setUser(userData);
    storeUser(userData);
  };

  const logout = async () => {
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch {}
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
