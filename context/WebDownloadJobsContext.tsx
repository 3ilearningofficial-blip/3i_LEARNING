import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { Platform } from "react-native";
import { getApiUrl, prepareAuthorizedFetchHeaders, queryClient } from "@/lib/query-client";
import { putWebOffline } from "@/lib/web-offline-store";

export type WebDlJobSnapshot = {
  itemType: "lecture" | "material";
  itemId: number;
  title: string;
  fileType: string;
  status: "downloading" | "done" | "error";
  progress: number;
};

type JobsState = Record<string, WebDlJobSnapshot>;

type Action =
  | { type: "start"; key: string; payload: Omit<WebDlJobSnapshot, "status" | "progress"> }
  | { type: "progress"; key: string; progress: number }
  | { type: "done"; key: string }
  | { type: "error"; key: string }
  | { type: "clear"; key: string };

function jobKey(itemType: string, itemId: number): string {
  return `${itemType}:${itemId}`;
}

function reducer(state: JobsState, action: Action): JobsState {
  switch (action.type) {
    case "start":
      return {
        ...state,
        [action.key]: {
          ...action.payload,
          status: "downloading",
          progress: 0,
        },
      };
    case "progress":
      if (!state[action.key]) return state;
      return {
        ...state,
        [action.key]: { ...state[action.key], progress: action.progress },
      };
    case "done":
      if (!state[action.key]) return state;
      return {
        ...state,
        [action.key]: { ...state[action.key], status: "done", progress: 100 },
      };
    case "error":
      if (!state[action.key]) return state;
      return {
        ...state,
        [action.key]: { ...state[action.key], status: "error", progress: 0 },
      };
    case "clear": {
      if (!state[action.key]) return state;
      const next = { ...state };
      delete next[action.key];
      return next;
    }
    default:
      return state;
  }
}

type Ctx = {
  jobs: JobsState;
  getJob: (itemType: string, itemId: number) => WebDlJobSnapshot | undefined;
  startWebDownload: (params: {
    itemType: "lecture" | "material";
    itemId: number;
    title: string;
    fileType: string;
    bearerFallback?: string | null;
  }) => Promise<void>;
};

/** Used when Provider is omitted (native) — callers should no-op via Platform checks where needed */
const WEB_DL_STUB_CTX: Ctx = {
  jobs: {},
  getJob: () => undefined,
  startWebDownload: async () => {},
};

const WebDownloadJobsContext = createContext<Ctx>(WEB_DL_STUB_CTX);

export function WebDownloadJobsInnerProvider({ children }: { children: React.ReactNode }) {
  const [jobs, dispatch] = useReducer(reducer, {});
  const inFlight = useRef<Set<string>>(new Set());

  const getJob = useCallback((itemType: string, itemId: number) => {
    return jobs[jobKey(itemType, itemId)];
  }, [jobs]);

  const startWebDownload = useCallback(
    async (params: {
      itemType: "lecture" | "material";
      itemId: number;
      title: string;
      fileType: string;
      bearerFallback?: string | null;
    }) => {
      const key = jobKey(params.itemType, params.itemId);
      if (inFlight.current.has(key)) return;

      const { bearer, headers: authHeaders } = await prepareAuthorizedFetchHeaders(params.bearerFallback);
      if (!bearer) {
        throw new Error("Not authenticated");
      }

      inFlight.current.add(key);
      dispatch({
        type: "start",
        key,
        payload: {
          itemType: params.itemType,
          itemId: params.itemId,
          title: params.title,
          fileType: params.fileType,
        },
      });

      const apiUrl = getApiUrl();
      const unwrapPayload = (payload: any) => {
        if (payload && typeof payload === "object" && typeof payload.success === "boolean") {
          if (payload.success === false) {
            throw new Error(payload.error || payload.message || "Request failed");
          }
          if ("data" in payload) return payload.data;
        }
        return payload;
      };

      try {
        const tokenRes = await fetch(
          `${apiUrl}/download-url?itemType=${params.itemType}&itemId=${params.itemId}`,
          { headers: authHeaders, credentials: "include" }
        );
        if (!tokenRes.ok) {
          let detail = `Failed to get download token (${tokenRes.status})`;
          try {
            const body = await tokenRes.clone().json();
            const msg =
              typeof body?.message === "string"
                ? body.message
                : typeof body?.error === "string"
                  ? body.error
                  : "";
            if (msg) detail = msg;
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        const tokenPayload = unwrapPayload(await tokenRes.json());
        const token = tokenPayload?.token;
        if (!token || typeof token !== "string") {
          throw new Error("Invalid download token response");
        }

        const downloadUrl = `${apiUrl}/download-proxy?token=${encodeURIComponent(token)}`;
        const blob = await new Promise<Blob>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("GET", downloadUrl);
          xhr.responseType = "blob";
          xhr.onprogress = (e) => {
            if (e.lengthComputable && e.total > 0) {
              dispatch({
                type: "progress",
                key,
                progress: Math.round((e.loaded / e.total) * 100),
              });
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(xhr.response as Blob);
            } else {
              reject(new Error(`Download failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error("Network error"));
          xhr.send();
        });

        const mime = blob.type || "application/octet-stream";
        const localFilename =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        await putWebOffline({
          itemType: params.itemType,
          itemId: params.itemId,
          localFilename,
          title: params.title.trim() || "Download",
          fileType: params.fileType,
          mimeType: mime,
          blob,
          downloadedAt: Date.now(),
        });

        const { headers: postHdr } = await prepareAuthorizedFetchHeaders(params.bearerFallback);
        const trackRes = await fetch(`${apiUrl}/my-downloads`, {
          method: "POST",
          headers: { ...postHdr, "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            itemType: params.itemType,
            itemId: params.itemId,
            localFilename,
          }),
        });
        if (!trackRes.ok) {
          console.warn("[WebDownload] my-downloads register failed", trackRes.status);
        }

        await queryClient.invalidateQueries({ queryKey: ["/api/my-downloads"] });
        dispatch({ type: "done", key });
        setTimeout(() => {
          dispatch({ type: "clear", key });
        }, 2400);
      } catch (e) {
        console.error("[WebDownload]", e);
        dispatch({ type: "error", key });
      } finally {
        inFlight.current.delete(key);
      }
    },
    []
  );

  const value = useMemo(
    () => ({
      jobs,
      getJob,
      startWebDownload,
    }),
    [jobs, getJob, startWebDownload]
  );

  return <WebDownloadJobsContext.Provider value={value}>{children}</WebDownloadJobsContext.Provider>;
}

/** Mount everywhere: real web downloads state on web only; native gets context default stub. */
export function WebDownloadJobsProvider({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return <WebDownloadJobsInnerProvider>{children}</WebDownloadJobsInnerProvider>;
}

export function useWebDownloadJobs(): Ctx {
  return useContext(WebDownloadJobsContext);
}
