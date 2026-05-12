import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Share, Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type CategoryRow = { category: string; amount: number; pct: number; change: number };
type Report = {
  weekStart: string; weekEnd: string; generated: string;
  weeklyIncome: number; weeklyExpenses: number; netSavings: number;
  savingsRate: number; avgDailySpend: number;
  score: number; scoreTrend: number; expenseTrend: number;
  byCategory: CategoryRow[]; topCategory: string; topCategoryAmount: number;
  totalTransactions: number;
  mood: string; moodEmoji: string; moodLabel: string;
  personalizedSummary: string; keyInsight: string; actionTip: string; tipCategory: string;
};

const CAT_COLORS = ["#D4AF37", "#00C896", "#6C63FF", "#FF4D6D", "#4ECDC4", "#F59E0B", "#8B5CF6"];
const MOOD_GRADIENT: Record<string, string> = {
  great:   "#00C896",
  good:    "#D4AF37",
  neutral: "#6C63FF",
  concern: "#FF4D6D",
};

function fmt(n: number) {
  return n >= 1000 ? `QAR ${(n / 1000).toFixed(1)}k` : `QAR ${n.toFixed(0)}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function TrendBadge({ value, colors, invert = false }: { value: number; colors: any; invert?: boolean }) {
  const isGood  = invert ? value <= 0 : value >= 0;
  const color   = value === 0 ? colors.mutedForeground : isGood ? colors.success : colors.danger;
  const icon    = value === 0 ? "minus" : value > 0 ? "arrow-up" : "arrow-down";
  if (value === 0) return null;
  return (
    <View style={[styles.trendBadge, { backgroundColor: color + "18" }]}>
      <Feather name={icon as any} size={10} color={color} />
      <Text style={[styles.trendText, { color }]}>{Math.abs(value).toFixed(1)}%</Text>
    </View>
  );
}

function CategoryBar({ item, idx, maxAmt, colors }: { item: CategoryRow; idx: number; maxAmt: number; colors: any }) {
  const color = CAT_COLORS[idx % CAT_COLORS.length]!;
  const pct   = maxAmt > 0 ? (item.amount / maxAmt) * 100 : 0;
  const isUp  = item.change > 0;
  return (
    <View style={styles.catBarRow}>
      <View style={[styles.catColorDot, { backgroundColor: color }]} />
      <Text style={[styles.catBarLabel, { color: colors.foreground }]} numberOfLines={1}>{item.category}</Text>
      <View style={[styles.catBarBg, { backgroundColor: colors.accent }]}>
        <View style={[styles.catBarFill, { width: `${Math.max(pct, 1.5)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.catBarAmt, { color: colors.foreground }]}>{fmt(item.amount)}</Text>
      {item.change !== 0 && (
        <Text style={[styles.catChangeTag, { color: isUp ? colors.danger : colors.success }]}>
          {isUp ? "▲" : "▼"}{Math.abs(item.change).toFixed(0)}%
        </Text>
      )}
    </View>
  );
}

function ScoreBadge({ score, trend, colors }: { score: number; trend: number; colors: any }) {
  const color = score >= 70 ? colors.success : score >= 45 ? colors.warning : colors.danger;
  return (
    <View style={[styles.scoreBadge, { backgroundColor: color + "18", borderColor: color + "40" }]}>
      <Text style={[styles.scoreNum, { color }]}>{score}</Text>
      <View>
        <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>Score</Text>
        {trend !== 0 && (
          <Text style={[styles.scoreTrend, { color: trend > 0 ? colors.success : colors.danger }]}>
            {trend > 0 ? "↑" : "↓"} {Math.abs(trend)} pts
          </Text>
        )}
      </View>
    </View>
  );
}

