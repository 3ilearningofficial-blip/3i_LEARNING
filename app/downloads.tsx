import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Platform, Alert, BackHandler,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { authFetch, getApiUrl, prepareAuthorizedFetchHeaders } from "@/lib/query-client";
import { myDownloadsQueryKey } from "@/lib/query-keys";
import Colors from "@/constants/colors";
import { useDownloadManager } from "@/lib/useDownloadManager";
import { useAuth } from "@/context/AuthContext";
import { useWebDownloadJobs } from "@/context/WebDownloadJobsContext";
import { getWebOffline, removeWebOffline, listWebOfflineKeys } from "@/lib/web-offline-store";

type DownloadItem = {
  id: number;
  title: string;
  file_url: string;
  file_type: string;
  section_title?: string;
  course_title?: string;
  course_id?: number;
  order_index?: number;
  type: "material" | "lecture";
  local_filename?: string;
};

export default function DownloadsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { startWebDownload, forgetSavedLocally } = useWebDownloadJobs();
  const [activeTab, setActiveTab] = useState<"lectures" | "pdfs">("lectures");
  type DownloadsView =
    | { mode: "root" }
    | { mode: "course"; courseTitle: string }
    | { mode: "section"; courseTitle: string; sectionTitle: string };
  const [view, setView] = useState<DownloadsView>({ mode: "root" });
  const [totalStorage, setTotalStorage] = useState<number>(0);
  /** Web: items with a Blob present in IndexedDB for this browser */
  const [webHeldKeys, setWebHeldKeys] = useState<Set<string>>(() => new Set());
  const downloadManager = useDownloadManager();
  const { isStateLoaded } = downloadManager;
  const { isWebOfflineHydrated } = useWebDownloadJobs();
  const downloadUiReady = Platform.OS === "web" ? isWebOfflineHydrated : isStateLoaded;

  const { data, isLoading, refetch } = useQuery<{ materials: DownloadItem[]; lectures: DownloadItem[] }>({
    queryKey: user?.id ? myDownloadsQueryKey(user.id) : ["/api/my-downloads", "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-downloads", baseUrl).toString());
      if (!res.ok) return { materials: [], lectures: [] };
      const payload = await res.json().catch(() => null);
      return {
        materials: Array.isArray(payload?.materials) ? payload.materials : [],
        lectures: Array.isArray(payload?.lectures) ? payload.lectures : [],
      };
    },
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  const lectures = Array.isArray(data?.lectures) ? data.lectures : [];
  const materials = Array.isArray(data?.materials) ? data.materials : [];

  const refreshWebHeldKeys = useCallback(async () => {
    if (Platform.OS !== "web") return;
    const userId = Number(user?.id || 0);
    if (!Number.isFinite(userId) || userId <= 0) {
      setWebHeldKeys(new Set());
      return;
    }
    const all = [...lectures, ...materials];
    const next = new Set<string>();
    for (const it of all) {
      try {
        const rec = await getWebOffline(userId, it.type, it.id);
        if (rec) next.add(`${it.type}:${it.id}`);
      } catch {
        /* ignore */
      }
    }
    setWebHeldKeys(next);
  }, [lectures, materials, user?.id]);

  useEffect(() => {
    void refreshWebHeldKeys();
  }, [refreshWebHeldKeys]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === "web" && user?.id) {
        void refetch();
        void refreshWebHeldKeys();
      }
    }, [user?.id, refetch, refreshWebHeldKeys])
  );

  /**
   * Web revocation cleanup — mirrors what runForegroundAccessCheck does on native.
   *
   * When the server returns a fresh /api/my-downloads list (e.g. after enrollment
   * revocation), we compare the server-authoritative set against every key stored
   * in IndexedDB for this user.  Any IndexedDB entry that is no longer in the
   * server list means the user's access was revoked — we delete the blob so they
   * cannot keep playing downloaded content offline indefinitely.
   *
   * This runs only on web, only when real server data is available, and only
   * when a valid userId is present.  Errors are swallowed so a buggy IDB key
   * never breaks the downloads screen.
   */
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (!data) return;
    const userId = Number(user?.id || 0);
    if (!Number.isFinite(userId) || userId <= 0) return;

    void (async () => {
      try {
        // Build the set of item keys the server says this user still has access to.
        const serverKeys = new Set<string>();
        for (const item of data.lectures) serverKeys.add(`${userId}:lecture:${item.id}`);
        for (const item of data.materials) serverKeys.add(`${userId}:material:${item.id}`);

        // List every key stored in IndexedDB for any user (keys are userId:type:id).
        const allStoredKeys = await listWebOfflineKeys();

        for (const storedKey of allStoredKeys) {
          // Only touch keys that belong to the current user.
          if (!storedKey.startsWith(`${userId}:`)) continue;
          // If this key is not in the server list, the user no longer has access.
          if (!serverKeys.has(storedKey)) {
            const [, itemType, itemIdStr] = storedKey.split(":");
            const itemId = Number(itemIdStr);
            if (itemType && Number.isFinite(itemId)) {
              await removeWebOffline(userId, itemType, itemId).catch(() => {/* ignore */});
            }
          }
        }
      } catch {
        // Never let cleanup errors surface to the user.
      }
    })();
  }, [data, user?.id]);

  // Calculate total storage used
  useEffect(() => {
    if (Platform.OS !== 'web') {
      downloadManager.getTotalStorageBytes().then(setTotalStorage);
    }
  }, [data]);

  const openFile = async (item: DownloadItem) => {
    if (Platform.OS === "web") {
      try {
        const userId = Number(user?.id || 0);
        const rec = Number.isFinite(userId) && userId > 0 ? await getWebOffline(userId, item.type, item.id) : null;
        if (rec) {
          const blobUrl = URL.createObjectURL(rec.blob);
          if (item.type === "material") {
            router.push({ pathname: "/material/[id]", params: { id: String(item.id), localUri: blobUrl } } as any);
          } else {
            router.push({
              pathname: "/lecture/[id]",
              params: { id: String(item.id), videoUrl: blobUrl, title: item.title, isLocal: "true" },
            } as any);
          }
          // Release the temporary URL handle after the destination screen has
          // had time to read it. The blob itself stays in IndexedDB — only this
          // in-memory URL reference is freed, preventing accumulation across
          // multiple opens in one session.
          setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
          return;
        }
      } catch (e) {
        console.warn("[Downloads] web offline blob", e);
      }
    }

    // Try to get local URI first (for offline playback — native encrypted files)
    if (Platform.OS !== 'web') {
      try {
        const localUri = await downloadManager.getLocalUri(item.type, item.id);
        if (localUri) {
          // Use local file for playback
          if (item.type === "material") {
            router.push({ pathname: "/material/[id]", params: { id: item.id, localUri } } as any);
          } else {
            router.push({ pathname: "/lecture/[id]", params: { id: item.id, videoUrl: localUri, title: item.title, isLocal: 'true' } } as any);
          }
          return;
        }
      } catch (error) {
        console.error('[Downloads] Failed to get local URI:', error);
      }
    }

    // Fall back to remote URL
    if (item.type === "material") {
      router.push(`/material/${item.id}`);
    } else {
      if (!item.file_url) {
        Alert.alert("File not available", "This file is not available offline. Please re-download it.");
        return;
      }
      router.push({ pathname: "/lecture/[id]", params: { id: item.id, videoUrl: item.file_url, title: item.title } } as any);
    }
  };

  const handleDelete = async (item: DownloadItem) => {
    const runNativeDelete = async () => {
      try {
        await downloadManager.deleteDownload(item.type, item.id);
        await refetch();
      } catch (error: any) {
        Alert.alert("Delete Failed", error.message || "Failed to delete download");
      }
    };

    if (Platform.OS === "web") {
      const ok =
        typeof globalThis !== "undefined" &&
        typeof (globalThis as unknown as { confirm?: (msg: string) => boolean }).confirm === "function" &&
        Boolean((globalThis as unknown as { confirm: (msg: string) => boolean }).confirm(
          `Remove "${item.title}" from My Downloads on this browser?`
        ));
      if (!ok) return;
      try {
        const baseUrl = getApiUrl();
        const { headers } = await prepareAuthorizedFetchHeaders(user?.sessionToken);
        await fetch(`${baseUrl}/my-downloads/${item.type}/${item.id}`, {
          method: "DELETE",
          headers,
          credentials: "include",
        });
        if (user?.id) {
          await removeWebOffline(user.id, item.type, item.id);
        }
        forgetSavedLocally(item.type, item.id);
        await refetch();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        if (typeof globalThis !== "undefined" && (globalThis as unknown as { alert?: (msg: string) => void }).alert) {
          (globalThis as unknown as { alert: (msg: string) => void }).alert(`Delete failed: ${msg}`);
        }
      }
      return;
    }

    Alert.alert(
      "Delete Download",
      `Remove "${item.title}" from offline storage?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void runNativeDelete();
          },
        },
      ]
    );
  };

  const handleRedownload = async (item: DownloadItem) => {
    if (Platform.OS === 'web') {
      try {
        await startWebDownload({
          itemType: item.type,
          itemId: item.id,
          title: item.title,
          fileType: item.file_type || 'file',
          bearerFallback: user?.sessionToken,
        });
        await refetch();
        await refreshWebHeldKeys();
      } catch (error: any) {
        if (typeof globalThis !== 'undefined' && typeof (globalThis as any).alert === 'function') {
          (globalThis as any).alert(error?.message || 'Failed to download file');
        }
      }
      return;
    }

    try {
      await downloadManager.startDownload(item.type as 'lecture' | 'material', item.id);
      await refetch();
    } catch (error: any) {
      Alert.alert("Download Failed", error.message || "Failed to download file");
    }
  };

  const formatStorageSize = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const renderItem = (item: DownloadItem) => {
    const downloadState = Platform.OS !== 'web' 
      ? downloadManager.getDownloadState(item.type, item.id)
      : { status: 'idle' as const, progress: 0 };
    
    const k = `${item.type}:${item.id}`;
    const isAvailableOffline =
      Platform.OS === "web"
        ? webHeldKeys.has(k)
        : downloadState.status === "downloaded" && !!downloadState.localFilename;
    const needsRedownload = downloadUiReady && item.local_filename && !isAvailableOffline;

    return (
      <Pressable 
        key={`${item.type}-${item.id}`} 
        style={styles.card} 
        onPress={() => openFile(item)}
        onLongPress={() => Platform.OS !== 'web' && downloadUiReady && handleDelete(item)}
      >
        <View style={styles.cardIcon}>
          <Ionicons
            name={item.file_type === "video" ? "videocam" : "document-text"}
            size={22}
            color={Colors.light.primary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
          {item.course_title && (
            <Text style={styles.cardSub} numberOfLines={1}>{item.course_title}</Text>
          )}
          {item.section_title && (
            <Text style={styles.cardSection} numberOfLines={1}>{item.section_title}</Text>
          )}
          {isAvailableOffline && (
            <View style={styles.offlineBadge}>
              <Ionicons name="checkmark-circle" size={12} color="#10b981" />
              <Text style={styles.offlineBadgeText}>Downloaded</Text>
            </View>
          )}
        </View>
        {!downloadUiReady ? null : needsRedownload ? (
          <Pressable 
            style={styles.redownloadBtn}
            onPress={(e) => {
              e.stopPropagation();
              handleRedownload(item);
            }}
          >
            <Ionicons name="cloud-download-outline" size={16} color={Colors.light.primary} />
            <Text style={styles.redownloadText}>Re-download</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              handleDelete(item);
            }}
          >
            <Ionicons name="trash-outline" size={18} color={Colors.light.textMuted} />
          </Pressable>
        )}
      </Pressable>
    );
  };

  const activeItems = Array.isArray(activeTab === "lectures" ? lectures : materials)
    ? (activeTab === "lectures" ? lectures : materials)
    : [];

  useEffect(() => {
    setView({ mode: "root" });
  }, [activeTab]);

  const goBackInDownloads = useCallback(() => {
    if (view.mode === "section") {
      setView({ mode: "course", courseTitle: view.courseTitle });
      return true;
    }
    if (view.mode === "course") {
      setView({ mode: "root" });
      return true;
    }
    return false;
  }, [view]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (view.mode === "root") return false;
      return goBackInDownloads();
    });
    return () => sub.remove();
  }, [view, goBackInDownloads]);

  const groupedByCourse = useMemo(() => {
    const courseMap = new Map<string, DownloadItem[]>();
    for (const item of activeItems) {
      const key = item.course_title || "Uncategorized";
      if (!courseMap.has(key)) courseMap.set(key, []);
      courseMap.get(key)!.push(item);
    }
    return courseMap;
  }, [activeItems]);

  return (
    <View style={[styles.container, { paddingTop: Platform.OS === "web" ? 16 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={styles.backBtn}
          onPress={() => {
            if (view.mode !== "root" && goBackInDownloads()) return;
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {view.mode === "root"
            ? "My Downloads"
            : view.mode === "course"
              ? view.courseTitle
              : view.sectionTitle}
        </Text>
      </View>

      {/* Storage Summary */}
      {Platform.OS !== 'web' && totalStorage > 0 && (
        <View style={styles.storageBar}>
          <Ionicons name="server-outline" size={16} color={Colors.light.textMuted} />
          <Text style={styles.storageText}>
            Total Storage: {formatStorageSize(totalStorage)}
          </Text>
        </View>
      )}

      {/* Horizontal Tabs */}
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, activeTab === "lectures" && styles.tabActive]}
          onPress={() => setActiveTab("lectures")}
        >
          <Ionicons
            name="videocam-outline"
            size={16}
            color={activeTab === "lectures" ? "#fff" : Colors.light.textMuted}
          />
          <Text style={[styles.tabText, activeTab === "lectures" && styles.tabTextActive]}>
            Lectures ({lectures.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, activeTab === "pdfs" && styles.tabActive]}
          onPress={() => setActiveTab("pdfs")}
        >
          <Ionicons
            name="document-text-outline"
            size={16}
            color={activeTab === "pdfs" ? "#fff" : Colors.light.textMuted}
          />
          <Text style={[styles.tabText, activeTab === "pdfs" && styles.tabTextActive]}>
            PDFs ({materials.length})
          </Text>
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />
      ) : activeItems.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="cloud-download-outline" size={48} color={Colors.light.textMuted} />
          <Text style={styles.emptyText}>
            {activeTab === "lectures"
              ? "No lecture downloads yet."
              : "No material downloads yet."}
          </Text>
          <Text style={styles.emptySubText}>Tap the download button on materials or lectures in a course to save them here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {view.mode === "root" && (
            <>
              {[...groupedByCourse.entries()].map(([courseTitle, courseItems]) => {
                const sectionKeys = new Set(
                  courseItems.map((it) => it.section_title || "__none__")
                );
                const sectionCount = sectionKeys.size;
                return (
                  <Pressable
                    key={courseTitle}
                    style={styles.folderCard}
                    onPress={() => {
                      if (sectionCount === 1 && sectionKeys.has("__none__")) {
                        setView({ mode: "course", courseTitle });
                      } else {
                        setView({ mode: "course", courseTitle });
                      }
                    }}
                  >
                    <Ionicons name="folder" size={22} color={Colors.light.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.folderCardTitle} numberOfLines={2}>{courseTitle}</Text>
                      <Text style={styles.folderCardSub}>
                        {courseItems.length} item{courseItems.length !== 1 ? "s" : ""}
                        {sectionCount > 1 ? ` · ${sectionCount} folders` : ""}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                  </Pressable>
                );
              })}
            </>
          )}
          {view.mode === "course" && (() => {
            const courseItems = groupedByCourse.get(view.courseTitle) || [];
            const sectionMap = new Map<string, DownloadItem[]>();
            for (const item of courseItems) {
              const key = item.section_title || "__none__";
              if (!sectionMap.has(key)) sectionMap.set(key, []);
              sectionMap.get(key)!.push(item);
            }
            if (sectionMap.size === 1 && sectionMap.has("__none__")) {
              const sorted = [...(sectionMap.get("__none__") || [])].sort(
                (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
              );
              return <>{sorted.map(renderItem)}</>;
            }
            return (
              <>
                {[...sectionMap.entries()].map(([sectionKey, sectionItems]) => (
                  <Pressable
                    key={sectionKey}
                    style={styles.folderCard}
                    onPress={() => {
                      if (sectionKey === "__none__") return;
                      setView({
                        mode: "section",
                        courseTitle: view.courseTitle,
                        sectionTitle: sectionKey,
                      });
                    }}
                  >
                    <Ionicons name="folder-outline" size={20} color={Colors.light.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.folderCardTitle}>
                        {sectionKey === "__none__" ? "General" : sectionKey}
                      </Text>
                      <Text style={styles.folderCardSub}>
                        {sectionItems.length} item{sectionItems.length !== 1 ? "s" : ""}
                      </Text>
                    </View>
                    {sectionKey !== "__none__" && (
                      <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
                    )}
                  </Pressable>
                ))}
                {sectionMap.has("__none__") && (
                  <View style={{ marginTop: 8 }}>
                    {[...(sectionMap.get("__none__") || [])]
                      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
                      .map(renderItem)}
                  </View>
                )}
              </>
            );
          })()}
          {view.mode === "section" && (() => {
            const courseItems = groupedByCourse.get(view.courseTitle) || [];
            const items = courseItems
              .filter((it) => (it.section_title || "") === view.sectionTitle)
              .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
            return <>{items.map(renderItem)}</>;
          })()}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: {
    backgroundColor: "#0A1628",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: Platform.OS === "web" ? 16 : 20,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  folderCardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  folderCardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 2 },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.light.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.light.secondary,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  tabActive: {
    backgroundColor: Colors.light.primary,
    borderColor: Colors.light.primary,
  },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted },
  tabTextActive: { color: "#fff" },
  list: { padding: 16, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  cardIcon: {
    width: 42, height: 42, borderRadius: 10,
    backgroundColor: Colors.light.secondary,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginBottom: 2 },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.primary },
  cardSection: { fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 1 },
  courseGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 2,
    marginTop: 10,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  courseGroupHeaderText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: Colors.light.primary,
    flex: 1,
  },
  sectionGroupHeader: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginTop: 8,
    marginBottom: 2,
  },
  sectionGroupHeaderText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.text, textAlign: "center" },
  emptySubText: { fontSize: 13, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "center" },
  storageBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.light.secondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
  },
  storageText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.text,
  },
  offlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
  },
  offlineBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#10b981",
  },
  redownloadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.light.secondary,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  redownloadText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
});
