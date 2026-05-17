import React, { type CSSProperties } from "react";
import { View, Text, StyleSheet } from "react-native";
import Colors from "@/constants/colors";
import type { MediaDeviceDropdownProps } from "./MediaDeviceDropdown";

function deviceLabel(device: MediaDeviceInfo, fallback: string): string {
  const label = device.label?.trim();
  if (label) return label;
  return `${fallback} (${device.deviceId.slice(0, 8)}…)`;
}

export default function MediaDeviceDropdown({
  label,
  devices,
  selectedId,
  onSelect,
  fallback,
  emptyText = "No devices found — allow browser access.",
}: MediaDeviceDropdownProps) {
  if (devices.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.empty}>{emptyText}</Text>
      </View>
    );
  }

  const value = selectedId || devices[0]?.deviceId || "";

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <select
        value={value}
        onChange={(e) => onSelect(e.target.value)}
        style={selectStyle}
        aria-label={label}
      >
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {deviceLabel(device, fallback)}
          </option>
        ))}
      </select>
    </View>
  );
}

const selectStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 13,
  borderRadius: 8,
  border: `1px solid ${Colors.light.border}`,
  backgroundColor: "#fff",
  color: Colors.light.text,
  cursor: "pointer",
  outline: "none",
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 10 },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.light.text,
    marginBottom: 6,
  },
  empty: { fontSize: 11, color: Colors.light.textMuted, lineHeight: 16 },
});
