import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Colors from "@/constants/colors";

const APP_DARK_MODE_KEY = "__3i_app_dark_mode";

export type AppThemeColors = typeof Colors.light & {
  isDark: boolean;
  surface: string;
  surfaceAlt: string;
  input: string;
  overlay: string;
  shadow: string;
};

const lightThemeColors: AppThemeColors = {
  ...Colors.light,
  isDark: false,
  surface: Colors.light.card,
  surfaceAlt: Colors.light.secondary,
  input: Colors.light.background,
  overlay: "rgba(0,0,0,0.5)",
  shadow: "#000000",
};

const darkThemeColors: AppThemeColors = {
  ...Colors.light,
  isDark: true,
  text: "#F8FAFC",
  textSecondary: "#CBD5E1",
  textMuted: "#94A3B8",
  background: "#07111F",
  backgroundSecondary: "#0F1B2D",
  card: "#0F1B2D",
  border: "#26364F",
  secondary: "#172A46",
  tabIconDefault: "#64748B",
  surface: "#0F1B2D",
  surfaceAlt: "#16243A",
  input: "#0A1628",
  overlay: "rgba(0,0,0,0.72)",
  shadow: "#000000",
};

type AppThemeContextValue = {
  isDarkMode: boolean;
  colors: AppThemeColors;
  setDarkMode: (enabled: boolean) => void;
  toggleDarkMode: () => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function readWebDarkMode(): boolean {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return false;
  return localStorage.getItem(APP_DARK_MODE_KEY) === "1";
}

async function persistDarkMode(enabled: boolean) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(APP_DARK_MODE_KEY, enabled ? "1" : "0");
    return;
  }
  await AsyncStorage.setItem(APP_DARK_MODE_KEY, enabled ? "1" : "0");
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDarkMode, setIsDarkMode] = useState(readWebDarkMode);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    AsyncStorage.getItem(APP_DARK_MODE_KEY)
      .then((value) => {
        if (!cancelled) setIsDarkMode(value === "1");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    document.documentElement.style.backgroundColor = isDarkMode
      ? darkThemeColors.background
      : lightThemeColors.background;
    document.body.style.backgroundColor = isDarkMode
      ? darkThemeColors.background
      : lightThemeColors.background;
  }, [isDarkMode]);

  const value = useMemo<AppThemeContextValue>(() => {
    const setDarkMode = (enabled: boolean) => {
      setIsDarkMode(enabled);
      persistDarkMode(enabled).catch(() => {});
    };
    return {
      isDarkMode,
      colors: isDarkMode ? darkThemeColors : lightThemeColors,
      setDarkMode,
      toggleDarkMode: () => setDarkMode(!isDarkMode),
    };
  }, [isDarkMode]);

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    return {
      isDarkMode: false,
      colors: lightThemeColors,
      setDarkMode: () => {},
      toggleDarkMode: () => {},
    };
  }
  return ctx;
}
