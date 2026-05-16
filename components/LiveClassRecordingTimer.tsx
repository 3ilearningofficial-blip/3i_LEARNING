import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { formatLiveDuration } from "@/lib/live-class/formatLiveDuration";

type Props = {
  /** Unix ms when class went live (`live_classes.started_at`) */
  startedAt?: number | null;
  /** Show timer while live even if started_at missing (counts from mount) */
  active?: boolean;
  compact?: boolean;
};

export default function LiveClassRecordingTimer({ startedAt, active = true, compact = false }: Props) {
  const [anchorMs] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    const base = startedAt && Number(startedAt) > 0 ? Number(startedAt) : anchorMs;
    const tick = () => setElapsed(Math.max(0, Date.now() - base));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [active, startedAt, anchorMs]);

  if (!active) return null;

  return (
    <View style={[styles.wrap, compact && styles.wrapCompact]}>
      <View style={styles.dot} />
      <Text style={[styles.rec, compact && styles.recCompact]}>REC</Text>
      <Text style={[styles.time, compact && styles.timeCompact]}>{formatLiveDuration(elapsed)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  wrapCompact: { paddingHorizontal: 8, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  rec: { fontSize: 11, fontWeight: "800", color: "#FCA5A5", letterSpacing: 0.5 },
  recCompact: { fontSize: 10 },
  time: { fontSize: 13, fontWeight: "700", color: "#fff", fontVariant: ["tabular-nums"] },
  timeCompact: { fontSize: 12 },
});
