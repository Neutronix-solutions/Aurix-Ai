import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform,
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

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string, opts: RequestInit = {}) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  return res;
}

type Goal = {
  id: number; name: string; targetAmount: number; currentAmount: number;
  remaining: number; progress: number; monthsToGoal: number | null;
  completionDate: string | null; deadline?: string | null;
  monthlySavings?: number;
};

const GOAL_PRESETS = [
  { emoji: "🚗", label: "Car" },
  { emoji: "🏠", label: "Home" },
  { emoji: "✈️", label: "Vacation" },
  { emoji: "📚", label: "Education" },
  { emoji: "💍", label: "Wedding" },
  { emoji: "📱", label: "Gadget" },
  { emoji: "🏥", label: "Emergency" },
  { emoji: "🎯", label: "Custom" },
];

function ProgressRing({ progress, size = 96, strokeWidth = 10, color, backgroundColor, children }: {
  progress: number; size?: number; strokeWidth?: number;
  color: string; backgroundColor: string; children?: React.ReactNode;
}) {
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(Math.max(progress, 0), 1));
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={center} cy={center} r={radius} stroke={backgroundColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={center} cy={center} r={radius}
          stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      <View style={{ alignItems: "center", justifyContent: "center" }}>{children}</View>
    </View>
  );
}

