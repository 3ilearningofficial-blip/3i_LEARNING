import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/query-client";

type Options = {
  liveClassId: string | undefined;
  enabled?: boolean;
  isAdmin?: boolean;
};

const MAX_BACKOFF_MS = 30000;

/** Web SSE for poll, timer, and hand-raise updates (PostgreSQL NOTIFY). */
export function useLiveEngagementSse({ liveClassId, enabled = true, isAdmin = false }: Options): boolean {
  const qc = useQueryClient();
  const [active, setActive] = useState(false);
  const qcRef = useRef(qc);
  qcRef.current = qc;

  useEffect(() => {
    if (Platform.OS !== "web" || !liveClassId || !enabled) {
      setActive(false);
      return;
    }

    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    const invalidateForType = (type: string) => {
      const id = liveClassId;
      if (type === "poll") {
        void qcRef.current.invalidateQueries({ queryKey: ["/api/live-classes", id, "polls", "active"] });
        if (isAdmin) {
          void qcRef.current.invalidateQueries({
            queryKey: ["/api/admin/live-classes", id, "polls", "session"],
          });
        }
      } else if (type === "timer") {
        void qcRef.current.invalidateQueries({
          queryKey: ["/api/live-classes", id, "activity-timer", "active"],
        });
      } else if (type === "hand_raise" && isAdmin) {
        void qcRef.current.invalidateQueries({
          queryKey: [`/api/admin/live-classes/${id}/raised-hands`],
        });
      } else if (type === "viewer" && isAdmin) {
        void qcRef.current.invalidateQueries({
          queryKey: [`/api/live-classes/${id}/viewers`],
        });
      }
    };

    const connect = () => {
      if (closed) return;
      if (es) {
        es.close();
        es = null;
      }

      const base = getApiUrl();
      const url = `${base}/api/live-classes/${encodeURIComponent(liveClassId)}/engagement/stream`;
      es = new EventSource(url, { withCredentials: true } as EventSourceInit);

      es.onopen = () => {
        setActive(true);
        backoffMs = 1000;
      };

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
        if (es) {
          es.close();
          es = null;
        }
        if (closed) return;
        reconnectTimer = setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          connect();
        }, backoffMs);
      };
    };

    connect();

    return () => {
      closed = true;
      setActive(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) es.close();
    };
  }, [liveClassId, enabled, isAdmin]);

  return active;
}
