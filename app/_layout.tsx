import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { authFetch, getApiUrl, queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WebDownloadJobsProvider } from "@/context/WebDownloadJobsContext";
import { WebDownloadHud } from "@/components/WebDownloadHud";
import { WebAppHeader } from "@/components/WebAppHeader";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { Platform, AppState, AppStateStatus } from "react-native";
import { DownloadManagerProvider, useDownloadManager } from "@/lib/useDownloadManager";
import { listWebOfflineKeys, removeWebOffline } from "@/lib/web-offline-store";

SplashScreen.preventAutoHideAsync();

// Lock to portrait on mobile (native)
if (Platform.OS !== "web") {
  ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
}
// Lock to portrait on mobile web (phone browsers)
if (Platform.OS === "web" && typeof window !== "undefined" && typeof screen !== "undefined") {
  try {
    const lockOrientation = (screen as any).orientation?.lock;
    if (lockOrientation && window.innerWidth < 768) {
      (screen as any).orientation.lock("portrait-primary").catch(() => {});
    }
  } catch {}
}

function RootLayoutNav() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const { runForegroundAccessCheck } = useDownloadManager();
  /** Avoid stacking duplicate login routes if the splash segment effect runs twice before segments settle. */
  const incompleteSplashNavDoneRef = useRef(false);

  useEffect(() => {
    if (!user || user.profileComplete) incompleteSplashNavDoneRef.current = false;
  }, [user?.id, user?.profileComplete]);

  // Native: sync offline downloads with server on cold start and when returning to foreground.
  useEffect(() => {
    if (Platform.OS === "web" || !user?.id) return;
    runForegroundAccessCheck().catch((error) => {
      console.error("[RootLayout] Initial foreground access check failed:", error);
    });
  }, [user?.id, runForegroundAccessCheck]);

  useEffect(() => {
    if (Platform.OS !== "web" || !user?.id) return;
    const syncWebRevocations = async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/my-downloads", baseUrl).toString());
        if (!res.ok) return;
        const payload = await res.json();
        const data = payload?.data ?? payload ?? {};
        const allowed = new Set<string>();
        [...(data.lectures || []), ...(data.materials || [])].forEach((i: any) => {
          const iid = Number(i.id);
          if (!Number.isFinite(iid)) return;
          allowed.add(`${Number(user.id)}:${String(i.type)}:${iid}`);
        });
        const keys = await listWebOfflineKeys();
        for (const key of keys) {
          if (!key.startsWith(`${Number(user.id)}:`)) continue;
          if (allowed.has(key)) continue;
          const [uidStr, type, idStr] = key.split(":");
          const uid = Number(uidStr);
          const id = Number(idStr);
          if (!Number.isFinite(uid) || !Number.isFinite(id) || !type) continue;
          await removeWebOffline(uid, type, id).catch(() => {});
        }
      } catch {
        // best effort
      }
    };
    syncWebRevocations();
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - run access check
        runForegroundAccessCheck().catch((error) => {
          console.error('[RootLayout] Foreground access check failed:', error);
        });
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [runForegroundAccessCheck]);

  useEffect(() => {
    if (isLoading) return;
    const currentSegment = segments[0];
    if (!currentSegment) {
      if (user) {
        if (user.profileComplete) {
          router.replace(Platform.OS === "web" ? "/welcome" : "/(tabs)");
        } else {
          if (!incompleteSplashNavDoneRef.current) {
            incompleteSplashNavDoneRef.current = true;
            if (Platform.OS === "web") {
              // Keep /welcome in history so Back from login returns to the website homepage.
              router.replace("/welcome");
              setTimeout(() => {
                router.push("/(auth)/email-login");
              }, 0);
            } else {
              router.replace("/(auth)/email-login");
            }
          }
        }
      } else {
        router.replace(Platform.OS === "web" ? "/welcome" : "/(auth)/email-login");
      }
      return;
    }

    const inAuthGroup = currentSegment === "(auth)";
    const inProfileSetup = currentSegment === "profile-setup";
    const inWelcome = currentSegment === "welcome";
    // useSegments() is typed as a length-1 tuple; avoid segments[1] (TS tuple index error in CI)
    const authChild = (segments as readonly string[]).at(1);
    // Allow all auth sub-routes (password login, phone OTP, OTP verify) without forcing a jump.
    const inAuthSubScreen = inAuthGroup && (authChild === "email-login" || authChild === "login" || authChild === "otp");
    // Incomplete profile: still allow browsing/purchase flows (e.g. return from Razorpay to /course/...?payment=success)
    const incompleteUserAllowedTopSegments = new Set([
      "course",
      "course-folder",
      "store",
      "lecture",
      "test",
      "test-result",
      "test-folder",
      "test-verify",
      "material",
      "material-folder",
      "mission-folder",
      "live-class",
      "notifications",
      "downloads",
    ]);

    if (user) {
      if (user.profileComplete) {
        if (inAuthGroup || (Platform.OS !== "web" && inWelcome)) {
          router.replace("/(tabs)");
        }
        return;
      }

      // Incomplete profile: allow /welcome (e.g. user tapped Back from login); initial load stacks welcome→login from !currentSegment above.
      if (inWelcome) {
        return;
      }
      if (inAuthGroup) {
        // Once authenticated, incomplete-profile users should leave auth screens
        // and continue profile completion.
        if (inAuthSubScreen) {
          router.replace("/profile-setup");
          return;
        }
        router.replace("/profile-setup");
        return;
      }
      if (inProfileSetup) {
        // Incomplete users must stay on profile-setup until details are saved.
        // The previous one-time web flag caused bounce-back to auth on re-render.
        return;
      }
      if (incompleteUserAllowedTopSegments.has(currentSegment)) {
        return;
      }
      router.replace("/(auth)/email-login");
      return;
    }

    // Unauthenticated users may reach /profile-setup directly via the
    // registrationToken handoff from /api/auth/verify-otp. The screen itself
    // validates the token; the layout just needs to not bounce them back.
    // Admin routes gate auth themselves; avoid welcome bounce on refresh races.
    if (currentSegment === "admin") {
      return;
    }
    if (!inAuthGroup && !inWelcome && !inProfileSetup) {
      router.replace(Platform.OS === "web" ? "/welcome" : "/(auth)/email-login");
    }
  }, [user?.id, user?.profileComplete, isLoading, segments.join("/")]);

  // Don't render anything until auth is resolved — prevents flash of wrong screen
  if (isLoading) return null;

  const currentSegment = segments[0];
  const showWebAppHeader =
    Platform.OS === "web" &&
    !!user?.profileComplete &&
    currentSegment !== "admin" &&
    currentSegment !== "(auth)" &&
    currentSegment !== "welcome" &&
    currentSegment !== "profile-setup";
  const webHeaderScreenOptions = showWebAppHeader
    ? { headerShown: true, header: () => <WebAppHeader /> }
    : { headerShown: false };

  return (
    <Stack screenOptions={webHeaderScreenOptions}>
      <Stack.Screen name="(tabs)" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="store" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="notifications" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="course/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="course-folder/[id]/[type]/[name]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="lecture/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="test/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="test-result/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="test-folder/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="mission-folder/[name]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="live-class/[id]" options={{ headerShown: showWebAppHeader }} />
      <Stack.Screen name="admin/index" options={{ headerShown: false }} />
      <Stack.Screen name="admin/course/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="admin/course/[id]/student/[userId]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const apiBase = getApiUrl();
    const appCommit = process.env.EXPO_PUBLIC_APP_COMMIT || "";
    fetch(new URL("/api/health/version", apiBase).toString(), { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!payload) return;
        const backendCommit = String(payload.commit || "");
        if (appCommit && backendCommit && appCommit !== backendCommit) {
          console.warn("[VersionCheck] frontend/backend commit mismatch", { appCommit, backendCommit });
        }
      })
      .catch(() => {});
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <KeyboardProvider>
            <AuthProvider>
              <DownloadManagerProvider>
                <WebDownloadJobsProvider>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                  <WebDownloadHud />
                </WebDownloadJobsProvider>
              </DownloadManagerProvider>
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
