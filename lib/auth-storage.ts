import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface StoredAuthUser {
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

const userStorageKey = "user";
const nativeTokenKey = "sessionToken";
const webTokenKey = "sessionToken";

function removeWebAuthStorage(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(userStorageKey);
    localStorage.removeItem(webTokenKey);
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(userStorageKey);
    sessionStorage.removeItem(webTokenKey);
  }
}

async function setNativeStoredToken(token?: string | null) {
  if (Platform.OS === "web") return;
  const SecureStore = await import("expo-secure-store");
  if (token) {
    await SecureStore.setItemAsync(nativeTokenKey, token);
  } else {
    await SecureStore.deleteItemAsync(nativeTokenKey);
  }
}

async function getNativeStoredToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const SecureStore = await import("expo-secure-store");
    return await SecureStore.getItemAsync(nativeTokenKey);
  } catch {
    return null;
  }
}

function setWebStoredToken(token?: string | null, role?: StoredAuthUser["role"]): void {
  if (role === "admin") {
    if (typeof sessionStorage === "undefined") return;
    if (token) sessionStorage.setItem(webTokenKey, token);
    else sessionStorage.removeItem(webTokenKey);
    if (typeof localStorage !== "undefined") localStorage.removeItem(webTokenKey);
    return;
  }

  // Student web bearer token must be durable for the 7-day inactivity window.
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(webTokenKey, token);
  else localStorage.removeItem(webTokenKey);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(webTokenKey);
}

function getWebStoredToken(role?: StoredAuthUser["role"] | null): string | null {
  if (role === "admin") {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage.getItem(webTokenKey);
  }

  if (typeof localStorage !== "undefined") {
    const v = localStorage.getItem(webTokenKey);
    if (v) return v;
  }
  if (typeof sessionStorage !== "undefined") {
    const legacy = sessionStorage.getItem(webTokenKey);
    if (legacy) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(webTokenKey, legacy);
        sessionStorage.removeItem(webTokenKey);
      } catch {
        /* ignore */
      }
      return legacy;
    }
  }
  return null;
}

export async function storeAuthUser(userData: StoredAuthUser) {
  if (Platform.OS === "web") {
    const { sessionToken, ...rest } = userData;
    if (userData.role === "admin") {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(userStorageKey, JSON.stringify(rest));
        setWebStoredToken(sessionToken || null, "admin");
      }
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(userStorageKey);
        localStorage.removeItem(webTokenKey);
      }
      return;
    }

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(userStorageKey, JSON.stringify(rest));
      setWebStoredToken(sessionToken || null, "student");
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(userStorageKey);
    }
  } else {
    const { sessionToken, ...rest } = userData;
    await AsyncStorage.setItem(userStorageKey, JSON.stringify(rest));
    await setNativeStoredToken(sessionToken || null);
  }
}

export async function getStoredAuthUser(): Promise<StoredAuthUser | null> {
  try {
    if (Platform.OS === "web") {
      if (typeof sessionStorage !== "undefined") {
        const sessionStored = sessionStorage.getItem(userStorageKey);
        if (sessionStored) {
          const parsed = JSON.parse(sessionStored);
          if (parsed?.role === "admin") {
            const token = getWebStoredToken("admin");
            return { ...parsed, sessionToken: token || undefined };
          }
        }
      }

      if (typeof localStorage === "undefined") return null;
      const stored = localStorage.getItem(userStorageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (parsed?.role === "admin") {
        removeWebAuthStorage();
        return null;
      }
      const token = getWebStoredToken("student");
      return { ...parsed, sessionToken: token || undefined };
    }
    const stored = await AsyncStorage.getItem(userStorageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const sessionToken = await getNativeStoredToken();
    return { ...parsed, sessionToken: sessionToken || undefined };
  } catch {
    return null;
  }
}

export async function removeStoredAuthUser() {
  if (Platform.OS === "web") {
    removeWebAuthStorage();
  } else {
    await AsyncStorage.removeItem(userStorageKey);
    await setNativeStoredToken(null);
  }
}

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      let role: StoredAuthUser["role"] | null = null;
      if (typeof sessionStorage !== "undefined") {
        const sessionUser = sessionStorage.getItem(userStorageKey);
        if (sessionUser) role = JSON.parse(sessionUser)?.role ?? null;
      }
      if (!role && typeof localStorage !== "undefined") {
        const localUser = localStorage.getItem(userStorageKey);
        if (localUser) {
          const parsed = JSON.parse(localUser);
          role = parsed?.role ?? null;
          if (role === "admin") {
            removeWebAuthStorage();
            return null;
          }
        }
      }
      const t = getWebStoredToken(role)?.trim();
      return t && t !== "null" && t !== "undefined" ? t : null;
    }
    return await getNativeStoredToken();
  } catch {
    return null;
  }
}
