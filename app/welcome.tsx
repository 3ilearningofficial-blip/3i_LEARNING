import React from "react";
import {
  View, Text, StyleSheet, Pressable, Image, Platform,
  ScrollView, useWindowDimensions, Linking, Modal, ActivityIndicator, TextInput,
  type StyleProp,
  type ImageStyle,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getApiUrl, authFetch, apiRequest } from "@/lib/query-client";
import { getInstallationId } from "@/lib/installation-id";
import { blurActiveElementWeb } from "@/lib/navigate-auth-back";
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

function extractMediaKey(urlLike: string, apiBase: string): string | null {
  const normalized = normalizeWelcomeImageUrl(urlLike);
  if (!normalized) return null;
  try {
    const abs = /^https?:\/\//i.test(normalized)
      ? new URL(normalized)
      : new URL(resolveWelcomeMediaUrl(normalized, apiBase));
    const match = abs.pathname.match(/\/api\/media\/(.+)$/i);
    if (!match?.[1]) return null;
    return decodeURIComponent(match[1]).replace(/^\/+/, "");
  } catch {
    return null;
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

  const open = (url: string) => () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      // Use direct navigation so mailto/tel reliably open the default app on mobile web.
      window.location.href = url;
      return;
    }
    Linking.openURL(url).catch(() => {});
  };
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

  const open = (url: string) => () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = url;
      return;
    }
    Linking.openURL(url).catch(() => {});
  };
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
type PublicCourse = {
  id: number;
  title: string;
  description?: string;
  teacher_name?: string;
  price?: string;
  original_price?: string;
  category?: string;
  thumbnail?: string;
  is_free?: boolean;
  total_lectures?: number;
  total_tests?: number;
  level?: string;
};

function getCoursePriceNumber(course: PublicCourse): number | null {
  if (course.is_free) return null;
  const price = Number.parseFloat(String(course.price ?? ""));
  return Number.isFinite(price) && price > 0 ? price : null;
}

const WEBSITE_STATS = [
  { icon: "radio", title: "Daily Live", desc: "Interactive classes", color: "#EF4444" },
  { icon: "document-text", title: "Tests + Notes", desc: "Mocks, PDFs and notes", color: "#1A56DB" },
  { icon: "chatbubbles", title: "Doubt Support", desc: "Ask and revise faster", color: "#7C3AED" },
  { icon: "trophy", title: "Exam Ready", desc: "NDA, CDS and AFCAT", color: "#F59E0B" },
] as const;

