import { Tabs } from "expo-router";
import { Platform, StyleSheet, View, Text } from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { useAuth } from "@/context/AuthContext";

function ChatTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { user } = useAuth();
  const { data: messages = [] } = useQuery<any[]>({
    queryKey: ["/api/support/messages"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/support/messages", baseUrl).toString());
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user,
    refetchInterval: 90000,
    staleTime: 60000,
    refetchOnMount: false,
  });

  const unread = messages.filter((m: any) => m.sender === "admin" && !m.is_read).length;

  return (
    <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={focused ? "chatbubbles" : "chatbubbles-outline"} size={24} color={color} />
      {unread > 0 && (
        <View style={{
          position: "absolute", top: -2, right: -4,
          backgroundColor: "#EF4444", borderRadius: 8,
          minWidth: 16, height: 16,
          alignItems: "center", justifyContent: "center",
          paddingHorizontal: 3,
        }}>
          <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" }}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </View>
  );
}

function NotifTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { user } = useAuth();
  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/notifications"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/notifications", baseUrl).toString());
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    enabled: !!user,
    refetchInterval: 90000,
    staleTime: 60000,
    refetchOnMount: false,
  });

  const unread = notifications.filter((n: any) => !n.is_read).length;

  return (
    <View style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={focused ? "notifications" : "notifications-outline"} size={24} color={color} />
      {unread > 0 && (
        <View style={{
          position: "absolute", top: -2, right: -4,
          backgroundColor: "#EF4444", borderRadius: 8,
          minWidth: 16, height: 16,
          alignItems: "center", justifyContent: "center",
          paddingHorizontal: 3,
        }}>
          <Text style={{ fontSize: 9, fontFamily: "Inter_700Bold", color: "#fff" }}>{unread > 9 ? "9+" : unread}</Text>
        </View>
      )}
    </View>
  );
}

export default function TabLayout() {
  const isWeb = Platform.OS === "web";
  const isIOS = Platform.OS === "ios";
  const insets = useSafeAreaInsets();
  const androidBaseTabHeight = 60;
  const tabBarBottomInset = isWeb ? 0 : Math.max(insets.bottom, Platform.OS === "android" ? 10 : 6);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.light.primary,
        tabBarInactiveTintColor: Colors.light.tabIconDefault,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11, marginBottom: 2 },
        tabBarStyle: {
          position: isWeb ? "relative" : "absolute",
          backgroundColor: isIOS ? "transparent" : isWeb ? "#ffffff" : "#ffffff",
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: Colors.light.border,
          elevation: 0,
          paddingBottom: tabBarBottomInset,
          paddingTop: isWeb ? 6 : 4,
          height: isWeb ? 84 : Platform.OS === "android" ? androidBaseTabHeight + tabBarBottomInset : undefined,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: Colors.light.border }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="daily-mission"
        options={{
          title: "Daily Mission",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "flame" : "flame-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="test-series"
        options={{
          title: "Test Series",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "document-text" : "document-text-outline"} size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="support-chat-tab"
        options={{
          title: "Support",
          tabBarIcon: ({ color, focused }) => <ChatTabIcon color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="ai-tutor"
        options={{
          title: "AI Tutor",
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons name={focused ? "robot" : "robot-outline"} size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
