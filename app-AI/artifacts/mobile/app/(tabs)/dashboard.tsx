import React, { useCallback, useState, useEffect, useRef } from "react";
import { useFocusEffect } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  TouchableOpacity, ActivityIndicator, Animated,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFinancialScore, getGetFinancialScoreQueryKey,
  useGetExpenseSummary, getGetExpenseSummaryQueryKey,
  useGetGamification, getGetGamificationQueryKey,
  useGetDailyAction, getGetDailyActionQueryKey,
  useGetAlerts, getGetAlertsQueryKey,
  useAwardPoints,
} from "@workspace/api-client-react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/hooks/useCurrency";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import NotificationCenter from "@/components/NotificationCenter";
import { CurrencyRateStrip, CurrencyConverterModal } from "@/components/CurrencyConverter";

import { authFetch } from "@/lib/authFetch";

const INSIGHT_CACHE_KEY = "aurixai_daily_insight";
const INSIGHT_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

function ScoreRing({ score, size = 100, onPress }: { score: number; size?: number; onPress: () => void }) {
  const colors = useColors();
  const color = score >= 70 ? colors.success : score >= 40 ? colors.warning : colors.danger;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center",
        borderRadius: size / 2, borderWidth: 4, borderColor: color }}
    >
      <Text style={{ fontSize: size * 0.28, fontWeight: "800", color }}>{score}</Text>
      <Text style={{ fontSize: size * 0.12, color: colors.mutedForeground }}>Score</Text>
      <Text style={{ fontSize: size * 0.1, color: color + "AA", marginTop: 1 }}>tap ▾</Text>
    </TouchableOpacity>
  );
}

