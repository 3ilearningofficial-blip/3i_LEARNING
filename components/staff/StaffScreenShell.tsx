import React from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import { StaffWebHeader } from "./StaffWebHeader";

/** Wraps staff screens on narrow web with the teacher header (phone / tablet). */
export function StaffScreenShell({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const showHeader = Platform.OS === "web" && width < 900;

  if (!showHeader) return <>{children}</>;

  return (
    <View style={{ flex: 1 }}>
      <StaffWebHeader />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
