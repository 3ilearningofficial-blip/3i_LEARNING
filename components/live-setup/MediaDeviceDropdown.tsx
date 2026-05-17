import React from "react";
import { Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";

export type MediaDeviceDropdownProps = {
  label: string;
  devices: MediaDeviceInfo[];
  selectedId: string;
  onSelect: (deviceId: string) => void;
  fallback: string;
  emptyText?: string;
};

/** Native stub — web implementation is in MediaDeviceDropdown.web.tsx */
export default function MediaDeviceDropdown(_props: MediaDeviceDropdownProps) {
  return <Text style={styles.note}>Device selection is available on web.</Text>;
}

const styles = StyleSheet.create({
  note: { fontSize: 12, color: Colors.light.textMuted },
});
