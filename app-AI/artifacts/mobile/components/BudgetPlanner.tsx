import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string, options: RequestInit = {}) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  return res;
}

const EXPENSE_CATEGORIES = [
  { label: "Food & Dining", icon: "coffee", emoji: "🍽️" },
  { label: "Shopping", icon: "shopping-bag", emoji: "🛍️" },
  { label: "Transport", icon: "navigation", emoji: "🚗" },
  { label: "Entertainment", icon: "film", emoji: "🎬" },
  { label: "Health", icon: "heart", emoji: "💊" },
  { label: "Bills & Utilities", icon: "zap", emoji: "⚡" },
  { label: "Travel", icon: "globe", emoji: "✈️" },
  { label: "Other", icon: "more-horizontal", emoji: "📦" },
];

type Budget = {
  id: number;
  category: string;
  limitAmount: number;
  spentAmount: number;
  period: string;
};

function BudgetCard({ budget, onEdit, onDelete, colors }: {
  budget: Budget;
  onEdit: () => void;
  onDelete: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const pct = budget.limitAmount > 0 ? Math.min(budget.spentAmount / budget.limitAmount, 1) : 0;
  const remaining = budget.limitAmount - budget.spentAmount;
  const isOver = budget.spentAmount > budget.limitAmount;
  const isWarning = pct >= 0.75 && !isOver;

  const barColor = isOver ? colors.danger : isWarning ? colors.warning : colors.success;
  const catInfo = EXPENSE_CATEGORIES.find(c => c.label === budget.category);
  const pctInt = Math.round(pct * 100);

  return (
    <View style={[styles.budgetCard, { backgroundColor: colors.card, borderColor: isOver ? colors.danger + "50" : colors.border }]}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <View style={[styles.catEmoji, { backgroundColor: barColor + "18" }]}>
            <Text style={{ fontSize: 18 }}>{catInfo?.emoji ?? "📦"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.catName, { color: colors.foreground }]}>{budget.category}</Text>
            <Text style={[styles.cardPeriod, { color: colors.mutedForeground }]}>Monthly limit</Text>
          </View>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={[styles.limitText, { color: colors.foreground }]}>
            QAR {budget.limitAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
          </Text>
          <View style={styles.cardActions}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.accent }]} onPress={onEdit}>
              <Feather name="edit-2" size={12} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.accent }]} onPress={onDelete}>
              <Feather name="trash-2" size={12} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={[styles.barTrack, { backgroundColor: colors.accent }]}>
        <View style={[styles.barFill, { width: `${pctInt}%`, backgroundColor: barColor }]} />
      </View>

      <View style={styles.cardBottom}>
        <View style={styles.spentRow}>
          <Text style={[styles.spentLabel, { color: colors.mutedForeground }]}>Spent</Text>
          <Text style={[styles.spentValue, { color: isOver ? colors.danger : colors.foreground }]}>
            QAR {budget.spentAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
          </Text>
        </View>
        <View style={[styles.pctBadge, { backgroundColor: barColor + "18" }]}>
          <Text style={{ color: barColor, fontSize: 12, fontWeight: "700" }}>
            {isOver ? `+${(pct * 100 - 100).toFixed(0)}% over` : `${pctInt}% used`}
          </Text>
        </View>
        <View style={styles.spentRow}>
          <Text style={[styles.spentLabel, { color: colors.mutedForeground }]}>
            {isOver ? "Over by" : "Left"}
          </Text>
          <Text style={[styles.spentValue, { color: isOver ? colors.danger : colors.success }]}>
            QAR {Math.abs(remaining).toLocaleString("en", { maximumFractionDigits: 0 })}
          </Text>
        </View>
      </View>

      {isOver && (
        <View style={[styles.overBanner, { backgroundColor: colors.danger + "12" }]}>
          <Feather name="alert-circle" size={13} color={colors.danger} />
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: "600" }}>
            Budget exceeded by QAR {Math.abs(remaining).toFixed(0)}
          </Text>
        </View>
      )}
      {isWarning && (
        <View style={[styles.overBanner, { backgroundColor: colors.warning + "12" }]}>
          <Feather name="alert-triangle" size={13} color={colors.warning} />
          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: "600" }}>
            {100 - pctInt}% remaining — watch your spending
          </Text>
        </View>
      )}
    </View>
  );
}

