import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";

const WEB_NAV_ITEMS = [
  { label: "Home", href: "/home", activePaths: ["/home"] },
  { label: "Daily Missions", href: "/(tabs)/daily-mission", activePaths: ["/daily-mission"] },
  { label: "Test Series", href: "/(tabs)/test-series", activePaths: ["/test-series"] },
  { label: "Chat Support", href: "/(tabs)/support-chat-tab", activePaths: ["/support-chat-tab"] },
  { label: "AI Tutor", href: "/(tabs)/ai-tutor", activePaths: ["/ai-tutor"] },
] as const;

export function WebAppHeader() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { colors, isDarkMode } = useAppTheme();

  React.useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (Platform.OS !== "web") return null;

  const isPhoneWeb = width < 768;

  const navigateTo = (href: (typeof WEB_NAV_ITEMS)[number]["href"]) => {
    setMenuOpen(false);
    router.push(href as never);
  };

  const navigateToWelcome = () => {
    setMenuOpen(false);
    router.push("/welcome?fromApp=1" as never);
  };

  const renderNavItem = (item: (typeof WEB_NAV_ITEMS)[number], compact = false) => {
    const active = item.activePaths.some((activePath) => activePath === pathname);
    return (
      <Pressable
        key={item.href}
        onPress={() => navigateTo(item.href)}
        style={({ pressed }) => [
          compact ? styles.mobileNavItem : styles.navItem,
          active && { backgroundColor: isDarkMode ? colors.surfaceAlt : "#EEF4FF" },
          pressed && styles.pressed,
        ]}
      >
        <Text style={[
          compact ? styles.mobileNavText : styles.navText,
          { color: active ? colors.primary : colors.textSecondary },
        ]}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={styles.leftGroup}>
        <Pressable
          onPress={navigateToWelcome}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: isDarkMode ? colors.surfaceAlt : "#EEF4FF", borderColor: isDarkMode ? colors.border : "#BFDBFE" },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="arrow-back" size={18} color={colors.primary} />
          {!isPhoneWeb ? <Text style={styles.backText}>Welcome</Text> : null}
        </Pressable>
        <Pressable onPress={() => navigateTo("/home")} style={styles.brand}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={styles.logoImg}
            resizeMode="contain"
          />
          <Text style={[styles.brandText, { color: colors.text }]}>3i Learning</Text>
        </Pressable>
      </View>

      {isPhoneWeb ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [
              styles.menuButton,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="menu" size={26} color={colors.text} />
          </Pressable>
          <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <View style={styles.modalLayer}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
              <View style={[styles.mobileMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable onPress={navigateToWelcome} style={styles.mobileNavItem}>
                  <Text style={[styles.mobileNavText, { color: colors.textSecondary }]}>Back to Welcome</Text>
                </Pressable>
                {WEB_NAV_ITEMS.map((item) => renderNavItem(item, true))}
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <View style={styles.nav}>{WEB_NAV_ITEMS.map((item) => renderNavItem(item))}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 64,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.border,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 20,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  leftGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 1,
  },
  backButton: {
    minHeight: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EEF4FF",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backText: {
    color: Colors.light.primary,
    fontFamily: "Inter_700Bold",
    fontSize: 13,
  },
  logoImg: {
    width: 34,
    height: 34,
    borderRadius: 8,
  },
  brandText: {
    color: Colors.light.text,
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  navItem: {
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  navItemActive: {
    backgroundColor: "#EEF4FF",
  },
  navText: {
    color: Colors.light.textSecondary,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  navTextActive: {
    color: Colors.light.primary,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  modalLayer: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.18)",
  },
  mobileMenu: {
    position: "absolute",
    top: 72,
    right: 16,
    left: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.light.border,
    backgroundColor: "#FFFFFF",
    padding: 8,
  },
  mobileNavItem: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  mobileNavItemActive: {
    backgroundColor: "#EEF4FF",
  },
  mobileNavText: {
    color: Colors.light.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
  },
  pressed: {
    opacity: 0.72,
  },
});
