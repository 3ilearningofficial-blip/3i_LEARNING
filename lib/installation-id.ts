/**
 * Stable per-install identifier (not per login). Used for one-installation
 * paid-content binding across web + native.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Crypto from "expo-crypto";

const STORAGE_KEY = "@3i_installation_id_v1";

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
          v = randomId();
          window.localStorage.setItem(STORAGE_KEY, v);
        }
        return v;
      }
    } catch {
      /* fallback */
    }
    return "web_anon";
  }
  let v = await AsyncStorage.getItem(STORAGE_KEY);
  if (!v) {
    v = randomId();
    await AsyncStorage.setItem(STORAGE_KEY, v);
  }
  return v;
}
