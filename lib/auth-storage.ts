import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export interface StoredAuthUser {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  role: "student" | "admin" | "teacher" | "manager";
  deviceId?: string;
  sessionToken?: string;
  profileComplete?: boolean;
  date_of_birth?: string;
  photo_url?: string;
}

const userStorageKey = "user";
const nativeTokenKey = "sessionToken";
const webTokenKey = "sessionToken";
const webStudentSessionUserBackupKey = "__3i_student_session_user";
const webStudentSessionTokenBackupKey = "__3i_student_session_token";

function removeWebAuthStorage(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(userStorageKey);
    localStorage.removeItem(webTokenKey);
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(userStorageKey);
    sessionStorage.removeItem(webTokenKey);
    sessionStorage.removeItem(webStudentSessionUserBackupKey);
    sessionStorage.removeItem(webStudentSessionTokenBackupKey);
  }
}

function clearLegacyAdminSessionStorage(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(userStorageKey);
  sessionStorage.removeItem(webTokenKey);
}

/** One-time upgrade: admin sessions previously lived in sessionStorage (tab-scoped). */
function migrateLegacyAdminWebSession(): StoredAuthUser | null {
  if (typeof sessionStorage === "undefined" || typeof localStorage === "undefined") return null;

  const sessionUserRaw = sessionStorage.getItem(userStorageKey);
  if (!sessionUserRaw) return null;

  let parsed: StoredAuthUser;
  try {
    parsed = JSON.parse(sessionUserRaw);
  } catch {
    clearLegacyAdminSessionStorage();
    return null;
  }

  if (parsed?.role !== "admin") return null;

  const legacyToken = sessionStorage.getItem(webTokenKey);
  localStorage.setItem(userStorageKey, sessionUserRaw);
  if (legacyToken) localStorage.setItem(webTokenKey, legacyToken);
  clearLegacyAdminSessionStorage();
  return { ...parsed, sessionToken: legacyToken || undefined };
}

function readWebAdminAuthUser(): StoredAuthUser | null {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(userStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.role === "admin") {
          const token = getWebStoredToken("admin");
          return { ...parsed, sessionToken: token || undefined };
        }
      } catch {
        /* fall through to migration */
      }
    }
  }

  return migrateLegacyAdminWebSession();
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
  if (typeof localStorage === "undefined") return;

  if (role === "admin") {
    if (token) localStorage.setItem(webTokenKey, token);
    else localStorage.removeItem(webTokenKey);
    clearLegacyAdminSessionStorage();
    return;
  }

  // Student web bearer token must be durable for the 7-day inactivity window.
  if (token) localStorage.setItem(webTokenKey, token);
  else localStorage.removeItem(webTokenKey);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(webTokenKey);
}

function getWebStoredToken(role?: StoredAuthUser["role"] | null): string | null {
  if (role === "admin") {
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
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(userStorageKey, JSON.stringify(rest));
        setWebStoredToken(sessionToken || null, "admin");
      }
      clearLegacyAdminSessionStorage();
      return;
    }

    if (typeof localStorage !== "undefined") {
      localStorage.setItem(userStorageKey, JSON.stringify(rest));
      setWebStoredToken(sessionToken || null, "student");
    }
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(userStorageKey);
      if (sessionToken) {
        sessionStorage.setItem(webStudentSessionUserBackupKey, JSON.stringify(rest));
        sessionStorage.setItem(webStudentSessionTokenBackupKey, sessionToken);
      } else {
        sessionStorage.removeItem(webStudentSessionUserBackupKey);
        sessionStorage.removeItem(webStudentSessionTokenBackupKey);
      }
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
      const adminUser = readWebAdminAuthUser();
      if (adminUser) return adminUser;

      const sessionStudentBackup =
        typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(webStudentSessionUserBackupKey)
          : null;
      const stored = typeof localStorage !== "undefined" ? localStorage.getItem(userStorageKey) : null;
      if (!stored && !sessionStudentBackup) return null;
      const rawStored = stored || sessionStudentBackup;
      if (!rawStored) return null;
      const parsed = JSON.parse(rawStored);
      const token =
        getWebStoredToken("student") ||
        (typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(webStudentSessionTokenBackupKey)
          : null);
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
      if (typeof localStorage !== "undefined") {
        const localUser = localStorage.getItem(userStorageKey);
        if (localUser) role = JSON.parse(localUser)?.role ?? null;
      }
      if (!role && typeof sessionStorage !== "undefined") {
        const sessionUser = sessionStorage.getItem(userStorageKey);
        if (sessionUser) {
          const parsedRole = JSON.parse(sessionUser)?.role ?? null;
          if (parsedRole === "admin") {
            migrateLegacyAdminWebSession();
            role = "admin";
          } else {
            role = parsedRole;
          }
        }
      }
      const t = (
        getWebStoredToken(role) ||
        (role !== "admin" && typeof sessionStorage !== "undefined"
          ? sessionStorage.getItem(webStudentSessionTokenBackupKey)
          : null)
      )?.trim();
      return t && t !== "null" && t !== "undefined" ? t : null;
    }
    return await getNativeStoredToken();
  } catch {
    return null;
  }
}
