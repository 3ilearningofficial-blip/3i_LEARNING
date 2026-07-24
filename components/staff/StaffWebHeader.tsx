import { Ionicons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React, { useMemo } from "react";
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
import { useAuth } from "@/context/AuthContext";
import { backToApp } from "@/lib/admin/adminNavigation";
import { useStaffPermissions } from "@/lib/staff/useStaffPermissions";
import { STAFF_WEB_NAV, filterStaffNav } from "./staff-web-nav";

export function StaffWebHeader() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const { colors, isDarkMode } = useAppTheme();
  const { user, logout } = useAuth();
  const { canAny, isLoading: permsLoading } = useStaffPermissions();
  const navItems = useMemo(() => filterStaffNav(STAFF_WEB_NAV, canAny), [canAny, permsLoading]);

  React.useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  if (Platform.OS !== "web") return null;

  const isPhoneWeb = width < 768;

  const navigateTo = (href: string) => {
    setMenuOpen(false);
    router.push(href as never);
  };

  const renderNavItem = (item: (typeof STAFF_WEB_NAV)[number], compact = false) => {
    const active = pathname === item.href || (item.href !== "/staff" && pathname.startsWith(item.href));
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
        <Ionicons
          name={item.icon}
          size={compact ? 18 : 16}
          color={active ? colors.primary : colors.textSecondary}
        />
        <Text
          style={[
            compact ? styles.mobileNavText : styles.navText,
            { color: active ? colors.primary : colors.textSecondary },
          ]}
        >
          {item.label}
        </Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
      <View style={styles.leftGroup}>
        <Pressable onPress={() => navigateTo("/staff")} style={styles.brand}>
          <Image source={require("@/assets/images/logo.png")} style={styles.logoImg} resizeMode="contain" />
          <View>
            <Text style={[styles.brandText, { color: colors.text }]}>Teacher Dashboard</Text>
            {user?.name ? (
              <Text style={[styles.subText, { color: colors.textMuted }]} numberOfLines={1}>
                {user.name}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      {isPhoneWeb ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable
              onPress={() => backToApp(router)}
              style={({ pressed }) => [
                styles.backAppBtn,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-back" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open teacher navigation menu"
              onPress={() => setMenuOpen(true)}
              style={({ pressed }) => [
                styles.menuButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="menu" size={26} color={colors.text} />
            </Pressable>
          </View>
          <Modal transparent visible={menuOpen} animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <View style={styles.modalLayer}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
              <View style={[styles.mobileMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {navItems.map((item) => renderNavItem(item, true))}
                <Pressable
                  onPress={() => {
                    setMenuOpen(false);
                    backToApp(router);
                  }}
                  style={styles.mobileNavItem}
                >
                  <Ionicons name="arrow-back" size={18} color={colors.textSecondary} />
                  <Text style={[styles.mobileNavText, { color: colors.textSecondary }]}>Back to App</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMenuOpen(false);
                    logout();
                  }}
                  style={styles.mobileNavItem}
                >
                  <Ionicons name="log-out" size={18} color="#dc2626" />
                  <Text style={[styles.mobileNavText, { color: "#dc2626" }]}>Logout</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </>
      ) : (
        <View style={styles.nav}>
          {navItems.map((item) => renderNavItem(item))}
          <Pressable
            onPress={() => backToApp(router)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            <Ionicons name="arrow-back" size={16} color={colors.textSecondary} />
            <Text style={[styles.navText, { color: colors.textSecondary }]}>Back to App</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 64,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 20,
  },
  leftGroup: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 1 },
  logoImg: { width: 34, height: 34, borderRadius: 8 },
  brandText: { fontFamily: "Inter_700Bold", fontSize: 16 },
  subText: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 1 },
  nav: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    borderRadius: 999,
    paddingHorizontal: 12,
  },
  navText: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backAppBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalLayer: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.18)" },
  mobileMenu: {
    position: "absolute",
    top: 72,
    right: 16,
    left: 16,
    borderRadius: 18,
    borderWidth: 1,
    padding: 8,
  },
  mobileNavItem: {
    minHeight: 48,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  mobileNavText: { fontFamily: "Inter_600SemiBold", fontSize: 15 },
  pressed: { opacity: 0.72 },
});
