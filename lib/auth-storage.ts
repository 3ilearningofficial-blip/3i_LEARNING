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

export async function storeAuthUser(userData: StoredAuthUser) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    const { sessionToken, ...rest } = userData;
    localStorage.setItem(userStorageKey, JSON.stringify(rest));
    if (typeof sessionStorage !== "undefined") {
      if (sessionToken) sessionStorage.setItem(webTokenKey, sessionToken);
      else sessionStorage.removeItem(webTokenKey);
    }
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
      const token = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(webTokenKey) : null;
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
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(webTokenKey);
  } else {
    await AsyncStorage.removeItem(userStorageKey);
    await setNativeStoredToken(null);
  }
}

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      const t = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(webTokenKey)?.trim() : null;
      return t && t !== "null" && t !== "undefined" ? t : null;
    }
    return await getNativeStoredToken();
  } catch {
    return null;
  }
}
