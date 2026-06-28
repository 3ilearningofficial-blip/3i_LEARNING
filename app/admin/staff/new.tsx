import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Platform,
} from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
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

export default function AdminStaffNewScreen() {
  const { colors } = useAppTheme();
  const [mode, setMode] = useState<"create" | "promote">("create");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [role, setRole] = useState<"teacher" | "manager">("teacher");
  const [userSearch, setUserSearch] = useState("");
  const debouncedUserSearch = useDebounced(userSearch);

  const { data: searchResults = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", "promote", debouncedUserSearch],
    enabled: mode === "promote" && debouncedUserSearch.length >= 2,
    queryFn: async () => {
      const url = new URL(`/api/admin/users?search=${encodeURIComponent(debouncedUserSearch)}&limit=20`, getApiUrl());
      const res = await authFetch(url.toString());
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/staff/create", {
        name, phone, email, role, employeeId, teacherId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      Alert.alert("Created", "Staff account created. They can log in with phone OTP.");
      router.replace(`/admin/staff/${data.id}` as any);
    },
    onError: (e: any) => Alert.alert("Error", e?.message || "Failed to create"),
  });

  const promoteMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiRequest("POST", `/api/admin/staff/${userId}/promote`, {
        role, employeeId, teacherId,
      });
      return res.json();
    },
    onSuccess: (_d, userId) => {
      Alert.alert("Promoted", "User promoted to staff.");
      router.replace(`/admin/staff/${userId}` as any);
    },
    onError: (e: any) => Alert.alert("Error", e?.message || "Failed to promote"),
  });

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ padding: 16 }}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={colors.text} />
        <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
      </Pressable>

      <Text style={[styles.title, { color: colors.text }]}>Add Staff</Text>

      <View style={styles.modeRow}>
        {(["create", "promote"] as const).map((m) => (
          <Pressable key={m} style={[styles.modeBtn, mode === m && styles.modeBtnActive]} onPress={() => setMode(m)}>
            <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
              {m === "create" ? "Create New" : "Promote Existing"}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.roleRow}>
        {(["teacher", "manager"] as const).map((r) => (
          <Pressable key={r} style={[styles.chip, role === r && styles.chipActive]} onPress={() => setRole(r)}>
            <Text style={[styles.chipText, role === r && styles.chipTextActive]}>{r.charAt(0).toUpperCase() + r.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "create" ? (
        <>
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Full name" placeholderTextColor={colors.textMuted} value={name} onChangeText={setName} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Phone (required)" placeholderTextColor={colors.textMuted} keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Email (optional)" placeholderTextColor={colors.textMuted} value={email} onChangeText={setEmail} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Employee ID" placeholderTextColor={colors.textMuted} value={employeeId} onChangeText={setEmployeeId} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Teacher ID" placeholderTextColor={colors.textMuted} value={teacherId} onChangeText={setTeacherId} />
          <Pressable style={styles.submit} onPress={() => createMutation.mutate()} disabled={createMutation.isPending}>
            {createMutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Staff</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]}
            placeholder="Search student by name, phone, email..."
            placeholderTextColor={colors.textMuted}
            value={userSearch}
            onChangeText={setUserSearch}
          />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Employee ID" placeholderTextColor={colors.textMuted} value={employeeId} onChangeText={setEmployeeId} />
          <TextInput style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text }]} placeholder="Teacher ID" placeholderTextColor={colors.textMuted} value={teacherId} onChangeText={setTeacherId} />
          {searchResults.map((u) => (
            <View key={u.id} style={[styles.userRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.userName, { color: colors.text }]}>{u.name}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{u.phone || u.email} · {u.role || "student"}</Text>
              </View>
              <Pressable
                style={styles.promoteBtn}
                onPress={() => promoteMutation.mutate(Number(u.id))}
                disabled={promoteMutation.isPending || u.role === "admin"}
              >
                <Text style={styles.promoteBtnText}>Promote</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 16 },
  backText: { fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 24, fontFamily: "Inter_800ExtraBold", marginBottom: 16 },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  modeBtn: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.06)", alignItems: "center" },
  modeBtnActive: { backgroundColor: Colors.light.primary + "22" },
  modeText: { fontFamily: "Inter_500Medium", color: Colors.light.textSecondary },
  modeTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  roleRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.06)" },
  chipActive: { backgroundColor: Colors.light.primary + "22" },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13 },
  chipTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  input: {
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === "web" ? 10 : 12,
    marginBottom: 10, fontFamily: "Inter_400Regular",
  },
  submit: { backgroundColor: Colors.light.primary, borderRadius: 10, padding: 14, alignItems: "center", marginTop: 8 },
  submitText: { color: "#fff", fontFamily: "Inter_700Bold" },
  userRow: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  userName: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  promoteBtn: { backgroundColor: Colors.light.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  promoteBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
