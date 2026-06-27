import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest, getApiUrl } from "@/lib/query-client";
import { notificationsQueryKey } from "@/lib/query-keys";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { useAuth } from "@/context/AuthContext";
import { ensurePushRegisteredWithGesture, getWebPushConnectionStatus, type WebPushConnectionStatus } from "@/lib/pushNotifications";
import NotificationImage from "@/components/NotificationImage";

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  admin_notif_id?: number | null;
  created_at: number;
  image_url?: string;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { colors, isDarkMode } = useAppTheme();
  const { user } = useAuth();

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: user?.id ? notificationsQueryKey(user.id) : ["/api/notifications", "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/notifications", baseUrl).toString());
      if (res.status === 401) return [];
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user?.id,
    staleTime: 0,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PUT", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      if (user?.id) qc.invalidateQueries({ queryKey: notificationsQueryKey(user.id) });
      else qc.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const isAdmin = user?.role === "admin";
  const unread = notifications.filter((n) => !n.is_read).length;
  const [webPushStatus, setWebPushStatus] = React.useState<WebPushConnectionStatus | null>(null);
  const [webPushRetrying, setWebPushRetrying] = React.useState(false);

  const refreshWebPushStatus = React.useCallback(async () => {
    if (Platform.OS !== "web" || !isAdmin) {
      setWebPushStatus(null);
      return;
    }
    const status = await getWebPushConnectionStatus();
    setWebPushStatus(status);
  }, [isAdmin]);

  React.useEffect(() => {
    void refreshWebPushStatus();
  }, [refreshWebPushStatus]);

  const retryWebPush = async () => {
    setWebPushRetrying(true);
    try {
      await ensurePushRegisteredWithGesture();
      await refreshWebPushStatus();
    } finally {
      setWebPushRetrying(false);
    }
  };

  const showWebPushBanner =
    Platform.OS === "web" &&
    isAdmin &&
    webPushStatus?.supported &&
    (webPushStatus.permission !== "granted" || !webPushStatus.connected);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>{isAdmin ? "Admin Alerts" : "Notifications"}</Text>
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          )}
          {unread === 0 && <View style={{ width: 36 }} />}
        </View>
      </LinearGradient>

      {showWebPushBanner ? (
        <View style={[styles.webPushBanner, { backgroundColor: isDarkMode ? "#1E293B" : "#FFFBEB", borderColor: isDarkMode ? "#334155" : "#FDE68A" }]}>
          <Ionicons name="notifications-outline" size={20} color="#D97706" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.webPushBannerTitle, { color: colors.text }]}>
              {webPushStatus?.permission !== "granted"
                ? "Browser notifications are blocked"
                : "Browser push not connected"}
            </Text>
            <Text style={[styles.webPushBannerText, { color: colors.textSecondary }]}>
              {webPushStatus?.permission !== "granted"
                ? "Allow notifications for 3ilearning.in in your browser site settings, then tap Enable below."
                : "Tap Enable to register this browser for OS alerts when new admin events arrive."}
            </Text>
          </View>
          <Pressable
            onPress={() => void retryWebPush()}
            disabled={webPushRetrying}
            style={[styles.webPushBannerBtn, webPushRetrying && { opacity: 0.6 }]}
          >
            <Text style={styles.webPushBannerBtnText}>{webPushRetrying ? "…" : "Enable"}</Text>
          </Pressable>
        </View>
      ) : null}

      {Platform.OS === "web" && isAdmin && webPushStatus?.connected ? (
        <View style={[styles.webPushOk, { backgroundColor: isDarkMode ? "#052E16" : "#ECFDF5", borderColor: isDarkMode ? "#14532D" : "#BBF7D0" }]}>
          <Ionicons name="checkmark-circle" size={16} color="#16A34A" />
          <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#16A34A" }}>Browser push connected</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              {isAdmin ? "No operational alerts yet" : "No notifications yet"}
            </Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>
              {isAdmin
                ? "You'll see registrations, purchases, support messages, and other admin alerts here."
                : "You'll see updates from your courses here"}
            </Text>
          </View>
        ) : (
          notifications.map((n) => (
            <Pressable
              key={n.id}
              style={[
                styles.notifCard,
                { backgroundColor: colors.card, shadowColor: colors.shadow, opacity: n.is_read && isAdmin ? 0.72 : 1 },
                !n.is_read && styles.notifCardUnread,
              ]}
              onPress={() => { if (!n.is_read) markReadMutation.mutate(n.id); }}
            >
              <View style={[styles.notifIcon, { backgroundColor: n.type === "info" ? "#EFF6FF" : "#FEF3C7" }]}>
                <Ionicons
                  name={n.type === "info" ? "information-circle" : "megaphone"}
                  size={20}
                  color={n.type === "info" ? Colors.light.primary : "#F59E0B"}
                />
              </View>
              <View style={styles.notifBody}>
                {n.image_url ? (
                  <View style={{ borderRadius: 10, overflow: "hidden", marginBottom: 8, borderWidth: 1, borderColor: colors.border }}>
                    <NotificationImage uri={n.image_url} backgroundColor={isDarkMode ? "#1E293B" : "#F8FAFC"} />
                  </View>
                ) : null}
                {n.title?.trim() ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.notifTitle, { color: colors.text }]}>{n.title}</Text>
                    {!n.is_read && (
                      <View style={{ backgroundColor: "#EF4444", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 8, fontFamily: "Inter_700Bold", color: "#fff" }}>NEW</Text>
                      </View>
                    )}
                  </View>
                ) : !n.is_read ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <View style={{ backgroundColor: "#EF4444", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 8, fontFamily: "Inter_700Bold", color: "#fff" }}>NEW</Text>
                    </View>
                  </View>
                ) : null}
                {n.message?.trim() ? (
                  <Text style={[styles.notifMsg, { color: colors.textSecondary }]}>{n.message}</Text>
                ) : null}
                <Text style={[styles.notifTime, { color: colors.textMuted }]}>
                  {new Date(Number(n.created_at)).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              {!n.is_read && <View style={styles.unreadDot} />}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 0 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  badge: { backgroundColor: "#EF4444", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  webPushBanner: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  webPushBannerTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  webPushBannerText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  webPushBannerBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  webPushBannerBtnText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  webPushOk: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  content: { padding: 16, gap: 10 },
  empty: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  emptySub: { fontSize: 13, color: Colors.light.textMuted, textAlign: "center", fontFamily: "Inter_400Regular" },
  notifCard: {
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    flexDirection: "row", gap: 12, alignItems: "flex-start",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  notifCardUnread: { borderLeftWidth: 3, borderLeftColor: Colors.light.primary },
  notifIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  notifBody: { flex: 1, gap: 3 },
  notifTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  notifMsg: { fontSize: 13, color: Colors.light.textSecondary, fontFamily: "Inter_400Regular", lineHeight: 18 },
  notifTime: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.light.primary, marginTop: 4 },
});
