import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform, Image } from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch, apiRequest, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: number;
  image_url?: string;
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [authLost, setAuthLost] = useState(false);

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/notifications", baseUrl).toString());
      if (res.status === 401) {
        setAuthLost(true);
        return [];
      }
      if (!res.ok) return [];
      setAuthLost(false);
      return res.json();
    },
    enabled: !!user && !authLost,
    staleTime: 0,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PUT", `/api/notifications/${id}/read`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/notifications"] }),
  });

  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <View style={styles.container}>
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: (Platform.OS === "web" ? 16 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backBtn} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Notifications</Text>
          {unread > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unread}</Text>
            </View>
          )}
          {unread === 0 && <View style={{ width: 36 }} />}
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
        {isLoading ? (
          <ActivityIndicator size="large" color={Colors.light.primary} style={{ marginTop: 40 }} />
        ) : notifications.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="notifications-off-outline" size={48} color={Colors.light.textMuted} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptySub}>You'll see updates from your courses here</Text>
          </View>
        ) : (
          notifications.map((n) => (
            <Pressable
              key={n.id}
              style={[styles.notifCard, !n.is_read && styles.notifCardUnread]}
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
                  <View style={{ borderRadius: 10, overflow: "hidden", marginBottom: 8 }}>
                    <Image source={{ uri: n.image_url }} style={{ width: "100%", height: 120 }} resizeMode="cover" />
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.notifTitle}>{n.title}</Text>
                  {!n.is_read && (
                    <View style={{ backgroundColor: "#EF4444", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 8, fontFamily: "Inter_700Bold", color: "#fff" }}>NEW</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.notifMsg}>{n.message}</Text>
                <Text style={styles.notifTime}>
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
