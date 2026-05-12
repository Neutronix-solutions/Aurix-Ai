import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortfolio, useCreatePortfolioHolding, useDeletePortfolioHolding, useUpdatePortfolioHolding,
  useGetPortfolioSummary, useAwardPoints,
  getGetPortfolioQueryKey, getGetPortfolioSummaryQueryKey,
} from "@workspace/api-client-react";
import { useLang } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";

const HOLDING_TYPES = ["stock", "crypto", "etf", "bond", "real_estate", "cash"];

function HoldingCard({ item, colors, onDelete, onUpdate }: { item: any; colors: any; onDelete: () => void; onUpdate: () => void }) {
  const pnl = (item.currentPrice - item.buyPrice) * item.quantity;
  const pnlPct = item.buyPrice > 0 ? ((item.currentPrice - item.buyPrice) / item.buyPrice) * 100 : 0;
  const isProfit = pnl >= 0;
  const pnlColor = isProfit ? colors.success : colors.danger;

  return (
    <View style={[styles.holdingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.holdingTop}>
        <View style={[styles.holdingSymbol, { backgroundColor: colors.accent }]}>
          <Text style={[styles.holdingSymbolText, { color: colors.primary }]}>{item.symbol?.slice(0, 3).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.holdingName, { color: colors.foreground }]}>{item.name}</Text>
          <View style={styles.holdingMeta}>
            <View style={[styles.typeBadge, { backgroundColor: colors.accent }]}>
              <Text style={[styles.typeBadgeText, { color: colors.mutedForeground }]}>{item.type.toUpperCase()}</Text>
            </View>
            <Text style={[styles.holdingQty, { color: colors.mutedForeground }]}>{item.quantity} units</Text>
          </View>
        </View>
        <View style={styles.holdingActions}>
          <TouchableOpacity onPress={onUpdate} style={styles.actionIcon}>
            <Feather name="edit-2" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onDelete} style={styles.actionIcon}>
            <Feather name="trash-2" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={[styles.holdingBottom, { borderTopColor: colors.border }]}>
        <View>
          <Text style={[styles.holdingLabel, { color: colors.mutedForeground }]}>Current Value</Text>
          <Text style={[styles.holdingValue, { color: colors.foreground }]}>QAR {(item.currentPrice * item.quantity).toFixed(2)}</Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={[styles.holdingLabel, { color: colors.mutedForeground }]}>P&L</Text>
          <Text style={[styles.holdingPnl, { color: pnlColor }]}>
            {isProfit ? "+" : ""}{pnl.toFixed(2)} ({isProfit ? "+" : ""}{pnlPct.toFixed(1)}%)
          </Text>
        </View>
      </View>
    </View>
  );
}

