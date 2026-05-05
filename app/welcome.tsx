import React from "react";
import {
  View, Text, StyleSheet, Pressable, Image, Platform,
  ScrollView, useWindowDimensions, Linking,
  type StyleProp,
  type ImageStyle,
} from "react-native";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl, authFetch } from "@/lib/query-client";
import Colors from "@/constants/colors";

const DEFAULT_FEATURES = [
  { icon: "videocam", color: "#1A56DB", title: "Video Courses", desc: "Structured courses for NDA, CDS, AFCAT with live & recorded lectures" },
  { icon: "document-text", color: "#EF4444", title: "OMR-Style Tests", desc: "Full-length mock tests with negative marking and instant results" },
  { icon: "flame", color: "#F59E0B", title: "Daily Missions", desc: "Practice daily with XP rewards to build consistency" },
  { icon: "sparkles", color: "#8B5CF6", title: "AI Tutor", desc: "Get instant step-by-step solutions for any doubt" },
  { icon: "radio", color: "#DC2626", title: "Live Classes", desc: "Join live sessions with real-time interaction" },
];

const DEFAULT_MY_COURSE_ITEMS = [
  { title: "CDS / AFCAT / NDA", desc: "Complete preparation with structured syllabus, live support, and full-length mocks." },
  { title: "Test Series", desc: "OMR-style tests with analytics, negative marking, and performance tracking." },
];

/** Fit one screen on phones; admins can paste longer copy (narrow viewports ellipsis after ~6 lines). */
const DEFAULT_ABOUT_BODY =
  "Math coaching for NDA, CDS & AFCAT: video lessons, live classes, OMR mocks, missions, and AI help — structured to finish the syllabus without overwhelm.";

const DEFAULT_VISION_BODY =
  "We want every learner to study with clarity and confidence — fair access, disciplined practice, and teaching that respects your time.";

const DEFAULT_PANKAJ_BODY =
  "Pankaj Sir leads mathematics sessions with a focus on fundamentals, exam patterns, and consistent practice — mentoring students for NDA, CDS, AFCAT, and related entrances.";

const DEFAULT_WEB_CONTACT_PHONE = "9997198068";
const DEFAULT_WEB_CONTACT_EMAIL = "3ilearningofficial@gmail.com";

function buildWebContactTelHref(phoneRaw: string): string | null {
  const digits = phoneRaw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `tel:+91${digits}`;
  return `tel:+${digits}`;
}

function buildWebContactMailto(emailRaw: string): string | null {
  const e = emailRaw.trim();
  if (!e || !e.includes("@")) return null;
  return `mailto:${e}`;
}

/** Trim pasted URLs so remote images load on web/RN (http→https, protocol-relative). */
function normalizeWelcomeImageUrl(raw: string): string {
  let u = raw.trim().replace(/\s/g, "");
  if (!u) return "";
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("http://")) return `https://${u.slice(7)}`;
  return u;
}

