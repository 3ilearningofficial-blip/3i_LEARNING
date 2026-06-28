import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Platform, Image,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function StaffAccessTab() {
  const { colors } = useAppTheme();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"" | "teacher" | "manager">("");
  const debouncedSearch = useDebounced(search);

  const { data: staff = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/staff", debouncedSearch, roleFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (roleFilter) params.set("role", roleFilter);
      const url = new URL(`/api/admin/staff?${params.toString()}`, getApiUrl());
      const res = await authFetch(url.toString());
      if (!res.ok) throw new Error("Failed to load staff");
      return res.json();
    },
    staleTime: 0,
  });

  const counts = useMemo(() => ({
    teachers: staff.filter((s) => s.role === "teacher").length,
    managers: staff.filter((s) => s.role === "manager").length,
  }), [staff]);

  return (
    <View style={styles.section}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: colors.text }]}>Staff & Access</Text>
        <Pressable style={styles.addBtn} onPress={() => router.push("/admin/staff/new" as any)}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add Staff</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={[styles.statCard, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.statNum, { color: Colors.light.primary }]}>{counts.teachers}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Teachers</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.statNum, { color: Colors.light.primary }]}>{counts.managers}</Text>
          <Text style={[styles.statLabel, { color: colors.textMuted }]}>Managers</Text>
        </View>
      </View>

      <TextInput
        style={[styles.search, { backgroundColor: colors.surfaceAlt, color: colors.text, borderColor: colors.border }]}
        placeholder="Search name, phone, email..."
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.filterRow}>
        {(["", "teacher", "manager"] as const).map((r) => (
          <Pressable
            key={r || "all"}
            style={[styles.chip, roleFilter === r && styles.chipActive]}
            onPress={() => setRoleFilter(r)}
          >
            <Text style={[styles.chipText, roleFilter === r && styles.chipTextActive]}>
              {r === "" ? "All" : r.charAt(0).toUpperCase() + r.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 24 }} />
      ) : staff.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textMuted }]}>No staff found. Create or promote a user.</Text>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {staff.map((s) => (
            <Pressable
              key={s.id}
              style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              onPress={() => router.push(`/admin/staff/${s.id}` as any)}
            >
              <View style={styles.cardRow}>
                {s.photoUrl ? (
                  <Image source={{ uri: s.photoUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={22} color="#fff" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardName, { color: colors.text }]}>{s.name}</Text>
                  <Text style={[styles.cardMeta, { color: colors.textMuted }]}>
                    {s.role} · {s.employeeId || "No emp ID"} · {s.courseCount} course(s)
                  </Text>
                  <Text style={[styles.cardMeta, { color: colors.textMuted }]}>{s.phone || s.email || "—"}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: 16, flex: 1 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: Colors.light.primary,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
  },
  addBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 14 },
  statCard: { flex: 1, borderRadius: 12, padding: 14, alignItems: "center" },
  statNum: { fontSize: 24, fontFamily: "Inter_800ExtraBold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  search: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === "web" ? 10 : 12,
    fontFamily: "Inter_400Regular", marginBottom: 10,
  },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 14, flexWrap: "wrap" },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.06)" },
  chipActive: { backgroundColor: Colors.light.primary + "22" },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.light.textSecondary },
  chipTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  empty: { textAlign: "center", marginTop: 32, fontFamily: "Inter_400Regular" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center" },
  cardName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
