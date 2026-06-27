import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, TextInput, Modal, Platform, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rollingPresetDates(months: number): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  return { start: toYmd(start), end: toYmd(end) };
}

const CUSTOM_RANGE_PRESETS = [
  { months: 3, label: "3 Months" },
  { months: 6, label: "6 Months" },
  { months: 12, label: "1 Year" },
] as const;

export function AnalyticsTab() {
  const qc = useQueryClient();
  const { colors, isDarkMode } = useAppTheme();
  const [period, setPeriod] = React.useState("30days");
  const [customStart, setCustomStart] = React.useState("");
  const [customEnd, setCustomEnd] = React.useState("");
  const [showCustom, setShowCustom] = React.useState(false);
  const [viewMoreModal, setViewMoreModal] = React.useState<{ title: string; data: any[]; type: string } | null>(null);
  const [expandedSection, setExpandedSection] = React.useState<"successful" | "failed" | "abandoned" | "coursewise" | "books">("successful");

  const queryParams = period === "custom"
    ? `?period=custom&startDate=${customStart}&endDate=${customEnd}`
    : `?period=${period}`;

  const { data: analytics, isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/admin/analytics", period, customStart, customEnd],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL(`/api/admin/analytics${queryParams}`, baseUrl).toString());
      if (!res.ok) return {};
      return res.json();
    },
    staleTime: 2 * 60 * 1000,
    refetchOnMount: false,
    enabled: period !== "custom" || (!!customStart && !!customEnd),
  });

  const resetAbandonedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/analytics/reset-abandoned", {});
      if (!res.ok) throw new Error("Failed to reset abandoned analytics data");
      return res.json();
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["/api/admin/analytics"] });
      await refetch();
      if (Platform.OS === "web") window.alert("Buy now - not purchased data has been reset.");
      else Alert.alert("Reset Complete", "Buy now - not purchased data has been reset.");
    },
    onError: (err: any) => {
      const msg = (err?.message || "").replace(/^\d+:\s*/, "");
      if (Platform.OS === "web") window.alert(msg || "Failed to reset data.");
      else Alert.alert("Error", msg || "Failed to reset data.");
    },
  });

  const formatCurrency = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const formatDate = (ts: any) => {
    if (!ts) return "";
    const d = new Date(typeof ts === "string" ? parseInt(ts) : ts);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const PERIODS = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "7days", label: "7 Days" },
    { key: "15days", label: "15 Days" },
    { key: "30days", label: "30 Days" },
    { key: "lifetime", label: "Lifetime" },
    { key: "custom", label: "Custom" },
  ];

  const periodLabel =
    period === "today"
      ? "Today"
      : period === "yesterday"
        ? "Yesterday"
        : period === "7days"
          ? "Last 7 Days"
          : period === "15days"
            ? "Last 15 Days"
            : period === "30days"
              ? "Last 30 Days"
              : period === "lifetime"
                ? "Lifetime"
                : "Custom";

  const selectPeriod = (key: string) => {
    if (key === "custom") {
      setPeriod("custom");
      setShowCustom(true);
      return;
    }
    setPeriod(key);
    setShowCustom(false);
    setCustomStart("");
    setCustomEnd("");
  };

  const applyCustomPreset = (months: number) => {
    const { start, end } = rollingPresetDates(months);
    setCustomStart(start);
    setCustomEnd(end);
    setPeriod("custom");
    setShowCustom(true);
  };

  /** When custom range is selected but not applied, the query is disabled and `data` is undefined — avoid reading properties of undefined. */
  const a = analytics ?? {};
  const txns = (a.recentPurchases || []).filter((p: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.id === p.id) === idx);
  const failedTxns = (a.failedTransactions || []).filter((p: any, idx: number, arr: any[]) => arr.findIndex((x: any) => x.id === p.id) === idx);
  const failedReasonSummary = Object.entries(
    failedTxns.reduce((acc: Record<string, number>, row: any) => {
      const key = String(row?.reason || "Unknown failure").trim() || "Unknown failure";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ) as [string, number][]
  const topFailedReasonSummary = failedReasonSummary
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3);
  const courseAbandoned = a.abandonedCheckouts || [];
  const bookAbandoned = (a.bookAbandonedCheckouts || []).map((b: any) => ({
    ...b, course_title: b.book_title, category: b.author ? `by ${b.author}` : "Book", isBook: true,
  }));
  const allAbandoned = [...courseAbandoned, ...bookAbandoned].sort((x, y) => parseInt(y.click_count) - parseInt(x.click_count));

  const renderTransactionRow = (p: any, idx: number, total: number) => (
    <View key={String(p.id || idx)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: idx < total - 1 ? 1 : 0, borderBottomColor: Colors.light.border }}>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>{p.user_name || "—"}</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.user_phone || p.user_email || ""}</Text>
      </View>
      <Text style={{ flex: 2, fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{p.course_title}</Text>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#22C55E", textAlign: "right" }}>{formatCurrency(parseFloat(p.amount || 0))}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "right" }}>{formatDate(p.created_at)}</Text>
    </View>
  );

  const renderAbandonedRow = (p: any, idx: number, total: number) => (
    <View key={String(p.id || idx)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: idx < total - 1 ? 1 : 0, borderBottomColor: Colors.light.border }}>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>{p.user_name || "—"}</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.user_phone || p.user_email || ""}</Text>
      </View>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{p.course_title}</Text>
        <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.category}</Text>
      </View>
      <View style={{ flex: 1, alignItems: "center" }}>
        <View style={{ backgroundColor: parseInt(p.click_count) > 2 ? "#FEE2E2" : "#FEF3C7", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, minWidth: 32, alignItems: "center" }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: parseInt(p.click_count) > 2 ? "#DC2626" : "#D97706" }}>{p.click_count || 1}</Text>
        </View>
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#F59E0B", textAlign: "right" }}>₹{parseFloat(p.price || 0).toFixed(0)}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "right" }}>{formatDate(p.created_at)}</Text>
    </View>
  );

  const renderFailedRow = (p: any, idx: number, total: number) => (
    <View key={String(p.id || idx)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: idx < total - 1 ? 1 : 0, borderBottomColor: Colors.light.border }}>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>{p.user_name || "—"}</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.user_phone || p.user_email || ""}</Text>
      </View>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{p.course_title || "Course payment"}</Text>
        <Text style={{ fontSize: 11, color: "#DC2626", fontFamily: "Inter_500Medium" }} numberOfLines={1}>{p.reason || "Payment failed"}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#DC2626", textAlign: "right" }}>{formatCurrency(parseFloat(p.amount || 0))}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "right" }}>{formatDate(p.created_at)}</Text>
    </View>
  );

  const renderBookPurchaseRow = (p: any, idx: number, total: number) => (
    <View key={String(p.id || idx)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: idx < total - 1 ? 1 : 0, borderBottomColor: Colors.light.border }}>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>{p.user_name || "—"}</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.user_phone || p.user_email || ""}</Text>
      </View>
      <View style={{ flex: 2, gap: 1 }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.text }} numberOfLines={1}>{p.book_title}</Text>
        {p.author ? <Text style={{ fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{p.author}</Text> : null}
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", color: "#8B5CF6", textAlign: "right" }}>{formatCurrency(parseFloat(p.amount || 0))}</Text>
      <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, textAlign: "right" }}>{formatDate(p.created_at)}</Text>
    </View>
  );

  const renderCourseRow = (course: any, idx: number, total: number) => (
    <View key={String(course.id || idx)} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: idx < total - 1 ? 1 : 0, borderBottomColor: Colors.light.border }}>
      <View style={{ flex: 3, gap: 2 }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }} numberOfLines={1}>{course.title}</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>{course.category} · {course.is_free ? "Free" : `₹${parseFloat(course.price || 0).toFixed(0)}`}</Text>
      </View>
      <View style={{ flex: 1, alignItems: "center" }}>
        <View style={{ backgroundColor: "#EEF2FF", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>{course.enrollment_count || 0}</Text>
        </View>
      </View>
      <Text style={{ flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#22C55E", textAlign: "right" }}>
        {parseFloat(course.revenue || 0) > 0 ? formatCurrency(parseFloat(course.revenue)) : "—"}
      </Text>
    </View>
  );

  const ViewMoreBtn = ({ title, data, type }: { title: string; data: any[]; type: string }) =>
    data.length > 5 ? (
      <Pressable onPress={() => setViewMoreModal({ title, data, type })}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 14, borderTopWidth: 1, borderTopColor: Colors.light.border }}>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>View All {data.length} Records</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.light.primary} />
      </Pressable>
    ) : null;

  return (
    <View style={styles.section}>
      {/* View More Modal */}
      <Modal visible={!!viewMoreModal} animationType="slide" onRequestClose={() => setViewMoreModal(null)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <LinearGradient colors={isDarkMode ? ["#020617", "#0F172A"] : ["#0A1628", "#1A2E50"]} style={{ paddingTop: 60, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Pressable style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }} onPress={() => setViewMoreModal(null)}>
              <Ionicons name="arrow-back" size={20} color="#fff" />
            </Pressable>
            <Text style={{ fontSize: 17, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 }} numberOfLines={1}>{viewMoreModal?.title}</Text>
            <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>{viewMoreModal?.data.length} records</Text>
          </LinearGradient>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
              {viewMoreModal?.type === "transactions" && viewMoreModal.data.map((p, idx) => renderTransactionRow(p, idx, viewMoreModal.data.length))}
              {viewMoreModal?.type === "failed" && viewMoreModal.data.map((p, idx) => renderFailedRow(p, idx, viewMoreModal.data.length))}
              {viewMoreModal?.type === "abandoned" && viewMoreModal.data.map((p, idx) => renderAbandonedRow(p, idx, viewMoreModal.data.length))}
              {viewMoreModal?.type === "courses" && viewMoreModal.data.map((c, idx) => renderCourseRow(c, idx, viewMoreModal.data.length))}
              {viewMoreModal?.type === "books" && viewMoreModal.data.map((p, idx) => renderBookPurchaseRow(p, idx, viewMoreModal.data.length))}
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Lifetime Revenue */}
      <View style={{ backgroundColor: "#0A1628", borderRadius: 20, padding: 24, marginBottom: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" }}>Lifetime Revenue</Text>
            <Text style={{ fontSize: 36, fontFamily: "Inter_700Bold", color: "#fff" }}>{formatCurrency((a.lifetimeRevenue || 0) + (a.lifetimeBookRevenue || 0) + (a.lifetimeTestRevenue || 0))}</Text>
            <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }}>{a.lifetimeEnrollments || 0} enrollments</Text>
          </View>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="trending-up" size={32} color="#22C55E" />
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, gap: 2 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.5)" }}>Courses</Text>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: "#22C55E" }}>{formatCurrency(a.lifetimeRevenue || 0)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, gap: 2 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.5)" }}>Books</Text>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: "#A78BFA" }}>{formatCurrency(a.lifetimeBookRevenue || 0)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 12, gap: 2 }}>
            <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.5)" }}>Tests</Text>
            <Text style={{ fontSize: 18, fontFamily: "Inter_700Bold", color: "#38BDF8" }}>{formatCurrency(a.lifetimeTestRevenue || 0)}</Text>
          </View>
        </View>
      </View>

      {/* Filter */}
      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.text, marginBottom: 12 }}>Filter by Period</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {PERIODS.map((p) => (
            <Pressable key={p.key} onPress={() => selectPeriod(p.key)}
              style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: period === p.key ? Colors.light.primary : Colors.light.border, backgroundColor: period === p.key ? Colors.light.primary : "#fff" }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: period === p.key ? "#fff" : Colors.light.text }}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        {showCustom && (
          <View style={{ marginTop: 12, gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CUSTOM_RANGE_PRESETS.map((preset) => (
                <Pressable
                  key={preset.months}
                  onPress={() => applyCustomPreset(preset.months)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    borderWidth: 1.5,
                    borderColor: Colors.light.border,
                    backgroundColor: "#F9FAFB",
                  }}
                >
                  <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>{preset.label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 4 }}>Start Date</Text>
              <TextInput style={[styles.formInput, { paddingVertical: 8 }]} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.light.textMuted} value={customStart} onChangeText={setCustomStart} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, marginBottom: 4 }}>End Date</Text>
              <TextInput style={[styles.formInput, { paddingVertical: 8 }]} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.light.textMuted} value={customEnd} onChangeText={setCustomEnd} />
            </View>
            <Pressable onPress={() => refetch()} style={{ alignSelf: "flex-end", backgroundColor: Colors.light.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
              <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Apply</Text>
            </Pressable>
          </View>
          </View>
        )}
      </View>

      {isLoading ? (
        <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator size="large" color={Colors.light.primary} /></View>
      ) : (
        <>
          {/* Summary cards */}
          <View style={{ flexDirection: "row", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Course Revenue", value: formatCurrency(a.totalRevenue || 0), icon: "cash-outline" as const, color: "#22C55E", bg: "#DCFCE7" },
              { label: "Book Revenue", value: formatCurrency((a.bookPurchases || []).reduce((s: number, b: any) => s + parseFloat(b.amount || 0), 0)), icon: "storefront-outline" as const, color: "#8B5CF6", bg: "#F3E8FF" },
              { label: "Enrollments", value: String(a.totalEnrollments || 0), icon: "people-outline" as const, color: Colors.light.primary, bg: "#EEF2FF" },
              { label: "Buy Now (Abandoned)", value: String((a.abandonedCheckouts || []).length), icon: "cart-outline" as const, color: "#F59E0B", bg: "#FEF3C7" },
            ].map((stat) => (
              <View key={stat.label} style={{ flex: 1, minWidth: 150, backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 8, borderWidth: 1, borderColor: colors.border }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: stat.bg, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name={stat.icon} size={20} color={stat.color} />
                </View>
                <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text }}>{stat.value}</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* All Successful Transactions */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden", marginBottom: 14 }}>
            <Pressable onPress={() => setExpandedSection("successful")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#F9FAFB" }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>All Successful Transactions ({txns.length})</Text>
              <Ionicons name={expandedSection === "successful" ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
            </Pressable>
            {expandedSection === "successful" && (
              <>
                <View style={{ flexDirection: "row", backgroundColor: "#DCFCE7", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#BBF7D0" }}>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#166534", textTransform: "uppercase" }}>Student</Text>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#166534", textTransform: "uppercase" }}>Course</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#166534", textTransform: "uppercase", textAlign: "right" }}>Amount</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#166534", textTransform: "uppercase", textAlign: "right" }}>Date</Text>
                </View>
                {txns.length === 0
                  ? <View style={{ padding: 24, alignItems: "center" }}><Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>No transactions in this period</Text></View>
                  : txns.slice(0, 5).map((p: any, idx: number) => renderTransactionRow(p, idx, Math.min(5, txns.length)))}
                <ViewMoreBtn title={`All Successful Transactions — ${periodLabel}`} data={txns} type="transactions" />
              </>
            )}
          </View>

          {/* Failed Transactions */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden", marginBottom: 14 }}>
            <Pressable onPress={() => setExpandedSection("failed")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#F9FAFB" }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Failed Transactions ({failedTxns.length})</Text>
              <Ionicons name={expandedSection === "failed" ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
            </Pressable>
            {expandedSection === "failed" && (
              <>
                {topFailedReasonSummary.length > 0 && (
                  <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    {topFailedReasonSummary.map(([reason, count]) => (
                      <View key={reason} style={{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 999, backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECACA", paddingHorizontal: 10, paddingVertical: 6, maxWidth: "100%" }}>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_700Bold", color: "#B91C1C" }}>{count}</Text>
                        <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: "#7F1D1D" }} numberOfLines={1}>{reason}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: "row", backgroundColor: "#FEE2E2", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#FCA5A5" }}>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B", textTransform: "uppercase" }}>Student</Text>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B", textTransform: "uppercase" }}>Course / Reason</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B", textTransform: "uppercase", textAlign: "right" }}>Amount</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#991B1B", textTransform: "uppercase", textAlign: "right" }}>Date</Text>
                </View>
                {failedTxns.length === 0
                  ? <View style={{ padding: 24, alignItems: "center" }}><Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>No failed transactions in this period</Text></View>
                  : failedTxns.slice(0, 5).map((p: any, idx: number) => renderFailedRow(p, idx, Math.min(5, failedTxns.length)))}
                <ViewMoreBtn title={`Failed Transactions — ${periodLabel}`} data={failedTxns} type="failed" />
              </>
            )}
          </View>

          {/* Buy Now - Not Purchased */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden", marginBottom: 14 }}>
            <Pressable onPress={() => setExpandedSection("abandoned")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#F9FAFB" }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Buy Now - Not Purchased ({allAbandoned.length})</Text>
              <Ionicons name={expandedSection === "abandoned" ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
            </Pressable>
            {expandedSection === "abandoned" && (
              <>
                <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
                  <Pressable
                    disabled={resetAbandonedMutation.isPending || allAbandoned.length === 0}
                    onPress={() => {
                      const runReset = () => resetAbandonedMutation.mutate();
                      if (Platform.OS === "web") {
                        if (window.confirm("Reset all Buy Now - Not Purchased records? This clears pending course and book tap tracking.")) runReset();
                      } else {
                        Alert.alert("Reset records", "This clears all Buy Now - Not Purchased records for courses and books.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Reset", style: "destructive", onPress: runReset },
                        ]);
                      }
                    }}
                    style={{ alignSelf: "flex-end", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: "#F59E0B", backgroundColor: (resetAbandonedMutation.isPending || allAbandoned.length === 0) ? "#F3F4F6" : "#FFF7ED" }}
                  >
                    {resetAbandonedMutation.isPending ? <ActivityIndicator size="small" color="#F59E0B" /> : <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: allAbandoned.length === 0 ? "#9CA3AF" : "#C2410C" }}>Reset</Text>}
                  </Pressable>
                </View>
                <View style={{ flexDirection: "row", backgroundColor: "#FEF3C7", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#FDE68A" }}>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", textTransform: "uppercase" }}>Student</Text>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", textTransform: "uppercase" }}>Item</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", textTransform: "uppercase", textAlign: "center" }}>Taps</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", textTransform: "uppercase", textAlign: "right" }}>Price</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#92400E", textTransform: "uppercase", textAlign: "right" }}>Date</Text>
                </View>
                {allAbandoned.length === 0
                  ? <View style={{ padding: 24, alignItems: "center" }}><Ionicons name="checkmark-circle" size={32} color="#22C55E" /><Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 }}>No abandoned checkouts</Text></View>
                  : allAbandoned.slice(0, 5).map((p: any, idx: number) => renderAbandonedRow(p, idx, Math.min(5, allAbandoned.length)))}
                <ViewMoreBtn title="Buy Now — Not Purchased" data={allAbandoned} type="abandoned" />
              </>
            )}
          </View>

          {/* Course wise enrollments & revenue */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden", marginBottom: 14 }}>
            <Pressable onPress={() => setExpandedSection("coursewise")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#F9FAFB" }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Course wise enrollments & Revenue ({(a.courseBreakdown || []).length})</Text>
              <Ionicons name={expandedSection === "coursewise" ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
            </Pressable>
            {expandedSection === "coursewise" && (
              <>
                <View style={{ flexDirection: "row", backgroundColor: "#F9FAFB", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.light.border }}>
                  <Text style={{ flex: 3, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted, textTransform: "uppercase" }}>Course</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted, textTransform: "uppercase", textAlign: "center" }}>Enrollments</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted, textTransform: "uppercase", textAlign: "right" }}>Revenue</Text>
                </View>
                {(a.courseBreakdown || []).slice(0, 5).map((course: any, idx: number) => renderCourseRow(course, idx, Math.min(5, (a.courseBreakdown || []).length)))}
                <ViewMoreBtn title="Course-wise Enrollments & Revenue" data={a.courseBreakdown || []} type="courses" />
              </>
            )}
          </View>

          {/* Book Purchases */}
          <View style={{ backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: Colors.light.border, overflow: "hidden", marginBottom: 20 }}>
            <Pressable onPress={() => setExpandedSection("books")} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, backgroundColor: "#F9FAFB" }}>
              <Text style={{ fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Book Purchase ({(a.bookPurchases || []).length})</Text>
              <Ionicons name={expandedSection === "books" ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
            </Pressable>
            {expandedSection === "books" && (
              <>
                <View style={{ flexDirection: "row", backgroundColor: "#F3E8FF", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E9D5FF" }}>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B21A8", textTransform: "uppercase" }}>Student</Text>
                  <Text style={{ flex: 2, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B21A8", textTransform: "uppercase" }}>Book</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B21A8", textTransform: "uppercase", textAlign: "right" }}>Price</Text>
                  <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#6B21A8", textTransform: "uppercase", textAlign: "right" }}>Date</Text>
                </View>
                {(a.bookPurchases || []).length === 0
                  ? <View style={{ padding: 24, alignItems: "center" }}><Ionicons name="book-outline" size={32} color={Colors.light.textMuted} /><Text style={{ color: Colors.light.textMuted, fontFamily: "Inter_400Regular", marginTop: 8 }}>No book purchases in this period</Text></View>
                  : (a.bookPurchases || []).slice(0, 5).map((p: any, idx: number) => renderBookPurchaseRow(p, idx, Math.min(5, (a.bookPurchases || []).length)))}
                <ViewMoreBtn title={`Book Purchases — ${periodLabel}`} data={a.bookPurchases || []} type="books" />
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  section: { gap: 12 },
  formInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
});