function StatCard({ label, value, icon, iconColor, sub }: {
  label: string; value: string; icon: string; iconColor: string; sub?: string;
}) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIcon, { backgroundColor: iconColor + "20" }]}>
        <Feather name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub && <Text style={[styles.statSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

// ── Daily AI Coach Insight ────────────────────────────────────────────────
function DailyInsightCard() {
  const colors = useColors();
  const [insight, setInsight]   = useState("");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 600, useNativeDriver: true }),
        ])
      );
      anim.start();
      return () => anim.stop();
    }
  }, [loading, dotAnim]);

  const loadInsight = useCallback(async (force = false) => {
    setLoading(true); setError(false);
    try {
      if (!force) {
        const cached = await AsyncStorage.getItem(INSIGHT_CACHE_KEY);
        if (cached) {
          const { text, ts } = JSON.parse(cached);
          if (Date.now() - ts < INSIGHT_CACHE_TTL) {
            setInsight(text); setLoading(false); return;
          }
        }
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      let data: any;
      try {
        data = await authFetch("/api/openai/quick-insight", {
          method: "POST",
          body: JSON.stringify({ prompt: "Give me ONE specific insight about my finances right now — just 2 sentences. Reference my actual QAR numbers and end with one concrete action I can take today." }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      // Backend contract: { text } (the legacy `insight` field is kept as a
      // fallback so an in-flight client during deploy still works).
      const text = (data.text ?? data.insight ?? "") as string;
      setInsight(text);
      await AsyncStorage.setItem(INSIGHT_CACHE_KEY, JSON.stringify({ text, ts: Date.now() }));
    } catch {
      setError(true);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadInsight(); }, [loadInsight]);

  return (
    <View style={[styles.insightCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
      <View style={styles.insightHeader}>
        <View style={[styles.insightIconWrap, { backgroundColor: colors.primary + "20" }]}>
          <Text style={{ fontSize: 16 }}>🤖</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.insightLabel, { color: colors.primary }]}>Today's Coach Insight</Text>
          <Text style={[styles.insightSub, { color: colors.mutedForeground }]}>Personalised to your QAR data</Text>
        </View>
        <TouchableOpacity onPress={() => loadInsight(true)} disabled={loading} style={[styles.insightRefresh, { backgroundColor: colors.primary + "15" }]}>
          <Feather name="refresh-cw" size={12} color={colors.primary} />
        </TouchableOpacity>
      </View>
      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
          <Animated.View style={{ opacity: dotAnim }}>
            <Text style={{ color: colors.primary, fontSize: 18 }}>●</Text>
          </Animated.View>
          <Text style={[styles.insightLoading, { color: colors.mutedForeground }]}>Analysing your finances…</Text>
        </View>
      ) : error ? (
        <TouchableOpacity onPress={() => loadInsight(true)}>
          <Text style={{ color: colors.danger, fontSize: 13, marginTop: 8 }}>Could not load insight — tap to retry</Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.insightText, { color: colors.foreground }]}>{insight}</Text>
      )}
    </View>
  );
}

// ── Smart Alert Banner ─────────────────────────────────────────────────────
function SmartAlertBanner({ alerts, onView }: { alerts: any[]; onView: () => void }) {
  const colors = useColors();
  const unread = alerts.filter(a => !a.isRead);
  if (unread.length === 0) return null;
  const top = unread[0];
  const isUrgent = top.type === "budget_exceeded" || top.type === "unusual_spending";
  return (
    <TouchableOpacity
      style={[styles.alertBanner, {
        backgroundColor: isUrgent ? colors.danger + "10" : colors.warning + "10",
        borderColor: isUrgent ? colors.danger + "30" : colors.warning + "30",
      }]}
      onPress={onView}
      activeOpacity={0.8}
    >
      <View style={[styles.alertIconWrap, { backgroundColor: isUrgent ? colors.danger + "20" : colors.warning + "20" }]}>
        <Feather name={isUrgent ? "alert-triangle" : "bell"} size={14} color={isUrgent ? colors.danger : colors.warning} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.alertTitle, { color: isUrgent ? colors.danger : colors.foreground }]} numberOfLines={1}>
          {top.title ?? top.message ?? "New alert"}
        </Text>
        {unread.length > 1 && (
          <Text style={[styles.alertSub, { color: colors.mutedForeground }]}>+{unread.length - 1} more alerts</Text>
        )}
      </View>
      <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

export default function DashboardScreen() {
  const colors = useColors();
  const { t, isRTL } = useLang();
  const { formatAmount, currency } = useCurrency();
  const tabBarPadding = useTabBarPadding();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showConverter, setShowConverter] = useState(false);

  const { data: score, isLoading: scoreLoading, refetch: refetchScore } = useGetFinancialScore();
  const { data: summary, isLoading: summaryLoading, refetch: refetchSummary } = useGetExpenseSummary();
  const { data: gamification } = useGetGamification();
  const { data: dailyAction } = useGetDailyAction();
  const { data: alerts } = useGetAlerts();
  const awardPoints = useAwardPoints();

  // Current month's actual logged income (separate from profile monthlyIncome setting)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const { data: incomeEntries, refetch: refetchIncome } = useQuery({
    queryKey: ["income-monthly", now.getFullYear(), now.getMonth()],
    queryFn: () => authFetch(`/api/income?limit=200`),
    staleTime: 5 * 60 * 1000,
  });

  useFocusEffect(useCallback(() => {
    refetchScore();
    refetchSummary();
    refetchIncome();
  }, [refetchScore, refetchSummary, refetchIncome]));
  const actualMonthIncome = Array.isArray(incomeEntries)
    ? incomeEntries
        .filter((e: any) => new Date(e.date) >= new Date(monthStart))
        .reduce((s: number, e: any) => s + Number(e.amount), 0)
    : 0;

  const onRefresh = useCallback(async () => {
    await Promise.all([refetchScore(), refetchSummary(), refetchIncome()]);
    awardPoints.mutate({ data: { action: "daily_login" } });
    await AsyncStorage.removeItem(INSIGHT_CACHE_KEY); // force fresh insight on manual refresh
  }, [refetchScore, refetchSummary, refetchIncome, awardPoints]);

  // Salary (monthlyIncome from profile) + any additional logged income entries this month
  const income = (user?.monthlyIncome ?? 0) + actualMonthIncome;
  const spent        = (summary as any)?.totalSpent ?? 0;
  const savings      = Math.max(0, income - spent);
  const savingsRate  = income > 0 ? Math.round((savings / income) * 100) : 0;
  const unreadAlerts = (alerts as any[])?.filter((a: any) => !a.isRead).length ?? 0;
  const isLoading    = scoreLoading || summaryLoading;
  const scoreVal     = (score as any)?.score ?? 0;
  const gradeLabel   = (score as any)?.gradeLabel ?? "";
  const grade        = (score as any)?.grade ?? "";
  const gradeColor   = ["A+","A"].includes(grade) ? colors.success
    : ["B+","B"].includes(grade) ? colors.primary
    : ["C+","C"].includes(grade) ? colors.warning : colors.danger;

  // Use the global currency hook so amounts react instantly to currency switches in Profile.
  const fmt = (n: number) => formatAmount(n, { decimals: 0 });

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarPadding }]}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Greeting */}
        <View style={[styles.header, isRTL && styles.headerRTL]}>
          <View>
            <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good day,</Text>
            <Text style={[styles.userName, { color: colors.foreground }]}>{user?.name ?? "User"} 👋</Text>
          </View>
          <TouchableOpacity
            style={[styles.bellBtn, { backgroundColor: unreadAlerts > 0 ? colors.danger : colors.accent }]}
            onPress={() => setShowNotifications(true)}
            activeOpacity={0.75}
          >
            <Feather name="bell" size={16} color={unreadAlerts > 0 ? "#fff" : colors.mutedForeground} />
            {unreadAlerts > 0 && (
              <Text style={styles.alertCount}>{unreadAlerts > 9 ? "9+" : unreadAlerts}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Smart Alert Banner */}
        {(alerts as any[])?.length > 0 && (
          <SmartAlertBanner alerts={alerts as any[]} onView={() => setShowNotifications(true)} />
        )}

        {/* Score card */}
        <View style={[styles.scoreSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.scoreLeft}>
            <ScoreRing score={scoreVal} size={90} onPress={() => setShowBreakdown(true)} />
          </View>
          <View style={styles.scoreRight}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Text style={[styles.scoreLevel, { color: colors.primary }]}>{(score as any)?.level}</Text>
              {grade && (
                <View style={[styles.gradePill, { backgroundColor: gradeColor + "18", borderColor: gradeColor + "40" }]}>
                  <Text style={[styles.gradePillText, { color: gradeColor }]}>{grade}</Text>
                </View>
              )}
            </View>
            <View style={styles.scoreStats}>
              <View>
                <Text style={[styles.scoreStat, { color: colors.foreground }]}>{gamification?.streak ?? 0}</Text>
                <Text style={[styles.scoreStatLabel, { color: colors.mutedForeground }]}>{t.streak}</Text>
              </View>
              <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
              <View>
                <Text style={[styles.scoreStat, { color: colors.foreground }]}>{gamification?.points ?? 0}</Text>
                <Text style={[styles.scoreStatLabel, { color: colors.mutedForeground }]}>{t.points}</Text>
              </View>
              <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
              <View>
                <Text style={[styles.scoreStat, { color: colors.foreground }]}>{gamification?.level ?? 1}</Text>
                <Text style={[styles.scoreStatLabel, { color: colors.mutedForeground }]}>{t.level}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.breakdownBtn, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]}
              onPress={() => setShowBreakdown(true)}
            >
              <Feather name="bar-chart-2" size={12} color={colors.primary} />
              <Text style={[styles.breakdownBtnText, { color: colors.primary }]}>See full breakdown</Text>
              <Feather name="chevron-right" size={12} color={colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard label={t.spentThisMonth} value={fmt(spent)}   icon="arrow-down-circle" iconColor={colors.danger} />
          <StatCard label={t.savedThisMonth} value={fmt(savings)} icon="arrow-up-circle"   iconColor={colors.success} sub={`${savingsRate}% rate`} />
          <StatCard label={t.monthlyIncome}  value={fmt(income)}  icon="dollar-sign"       iconColor={colors.primary} />
          <StatCard label={t.portfolioValue} value={`${currency} --`} icon="trending-up"       iconColor={colors.chart3} />
        </View>

        {/* Daily AI Coach Insight */}
        <DailyInsightCard />

        {/* Daily AI action */}
        {dailyAction && (
          <View style={[styles.actionCard, { backgroundColor: colors.accent, borderColor: colors.primary + "40" }]}>
            <View style={styles.actionHeader}>
              <Feather name="zap" size={16} color={colors.primary} />
              <Text style={[styles.actionTitle, { color: colors.primary }]}>{t.dailyAction}</Text>
            </View>
            <Text style={[styles.actionText, { color: colors.foreground }]}>{(dailyAction as any).action}</Text>
          </View>
        )}

        {/* Score improvement hint (only when score < 70) */}
        {scoreVal > 0 && scoreVal < 70 && (
          <TouchableOpacity
            style={[styles.improveHint, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}
            onPress={() => setShowBreakdown(true)}
            activeOpacity={0.75}
          >
            <View style={[styles.improveIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="trending-up" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.improveTitle, { color: colors.foreground }]}>Improve your score</Text>
              <Text style={[styles.improveSub, { color: colors.mutedForeground }]}>
                See exactly what's dragging it down and personalised tips ranked by impact
              </Text>
            </View>
            <Feather name="arrow-right" size={16} color={colors.primary} />
          </TouchableOpacity>
        )}

        {/* Currency converter widget */}
        <CurrencyRateStrip onOpenFull={() => setShowConverter(true)} />

        {/* Category breakdown */}
        {summary && (summary as any).byCategory?.length > 0 && (
          <View style={[styles.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t.breakdown}</Text>
            {((summary as any).byCategory as { category: string; total: number; percentage: number }[]).slice(0, 5).map((item, i) => (
              <View key={item.category} style={styles.categoryRow}>
                <View style={[styles.catDot, { backgroundColor: [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5][i % 5] }]} />
                <Text style={[styles.catName, { color: colors.foreground }]}>{item.category}</Text>
                <View style={styles.catRight}>
                  <Text style={[styles.catPercent, { color: colors.mutedForeground }]}>{Math.round(item.percentage)}%</Text>
                  <Text style={[styles.catAmount, { color: colors.foreground }]}>{fmt(item.total)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <ScoreBreakdown visible={showBreakdown} onClose={() => setShowBreakdown(false)} initialScore={scoreVal} />
      <NotificationCenter visible={showNotifications} onClose={() => setShowNotifications(false)} />
      <CurrencyConverterModal visible={showConverter} onClose={() => setShowConverter(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  headerRTL: { flexDirection: "row-reverse" },
  greeting: { fontSize: 13, fontWeight: "500" },
  userName: { fontSize: 22, fontWeight: "700", marginTop: 2 },
  bellBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, gap: 5 },
  alertCount: { color: "#fff", fontWeight: "700", fontSize: 12 },
  // Smart alert banner
  alertBanner: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, borderWidth: 1, gap: 10 },
  alertIconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  alertTitle: { fontSize: 13, fontWeight: "700" },
  alertSub: { fontSize: 11, marginTop: 1 },
  // Score card
  scoreSection: { borderRadius: 20, padding: 20, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 16 },
  scoreLeft: {},
  scoreRight: { flex: 1, gap: 4 },
  scoreLevel: { fontSize: 15, fontWeight: "700" },
  gradePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  gradePillText: { fontSize: 12, fontWeight: "800" },
  scoreStats: { flexDirection: "row", gap: 14, alignItems: "center" },
  scoreStat: { fontSize: 18, fontWeight: "800" },
  scoreStatLabel: { fontSize: 10, fontWeight: "500", marginTop: 2 },
  scoreDivider: { width: 1, height: 28 },
  breakdownBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, alignSelf: "flex-start", marginTop: 4 },
  breakdownBtnText: { fontSize: 11, fontWeight: "600" },
  // Stats grid
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: { flex: 1, minWidth: "45%", borderRadius: 16, padding: 16, borderWidth: 1, gap: 6 },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 12, fontWeight: "500" },
  statSub: { fontSize: 11 },
  // Daily insight card
  insightCard: { borderRadius: 18, padding: 16, borderWidth: 1 },
  insightHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  insightIconWrap: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  insightLabel: { fontSize: 13, fontWeight: "800" },
  insightSub: { fontSize: 11, marginTop: 1 },
  insightRefresh: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  insightLoading: { fontSize: 13, fontStyle: "italic" },
  insightText: { fontSize: 14, lineHeight: 22 },
  // Daily action
  actionCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  actionHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  actionTitle: { fontWeight: "700", fontSize: 13 },
  actionText: { fontSize: 14, lineHeight: 20 },
  // Improve hint
  improveHint: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 14, borderWidth: 1 },
  improveIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  improveTitle: { fontSize: 14, fontWeight: "700" },
  improveSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  // Breakdown
  breakdownCard: { borderRadius: 20, padding: 20, borderWidth: 1 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 16 },
  categoryRow: { flexDirection: "row", alignItems: "center", marginBottom: 12, gap: 10 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catName: { flex: 1, fontSize: 14 },
  catRight: { alignItems: "flex-end", gap: 2 },
  catPercent: { fontSize: 11 },
  catAmount: { fontSize: 14, fontWeight: "600" },
});