function GoalCard({ goal, onContribute, onDelete, onEdit, colors }: {
  goal: Goal; onContribute: () => void; onDelete: () => void; onEdit: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const pct = goal.progress;
  const isComplete = pct >= 1;
  const ringColor = isComplete ? colors.success : pct >= 0.75 ? colors.warning : colors.primary;

  const timelineText = () => {
    if (isComplete) return "🎉 Goal reached!";
    if (!goal.monthsToGoal) return "Set income to see timeline";
    if (goal.monthsToGoal <= 1) return "< 1 month away!";
    if (goal.monthsToGoal > 120) return "120+ months (increase savings)";
    if (goal.completionDate) {
      const d = new Date(goal.completionDate);
      return `${d.toLocaleString("en", { month: "short", year: "numeric" })} · ${goal.monthsToGoal} months`;
    }
    return `${goal.monthsToGoal} months`;
  };

  return (
    <View style={[styles.goalCard, { backgroundColor: colors.card, borderColor: isComplete ? colors.success + "60" : colors.border }]}>
      <View style={styles.goalCardInner}>
        <ProgressRing progress={pct} size={88} strokeWidth={9} color={ringColor} backgroundColor={colors.accent}>
          <Text style={{ fontSize: 24 }}>{goal.name.match(/^\p{Emoji}/u)?.[0] ?? "🎯"}</Text>
          <Text style={{ fontSize: 11, fontWeight: "800", color: ringColor }}>{Math.round(pct * 100)}%</Text>
        </ProgressRing>

        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <Text style={[styles.goalName, { color: colors.foreground }]} numberOfLines={2}>
              {goal.name.replace(/^\p{Emoji}\s*/u, "")}
            </Text>
            <View style={{ flexDirection: "row", gap: 4 }}>
              <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.accent }]} onPress={onEdit}>
                <Feather name="edit-2" size={12} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.accent }]} onPress={onDelete}>
                <Feather name="trash-2" size={12} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.amountRow}>
            <Text style={[styles.currentAmt, { color: isComplete ? colors.success : colors.primary }]}>
              QAR {goal.currentAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
            </Text>
            <Text style={[styles.targetAmt, { color: colors.mutedForeground }]}>
              {" "}/ {goal.targetAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
            </Text>
          </View>

          <View style={[styles.timelineRow, { backgroundColor: colors.accent }]}>
            <Feather name={isComplete ? "check-circle" : "clock"} size={11} color={isComplete ? colors.success : colors.mutedForeground} />
            <Text style={[styles.timelineText, { color: isComplete ? colors.success : colors.mutedForeground }]} numberOfLines={1}>
              {timelineText()}
            </Text>
          </View>

          {!isComplete && (
            <TouchableOpacity style={[styles.contributeBtn, { backgroundColor: colors.primary }]} onPress={onContribute}>
              <Feather name="plus" size={13} color={colors.primaryForeground} />
              <Text style={[styles.contributeBtnText, { color: colors.primaryForeground }]}>Add Savings</Text>
            </TouchableOpacity>
          )}
          {isComplete && (
            <View style={[styles.completeBadge, { backgroundColor: colors.success + "20" }]}>
              <Text style={{ color: colors.success, fontSize: 12, fontWeight: "700" }}>🎉 Completed!</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

export default function GoalPlanner() {
  const colors = useColors();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [monthlySavings, setMonthlySavings] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showContribute, setShowContribute] = useState<Goal | null>(null);
  const [showEdit, setShowEdit] = useState<Goal | null>(null);
  const [saving, setSaving] = useState(false);

  // Add form
  const [selectedPreset, setSelectedPreset] = useState(GOAL_PRESETS[0]);
  const [goalName, setGoalName] = useState("");
  const [targetAmt, setTargetAmt] = useState("");
  const [currentAmt, setCurrentAmt] = useState("");
  const [contributeAmt, setContributeAmt] = useState("");
  const [editName, setEditName] = useState("");
  const [editTarget, setEditTarget] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/goals");
      if (res.ok) {
        const d = await res.json();
        setGoals(Array.isArray(d.goals) ? d.goals : []);
        setMonthlySavings(d.monthlySavings ?? 0);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, []);

  const handleAddGoal = useCallback(async () => {
    const tAmt = parseFloat(targetAmt);
    const cAmt = parseFloat(currentAmt) || 0;
    if (!goalName.trim() || isNaN(tAmt) || tAmt <= 0) {
      Alert.alert("Error", "Enter a goal name and target amount"); return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/goals", {
        method: "POST",
        body: JSON.stringify({ name: goalName.trim(), targetAmount: tAmt, currentAmount: cAmt, emoji: selectedPreset.emoji }),
      });
      if (!res.ok) throw new Error("Failed");
      const created: Goal = await res.json();
      setGoals(prev => [...prev, created]);
      setShowAdd(false);
      setGoalName(""); setTargetAmt(""); setCurrentAmt("");
    } catch { Alert.alert("Error", "Could not create goal"); }
    finally { setSaving(false); }
  }, [goalName, targetAmt, currentAmt, selectedPreset]);

  const handleContribute = useCallback(async () => {
    if (!showContribute) return;
    const amt = parseFloat(contributeAmt);
    if (isNaN(amt) || amt <= 0) { Alert.alert("Error", "Enter valid amount"); return; }
    setSaving(true);
    try {
      const res = await authFetch(`/api/goals/${showContribute.id}/contribute`, {
        method: "PATCH",
        body: JSON.stringify({ amount: amt }),
      });
      if (!res.ok) throw new Error("Failed");
      const updated: Goal = await res.json();
      setGoals(prev => prev.map(g => g.id === updated.id ? { ...g, ...updated } : g));
      setShowContribute(null);
      setContributeAmt("");
      load(); // reload to get fresh timeline
    } catch { Alert.alert("Error", "Could not add contribution"); }
    finally { setSaving(false); }
  }, [showContribute, contributeAmt]);

  const handleEdit = useCallback(async () => {
    if (!showEdit) return;
    const tAmt = parseFloat(editTarget);
    if (!editName.trim() || isNaN(tAmt) || tAmt <= 0) {
      Alert.alert("Error", "Enter name and target"); return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/goals/${showEdit.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: editName.trim(), targetAmount: tAmt }),
      });
      if (!res.ok) throw new Error("Failed");
      setShowEdit(null);
      load();
    } catch { Alert.alert("Error", "Could not update goal"); }
    finally { setSaving(false); }
  }, [showEdit, editName, editTarget]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Delete Goal", "Remove this savings goal?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          await authFetch(`/api/goals/${id}`, { method: "DELETE" });
          setGoals(prev => prev.filter(g => g.id !== id));
        },
      },
    ]);
  }, []);

  const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
  const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const completedCount = goals.filter(g => g.progress >= 1).length;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.plannerHeader}>
        <View>
          <Text style={[styles.plannerTitle, { color: colors.foreground }]}>Savings Goals</Text>
          {monthlySavings > 0 && (
            <Text style={[styles.savingsRate, { color: colors.success }]}>
              Saving QAR {monthlySavings.toLocaleString("en", { maximumFractionDigits: 0 })}/mo
            </Text>
          )}
        </View>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAdd(true)}>
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBtnText, { color: colors.primaryForeground }]}>New Goal</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 40 }} />
      ) : goals.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={{ fontSize: 56 }}>🎯</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No savings goals yet</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Set a target and track how long it'll take based on your monthly savings.
          </Text>
          <TouchableOpacity style={[styles.emptyBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAdd(true)}>
            <Text style={[styles.emptyBtnText, { color: colors.primaryForeground }]}>Create First Goal</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}>
          {/* Summary */}
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryRow}>
              {[
                { label: "Total Target", value: `QAR ${totalTarget.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.foreground },
                { label: "Total Saved", value: `QAR ${totalSaved.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.primary },
                { label: "Remaining", value: `QAR ${(totalTarget - totalSaved).toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.mutedForeground },
                { label: "Completed", value: `${completedCount}/${goals.length}`, color: colors.success },
              ].map(item => (
                <View key={item.label} style={{ alignItems: "center", flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: item.color }}>{item.value}</Text>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 2 }}>{item.label}</Text>
                </View>
              ))}
            </View>
          </View>
          {goals.map(g => (
            <GoalCard key={g.id} goal={g} colors={colors}
              onContribute={() => { setShowContribute(g); setContributeAmt(""); }}
              onDelete={() => handleDelete(g.id)}
              onEdit={() => { setShowEdit(g); setEditName(g.name.replace(/^\p{Emoji}\s*/u, "")); setEditTarget(String(g.targetAmount)); }}
            />
          ))}
        </ScrollView>
      )}

      {/* Add Goal Modal */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <ScrollView style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>New Savings Goal</Text>
                <TouchableOpacity onPress={() => setShowAdd(false)}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                  {GOAL_PRESETS.map(preset => (
                    <TouchableOpacity
                      key={preset.label}
                      style={[styles.presetChip, {
                        backgroundColor: selectedPreset.label === preset.label ? colors.primary : colors.accent,
                        borderColor: selectedPreset.label === preset.label ? colors.primary : colors.border,
                      }]}
                      onPress={() => setSelectedPreset(preset)}
                    >
                      <Text style={{ fontSize: 18 }}>{preset.emoji}</Text>
                      <Text style={{
                        color: selectedPreset.label === preset.label ? colors.primaryForeground : colors.mutedForeground,
                        fontSize: 11, fontWeight: "600",
                      }}>{preset.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Goal Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                value={goalName} onChangeText={setGoalName}
                placeholder={`e.g. My ${selectedPreset.label}`}
                placeholderTextColor={colors.mutedForeground}
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Target Amount (QAR)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground, fontSize: 22, fontWeight: "700", textAlign: "center" }]}
                value={targetAmt} onChangeText={setTargetAmt}
                keyboardType="numeric" placeholder="20,000"
                placeholderTextColor={colors.mutedForeground}
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Already Saved (QAR) — optional</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                value={currentAmt} onChangeText={setCurrentAmt}
                keyboardType="numeric" placeholder="0"
                placeholderTextColor={colors.mutedForeground}
              />

              {monthlySavings > 0 && targetAmt && !isNaN(parseFloat(targetAmt)) && (
                <View style={[styles.previewBox, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>
                    At your current savings rate of QAR {monthlySavings.toFixed(0)}/mo:
                  </Text>
                  <Text style={[styles.previewValue, { color: colors.primary }]}>
                    {Math.ceil(Math.max(0, parseFloat(targetAmt) - (parseFloat(currentAmt) || 0)) / monthlySavings)} months to reach this goal
                  </Text>
                </View>
              )}

              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={handleAddGoal} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.primaryForeground} /> : (
                  <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>{selectedPreset.emoji} Create Goal</Text>
                )}
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Contribute Modal */}
      <Modal visible={!!showContribute} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Savings</Text>
                <TouchableOpacity onPress={() => setShowContribute(null)}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <View style={[styles.goalPreview, { backgroundColor: colors.accent }]}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{showContribute?.name ?? ""}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  QAR {showContribute?.currentAmount.toFixed(0)} / {showContribute?.targetAmount.toFixed(0)} saved
                </Text>
              </View>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Amount to add (QAR)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground, fontSize: 26, fontWeight: "800", textAlign: "center" }]}
                value={contributeAmt} onChangeText={setContributeAmt}
                keyboardType="numeric" placeholder="500"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
              />
              {showContribute && contributeAmt && !isNaN(parseFloat(contributeAmt)) && (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: "center", marginBottom: 8 }}>
                  New total: QAR {Math.min(showContribute.currentAmount + parseFloat(contributeAmt), showContribute.targetAmount).toFixed(0)}
                  {" "}({Math.min(100, Math.round(((showContribute.currentAmount + parseFloat(contributeAmt)) / showContribute.targetAmount) * 100))}%)
                </Text>
              )}
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.success }]} onPress={handleContribute} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.successForeground} /> : (
                  <Text style={[styles.saveBtnText, { color: colors.successForeground }]}>💰 Add to Goal</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={!!showEdit} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit Goal</Text>
                <TouchableOpacity onPress={() => setShowEdit(null)}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Goal Name</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                value={editName} onChangeText={setEditName}
                placeholderTextColor={colors.mutedForeground}
              />
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Target Amount (QAR)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground, fontSize: 22, fontWeight: "700", textAlign: "center" }]}
                value={editTarget} onChangeText={setEditTarget}
                keyboardType="numeric" placeholderTextColor={colors.mutedForeground}
              />
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={handleEdit} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.primaryForeground} /> : (
                  <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  plannerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14 },
  plannerTitle: { fontSize: 18, fontWeight: "700" },
  savingsRate: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { fontWeight: "600", fontSize: 13 },
  emptyState: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  emptyBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 8 },
  emptyBtnText: { fontWeight: "700", fontSize: 16 },
  summaryCard: { borderRadius: 18, padding: 16, borderWidth: 1 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  goalCard: { borderRadius: 20, borderWidth: 1, padding: 16 },
  goalCardInner: { flexDirection: "row", gap: 14, alignItems: "flex-start" },
  goalName: { fontSize: 15, fontWeight: "700", flex: 1, lineHeight: 20 },
  iconBtn: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  amountRow: { flexDirection: "row", alignItems: "baseline" },
  currentAmt: { fontSize: 18, fontWeight: "800" },
  targetAmt: { fontSize: 13 },
  timelineRow: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start" },
  timelineText: { fontSize: 11, fontWeight: "500" },
  contributeBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, alignSelf: "flex-start", marginTop: 2 },
  contributeBtnText: { fontSize: 12, fontWeight: "700" },
  completeBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, alignSelf: "flex-start", marginTop: 2 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, gap: 8, maxHeight: "90%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 12 },
  previewBox: { borderRadius: 12, padding: 14, marginBottom: 12, gap: 4 },
  previewLabel: { fontSize: 12 },
  previewValue: { fontSize: 15, fontWeight: "700" },
  goalPreview: { borderRadius: 12, padding: 12, marginBottom: 12, gap: 3 },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontWeight: "700", fontSize: 16 },
});
