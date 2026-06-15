import { useContext } from "react";
import { BottomTabBarHeightContext } from "@react-navigation/bottom-tabs";

/** Returns tab bar height when inside Bottom Tabs; 0 on /home and other stack routes. */
export function useOptionalBottomTabBarHeight(): number {
  return useContext(BottomTabBarHeightContext) ?? 0;
}
