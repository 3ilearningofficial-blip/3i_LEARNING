import React, { useMemo } from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useWebDownloadJobs } from "@/context/WebDownloadJobsContext";
import Colors from "@/constants/colors";

/** Floating progress for web downloads so visibility survives route changes inside the SPA. */
export function WebDownloadHud() {
  const { jobs } = useWebDownloadJobs();

  const active = useMemo(
    () => Object.values(jobs).filter((j) => j.status === "downloading"),
    [jobs]
  );

  if (Platform.OS !== "web" || active.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>
          Downloading… {active.length > 1 ? `(${active.length})` : ""}
        </Text>
        {active.map((j) => (
          <View key={`${j.itemType}:${j.itemId}`} style={{ marginTop: 8 }}>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {j.title}
            </Text>
            <View style={styles.bar}>
              <View
                style={[
                  styles.fill,
                  { width: `${Math.max(0, Math.min(100, j.progress))}%` } as { width: `${number}%` },
                ]}
              />
            </View>
            <Text style={styles.pct}>{j.progress}%</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: Platform.OS === "web" ? ("fixed" as any) : "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    paddingHorizontal: 12,
    paddingBottom: Platform.OS === "web" ? 20 : 12,
    pointerEvents: "box-none",
    alignItems: "center",
  },
  card: {
    alignSelf: "stretch",
    maxWidth: 480,
    backgroundColor: "rgba(10,22,40,0.94)",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  title: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: "#e2e8f0",
  },
  itemTitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#cbd5e1",
    marginBottom: 6,
  },
  bar: {
    height: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 3,
    overflow: "hidden",
  },
  fill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.light.primary,
  },
  pct: {
    fontSize: 11,
    marginTop: 4,
    color: "#94a3b8",
    fontFamily: "Inter_500Medium",
    textAlign: "right",
  },
});
