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

/**
 * Web bearer token must be durable so it survives mobile browsers discarding a
 * backgrounded tab. We store it in localStorage (not sessionStorage) and only
 * clear it on logout/auth rejection, matching native's SecureStore durability.
 */
function setWebStoredToken(token?: string | null): void {
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(webTokenKey, token);
  else localStorage.removeItem(webTokenKey);
  // Clear the legacy per-tab copy from before durable storage.
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(webTokenKey);
}

/** Read durable localStorage token, migrating a legacy sessionStorage token if found. */
function getWebStoredToken(): string | null {
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
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const { sessionToken, ...rest } = userData;
    localStorage.setItem(userStorageKey, JSON.stringify(rest));
    setWebStoredToken(sessionToken || null);
  } else {
    const { sessionToken, ...rest } = userData;
    await AsyncStorage.setItem(userStorageKey, JSON.stringify(rest));
    await setNativeStoredToken(sessionToken || null);
  }
}

export async function getStoredAuthUser(): Promise<StoredAuthUser | null> {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(userStorageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const token = getWebStoredToken();
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
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.removeItem(userStorageKey);
    localStorage.removeItem(webTokenKey);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(webTokenKey);
  } else {
    await AsyncStorage.removeItem(userStorageKey);
    await setNativeStoredToken(null);
  }
}

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      const t = getWebStoredToken()?.trim();
      return t && t !== "null" && t !== "undefined" ? t : null;
    }
    return await getNativeStoredToken();
  } catch {
    return null;
  }
}
