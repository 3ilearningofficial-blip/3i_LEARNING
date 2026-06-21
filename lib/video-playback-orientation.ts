import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";

let landscapePlaybackDepth = 0;

async function lockLandscapeNative(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  } catch {
    try {
      await ScreenOrientation.unlockAsync();
    } catch {
      /* ignore */
    }
  }
}

async function restorePortraitNative(): Promise<void> {
  try {
    await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
  } catch {
    /* ignore */
  }
}

function lockLandscapeWeb(): void {
  if (typeof window === "undefined") return;
  try {
    const o = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    if (o?.lock) {
      const lockFn = o.lock.bind(o);
      void lockFn("landscape-primary").catch(() => {
        void lockFn("landscape").catch(() => {});
      });
    }
  } catch {
    /* ignore — Safari may reject outside fullscreen */
  }
}

function restorePortraitWeb(): void {
  if (typeof window === "undefined") return;
  try {
    const o = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
    if (o?.lock) {
      void o.lock("portrait-primary").catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

/** Lock landscape when student enters video fullscreen. */
export async function lockLandscapeForPlayback(): Promise<void> {
  landscapePlaybackDepth += 1;
  if (landscapePlaybackDepth > 1) return;
  if (Platform.OS === "web") {
    lockLandscapeWeb();
  } else {
    await lockLandscapeNative();
  }
}

/** Restore portrait when student exits video fullscreen. */
export async function restorePortraitAfterPlayback(): Promise<void> {
  if (landscapePlaybackDepth <= 0) return;
  landscapePlaybackDepth -= 1;
  if (landscapePlaybackDepth > 0) return;
  if (Platform.OS === "web") {
    restorePortraitWeb();
  } else {
    await restorePortraitNative();
  }
}

/** Handle fullscreen messages from WebView / iframe HTML players. */
export function handlePlaybackFullscreenMessage(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const parsed = JSON.parse(data) as { event?: string; active?: boolean };
    if (parsed?.event !== "fullscreen") return false;
    if (parsed.active) {
      void lockLandscapeForPlayback();
    } else {
      void restorePortraitAfterPlayback();
    }
    return true;
  } catch {
    return false;
  }
}

/** Default portrait lock for the app; call from root layout on mount. */
export async function lockDefaultPortrait(): Promise<void> {
  if (landscapePlaybackDepth > 0) return;
  if (Platform.OS === "web") {
    restorePortraitWeb();
  } else {
    await restorePortraitNative();
  }
}

/**
 * Safety net: restore portrait when leaving a video screen.
 * Does not lock landscape on mount — fullscreen handlers do that.
 */
export function useVideoPlaybackOrientation(): void {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      landscapePlaybackDepth = 0;
      if (Platform.OS === "web") {
        restorePortraitWeb();
      } else {
        void restorePortraitNative();
      }
    };
  }, []);
}
