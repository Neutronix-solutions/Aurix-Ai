import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, ActivityIndicator, Animated, LayoutAnimation,
  Platform, UIManager,
} from "react-native";
import SvgRaw, { Circle as CircleRaw, type SvgProps, type CircleProps } from "react-native-svg";

// react-native-svg 15.x exports class components whose constructor
// signatures are not valid React 19 JSX element types (TS2607/TS2786).
// Cast to function-component types so they're assignable in JSX.
const Svg = SvgRaw as unknown as React.FC<React.PropsWithChildren<SvgProps>>;
const Circle = CircleRaw as unknown as React.FC<CircleProps>;
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  return res.json();
}

type Tip  = { impact: "high" | "medium" | "quick" | "good"; action: string; saving?: string | null };
type Comp = {
  id: string; name: string; emoji: string; score: number; maxScore: number;
  pct: number; status: "excellent" | "good" | "warning" | "danger";
  headline: string; explanation: string; tips: Tip[];
};
type ScoreData = {
  score: number; level: string; grade: string; gradeLabel: string;
  components: Comp[];
  monthlyIncome: number; monthlySpent: number; monthlySavings: number;
  topSpendCategory: string;
};

const STATUS_COLOR = {
  excellent: "#00C896",
  good:      "#D4AF37",
  warning:   "#F59E0B",
  danger:    "#FF4D6D",
} as const;

const STATUS_LABEL = {
  excellent: "Excellent",
  good:      "Good",
  warning:   "Needs Attention",
  danger:    "Critical",
} as const;

const IMPACT_CONFIG = {
  high:   { label: "High Impact",   color: "#FF4D6D", icon: "zap"      as const },
  medium: { label: "Medium Impact", color: "#F59E0B", icon: "arrow-up" as const },
  quick:  { label: "Quick Win",     color: "#00C896", icon: "check"    as const },
  good:   { label: "Keep Going",    color: "#D4AF37", icon: "star"     as const },
} as const;

function BigRing({ score, size = 130, colors }: { score: number; size?: number; colors: any }) {
  const center = size / 2;
  const radius = center - 10;
  const circ   = 2 * Math.PI * radius;
  const offset = circ * (1 - score / 100);
  const color  = score >= 70 ? colors.success : score >= 45 ? colors.warning : colors.danger;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={center} cy={center} r={radius} stroke={color + "25"} strokeWidth={10} fill="none" />
        <Circle cx={center} cy={center} r={radius} stroke={color} strokeWidth={10} fill="none"
          strokeDasharray={`${circ} ${circ}`} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      <Text style={{ fontSize: 38, fontWeight: "900", color }}>{score}</Text>
      <Text style={{ fontSize: 11, color: colors.mutedForeground, fontWeight: "600" }}>/ 100</Text>
    </View>
  );
}

