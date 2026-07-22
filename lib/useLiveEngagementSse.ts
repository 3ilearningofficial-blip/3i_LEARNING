import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { attachInstallationHeaders, getApiUrl, getBaseUrl } from "@/lib/query-client";
import { getStoredAuthToken } from "@/lib/auth-storage";
import { useDocumentVisibility } from "@/lib/useDocumentVisibility";

type Options = {
  liveClassId: string | undefined;
  enabled?: boolean;
  isAdmin?: boolean;
};

const MAX_BACKOFF_MS = 30000;
const NATIVE_POLL_MS = 2000;

function unwrapAuthPayload(payload: any): any {
  if (payload?.success === true && payload?.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload;
}

function invalidateEngagementQueries(
  qc: ReturnType<typeof useQueryClient>,
  liveClassId: string,
  type: string,
  isAdmin: boolean
) {
  if (type === "poll") {
    void qc.invalidateQueries({ queryKey: ["/api/live-classes", liveClassId, "polls", "active"] });
    if (isAdmin) {
      void qc.invalidateQueries({
        queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"],
      });
    }
  } else if (type === "stats_show") {
    // Admin toggled "show poll stats to students". Invalidate both the
    // student-facing broadcast-stats query and the admin session poll list
    // so both sides update immediately.
    void qc.invalidateQueries({
      queryKey: ["/api/live-classes", liveClassId, "polls", "broadcast-stats"],
    });
    if (isAdmin) {
      void qc.invalidateQueries({
        queryKey: ["/api/admin/live-classes", liveClassId, "polls", "session"],
      });
    }
  } else if (type === "timer") {
    void qc.invalidateQueries({
      queryKey: ["/api/live-classes", liveClassId, "activity-timer", "active"],
    });
  } else if (type === "hand_raise" && isAdmin) {
    void qc.invalidateQueries({
      queryKey: [`/api/admin/live-classes/${liveClassId}/raised-hands`],
    });
  } else if (type === "viewer" && isAdmin) {
    void qc.invalidateQueries({
      queryKey: [`/api/live-classes/${liveClassId}/viewers`],
    });
  }
}

/** SSE (web) or polling (native) for poll, timer, and hand-raise updates. */
export function useLiveEngagementSse({ liveClassId, enabled = true, isAdmin = false }: Options): boolean {
  const qc = useQueryClient();
  const [active, setActive] = useState(false);
  const qcRef = useRef(qc);
  qcRef.current = qc;
  // Pause the stream/polling while the tab is hidden or the app is backgrounded
  // so an idle live-class tab doesn't hold a Postgres LISTEN connection open
  // (which keeps Neon compute awake). Reconnects automatically when visible.
  const visible = useDocumentVisibility();

  useEffect(() => {
    if (!liveClassId || !enabled || !visible) {
      setActive(false);
      return;
    }

    if (Platform.OS !== "web") {
      setActive(true);
      const pollTypes = ["poll", "stats_show", "timer", ...(isAdmin ? ["hand_raise", "viewer"] : [])];
      const t = setInterval(() => {
        for (const type of pollTypes) {
          invalidateEngagementQueries(qcRef.current, liveClassId, type, isAdmin);
        }
      }, NATIVE_POLL_MS);
      return () => {
        setActive(false);
        clearInterval(t);
      };
    }

    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;

    const invalidateForType = (type: string) => {
      invalidateEngagementQueries(qcRef.current, liveClassId, type, isAdmin);
    };

    const connect = async () => {
      if (closed) return;
      if (es) {
        es.close();
        es = null;
      }

      const token = await getStoredAuthToken();
      if (!token) {
        setActive(false);
        if (!closed) {
          reconnectTimer = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
            connect();
          }, backoffMs);
        }
        return;
      }
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      await attachInstallationHeaders(headers);
      const tokenRes = await fetch(
        `${getApiUrl()}/live-classes/${encodeURIComponent(liveClassId)}/engagement/sse-token`,
        {
          cache: "no-store",
          credentials: "include",
          headers,
        }
      );
      if (!tokenRes.ok) {
        setActive(false);
        reconnectTimer = setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          connect();
        }, backoffMs);
        return;
      }
      const tokenPayload = unwrapAuthPayload(await tokenRes.json().catch(() => null));
      const streamToken = String(tokenPayload?.token || "").trim();
      if (!streamToken) {
        setActive(false);
        reconnectTimer = setTimeout(() => {
          backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
          connect();
        }, backoffMs);
        return;
      }
      const params = new URLSearchParams();
      params.set("sse_token", streamToken);
      const qs = params.toString();
      const base = getBaseUrl();
      const url = `${base}/api/live-classes/${encodeURIComponent(liveClassId)}/engagement/stream${qs ? `?${qs}` : ""}`;
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
  }, [liveClassId, enabled, isAdmin, visible]);

  return active;
}