function IncomeVsExpenses({ income, expenses, colors }: { income: number; expenses: number; colors: any }) {
  const max     = Math.max(income, expenses, 1);
  const incPct  = (income   / max) * 100;
  const expPct  = (expenses / max) * 100;
  return (
    <View style={styles.ivsSection}>
      <View style={styles.ivsRow}>
        <View style={[styles.ivsLabel, { backgroundColor: colors.success + "18" }]}>
          <Feather name="arrow-up-circle" size={13} color={colors.success} />
          <Text style={[styles.ivsLabelText, { color: colors.success }]}>Income</Text>
        </View>
        <View style={[styles.ivsBg, { backgroundColor: colors.accent }]}>
          <View style={[styles.ivsFill, { width: `${incPct}%`, backgroundColor: colors.success }]} />
        </View>
        <Text style={[styles.ivsAmt, { color: colors.success }]}>{fmt(income)}</Text>
      </View>
      <View style={styles.ivsRow}>
        <View style={[styles.ivsLabel, { backgroundColor: colors.danger + "18" }]}>
          <Feather name="arrow-down-circle" size={13} color={colors.danger} />
          <Text style={[styles.ivsLabelText, { color: colors.danger }]}>Spent</Text>
        </View>
        <View style={[styles.ivsBg, { backgroundColor: colors.accent }]}>
          <View style={[styles.ivsFill, { width: `${expPct}%`, backgroundColor: colors.danger }]} />
        </View>
        <Text style={[styles.ivsAmt, { color: colors.danger }]}>{fmt(expenses)}</Text>
      </View>
    </View>
  );
}

