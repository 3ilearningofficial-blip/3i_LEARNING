import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

type Options = {
  liveClassId: string | undefined;
  enabled?: boolean;
  isAdmin?: boolean;
};

/** Web SSE for poll, timer, and hand-raise updates (PostgreSQL NOTIFY). */
export function useLiveEngagementSse({ liveClassId, enabled = true, isAdmin = false }: Options): boolean {
  const qc = useQueryClient();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || !liveClassId || !enabled) {
      setActive(false);
      return;
    }

    const base = getApiUrl();
    const url = `${base}/api/live-classes/${encodeURIComponent(liveClassId)}/engagement/stream`;
    const es = new EventSource(url, { withCredentials: true } as EventSourceInit);

    const invalidateForType = (type: string) => {
      if (type === "poll") {
        void qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
      } else if (type === "timer") {
        void qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"] });
      } else if (type === "hand_raise" && isAdmin) {
        void qc.invalidateQueries({ queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`] });
      }
    };

    es.onopen = () => setActive(true);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { type?: string };
        if (payload?.type) invalidateForType(payload.type);
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => {
      setActive(false);
      es.close();
    };

    return () => {
      setActive(false);
      es.close();
    };
  }, [liveClassId, enabled, isAdmin, qc]);

  return active;
}
