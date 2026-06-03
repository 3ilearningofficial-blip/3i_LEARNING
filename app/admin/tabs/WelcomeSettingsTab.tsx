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
  WELCOME_PANKAJ_PHOTO_ADMIN_HINT,
  WELCOME_SECTION_IMAGE_ADMIN_HINT,
} from "@/lib/welcome-image-sizes";
import Colors from "@/constants/colors";

function validateWelcomeJsonForSave(settings: Record<string, string>): string | null {
  const pairs: [string, string][] = [
    ["welcome_my_course_json", "Course cards"],
    ["welcome_extra_sections_json", "Extra sections"],
    ["welcome_features_json", "Features override"],
  ];
  for (const [key, label] of pairs) {
    const raw = settings[key];
    if (raw == null || !String(raw).trim()) continue;
    try {
      const parsed = JSON.parse(String(raw));
      if (!Array.isArray(parsed)) {
        return `${label}: must be a JSON array — start with [ and end with ].`;
      }
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      return `${label}: invalid JSON (${msg}). Do not paste line breaks inside "desc"; use \\n instead. Ensure the box starts with [{ and ends with }].`;
    }
  }
  return null;
}

export function WelcomeSettingsTab() {
  const qc = useQueryClient();
  const [settings, setSettings] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState("");
  const [welcomeUploadProgress, setWelcomeUploadProgress] = React.useState<{ key: string; pct: number } | null>(null);

  const defaults: Record<string, string> = {
    welcome_headline: "Master Mathematics\nUnder Pankaj Sir Guidance",
    welcome_tagline: "Master Mathematics Under Pankaj Sir Guidance",
    welcome_brand_text: "3i Learning",
    welcome_logo_url: "",
    welcome_nav_line: "Courses · Live Classes · OMR Tests · Daily Missions · AI Tutor",
    welcome_show_nav: "true",
    welcome_show_subheadline: "false",
    welcome_subheadline: "Courses, live classes, OMR tests, daily missions and AI tutoring — everything to ace your exams.",
    welcome_login_btn: "Login — It's Free",
    welcome_signup_btn: "Sign Up",
    welcome_show_pankaj_sir: "true",
    welcome_pankaj_title: "About Pankaj Sir",
    welcome_pankaj_body:
      "Pankaj Sir leads mathematics sessions with a focus on fundamentals, exam patterns, and consistent practice — mentoring students for NDA, CDS, AFCAT, and related entrances.",
    welcome_pankaj_photo_url: "",
    welcome_show_about: "true",
    welcome_about_title: "About",
    welcome_about_body:
      "3i Learning offers expert-led mathematics coaching for defence entrance exams — with structured video courses, live classes, OMR-style tests, daily missions, and AI tutoring.",
    welcome_about_image_url: "",
    welcome_show_vision: "true",
    welcome_vision_title: "Our Vision",
    welcome_vision_body:
      "We want every learner to study with clarity and confidence — fair access, disciplined practice, and teaching that respects your time.",
    welcome_vision_image_url: "",
    welcome_show_my_course: "true",
    welcome_my_course_title: "My Courses",
    welcome_my_course_intro: "",
    welcome_my_course_json:
      '[{"title":"CDS / AFCAT / NDA","desc":"Complete preparation with structured syllabus, live support, and full-length mocks."},{"title":"Test Series","desc":"OMR-style tests with analytics, negative marking, and performance tracking."}]',
    welcome_my_course_image_url: "",
    welcome_extra_sections_json: "[]",
    welcome_features_json: "",
    welcome_show_features: "true",
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
  };

  React.useEffect(() => {
    (async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/site-settings", baseUrl).toString());
        if (res.ok) {
          const data = await res.json();
          setSettings({ ...defaults, ...data });
        } else {
          setSettings({ ...defaults });
        }
      } catch {
        setSettings({ ...defaults });
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
      const res = await apiRequest("PUT", "/api/admin/site-settings", { settings });
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

  const pickImageFor = async (settingKey: string) => {
    if (Platform.OS === "web") {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async (e: any) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setWelcomeUploadProgress({ key: settingKey, pct: 0 });
        const blobUrl = URL.createObjectURL(file);
        try {
          const { publicUrl } = await uploadToR2(
            blobUrl,
            file.name,
            file.type || "image/jpeg",
            "images",
            (pct) => setWelcomeUploadProgress({ key: settingKey, pct })
          );
          set(settingKey, publicUrl);
        } catch (err: any) {
          Alert.alert("Upload Failed", err?.message || "Could not upload image.");
        } finally {
          URL.revokeObjectURL(blobUrl);
          setWelcomeUploadProgress(null);
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
        setWelcomeUploadProgress({ key: settingKey, pct: 0 });
        try {
          const { publicUrl } = await uploadToR2(
            asset.uri,
            asset.fileName || `welcome-${Date.now()}.jpg`,
            asset.mimeType || "image/jpeg",
            "images",
            (pct) => setWelcomeUploadProgress({ key: settingKey, pct })
          );
          set(settingKey, publicUrl);
        } catch (uploadErr: any) {
          Alert.alert("Upload Failed", uploadErr?.message || "Could not upload image.");
        } finally {
          setWelcomeUploadProgress(null);
        }
      }
    } catch (err: any) {
      setWelcomeUploadProgress(null);
      Alert.alert("Upload Failed", err?.message || "Could not upload image.");
    }
  };

  if (!loaded) return <ActivityIndicator color={Colors.light.primary} style={{ marginTop: 40 }} />;

  const labelStyle = { fontSize: 13, fontFamily: "Inter_600SemiBold" as const, color: Colors.light.text, marginBottom: 4 };
  const inputStyle = {
    backgroundColor: Colors.light.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.light.border,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular" as const, color: Colors.light.text,
    ...(Platform.OS === "web" ? { outlineStyle: "none" as any } : {}),
  };
  const toggleRow = (label: string, key: string) => (
    <Pressable onPress={() => toggle(key)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#F3F4F6" }}>
      <Text style={{ fontSize: 14, fontFamily: "Inter_500Medium", color: Colors.light.text }}>{label}</Text>
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
          <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: Colors.light.textSecondary }}>Uploading… {pct}%</Text>
            <View style={{ height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: "#E5E7EB", width: "100%" }}>
              <View style={{ height: "100%", width: `${pct}%`, backgroundColor: Colors.light.primary, borderRadius: 4 }} />
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={{ gap: 16, padding: 4 }}>
      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Brand and hero (web layout)</Text>
        {imageUrlRow("Logo image (optional — overrides default asset)", "welcome_logo_url", WELCOME_LOGO_DISPLAY_ADMIN_HINT)}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Brand name next to logo</Text>
          <TextInput style={inputStyle} value={val("welcome_brand_text")} onChangeText={v => set("welcome_brand_text", v)} placeholder="3i Learning" />
        </View>
        <Text style={{ fontSize: 13, fontFamily: "Inter_600SemiBold", color: Colors.light.text, marginTop: 6 }}>Web header — support contact</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          Phone and email with icons next to the brand (laptop web) or above it (narrow web). Not shown in native Android/iOS apps. Leave both blank to hide the row.
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
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Navigation line</Text>
          <TextInput style={inputStyle} value={val("welcome_nav_line")} onChangeText={v => set("welcome_nav_line", v)} placeholder="Courses · Live Classes · …" />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Headline (legacy / mobile)</Text>
          <TextInput style={[inputStyle, { minHeight: 50, textAlignVertical: "top" }]} multiline value={val("welcome_headline")} onChangeText={v => set("welcome_headline", v)} placeholder="Multi-line headline" />
        </View>
        {toggleRow("Show navigation line", "welcome_show_nav")}
        {toggleRow("Show subheadline under hero", "welcome_show_subheadline")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Subheadline</Text>
          <TextInput style={[inputStyle, { minHeight: 44, textAlignVertical: "top" }]} multiline value={val("welcome_subheadline")} onChangeText={v => set("welcome_subheadline", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Login button</Text>
          <TextInput style={inputStyle} value={val("welcome_login_btn")} onChangeText={v => set("welcome_login_btn", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Sign up button</Text>
          <TextInput style={inputStyle} value={val("welcome_signup_btn")} onChangeText={v => set("welcome_signup_btn", v)} />
        </View>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>About Pankaj Sir (after Login / Sign up — and subheadline if shown)</Text>
        {toggleRow("Show About Pankaj Sir block", "welcome_show_pankaj_sir")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Section title</Text>
          <TextInput style={inputStyle} value={val("welcome_pankaj_title")} onChangeText={v => set("welcome_pankaj_title", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Body</Text>
          <TextInput
            style={[inputStyle, { minHeight: 100, textAlignVertical: "top" }]}
            multiline
            value={val("welcome_pankaj_body")}
            onChangeText={v => set("welcome_pankaj_body", v)}
          />
        </View>
        {imageUrlRow("Pankaj Sir photo (shown in circular frame on welcome)", "welcome_pankaj_photo_url", WELCOME_PANKAJ_PHOTO_ADMIN_HINT)}
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          Until you add a photo, the welcome page shows a placeholder circle.
        </Text>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>About section</Text>
        {toggleRow("Show About block", "welcome_show_about")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Title</Text>
          <TextInput style={inputStyle} value={val("welcome_about_title")} onChangeText={v => set("welcome_about_title", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Body</Text>
          <TextInput style={[inputStyle, { minHeight: 100, textAlignVertical: "top" }]} multiline value={val("welcome_about_body")} onChangeText={v => set("welcome_about_body", v)} />
        </View>
        {imageUrlRow("About image (optional)", "welcome_about_image_url", WELCOME_SECTION_IMAGE_ADMIN_HINT)}
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          On narrow screens under 640px wide, About text shows about six lines with an ellipsis — keep a shorter intro here or paste the full story for laptop visitors.
        </Text>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Our Vision (after About)</Text>
        {toggleRow("Show Our Vision block", "welcome_show_vision")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Title</Text>
          <TextInput style={inputStyle} value={val("welcome_vision_title")} onChangeText={v => set("welcome_vision_title", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Body</Text>
          <TextInput style={[inputStyle, { minHeight: 100, textAlignVertical: "top" }]} multiline value={val("welcome_vision_body")} onChangeText={v => set("welcome_vision_body", v)} />
        </View>
        {imageUrlRow("Our Vision image (optional)", "welcome_vision_image_url", WELCOME_SECTION_IMAGE_ADMIN_HINT)}
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 }}>
          Same ellipsis rule as About on narrow screens (under 640px).
        </Text>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>My courses block</Text>
        {toggleRow("Show My courses", "welcome_show_my_course")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Section title</Text>
          <TextInput style={inputStyle} value={val("welcome_my_course_title")} onChangeText={v => set("welcome_my_course_title", v)} />
        </View>
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Intro (optional)</Text>
          <TextInput style={[inputStyle, { minHeight: 44, textAlignVertical: "top" }]} multiline value={val("welcome_my_course_intro")} onChangeText={v => set("welcome_my_course_intro", v)} />
        </View>
        {imageUrlRow("My courses image (optional)", "welcome_my_course_image_url", WELCOME_SECTION_IMAGE_ADMIN_HINT)}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Course cards (JSON array of title + desc)</Text>
          <TextInput
            style={[inputStyle, { minHeight: 120, fontFamily: Platform.OS === "web" ? "monospace" : undefined, textAlignVertical: "top" }]}
            multiline
            value={val("welcome_my_course_json")}
            onChangeText={v => set("welcome_my_course_json", v)}
            placeholder='[{"title":"...","desc":"..."}]'
            autoCapitalize="none"
          />
          <Text style={{ fontSize: 12, color: "#B45309", fontFamily: "Inter_400Regular", lineHeight: 17 }}>
            Must be valid JSON. If descriptions do not appear on the site, the usual cause is illegal line breaks inside a string — press Enter creates an error; use literal \n in the desc text instead.
            The first character must be [ and each title/desc pair must stay inside "...". Save is blocked until JSON parses.
          </Text>
        </View>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Extra sections (optional)</Text>
        <Text style={{ fontSize: 12, color: Colors.light.textMuted, fontFamily: "Inter_400Regular" }}>
          JSON array: {"[{ \"title\": \"...\", \"body\": \"...\", \"imageUrl\": \"...\" }, ...]"}
        </Text>
        <TextInput
          style={[inputStyle, { minHeight: 120, fontFamily: Platform.OS === "web" ? "monospace" : undefined, textAlignVertical: "top" }]}
          multiline
          value={val("welcome_extra_sections_json")}
          onChangeText={v => set("welcome_extra_sections_json", v)}
          autoCapitalize="none"
        />
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Feature grid</Text>
        {toggleRow("Show features grid", "welcome_show_features")}
        <View style={{ gap: 4 }}>
          <Text style={labelStyle}>Override features (JSON, or leave empty for defaults)</Text>
          <TextInput
            style={[inputStyle, { minHeight: 140, fontFamily: Platform.OS === "web" ? "monospace" : undefined, textAlignVertical: "top" }]}
            multiline
            value={val("welcome_features_json")}
            onChangeText={v => set("welcome_features_json", v)}
            placeholder='[{"icon":"videocam","color":"#1A56DB","title":"...","desc":"..."}]'
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 4, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text, marginBottom: 6 }}>Show / hide — Get the app</Text>
        {toggleRow("Get the App (browser web only — not shown in Android/iOS app)", "welcome_show_get_app")}
        {toggleRow("Google Play card", "welcome_show_google_play")}
        {toggleRow("iOS / App Store card", "welcome_show_ios")}
        {toggleRow("Web app card", "welcome_show_web_app")}
        {toggleRow("Install / PWA card", "welcome_show_web_download")}
      </View>

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Store links and copy</Text>
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

      <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 18, gap: 14, borderWidth: 1, borderColor: "#E5E7EB" }}>
        <Text style={{ fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text }}>Footer</Text>
        <TextInput style={inputStyle} value={val("welcome_footer")} onChangeText={v => set("welcome_footer", v)} />
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
