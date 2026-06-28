import React from "react";
import { Tabs, Stack, router, usePathname } from "expo-router";
import { Platform, View, Text, Pressable, ScrollView, ActivityIndicator, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";
import { useAppTheme } from "@/context/AppThemeContext";

const WEB_NAV = [
  { href: "/staff", label: "Home", icon: "home" as const },
  { href: "/staff/profile", label: "Profile", icon: "person" as const },
  { href: "/staff/courses", label: "Courses", icon: "book" as const },
  { href: "/staff/tests", label: "Tests", icon: "document-text" as const },
  { href: "/staff/missions", label: "Missions", icon: "flame" as const },
  { href: "/staff/materials", label: "Materials", icon: "folder-open" as const },
  { href: "/staff/requests", label: "Requests", icon: "hand-left" as const },
];

function StaffGuard({ children }: { children: React.ReactNode }) {
  const { user, isStaff, isLoading, logout } = useAuth();
  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={Colors.light.primary} />
      </View>
    );
  }
  if (!isStaff) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Ionicons name="lock-closed" size={48} color={Colors.light.textMuted} />
        <Text style={{ marginTop: 12, fontFamily: "Inter_600SemiBold", color: Colors.light.textMuted }}>Teacher access required</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: Colors.light.primary, fontFamily: "Inter_600SemiBold" }}>Go Back</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children}</>;
}

function WebStaffShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { user, logout } = useAuth();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  if (!isWide) {
    return <StaffGuard>{children}</StaffGuard>;
  }

  return (
    <StaffGuard>
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.background }}>
        <View style={{ width: 240, borderRightWidth: 1, borderRightColor: colors.border, backgroundColor: colors.surface }}>
          <LinearGradient colors={[Colors.light.primary, "#1e40af"]} style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 16 }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_800ExtraBold", fontSize: 18 }}>Teacher Portal</Text>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 4 }}>{user?.name}</Text>
          </LinearGradient>
          <ScrollView style={{ flex: 1 }}>
            {WEB_NAV.map((item) => {
              const active = pathname === item.href || (item.href !== "/staff" && pathname.startsWith(item.href));
              return (
                <Pressable
                  key={item.href}
                  onPress={() => router.push(item.href as any)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, marginHorizontal: 8, marginVertical: 2, borderRadius: 10, backgroundColor: active ? colors.surfaceAlt : "transparent" }}
                >
                  <Ionicons name={item.icon} size={20} color={active ? Colors.light.primary : colors.textMuted} />
                  <Text style={{ fontFamily: active ? "Inter_700Bold" : "Inter_500Medium", color: active ? Colors.light.primary : colors.textSecondary }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable onPress={() => logout()} style={{ padding: 16, borderTopWidth: 1, borderTopColor: colors.border }}>
            <Text style={{ color: "#dc2626", fontFamily: "Inter_600SemiBold" }}>Logout</Text>
          </Pressable>
        </View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    </StaffGuard>
  );
}

export default function StaffLayout() {
  const isWeb = Platform.OS === "web";

  if (isWeb) {
    return (
      <WebStaffShell>
        <Stack screenOptions={{ headerShown: false }} />
      </WebStaffShell>
    );
  }

  return (
    <StaffGuard>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: Colors.light.primary,
          tabBarInactiveTintColor: Colors.light.textMuted,
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
        <Tabs.Screen name="courses" options={{ title: "Courses", tabBarIcon: ({ color, size }) => <Ionicons name="book" size={size} color={color} /> }} />
        <Tabs.Screen name="tests" options={{ title: "Tests", tabBarIcon: ({ color, size }) => <Ionicons name="document-text" size={size} color={color} /> }} />
        <Tabs.Screen name="materials" options={{ title: "Materials", tabBarIcon: ({ color, size }) => <Ionicons name="folder-open" size={size} color={color} /> }} />
        <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
        <Tabs.Screen name="missions" options={{ href: null }} />
        <Tabs.Screen name="requests" options={{ href: null }} />
        <Tabs.Screen name="more" options={{ href: null }} />
        <Tabs.Screen name="live" options={{ href: null }} />
      </Tabs>
    </StaffGuard>
  );
}
