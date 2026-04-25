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
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { getApiUrl, queryClient } from "@/lib/query-client";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import { Platform, AppState, AppStateStatus } from "react-native";
import { useDownloadManager } from "@/lib/useDownloadManager";

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

  // AppState listener for foreground access check
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
    if (!currentSegment) return;

    const inAuthGroup = currentSegment === "(auth)";
    const inProfileSetup = currentSegment === "profile-setup";
    const inWelcome = currentSegment === "welcome";

    if (user) {
      const target = user.profileComplete ? "/(tabs)" : "/profile-setup";
      if (inAuthGroup || inWelcome) {
        router.replace(target);
        return;
      }
      if (!user.profileComplete && !inProfileSetup) {
        router.replace("/profile-setup");
      }
      return;
    }

    if (!inAuthGroup && !inWelcome) {
      router.replace("/welcome");
    }
  }, [user?.id, user?.profileComplete, isLoading, segments.join("/")]);

  // Don't render anything until auth is resolved — prevents flash of wrong screen
  if (isLoading) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="welcome" options={{ headerShown: false }} />
      <Stack.Screen name="profile-setup" options={{ headerShown: false }} />
      <Stack.Screen name="profile" options={{ headerShown: false }} />
      <Stack.Screen name="store" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="course/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="lecture/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="test/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="test-result/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="test-folder/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="live-class/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="admin/index" options={{ headerShown: false }} />
      <Stack.Screen name="admin/course/[id]" options={{ headerShown: false }} />
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
              <StatusBar style="light" />
              <RootLayoutNav />
            </AuthProvider>
          </KeyboardProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
