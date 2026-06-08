import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";

type Props = {
  liveClassId: string;
  isAdmin?: boolean;
  sessionActive?: boolean;
  enabled?: boolean;
};

type ActiveTimer = {
  label?: string;
  ends_at?: number;
  remainingSeconds?: number;
  overlay_x_pct?: number;
  overlay_y_pct?: number;
};

function clampPct(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function timerRemainingFromEndsAt(endsAt: number | undefined, tick: number): number {
  void tick;
  if (!endsAt || !Number.isFinite(endsAt)) return 0;
  return Math.max(0, Math.ceil((Number(endsAt) - Date.now()) / 1000));
}

export default function ClassroomLiveOverlays({
  liveClassId,
  isAdmin = false,
  sessionActive = true,
  enabled = true,
}: Props) {
  const qc = useQueryClient();
  const [tick, setTick] = useState(0);
  const [authBlocked, setAuthBlocked] = useState(false);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  const layerRef = useRef<View>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    boxW: number;
    boxH: number;
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAuthBlocked(false);
  }, [enabled, liveClassId]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: activePoll } = useQuery({
    queryKey: ["/api/live-classes", liveClassId, "polls", "active"],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/polls/active`);
      if (res.status === 401) {
        setAuthBlocked(true);
        return null;
      }
      if (!res.ok) return null;
      const json = await res.json();
      return json.poll as any;
    },
    refetchInterval: 800,
    enabled: !!liveClassId && sessionActive && enabled && !authBlocked && Platform.OS === "web",
  });

  const { data: activeTimer } = useQuery({
    queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"],
    queryFn: async () => {
      const res = await authFetch(`${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/activity-timer/active`);
      if (res.status === 401) {
        setAuthBlocked(true);
        return null;
      }
      if (!res.ok) return null;
      const json = await res.json();
      return json.timer as ActiveTimer | null;
    },
    refetchInterval: 800,
    enabled: !!liveClassId && sessionActive && enabled && !authBlocked && Platform.OS === "web",
  });

  const vote = useMutation({
    mutationFn: async ({ pollId, optionId }: { pollId: number; optionId: number }) => {
      const res = await apiRequest("POST", `/api/live-classes/${liveClassId}/polls/${pollId}/vote`, {
        optionId,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Vote failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
    },
  });

  const saveOverlayPosition = useMutation({
    mutationFn: async ({ xPct, yPct }: { xPct: number; yPct: number }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/admin/live-classes/${liveClassId}/activity-timer/overlay-position`,
        { xPct, yPct }
      );
      if (!res.ok) throw new Error("Failed to save position");
      return { xPct, yPct };
    },
    onSuccess: (data) => {
      qc.setQueryData(
        ["/api/live-classes", liveClassId, "activity-timer", "active"],
        (prev: ActiveTimer | null | undefined) =>
          prev ? { ...prev, overlay_x_pct: data.xPct, overlay_y_pct: data.yPct } : prev
      );
      qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"] });
    },
  });

  const scheduleSavePosition = useCallback(
    (x: number, y: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void saveOverlayPosition.mutate({ xPct: x, yPct: y });
      }, 400);
    },
    [saveOverlayPosition]
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const timerEndsAt = activeTimer?.ends_at;
  const timerRemaining = timerRemainingFromEndsAt(timerEndsAt, tick);

  useEffect(() => {
    if (timerRemaining <= 0) setDragPos(null);
  }, [timerRemaining]);

  const onTimerDragStart = useCallback(
    (clientX: number, clientY: number) => {
      if (!isAdmin || Platform.OS !== "web") return;
      const el = layerRef.current as unknown as HTMLElement | null;
      const rect = el?.getBoundingClientRect?.();
      if (!rect?.width || !rect?.height) return;
      const x = dragPos?.x ?? Number(activeTimer?.overlay_x_pct ?? 85);
      const y = dragPos?.y ?? Number(activeTimer?.overlay_y_pct ?? 8);
      dragRef.current = {
        startX: clientX,
        startY: clientY,
        originX: x,
        originY: y,
        boxW: rect.width,
        boxH: rect.height,
      };
    },
    [isAdmin, dragPos, activeTimer?.overlay_x_pct, activeTimer?.overlay_y_pct]
  );

  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;

    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = ((e.clientX - d.startX) / d.boxW) * 100;
      const dy = ((e.clientY - d.startY) / d.boxH) * 100;
      const x = clampPct(d.originX + dx, 4, 72);
      const y = clampPct(d.originY + dy, 4, 78);
      const next = { x, y };
      dragPosRef.current = next;
      setDragPos(next);
    };

    const onUp = () => {
      const p = dragPosRef.current;
      if (p) scheduleSavePosition(p.x, p.y);
      dragRef.current = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [scheduleSavePosition]);

  if (Platform.OS !== "web" || !sessionActive) return null;

  const pollRemaining =
    activePoll && Number(activePoll.ends_at) > Date.now()
      ? Math.max(0, Math.ceil((Number(activePoll.ends_at) - Date.now()) / 1000))
      : 0;

  const timerX = dragPos?.x ?? Number(activeTimer?.overlay_x_pct ?? 85);
  const timerY = dragPos?.y ?? Number(activeTimer?.overlay_y_pct ?? 8);
  const timerLabel = String(activeTimer?.label || "").trim() || "Time remaining";

  return (
    <View ref={layerRef} style={styles.layer} pointerEvents="box-none" collapsable={false}>
      {activePoll && pollRemaining > 0 && !isAdmin ? (
        <View style={styles.pollAnchor}>
          <View style={styles.pollCard}>
            <Text style={styles.pollKind}>
              {activePoll.kind === "quiz" ? "Quiz" : "Poll"} · {pollRemaining}s
            </Text>
            <Text style={styles.pollQ}>{activePoll.question}</Text>
            {(activePoll.options || []).map((opt: { id: number; label: string }) => {
              const voted = Number(activePoll.myVoteOptionId) === Number(opt.id);
              return (
                <Pressable
                  key={opt.id}
                  style={[styles.pollOpt, voted && styles.pollOptVoted]}
                  onPress={() => void vote.mutate({ pollId: activePoll.id, optionId: opt.id })}
                  disabled={vote.isPending}
                >
                  <Text style={styles.pollOptText}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {timerRemaining > 0 ? (
        <View
          style={[
            styles.timerWrap,
            { left: `${timerX}%`, top: `${timerY}%` } as object,
          ]}
          pointerEvents={isAdmin ? "auto" : "none"}
        >
          <Pressable
            style={[
              styles.timerCard,
              isAdmin && styles.timerCardDraggable,
              !isAdmin && styles.timerCardStudent,
            ]}
            onPressIn={(e) => {
              if (!isAdmin) return;
              const ne = (e as unknown as { nativeEvent?: { clientX?: number; clientY?: number } })
                .nativeEvent;
              if (ne?.clientX != null && ne?.clientY != null) {
                onTimerDragStart(ne.clientX, ne.clientY);
              }
            }}
            // @ts-expect-error web mouse drag
            onMouseDown={(e: MouseEvent) => {
              if (!isAdmin) return;
              e.preventDefault();
              onTimerDragStart(e.clientX, e.clientY);
            }}
          >
            {isAdmin ? (
              <>
                <Ionicons name="move" size={12} color="#94A3B8" style={styles.timerDragHint} />
                <Text style={styles.timerLabel} numberOfLines={2}>
                  {timerLabel}
                </Text>
                <Text style={styles.timerCount}>{timerRemaining}s</Text>
              </>
            ) : (
              <View style={styles.timerStudentRow}>
                <Ionicons name="time-outline" size={20} color="#FDE68A" />
                <Text style={styles.timerCountStudent}>{timerRemaining}</Text>
              </View>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    pointerEvents: "box-none",
  },
  pollAnchor: {
    position: "absolute",
    top: 16,
    right: 16,
    left: 16,
    alignItems: "flex-end",
    pointerEvents: "box-none",
  },
  pollCard: {
    backgroundColor: "rgba(15,23,42,0.94)",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    maxWidth: 340,
    width: "100%",
    borderWidth: 1,
    borderColor: "#334155",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  pollKind: { color: "#94A3B8", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  pollQ: { color: "#fff", fontSize: 14, fontWeight: "600", marginBottom: 10, lineHeight: 20 },
  pollOpt: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#1E293B",
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  pollOptVoted: { borderColor: Colors.light.primary, backgroundColor: "#1E3A5F" },
  pollOptText: { color: "#E2E8F0", fontSize: 13 },
  timerWrap: {
    position: "absolute",
    maxWidth: 220,
    zIndex: 41,
  },
  timerCard: {
    backgroundColor: "rgba(30,58,138,0.92)",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#3B82F6",
    minWidth: 120,
  },
  timerCardStudent: {
    minWidth: 72,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  timerCardDraggable: { cursor: "grab" as unknown as undefined },
  timerDragHint: { position: "absolute", top: 6, right: 8 },
  timerStudentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  timerLabel: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 4,
    paddingRight: 14,
    lineHeight: 16,
  },
  timerCount: {
    color: "#FDE68A",
    fontSize: 22,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  timerCountStudent: {
    color: "#FDE68A",
    fontSize: 24,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    minWidth: 28,
    textAlign: "center",
  },
});
