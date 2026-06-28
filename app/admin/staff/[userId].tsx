import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Modal, TextInput, Platform,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { StaffProfileSections } from "@/components/staff/StaffProfileSections";
import { STAFF_PERMISSION_KEYS } from "@/shared/staff-permission-keys";
import { MULTI_SUBJECTS } from "@/constants/multiSubjects";

export default function AdminStaffDetailScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { colors } = useAppTheme();
  const qc = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [subjectKey, setSubjectKey] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/staff", userId],
    enabled: !!userId,
    queryFn: async () => {
      const res = await authFetch(new URL(`/api/admin/staff/${userId}`, getApiUrl()).toString());
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const { data: courses = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/courses-list"],
    queryFn: async () => {
      const res = await authFetch(new URL("/api/courses", getApiUrl()).toString());
      if (!res.ok) return [];
      return res.json();
    },
  });

  const demoteMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/admin/staff/${userId}/demote`, {}),
    onSuccess: () => {
      Alert.alert("Demoted", "Staff role removed.");
      router.back();
    },
  });

  const assignMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/admin/staff/${userId}/assignments`, {
        courseId: Number(courseId),
        subjectKey: subjectKey || null,
      }),
    onSuccess: () => {
      setAssignOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/admin/staff", userId] });
    },
  });

  const saveAdmin = async (payload: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/admin/staff/${userId}`, payload);
      qc.invalidateQueries({ queryKey: ["/api/admin/staff", userId] });
    } finally {
      setSaving(false);
    }
  };

  const saveEducation = async (items: any[]) => {
    setSaving(true);
    try {
      await apiRequest("PUT", `/api/admin/staff/${userId}/education`, { items });
      qc.invalidateQueries({ queryKey: ["/api/admin/staff", userId] });
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !data) {
    return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;
  }

  const selectedCourse = courses.find((c) => String(c.id) === courseId);
  const multiConfig = selectedCourse?.multi_subject_config || selectedCourse?.multiSubjectConfig || [];
  const isMulti = String(selectedCourse?.course_type || "").toLowerCase() === "multi_subject";

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ padding: 16 }}>
      <Pressable onPress={() => router.back()} style={styles.back}>
        <Ionicons name="arrow-back" size={22} color={colors.text} />
        <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>Back</Text>
      </Pressable>

      <Text style={[styles.title, { color: colors.text }]}>{data.user?.name}</Text>
      <Text style={{ color: colors.textMuted, marginBottom: 12 }}>{data.user?.role} · {data.profile?.employee_id || "No emp ID"}</Text>

      <View style={styles.actionRow}>
        <Pressable style={styles.assignBtn} onPress={() => setAssignOpen(true)}>
          <Text style={styles.assignBtnText}>Assign Course</Text>
        </Pressable>
        <Pressable style={styles.demoteBtn} onPress={() => demoteMutation.mutate()}>
          <Text style={styles.demoteBtnText}>Remove Role</Text>
        </Pressable>
      </View>

      <Text style={[styles.subTitle, { color: colors.text }]}>Assigned Courses</Text>
      {(data.assignments || []).map((a: any) => (
        <View key={a.id} style={[styles.assignCard, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>Course #{a.course_id}{a.subject_key ? ` · ${a.subject_key}` : ""}</Text>
        </View>
      ))}

      <StaffProfileSections
        mode="admin"
        profile={data.profile}
        user={data.user}
        education={data.education || []}
        experience={data.experience || []}
        saving={saving}
        onSavePersonal={saveAdmin}
        onSaveBank={saveAdmin}
        onSaveEducation={saveEducation}
        onSaveAdmin={saveAdmin}
      />

      <Text style={[styles.subTitle, { color: colors.text, marginTop: 24 }]}>Permissions</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {STAFF_PERMISSION_KEYS.slice(0, 8).map((k) => (
          <View key={k} style={styles.permChip}>
            <Text style={styles.permText}>{k}: {data.permissions?.[k] ? "✓" : "✗"}</Text>
          </View>
        ))}
      </View>

      <Modal visible={assignOpen} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { backgroundColor: colors.background }]}>
            <Text style={[styles.subTitle, { color: colors.text }]}>Assign Course</Text>
            <ScrollView style={{ maxHeight: 200 }}>
              {courses.map((c) => (
                <Pressable key={c.id} style={styles.coursePick} onPress={() => setCourseId(String(c.id))}>
                  <Text style={{ color: courseId === String(c.id) ? Colors.light.primary : colors.text }}>{c.title}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {isMulti && multiConfig?.length > 0 && (
              <ScrollView horizontal style={{ marginVertical: 8 }}>
                {MULTI_SUBJECTS.filter((s) => multiConfig.some((m: any) => (m.key || m.subjectKey) === s.key)).map((s) => (
                  <Pressable key={s.key} style={[styles.chip, subjectKey === s.key && styles.chipActive]} onPress={() => setSubjectKey(s.key)}>
                    <Text style={subjectKey === s.key ? styles.chipTextActive : undefined}>{s.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={styles.assignBtn} onPress={() => assignMutation.mutate()}>
              <Text style={styles.assignBtnText}>Save Assignment</Text>
            </Pressable>
            <Pressable onPress={() => setAssignOpen(false)} style={{ marginTop: 10, alignItems: "center" }}>
              <Text style={{ color: colors.textMuted }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  subTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 8 },
  actionRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  assignBtn: { backgroundColor: Colors.light.primary, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  assignBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  demoteBtn: { backgroundColor: "#dc2626", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  demoteBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  assignCard: { padding: 10, borderRadius: 8, marginBottom: 6 },
  permChip: { backgroundColor: "rgba(0,0,0,0.06)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  permText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modal: { padding: 20, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "70%" },
  coursePick: { paddingVertical: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "rgba(0,0,0,0.06)", marginRight: 8 },
  chipActive: { backgroundColor: Colors.light.primary + "22" },
  chipTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
});