/** Turn `/api/...` or `api/...` paths into absolute URLs so images load on phone/laptop web. */
function resolveWelcomeMediaUrl(raw: string, apiBase: string): string {
  const n = normalizeWelcomeImageUrl(raw);
  if (!n) return "";
  if (/^https?:\/\//i.test(n)) return n;
  let path = n.trim();
  if (!path.startsWith("/")) {
    if (path.toLowerCase().startsWith("api/")) path = `/${path}`;
    else return n;
  }
  try {
    const base = apiBase.replace(/\/+$/, "");
    return new URL(path.replace(/^\/+/, "/"), `${base}/`).toString();
  } catch {
    return n;
  }
}

function PankajSirPhoto({ uriRaw, extraStyle }: { uriRaw: string; extraStyle?: StyleProp<ImageStyle> }) {
  const normalized = React.useMemo(() => normalizeWelcomeImageUrl(uriRaw), [uriRaw]);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setFailed(false);
  }, [normalized]);

  if (!normalized || failed) {
    return (
      <View style={[styles.pankajPhotoPlaceholder, extraStyle]}>
        <Ionicons name="person" size={42} color={Colors.light.textMuted} />
      </View>
    );
  }

  /** RN-web `Image` often fails loading cross-origin URLs on mobile Safari; native `img` is reliable. */
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return (
      <View style={[styles.pankajPhoto, extraStyle, { overflow: "hidden", padding: 0 }]}>
        {React.createElement("img", {
          src: normalized,
          alt: "",
          referrerPolicy: "strict-origin-when-cross-origin",
          style: {
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "cover",
          },
          onError: () => setFailed(true),
          loading: "lazy",
          decoding: "async",
        })}
      </View>
    );
  }

  return (
    <Image
      source={{ uri: normalized }}
      style={[styles.pankajPhoto, extraStyle]}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

function WebAdminContactsAbove({ phoneDisplay, emailDisplay }: { phoneDisplay: string; emailDisplay: string }) {
  const telHref = buildWebContactTelHref(phoneDisplay);
  const mailHref = buildWebContactMailto(emailDisplay);
  if (!telHref && !mailHref) return null;

  const open =
    (url: string) => () =>
      Linking.openURL(url).catch(() => {});
  return (
    <View style={styles.adminContactRowAbove}>
      {telHref ? (
        <Pressable onPress={open(telHref)} style={styles.adminContactPress} accessibilityRole="link">
          <Ionicons name="call-outline" size={18} color={Colors.light.primary} />
          <Text style={styles.adminContactLabel}>{phoneDisplay.trim()}</Text>
        </Pressable>
      ) : null}
      {mailHref ? (
        <Pressable onPress={open(mailHref)} style={styles.adminContactPress} accessibilityRole="link">
          <Ionicons name="mail-outline" size={18} color={Colors.light.primary} />
          <Text style={styles.adminContactLabel} numberOfLines={1}>
            {emailDisplay.trim()}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function WebAdminContactsLaptopEnd({ phoneDisplay, emailDisplay }: { phoneDisplay: string; emailDisplay: string }) {
  const telHref = buildWebContactTelHref(phoneDisplay);
  const mailHref = buildWebContactMailto(emailDisplay);
  if (!telHref && !mailHref) return null;

  const open =
    (url: string) => () =>
      Linking.openURL(url).catch(() => {});
  return (
    <View style={styles.adminContactLaptopEnd}>
      {telHref ? (
        <Pressable onPress={open(telHref)} style={styles.adminContactPress} accessibilityRole="link">
          <Ionicons name="call-outline" size={18} color={Colors.light.primary} />
          <Text style={styles.adminContactLabel}>{phoneDisplay.trim()}</Text>
        </Pressable>
      ) : null}
      {mailHref ? (
        <Pressable onPress={open(mailHref)} style={styles.adminContactPress} accessibilityRole="link">
          <Ionicons name="mail-outline" size={18} color={Colors.light.primary} />
          <Text style={[styles.adminContactLabel, styles.adminContactEmailLaptop]} numberOfLines={1}>
            {emailDisplay.trim()}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type MyCourseItem = { title: string; desc: string };
type ExtraSection = { title?: string; body?: string; imageUrl?: string };
type FeatureItem = { icon: string; color: string; title: string; desc: string };

/** Title stays fixed; body (and images) scroll when compact so long CMS copy is readable on phone web / narrow layout. */
function SectionTitleAndScroll({
  title,
  compact,
  scrollMaxH,
  children,
}: {
  title: string;
  compact: boolean;
  scrollMaxH: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {compact ? (
        <ScrollView
          nestedScrollEnabled
          style={{ maxHeight: scrollMaxH }}
          contentContainerStyle={styles.sectionScrollInner}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.sectionChildrenFlat}>{children}</View>
      )}
    </View>
  );
}

function parseJsonArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw?.trim()) return fallback;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? (p as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function getFeatures(cfg: Record<string, string>): FeatureItem[] {
  const raw = cfg.welcome_features_json;
  if (!raw?.trim()) return DEFAULT_FEATURES;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_FEATURES;
    return arr.map((x: any, i: number) => ({
      icon: typeof x.icon === "string" ? x.icon : DEFAULT_FEATURES[i % DEFAULT_FEATURES.length].icon,
      color: typeof x.color === "string" ? x.color : DEFAULT_FEATURES[0].color,
      title: String(x.title ?? ""),
      desc: String(x.desc ?? x.description ?? ""),
    })).filter((x) => x.title);
  } catch {
    return DEFAULT_FEATURES;
  }
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isWide = width >= 640;
  const isWeb = Platform.OS === "web";
  const { user } = useAuth();

  const { data: cfg = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/site-settings"],
    queryFn: async () => {
      try {
        const url = new URL("/api/site-settings", getApiUrl());
        if (Platform.OS === "web") {
          url.searchParams.set("_cb", String(Date.now()));
        }
        const res = await authFetch(
          url.toString(),
          ({ cache: "no-store" } as RequestInit)
        );
        if (res.ok) return res.json();
      } catch { /* public */ }
      return {};
    },
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const s = (key: string, fallback: string) => (cfg[key] != null && cfg[key] !== "" ? cfg[key] : fallback);
  const on = (key: string) => s(key, "true") === "true";

  const tagline = s("welcome_tagline", s("welcome_headline", "Master Mathematics Under Pankaj Sir Guidance")).replace(/\n/g, " ");
  const navLine = s("welcome_nav_line", "Courses · Live Classes · OMR Tests · Daily Missions · AI Tutor");
  const brandText = s("welcome_brand_text", "3i Learning");
  const logoUrl = s("welcome_logo_url", "").trim();

  const aboutTitle = s("welcome_about_title", "About");
  const aboutBody = s("welcome_about_body", DEFAULT_ABOUT_BODY).trim();
  const aboutImage = s("welcome_about_image_url", "").trim();

  const visionTitle = s("welcome_vision_title", "Our Vision");
  const visionBody = s("welcome_vision_body", DEFAULT_VISION_BODY).trim();
  const visionImage = s("welcome_vision_image_url", "").trim();

  const pankajTitle = s("welcome_pankaj_title", "About Pankaj Sir");
  const pankajBody = s("welcome_pankaj_body", DEFAULT_PANKAJ_BODY).trim();
  const pankajPhotoUrl = s("welcome_pankaj_photo_url", "").trim();
  const apiOrigin = getApiUrl();
  const pankajPhotoResolved = React.useMemo(
    () => resolveWelcomeMediaUrl(pankajPhotoUrl, apiOrigin),
    [pankajPhotoUrl, apiOrigin]
  );

  const myCourseTitle = s("welcome_my_course_title", "My Courses");
  const myCourseIntro = s("welcome_my_course_intro", "");
  const myCourseImage = s("welcome_my_course_image_url", "").trim();
  const myCourseItems = parseJsonArray<MyCourseItem>(
    cfg.welcome_my_course_json,
    DEFAULT_MY_COURSE_ITEMS
  );

  const extraSections = parseJsonArray<ExtraSection>(cfg.welcome_extra_sections_json, []);
  const features = getFeatures(cfg);

  const handleLogin = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/email-login" as any);
  };

  const handleSignup = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/login" as any);
  };

  const googlePlayUrl = s("welcome_google_play_url", "https://play.google.com/store/apps/details?id=com.learning.threeI");
  const appStoreUrl = s("welcome_app_store_url", "https://apps.apple.com");

  const handleGooglePlay = () => {
    if (Platform.OS === "web") window.open(googlePlayUrl, "_blank");
    else Linking.openURL(googlePlayUrl).catch(() => {});
  };
  const handleAppStore = () => {
    if (Platform.OS === "web") window.open(appStoreUrl, "_blank");
    else Linking.openURL(appStoreUrl).catch(() => {});
  };

  const handleOpenWebApp = () => {
    if (user) router.replace("/(tabs)");
    else router.push("/(auth)/email-login" as any);
  };

  const showAbout =
    on("welcome_show_about") && (!!aboutTitle.trim() || !!aboutBody || !!aboutImage);
  const showVision =
    on("welcome_show_vision") && (!!visionTitle.trim() || !!visionBody || !!visionImage);
  const showPankaj =
    on("welcome_show_pankaj_sir") && (!!pankajTitle.trim() || !!pankajBody || !!pankajPhotoUrl);
  const showMyCourse = on("welcome_show_my_course");
  const showSub = on("welcome_show_subheadline");

  const webContactPhone = s("welcome_web_contact_phone", DEFAULT_WEB_CONTACT_PHONE);
  const webContactEmail = s("welcome_web_contact_email", DEFAULT_WEB_CONTACT_EMAIL);
  const webContactShows =
    (webContactPhone.trim().length > 0 && !!buildWebContactTelHref(webContactPhone)) ||
    (webContactEmail.trim().length > 0 && !!buildWebContactMailto(webContactEmail));

  const webHero = isWeb && isWide;
  const isPhoneWeb = isWeb && !isWide;
  /** Laptop web: contacts on same row as hero; narrow web: row above brand. Web only — never native apps. */
  const showAdminContactAbove = isWeb && webContactShows && width < 768;
  const showAdminContactLaptopEnd = isWeb && webContactShows && width >= 768;
  /** Narrow width: inner scroll areas for long CMS text (phone web + small native). */
  const useSectionInnerScroll = width < 640;
  const sectionScrollMaxH = Math.min(340, Math.round(Math.max(220, height * 0.42)));
  const isNativeApp = Platform.OS === "android" || Platform.OS === "ios";

  const logoImageEl = logoUrl ? (
    <Image source={{ uri: logoUrl }} style={styles.logoImg} resizeMode="cover" />
  ) : (
    <Image source={require("@/assets/images/logo.png")} style={styles.logoImg} resizeMode="cover" />
  );

  return (
    <View style={[styles.container, isWeb && styles.containerWeb]}>
      <ScrollView
        style={isWeb ? styles.scrollViewWeb : undefined}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card: logo (profile circle), brand, headline, navigation */}
        <View style={[styles.headerCard, isPhoneWeb && styles.headerCardPhoneWeb]}>
          {webHero ? (
            <>
              {showAdminContactAbove ? (
                <WebAdminContactsAbove phoneDisplay={webContactPhone} emailDisplay={webContactEmail} />
              ) : null}
              <View style={styles.headerRowWeb}>
                <View style={styles.headerLeadingWeb}>
                  <View style={styles.logoRing}>
                    <View style={styles.logoInnerCircle}>{logoImageEl}</View>
                  </View>
                  <View style={styles.headerTextColWeb}>
                    <Text style={styles.brandInHeader}>{brandText}</Text>
                    <Text style={styles.taglineWeb} numberOfLines={3}>{tagline}</Text>
                  </View>
                </View>
                {showAdminContactLaptopEnd ? (
                  <WebAdminContactsLaptopEnd phoneDisplay={webContactPhone} emailDisplay={webContactEmail} />
                ) : null}
              </View>
              {!!navLine.trim() && on("welcome_show_nav") && (
                <Text style={[styles.navLine, styles.navLineWebHeader]} accessibilityRole="text">{navLine}</Text>
              )}
            </>
          ) : (
            <>
              {showAdminContactAbove ? (
                <WebAdminContactsAbove phoneDisplay={webContactPhone} emailDisplay={webContactEmail} />
              ) : null}
              <View style={styles.headerBrandRowMobile}>
                <View style={[styles.logoRing, isPhoneWeb && styles.logoRingPhoneWeb]}>
                  <View style={[styles.logoInnerCircle, isPhoneWeb && styles.logoInnerCirclePhoneWeb]}>{logoImageEl}</View>
                </View>
                <Text style={[styles.brandInHeaderMobile, isPhoneWeb && styles.brandInHeaderPhoneWeb]} numberOfLines={2}>
                  {brandText}
                </Text>
              </View>
              <Text style={[styles.headlineMobile, styles.headlineInCard]}>{tagline}</Text>
              {!!navLine.trim() && on("welcome_show_nav") && (
                <Text style={[styles.navLine, styles.navLineInCard]} accessibilityRole="text">{navLine}</Text>
              )}
            </>
          )}
        </View>

        {/* CTAs */}
        <View style={[styles.ctaRow, webHero && styles.ctaRowWeb]}>
          <Pressable
            style={({ pressed }) => [
              styles.loginBtn,
              isPhoneWeb && styles.loginBtnPhoneWeb,
              pressed && { opacity: 0.92 },
            ]}
            onPress={handleLogin}
          >
            <LinearGradient
              colors={["#FF6B35", "#EF4444"]}
              style={[styles.loginGradient, isPhoneWeb && styles.loginGradientPhoneWeb]}
            >
              <Ionicons name="log-in-outline" size={isPhoneWeb ? 20 : 18} color="#fff" />
              <Text style={[styles.loginText, isPhoneWeb && styles.loginTextPhoneWeb]}>{s("welcome_login_btn", "Login — It's Free")}</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.signupBtn,
              isPhoneWeb && styles.signupBtnPhoneWeb,
              pressed && { opacity: 0.92 },
            ]}
            onPress={handleSignup}
          >
            <Ionicons name="person-add-outline" size={isPhoneWeb ? 20 : 18} color={Colors.light.primary} />
            <Text style={[styles.signupText, isPhoneWeb && styles.signupTextPhoneWeb]}>{s("welcome_signup_btn", "Sign Up")}</Text>
          </Pressable>
        </View>

        {showSub ? (
          <Text style={styles.subheadline}>{s("welcome_subheadline", "Courses, live classes, OMR tests, daily missions and AI tutoring — everything to ace your exams.")}</Text>
        ) : null}

        {showPankaj && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{pankajTitle}</Text>
            {useSectionInnerScroll ? (
              <ScrollView
                nestedScrollEnabled
                style={{ maxHeight: sectionScrollMaxH }}
                contentContainerStyle={styles.sectionScrollInner}
                showsVerticalScrollIndicator
                keyboardShouldPersistTaps="handled"
              >
                <View style={[styles.pankajRow, styles.pankajRowStacked]}>
                  {!!pankajPhotoUrl.trim() ? (
                    <PankajSirPhoto uriRaw={pankajPhotoResolved} extraStyle={styles.pankajPhotoMobile} />
                  ) : (
                    <View style={[styles.pankajPhotoPlaceholder, styles.pankajPhotoMobile]}>
                      <Ionicons name="person" size={42} color={Colors.light.textMuted} />
                    </View>
                  )}
                  <View style={styles.pankajTextCol}>
                    {!!pankajBody && (
                      <Text style={[styles.sectionBody, styles.pankajBodyMobile]}>{pankajBody}</Text>
                    )}
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={[styles.pankajRow, !isWide && styles.pankajRowStacked]}>
                {!!pankajPhotoUrl.trim() ? (
                  <PankajSirPhoto uriRaw={pankajPhotoResolved} extraStyle={!isWide ? styles.pankajPhotoMobile : undefined} />
                ) : (
                  <View style={[styles.pankajPhotoPlaceholder, !isWide && styles.pankajPhotoMobile]}>
                    <Ionicons name="person" size={42} color={Colors.light.textMuted} />
                  </View>
                )}
                <View style={styles.pankajTextCol}>
                  {!!pankajBody && (
                    <Text style={[styles.sectionBody, !isWide && styles.pankajBodyMobile]}>{pankajBody}</Text>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* About */}
        {showAbout && (
          <SectionTitleAndScroll
            title={aboutTitle}
            compact={useSectionInnerScroll}
            scrollMaxH={sectionScrollMaxH}
          >
            {!!aboutBody && <Text style={styles.sectionBody}>{aboutBody}</Text>}
            {!!aboutImage && (
              <Image source={{ uri: aboutImage }} style={styles.sectionImage} resizeMode="cover" />
            )}
          </SectionTitleAndScroll>
        )}

        {showVision && (
          <SectionTitleAndScroll
            title={visionTitle}
            compact={useSectionInnerScroll}
            scrollMaxH={sectionScrollMaxH}
          >
            {!!visionBody && <Text style={styles.sectionBody}>{visionBody}</Text>}
            {!!visionImage && (
              <Image source={{ uri: visionImage }} style={styles.sectionImage} resizeMode="cover" />
            )}
          </SectionTitleAndScroll>
        )}

        {/* My courses */}
        {showMyCourse && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{myCourseTitle}</Text>
            {!!myCourseIntro.trim() && <Text style={styles.sectionIntro}>{myCourseIntro}</Text>}
            {!!myCourseImage && (
              <Image source={{ uri: myCourseImage }} style={styles.sectionImage} resizeMode="cover" />
            )}
            <View style={styles.courseGrid}>
              {myCourseItems.map((c, idx) => (
                <View key={`${c.title}-${idx}`} style={styles.courseCard}>
                  <Text style={styles.courseCardTitle}>{c.title}</Text>
                  <Text style={styles.courseCardDesc}>{c.desc}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Extra CMS sections */}
        {extraSections.map((sec, idx) => {
          if (!sec.title?.trim() && !sec.body?.trim() && !sec.imageUrl?.trim()) return null;
          return (
            <View key={`extra-${idx}`} style={styles.section}>
              {!!sec.title?.trim() && <Text style={styles.sectionTitle}>{sec.title}</Text>}
              {!!sec.body?.trim() && <Text style={styles.sectionBody}>{sec.body}</Text>}
              {!!sec.imageUrl?.trim() && (
                <Image source={{ uri: sec.imageUrl }} style={styles.sectionImage} resizeMode="cover" />
              )}
            </View>
          );
        })}

        {/* Features */}
        {on("welcome_show_features") && (
          <View style={[styles.featuresGrid, isWide && styles.featuresGridWide]}>
            {features.map((f) => (
              <View key={f.title} style={[styles.featureCard, isWide && styles.featureCardWide]}>
                <View style={[styles.featureIcon, { backgroundColor: f.color + "22" }]}>
                  <Ionicons name={f.icon as any} size={22} color={f.color} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Get the App — web only (never on native Android / iOS builds) */}
        {!isNativeApp && Platform.OS === "web" && on("welcome_show_get_app") && (
          <View style={styles.getAppSection}>
            <Text style={styles.getAppTitle}>{s("welcome_get_app_title", "Get the App")}</Text>
            <Text style={styles.getAppSub}>{s("welcome_get_app_subtitle", "Available on Android, iOS, and web.")}</Text>
            <View style={[styles.getAppCards, isWide && styles.getAppCardsWide]}>
              {on("welcome_show_google_play") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_play_title", "Android")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_play_desc", "Get the app from the Google Play Store")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={handleGooglePlay}>
                    <Ionicons name="logo-google-playstore" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>Google Play</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_ios") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_ios_title", "iOS")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_ios_desc", "Download from the Apple App Store")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={handleAppStore}>
                    <Ionicons name="logo-apple" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>App Store</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_web_app") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_web_title", "Web")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_web_desc", "Use the full app in your browser")}</Text>
                  <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]} onPress={handleOpenWebApp}>
                    <Ionicons name="desktop-outline" size={18} color="#fff" />
                    <Text style={styles.primaryBtnText}>Open Web App</Text>
                  </Pressable>
                </View>
              )}
              {on("welcome_show_web_download") && (
                <View style={[styles.getAppCard, isWide && { flex: 1 }]}>
                  <Text style={styles.getAppCardTitle}>{s("welcome_card_pwa_title", "Install")}</Text>
                  <Text style={styles.getAppCardDesc}>{s("welcome_card_pwa_desc", "Add to home screen as a web app")}</Text>
                  <Pressable style={({ pressed }) => [styles.storeBtn, pressed && { opacity: 0.85 }]} onPress={() => {
                    if (Platform.OS === "web" && typeof window !== "undefined") window.open(window.location.origin, "_blank");
                  }}>
                    <Ionicons name="download-outline" size={18} color="#fff" />
                    <Text style={styles.storeBtnText}>Install</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </View>
        )}

        <View style={styles.footerCard}>
          <Text style={styles.footer}>{s("welcome_footer", "© 2026 3i Learning. All rights reserved.")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const LOGO_BORDER = Colors.light.primaryDark;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  containerWeb: { width: "100%", maxWidth: "100%", alignSelf: "stretch" },
  scrollViewWeb: { width: "100%", flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 20, width: "100%", alignSelf: "stretch" },
  headerCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
    width: "100%",
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0px 4px 24px rgba(26, 86, 219, 0.08)" } as object)
      : { shadowColor: "#1A56DB", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 3 }),
  },
  headerCardPhoneWeb: { paddingVertical: 16 },
  headerRowWeb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexWrap: "nowrap",
    width: "100%",
    justifyContent: "space-between",
  },
  headerLeadingWeb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flex: 1,
    minWidth: 0,
  },
  headerTextColWeb: { flex: 1, minWidth: 0, gap: 4 },
  adminContactRowAbove: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
    width: "100%",
    paddingBottom: 4,
  },
  adminContactLaptopEnd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    flexShrink: 0,
  },
  adminContactPress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
  },
  adminContactLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.primary,
  },
  adminContactEmailLaptop: { maxWidth: 220 },
  headerBrandRowMobile: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    width: "100%",
  },
  /** Sizes: see `lib/welcome-image-sizes.ts` (admin hints). */
  logoRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: LOGO_BORDER,
    backgroundColor: Colors.light.card,
    alignItems: "center",
    justifyContent: "center",
    padding: 3,
  },
  logoRingPhoneWeb: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 3,
  },
  logoInnerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  logoInnerCirclePhoneWeb: {
    width: 66,
    height: 66,
    borderRadius: 33,
  },
  logoImg: {
    width: "100%",
    height: "100%",
  },
  brandInHeader: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textMuted,
    marginBottom: 2,
  },
  brandInHeaderMobile: {
    flex: 1,
    flexShrink: 1,
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  brandInHeaderPhoneWeb: {
    fontSize: 19,
    lineHeight: 24,
    textAlign: "left",
  },
  headlineInCard: { marginBottom: 0 },
  taglineWeb: {
    flexShrink: 1,
    fontSize: 21,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    lineHeight: 27,
    width: "100%",
    textAlign: "left",
  },
  headlineMobile: { fontSize: 26, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "center", lineHeight: 32 },
  navLine: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: Colors.light.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  navLineInCard: { textAlign: "center", paddingTop: 2 },
  navLineWebHeader: { textAlign: "left", alignSelf: "stretch", paddingTop: 4 },
  subheadline: {
    fontSize: 15,
    color: Colors.light.textMuted,
    textAlign: "center",
    lineHeight: 22,
    width: "100%",
    alignSelf: "stretch",
  },
  ctaRow: { flexDirection: "column", gap: 12, width: "100%" },
  ctaRowWeb: { flexDirection: "row", gap: 12, width: "100%", alignSelf: "stretch" },
  loginBtn: { flex: 1, borderRadius: 14, overflow: "hidden", minWidth: 140 },
  loginBtnPhoneWeb: {
    borderRadius: 14,
    minHeight: 54,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : {}),
    ...(Platform.OS === "web"
      ? { boxShadow: "0px 4px 14px rgba(239, 68, 68, 0.35)" }
      : { shadowColor: "#EF4444", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }),
  },
  loginGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  loginGradientPhoneWeb: { paddingVertical: 18, minHeight: 54 },
  loginText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#fff" },
  loginTextPhoneWeb: { fontSize: 17 },
  signupBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.light.primary,
    backgroundColor: Colors.light.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 14,
    minWidth: 140,
  },
  signupBtnPhoneWeb: {
    minHeight: 54,
    paddingVertical: 17,
    ...(Platform.OS === "web" ? ({ cursor: "pointer" } as object) : {}),
  },
  signupText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: Colors.light.primary },
  signupTextPhoneWeb: { fontSize: 16 },
  section: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 20,
    gap: 12,
  },
  sectionTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: Colors.light.text },
  sectionScrollInner: { gap: 12, paddingBottom: 10, paddingRight: 4 },
  sectionChildrenFlat: { gap: 12 },
  sectionIntro: { fontSize: 14, color: Colors.light.textSecondary, lineHeight: 21 },
  sectionBody: { fontSize: 15, color: Colors.light.textSecondary, lineHeight: 24 },
  sectionImage: { width: "100%", height: 200, borderRadius: 12, backgroundColor: Colors.light.background },
  pankajRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    width: "100%",
  },
  pankajRowStacked: {
    flexDirection: "column",
    alignItems: "center",
  },
  /** 130×130 circle — see `lib/welcome-image-sizes.ts` for admin copy. */
  pankajPhoto: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 3,
    borderColor: LOGO_BORDER,
    backgroundColor: Colors.light.background,
  },
  pankajPhotoMobile: {
    alignSelf: "center",
  },
  pankajPhotoPlaceholder: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: Colors.light.border,
    backgroundColor: Colors.light.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  pankajTextCol: { flex: 1, minWidth: 0, width: "100%" },
  pankajBodyMobile: { textAlign: "center" },
  courseGrid: { gap: 12, marginTop: 4 },
  courseCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: Colors.light.background,
    borderWidth: 1,
    borderColor: Colors.light.border,
    gap: 6,
  },
  courseCardTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: Colors.light.text },
  courseCardDesc: { fontSize: 14, color: Colors.light.textMuted, lineHeight: 20 },
  featuresGrid: { gap: 12 },
  featuresGridWide: { flexDirection: "row", flexWrap: "wrap" },
  featureCard: {
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 16,
    padding: 18,
    gap: 8,
  },
  featureCardWide: { flex: 1, minWidth: 160 },
  featureIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 15, fontFamily: "Inter_700Bold", color: Colors.light.text },
  featureDesc: { fontSize: 12, color: Colors.light.textMuted, lineHeight: 18 },
  getAppSection: { alignItems: "stretch", gap: 12 },
  getAppTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: Colors.light.text, textAlign: "left" },
  getAppSub: { fontSize: 14, color: Colors.light.textMuted, textAlign: "left", marginBottom: 4 },
  getAppCards: { width: "100%", gap: 16 },
  getAppCardsWide: { flexDirection: "row", flexWrap: "wrap" },
  getAppCard: {
    width: "100%",
    minWidth: 200,
    backgroundColor: Colors.light.card,
    borderWidth: 1,
    borderColor: Colors.light.border,
    borderRadius: 20,
    padding: 20,
    alignItems: "stretch",
    gap: 10,
  },
  getAppCardTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: Colors.light.text },
  getAppCardDesc: { fontSize: 13, color: Colors.light.textMuted },
  storeBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: "#374151", width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  storeBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: Colors.light.primary, width: "100%", paddingVertical: 14, borderRadius: 12, marginTop: 4,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  footerCard: {
    alignSelf: "stretch",
    marginTop: 12,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    /* Same soft blue as app welcome / home background */
    backgroundColor: Colors.light.background,
    borderWidth: 2,
    borderColor: Colors.light.primary,
  },
  footer: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: Colors.light.primaryDark,
    textAlign: "center",
    lineHeight: 20,
  },
});