export default function PortfolioScreen() {
  const colors = useColors();
  const { t } = useLang();
  const tabBarPadding = useTabBarPadding();
  const queryClient = useQueryClient();

  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [symbol, setSymbol] = useState("");
  const [holdingName, setHoldingName] = useState("");
  const [type, setType] = useState("stock");
  const [quantity, setQuantity] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [updatedPrice, setUpdatedPrice] = useState("");

  const { data: holdings, isLoading, refetch } = useGetPortfolio();
  const { data: summary } = useGetPortfolioSummary();
  const createHolding = useCreatePortfolioHolding();
  const deleteHolding = useDeletePortfolioHolding();
  const updateHolding = useUpdatePortfolioHolding();
  const awardPoints = useAwardPoints();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
  }, [queryClient]);

  const resetForm = () => { setSymbol(""); setHoldingName(""); setType("stock"); setQuantity(""); setBuyPrice(""); setCurrentPrice(""); };

  const handleAdd = useCallback(() => {
    const qty = parseFloat(quantity);
    const bp = parseFloat(buyPrice);
    const cp = parseFloat(currentPrice);
    if (!symbol || !holdingName || isNaN(qty) || isNaN(bp) || isNaN(cp)) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }
    createHolding.mutate(
      { data: { symbol, name: holdingName, type: type as "stock" | "crypto" | "etf", quantity: qty, buyPrice: bp, currentPrice: cp } },
      {
        onSuccess: () => {
          setShowAdd(false); resetForm(); invalidate();
          awardPoints.mutate({ data: { action: "update_portfolio" } });
        },
        onError: () => Alert.alert("Error", "Could not add holding"),
      },
    );
  }, [symbol, holdingName, type, quantity, buyPrice, currentPrice]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Delete", "Remove this holding?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteHolding.mutate({ id }, { onSuccess: invalidate }) },
    ]);
  }, []);

  const handleUpdatePrice = useCallback(() => {
    if (!editItem) return;
    const cp = parseFloat(updatedPrice);
    if (isNaN(cp)) { Alert.alert("Error", "Enter valid price"); return; }
    updateHolding.mutate({ id: editItem.id, data: { currentPrice: cp } }, {
      onSuccess: () => { setEditItem(null); setUpdatedPrice(""); invalidate(); },
    });
  }, [editItem, updatedPrice]);

  const holdingList = (holdings as any[]) ?? [];
  const s = summary as any;

  const fmt = (n: number) => `QAR ${n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pnlColor = s?.totalPnl >= 0 ? colors.success : colors.danger;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>{t.portfolio}</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAdd(true)}>
          <Feather name="plus" size={18} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      {s && (
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryTop}>
            <View>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{t.portfolioValue}</Text>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{fmt(s.totalValue ?? 0)}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{t.pnl}</Text>
              <Text style={[styles.summaryPnl, { color: pnlColor }]}>
                {s.totalPnl >= 0 ? "+" : ""}{fmt(s.totalPnl ?? 0)} ({(s.totalPnlPercent ?? 0).toFixed(1)}%)
              </Text>
            </View>
          </View>
          {s.allocation?.length > 0 && (
            <View style={styles.allocRow}>
              {s.allocation.map((a: any, i: number) => (
                <View key={a.type} style={styles.allocItem}>
                  <View style={[styles.allocDot, { backgroundColor: [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5][i % 5] }]} />
                  <Text style={[styles.allocType, { color: colors.mutedForeground }]}>{a.type}</Text>
                  <Text style={[styles.allocPct, { color: colors.foreground }]}>{a.percentage.toFixed(0)}%</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={holdingList}
          keyExtractor={(item: any) => String(item.id)}
          renderItem={({ item }) => (
            <HoldingCard item={item} colors={colors} onDelete={() => handleDelete(item.id)} onUpdate={() => { setEditItem(item); setUpdatedPrice(String(item.currentPrice)); }} />
          )}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: tabBarPadding }}
          ListEmptyComponent={
            <Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 40 }}>{t.noData}</Text>
          }
          refreshing={false}
          onRefresh={refetch}
        />
      )}

      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>{t.addHolding}</Text>
                <TouchableOpacity onPress={() => { setShowAdd(false); resetForm(); }}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              {[
                { label: t.symbol, value: symbol, set: setSymbol, ph: "AAPL", kb: "default" },
                { label: t.holdingName, value: holdingName, set: setHoldingName, ph: "Apple Inc.", kb: "default" },
                { label: t.quantity, value: quantity, set: setQuantity, ph: "10", kb: "numeric" },
                { label: t.buyPrice + " (QAR)", value: buyPrice, set: setBuyPrice, ph: "150.00", kb: "numeric" },
                { label: t.currentPrice + " (QAR)", value: currentPrice, set: setCurrentPrice, ph: "180.00", kb: "numeric" },
              ].map(f => (
                <View key={f.label} style={{ marginBottom: 10 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                    value={f.value} onChangeText={f.set as any} keyboardType={f.kb as any}
                    placeholder={f.ph} placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              ))}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.type}</Text>
              <View style={styles.typeRow}>
                {HOLDING_TYPES.map(ht => (
                  <TouchableOpacity key={ht} style={[styles.typeChip, { backgroundColor: type === ht ? colors.primary : colors.accent }]} onPress={() => setType(ht)}>
                    <Text style={{ color: type === ht ? colors.primaryForeground : colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>{ht}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={handleAdd} disabled={createHolding.isPending}>
                {createHolding.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>{t.save}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!editItem} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Update Price</Text>
              <TouchableOpacity onPress={() => setEditItem(null)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.currentPrice} (QAR)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
              value={updatedPrice} onChangeText={setUpdatedPrice} keyboardType="numeric"
              placeholderTextColor={colors.mutedForeground}
            />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={handleUpdatePrice} disabled={updateHolding.isPending}>
              {updateHolding.isPending ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>{t.save}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  screenTitle: { fontSize: 22, fontWeight: "700" },
  addBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  summaryCard: { margin: 16, borderRadius: 20, padding: 20, borderWidth: 1, gap: 14 },
  summaryTop: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 12, fontWeight: "500", marginBottom: 4 },
  summaryValue: { fontSize: 22, fontWeight: "800" },
  summaryPnl: { fontSize: 18, fontWeight: "700" },
  allocRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  allocItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  allocType: { fontSize: 12 },
  allocPct: { fontSize: 12, fontWeight: "600" },
  holdingCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  holdingTop: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  holdingSymbol: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  holdingSymbolText: { fontWeight: "800", fontSize: 13 },
  holdingName: { fontSize: 15, fontWeight: "600" },
  holdingMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeBadgeText: { fontSize: 10, fontWeight: "700" },
  holdingQty: { fontSize: 12 },
  holdingActions: { flexDirection: "row", gap: 8 },
  actionIcon: { padding: 4 },
  holdingBottom: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderTopWidth: 1 },
  holdingLabel: { fontSize: 11, marginBottom: 2 },
  holdingValue: { fontSize: 16, fontWeight: "700" },
  holdingPnl: { fontSize: 15, fontWeight: "700" },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, maxHeight: "90%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 4 },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontWeight: "700", fontSize: 16 },
});
