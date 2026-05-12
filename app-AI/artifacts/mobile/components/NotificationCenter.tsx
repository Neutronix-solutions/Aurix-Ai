import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, ActivityIndicator, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAlerts, getGetAlertsQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string, opts: RequestInit = {}) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  if (res.status === 204) return null;
  return res.json();
}

type AlertItem = {
  id: number; userId: number; message: string;
  type: string | null; isRead: boolean | null; createdAt: string;
};

type AlertConfig = {
  icon: any; color: string; bg: string; label: string;
};

function getAlertConfig(type: string | null, colors: any): AlertConfig {
  switch (type) {
    case "market":
      return { icon: "trending-up", color: colors.primary,  bg: colors.primary  + "18", label: "Market Alert"  };
    case "budget":
      return { icon: "alert-octagon", color: colors.danger, bg: colors.danger   + "18", label: "Budget Exceeded" };
    case "budget_warning":
      return { icon: "alert-triangle", color: colors.warning, bg: colors.warning + "18", label: "Budget Warning" };
    case "spending_alert":
      return { icon: "credit-card", color: colors.danger,   bg: colors.danger   + "18", label: "Spending Alert" };
    default:
      return { icon: "bell", color: colors.mutedForeground, bg: colors.accent,           label: "Notification"  };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function parseAlert(raw: AlertItem) {
  const lines = (raw.message ?? "").split("\n");
  return { title: lines[0] ?? "", body: lines.slice(1).join("\n") };
}

function AlertRow({ item, onRead, onDelete, colors }: {
  item: AlertItem; onRead: () => void; onDelete: () => void; colors: any;
}) {
  const cfg = getAlertConfig(item.type, colors);
  const { title, body } = parseAlert(item);
  const isUnread = !item.isRead;

  return (
    <TouchableOpacity
      style={[styles.alertRow, { backgroundColor: colors.card, borderColor: isUnread ? cfg.color + "50" : colors.border, borderWidth: isUnread ? 1.5 : 1 }]}
      onPress={onRead} activeOpacity={0.75}
    >
      <View style={[styles.alertIcon, { backgroundColor: cfg.bg }]}>
        <Feather name={cfg.icon} size={18} color={cfg.color} />
        {isUnread && <View style={[styles.unreadDot, { backgroundColor: cfg.color }]} />}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.alertRowTop}>
          <Text style={[styles.alertTitle, { color: colors.foreground, fontWeight: isUnread ? "700" : "500" }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.alertTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
        </View>
        {body ? (
          <Text style={[styles.alertBody, { color: colors.mutedForeground }]} numberOfLines={2}>{body}</Text>
        ) : null}
        <View style={[styles.alertTypePill, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.alertTypeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Feather name="x" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function EmptyState({ colors }: { colors: any }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.accent }]}>
        <Feather name="bell-off" size={32} color={colors.mutedForeground} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All clear!</Text>
      <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
        You'll get notified when a Qatar stock moves 2%+ or you approach a budget limit.
      </Text>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function NotificationCenter({ visible, onClose }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetAlerts();
  const [clearing, setClearing] = useState(false);

  const alertList = (data as AlertItem[] | undefined) ?? [];
  const unreadCount = alertList.filter(a => !a.isRead).length;

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetAlertsQueryKey() });
  }, [queryClient]);

  const handleRead = useCallback(async (id: number) => {
    await authFetch(`/api/alerts/${id}/read`, { method: "PUT" });
    invalidate();
  }, [invalidate]);

  const handleDelete = useCallback(async (id: number) => {
    await authFetch(`/api/alerts/${id}`, { method: "DELETE" });
    invalidate();
  }, [invalidate]);

  const handleReadAll = useCallback(async () => {
    await authFetch("/api/alerts/read-all", { method: "PUT" });
    invalidate();
  }, [invalidate]);

  const handleClearAll = useCallback(() => {
    Alert.alert("Clear All", "Remove all notifications?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear All", style: "destructive",
        onPress: async () => {
          setClearing(true);
          await authFetch("/api/alerts", { method: "DELETE" });
          invalidate();
          setClearing(false);
        },
      },
    ]);
  }, [invalidate]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onShow={() => refetch()}>
      <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]} edges={["top"]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Notifications</Text>
            {unreadCount > 0 && (
              <Text style={[styles.headerSub, { color: colors.primary }]}>{unreadCount} unread</Text>
            )}
          </View>
          <View style={styles.headerBtns}>
            {unreadCount > 0 && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.primary + "18" }]} onPress={handleReadAll}>
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text style={[styles.actionBtnText, { color: colors.primary }]}>Read all</Text>
              </TouchableOpacity>
            )}
            {alertList.length > 0 && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.danger + "18" }]} onPress={handleClearAll} disabled={clearing}>
                {clearing ? <ActivityIndicator size="small" color={colors.danger} /> : <>
                  <Feather name="trash-2" size={14} color={colors.danger} />
                  <Text style={[styles.actionBtnText, { color: colors.danger }]}>Clear</Text>
                </>}
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.accent }]} onPress={onClose}>
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Alert type legend */}
        {alertList.length > 0 && (
          <View style={[styles.legendRow, { backgroundColor: colors.accent }]}>
            {[
              { type: "market", label: "Stock move" },
              { type: "budget", label: "Budget" },
              { type: "budget_warning", label: "Warning" },
            ].map(l => {
              const cfg = getAlertConfig(l.type, colors);
              return (
                <View key={l.type} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: cfg.color }]} />
                  <Text style={[styles.legendText, { color: colors.mutedForeground }]}>{l.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {isLoading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.primary} size="large" />
          </View>
        ) : (
          <FlatList
            data={alertList}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <AlertRow
                item={item} colors={colors}
                onRead={() => handleRead(item.id)}
                onDelete={() => handleDelete(item.id)}
              />
            )}
            ListEmptyComponent={<EmptyState colors={colors} />}
            refreshing={false} onRefresh={refetch}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  headerSub: { fontSize: 12, fontWeight: "600", marginTop: 1 },
  headerBtns: { flexDirection: "row", gap: 8, alignItems: "center" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 },
  actionBtnText: { fontSize: 12, fontWeight: "700" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  legendRow: { flexDirection: "row", paddingHorizontal: 20, paddingVertical: 8, gap: 16 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: "500" },
  alertRow: { flexDirection: "row", alignItems: "flex-start", borderRadius: 16, padding: 14, gap: 12 },
  alertIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", position: "relative" },
  unreadDot: { position: "absolute", top: -2, right: -2, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: "transparent" },
  alertRowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  alertTitle: { flex: 1, fontSize: 14 },
  alertTime: { fontSize: 11 },
  alertBody: { fontSize: 12, lineHeight: 17 },
  alertTypePill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, alignSelf: "flex-start" },
  alertTypeText: { fontSize: 10, fontWeight: "700" },
  deleteBtn: { padding: 2, marginTop: 2 },
  empty: { alignItems: "center", paddingTop: 80, gap: 14, paddingHorizontal: 32 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptyBody: { fontSize: 13, textAlign: "center", lineHeight: 20 },
});
