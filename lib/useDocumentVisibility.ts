import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";

/** True when the app tab/window is in the foreground (web: !document.hidden). */
export function useDocumentVisibility(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const sync = () => setVisible(!document.hidden);
      sync();
      document.addEventListener("visibilitychange", sync);
      return () => document.removeEventListener("visibilitychange", sync);
    }
    const sync = () => setVisible(AppState.currentState === "active");
    sync();
    const sub = AppState.addEventListener("change", (s) => setVisible(s === "active"));
    return () => sub.remove();
  }, []);

  return visible;
}
