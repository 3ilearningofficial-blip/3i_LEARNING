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
    // Persist opaque sessionToken on web so authFetch can send Bearer alongside cookies.
    localStorage.setItem(userStorageKey, JSON.stringify(userData));
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
      return stored ? JSON.parse(stored) : null;
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
  } else {
    await AsyncStorage.removeItem(userStorageKey);
    await setNativeStoredToken(null);
  }
}

export async function getStoredAuthToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(userStorageKey);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as { sessionToken?: string };
      const t = parsed.sessionToken?.trim();
      return t && t !== "null" && t !== "undefined" ? t : null;
    }
    return await getNativeStoredToken();
  } catch {
    return null;
  }
}