function AISummaryCard({ report, colors }: { report: Report; colors: any }) {
  const moodColor = MOOD_GRADIENT[report.mood] ?? colors.primary;
  return (
    <View style={[styles.aiCard, { backgroundColor: colors.card, borderColor: moodColor + "50", borderWidth: 1.5 }]}>
      <View style={styles.aiCardHeader}>
        <View style={[styles.aiMoodChip, { backgroundColor: moodColor + "18" }]}>
          <Text style={{ fontSize: 22 }}>{report.moodEmoji}</Text>
          <Text style={[styles.aiMoodLabel, { color: moodColor }]}>{report.moodLabel}</Text>
        </View>
        <View style={[styles.aiPoweredBadge, { backgroundColor: colors.accent }]}>
          <Feather name="zap" size={10} color={colors.primary} />
          <Text style={[styles.aiPoweredText, { color: colors.primary }]}>AI Generated</Text>
        </View>
      </View>

      <Text style={[styles.aiSummaryText, { color: colors.foreground }]}>{report.personalizedSummary}</Text>

      <View style={[styles.aiDivider, { backgroundColor: colors.border }]} />

      <View style={[styles.aiInsightBox, { backgroundColor: colors.accent }]}>
        <View style={styles.aiInsightHeader}>
          <Feather name="bar-chart-2" size={14} color={colors.primary} />
          <Text style={[styles.aiInsightTitle, { color: colors.primary }]}>Key Insight</Text>
        </View>
        <Text style={[styles.aiInsightText, { color: colors.foreground }]}>{report.keyInsight}</Text>
      </View>

      <View style={[styles.aiTipBox, { backgroundColor: moodColor + "10", borderColor: moodColor + "30", borderWidth: 1 }]}>
        <View style={styles.aiTipHeader}>
          <View style={[styles.aiTipIconWrap, { backgroundColor: moodColor + "20" }]}>
            <Feather name="target" size={14} color={moodColor} />
          </View>
          <Text style={[styles.aiTipTitle, { color: moodColor }]}>This Week's Action</Text>
        </View>
        <Text style={[styles.aiTipText, { color: colors.foreground }]}>{report.actionTip}</Text>
        {report.tipCategory && (
          <View style={[styles.aiTipCatTag, { backgroundColor: moodColor + "20" }]}>
            <Text style={[styles.aiTipCatText, { color: moodColor }]}>📌 {report.tipCategory}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function StatChip({ icon, label, value, color, sub, colors }: {
  icon: string; label: string; value: string; color: string; sub?: string; colors: any;
}) {
  return (
    <View style={[styles.statChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statChipIcon, { backgroundColor: color + "18" }]}>
        <Feather name={icon as any} size={15} color={color} />
      </View>
      <Text style={[styles.statChipVal, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statChipLabel, { color: colors.mutedForeground }]}>{label}</Text>
      {sub && <Text style={[styles.statChipSub, { color: colors.mutedForeground }]}>{sub}</Text>}
    </View>
  );
}

interface Props {
  userName?: string;
}

export default function WeeklyReport({ userName }: Props) {
  const colors = useColors();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true); setError(null);
    try {
      const data = await authFetch(`/api/report/weekly${force ? "?refresh=true" : ""}`);
      setReport(data);
    } catch (e: any) {
      setError(e.message ?? "Failed to load report");
    } finally { setLoading(false); }
  }, []);

  React.useEffect(() => { load(); }, []);

  const handleShare = useCallback(async () => {
    if (!report) return;
    const text = [
      `📊 Aurix AI Weekly Report — ${fmtDate(report.weekStart)} to ${fmtDate(report.weekEnd)}`,
      ``,
      `Income:    ${fmt(report.weeklyIncome)}`,
      `Spent:     ${fmt(report.weeklyExpenses)}`,
      `Saved:     ${fmt(Math.max(0, report.netSavings))} (${report.savingsRate.toFixed(0)}%)`,
      ``,
      `${report.moodEmoji} ${report.moodLabel}`,
      `${report.personalizedSummary}`,
      ``,
      `💡 This Week: ${report.actionTip}`,
      ``,
      `Generated by Aurix AI`,
    ].join("\n");
    try {
      await Share.share({ message: text });
    } catch { /* ignore */ }
  }, [report]);

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
          AI is analysing your week…
        </Text>
      </View>
    );
  }

  if (error || !report) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <Text style={{ fontSize: 48 }}>📋</Text>
        <Text style={[styles.errorTitle, { color: colors.foreground }]}>No report yet</Text>
        <Text style={[styles.errorSub, { color: colors.mutedForeground }]}>
          {error ?? "Add some expenses this week and your AI report will appear here every Monday."}
        </Text>
        <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={() => load(true)}>
          <Feather name="refresh-cw" size={14} color={colors.primaryForeground} />
          <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Generate Report</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const maxCatAmt = report.byCategory[0]?.amount ?? 1;
  const savingsColor = report.netSavings >= 0 ? colors.success : colors.danger;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      {/* Header */}
      <View style={styles.reportHeader}>
        <View>
          <Text style={[styles.weekRange, { color: colors.mutedForeground }]}>
            Week of {fmtDate(report.weekStart)} – {fmtDate(report.weekEnd)}
          </Text>
          <Text style={[styles.reportTitle, { color: colors.foreground }]}>Weekly Report</Text>
          <Text style={[styles.generatedAt, { color: colors.mutedForeground }]}>
            Generated {new Date(report.generated).toLocaleDateString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
        <View style={{ gap: 8, alignItems: "flex-end" }}>
          <ScoreBadge score={report.score} trend={report.scoreTrend} colors={colors} />
          <TouchableOpacity style={[styles.shareBtn, { backgroundColor: colors.accent }]} onPress={handleShare}>
            <Feather name="share" size={13} color={colors.primary} />
            <Text style={[styles.shareBtnText, { color: colors.primary }]}>Share</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* AI Summary */}
      <AISummaryCard report={report} colors={colors} />

      {/* Income vs Expenses */}
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Income vs Expenses</Text>
          <TrendBadge value={report.expenseTrend} colors={colors} invert={true} />
        </View>
        <IncomeVsExpenses income={report.weeklyIncome} expenses={report.weeklyExpenses} colors={colors} />
        <View style={[styles.netRow, { backgroundColor: savingsColor + "12", borderColor: savingsColor + "30" }]}>
          <Text style={[styles.netLabel, { color: colors.mutedForeground }]}>Net Savings</Text>
          <Text style={[styles.netValue, { color: savingsColor }]}>
            {report.netSavings >= 0 ? "+" : ""}{fmt(report.netSavings)}
          </Text>
          <View style={[styles.netRatePill, { backgroundColor: savingsColor + "20" }]}>
            <Text style={[styles.netRateText, { color: savingsColor }]}>{report.savingsRate.toFixed(0)}% rate</Text>
          </View>
        </View>
      </View>

      {/* Quick stats */}
      <View style={styles.statsRow}>
        <StatChip icon="activity"   label="Avg/Day"       value={fmt(report.avgDailySpend)}          color={colors.primary}  colors={colors} />
        <StatChip icon="hash"       label="Transactions"  value={String(report.totalTransactions)}    color={colors.chart3}   colors={colors} />
        <StatChip icon="pie-chart"  label="Top Category"  value={report.topCategory.split(" ")[0]!}  color={colors.warning}  colors={colors} sub={fmt(report.topCategoryAmount)} />
      </View>

      {/* Category breakdown */}
      {report.byCategory.length > 0 && (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Spending by Category</Text>
          <View style={{ gap: 12 }}>
            {report.byCategory.slice(0, 6).map((item, i) => (
              <CategoryBar key={item.category} item={item} idx={i} maxAmt={maxCatAmt} colors={colors} />
            ))}
          </View>
        </View>
      )}

      {/* Next week banner */}
      <View style={[styles.nextWeekCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "25" }]}>
        <Feather name="calendar" size={20} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.nextWeekTitle, { color: colors.foreground }]}>Report schedule</Text>
          <Text style={[styles.nextWeekSub, { color: colors.mutedForeground }]}>
            Your AI report refreshes every Monday morning. Pull down to regenerate at any time.
          </Text>
        </View>
      </View>

      {/* Regenerate button */}
      <TouchableOpacity style={[styles.regenBtn, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]} onPress={() => load(true)} disabled={loading}>
        <Feather name="refresh-cw" size={14} color={colors.primary} />
        <Text style={[styles.regenBtnText, { color: colors.primary }]}>Regenerate with AI</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 28 },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorTitle: { fontSize: 18, fontWeight: "700" },
  errorSub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  retryBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  retryBtnText: { fontWeight: "700", fontSize: 14 },
  reportHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  weekRange: { fontSize: 12, fontWeight: "500" },
  reportTitle: { fontSize: 24, fontWeight: "900", marginTop: 2 },
  generatedAt: { fontSize: 10, marginTop: 3 },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  shareBtnText: { fontSize: 12, fontWeight: "600" },
  scoreBadge: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1 },
  scoreNum: { fontSize: 26, fontWeight: "900" },
  scoreLabel: { fontSize: 11, fontWeight: "500" },
  scoreTrend: { fontSize: 11, fontWeight: "700" },
  trendBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20 },
  trendText: { fontSize: 11, fontWeight: "700" },
  aiCard: { borderRadius: 20, padding: 18, gap: 14 },
  aiCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  aiMoodChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  aiMoodLabel: { fontSize: 13, fontWeight: "700" },
  aiPoweredBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  aiPoweredText: { fontSize: 10, fontWeight: "700" },
  aiSummaryText: { fontSize: 14, lineHeight: 22 },
  aiDivider: { height: 1 },
  aiInsightBox: { borderRadius: 14, padding: 14, gap: 8 },
  aiInsightHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  aiInsightTitle: { fontWeight: "700", fontSize: 13 },
  aiInsightText: { fontSize: 13, lineHeight: 19 },
  aiTipBox: { borderRadius: 16, padding: 14, gap: 10 },
  aiTipHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  aiTipIconWrap: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  aiTipTitle: { fontWeight: "800", fontSize: 13 },
  aiTipText: { fontSize: 14, lineHeight: 20 },
  aiTipCatTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: "flex-start" },
  aiTipCatText: { fontSize: 11, fontWeight: "700" },
  card: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 14 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  ivsSection: { gap: 12 },
  ivsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ivsLabel: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, width: 70 },
  ivsLabelText: { fontSize: 11, fontWeight: "700" },
  ivsBg: { flex: 1, height: 10, borderRadius: 5, overflow: "hidden" },
  ivsFill: { height: "100%", borderRadius: 5 },
  ivsAmt: { fontSize: 13, fontWeight: "700", width: 70, textAlign: "right" },
  netRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 12, borderWidth: 1, gap: 8 },
  netLabel: { fontSize: 12, fontWeight: "500", flex: 1 },
  netValue: { fontSize: 18, fontWeight: "900" },
  netRatePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  netRateText: { fontSize: 11, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 10 },
  statChip: { flex: 1, borderRadius: 16, padding: 12, borderWidth: 1, gap: 5 },
  statChipIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statChipVal: { fontSize: 14, fontWeight: "800" },
  statChipLabel: { fontSize: 10, fontWeight: "500" },
  statChipSub: { fontSize: 10 },
  catBarRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  catColorDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catBarLabel: { width: 90, fontSize: 11, fontWeight: "500" },
  catBarBg: { flex: 1, height: 7, borderRadius: 4, overflow: "hidden" },
  catBarFill: { height: "100%", borderRadius: 4 },
  catBarAmt: { fontSize: 12, fontWeight: "700", width: 58, textAlign: "right" },
  catChangeTag: { fontSize: 10, fontWeight: "700", width: 30, textAlign: "right" },
  nextWeekCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 16, padding: 14, borderWidth: 1 },
  nextWeekTitle: { fontSize: 13, fontWeight: "700", marginBottom: 3 },
  nextWeekSub: { fontSize: 12, lineHeight: 18 },
  regenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 13, borderWidth: 1 },
  regenBtnText: { fontWeight: "700", fontSize: 14 },
});
