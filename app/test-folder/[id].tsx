import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
  ActivityIndicator, Alert,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { getApiUrl, authFetch, apiRequest } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";

export default function TestFolderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [enrolling, setEnrolling] = React.useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/test-folders", id],
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/test-folders/${id}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!id,
  });

  const folder = data || {};
  const tests: any[] = folder.tests || [];
  const attempts: Record<number, any> = folder.attempts || {};
  const isPurchased = folder.is_purchased;
  const totalTests = tests.length;
  const completedTests = Object.keys(attempts).length;
  const progressPct = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;

  const handleEnroll = async () => {
    if (!user) { router.push("/(auth)/email-login" as any); return; }
    setEnrolling(true);
    try {
      await apiRequest("POST", `/api/test-folders/${id}/enroll`);
      qc.invalidateQueries({ queryKey: ["/api/test-folders", id] });
      qc.invalidateQueries({ queryKey: ["/api/test-folders"] });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      const msg = err?.message || "Failed to enroll";
      if (Platform.OS === "web") alert(msg); else Alert.alert("Error", msg);
    }
    setEnrolling(false);
  };

  const handleStartTest = (test: any) => {
    if (!isPurchased) {
      if (folder.is_free) handleEnroll();
      else { if (Platform.OS === "web") alert("Purchase required"); else Alert.alert("Locked", "Purchase this pack to access tests."); }
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const attempt = attempts[test.id];
    if (attempt) {
      router.push({ pathname: "/test-result/[id]", params: { id: String(test.id), score: String(attempt.score ?? 0), totalMarks: String(attempt.total_marks ?? 0), attemptId: String(attempt.attempt_id ?? ""), testType: test.test_type ?? "" } } as any);
    } else {
      router.push(`/test/${test.id}`);
    }
  };

  const topPad = Platform.OS === "web" ? 16 : insets.top;

  if (isLoading) return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.light.background }}>
      <ActivityIndicator size="large" color={Colors.light.primary} />
    </View>
  );

  const discount = folder.original_price && parseFloat(folder.original_price) > 0
    ? Math.round((1 - parseFloat(folder.price) / parseFloat(folder.original_price)) * 100) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.light.background }}>
      {/* Header */}
      <LinearGradient colors={["#1E1B4B", "#4C1D95"]} style={{ paddingTop: topPad + 12, paddingBottom: 20, paddingHorizontal: 20, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="arrow-back" size={18} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" }} numberOfLines={2}>{folder.name}</Text>
            {folder.description ? <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }} numberOfLines={2}>{folder.description}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {folder.category && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{folder.category}</Text>
            </View>
          )}
          <View style={{ backgroundColor: folder.is_free ? "#22C55E" : "#F59E0B", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{folder.is_free ? "FREE" : `₹${parseFloat(folder.price || "0").toFixed(0)}`}</Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.7)" }}>{totalTests} tests</Text>
        </View>
        {/* Progress */}
        {isPurchased && totalTests > 0 && (
          <View style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" }}>{completedTests}/{totalTests} completed</Text>
              <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" }}>{progressPct}%</Text>
            </View>
            <View style={{ height: 6, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 3 }}>
              <View style={{ height: 6, backgroundColor: "#22C55E", borderRadius: 3, width: `${progressPct}%` as any }} />
            </View>
          </View>
        )}
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100, gap: 10 }}>
        {tests.map((test: any) => {
          const attempt = attempts[test.id];
          const locked = !isPurchased;
          return (
            <Pressable key={test.id} style={{ backgroundColor: "#fff", borderRadius: 14, overflow: "hidden", flexDirection: "row", borderWidth: 1, borderColor: "#E5E7EB", opacity: locked ? 0.7 : 1 }}
              onPress={() => handleStartTest(test)}>
              <View style={{ width: 5, backgroundColor: attempt ? "#22C55E" : locked ? "#9CA3AF" : Colors.light.primary }} />
              <View style={{ flex: 1, padding: 14, gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {locked && <Ionicons name="lock-closed" size={14} color="#9CA3AF" />}
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: locked ? Colors.light.textMuted : Colors.light.text }} numberOfLines={2}>{test.title}</Text>
                  {attempt && (
                    <View style={{ backgroundColor: "#DCFCE7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#16A34A" }}>{attempt.score}/{attempt.total_marks}</Text>
                    </View>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }}>{test.total_questions || 0} Q · {test.duration_minutes}min · {test.total_marks} marks</Text>
                  {test.test_type && (
                    <View style={{ backgroundColor: "#F3F4F6", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                      <Text style={{ fontSize: 9, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted }}>{test.test_type}</Text>
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          );
        })}
        {tests.length === 0 && (
          <View style={{ alignItems: "center", paddingVertical: 40, gap: 8 }}>
            <Ionicons name="document-text-outline" size={40} color={Colors.light.textMuted} />
            <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>No tests in this pack yet</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA */}
      {!isPurchased && (
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#E5E7EB", paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
          {folder.is_free ? (
            <Pressable onPress={handleEnroll} disabled={enrolling} style={{ backgroundColor: "#22C55E", borderRadius: 14, paddingVertical: 16, alignItems: "center", opacity: enrolling ? 0.6 : 1 }}>
              {enrolling ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Enroll for Free</Text>}
            </Pressable>
          ) : (
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text }}>₹{parseFloat(folder.price || "0").toFixed(0)}</Text>
                {discount > 0 && (
                  <>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textDecorationLine: "line-through" }}>₹{parseFloat(folder.original_price).toFixed(0)}</Text>
                    <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                      <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#EF4444" }}>{discount}% OFF</Text>
                    </View>
                  </>
                )}
              </View>
              <Pressable style={{ backgroundColor: "#F59E0B", borderRadius: 14, paddingVertical: 16, alignItems: "center" }}
                onPress={() => { if (Platform.OS === "web") alert("Payment integration needed"); else Alert.alert("Coming Soon", "Payment for test packs coming soon."); }}>
                <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" }}>Buy Now</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