const WEBSITE_EXAM_CATEGORIES = ["NDA", "CDS", "AFCAT"] as const;
const WEB_APP_HOME_PATH = "/home";

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
  const params = useLocalSearchParams<{ fromApp?: string }>();
  const isWide = width >= 640;
  const isWeb = Platform.OS === "web";
  const { user, login, refreshUser } = useAuth();
  const qc = useQueryClient();
  const [webMenuOpen, setWebMenuOpen] = React.useState(false);
  const [authPrompt, setAuthPrompt] = React.useState<{ visible: boolean; next: string; message: string }>({
    visible: false,
    next: WEB_APP_HOME_PATH,
    message: "",
  });
  const [authIdentifier, setAuthIdentifier] = React.useState("");
  const [authPassword, setAuthPassword] = React.useState("");
  const [authShowPassword, setAuthShowPassword] = React.useState(false);
  const [authLoading, setAuthLoading] = React.useState(false);
  const [authError, setAuthError] = React.useState("");
  const [infoPrompt, setInfoPrompt] = React.useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });

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
    refetchOnWindowFocus: false,
  });

  const s = (key: string, fallback: string) => (cfg[key] != null && cfg[key] !== "" ? cfg[key] : fallback);
  const on = (key: string) => s(key, "true") === "true";

  const { data: websiteCourses = [], isLoading: websiteCoursesLoading } = useQuery<PublicCourse[]>({
    queryKey: ["/api/courses", "welcome", user?.id ?? "guest"],
    queryFn: async () => {
      try {
        const url = new URL("/api/courses", getApiUrl());
        if (user?.id) url.searchParams.set("_uid", String(user.id));
        const res = await authFetch(url.toString());
        if (!res.ok) return [];
        const data = await res.json().catch(() => []);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

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
  const pankajMediaKey = React.useMemo(
    () => extractMediaKey(pankajPhotoResolved, apiOrigin),
    [pankajPhotoResolved, apiOrigin]
  );
  const { data: pankajMediaToken } = useQuery<{ token?: string; readUrl?: string }>({
    queryKey: ["/api/media-token", "welcome-pankaj", pankajMediaKey, user?.id || "anon"],
    queryFn: async () => {
      if (!pankajMediaKey) return {};
      const url = new URL("/api/media-token", getApiUrl());
      const res = await authFetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: pankajMediaKey }),
      });
      if (!res.ok) {
        // Only a 401 means the session is gone — invalidate so stale user.id no
        // longer triggers auth-gated queries. A 403 just means this user can't mint
        // a token for this key (e.g. public welcome images): the session is still
        // valid, so don't nuke it. Non-blocking either way — the welcome page falls
        // back to the plain (now public) image URL and keeps rendering.
        if (res.status === 401) {
          void qc.invalidateQueries({ queryKey: ["/api/auth/me"] });
        }
        return {};
      }
      return res.json();
    },
    enabled: !!pankajMediaKey && !!user?.id,
    staleTime: 8 * 60 * 1000,
    // gcTime must be shorter than the presigned URL TTL (10 min) so React Query
    // discards the cached readUrl before it expires and causes a 404.
    gcTime: 9 * 60 * 1000,
  });
  const pankajPhotoWithToken = React.useMemo(() => {
    if (!pankajPhotoResolved) return pankajPhotoResolved;
    const direct = pankajMediaToken?.readUrl;
    if (direct && typeof direct === "string") return direct;
    if (!pankajMediaToken?.token) return pankajPhotoResolved;
    try {
      const u = new URL(pankajPhotoResolved);
      u.searchParams.set("token", pankajMediaToken.token);
      return u.toString();
    } catch {
      return pankajPhotoResolved;
    }
  }, [pankajPhotoResolved, pankajMediaToken?.token, pankajMediaToken?.readUrl]);

  const myCourseTitle = s("welcome_my_course_title", "My Courses");
  const myCourseIntro = s("welcome_my_course_intro", "");
  const myCourseImage = s("welcome_my_course_image_url", "").trim();
  const myCourseItems = parseJsonArray<MyCourseItem>(
    cfg.welcome_my_course_json,
    DEFAULT_MY_COURSE_ITEMS
  );

  const extraSections = parseJsonArray<ExtraSection>(cfg.welcome_extra_sections_json, []);
  const features = getFeatures(cfg);
  const allowLoggedInWelcome =
    isWeb &&
    (params.fromApp === "1" ||
      (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fromApp") === "1"));

  React.useEffect(() => {
    if (!isWeb || !user?.id || allowLoggedInWelcome) return;
    router.replace(WEB_APP_HOME_PATH as any);
    const fallbackId = window.setTimeout(() => {
      if (window.location.pathname === "/welcome") {
        window.location.replace(WEB_APP_HOME_PATH);
      }
    }, 350);
    return () => window.clearTimeout(fallbackId);
  }, [allowLoggedInWelcome, isWeb, user?.id]);

  React.useEffect(() => {
    if (authPrompt.visible) return;
    setAuthError("");
    setAuthLoading(false);
  }, [authPrompt.visible]);

  const handleLogin = () => {
    blurActiveElementWeb();
    if (user) router.replace(WEB_APP_HOME_PATH as any);
    else if (isWeb) setAuthPrompt({ visible: true, next: WEB_APP_HOME_PATH, message: "" });
    else router.push("/(auth)/email-login" as any);
  };

  const handleSignup = () => {
    blurActiveElementWeb();
    if (user) router.replace(WEB_APP_HOME_PATH as any);
    else if (isWeb) setAuthPrompt({ visible: true, next: WEB_APP_HOME_PATH, message: "" });
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
    blurActiveElementWeb();
    if (user) router.replace(WEB_APP_HOME_PATH as any);
    else if (isWeb) setAuthPrompt({ visible: true, next: WEB_APP_HOME_PATH, message: "" });
    else router.push("/(auth)/email-login" as any);
  };

  const handleWebAppInstall = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(window.location.origin, "_blank");
      return;
    }
    handleOpenWebApp();
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

  const websiteCategories = WEBSITE_EXAM_CATEGORIES;
  const featuredWebsiteCourses = websiteCourses.slice(0, 6);
  const heroCoursePrice = React.useMemo(() => {
    const paidPrices = websiteCourses
      .map(getCoursePriceNumber)
      .filter((price): price is number => price != null)
      .sort((a, b) => a - b);
    return paidPrices[0] ?? null;
  }, [websiteCourses]);
  const heroCoursePriceText = websiteCoursesLoading
    ? "..."
    : heroCoursePrice != null
      ? `₹${heroCoursePrice.toFixed(0)}`
      : "Free";
  const isDesktopWeb = isWeb && width >= 900;

  const openWebRoute = (href: string) => {
    blurActiveElementWeb();
    setWebMenuOpen(false);
    router.push(href as any);
  };

  const routeIfAlreadyAuthenticated = async (next: string): Promise<boolean> => {
    if (!isWeb) return false;
    if (user?.id) {
      openWebRoute(next);
      return true;
    }
    try {
      await refreshUser();
      const res = await authFetch(new URL("/api/auth/me", getApiUrl()).toString());
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.id === "number") {
        router.replace(next as any);
        return true;
      }
    } catch {
      // fall through to auth prompt/modal
    }
    return false;
  };

  const showAuthRequired = async (next: string, message = "Please login/register first to view this.") => {
    blurActiveElementWeb();
    setWebMenuOpen(false);
    if (await routeIfAlreadyAuthenticated(next)) return;
    setAuthPrompt({ visible: true, next, message });
  };

  const openAuthModal = async (next = WEB_APP_HOME_PATH, message = "") => {
    blurActiveElementWeb();
    setWebMenuOpen(false);
    if (await routeIfAlreadyAuthenticated(next)) return;
    setAuthPrompt({ visible: true, next, message });
  };

  const openProtectedWebRoute = async (href: string) => {
    if (await routeIfAlreadyAuthenticated(href)) return;
    showAuthRequired(href);
  };

  const submitWebAuth = async () => {
    if (authLoading) return;
    const identifier = authIdentifier.trim().toLowerCase();
    if (!identifier) {
      setAuthError("Please enter your phone number or email.");
      return;
    }
    if (!authPassword) {
      setAuthError("Please enter your password.");
      return;
    }

    setAuthLoading(true);
    setAuthError("");
    try {
      const deviceId = await getInstallationId();
      const res = await apiRequest("POST", "/api/auth/email-login", {
        email: identifier,
        password: authPassword,
        deviceId,
      });
      const data = await res.json();
      if (!data?.user || typeof data.user.id !== "number") {
        throw new Error("Login succeeded but user data was missing. Please try again.");
      }
      await login(data.user);
      await refreshUser();
      setAuthPrompt((prev) => ({ ...prev, visible: false }));
      const nextPath = authPrompt.next === "/(tabs)" ? WEB_APP_HOME_PATH : authPrompt.next || WEB_APP_HOME_PATH;
      router.replace(nextPath as any);
    } catch (err: any) {
      const raw = String(err?.message || "Login failed. Please try again.");
      const msg = raw.replace(/^(GET|POST|PUT|PATCH|DELETE)\s+.*?->\s+\d+:\s*/i, "").replace(/^\d+:\s*/, "");
      if (msg.includes("register_first") || msg.includes("not found") || msg.includes("Not found")) {
        setAuthError("We couldn't find this account. Please register first.");
      } else if (msg.includes("complete_registration")) {
        setAuthError("Please complete your registration before logging in.");
      } else if (msg.includes("blocked") || msg.includes("Blocked")) {
        setAuthError("This account is blocked. Contact support/admin.");
      } else if (msg.includes("Invalid") || msg.includes("incorrect") || msg.includes("Incorrect") || msg.includes("401")) {
        setAuthError("Incorrect phone/email or password.");
      } else {
        setAuthError(msg || "Login failed. Please try again.");
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const openCategoryCourse = (category: string) => {
    const normalized = category.trim().toLowerCase();
    const course = websiteCourses.find((item) => String(item.category || "").trim().toLowerCase() === normalized);
    if (!course?.id) {
      setInfoPrompt({ visible: true, message: `No course available for ${category}.` });
      return;
    }
    openWebRoute(`/course/${course.id}`);
  };

  const openCourse = (courseId: number) => {
    const next = `/course/${courseId}`;
    blurActiveElementWeb();
    if (user?.id) {
      router.push(next as any);
      return;
    }
    showAuthRequired(next, "Please login/register first to buy this course.");
  };

  if (isWeb && user?.id && !allowLoggedInWelcome) {
    return null;
  }

  if (isWeb) {
    const headerLinks = [
      { label: "Home", onPress: () => openProtectedWebRoute(WEB_APP_HOME_PATH) },
      { label: "Courses", onPress: () => openProtectedWebRoute(WEB_APP_HOME_PATH) },
      { label: "Test Series", onPress: () => openProtectedWebRoute("/(tabs)/test-series") },
      { label: "AI Tutor", onPress: () => openProtectedWebRoute("/(tabs)/ai-tutor") },
    ];

    return (
      <View style={styles.websitePage}>
        <View style={styles.websiteHeader}>
          <Pressable onPress={() => openWebRoute("/welcome")} style={styles.websiteBrand}>
            <View style={styles.websiteLogo}>{logoImageEl}</View>
            <Text style={styles.websiteBrandText}>{brandText}</Text>
          </Pressable>

          {isDesktopWeb ? (
            <View style={styles.websiteNav}>
              {headerLinks.map((link) => (
                <Pressable key={link.label} onPress={link.onPress} style={({ pressed }) => [styles.websiteNavItem, pressed && styles.pressedSoft]}>
                  <Text style={styles.websiteNavText}>{link.label}</Text>
                </Pressable>
              ))}
              {webContactShows ? (
                <WebAdminContactsLaptopEnd phoneDisplay={webContactPhone} emailDisplay={webContactEmail} />
              ) : null}
              {user?.id ? (
                <Pressable onPress={() => openWebRoute(user.role === "admin" ? "/admin" : WEB_APP_HOME_PATH)} style={styles.websiteLoginButton}>
                  <Text style={styles.websiteLoginButtonText}>{user.role === "admin" ? "Dashboard" : "Open App"}</Text>
                </Pressable>
              ) : (
                <Pressable onPress={() => openAuthModal(WEB_APP_HOME_PATH)} style={styles.websiteLoginButton}>
                  <Text style={styles.websiteLoginButtonText}>Login/Register</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <Pressable onPress={() => setWebMenuOpen((open) => !open)} style={styles.websiteMenuButton}>
              <Ionicons name={webMenuOpen ? "close" : "menu"} size={26} color={Colors.light.text} />
            </Pressable>
          )}
        </View>

        {!isDesktopWeb && webMenuOpen ? (
          <View style={styles.websiteMobileMenu}>
            {webContactShows ? (
              <WebAdminContactsAbove phoneDisplay={webContactPhone} emailDisplay={webContactEmail} />
            ) : null}
            {headerLinks.map((link) => (
              <Pressable key={link.label} onPress={link.onPress} style={styles.websiteMobileMenuItem}>
                <Text style={styles.websiteMobileMenuText}>{link.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => (user?.id ? openWebRoute(WEB_APP_HOME_PATH) : openAuthModal(WEB_APP_HOME_PATH))} style={styles.websiteMobilePrimary}>
              <Text style={styles.websiteLoginButtonText}>{user?.id ? "Open App" : "Login/Register"}</Text>
            </Pressable>
          </View>
        ) : null}

        <ScrollView style={styles.websiteScroll} contentContainerStyle={styles.websiteScrollContent} showsVerticalScrollIndicator={false}>
          <LinearGradient colors={["#F5F7FF", "#FFF7ED"]} style={[styles.websiteHero, !isDesktopWeb && styles.websiteHeroMobile]}>
            <View style={styles.websiteHeroCopy}>
              <Text style={styles.websiteEyebrow}>Live classes, tests, missions and AI tutoring</Text>
              <Text style={[styles.websiteHeroTitle, !isDesktopWeb && styles.websiteHeroTitleMobile]}>
                {tagline || "Bharat's trusted exam preparation platform"}
              </Text>
              <Text style={styles.websiteHeroText}>
                Prepare for NDA, CDS and AFCAT with structured courses, interactive classes, OMR-style tests and daily practice.
              </Text>
              <View style={[styles.websiteHeroActions, !isDesktopWeb && styles.websiteHeroActionsMobile]}>
                <Pressable
                  onPress={() => openProtectedWebRoute(WEB_APP_HOME_PATH)}
                  style={({ pressed }) => [styles.websiteHeroPrimary, pressed && styles.pressedSoft]}
                >
                  <Text style={styles.websiteHeroPrimaryText}>{user?.id ? "Continue Learning" : "Join Now"}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
                </Pressable>
                <Pressable onPress={() => openProtectedWebRoute("/(tabs)/test-series")} style={styles.websiteHeroSecondary}>
                  <Text style={styles.websiteHeroSecondaryText}>Explore Tests</Text>
                </Pressable>
              </View>
            </View>
            <View style={styles.websiteHeroVisual}>
              <View style={styles.websiteHeroPriceCard}>
                <Text style={styles.websitePriceSmall}>Courses from</Text>
                <Text style={styles.websitePriceBig}>{heroCoursePriceText}</Text>
                <Text style={styles.websitePriceSmall}>Start today</Text>
              </View>
              <View style={styles.websiteTeacherBubble}>
                <Ionicons name="school" size={54} color={Colors.light.primary} />
                <Text style={styles.websiteTeacherText}>Pankaj Sir Guidance</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={[styles.websiteStats, !isDesktopWeb && styles.websiteStatsMobile]}>
            {WEBSITE_STATS.map((stat) => (
              <View key={stat.title} style={styles.websiteStatCard}>
                <View style={[styles.websiteStatIcon, { backgroundColor: `${stat.color}18` }]}>
                  <Ionicons name={stat.icon as any} size={24} color={stat.color} />
                </View>
                <Text style={styles.websiteStatTitle}>{stat.title}</Text>
                <Text style={styles.websiteStatDesc}>{stat.desc}</Text>
              </View>
            ))}
          </View>

          <View style={styles.websiteSection}>
            <Text style={styles.websiteSectionTitle}>Exam Categories</Text>
            <Text style={styles.websiteSectionSub}>Choose your goal and continue with the right course or test series.</Text>
            <View style={[styles.websiteCategoryGrid, !isDesktopWeb && styles.websiteCategoryGridMobile]}>
              {websiteCategories.map((category, index) => (
                <Pressable
                  key={category}
                  onPress={() => openCategoryCourse(category)}
                  style={({ pressed }) => [
                    styles.websiteCategoryCard,
                    { backgroundColor: ["#FFF7ED", "#EEF4FF", "#F5F3FF", "#ECFDF5"][index % 4] },
                    pressed && styles.pressedSoft,
                  ]}
                >
                  <Text style={styles.websiteCategoryTitle}>{category}</Text>
                  <Text style={styles.websiteCategorySub}>Explore Category</Text>
                  <Ionicons name="arrow-forward" size={22} color={Colors.light.text} />
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.websiteSection}>
            <Text style={styles.websiteSectionTitle}>Popular Courses</Text>
            <Text style={styles.websiteSectionSub}>Buy once you are logged in. If you are new, we will ask you to login/register first.</Text>
            <View style={[styles.websiteCourseGrid, !isDesktopWeb && styles.websiteCourseGridMobile]}>
              {websiteCoursesLoading && featuredWebsiteCourses.length === 0 ? (
                <View style={styles.websiteEmptyCourseCard}>
                  <ActivityIndicator color={Colors.light.primary} />
                  <Text style={styles.websiteCourseDesc}>Loading courses...</Text>
                </View>
              ) : null}
              {!websiteCoursesLoading && featuredWebsiteCourses.length === 0 ? (
                <View style={styles.websiteEmptyCourseCard}>
                  <Ionicons name="information-circle-outline" size={28} color={Colors.light.textMuted} />
                  <Text style={styles.websiteCourseDesc}>No course available right now.</Text>
                </View>
              ) : null}
              {featuredWebsiteCourses.map((course, index) => (
                <View key={`${course.id || "fallback"}-${index}`} style={styles.websiteCourseCard}>
                  <View style={styles.websiteCourseThumb}>
                    {course.thumbnail ? (
                      <Image source={{ uri: resolveWelcomeMediaUrl(course.thumbnail, apiOrigin) }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                    ) : (
                      <Ionicons name="book" size={34} color={Colors.light.primary} />
                    )}
                  </View>
                  <Text style={styles.websiteCourseTitle} numberOfLines={2}>{course.title}</Text>
                  <Text style={styles.websiteCourseDesc} numberOfLines={2}>{course.description || "Complete preparation with lectures, tests and practice."}</Text>
                  <View style={styles.websiteCourseMeta}>
                    <Text style={styles.websiteCoursePrice}>{course.is_free ? "Free" : `₹${parseFloat(String(course.price || "0")).toFixed(0)}`}</Text>
                    <Text style={styles.websiteCourseCategory}>{course.category || "Course"}</Text>
                  </View>
                  <Pressable
                    onPress={() => (course.id ? openCourse(course.id) : user?.id ? openWebRoute(WEB_APP_HOME_PATH) : showAuthRequired(WEB_APP_HOME_PATH))}
                    style={({ pressed }) => [styles.websiteBuyButton, pressed && styles.pressedSoft]}
                  >
                    <Text style={styles.websiteBuyButtonText}>{course.is_free ? "Start Free" : "Buy Now"}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </View>

          {on("welcome_show_get_app") ? (
            <View style={[styles.websiteAppCta, !isDesktopWeb && styles.websiteAppCtaCompact]}>
              <View style={styles.websiteAppCtaHeader}>
                <Text style={styles.websiteAppCtaTitle}>{s("welcome_get_app_title", "Join students on the app today!")}</Text>
                <Text style={styles.websiteAppCtaText}>
                  {s("welcome_get_app_subtitle", "You can download the app from iOS, Play Store, or continue on web.")}
                </Text>
              </View>
              <View style={[styles.websiteAppOptions, !isDesktopWeb && styles.websiteAppOptionsMobile]}>
                {on("welcome_show_google_play") ? (
                  <Pressable onPress={handleGooglePlay} style={({ pressed }) => [styles.websiteAppOptionCard, pressed && styles.pressedSoft]}>
                    <Ionicons name="logo-google-playstore" size={28} color="#22C55E" />
                    <View style={styles.websiteAppOptionTextCol}>
                      <Text style={styles.websiteAppOptionTitle}>{s("welcome_card_play_title", "Google Play")}</Text>
                      <Text style={styles.websiteAppOptionDesc}>{s("welcome_card_play_desc", "Download Android app")}</Text>
                    </View>
                  </Pressable>
                ) : null}
                {on("welcome_show_ios") ? (
                  <Pressable onPress={handleAppStore} style={({ pressed }) => [styles.websiteAppOptionCard, pressed && styles.pressedSoft]}>
                    <Ionicons name="logo-apple" size={30} color={Colors.light.text} />
                    <View style={styles.websiteAppOptionTextCol}>
                      <Text style={styles.websiteAppOptionTitle}>{s("welcome_card_ios_title", "App Store")}</Text>
                      <Text style={styles.websiteAppOptionDesc}>{s("welcome_card_ios_desc", "Download iOS app")}</Text>
                    </View>
                  </Pressable>
                ) : null}
                {on("welcome_show_web_app") ? (
                  <Pressable onPress={handleWebAppInstall} style={({ pressed }) => [styles.websiteAppOptionCard, pressed && styles.pressedSoft]}>
                    <Ionicons name="desktop-outline" size={29} color={Colors.light.primary} />
                    <View style={styles.websiteAppOptionTextCol}>
                      <Text style={styles.websiteAppOptionTitle}>{s("welcome_card_web_title", "Web")}</Text>
                      <Text style={styles.websiteAppOptionDesc}>{s("welcome_card_web_desc", "Open or install the web app")}</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : null}

          <Text style={styles.websiteFooter}>{s("welcome_footer", "© 2026 3i Learning. All rights reserved.")}</Text>
        </ScrollView>
        <Modal transparent visible={authPrompt.visible} animationType="fade" onRequestClose={() => setAuthPrompt((prev) => ({ ...prev, visible: false }))}>
          <View style={styles.websiteModalLayer}>
            <View style={styles.websiteAuthModalCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close login/register"
                onPress={() => setAuthPrompt((prev) => ({ ...prev, visible: false }))}
                style={styles.websiteAuthModalClose}
              >
                <Ionicons name="close" size={22} color={Colors.light.text} />
              </Pressable>
              {!!authPrompt.message && (
                <View style={styles.websiteAuthModalNotice}>
                  <Ionicons name="lock-closed" size={18} color={Colors.light.primary} />
                  <Text style={styles.websiteAuthModalNoticeText}>{authPrompt.message}</Text>
                </View>
              )}
              <ScrollView
                contentContainerStyle={styles.websiteAuthFormScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.websiteAuthIconWrap}>
                  <Ionicons name="mail" size={30} color={Colors.light.primary} />
                </View>
                <Text style={styles.websiteAuthTitle}>Welcome Back</Text>
                <Text style={styles.websiteAuthSubtitle}>Sign in with your phone/email and password</Text>

                <View style={styles.websiteAuthFormCard}>
                  <View style={styles.websiteAuthFieldGroup}>
                    <Text style={styles.websiteAuthLabel}>Phone Number or Email</Text>
                    <View style={styles.websiteAuthInputRow}>
                      <Ionicons name="person-outline" size={18} color={Colors.light.textMuted} />
                      <TextInput
                        nativeID="welcome-login-username"
                        style={styles.websiteAuthInput}
                        placeholder="Enter phone number or email"
                        placeholderTextColor={Colors.light.textMuted}
                        value={authIdentifier}
                        onChangeText={setAuthIdentifier}
                        keyboardType="default"
                        autoCapitalize="none"
                        autoComplete="username"
                        textContentType="username"
                        returnKeyType="next"
                      />
                    </View>
                  </View>

                  <View style={styles.websiteAuthFieldGroup}>
                    <Text style={styles.websiteAuthLabel}>Password</Text>
                    <View style={styles.websiteAuthInputRow}>
                      <Ionicons name="lock-closed-outline" size={18} color={Colors.light.textMuted} />
                      <TextInput
                        nativeID="welcome-login-password"
                        style={styles.websiteAuthInput}
                        placeholder="Enter your password"
                        placeholderTextColor={Colors.light.textMuted}
                        value={authPassword}
                        onChangeText={setAuthPassword}
                        secureTextEntry={!authShowPassword}
                        autoCapitalize="none"
                        autoComplete="current-password"
                        textContentType="password"
                        returnKeyType="done"
                        onSubmitEditing={submitWebAuth}
                      />
                      <Pressable onPress={() => setAuthShowPassword((show) => !show)}>
                        <Ionicons name={authShowPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.light.textMuted} />
                      </Pressable>
                    </View>
                  </View>

                  {!!authError && (
                    <View style={styles.websiteAuthErrorBox}>
                      <Ionicons name="alert-circle-outline" size={16} color="#EF4444" />
                      <Text style={styles.websiteAuthErrorText}>{authError}</Text>
                    </View>
                  )}

                  <Pressable
                    onPress={submitWebAuth}
                    disabled={authLoading}
                    style={({ pressed }) => [styles.websiteAuthSubmitButton, pressed && !authLoading && styles.pressedSoft, authLoading && { opacity: 0.75 }]}
                  >
                    {authLoading ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={styles.websiteAuthSubmitText}>Sign In</Text>
                        <Ionicons name="arrow-forward" size={19} color="#FFFFFF" />
                      </>
                    )}
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setAuthPrompt((prev) => ({ ...prev, visible: false }));
                      router.push({ pathname: "/(auth)/login", params: { next: authPrompt.next || WEB_APP_HOME_PATH } } as any);
                    }}
                    style={styles.websiteAuthSecondaryLink}
                  >
                    <Text style={styles.websiteAuthSecondaryText}>Don't have an account? Sign Up</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
        <Modal transparent visible={infoPrompt.visible} animationType="fade" onRequestClose={() => setInfoPrompt({ visible: false, message: "" })}>
          <View style={styles.websiteModalLayer}>
            <View style={styles.websiteModalCard}>
              <Ionicons name="information-circle" size={30} color={Colors.light.primary} />
              <Text style={styles.websiteModalTitle}>No Course Available</Text>
              <Text style={styles.websiteModalText}>{infoPrompt.message}</Text>
              <Pressable onPress={() => setInfoPrompt({ visible: false, message: "" })} style={[styles.websiteModalButton, styles.websiteModalButtonPrimary, { alignSelf: "stretch" }]}>
                <Text style={styles.websiteModalButtonPrimaryText}>OK</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

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
                    <PankajSirPhoto uriRaw={pankajPhotoWithToken} extraStyle={styles.pankajPhotoMobile} />
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
                  <PankajSirPhoto uriRaw={pankajPhotoWithToken} extraStyle={!isWide ? styles.pankajPhotoMobile : undefined} />
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
  pressedSoft: { opacity: 0.78 },
  websitePage: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  websiteHeader: {
    minHeight: 70,
    paddingHorizontal: 28,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 30,
  },
  websiteBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  websiteLogo: {
    width: 42,
    height: 42,
    borderRadius: 21,
    overflow: "hidden",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  websiteBrandText: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    color: Colors.light.text,
  },
  websiteNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  websiteNavItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  websiteNavText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.light.text,
  },
  websiteLoginButton: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteLoginButtonText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#FFFFFF",
  },
  websiteMenuButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteMobileMenu: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    padding: 12,
    gap: 6,
  },
  websiteMobileMenuItem: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  websiteMobileMenuText: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    color: Colors.light.text,
  },
  websiteMobilePrimary: {
    marginTop: 6,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteScroll: { flex: 1 },
  websiteScrollContent: {
    paddingBottom: 44,
    gap: 34,
  },
  websiteHero: {
    marginHorizontal: 0,
    paddingHorizontal: 72,
    paddingVertical: 54,
    minHeight: 360,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 32,
  },
  websiteHeroMobile: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    minHeight: 0,
    flexDirection: "column",
    alignItems: "stretch",
  },
  websiteHeroCopy: {
    flex: 1.2,
    gap: 16,
    maxWidth: 680,
  },
  websiteEyebrow: {
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    color: Colors.light.primary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  websiteHeroTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 46,
    lineHeight: 55,
    color: Colors.light.text,
  },
  websiteHeroTitleMobile: {
    fontSize: 30,
    lineHeight: 38,
  },
  websiteHeroText: {
    fontFamily: "Inter_400Regular",
    fontSize: 17,
    lineHeight: 26,
    color: Colors.light.textSecondary,
    maxWidth: 620,
  },
  websiteHeroActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  websiteHeroActionsMobile: {
    flexDirection: "column",
    alignItems: "stretch",
  },
  websiteHeroPrimary: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  websiteHeroPrimaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: "#FFFFFF",
  },
  websiteHeroSecondary: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteHeroSecondaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
    color: Colors.light.text,
  },
  websiteHeroVisual: {
    flex: 0.8,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
  },
  websiteHeroPriceCard: {
    minWidth: 220,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 24,
    alignItems: "center",
    ...(Platform.OS === "web" ? ({ boxShadow: "0px 20px 50px rgba(15, 23, 42, 0.12)" } as object) : {}),
  },
  websitePriceSmall: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    color: Colors.light.textSecondary,
  },
  websitePriceBig: {
    fontFamily: "Inter_700Bold",
    fontSize: 38,
    color: Colors.light.primary,
    marginVertical: 6,
  },
  websiteTeacherBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  websiteTeacherText: {
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    fontSize: 15,
  },
  websiteStats: {
    marginHorizontal: 72,
    marginTop: -60,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingVertical: 20,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-around",
    gap: 10,
    ...(Platform.OS === "web" ? ({ boxShadow: "0px 16px 40px rgba(15, 23, 42, 0.08)" } as object) : {}),
  },
  websiteStatsMobile: {
    marginHorizontal: 20,
    marginTop: 0,
    flexDirection: "column",
  },
  websiteStatCard: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  websiteStatIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteStatTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.light.text,
    textAlign: "center",
  },
  websiteStatDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.light.textSecondary,
    textAlign: "center",
  },
  websiteSection: {
    paddingHorizontal: 72,
    gap: 14,
  },
  websiteSectionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.light.text,
    textAlign: "center",
  },
  websiteSectionSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.light.textSecondary,
    textAlign: "center",
    marginBottom: 8,
  },
  websiteCategoryGrid: {
    flexDirection: "row",
    gap: 16,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  websiteCategoryGridMobile: {
    flexDirection: "column",
  },
  websiteCategoryCard: {
    width: 230,
    minHeight: 150,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 18,
    justifyContent: "space-between",
  },
  websiteCategoryTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.light.text,
  },
  websiteCategorySub: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.light.textSecondary,
  },
  websiteCourseGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 18,
    justifyContent: "center",
  },
  websiteCourseGridMobile: {
    flexDirection: "column",
  },
  websiteCourseCard: {
    width: 292,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
    padding: 16,
    gap: 10,
  },
  websiteEmptyCourseCard: {
    width: 292,
    minHeight: 130,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
    padding: 18,
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteCourseThumb: {
    height: 130,
    borderRadius: 16,
    backgroundColor: "#EEF4FF",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  websiteCourseTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: Colors.light.text,
  },
  websiteCourseDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    color: Colors.light.textSecondary,
    lineHeight: 19,
  },
  websiteCourseMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  websiteCoursePrice: {
    fontFamily: "Inter_700Bold",
    color: Colors.light.primary,
    fontSize: 17,
  },
  websiteCourseCategory: {
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.textMuted,
    fontSize: 12,
  },
  websiteBuyButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteBuyButtonText: {
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    fontSize: 14,
  },
  websiteAppCta: {
    marginHorizontal: 72,
    borderRadius: 24,
    backgroundColor: "#EEF4FF",
    padding: 30,
    gap: 20,
  },
  websiteAppCtaCompact: {
    marginHorizontal: 20,
    padding: 22,
  },
  websiteAppCtaHeader: { gap: 8 },
  websiteAppCtaTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 25,
    color: Colors.light.text,
  },
  websiteAppCtaText: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.light.textSecondary,
    marginTop: 8,
    lineHeight: 21,
  },
  websiteAppOptions: {
    flexDirection: "row",
    gap: 14,
    flexWrap: "wrap",
  },
  websiteAppOptionsMobile: {
    flexDirection: "column",
  },
  websiteAppOptionCard: {
    flex: 1,
    minWidth: 210,
    minHeight: 82,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  websiteAppOptionTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  websiteAppOptionTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 16,
    color: Colors.light.text,
  },
  websiteAppOptionDesc: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    color: Colors.light.textSecondary,
    lineHeight: 17,
  },
  websiteFooter: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.light.textMuted,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  websiteModalLayer: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  websiteModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 24,
    alignItems: "center",
    gap: 12,
    ...(Platform.OS === "web" ? ({ boxShadow: "0px 24px 70px rgba(15, 23, 42, 0.22)" } as object) : {}),
  },
  websiteModalTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.light.text,
    textAlign: "center",
  },
  websiteModalText: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.light.textSecondary,
    lineHeight: 22,
    textAlign: "center",
  },
  websiteModalActions: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    paddingTop: 6,
  },
  websiteModalButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  websiteModalButtonPrimary: {
    backgroundColor: Colors.light.primary,
  },
  websiteModalButtonSecondary: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
  },
  websiteModalButtonPrimaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: "#FFFFFF",
  },
  websiteModalButtonSecondaryText: {
    fontFamily: "Inter_700Bold",
    fontSize: 14,
    color: Colors.light.text,
  },
  websiteAuthModalCard: {
    width: "100%",
    maxWidth: 520,
    height: "86%",
    maxHeight: 720,
    minHeight: 560,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    overflow: "hidden",
    position: "relative",
    ...(Platform.OS === "web" ? ({ boxShadow: "0px 24px 80px rgba(15, 23, 42, 0.28)" } as object) : {}),
  },
  websiteAuthModalClose: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 5,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
    justifyContent: "center",
  },
  websiteAuthModalNotice: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 60,
    zIndex: 4,
    minHeight: 36,
    borderRadius: 14,
    backgroundColor: "#EEF4FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  websiteAuthModalNoticeText: {
    flex: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.light.primary,
  },
  websiteAuthFormScroll: {
    flexGrow: 1,
    paddingHorizontal: 28,
    paddingTop: 58,
    paddingBottom: 28,
    justifyContent: "center",
    gap: 14,
  },
  websiteAuthIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: Colors.light.secondary,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  websiteAuthTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
    textAlign: "center",
  },
  websiteAuthSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: Colors.light.textMuted,
    textAlign: "center",
  },
  websiteAuthFormCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.light.border,
    padding: 20,
    gap: 14,
    ...(Platform.OS === "web" ? ({ boxShadow: "0px 14px 42px rgba(15, 23, 42, 0.12)" } as object) : {}),
  },
  websiteAuthFieldGroup: { gap: 7 },
  websiteAuthLabel: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: Colors.light.text,
  },
  websiteAuthInputRow: {
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: 12,
  },
  websiteAuthInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: Colors.light.text,
    outlineStyle: "none" as any,
  },
  websiteAuthErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  websiteAuthErrorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: "#B91C1C",
  },
  websiteAuthSubmitButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  websiteAuthSubmitText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  websiteAuthSecondaryLink: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 4,
  },
  websiteAuthSecondaryText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: Colors.light.primary,
  },
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
    // Phone/narrow web: show phone and email on separate lines.
    flexDirection: "column",
    flexWrap: "nowrap",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
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
