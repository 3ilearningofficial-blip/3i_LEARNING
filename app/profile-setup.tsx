import React, { useState } from "react";
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
  Platform, ActivityIndicator, Alert, Image, KeyboardAvoidingView,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { apiRequest } from "@/lib/query-client";
import { uploadToR2 } from "@/lib/r2-upload";
import {
  PROFILE_PERMANENT_FIELDS_NOTICE,
  PROFILE_SAVE_CONFIRM_MESSAGE,
  PROFILE_SAVE_CONFIRM_TITLE,
} from "@/lib/profile-completion-ui";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

export default function ProfileSetupScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateUser, login } = useAuth();

  const [name, setName] = useState(
    // Pre-fill if name is already a real name (not the auto-generated "StudentXXXX")
    user?.name && !/^Student\d{4}$/.test(user.name) ? user.name : ""
  );
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  const topPadding = insets.top;
  const bottomPadding = insets.bottom;

  const handlePickPhoto = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (file) {
          setPhotoUploading(true);
          try {
            const blobUrl = URL.createObjectURL(file);
            const { publicUrl } = await uploadToR2(blobUrl, file.name, file.type || "image/jpeg", "images", undefined, "/api/upload/presign-profile");
            URL.revokeObjectURL(blobUrl);
            setPhotoUri(publicUrl);
            setPhotoUploading(false);
          } catch { setPhotoUploading(false); Alert.alert("Upload Failed"); }
        }
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setPhotoUploading(true);
      try {
        const { publicUrl } = await uploadToR2(asset.uri, asset.fileName || `profile-${Date.now()}.jpg`, asset.mimeType || "image/jpeg", "images", undefined, "/api/upload/presign-profile");
        setPhotoUri(publicUrl);
      } catch { Alert.alert("Upload Failed"); }
      setPhotoUploading(false);
    }
  };

  const formatDob = (text: string) => {
    // Auto-format as DD/MM/YYYY
    const digits = text.replace(/\D/g, "");
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedDob = dob.trim();

    setError("");

    if (!trimmedName) { setError("Please enter your full name."); return; }
    if (!trimmedDob) { setError("Please enter your date of birth (DD/MM/YYYY)."); return; }
    const dobParts = trimmedDob.split("/");
    if (dobParts.length !== 3 || dobParts[2].length !== 4 || dobParts[0].length !== 2 || dobParts[1].length !== 2) {
      setError("Please enter date as DD/MM/YYYY (e.g. 15/08/2000).");
      return;
    }
    if (!trimmedEmail) { setError("Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) { setError("Please create a password."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }

    const performSave = async () => {
      setIsLoading(true);
      try {
        const res = await apiRequest("PUT", "/api/auth/profile", {
          name: trimmedName,
          dateOfBirth: trimmedDob,
          email: trimmedEmail,
          photoUrl: photoUri || undefined,
          password,
        });
        const data = await res.json();
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (data?.user) {
          login(data.user);
        } else {
          updateUser({ name: trimmedName, email: trimmedEmail, profileComplete: true, date_of_birth: trimmedDob });
        }
        router.replace("/(tabs)");
      } catch (err: any) {
        console.error("Profile save error:", err);
        setError(err?.message || "Failed to save profile. Please try again.");
      } finally {
        setIsLoading(false);
      }
    };

    Alert.alert(PROFILE_SAVE_CONFIRM_TITLE, PROFILE_SAVE_CONFIRM_MESSAGE, [
      { text: "Review", style: "cancel" },
      { text: "Save & continue", onPress: () => void performSave() },
    ]);
  };

  return (
    <LinearGradient colors={["#0A1628", "#1A2E50", "#0A1628"]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: topPadding + 24, paddingBottom: bottomPadding + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.headerSection}>
            <Text style={styles.title}>Complete Your Profile</Text>
            <Text style={styles.subtitle}>Fill in your details to use the app — this is required before you continue</Text>
          </View>

          <View style={styles.permanentNotice}>
            <Ionicons name="warning-outline" size={22} color="#B45309" style={styles.permanentNoticeIcon} />
            <Text style={styles.permanentNoticeText}>{PROFILE_PERMANENT_FIELDS_NOTICE}</Text>
          </View>

          {/* Photo picker — centered at top */}
          <View style={styles.photoSection}>
            <Pressable style={styles.photoWrapper} onPress={handlePickPhoto}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoImage} />
              ) : (
                <View style={styles.photoPlaceholder}>
                  <Ionicons name="person" size={44} color="rgba(255,255,255,0.4)" />
                </View>
              )}
              <View style={styles.photoEditBadge}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </Pressable>
            <Text style={styles.photoHint}>Tap to add photo (optional)</Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            {/* Name */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Name <Text style={styles.required}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your full name"
                  placeholderTextColor={Colors.light.textMuted}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Date of Birth */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Date of Birth <Text style={styles.required}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="calendar-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor={Colors.light.textMuted}
                  value={dob}
                  onChangeText={(t) => setDob(formatDob(t))}
                  keyboardType="number-pad"
                  maxLength={10}
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email Address <Text style={styles.required}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="mail-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={Colors.light.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Create Password <Text style={styles.required}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={Colors.light.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  returnKeyType="next"
                />
                <Pressable onPress={() => setShowPassword(p => !p)}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Re-enter Password <Text style={styles.required}>*</Text></Text>
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Re-enter your password"
                  placeholderTextColor={Colors.light.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                />
                <Pressable onPress={() => setShowConfirm(p => !p)}>
                  <Ionicons name={showConfirm ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.light.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* Phone (read-only) */}
            {user?.phone && (
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Phone Number</Text>
                <View style={[styles.inputRow, styles.inputRowDisabled]}>
                  <Ionicons name="call-outline" size={18} color={Colors.light.textMuted} style={styles.inputIcon} />
                  <Text style={styles.inputDisabled}>+91 {user.phone}</Text>
                  <Ionicons name="lock-closed-outline" size={14} color={Colors.light.textMuted} />
                </View>
              </View>
            )}

            {!!error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }]}
              onPress={handleSave}
              disabled={isLoading}
            >
              <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.saveBtnGradient}>
                {isLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text style={styles.saveBtnText}>Save & Continue</Text>
                    <Ionicons name="arrow-forward" size={20} color="#fff" />
                  </>
                )}
              </LinearGradient>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, gap: 24 },
  headerSection: { alignItems: "center", gap: 8 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff", textAlign: "center" },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 8 },
  permanentNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(251, 191, 36, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(251, 191, 36, 0.45)",
  },
  permanentNoticeIcon: { marginTop: 2 },
  permanentNoticeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.92)",
  },
  photoSection: { alignItems: "center", gap: 10 },
  photoWrapper: { position: "relative", width: 100, height: 100 },
  photoImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: Colors.light.primary },
  photoPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 2, borderColor: "rgba(255,255,255,0.25)",
    borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  photoEditBadge: {
    position: "absolute", bottom: 2, right: 2,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  photoHint: { fontSize: 12, color: "rgba(255,255,255,0.5)", fontFamily: "Inter_400Regular" },
  card: {
    backgroundColor: "#fff", borderRadius: 24, padding: 24, gap: 18,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.2, shadowRadius: 20, elevation: 10,
  },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  required: { color: "#EF4444" },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.light.background, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.light.border,
    paddingHorizontal: 12, paddingVertical: 13, gap: 10,
  },
  inputRowDisabled: { backgroundColor: "#F9FAFB" },
  inputIcon: {},
  input: {
    flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  inputDisabled: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: Colors.light.textMuted },
  saveBtn: { borderRadius: 14, overflow: "hidden", marginTop: 4 },
  saveBtnGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 16, gap: 8 },
  saveBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: "#fff" },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEE2E2", borderRadius: 10, padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626" },
});
