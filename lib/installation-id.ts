/**
 * Stable per-install identifier (not per login).
 * Web uses it only to recognize the same browser profile for active-session
 * locking; native may use it for future device binding.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";

const STORAGE_KEY = "@3i_installation_id_v1";

// In-memory cache of the resolved installation id. Once we have read (or
// generated) the id within this app session, we keep it here so a later
// transient storage read failure (AsyncStorage/localStorage rejecting under
// I/O pressure, app backgrounding, private mode, etc.) never causes us to drop
// the x-app-device-id header. Dropping that header made the server treat the
// request as device_id_missing and log active students out mid-lecture.
let cachedInstallationId: string | null = null;

function randomId(): string {
  return `${Date.now().toString(36)}_${Crypto.randomUUID().replace(/-/g, "")}`;
}

/** All clients should send this string on every API call (see query-client headers). */
export async function getInstallationId(): Promise<string> {
  if (Platform.OS === "web") {
    try {
      if (typeof window !== "undefined") {
        let v = window.localStorage?.getItem(STORAGE_KEY);
        if (!v) {
          // Reuse the in-memory id if storage was just unavailable/cleared so
          // we keep sending the SAME id (avoids a spurious device mismatch).
          v = cachedInstallationId || randomId();
          window.localStorage.setItem(STORAGE_KEY, v);
        }
        cachedInstallationId = v;
        return v;
      }
    } catch {
      /* storage unavailable — fall back to the cached id if we have one */
    }
    return cachedInstallationId || "web_anon";
  }

  try {
    let v = await AsyncStorage.getItem(STORAGE_KEY);
    if (!v) {
      v = cachedInstallationId || randomId();
      await AsyncStorage.setItem(STORAGE_KEY, v);
    }
    cachedInstallationId = v;
    return v;
  } catch {
    // AsyncStorage rejected transiently. Never throw (that would drop the
    // device header and log the user out). Reuse the cached id, or mint a
    // stable one for this session so the header is always present.
    if (!cachedInstallationId) cachedInstallationId = randomId();
    return cachedInstallationId;
  }
}
