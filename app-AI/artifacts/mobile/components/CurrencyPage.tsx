import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Modal,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useCurrency, CURRENCIES, CurrencyCode } from "@/hooks/useCurrency";
import { useLang } from "@/context/LanguageContext";

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

const dec = (code: CurrencyCode) =>
  code === "KWD" ? 3 : code === "INR" ? 0 : 2;

function CurrencyPicker({ selecting, current, onSelect, onClose, colors, t }: {
  selecting: boolean; current: CurrencyCode; onSelect: (c: CurrencyCode) => void;
  onClose: () => void; colors: any; t: any;
}) {
  return (
    <Modal visible={selecting} transparent animationType="slide">
      <View style={[styles.pickerOverlay, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
        <View style={[styles.pickerSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.pickerHeader}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>{t.selectCurrency}</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
          <ScrollView>
            {CURRENCIES.map(c => (
              <TouchableOpacity
                key={c.code}
                style={[styles.pickerRow, { borderBottomColor: colors.border }, c.code === current && { backgroundColor: colors.primary + "12" }]}
                onPress={() => { onSelect(c.code); onClose(); }}
              >
                <Text style={{ fontSize: 24 }}>{c.flag}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pickerCode, { color: colors.foreground }]}>{c.code}</Text>
                  <Text style={[styles.pickerName, { color: colors.mutedForeground }]}>{c.name}</Text>
                </View>
                {c.code === current && <Feather name="check" size={16} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function CurrencyPage() {
  const colors = useColors();
  const { t, isRTL } = useLang();
  const { rates, updateRates, currency, setCurrency } = useCurrency();
  const [fromCode,   setFromCode]   = useState<CurrencyCode>("QAR");
  const [toCode,     setToCode]     = useState<CurrencyCode>("USD");
  const [amount,     setAmount]     = useState("1000");
  const [loading,    setLoading]    = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [pickingFrom, setPickingFrom] = useState(false);
  const [pickingTo,   setPickingTo]   = useState(false);

  const fetchRates = useCallback(() => {
    setLoading(true);
    authFetch("/api/currency/rates")
      .then((data: { rates: Record<string, number>; lastUpdated: string }) => {
        updateRates(data.rates);
        setLastUpdated(new Date(data.lastUpdated).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [updateRates]);

  useEffect(() => { fetchRates(); }, []);

  const convert = useCallback((val: number, from: CurrencyCode, to: CurrencyCode): number => {
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    return (val / (allRates[from] ?? 1)) * (allRates[to] ?? 1);
  }, [rates]);

  const numAmount  = parseFloat(amount) || 0;
  const result     = convert(numAmount, fromCode, toCode);
  const fromCur    = CURRENCIES.find(c => c.code === fromCode)!;
  const toCur      = CURRENCIES.find(c => c.code === toCode)!;

  const swapCurrencies = () => { setFromCode(toCode); setToCode(fromCode); };

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingBottom: 110 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.headerRow}>
          <View>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>{t.currencyTitle}</Text>
            {lastUpdated
              ? <Text style={[styles.pageSub, { color: colors.mutedForeground }]}>{t.lastUpdated}: {lastUpdated}</Text>
              : <Text style={[styles.pageSub, { color: colors.mutedForeground }]}>{t.liveRates}</Text>
            }
          </View>
          <TouchableOpacity style={[styles.refreshBtn, { backgroundColor: colors.primary + "15" }]} onPress={fetchRates}>
            {loading ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="refresh-cw" size={16} color={colors.primary} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Converter */}
      <View style={[styles.converterCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{t.currencyTitle}</Text>

        {/* From box */}
        <View style={[styles.convBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
          <TouchableOpacity style={styles.curPicker} onPress={() => setPickingFrom(true)}>
            <Text style={{ fontSize: 24 }}>{fromCur.flag}</Text>
            <Text style={[styles.curCode, { color: colors.foreground }]}>{fromCode}</Text>
            <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TextInput
            style={[styles.amtInput, { color: colors.foreground, textAlign: isRTL ? "left" : "right" }]}
            value={amount} onChangeText={setAmount}
            keyboardType="numeric" placeholder="0" placeholderTextColor={colors.mutedForeground}
          />
        </View>

        {/* Swap */}
        <TouchableOpacity style={[styles.swapBtn, { backgroundColor: colors.primary }]} onPress={swapCurrencies}>
          <Feather name="repeat" size={16} color={colors.primaryForeground} />
          <Text style={[styles.swapText, { color: colors.primaryForeground }]}>{t.swap}</Text>
        </TouchableOpacity>

        {/* To box */}
        <View style={[styles.convBox, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
          <TouchableOpacity style={styles.curPicker} onPress={() => setPickingTo(true)}>
            <Text style={{ fontSize: 24 }}>{toCur.flag}</Text>
            <Text style={[styles.curCode, { color: colors.primary }]}>{toCode}</Text>
            <Feather name="chevron-down" size={14} color={colors.primary} />
          </TouchableOpacity>
          <Text style={[styles.resultAmt, { color: colors.primary, textAlign: isRTL ? "left" : "right" }]}>
            {result.toLocaleString("en", { minimumFractionDigits: dec(toCode), maximumFractionDigits: dec(toCode) })}
          </Text>
        </View>

        {/* Rate info */}
        <View style={[styles.rateInfo, { backgroundColor: colors.accent }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.rateInfoText, { color: colors.mutedForeground }]}>
            1 {fromCode} = {convert(1, fromCode, toCode).toFixed(dec(toCode))} {toCode}
            {"  ·  "}
            1 {toCode} = {convert(1, toCode, fromCode).toFixed(dec(fromCode))} {fromCode}
          </Text>
        </View>
      </View>

      {/* App display currency */}
      <View style={[styles.appCurCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.appCurHeader}>
          <Feather name="monitor" size={15} color={colors.primary} />
          <Text style={[styles.sectionLabel, { color: colors.foreground }]}>{t.appCurrency}</Text>
        </View>
        <Text style={[styles.appCurSub, { color: colors.mutedForeground }]}>
          All amounts in the app will display in this currency
        </Text>
        <View style={styles.currencyGrid}>
          {CURRENCIES.map(c => (
            <TouchableOpacity
              key={c.code}
              style={[styles.currencyChip, {
                backgroundColor: currency === c.code ? colors.primary : colors.accent,
                borderColor: currency === c.code ? colors.primary : colors.border,
              }]}
              onPress={() => setCurrency(c.code)}
            >
              <Text style={{ fontSize: 16 }}>{c.flag}</Text>
              <Text style={[styles.chipCode, { color: currency === c.code ? colors.primaryForeground : colors.foreground }]}>{c.code}</Text>
              <Text style={[styles.chipName, { color: currency === c.code ? colors.primaryForeground + "CC" : colors.mutedForeground }]} numberOfLines={1}>{c.name}</Text>
              {currency === c.code && <Feather name="check-circle" size={12} color={colors.primaryForeground} />}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* All rates table */}
      <View style={[styles.ratesCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>{t.liveRates} — 1 QAR =</Text>
        {CURRENCIES.filter(c => c.code !== "QAR").map(c => {
          const r = rates[c.code] ?? 0;
          return (
            <View key={c.code} style={[styles.rateRow, { borderBottomColor: colors.border }]}>
              <Text style={{ fontSize: 20 }}>{c.flag}</Text>
              <Text style={[styles.rateCode, { color: colors.foreground }]}>{c.code}</Text>
              <Text style={[styles.rateName, { color: colors.mutedForeground }]}>{c.name}</Text>
              <Text style={[styles.rateVal, { color: colors.primary }]}>
                {r.toFixed(c.code === "KWD" ? 4 : 4)}
              </Text>
              <TouchableOpacity
                style={[styles.useBtn, { backgroundColor: currency === c.code ? colors.primary : colors.accent }]}
                onPress={() => setCurrency(c.code)}
              >
                <Text style={[styles.useBtnText, { color: currency === c.code ? colors.primaryForeground : colors.mutedForeground }]}>
                  {currency === c.code ? "✓" : t.convert}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <CurrencyPicker selecting={pickingFrom} current={fromCode} onSelect={setFromCode} onClose={() => setPickingFrom(false)} colors={colors} t={t} />
      <CurrencyPicker selecting={pickingTo}   current={toCode}   onSelect={setToCode}   onClose={() => setPickingTo(false)}   colors={colors} t={t} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14 },
  headerCard: { borderRadius: 20, padding: 18, borderWidth: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pageTitle: { fontSize: 20, fontWeight: "800" },
  pageSub: { fontSize: 12, marginTop: 3 },
  refreshBtn: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  converterCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 12 },
  sectionLabel: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  convBox: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  curPicker: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 12 },
  curCode: { fontSize: 16, fontWeight: "800" },
  amtInput: { flex: 1, fontSize: 28, fontWeight: "900" },
  resultAmt: { flex: 1, fontSize: 28, fontWeight: "900" },
  swapBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  swapText: { fontWeight: "700", fontSize: 13 },
  rateInfo: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 10 },
  rateInfoText: { fontSize: 12, flex: 1 },
  appCurCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 10 },
  appCurHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  appCurSub: { fontSize: 12, marginBottom: 4 },
  currencyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  currencyChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14, borderWidth: 1, width: "47%" },
  chipCode: { fontSize: 13, fontWeight: "800" },
  chipName: { flex: 1, fontSize: 10 },
  ratesCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 0 },
  rateRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1 },
  rateCode: { fontWeight: "800", fontSize: 13, width: 40 },
  rateName: { flex: 1, fontSize: 12 },
  rateVal: { fontWeight: "700", fontSize: 13, width: 60, textAlign: "right" },
  useBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  useBtnText: { fontSize: 11, fontWeight: "700" },
  pickerOverlay: { flex: 1, justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 1, borderBottomWidth: 0, maxHeight: "75%" },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  pickerTitle: { fontSize: 17, fontWeight: "700" },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1 },
  pickerCode: { fontSize: 14, fontWeight: "700" },
  pickerName: { fontSize: 12, marginTop: 1 },
});
