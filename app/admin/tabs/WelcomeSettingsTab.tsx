import React from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch,
  ActivityIndicator, TextInput, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { apiRequest, authFetch, getApiUrl } from "@/lib/query-client";
import { uploadToR2 } from "@/lib/r2-upload";
import {
  WELCOME_LOGO_DISPLAY_ADMIN_HINT,
} from "@/lib/welcome-image-sizes";
import {
  MAX_WELCOME_BANNERS,
  parseWelcomeBannerSlides,
  serializeWelcomeBannerSlides,
  validateWelcomeBannerJsonForSave,
  type WelcomeBannerSlideUrls,
  isWelcomeBannerSlideEmpty,
} from "@/lib/welcome-banners";
import {
  WELCOME_BANNER_MOBILE_RECOMMENDED,
  WELCOME_BANNER_DESKTOP_RECOMMENDED,
} from "@/constants/courseBanner";
import WelcomeBannerPreview from "@/components/admin/WelcomeBannerPreview";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";

function validateWelcomeJsonForSave(settings: Record<string, string>): string | null {
  return validateWelcomeBannerJsonForSave(settings);
}

export function WelcomeSettingsTab() {
  const qc = useQueryClient();
  const { colors } = useAppTheme();
  const [settings, setSettings] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const [welcomeUploadProgress, setWelcomeUploadProgress] = React.useState<{ key: string; pct: number } | null>(null);
  const [bannerSlots, setBannerSlots] = React.useState<WelcomeBannerSlideUrls[]>([]);
  const [bannerUpload, setBannerUpload] = React.useState<{ slot: number; variant: "mobile" | "desktop"; pct: number } | null>(null);
  const welcomeAbortRef = React.useRef<AbortController | null>(null);
  const bannerAbortRef = React.useRef<AbortController | null>(null);

  const defaults: Record<string, string> = {
    welcome_tagline: "Master Mathematics Under Pankaj Sir Guidance",
    welcome_brand_text: "3i Learning",
    welcome_logo_url: "",
    welcome_banner_images_json: "[]",
    welcome_show_get_app: "true",
    welcome_get_app_title: "Join students on the app today!",
    welcome_get_app_subtitle: "You can download the app from iOS, Play Store, or continue on web.",
    welcome_card_play_title: "Google Play",
    welcome_card_play_desc: "Download Android app",
    welcome_card_ios_title: "App Store",
    welcome_card_ios_desc: "Download iOS app",
    welcome_card_web_title: "Web",
    welcome_card_web_desc: "Use the full app in your browser",
    welcome_card_pwa_title: "Install",
    welcome_card_pwa_desc: "Add to home screen as a web app",
    welcome_google_play_url: "https://play.google.com/store/apps/details?id=com.learning.threeI",
    welcome_app_store_url: "https://apps.apple.com",
    welcome_show_google_play: "true",
    welcome_show_ios: "true",
    welcome_show_web_app: "true",
    welcome_show_web_download: "true",
    welcome_footer: "© 2026 3i Learning. All rights reserved.",
    /** Shown on web welcome header only (phone + mail icons); not shown in Android/iOS apps. */
    welcome_web_contact_phone: "9997198068",
    welcome_web_contact_email: "3ilearningofficial@gmail.com",
    privacy_policy_title: "Privacy Policy",
    privacy_policy_url: "",
    privacy_policy_content: "3i Learning respects your privacy. We collect only the information needed to provide learning services, manage your account, process purchases, improve app performance, and support students. We do not sell your personal information. For any privacy questions, contact us at 3ilearningofficial@gmail.com.",
  };

  React.useEffect(() => {
    (async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/site-settings", baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          const merged = { ...defaults, ...data };
          setSettings(merged);
          setBannerSlots(parseWelcomeBannerSlides(merged.welcome_banner_images_json));
        } else {
          setSettings({ ...defaults });
          setBannerSlots([]);
        }
      } catch {
        setSettings({ ...defaults });
        setBannerSlots([]);
      }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    const jsonErr = validateWelcomeJsonForSave(settings);
    if (jsonErr) {
      if (Platform.OS === "web") {
        setSaveMsg("❌ " + jsonErr);
        setTimeout(() => setSaveMsg(""), 8000);
      } else {
        Alert.alert("Invalid JSON", jsonErr);
      }
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...settings,
        welcome_banner_images_json: serializeWelcomeBannerSlides(bannerSlots),
      };
      await apiRequest("PUT", "/api/admin/site-settings", { settings: payload });
      await qc.invalidateQueries({ queryKey: ["/api/site-settings"] });
      if (Platform.OS === "web") {
        setSaveMsg("✅ Settings saved successfully!");
        setTimeout(() => setSaveMsg(""), 3000);
      } else {
        Alert.alert("Saved", "Welcome page settings updated.");
      }
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      console.error("Save settings error:", msg);
      if (Platform.OS === "web") {
        setSaveMsg("❌ " + msg);
        setTimeout(() => setSaveMsg(""), 5000);
      } else {
        Alert.alert("Error", msg);
      }
    }
    setSaving(false);
  };

  const val = (key: string) => settings[key] ?? defaults[key] ?? "";
  const set = (key: string, v: string) => setSettings(prev => ({ ...prev, [key]: v }));
  const toggle = (key: string) => set(key, val(key) === "true" ? "false" : "true");

  const cancelWelcomeUpload = () => {
    welcomeAbortRef.current?.abort();
    welcomeAbortRef.current = null;
    setWelcomeUploadProgress(null);
  };

  const cancelBannerUpload = () => {
    bannerAbortRef.current?.abort();
    bannerAbortRef.current = null;
    setBannerUpload(null);
  };

  const runWelcomeUpload = async (settingKey: string, fileUri: string, fileName: string, mimeType: string, contentLength?: number) => {
    const controller = new AbortController();
    welcomeAbortRef.current = controller;
    setWelcomeUploadProgress({ key: settingKey, pct: 0 });
    try {
      const { publicUrl } = await uploadToR2(fileUri, fileName, mimeType, "images", {
        onProgress: (pct) => setWelcomeUploadProgress({ key: settingKey, pct }),
        signal: controller.signal,
        contentLength,
      });
      set(settingKey, publicUrl);
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        Alert.alert("Upload Failed", err?.message || "Could not upload image.");
      }
    } finally {
      if (welcomeAbortRef.current === controller) welcomeAbortRef.current = null;
      setWelcomeUploadProgress(null);
    }
  };

  const runBannerUpload = async (
    slotIndex: number,
    variant: "mobile" | "desktop",
    fileUri: string,
    fileName: string,
    mimeType: string,
    contentLength?: number,
  ) => {
    const controller = new AbortController();
    bannerAbortRef.current = controller;
    setBannerUpload({ slot: slotIndex, variant, pct: 0 });
    try {
      const { publicUrl } = await uploadToR2(fileUri, fileName, mimeType, "images", {
        onProgress: (pct) => setBannerUpload({ slot: slotIndex, variant, pct }),
        signal: controller.signal,
        contentLength,
      });
      setBannerSlots((prev) => {
        const next = [...prev];
        while (next.length <= slotIndex) next.push({ mobile: "", desktop: "" });
        next[slotIndex] = { ...next[slotIndex], [variant]: publicUrl };
        return next;
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        Alert.alert("Upload Failed", err?.message || "Could not upload image.");
      }
    } finally {
      if (bannerAbortRef.current === controller) bannerAbortRef.current = null;
      setBannerUpload(null);
    }
  };

  const pickImageFor = async (settingKey: string) => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const blobUrl = URL.createObjectURL(file);
        try {
          await runWelcomeUpload(settingKey, blobUrl, file.name, file.type || "image/jpeg", file.size);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      };
      input.click();
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to pick an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await runWelcomeUpload(
          settingKey,
          asset.uri,
          asset.fileName || `welcome-${Date.now()}.jpg`,
          asset.mimeType || "image/jpeg",
          asset.fileSize,
        );
      }
    } catch (err: any) {
      setWelcomeUploadProgress(null);
      Alert.alert("Upload Failed", err?.message || "Could not upload image.");
    }
  };

  const pickBannerForSlot = async (slotIndex: number, variant: "mobile" | "desktop") => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const blobUrl = URL.createObjectURL(file);
        try {
          await runBannerUpload(slotIndex, variant, blobUrl, file.name, file.type || "image/jpeg", file.size);
        } finally {
          URL.revokeObjectURL(blobUrl);
        }
      };
      input.click();
      return;
    }
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to pick an image.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
      });
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        await runBannerUpload(
          slotIndex,
          variant,
          asset.uri,
          asset.fileName || `welcome-banner-${variant}-${Date.now()}.jpg`,
          asset.mimeType || "image/jpeg",
          asset.fileSize,
        );
      }
    } catch (err: any) {
      setBannerUpload(null);
      Alert.alert("Upload Failed", err?.message || "Could not upload image.");
    }
  };

  const updateBannerSlotField = (index: number, variant: "mobile" | "desktop", url: string) => {
    setBannerSlots((prev) => {
      const next = [...prev];
      while (next.length <= index) next.push({ mobile: "", desktop: "" });
      next[index] = { ...next[index], [variant]: url };
      return next;
    });
  };

  const removeBannerSlot = (index: number) => {
    setBannerSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const addBannerSlot = () => {
    setBannerSlots((prev) => {
      const filled = prev.filter((s) => !isWelcomeBannerSlideEmpty(s)).length;
      if (filled >= MAX_WELCOME_BANNERS) {
        Alert.alert("Limit reached", `Maximum ${MAX_WELCOME_BANNERS} banner images allowed.`);
        return prev;
      }
      return [...prev, { mobile: "", desktop: "" }];
    });
  };

  const bannerSlotRows = bannerSlots.length > 0 ? bannerSlots : [];

  if (!loaded) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  const labelStyle = { fontSize: 13, fontFamily: "Inter_600SemiBold" as const, color: colors.text, marginBottom: 4 };
  const inputStyle = {
    backgroundColor: colors.input, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" as const, color: colors.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  };
  const toggleRow = (label: string, key: string) => (
    <Pressable onPress={() => toggle(key)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: colors.text }}>{label}</Text>
      <View style={{ width: 44, height: 26, borderRadius: 13, backgroundColor: val(key) === "true" ? "#22C55E" : "#D1D5DB", justifyContent: "center", paddingHorizontal: 2 }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", alignSelf: val(key) === "true" ? "flex-end" : "flex-start" }} />
      </View>
    </Pressable>
  );

  const imageUrlRow = (label: string, key: string, sizeHint?: string) => {
    const uploadingHere = welcomeUploadProgress?.key === key;
    const pct = uploadingHere ? Math.max(0, Math.min(100, welcomeUploadProgress!.pct)) : 0;
    const busyWelcomeUpload = welcomeUploadProgress != null;
    return (
      <View style={{ gap: 6 }}>
        <Text style={labelStyle}>{label}</Text>
        {sizeHint ? (
          <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>{sizeHint}</Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TextInput style={[inputStyle, { flex: 1 }]} value={val(key)} onChangeText={v => set(key, v)} placeholder="https://..." autoCapitalize="none" editable={!uploadingHere} />
          <Pressable
            onPress={() => pickImageFor(key)}
            disabled={busyWelcomeUpload}
            style={{
              backgroundColor: busyWelcomeUpload && !uploadingHere ? Colors.light.border : Colors.light.secondary,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              opacity: busyWelcomeUpload && !uploadingHere ? 0.6 : 1,
            }}
          >
            <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploadingHere ? "…" : "Upload"}</Text>
          </Pressable>
        </View>
        {uploadingHere ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" }}>
            <ActivityIndicator size="small" color={Colors.light.primary} />
            <Text style={{ flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>Uploading… {pct}%</Text>
            <Pressable onPress={cancelWelcomeUpload} hitSlop={8}>
              <Ionicons name="close-circle" size={22} color="#EF4444" />
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16, padding: 4 }}>
      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>Website homepage — header and hero</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          These fields affect the new web welcome page: logo, brand name, support contact, and hero headline.
        </Text>
        {imageUrlRow("Logo image (optional — overrides default asset)", "welcome_logo_url", WELCOME_LOGO_DISPLAY_ADMIN_HINT)}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Brand name next to logo</Text>
          <TextInput style={inputStyle} value={val("welcome_brand_text")} onChangeText={v => set("welcome_brand_text", v)} placeholder="3i Learning" />
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginTop: 6 }}>Website header — support contact</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          Phone and email show in the top web header near the navigation/dashboard button. On phone web they appear inside the menu. Leave both blank to hide them.
        </Text>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Admin phone (display + tap to call)</Text>
          <TextInput
            style={inputStyle}
            value={val("welcome_web_contact_phone")}
            onChangeText={v => set("welcome_web_contact_phone", v)}
            placeholder="9997198068"
            keyboardType={Platform.OS === "web" ? undefined : "phone-pad"}
            autoCapitalize="none"
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Admin email (display + tap to mail)</Text>
          <TextInput
            style={inputStyle}
            value={val("welcome_web_contact_email")}
            onChangeText={v => set("welcome_web_contact_email", v)}
            placeholder="support@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Tagline (single line on web)</Text>
          <TextInput style={inputStyle} value={val("welcome_tagline")} onChangeText={v => set("welcome_tagline", v)} placeholder="Master Mathematics Under Pankaj Sir Guidance" />
        </View>
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>Homepage banner carousel</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          Promotional banners appear on the welcome page directly under the header. Upload mobile ({WELCOME_BANNER_MOBILE_RECOMMENDED}, 3:1) and desktop ({WELCOME_BANNER_DESKTOP_RECOMMENDED}, wide strip) images per slide. Leave both empty to hide that slide.
        </Text>
        {bannerSlotRows.map((slot, index) => {
          const uploadingMobile = bannerUpload?.slot === index && bannerUpload.variant === "mobile";
          const uploadingDesktop = bannerUpload?.slot === index && bannerUpload.variant === "desktop";
          const busyBannerUpload = bannerUpload != null;

          const renderVariant = (variant: "mobile" | "desktop") => {
            const url = variant === "mobile" ? slot.mobile : slot.desktop;
            const uploadingHere = variant === "mobile" ? uploadingMobile : uploadingDesktop;
            const pct = uploadingHere ? Math.max(0, Math.min(100, bannerUpload!.pct)) : 0;
            return (
              <View key={`${index}-${variant}`} style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <WelcomeBannerPreview
                  uri={url}
                  variant={variant}
                  onClear={() => updateBannerSlotField(index, variant, "")}
                  showHint={false}
                />
                {uploadingHere ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 8, borderRadius: 8, backgroundColor: "#EEF2FF", borderWidth: 1, borderColor: "#C7D2FE" }}>
                    <ActivityIndicator size="small" color={Colors.light.primary} />
                    <Text style={{ flex: 1, fontSize: 11, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{pct}%</Text>
                    <Pressable onPress={cancelBannerUpload} hitSlop={8}>
                      <Ionicons name="close-circle" size={20} color="#EF4444" />
                    </Pressable>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <TextInput
                    style={[inputStyle, { flex: 1, fontSize: 12, paddingVertical: 8 }]}
                    value={url}
                    onChangeText={(v) => updateBannerSlotField(index, variant, v)}
                    placeholder="https://..."
                    autoCapitalize="none"
                    editable={!uploadingHere}
                  />
                  <Pressable
                    onPress={() => pickBannerForSlot(index, variant)}
                    disabled={busyBannerUpload}
                    style={{
                      backgroundColor: busyBannerUpload && !uploadingHere ? Colors.light.border : Colors.light.secondary,
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 8,
                      opacity: busyBannerUpload && !uploadingHere ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.primary }}>{uploadingHere ? "…" : "Up"}</Text>
                  </Pressable>
                </View>
              </View>
            );
          };

          return (
            <View key={`banner-slot-${index}`} style={{ gap: 8, paddingBottom: 12, borderBottomWidth: index < bannerSlotRows.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={labelStyle}>Banner {index + 1}</Text>
                <Pressable
                  onPress={() => removeBannerSlot(index)}
                  disabled={busyBannerUpload}
                  style={{ padding: 4, opacity: busyBannerUpload ? 0.5 : 1 }}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
                {renderVariant("mobile")}
                {renderVariant("desktop")}
              </View>
            </View>
          );
        })}
        <Pressable
          onPress={addBannerSlot}
          disabled={bannerUpload != null || bannerSlots.filter((s) => !isWelcomeBannerSlideEmpty(s)).length >= MAX_WELCOME_BANNERS}
          style={{
            borderWidth: 1.5,
            borderColor: Colors.light.primary,
            borderStyle: "dashed",
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
            backgroundColor: "#EEF2FF",
            opacity: bannerUpload != null ? 0.6 : 1,
          }}
        >
          <Ionicons name="add-circle-outline" size={18} color={Colors.light.primary} />
          <Text style={{ fontSize: 13, fontFamily: "Inter_700Bold", color: Colors.light.primary }}>Add banner image</Text>
        </Pressable>
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 4, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text, marginBottom: 6 }}>Website homepage — App download section</Text>
        {toggleRow("Get the App (browser web only — not shown in Android/iOS app)", "welcome_show_get_app")}
        {toggleRow("Google Play card", "welcome_show_google_play")}
        {toggleRow("iOS / App Store card", "welcome_show_ios")}
        {toggleRow("Web app card", "welcome_show_web_app")}
        {toggleRow("Install / PWA card", "welcome_show_web_download")}
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>Website homepage — Store links and copy</Text>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Google Play URL</Text>
          <TextInput style={inputStyle} value={val("welcome_google_play_url")} onChangeText={v => set("welcome_google_play_url", v)} autoCapitalize="none" />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>App Store URL</Text>
          <TextInput style={inputStyle} value={val("welcome_app_store_url")} onChangeText={v => set("welcome_app_store_url", v)} autoCapitalize="none" />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Section title / subtitle</Text>
          <TextInput style={inputStyle} value={val("welcome_get_app_title")} onChangeText={v => set("welcome_get_app_title", v)} />
          <TextInput style={[inputStyle, { marginTop: 8 }]} value={val("welcome_get_app_subtitle")} onChangeText={v => set("welcome_get_app_subtitle", v)} />
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginTop: 8 }}>Card titles and descriptions</Text>
        <View style={{ gap: 8 }}>
          <TextInput style={inputStyle} value={val("welcome_card_play_title")} onChangeText={v => set("welcome_card_play_title", v)} placeholder="Android title" />
          <TextInput style={inputStyle} value={val("welcome_card_play_desc")} onChangeText={v => set("welcome_card_play_desc", v)} placeholder="Android desc" />
          <TextInput style={inputStyle} value={val("welcome_card_ios_title")} onChangeText={v => set("welcome_card_ios_title", v)} placeholder="iOS title" />
          <TextInput style={inputStyle} value={val("welcome_card_ios_desc")} onChangeText={v => set("welcome_card_ios_desc", v)} placeholder="iOS desc" />
          <TextInput style={inputStyle} value={val("welcome_card_web_title")} onChangeText={v => set("welcome_card_web_title", v)} placeholder="Web title" />
          <TextInput style={inputStyle} value={val("welcome_card_web_desc")} onChangeText={v => set("welcome_card_web_desc", v)} placeholder="Web desc" />
          <TextInput style={inputStyle} value={val("welcome_card_pwa_title")} onChangeText={v => set("welcome_card_pwa_title", v)} placeholder="Install title" />
          <TextInput style={inputStyle} value={val("welcome_card_pwa_desc")} onChangeText={v => set("welcome_card_pwa_desc", v)} placeholder="Install desc" />
        </View>
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>Website homepage — Footer</Text>
        <TextInput style={inputStyle} value={val("welcome_footer")} onChangeText={v => set("welcome_footer", v)} />
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: colors.text }}>Legal — Privacy Policy</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          This appears from the Privacy Policy button at the bottom of the student/admin profile screen. If you add a URL, the app opens that page; otherwise it shows the text below inside the app.
        </Text>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Button / page title</Text>
          <TextInput style={inputStyle} value={val("privacy_policy_title")} onChangeText={v => set("privacy_policy_title", v)} placeholder="Privacy Policy" />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Privacy policy URL (optional)</Text>
          <TextInput
            style={inputStyle}
            value={val("privacy_policy_url")}
            onChangeText={v => set("privacy_policy_url", v)}
            placeholder="https://3ilearning.in/privacy-policy"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Privacy policy text</Text>
          <TextInput
            style={[inputStyle, { minHeight: 180, textAlignVertical: "top" }]}
            value={val("privacy_policy_content")}
            onChangeText={v => set("privacy_policy_content", v)}
            placeholder="Write your privacy policy here..."
            multiline
            numberOfLines={8}
          />
        </View>
      </View>

      <Pressable onPress={handleSave} disabled={saving} style={{ backgroundColor: Colors.light.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: saving ? 0.6 : 1 }}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" }}>Save Changes</Text>}
      </Pressable>
      {!!saveMsg && (
        <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: saveMsg.startsWith("✅") ? "#22C55E" : "#EF4444", textAlign: "center", marginTop: 4 }}>{saveMsg}</Text>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  formInput: { backgroundColor: Colors.light.background, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", color: Colors.light.text, borderWidth: 1, borderColor: Colors.light.border },
});
