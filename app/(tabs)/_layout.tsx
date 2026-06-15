import { Tabs } from "expo-router";
import { Platform, View, Text } from "react-native";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authFetch, getApiUrl } from "@/lib/query-client";
import { supportMessagesQueryKey } from "@/lib/query-keys";
import { useAuth } from "@/context/AuthContext";
import { useAppTheme } from "@/context/AppThemeContext";

function ChatTabIcon({ color, focused }: { color: string; focused: boolean }) {
  const { user } = useAuth();
  const { data: messages = [] } = useQuery<any[]>({
    queryKey: user?.id ? supportMessagesQueryKey(user.id) : ["/api/support/messages", "guest"],
    queryFn: async () => {
      try {
        const baseUrl = getApiUrl();
        const res = await authFetch(new URL("/api/support/messages", baseUrl).toString());
        if (res.status === 401) return [];
        if (!res.ok) return [];
        return res.json();
      } catch { return []; }
    },
    // When Support tab itself is focused, the screen-level query should be the active poll owner.
    enabled: !!user?.id && !focused,
    refetchInterval: !!user?.id && !focused ? 90000 : false,
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

export default function TabLayout() {
  const isWeb = Platform.OS === "web";
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const androidBaseTabHeight = 60;
  const tabBarBottomInset = isWeb ? 0 : Math.max(insets.bottom, Platform.OS === "android" ? 10 : 6);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11, marginBottom: 2 },
        tabBarStyle: isWeb
          ? { display: "none" }
          : {
              position: "absolute",
              backgroundColor: colors.card,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              elevation: 0,
              paddingBottom: tabBarBottomInset,
              paddingTop: 4,
              height: Platform.OS === "android" ? androidBaseTabHeight + tabBarBottomInset : undefined,
            },
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
