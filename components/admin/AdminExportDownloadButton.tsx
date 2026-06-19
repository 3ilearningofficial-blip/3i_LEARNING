import React from "react";
import { Pressable, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { downloadAdminContent, type AdminExportKind } from "@/lib/admin-export";

type Props = {
  kind: AdminExportKind;
  id: number;
  filename?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  stopPropagation?: boolean;
  /** icon = green pill on lists; header = light pill on dark modal headers */
  variant?: "icon" | "header";
};

export function AdminExportDownloadButton({
  kind,
  id,
  filename,
  size = 16,
  style,
  stopPropagation = false,
  variant = "icon",
}: Props) {
  const isHeader = variant === "header";
  return (
    <Pressable
      style={[
        {
          backgroundColor: isHeader ? "rgba(255,255,255,0.15)" : "#ECFDF5",
          borderRadius: isHeader ? 10 : 8,
          padding: isHeader ? 8 : 6,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      onPress={(e) => {
        if (stopPropagation) e?.stopPropagation?.();
        void downloadAdminContent(kind, id, filename);
      }}
      accessibilityLabel="Download"
    >
      <Ionicons name="download-outline" size={size} color={isHeader ? "#fff" : "#059669"} />
    </Pressable>
  );
}
