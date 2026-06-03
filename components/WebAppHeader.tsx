import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Colors from "@/constants/colors";

const WEB_NAV_ITEMS = [
  { label: "Home", href: "/home", activePaths: ["/home"] },
  { label: "Daily Missions", href: "/(tabs)/daily-mission", activePaths: ["/daily-mission"] },
  { label: "Test Series", href: "/(tabs)/test-series", activePaths: ["/test-series"] },
  { label: "AI Tutor", href: "/(tabs)/ai-tutor", activePaths: ["/ai-tutor"] },
] as const;

export function WebAppHeader() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = React.useState(false);

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
    router.push("/welcome" as never);
  };

  const renderNavItem = (item: (typeof WEB_NAV_ITEMS)[number], compact = false) => {
    const active = item.activePaths.some((activePath) => activePath === pathname);
    return (
      <Pressable
        key={item.href}
        onPress={() => navigateTo(item.href)}
        style={({ pressed }) => [
          compact ? styles.mobileNavItem : styles.navItem,
          active && (compact ? styles.mobileNavItemActive : styles.navItemActive),
          pressed && styles.pressed,
        ]}
      >
        <Text style={[compact ? styles.mobileNavText : styles.navText, active && styles.navTextActive]}>
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={styles.header}>
      <View style={styles.leftGroup}>
        <Pressable onPress={navigateToWelcome} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={18} color={Colors.light.primary} />
          {!isPhoneWeb ? <Text style={styles.backText}>Welcome</Text> : null}
        </Pressable>
        <Pressable onPress={() => navigateTo("/home")} style={styles.brand}>
          <View style={styles.logoMark}>
            <Text style={styles.logoText}>3i</Text>
          </View>
          <Text style={styles.brandText}>3i Learning</Text>
        </Pressable>
      </View>

      {isPhoneWeb ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open navigation menu"
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
          >
            <Ionicons name="menu" size={26} color={Colors.light.text} />
          </Pressable>
          <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <View style={styles.modalLayer}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
              <View style={styles.mobileMenu}>
                <Pressable onPress={navigateToWelcome} style={styles.mobileNavItem}>
                  <Text style={styles.mobileNavText}>Back to Welcome</Text>
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
  logoMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: Colors.light.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    fontSize: 15,
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
