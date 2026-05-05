import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  Platform, ActivityIndicator, Alert, Image, Linking, Modal, Share,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { myPaymentsQueryKey } from "@/lib/query-keys";
import { getInstallationId } from "@/lib/installation-id";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const ADMIN_EMAIL = "3ilearningofficial@gmail.com";
const ADMIN_WHATSAPP = "9997198068";

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { user, updateUser, logout } = useAuth();
  const isAdmin = user?.role === "admin";
  const topPadding = Platform.OS === "web" ? 16 : insets.top;
  const bottomPadding = insets.bottom;

  const [photoUri, setPhotoUri] = useState<string | null>(user?.photo_url || null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [showShareModal, setShowShareModal] = useState(false);

  const APP_URL = "https://3ilearning.in";
  const SHARE_MESSAGE = `Join me on 3i Learning — the best app for exam preparation! ${APP_URL}`;
  const [editEmail, setEditEmail] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Change password modal
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);

  // Fetch fresh profile data from server (ensures date_of_birth, photo_url are current)
  const { data: freshProfile } = useQuery<any>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/auth/me", baseUrl).toString());
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data?.id !== "number") return null;
      return data;
    },
    staleTime: 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!freshProfile || typeof freshProfile.id !== "number") return;
    if (user?.id != null && freshProfile.id !== user.id) return;
    updateUser(freshProfile);
  }, [freshProfile, user?.id]);

  // Use fresh profile data if available, fall back to cached user
  const profile = freshProfile || user;

  // Payments
  const { data: payments = [], isLoading: payLoading } = useQuery<any[]>({
    queryKey: user?.id ? myPaymentsQueryKey(user.id) : ["/api/my-payments", "guest"],
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/my-payments", baseUrl).toString());
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user?.id,
  });

  const [activeSection, setActiveSection] = useState<"payments" | "contact" | null>(null);

  const handlePickPhoto = async () => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file"; input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
          const uri = ev.target?.result as string;
          setPhotoUri(uri);
          await savePhoto(uri);
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Please allow photo library access."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true, aspect: [1, 1], quality: 0.7, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const uri = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
      setPhotoUri(uri);
      await savePhoto(uri);
    }
  };

  const savePhoto = async (uri: string) => {
    setIsSavingPhoto(true);
    try {
      await apiRequest("PUT", "/api/auth/profile", { name: user?.name, photoUrl: uri });
      updateUser({ photo_url: uri });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (_e) {
      Alert.alert("Error", "Failed to save photo.");
    } finally {
      setIsSavingPhoto(false);
    }
  };

  const handleSaveEdit = async () => {
    setEditError("");
    if (!editName.trim()) { setEditError("Name cannot be empty."); return; }
    setIsSavingEdit(true);
    try {
      const baseUrl = getApiUrl();
      const res = await authFetch(new URL("/api/auth/profile", baseUrl).toString(), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), email: editEmail.trim() || undefined }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ message: `Error ${res.status}` }));
        setEditError(errData.message || "Failed to save.");
        return;
      }
      updateUser({ name: editName.trim(), email: editEmail.trim() || user?.email });
      setIsEditing(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setEditError(err?.message || "Network error. Make sure server is running.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleChangePassword = async () => {
    setPwdError("");
    if (!oldPwd) { setPwdError("Please enter your current password."); return; }
    if (!newPwd) { setPwdError("Enter a new password."); return; }
    if (newPwd.length < 6) { setPwdError("Password must be at least 6 characters."); return; }
    if (newPwd !== confirmPwd) { setPwdError("Passwords do not match."); return; }
    setPwdLoading(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", { oldPassword: oldPwd, newPassword: newPwd });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowChangePwd(false);
      setOldPwd(""); setNewPwd(""); setConfirmPwd(""); setOtpSent(false); setOtpCode("");
      Alert.alert("Success", "Password changed successfully.");
    } catch (err: any) {
      setPwdError(err?.message?.replace(/^\d+: /, "") || "Failed to change password.");
    } finally {
      setPwdLoading(false);
    }
  };

  const handleSendOtpForReset = async (preferEmail = false) => {
    setOtpLoading(true);
    setPwdError("");
    try {
      // Use email if available and preferred, otherwise phone
      const identifier = (preferEmail && profile?.email) ? profile.email : (profile?.phone || profile?.email);
      const type = (preferEmail && profile?.email) ? "email" : "phone";
      if (!identifier) { setPwdError("No email or phone on file."); setOtpLoading(false); return; }
      await apiRequest("POST", "/api/auth/send-otp", { identifier, type });
      setOtpSent(true);
    } catch (err: any) {
      setPwdError("Failed to send OTP. Try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleOtpPasswordReset = async () => {
    setPwdError("");
    if (!otpCode || otpCode.length !== 6) { setPwdError("Enter the 6-digit OTP."); return; }
    if (!newPwd) { setPwdError("Enter a new password."); return; }
    if (newPwd.length < 6) { setPwdError("Password must be at least 6 characters."); return; }
    if (newPwd !== confirmPwd) { setPwdError("Passwords do not match."); return; }
    setPwdLoading(true);
    try {
      // Verify OTP first
      const identifier = user?.email || user?.phone;
      const type = user?.email ? "email" : "phone";
      const verifyRes = await apiRequest("POST", "/api/auth/verify-otp", {
        identifier,
        type,
        otp: otpCode,
        deviceId: await getInstallationId(),
      });
      const verifyData = await verifyRes.json();
      // Now change password (no old password needed since OTP verified)
      await apiRequest("POST", "/api/auth/change-password", { newPassword: newPwd });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowChangePwd(false);
      setOldPwd(""); setNewPwd(""); setConfirmPwd(""); setOtpSent(false); setOtpCode("");
      Alert.alert("Success", "Password changed successfully.");
    } catch (err: any) {
      setPwdError(err?.message?.replace(/^\d+: /, "") || "Failed to reset password.");
    } finally {
      setPwdLoading(false);
    }
  };

  const performDeleteAccount = async () => {
    setDeleteAccountBusy(true);
    try {
      await apiRequest("DELETE", "/api/auth/account");
      qc.clear();
      await logout();
      router.replace("/welcome");
    } catch (e: any) {
      const msg =
        typeof e?.message === "string"
          ? e.message.replace(/^\d+:\s*/, "")
          : "Failed to delete account. Try again or contact support.";
      Alert.alert("Error", msg);
    } finally {
      setDeleteAccountBusy(false);
    }
  };

  const handleDeleteAccount = () => {
    const msg =
      "Your account and related data will be permanently removed: courses, tests, daily missions, downloads, payments records, support messages, and profile. This cannot be undone. Continue?";
    if (Platform.OS === "web") {
      if (!window.confirm(msg)) return;
      if (!window.confirm("Final confirmation: delete your account permanently?")) return;
      void performDeleteAccount();
    } else {
      Alert.alert("Delete account?", msg, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete permanently", style: "destructive", onPress: () => void performDeleteAccount() },
      ]);
    }
  };

  const handleLogout = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Are you sure you want to logout?")) {
        logout().then(() => router.replace("/welcome"));
      }
    } else {
      Alert.alert("Logout", "Are you sure?", [
        { text: "Cancel", style: "cancel" },
        { text: "Logout", style: "destructive", onPress: () => logout().then(() => router.replace("/welcome")) },
      ]);
    }
  };

  const displayPhoto = photoUri || profile?.photo_url;

  return (
    <View style={styles.container}>
      {/* Header — compact, avatar only */}
      <LinearGradient colors={["#0A1628", "#1A2E50"]} style={[styles.header, { paddingTop: topPadding + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable style={styles.iconBtn} onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)");
          }}>
            <Ionicons name="arrow-back" size={22} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>My Profile</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Avatar only — no name/phone text */}
        <View style={styles.avatarSection}>
          <Pressable style={styles.avatarWrap} onPress={handlePickPhoto}>
            {displayPhoto ? (
              <Image source={{ uri: displayPhoto }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{profile?.name?.charAt(0)?.toUpperCase() || "S"}</Text>
              </View>
            )}
            <View style={styles.avatarCamBadge}>
              {isSavingPhoto ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={13} color="#fff" />}
            </View>
          </Pressable>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPadding + 32 }]}>

        {/* Personal Details card */}
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <Text style={styles.cardTitle}>Personal Details</Text>
            {isAdmin && !isEditing && (
              <Pressable onPress={() => { setIsEditing(true); setEditName(profile?.name || ""); setEditEmail(profile?.email || ""); setEditError(""); }}>
                <Ionicons name="create-outline" size={20} color={Colors.light.primary} />
              </Pressable>
            )}
          </View>

          {isAdmin && isEditing ? (
            <>
              <View style={styles.fieldGroup}>
                <Text style={styles.detailLabel}>FULL NAME</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="person-outline" size={16} color={Colors.light.textMuted} />
                  <TextInput
                    style={styles.input}
                    value={editName}
                    onChangeText={setEditName}
                    autoCapitalize="words"
                    placeholder="Your name"
                    placeholderTextColor={Colors.light.textMuted}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.detailLabel}>EMAIL</Text>
                <View style={styles.inputRow}>
                  <Ionicons name="mail-outline" size={16} color={Colors.light.textMuted} />
                  <TextInput
                    style={styles.input}
                    value={editEmail}
                    onChangeText={setEditEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    placeholder="Your email"
                    placeholderTextColor={Colors.light.textMuted}
                  />
                </View>
              </View>
              {!!editError && (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={14} color="#EF4444" />
                  <Text style={styles.errorText}>{editError}</Text>
                </View>
              )}
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable style={[styles.saveBtn, { flex: 1 }]} onPress={handleSaveEdit} disabled={isSavingEdit}>
                  <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.saveBtnGrad}>
                    {isSavingEdit ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
                  </LinearGradient>
                </Pressable>
                <Pressable style={[styles.saveBtn, { flex: 1, borderWidth: 1, borderColor: Colors.light.border, borderRadius: 12, overflow: "hidden" }]} onPress={() => setIsEditing(false)}>
                  <View style={{ paddingVertical: 13, alignItems: "center" }}>
                    <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Cancel</Text>
                  </View>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <DetailRow icon="person-outline" label="Full Name" value={profile?.name} />
              <DetailRow icon="call-outline" label="Phone" value={profile?.phone ? `+91 ${profile.phone}` : undefined} locked />
              <DetailRow icon="mail-outline" label="Email" value={profile?.email} locked={!isAdmin} />
              <DetailRow icon="calendar-outline" label="Date of Birth" value={profile?.date_of_birth || user?.date_of_birth || "Not set"} locked />
            </>
          )}
        </View>

        {/* Downloads */}
        <Pressable
          style={styles.menuItem}
          onPress={() => router.push("/downloads")}
        >
          <View style={[styles.menuIcon, { backgroundColor: "#EEF2FF" }]}>
            <Ionicons name="download-outline" size={20} color="#1A56DB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuTitle}>My Downloads</Text>
            <Text style={styles.menuSub}>Lectures & study materials</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        </Pressable>

        {/* Payments / Invoice */}
        <SectionCard
          icon="receipt-outline"
          color="#059669"
          title="Invoice / Payments"
          subtitle="Your course purchase history"
          expanded={activeSection === "payments"}
          onToggle={() => setActiveSection(s => s === "payments" ? null : "payments")}
        >
          {payLoading ? <ActivityIndicator color={Colors.light.primary} style={{ marginVertical: 12 }} /> :
            payments.length === 0 ? (
              <Text style={styles.emptyText}>No invoices yet. Enroll in a paid course to see your purchase history.</Text>
            ) : payments.map((p) => (
              <View key={p.id} style={styles.listItem}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.listItemTitle}>{p.course_title}</Text>
                  <Text style={styles.listItemSub}>
                    ₹{(p.amount / 100).toFixed(0)} · {new Date(Number(p.created_at)).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.paidBadge}><Text style={styles.paidBadgeText}>PAID</Text></View>
              </View>
            ))
          }
        </SectionCard>

        {/* Contact / Help */}
        <SectionCard
          icon="help-circle-outline"
          color="#F59E0B"
          title="Contact / Help"
          subtitle="Reach out to us"
          expanded={activeSection === "contact"}
          onToggle={() => setActiveSection(s => s === "contact" ? null : "contact")}
        >
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              style={[styles.contactOption, { backgroundColor: "#EEF2FF" }]}
              onPress={() => {
                const subject = encodeURIComponent(`Help Request from ${user?.name || "Student"}`);
                const body = encodeURIComponent(`Hi 3i Learning Team,\n\nI need help with:\n\n\nMy name: ${user?.name || ""}\nMy email: ${user?.email || ""}\nMy phone: ${user?.phone || ""}`);
                const url = `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
                if (Platform.OS === "web") {
                  window.location.href = url;
                } else {
                  Linking.openURL(url).catch(() =>
                    Alert.alert("No Mail App", "Please send an email to " + ADMIN_EMAIL)
                  );
                }
              }}
            >
              <View style={[styles.contactOptionIcon, { backgroundColor: "#1A56DB" }]}>
                <Ionicons name="mail" size={20} color="#fff" />
              </View>
              <Text style={styles.contactOptionText}>Email</Text>
            </Pressable>
            <Pressable
              style={[styles.contactOption, { backgroundColor: "#F0FDF4" }]}
              onPress={() => {
                const url = `https://wa.me/91${ADMIN_WHATSAPP}?text=${encodeURIComponent(`Hi, I need help with 3i Learning app. My name is ${user?.name || "Student"}.`)}`;
                if (Platform.OS === "web") {
                  window.open(url, "_blank");
                } else {
                  Linking.openURL(url);
                }
              }}
            >
              <View style={[styles.contactOptionIcon, { backgroundColor: "#25D366" }]}>
                <Ionicons name="logo-whatsapp" size={20} color="#fff" />
              </View>
              <Text style={styles.contactOptionText}>WhatsApp</Text>
            </Pressable>
          </View>
          <Text style={styles.contactNote}>We typically respond within 24 hours</Text>
        </SectionCard>

        {/* Book Store */}
        <Pressable
          style={styles.optionRow}
          onPress={() => router.push("/store")}
        >
          <View style={[styles.optionIcon, { backgroundColor: "#8B5CF618" }]}>
            <Ionicons name="storefront-outline" size={20} color="#8B5CF6" />
          </View>
          <Text style={styles.optionLabel}>Book Store</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        </Pressable>

        {/* Change Password */}
        <Pressable
          style={styles.optionRow}
          onPress={() => { setShowChangePwd(true); setPwdError(""); setOldPwd(""); setNewPwd(""); setConfirmPwd(""); }}
        >
          <View style={[styles.optionIcon, { backgroundColor: "#8B5CF618" }]}>
            <Ionicons name="key-outline" size={20} color="#8B5CF6" />
          </View>
          <Text style={styles.optionLabel}>Change Password</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        </Pressable>

        {/* Share App */}
        <Pressable
          style={styles.optionRow}
          onPress={() => {
            if (Platform.OS !== "web") {
              // Mobile: use native share sheet
              Share.share({ message: SHARE_MESSAGE, url: APP_URL, title: "3i Learning" }).catch(() => {});
            } else {
              // Web: show custom share modal
              setShowShareModal(true);
            }
          }}
        >
          <View style={[styles.optionIcon, { backgroundColor: "#1A56DB18" }]}>
            <Ionicons name="share-social-outline" size={20} color="#1A56DB" />
          </View>
          <Text style={styles.optionLabel}>Share App</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        </Pressable>

        {/* Delete account — students only */}
        {!isAdmin ? (
          <Pressable
            style={[styles.optionRow, deleteAccountBusy && { opacity: 0.6 }]}
            onPress={handleDeleteAccount}
            disabled={deleteAccountBusy}
          >
            <View style={[styles.optionIcon, { backgroundColor: "#991B1B22" }]}>
              <Ionicons name="trash-outline" size={20} color="#B91C1C" />
            </View>
            <Text style={[styles.optionLabel, { color: "#B91C1C" }]}>
              {deleteAccountBusy ? "Deleting…" : "Delete Account"}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
          </Pressable>
        ) : null}

        {/* Logout */}
        <Pressable style={styles.optionRow} onPress={handleLogout}>
          <View style={[styles.optionIcon, { backgroundColor: "#EF444418" }]}>
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          </View>
          <Text style={[styles.optionLabel, { color: "#EF4444" }]}>Logout</Text>
          <Ionicons name="chevron-forward" size={18} color={Colors.light.textMuted} />
        </Pressable>
      </ScrollView>

      {/* Share App Modal (web) */}
      <Modal visible={showShareModal} animationType="fade" transparent onRequestClose={() => setShowShareModal(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} onPress={() => setShowShareModal(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: (insets.bottom || 16) + 16 }}>
            <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 20, textAlign: "center" }}>Share 3i Learning</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, justifyContent: "center", marginBottom: 20 }}>
              {[
                { label: "WhatsApp", icon: "logo-whatsapp", color: "#25D366", bg: "#F0FDF4", url: `https://wa.me/?text=${encodeURIComponent(SHARE_MESSAGE)}` },
                { label: "Telegram", icon: "paper-plane-outline", color: "#0088CC", bg: "#EFF9FF", url: `https://t.me/share/url?url=${encodeURIComponent(APP_URL)}&text=${encodeURIComponent("Join me on 3i Learning!")}` },
                { label: "Instagram", icon: "logo-instagram", color: "#E1306C", bg: "#FFF0F5", url: `https://www.instagram.com/` },
                { label: "Facebook", icon: "logo-facebook", color: "#1877F2", bg: "#EFF4FF", url: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_URL)}` },
                { label: "Email", icon: "mail-outline", color: "#F59E0B", bg: "#FFFBEB", url: `mailto:?subject=${encodeURIComponent("Check out 3i Learning!")}&body=${encodeURIComponent(SHARE_MESSAGE)}` },
              ].map((opt) => (
                <Pressable key={opt.label} onPress={() => { setShowShareModal(false); window.open(opt.url, "_blank"); }}
                  style={{ alignItems: "center", gap: 6, width: 64 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: opt.bg, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name={opt.icon as any} size={26} color={opt.color} />
                  </View>
                  <Text style={{ fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted }}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            {/* Copy link */}
            <Pressable
              onPress={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  navigator.clipboard.writeText(SHARE_MESSAGE);
                  setShowShareModal(false);
                  Alert.alert("Copied!", "App link copied to clipboard.");
                }
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: Colors.light.secondary, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.light.border }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#EEF2FF", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="copy-outline" size={20} color={Colors.light.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text }}>Copy Link</Text>
                <Text style={{ fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted }} numberOfLines={1}>{APP_URL}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.light.textMuted} />
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Change Password Modal */}
      <Modal visible={showChangePwd} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change Password</Text>
              <Pressable onPress={() => { setShowChangePwd(false); setOtpSent(false); setOtpCode(""); }}>
                <Ionicons name="close" size={24} color={Colors.light.text} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {!otpSent ? (
                <>
                  {/* Old password → New → Confirm */}
                  <PwdField label="Current Password" value={oldPwd} onChange={setOldPwd} show={showOld} onToggle={() => setShowOld(p => !p)} placeholder="Enter current password" />
                  <PwdField label="New Password" value={newPwd} onChange={setNewPwd} show={showNew} onToggle={() => setShowNew(p => !p)} placeholder="Min. 6 characters" />
                  <PwdField label="Confirm New Password" value={confirmPwd} onChange={setConfirmPwd} show={showConfirmPwd} onToggle={() => setShowConfirmPwd(p => !p)} placeholder="Re-enter new password" />

                  {!!pwdError && (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                      <Text style={styles.errorText}>{pwdError}</Text>
                    </View>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }]}
                    onPress={handleChangePassword}
                    disabled={pwdLoading}
                  >
                    <LinearGradient colors={[Colors.light.primary, Colors.light.primaryDark]} style={styles.saveBtnGrad}>
                      {pwdLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Update Password</Text>}
                    </LinearGradient>
                  </Pressable>

                  {/* Divider */}
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>Forgot password?</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {/* OTP reset options */}
                  <Text style={styles.otpResetLabel}>Reset via OTP instead</Text>
                  <View style={styles.otpResetBtns}>
                    {profile?.email && (
                      <Pressable
                        style={({ pressed }) => [styles.otpResetBtn, pressed && { opacity: 0.85 }]}
                        onPress={() => handleSendOtpForReset(true)}
                        disabled={otpLoading}
                      >
                        {otpLoading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : (
                          <>
                            <Ionicons name="mail-outline" size={16} color={Colors.light.primary} />
                            <Text style={styles.otpResetBtnText}>Email OTP</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                    {profile?.phone && (
                      <Pressable
                        style={({ pressed }) => [styles.otpResetBtn, pressed && { opacity: 0.85 }]}
                        onPress={() => handleSendOtpForReset(false)}
                        disabled={otpLoading}
                      >
                        {otpLoading ? <ActivityIndicator size="small" color={Colors.light.primary} /> : (
                          <>
                            <Ionicons name="phone-portrait-outline" size={16} color={Colors.light.primary} />
                            <Text style={styles.otpResetBtnText}>Phone OTP</Text>
                          </>
                        )}
                      </Pressable>
                    )}
                  </View>
                </>
              ) : (
                <>
                  {/* OTP sent — enter OTP + new password */}
                  <View style={styles.otpSentBanner}>
                    <Ionicons name="checkmark-circle" size={18} color="#22C55E" />
                    <Text style={styles.otpSentText}>
                      OTP sent to {user?.email || `+91 ${user?.phone}`}
                    </Text>
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.fieldLabel}>Enter OTP</Text>
                    <View style={styles.inputRow}>
                      <Ionicons name="keypad-outline" size={16} color={Colors.light.textMuted} />
                      <TextInput
                        style={styles.input}
                        value={otpCode}
                        onChangeText={setOtpCode}
                        keyboardType="number-pad"
                        maxLength={6}
                        placeholder="6-digit OTP"
                        placeholderTextColor={Colors.light.textMuted}
                      />
                    </View>
                  </View>

                  <PwdField label="New Password" value={newPwd} onChange={setNewPwd} show={showNew} onToggle={() => setShowNew(p => !p)} placeholder="Min. 6 characters" />
                  <PwdField label="Confirm New Password" value={confirmPwd} onChange={setConfirmPwd} show={showConfirmPwd} onToggle={() => setShowConfirmPwd(p => !p)} placeholder="Re-enter new password" />

                  {!!pwdError && (
                    <View style={styles.errorBox}>
                      <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                      <Text style={styles.errorText}>{pwdError}</Text>
                    </View>
                  )}

                  <Pressable
                    style={({ pressed }) => [styles.saveBtn, pressed && { opacity: 0.9 }]}
                    onPress={handleOtpPasswordReset}
                    disabled={pwdLoading}
                  >
                    <LinearGradient colors={["#22C55E", "#16A34A"]} style={styles.saveBtnGrad}>
                      {pwdLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Reset Password</Text>}
                    </LinearGradient>
                  </Pressable>

                  <Pressable onPress={() => { setOtpSent(false); setPwdError(""); }} style={{ alignItems: "center", marginTop: 8 }}>
                    <Text style={styles.otpResetBtnText}>← Back to password entry</Text>
                  </Pressable>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({ icon, label, value, locked }: { icon: any; label: string; value?: string; locked?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIconWrap}>
        <Ionicons name={icon} size={16} color={Colors.light.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value || "—"}</Text>
      </View>
      {locked && <Ionicons name="lock-closed-outline" size={14} color={Colors.light.textMuted} />}
    </View>
  );
}

function SectionCard({ icon, color, title, subtitle, expanded, onToggle, children }: {
  icon: any; color: string; title: string; subtitle: string;
  expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Pressable style={styles.sectionHeader} onPress={onToggle}>
        <View style={[styles.optionIcon, { backgroundColor: color + "18" }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSub}>{subtitle}</Text>
        </View>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={Colors.light.textMuted} />
      </Pressable>
      {expanded && <View style={styles.sectionContent}>{children}</View>}
    </View>
  );
}

function PwdField({ label, value, onChange, show, onToggle, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void; placeholder: string;
}) {
  return (
    <View style={[styles.fieldGroup, { marginBottom: 12 }]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputRow}>
        <Ionicons name="lock-closed-outline" size={16} color={Colors.light.textMuted} />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!show}
          placeholder={placeholder}
          placeholderTextColor={Colors.light.textMuted}
          autoCapitalize="none"
        />
        <Pressable onPress={onToggle}>
          <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={16} color={Colors.light.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  header: { paddingHorizontal: 16, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  iconBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  avatarSection: { alignItems: "center" },
  avatarWrap: { position: "relative", width: 72, height: 72 },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: "rgba(255,255,255,0.4)" },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.light.primary,
    alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "rgba(255,255,255,0.4)",
  },
  avatarInitial: { fontSize: 26, fontFamily: "Inter_700Bold", color: "#fff" },
  avatarCamBadge: {
    position: "absolute", bottom: 0, right: 0, width: 24, height: 24, borderRadius: 12,
    backgroundColor: Colors.light.primary, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  scroll: { padding: 16, gap: 12 },
  card: {
    backgroundColor: "#fff", borderRadius: 18, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
  },
  cardTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 8 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  detailIconWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: Colors.light.secondary, alignItems: "center", justifyContent: "center" },
  detailLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: Colors.light.textMuted, textTransform: "uppercase", letterSpacing: 0.4 },
  detailValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text, marginTop: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: Colors.light.text },
  sectionSub: { fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  sectionContent: { marginTop: 12, gap: 8 },
  emptyText: { fontSize: 13, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 8 },
  listItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.light.border },
  listItemTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  listItemSub: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" },
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.light.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  menuTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  menuSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: Colors.light.textMuted, marginTop: 1 },
  paidBadge: { backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  paidBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#15803D" },
  contactBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: Colors.light.primary, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 16, marginBottom: 8,
  },
  contactBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#fff" },
  contactNote: { fontSize: 11, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 4 },
  contactOption: {
    flex: 1, alignItems: "center", gap: 8, paddingVertical: 14,
    borderRadius: 12, borderWidth: 1, borderColor: Colors.light.border,
  },
  contactOptionIcon: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  contactOptionText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.text },
  optionRow: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: "#fff", borderRadius: 14, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  optionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  optionLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: Colors.light.text },
  fieldGroup: { gap: 4 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: Colors.light.background, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.light.border,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  input: {
    flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEE2E2", borderRadius: 10, padding: 10, marginBottom: 8 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: "#DC2626" },
  saveBtn: { borderRadius: 12, overflow: "hidden", marginTop: 4 },
  saveBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, gap: 8 },
  saveBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalSheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: Colors.light.text },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 16 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.light.border },
  dividerText: { fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textMuted },
  otpResetLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary, textAlign: "center", marginBottom: 10 },
  otpResetBtns: { flexDirection: "row", gap: 10, justifyContent: "center" },
  otpResetBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: Colors.light.primary,
    borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16,
  },
  otpResetBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  otpSentBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#DCFCE7", borderRadius: 10, padding: 12, marginBottom: 16,
  },
  otpSentText: { fontSize: 13, fontFamily: "Inter_500Medium", color: "#15803D", flex: 1 },
});
