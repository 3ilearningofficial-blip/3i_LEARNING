import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/query-client";
import Colors from "@/constants/colors";

const DURATION_PRESETS = [20, 30, 60, 120];

type Props = {
  liveClassId: string;
  isAdmin?: boolean;
  sessionActive?: boolean;
};

export default function ClassroomHeaderActivityTimer({
  liveClassId,
  isAdmin = false,
  sessionActive = true,
}: Props) {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const [timerLabel, setTimerLabel] = useState("Timer");
  const [timerDuration, setTimerDuration] = useState("60");
  const clockBtnRef = useRef<View>(null);

  useEffect(() => {
    if (!sessionActive) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [sessionActive]);

  const { data: activeTimer } = useQuery({
    queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/live-classes/${liveClassId}/activity-timer/active`, undefined);
      if (!res.ok) return null;
      const json = await res.json();
      return json.timer as { label?: string; ends_at?: number; remainingSeconds?: number } | null;
    },
    refetchInterval: 800,
    enabled: !!liveClassId && sessionActive && Platform.OS === "web",
  });

  const startTimer = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/live-classes/${liveClassId}/activity-timer`, {
        label: timerLabel.trim() || "Timer",
        durationSeconds: Number(timerDuration) || 60,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to start timer");
      }
      return res.json();
    },
    onSuccess: () => {
      setPopoverOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"] });
    },
  });

  useEffect(() => {
    if (!popoverOpen || Platform.OS !== "web" || typeof document === "undefined") return;
    const measure = () => {
      const el = clockBtnRef.current as unknown as HTMLElement | null;
      if (!el?.getBoundingClientRect) return;
      const rect = el.getBoundingClientRect();
      const width = 260;
      setPopoverPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [popoverOpen]);

  if (Platform.OS !== "web" || !sessionActive) return null;

  const timerRemaining =
    activeTimer?.ends_at && Number(activeTimer.ends_at) > Date.now()
      ? Math.max(0, Math.ceil((Number(activeTimer.ends_at) - Date.now()) / 1000))
      : 0;
  const showCountdown = timerRemaining > 0;
  void tick;

  const popoverBody = (
    <>
      <Text style={styles.popoverTitle}>Student answer timer</Text>
      <TextInput
        style={styles.input}
        value={timerLabel}
        onChangeText={setTimerLabel}
        placeholder="Label shown to students"
      />
      <View style={styles.presetRow}>
        {DURATION_PRESETS.map((s) => (
          <Pressable
            key={s}
            style={[styles.presetBtn, timerDuration === String(s) && styles.presetBtnActive]}
            onPress={() => setTimerDuration(String(s))}
          >
            <Text style={styles.presetText}>{s}s</Text>
          </Pressable>
        ))}
        <TextInput
          style={styles.durationInput}
          value={timerDuration}
          onChangeText={setTimerDuration}
          keyboardType="number-pad"
        />
      </View>
      <Pressable
        style={styles.startBtn}
        onPress={() => void startTimer.mutate()}
        disabled={startTimer.isPending}
      >
        {startTimer.isPending ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.startBtnText}>Start timer</Text>
        )}
      </Pressable>
    </>
  );

  if (isAdmin) {
    return (
      <View style={styles.adminWrap}>
        {showCountdown ? (
          <View style={styles.countPill}>
            <Ionicons name="time-outline" size={14} color="#FDE68A" />
            <Text style={styles.countText}>{timerRemaining}s</Text>
          </View>
        ) : null}
        <View ref={clockBtnRef} collapsable={false}>
          <Pressable
            style={[styles.clockBtn, popoverOpen && styles.clockBtnActive]}
            onPress={() => setPopoverOpen((v) => !v)}
            accessibilityLabel="Student answer timer"
          >
            <Ionicons name="timer-outline" size={18} color="#fff" />
          </Pressable>
        </View>
        <Modal visible={popoverOpen} transparent animationType="fade" onRequestClose={() => setPopoverOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPopoverOpen(false)}>
            <Pressable
              style={[
                styles.popoverFixed,
                { top: popoverPos.top, left: popoverPos.left } as object,
              ]}
              onPress={(e) => e.stopPropagation?.()}
            >
              {popoverBody}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    );
  }

  /* Students see the timer on the video player overlay only. */
  return null;
}

const styles = StyleSheet.create({
  adminWrap: { position: "relative", flexDirection: "row", alignItems: "center", gap: 6, zIndex: 50 },
  clockBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  clockBtnActive: { backgroundColor: "rgba(255,255,255,0.25)" },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(30,58,138,0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  countText: { fontSize: 12, fontWeight: "800", color: "#FDE68A", fontVariant: ["tabular-nums"] },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  popoverFixed: {
    position: "absolute",
    width: 260,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    zIndex: 10000,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 24,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  popoverTitle: { fontSize: 13, fontWeight: "700", color: Colors.light.text, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10, alignItems: "center" },
  presetBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  presetBtnActive: { borderColor: Colors.light.primary, backgroundColor: "#EFF6FF" },
  presetText: { fontSize: 11, fontWeight: "600" },
  durationInput: {
    width: 48,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 6,
    paddingVertical: 5,
    textAlign: "center",
    fontSize: 12,
  },
  startBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  startBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});
