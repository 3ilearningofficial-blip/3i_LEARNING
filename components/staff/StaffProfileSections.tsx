import React, { useCallback, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, Pressable, Platform, ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";
import { uploadToR2, getMimeType } from "@/lib/r2-upload";
import * as ImagePicker from "expo-image-picker";

const SECTIONS = ["Personal", "Education", "Experience", "Working", "Bank", "Company"] as const;
type SectionKey = (typeof SECTIONS)[number];

export type StaffProfileSectionsProps = {
  mode: "admin" | "teacher";
  profile: any;
  user: any;
  education: any[];
  experience: any[];
  onSavePersonal?: (data: Record<string, unknown>) => Promise<void>;
  onSaveEducation?: (items: any[]) => Promise<void>;
  onSaveBank?: (data: Record<string, unknown>) => Promise<void>;
  onSaveAdmin?: (data: Record<string, unknown>) => Promise<void>;
  saving?: boolean;
};

export function StaffProfileSections({
  mode,
  profile,
  user,
  education,
  experience,
  onSavePersonal,
  onSaveEducation,
  onSaveBank,
  onSaveAdmin,
  saving,
}: StaffProfileSectionsProps) {
  const { colors } = useAppTheme();
  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});
  const [active, setActive] = useState<SectionKey>("Personal");

  const personal = profile?.personal_json || profile?.personalJson || {};
  const working = profile?.working_json || profile?.workingJson || {};
  const bank = profile?.bank_json || profile?.bankJson || {};
  const company = profile?.company_json || profile?.companyJson || {};

  const [name, setName] = useState(user?.name || "");
  const [dob, setDob] = useState(personal.dob || "");
  const [personalPhone, setPersonalPhone] = useState(personal.phone || user?.phone || "");
  const [personalEmail, setPersonalEmail] = useState(personal.email || user?.email || "");
  const [aadharNumber, setAadharNumber] = useState(profile?.aadhar_number || profile?.aadharNumber || "");
  const [photoUrl, setPhotoUrl] = useState(profile?.photo_url || profile?.photoUrl || "");
  const [bankName, setBankName] = useState(bank.bankName || "");
  const [accountNumber, setAccountNumber] = useState(bank.accountNumber || "");
  const [ifsc, setIfsc] = useState(bank.ifsc || "");
  const [eduItems, setEduItems] = useState<any[]>(
    education?.length ? education : [{ degree: "", institute: "", passingYear: "" }],
  );

  const canEditPersonal = mode === "teacher" || mode === "admin";
  const canEditBank = mode === "teacher" || mode === "admin";
  const canEditEducation = mode === "teacher" || mode === "admin";
  const canEditWorking = mode === "admin";

  const scrollToSection = (key: SectionKey) => {
    setActive(key);
    const y = sectionY.current[key];
    if (y != null) scrollRef.current?.scrollTo({ y, animated: true });
  };

  const onScroll = useCallback((e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    let current: SectionKey = "Personal";
    for (const s of SECTIONS) {
      const sy = sectionY.current[s];
      if (sy != null && y >= sy - 80) current = s;
    }
    setActive(current);
  }, []);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    const name = uri.split("/").pop() || "photo.jpg";
    const uploaded = await uploadToR2(uri, name, getMimeType(name), "images");
    setPhotoUrl(uploaded.publicUrl);
  };

  const renderSectionHeader = (title: SectionKey) => (
    <Text style={[styles.sectionTitle, { color: colors.text }]}>{title} Details</Text>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipBar} contentContainerStyle={styles.chipContent}>
        {SECTIONS.map((s) => (
          <Pressable key={s} style={[styles.chip, active === s && styles.chipActive]} onPress={() => scrollToSection(s)}>
            <Text style={[styles.chipText, active === s && styles.chipTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        <View onLayout={(e) => { sectionY.current.Personal = e.nativeEvent.layout.y; }}>
          {renderSectionHeader("Personal")}
          {photoUrl ? <Text style={{ color: colors.textMuted, marginBottom: 8 }}>Photo set</Text> : null}
          {canEditPersonal && (
            <Pressable style={styles.smallBtn} onPress={pickPhoto}>
              <Text style={styles.smallBtnText}>Upload Photo</Text>
            </Pressable>
          )}
          <Field label="Name" value={name} onChange={setName} editable={canEditPersonal} colors={colors} />
          <Field label="DOB" value={dob} onChange={setDob} editable={canEditPersonal} colors={colors} />
          <Field label="Phone" value={personalPhone} onChange={setPersonalPhone} editable={canEditPersonal} colors={colors} />
          <Field label="Email" value={personalEmail} onChange={setPersonalEmail} editable={canEditPersonal} colors={colors} />
          <Field label="Aadhar Number" value={aadharNumber} onChange={setAadharNumber} editable={canEditPersonal} colors={colors} />
          {canEditPersonal && onSavePersonal && (
            <SaveBtn saving={saving} onPress={() => onSavePersonal({
              name, personalJson: { dob, phone: personalPhone, email: personalEmail },
              aadharNumber, photoUrl,
            })} />
          )}
        </View>

        <View onLayout={(e) => { sectionY.current.Education = e.nativeEvent.layout.y; }}>
          {renderSectionHeader("Education")}
          {eduItems.map((e, i) => (
            <View key={i} style={[styles.eduCard, { borderColor: colors.border }]}>
              <Field label="Degree" value={e.degree || ""} onChange={(v: string) => { const n = [...eduItems]; n[i] = { ...n[i], degree: v }; setEduItems(n); }} editable={canEditEducation} colors={colors} />
              <Field label="Institute" value={e.institute || ""} onChange={(v: string) => { const n = [...eduItems]; n[i] = { ...n[i], institute: v }; setEduItems(n); }} editable={canEditEducation} colors={colors} />
              <Field label="Year" value={e.passing_year || e.passingYear || ""} onChange={(v: string) => { const n = [...eduItems]; n[i] = { ...n[i], passingYear: v }; setEduItems(n); }} editable={canEditEducation} colors={colors} />
            </View>
          ))}
          {canEditEducation && (
            <>
              <Pressable style={styles.smallBtn} onPress={() => setEduItems([...eduItems, { degree: "", institute: "", passingYear: "" }])}>
                <Text style={styles.smallBtnText}>+ Add Education</Text>
              </Pressable>
              {onSaveEducation && <SaveBtn saving={saving} label="Save Education" onPress={() => onSaveEducation(eduItems)} />}
            </>
          )}
        </View>

        <View onLayout={(e) => { sectionY.current.Experience = e.nativeEvent.layout.y; }}>
          {renderSectionHeader("Experience")}
          {experience?.length ? experience.map((ex: any) => (
            <View key={ex.id} style={[styles.eduCard, { borderColor: colors.border }]}>
              <Text style={{ color: colors.text, fontFamily: "Inter_600SemiBold" }}>{ex.institute_name || ex.instituteName || "—"}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{ex.designation} · {ex.years_experience || ex.yearsExperience} yrs</Text>
            </View>
          )) : <Text style={{ color: colors.textMuted }}>No experience on file</Text>}
        </View>

        <View onLayout={(e) => { sectionY.current.Working = e.nativeEvent.layout.y; }}>
          {renderSectionHeader("Working")}
          <ReadField label="Role" value={user?.role} colors={colors} />
          <ReadField label="Teacher ID" value={profile?.teacher_id || profile?.teacherId} colors={colors} />
          <ReadField label="Employee ID" value={profile?.employee_id || profile?.employeeId} colors={colors} />
          <ReadField label="Reporting Manager" value={profile?.reporting_manager || profile?.reportingManager || working.reportingManager} colors={colors} />
        </View>

        <View onLayout={(e) => { sectionY.current.Bank = e.nativeEvent.layout.y; }}>
          {renderSectionHeader("Bank")}
          <Field label="Bank Name" value={bankName} onChange={setBankName} editable={canEditBank} colors={colors} />
          <Field label="Account Number" value={accountNumber} onChange={setAccountNumber} editable={canEditBank} colors={colors} />
          <Field label="IFSC" value={ifsc} onChange={setIfsc} editable={canEditBank} colors={colors} />
          {canEditBank && onSaveBank && (
            <SaveBtn saving={saving} onPress={() => onSaveBank({ bankJson: { bankName, accountNumber, ifsc } })} />
          )}
        </View>

        <View onLayout={(e) => { sectionY.current.Company = e.nativeEvent.layout.y; }} style={{ paddingBottom: 40 }}>
          {renderSectionHeader("Company")}
          <ReadField label="Institute" value={company.instituteName || "3i Learning"} colors={colors} />
          <ReadField label="HR Contact" value={company.hrContact} colors={colors} />
        </View>
      </ScrollView>
    </View>
  );
}

function Field({ label, value, onChange, editable, colors }: any) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.surfaceAlt, color: colors.text, opacity: editable ? 1 : 0.7 }]}
        value={value}
        onChangeText={onChange}
        editable={editable}
      />
    </View>
  );
}

