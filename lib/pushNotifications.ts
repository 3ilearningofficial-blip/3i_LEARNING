import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { apiRequest } from "./query-client";

let currentToken: string | null = null;
let configured = false;

function configureHandler() {
  if (configured) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  configured = true;
}

function getProjectId(): string | null {
  const fromExpoConfig = (Constants.expoConfig as any)?.extra?.eas?.projectId;
  const fromEasConfig = (Constants as any)?.easConfig?.projectId;
  return (fromExpoConfig || fromEasConfig || null) as string | null;
}

export async function registerPushForCurrentUser(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  configureHandler();
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#1A56DB",
    });
  }

  const projectId = getProjectId();
  const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const token = String(tokenData.data || "").trim();
  if (!token) return null;
  currentToken = token;
  await apiRequest("POST", "/push/register", {
    token,
    platform: Platform.OS,
  });
  return token;
}

export async function unregisterPushForCurrentUser(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    if (currentToken) {
      await apiRequest("POST", "/push/unregister", { token: currentToken });
    } else {
      await apiRequest("POST", "/push/unregister-all", {});
    }
  } catch {
    // Ignore unregister failures during logout.
  }
  currentToken = null;
}