function MiniBar({ pct, color, colors }: { pct: number; color: string; colors: any }) {
  return (
    <View style={[styles.miniBarBg, { backgroundColor: colors.accent }]}>
      <View style={[styles.miniBarFill, { width: `${Math.round(Math.min(pct, 1) * 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

function ComponentCard({ comp, colors, defaultOpen = false }: { comp: Comp; colors: any; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const color = STATUS_COLOR[comp.status];
  const pct   = comp.maxScore > 0 ? comp.score / comp.maxScore : 0;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen(v => !v);
  };

  return (
    <View style={[styles.compCard, { backgroundColor: colors.card, borderColor: open ? color + "60" : colors.border }]}>
      <TouchableOpacity style={styles.compHeader} onPress={toggle} activeOpacity={0.7}>
        <View style={[styles.compEmojiWrap, { backgroundColor: color + "18" }]}>
          <Text style={{ fontSize: 20 }}>{comp.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[styles.compName, { color: colors.foreground }]}>{comp.name}</Text>
            <View style={styles.scoreChip}>
              <Text style={[styles.scoreChipText, { color }]}>{comp.score}</Text>
              <Text style={[styles.scoreChipMax, { color: colors.mutedForeground }]}>/{comp.maxScore}</Text>
            </View>
          </View>
          <MiniBar pct={pct} color={color} colors={colors} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={[styles.statusPill, { backgroundColor: color + "18" }]}>
              <View style={[styles.statusDot, { backgroundColor: color }]} />
              <Text style={[styles.statusPillText, { color }]}>{STATUS_LABEL[comp.status]}</Text>
            </View>
            <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
          </View>
        </View>
      </TouchableOpacity>

      {open && (
        <View style={[styles.compBody, { borderTopColor: colors.border }]}>
          <View style={[styles.headlineRow, { backgroundColor: color + "10" }]}>
            <Feather name="info" size={13} color={color} />
            <Text style={[styles.headlineText, { color: colors.foreground }]}>{comp.headline}</Text>
          </View>
          <Text style={[styles.explanation, { color: colors.mutedForeground }]}>{comp.explanation}</Text>

          {comp.tips.length > 0 && (
            <>
              <Text style={[styles.tipsTitle, { color: colors.foreground }]}>Actionable Tips</Text>
              {comp.tips.map((tip, i) => {
                const cfg = IMPACT_CONFIG[tip.impact] ?? IMPACT_CONFIG.quick;
                return (
                  <View key={i} style={[styles.tipRow, { backgroundColor: cfg.color + "0D", borderColor: cfg.color + "25" }]}>
                    <View style={[styles.tipBadge, { backgroundColor: cfg.color + "22" }]}>
                      <Feather name={cfg.icon} size={11} color={cfg.color} />
                      <Text style={[styles.tipBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                    <Text style={[styles.tipAction, { color: colors.foreground }]}>{tip.action}</Text>
                    {tip.saving && (
                      <View style={[styles.savingTag, { backgroundColor: colors.success + "18" }]}>
                        <Text style={[styles.savingText, { color: colors.success }]}>💰 {tip.saving}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}
    </View>
  );
}

function GradeTag({ grade, label, colors }: { grade: string; label: string; colors: any }) {
  const color = ["A+", "A"].includes(grade) ? colors.success
    : ["B+", "B"].includes(grade) ? colors.primary
    : ["C+", "C"].includes(grade) ? colors.warning
    : colors.danger;
  return (
    <View style={[styles.gradeTag, { backgroundColor: color + "18", borderColor: color + "40" }]}>
      <Text style={[styles.gradeLetter, { color }]}>{grade}</Text>
      <Text style={[styles.gradeLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  initialScore?: number;
}

export default function ScoreBreakdown({ visible, onClose, initialScore }: Props) {
  const colors = useColors();
  const [data, setData]     = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await authFetch("/api/score");
      setData(d);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleShow = useCallback(() => { setData(null); load(); }, [load]);

  const scoreColor = data
    ? data.score >= 70 ? colors.success : data.score >= 45 ? colors.warning : colors.danger
    : colors.primary;

  // Sort components: worst first so user sees what to fix
  const sorted = data?.components ? [...data.components].sort((a, b) => (a.pct - b.pct)) : [];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onShow={handleShow}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Score Breakdown</Text>
          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.accent }]} onPress={onClose}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={{ color: colors.mutedForeground }}>Analyzing your finances…</Text>
          </View>
        ) : data ? (
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 60 }}>
            {/* Hero score section */}
            <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <BigRing score={data.score} colors={colors} />
              <View style={{ alignItems: "center", gap: 8 }}>
                <GradeTag grade={data.grade} label={data.gradeLabel} colors={colors} />
                <Text style={[styles.levelText, { color: colors.primary }]}>{data.level}</Text>
                <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
                  Based on spending, savings, investments and habits
                </Text>
              </View>

              {/* Quick stats strip */}
              <View style={[styles.stripRow, { borderTopColor: colors.border }]}>
                {[
                  { label: "Income",  value: data.monthlyIncome > 0 ? `QAR ${data.monthlyIncome.toLocaleString("en", { maximumFractionDigits: 0 })}` : "—", color: colors.primary },
                  { label: "Spent",   value: `QAR ${data.monthlySpent.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.danger },
                  { label: "Saved",   value: `QAR ${data.monthlySavings.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.success },
                ].map(s => (
                  <View key={s.label} style={styles.stripItem}>
                    <Text style={[styles.stripValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={[styles.stripLabel, { color: colors.mutedForeground }]}>{s.label}/mo</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Score components — worst first */}
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              What's affecting your score
            </Text>
            <Text style={[styles.sectionSub, { color: colors.mutedForeground }]}>
              Tap any category to see the explanation and tips. Sorted by what needs work most.
            </Text>

            {sorted.map((comp, i) => (
              <ComponentCard key={comp.id} comp={comp} colors={colors} defaultOpen={i === 0} />
            ))}

            {/* Score improvement callout */}
            <View style={[styles.calloutCard, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
              <Feather name="trending-up" size={20} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.calloutTitle, { color: colors.foreground }]}>
                  How to improve fastest
                </Text>
                <Text style={[styles.calloutText, { color: colors.mutedForeground }]}>
                  Focus on the top two red/amber categories above. Each 5% improvement in savings rate adds ~1.25 points. Adding a portfolio holding adds up to 5 points.
                </Text>
              </View>
            </View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
            <Text style={{ fontSize: 48 }}>📊</Text>
            <Text style={{ color: colors.mutedForeground }}>Could not load score data.</Text>
            <TouchableOpacity style={[styles.retryBtn, { backgroundColor: colors.primary }]} onPress={load}>
              <Text style={{ color: colors.primaryForeground, fontWeight: "700" }}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  closeBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  heroCard: { borderRadius: 24, padding: 24, borderWidth: 1, alignItems: "center", gap: 12 },
  gradeTag: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  gradeLetter: { fontSize: 22, fontWeight: "900" },
  gradeLabel: { fontSize: 13, fontWeight: "600" },
  levelText: { fontSize: 17, fontWeight: "700" },
  heroSub: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  stripRow: { flexDirection: "row", width: "100%", borderTopWidth: 1, paddingTop: 14, marginTop: 4 },
  stripItem: { flex: 1, alignItems: "center", gap: 3 },
  stripValue: { fontSize: 15, fontWeight: "800" },
  stripLabel: { fontSize: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  sectionSub: { fontSize: 12, lineHeight: 18, marginTop: -10 },
  compCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  compHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16 },
  compEmojiWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  compName: { fontSize: 15, fontWeight: "700" },
  scoreChip: { flexDirection: "row", alignItems: "baseline", gap: 1 },
  scoreChipText: { fontSize: 20, fontWeight: "900" },
  scoreChipMax: { fontSize: 12 },
  miniBarBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  miniBarFill: { height: "100%", borderRadius: 3 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: "600" },
  compBody: { borderTopWidth: 1, padding: 16, gap: 12 },
  headlineRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, padding: 10 },
  headlineText: { flex: 1, fontSize: 13, fontWeight: "600", lineHeight: 18 },
  explanation: { fontSize: 13, lineHeight: 20 },
  tipsTitle: { fontSize: 13, fontWeight: "700", marginBottom: -4 },
  tipRow: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  tipBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: "flex-start" },
  tipBadgeText: { fontSize: 10, fontWeight: "700" },
  tipAction: { fontSize: 13, lineHeight: 18 },
  savingTag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, alignSelf: "flex-start" },
  savingText: { fontSize: 11, fontWeight: "700" },
  calloutCard: { flexDirection: "row", gap: 14, borderRadius: 16, padding: 16, borderWidth: 1, alignItems: "flex-start" },
  calloutTitle: { fontSize: 14, fontWeight: "700", marginBottom: 6 },
  calloutText: { fontSize: 12, lineHeight: 18 },
  retryBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
});
