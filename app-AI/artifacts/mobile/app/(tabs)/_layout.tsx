import { BlurView as BlurViewRaw, type BlurViewProps } from "expo-blur";

// expo-blur exports BlurView as a class component whose constructor
// signature isn't a valid React 19 JSX element type (TS2607/TS2786).
// Cast to a function-component type so it's assignable in JSX.
const BlurView = BlurViewRaw as unknown as React.FC<React.PropsWithChildren<BlurViewProps>>;
import { Redirect, Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React, { useCallback } from "react";
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/hooks/useNotifications";
import { getGetAlertsQueryKey } from "@workspace/api-client-react";
import { useApiHealth } from "@/hooks/useApiHealth";
import { ApiStatusBanner } from "@/components/ApiStatusBanner";

export default function TabLayout() {
  const colors   = useColors();
  const { t }   = useLang();
  const isIOS   = Platform.OS === "ios";
  const qc      = useQueryClient();
  const { user, isLoading } = useAuth();
  const apiHealth = useApiHealth();
  // Read the real bottom safe-area inset so the tab bar always clears the
  // phone's system navigation bar (gesture bar on Android, home indicator on iOS).
  const insets = useSafeAreaInsets();

  // Base icon+label area height: 50px on Android, 50px on iOS.
  // Add insets.bottom so the bar extends into the system gesture zone.
  const TAB_BAR_HEIGHT     = 50 + insets.bottom;
  // Padding pushes the label text above the gesture bar.
  const TAB_PADDING_BOTTOM = Math.max(insets.bottom, Platform.OS === "ios" ? 4 : 8);

  const onNewAlerts = useCallback((count: number) => {
    if (count > 0) {
      qc.invalidateQueries({ queryKey: getGetAlertsQueryKey() });
    }
  }, [qc]);

  useNotifications(onNewAlerts);

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }
  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <ApiStatusBanner health={apiHealth} />
    <Tabs
      screenOptions={{
        tabBarActiveTintColor:   colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.tabBar,
          borderTopWidth: 1,
          borderTopColor: colors.tabBarBorder,
          elevation: 0,
          height: TAB_BAR_HEIGHT,
          paddingBottom: TAB_PADDING_BOTTOM,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600", marginTop: 1 },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.tabBar }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{ title: t.dashboard, tabBarIcon: ({ color }) => <Feather name="home" size={21} color={color} /> }}
      />
      <Tabs.Screen
        name="expenses"
        options={{ title: t.moneyPage, tabBarIcon: ({ color }) => <Feather name="credit-card" size={21} color={color} /> }}
      />
      <Tabs.Screen
        name="coach"
        options={{ title: t.coach, tabBarIcon: ({ color }) => <Feather name="message-circle" size={21} color={color} /> }}
      />
      <Tabs.Screen
        name="invest"
        options={{ title: "Invest", tabBarIcon: ({ color }) => <Feather name="trending-up" size={21} color={color} /> }}
      />
      <Tabs.Screen
        name="reports"
        options={{ title: "Reports", tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={21} color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: t.profile, tabBarIcon: ({ color }) => <Feather name="user" size={21} color={color} /> }}
      />
      <Tabs.Screen name="portfolio" options={{ href: null }} />
    </Tabs>
    </View>
  );
}