function ReadField({ label, value, colors }: any) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <Text style={{ color: colors.text, fontFamily: "Inter_500Medium" }}>{value || "—"}</Text>
    </View>
  );
}

function SaveBtn({ onPress, saving, label = "Save" }: { onPress: () => void; saving?: boolean; label?: string }) {
  return (
    <Pressable style={styles.saveBtn} onPress={onPress} disabled={saving}>
      {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chipBar: { maxHeight: 44, marginBottom: 12 },
  chipContent: { paddingHorizontal: 4, gap: 8, alignItems: "center" },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.06)" },
  chipActive: { backgroundColor: Colors.light.primary + "22" },
  chipText: { fontFamily: "Inter_500Medium", fontSize: 13, color: Colors.light.textSecondary },
  chipTextActive: { color: Colors.light.primary, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 20, marginBottom: 12 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === "web" ? 8 : 10, fontFamily: "Inter_400Regular" },
  eduCard: { borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  smallBtn: { alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.light.primary + "18", borderRadius: 8, marginBottom: 8 },
  smallBtnText: { color: Colors.light.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  saveBtn: { backgroundColor: Colors.light.primary, borderRadius: 10, padding: 12, alignItems: "center", marginTop: 8, marginBottom: 8 },
  saveBtnText: { color: "#fff", fontFamily: "Inter_700Bold" },
});