function SummaryRow({ budgets, colors }: { budgets: Budget[]; colors: ReturnType<typeof useColors> }) {
  const totalLimit = budgets.reduce((s, b) => s + b.limitAmount, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.spentAmount, 0);
  const overCount = budgets.filter(b => b.spentAmount > b.limitAmount).length;
  const onTrackCount = budgets.filter(b => b.spentAmount <= b.limitAmount * 0.75).length;

  return (
    <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.summaryTitle, { color: colors.foreground }]}>Budget Overview</Text>
      <View style={styles.summaryGrid}>
        {[
          { label: "Total Budget", value: `QAR ${totalLimit.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: colors.primary },
          { label: "Total Spent", value: `QAR ${totalSpent.toLocaleString("en", { maximumFractionDigits: 0 })}`, color: totalSpent > totalLimit ? colors.danger : colors.foreground },
          { label: "On Track", value: `${onTrackCount}/${budgets.length}`, color: colors.success },
          { label: "Over Budget", value: String(overCount), color: overCount > 0 ? colors.danger : colors.success },
        ].map(item => (
          <View key={item.label} style={[styles.summaryItem, { backgroundColor: colors.accent }]}>
            <Text style={[styles.summaryItemVal, { color: item.color }]}>{item.value}</Text>
            <Text style={[styles.summaryItemLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export default function BudgetPlanner() {
  const colors = useColors();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editBudget, setEditBudget] = useState<Budget | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("Food & Dining");
  const [limitInput, setLimitInput] = useState("");
  const [saving, setSaving] = useState(false);

  const loadBudgets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/goals");
      if (res.ok) {
        const data = await res.json();
        setBudgets(Array.isArray(data.budgets) ? data.budgets : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadBudgets(); }, []);

  const handleSave = useCallback(async () => {
    const limit = parseFloat(limitInput);
    if (isNaN(limit) || limit <= 0) { Alert.alert("Error", "Enter a valid amount"); return; }
    setSaving(true);
    try {
      if (editBudget) {
        const res = await authFetch(`/api/goals/budgets/${editBudget.id}`, {
          method: "PATCH",
          body: JSON.stringify({ limitAmount: limit }),
        });
        if (!res.ok) throw new Error("Failed");
        const updated = await res.json();
        setBudgets(prev => prev.map(b => b.id === editBudget.id ? updated : b));
      } else {
        const existing = budgets.find(b => b.category === selectedCategory);
        if (existing) {
          Alert.alert("Duplicate", `A budget for "${selectedCategory}" already exists. Edit it instead.`);
          setSaving(false); return;
        }
        const res = await authFetch("/api/goals/budgets", {
          method: "POST",
          body: JSON.stringify({ category: selectedCategory, limitAmount: limit }),
        });
        if (!res.ok) throw new Error("Failed");
        const created = await res.json();
        setBudgets(prev => [...prev, created]);
      }
      setShowAdd(false);
      setEditBudget(null);
      setLimitInput("");
    } catch { Alert.alert("Error", "Could not save budget"); }
    finally { setSaving(false); }
  }, [limitInput, selectedCategory, editBudget, budgets]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Delete Budget", "Remove this budget limit?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await authFetch(`/api/goals/budgets/${id}`, { method: "DELETE" });
            setBudgets(prev => prev.filter(b => b.id !== id));
          } catch { Alert.alert("Error", "Could not delete budget"); }
        },
      },
    ]);
  }, []);

  const openEdit = useCallback((b: Budget) => {
    setEditBudget(b);
    setLimitInput(String(b.limitAmount));
    setShowAdd(true);
  }, []);

  const openAdd = useCallback(() => {
    setEditBudget(null);
    setLimitInput("");
    setSelectedCategory(
      EXPENSE_CATEGORIES.find(c => !budgets.some(b => b.category === c.label))?.label ?? "Other"
    );
    setShowAdd(true);
  }, [budgets]);

  const usedCategories = new Set(budgets.map(b => b.category));
  const availableCategories = EXPENSE_CATEGORIES.filter(c => !usedCategories.has(c.label) || editBudget?.category === c.label);

  return (
    <View style={{ flex: 1, backgroundColor: "transparent" }}>
      <View style={styles.plannerHeader}>
        <Text style={[styles.plannerTitle, { color: colors.foreground }]}>Budget Planner</Text>
        <TouchableOpacity
          style={[styles.addBudgetBtn, { backgroundColor: colors.primary }]}
          onPress={openAdd}
          disabled={availableCategories.length === 0}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground} />
          <Text style={[styles.addBudgetText, { color: colors.primaryForeground }]}>Set Budget</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} size="large" />
      ) : budgets.length === 0 ? (
        <View style={styles.emptyBudget}>
          <Text style={{ fontSize: 50, marginBottom: 8 }}>🎯</Text>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No budgets yet</Text>
          <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
            Set monthly spending limits per category and track how close you are to overspending.
          </Text>
          <TouchableOpacity style={[styles.emptyAddBtn, { backgroundColor: colors.primary }]} onPress={openAdd}>
            <Text style={[styles.emptyAddText, { color: colors.primaryForeground }]}>Create First Budget</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ gap: 12, padding: 16, paddingBottom: 120 }}>
          <SummaryRow budgets={budgets} colors={colors} />
          {budgets.map(b => (
            <BudgetCard
              key={b.id} budget={b} colors={colors}
              onEdit={() => openEdit(b)}
              onDelete={() => handleDelete(b.id)}
            />
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  {editBudget ? `Edit — ${editBudget.category}` : "Set Budget Limit"}
                </Text>
                <TouchableOpacity onPress={() => { setShowAdd(false); setEditBudget(null); }}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {!editBudget && (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                      {availableCategories.map(cat => (
                        <TouchableOpacity
                          key={cat.label}
                          style={[styles.catChip, {
                            backgroundColor: selectedCategory === cat.label ? colors.primary : colors.accent,
                            borderColor: selectedCategory === cat.label ? colors.primary : colors.border,
                          }]}
                          onPress={() => setSelectedCategory(cat.label)}
                        >
                          <Text style={{ fontSize: 14 }}>{cat.emoji}</Text>
                          <Text style={{
                            color: selectedCategory === cat.label ? colors.primaryForeground : colors.mutedForeground,
                            fontSize: 12, fontWeight: "600",
                          }}>{cat.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </ScrollView>
                </>
              )}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Monthly Limit (QAR)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                value={limitInput}
                onChangeText={setLimitInput}
                keyboardType="numeric"
                placeholder="e.g. 1500"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
              />

              {editBudget && (
                <View style={[styles.currentSpendBox, { backgroundColor: colors.accent }]}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Current month spending:</Text>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>
                    QAR {editBudget.spentAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving
                  ? <ActivityIndicator color={colors.primaryForeground} />
                  : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
                    {editBudget ? "Update Budget" : "Save Budget"}
                  </Text>}
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
  addBudgetBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  addBudgetText: { fontWeight: "600", fontSize: 13 },
  budgetCard: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 10 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  catEmoji: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  catName: { fontSize: 15, fontWeight: "600" },
  cardPeriod: { fontSize: 11, marginTop: 2 },
  limitText: { fontSize: 17, fontWeight: "800" },
  cardActions: { flexDirection: "row", gap: 6, marginTop: 4 },
  actionBtn: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  barTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spentRow: { alignItems: "center", gap: 2 },
  spentLabel: { fontSize: 11 },
  spentValue: { fontSize: 14, fontWeight: "700" },
  pctBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  overBanner: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  summaryCard: { borderRadius: 18, padding: 16, borderWidth: 1, gap: 12 },
  summaryTitle: { fontSize: 14, fontWeight: "700" },
  summaryGrid: { flexDirection: "row", gap: 8 },
  summaryItem: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center", gap: 3 },
  summaryItemVal: { fontSize: 15, fontWeight: "800" },
  summaryItemLabel: { fontSize: 10, textAlign: "center" },
  emptyBudget: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: "700" },
  emptySub: { fontSize: 14, textAlign: "center", lineHeight: 22 },
  emptyAddBtn: { paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 8 },
  emptyAddText: { fontWeight: "700", fontSize: 16 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, gap: 8 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  catChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 14, fontSize: 22, fontWeight: "700", marginBottom: 4, textAlign: "center" },
  currentSpendBox: { borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontWeight: "700", fontSize: 16 },
});
