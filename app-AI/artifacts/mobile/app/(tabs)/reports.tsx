import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";
import BudgetPlanner from "@/components/BudgetPlanner";
import GoalPlanner from "@/components/GoalPlanner";
import WeeklyReport from "@/components/WeeklyReport";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function fetchReports() {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}/api/reports`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

const CHART_COLORS = ["#D4AF37", "#00C896", "#6C63FF", "#FF4D6D", "#4ECDC4", "#F59E0B", "#06B6D4", "#8B5CF6"];
type ReportTab = "analytics" | "budget" | "goals" | "weekly";

export default function ReportsScreen() {
  const colors = useColors();
  const [activeTab, setActiveTab] = useState<ReportTab>("analytics");
  const tabBarPadding = useTabBarPadding();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["reports"],
    queryFn: fetchReports,
    staleTime: 60_000,
  });

  const { monthly = [], byCategory = [], summary = {} } = (data ?? {}) as {
    monthly: { label: string; expenses: number; income: number; savings: number }[];
    byCategory: { category: string; total: number; percentage: number }[];
    summary: { totalSpent30d: number; totalIncome30d: number; savings30d: number; savingsRate: number };
  };

  const totalSpent = (summary as any).totalSpent30d ?? 0;
  const totalIncome = (summary as any).totalIncome30d ?? 0;
  const savings = (summary as any).savings30d ?? 0;
  const savingsRate = (summary as any).savingsRate ?? 0;
  const savingsRateColor = savingsRate >= 20 ? colors.success : savingsRate >= 10 ? colors.warning : colors.danger;
  const maxVal = Math.max(...monthly.map(m => Math.max(m.expenses, m.income)), 1);

  const TABS: { key: ReportTab; label: string }[] = [
    { key: "analytics", label: "📊 Analytics" },
    { key: "budget",    label: "🎯 Budgets" },
    { key: "goals",     label: "🏆 Goals" },
    { key: "weekly",    label: "🤖 Weekly AI" },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>Finance</Text>
        {activeTab === "analytics" && (
          <TouchableOpacity onPress={() => refetch()} style={[styles.refreshBtn, { backgroundColor: colors.accent }]}>
            <Feather name="refresh-cw" size={15} color={colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Sub-tab row */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Text style={[styles.tabText, { color: activeTab === tab.key ? colors.primary : colors.mutedForeground }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "weekly" ? (
        <WeeklyReport />
      ) : activeTab === "budget" ? (
        <BudgetPlanner />
      ) : activeTab === "goals" ? (
        <GoalPlanner />
      ) : isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: tabBarPadding }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetch} tintColor={colors.primary} />}
        >
          {/* Summary stat cards */}
          <View style={styles.statsGrid}>
            {[
              { label: "Income (30d)",  value: `QAR ${totalIncome.toLocaleString("en", { maximumFractionDigits: 0 })}`, icon: "arrow-up-circle",   color: colors.success },
              { label: "Spent (30d)",   value: `QAR ${totalSpent.toLocaleString("en", { maximumFractionDigits: 0 })}`,  icon: "arrow-down-circle", color: colors.danger },
              { label: "Saved (30d)",   value: `QAR ${Math.abs(savings).toLocaleString("en", { maximumFractionDigits: 0 })}`, icon: "trending-up", color: savings >= 0 ? colors.success : colors.danger },
              { label: "Savings Rate",  value: `${savingsRate}%`, icon: "percent", color: savingsRateColor },
            ].map(stat => (
              <View key={stat.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.statIcon, { backgroundColor: stat.color + "20" }]}>
                  <Feather name={stat.icon as any} size={17} color={stat.color} />
                </View>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{stat.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {/* Income vs Expenses dual bars */}
          <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.chartHeader}>
              <Text style={[styles.chartTitle, { color: colors.foreground }]}>6-Month Overview</Text>
              <View style={styles.legend}>
                <View style={[styles.dot, { backgroundColor: colors.danger }]} /><Text style={[styles.legendTxt, { color: colors.mutedForeground }]}>Exp</Text>
                <View style={[styles.dot, { backgroundColor: colors.success }]} /><Text style={[styles.legendTxt, { color: colors.mutedForeground }]}>Inc</Text>
              </View>
            </View>
            <View style={styles.dualChart}>
              {monthly.map((m, i) => {
                const eh = maxVal > 0 ? (m.expenses / maxVal) * 80 : 0;
                const ih = maxVal > 0 ? (m.income / maxVal) * 80 : 0;
                return (
                  <View key={i} style={styles.dualGroup}>
                    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 80 }}>
                      <View style={[styles.bar, { height: Math.max(eh, 3), backgroundColor: colors.danger + "CC" }]} />
                      <View style={[styles.bar, { height: Math.max(ih, 3), backgroundColor: colors.success + "CC" }]} />
                    </View>
                    <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Savings trend */}
          <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.chartTitle, { color: colors.foreground }]}>Monthly Savings</Text>
            <View style={styles.savingsChart}>
              {monthly.map((m, i) => {
                const maxAbs = Math.max(...monthly.map(x => Math.abs(x.savings)), 1);
                const h = Math.max((Math.abs(m.savings) / maxAbs) * 70, 4);
                const isPos = m.savings >= 0;
                return (
                  <View key={i} style={styles.savingGroup}>
                    <Text style={[styles.savingVal, { color: isPos ? colors.success : colors.danger }]}>
                      {Math.abs(m.savings) >= 1000 ? `${(m.savings / 1000).toFixed(0)}k` : m.savings.toFixed(0)}
                    </Text>
                    <View style={[styles.savingBar, { height: h, backgroundColor: isPos ? colors.success : colors.danger }]} />
                    <Text style={[styles.barLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Category breakdown */}
          {byCategory.length > 0 && (
            <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.chartTitle, { color: colors.foreground }]}>Spending by Category (30d)</Text>
              <View style={{ gap: 12 }}>
                {byCategory.slice(0, 8).map((item, i) => (
                  <View key={item.category} style={styles.catRow}>
                    <View style={[styles.catDot, { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    <Text style={[styles.catLabel, { color: colors.foreground }]}>{item.category}</Text>
                    <View style={[styles.catBg, { backgroundColor: colors.accent }]}>
                      <View style={[styles.catFill, { width: `${Math.max(item.percentage, 2)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }]} />
                    </View>
                    <Text style={[styles.catPct, { color: colors.mutedForeground }]}>{item.percentage.toFixed(0)}%</Text>
                    <Text style={[styles.catAmt, { color: colors.foreground }]}>
                      {item.total >= 1000 ? `${(item.total / 1000).toFixed(1)}k` : item.total.toFixed(0)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Monthly table */}
          <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.chartTitle, { color: colors.foreground }]}>Monthly Breakdown (QAR)</Text>
            <View style={[styles.tableHead, { borderBottomColor: colors.border }]}>
              {["Month", "Income", "Expenses", "Savings"].map((h, i) => (
                <Text key={h} style={[styles.th, { color: colors.mutedForeground, flex: i === 0 ? 0.7 : 1 }]}>{h}</Text>
              ))}
            </View>
            {monthly.map((m, i) => (
              <View key={i} style={[styles.tableRow, { borderTopColor: colors.border }]}>
                <Text style={[styles.td, { color: colors.foreground, flex: 0.7, fontWeight: "600" }]}>{m.label}</Text>
                <Text style={[styles.td, { color: colors.success, flex: 1 }]}>{m.income >= 1000 ? `${(m.income / 1000).toFixed(1)}k` : m.income.toFixed(0)}</Text>
                <Text style={[styles.td, { color: colors.danger, flex: 1 }]}>{m.expenses >= 1000 ? `${(m.expenses / 1000).toFixed(1)}k` : m.expenses.toFixed(0)}</Text>
                <Text style={[styles.td, { color: m.savings >= 0 ? colors.success : colors.danger, flex: 1, fontWeight: "700" }]}>
                  {m.savings >= 0 ? "+" : ""}{Math.abs(m.savings) >= 1000 ? `${(m.savings / 1000).toFixed(1)}k` : m.savings.toFixed(0)}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  screenTitle: { fontSize: 22, fontWeight: "700" },
  refreshBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabText: { fontWeight: "600", fontSize: 13 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { flex: 1, minWidth: "45%", borderRadius: 16, padding: 14, borderWidth: 1, gap: 4 },
  statIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statVal: { fontSize: 15, fontWeight: "800" },
  statLabel: { fontSize: 11 },
  chartCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 14 },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chartTitle: { fontSize: 15, fontWeight: "700" },
  legend: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendTxt: { fontSize: 11 },
  dualChart: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  dualGroup: { flex: 1, alignItems: "center", gap: 6 },
  bar: { width: 10, borderRadius: 3 },
  barLabel: { fontSize: 10, fontWeight: "500" },
  savingsChart: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  savingGroup: { flex: 1, alignItems: "center", gap: 4 },
  savingVal: { fontSize: 9, fontWeight: "700" },
  savingBar: { width: "80%", borderRadius: 3 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  catDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catLabel: { width: 95, fontSize: 12, fontWeight: "500" },
  catBg: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  catFill: { height: "100%", borderRadius: 3 },
  catPct: { width: 26, fontSize: 11, textAlign: "right" },
  catAmt: { width: 40, fontSize: 12, fontWeight: "600", textAlign: "right" },
  tableHead: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1 },
  th: { fontSize: 11, fontWeight: "600", textAlign: "right" },
  tableRow: { flexDirection: "row", paddingVertical: 9, borderTopWidth: 1 },
  td: { fontSize: 13, textAlign: "right" },
});
