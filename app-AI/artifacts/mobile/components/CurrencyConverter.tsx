import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";
import { useCurrency, CURRENCIES, CurrencyCode } from "@/hooks/useCurrency";

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

// ── Rate strip widget (compact, sits on dashboard) ──────────────────────────
const STRIP_CURRENCIES: CurrencyCode[] = ["USD", "EUR", "GBP", "SAR", "AED", "INR"];

interface Props {
  onOpenFull?: () => void;
}

export function CurrencyRateStrip({ onOpenFull }: Props) {
  const colors = useColors();
  const { rates, updateRates } = useCurrency();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    authFetch("/api/currency/rates")
      .then((data: { rates: Record<string, number> }) => updateRates(data.rates))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <TouchableOpacity
      style={[styles.strip, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onOpenFull}
      activeOpacity={0.85}
    >
      <View style={styles.stripHeader}>
        <View style={styles.stripLeft}>
          <View style={[styles.stripIcon, { backgroundColor: colors.primary + "18" }]}>
            <Text style={{ fontSize: 16 }}>💱</Text>
          </View>
          <View>
            <Text style={[styles.stripTitle, { color: colors.foreground }]}>Live FX Rates</Text>
            <Text style={[styles.stripSub, { color: colors.mutedForeground }]}>1 QAR equals</Text>
          </View>
        </View>
        {loading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <View style={[styles.openBtn, { backgroundColor: colors.accent }]}>
              <Feather name="maximize-2" size={12} color={colors.primary} />
              <Text style={[styles.openBtnText, { color: colors.primary }]}>Convert</Text>
            </View>
        }
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rateRow}>
        {STRIP_CURRENCIES.map(code => {
          const cur  = CURRENCIES.find(c => c.code === code)!;
          const rate = rates[code] ?? 0;
          return (
            <View key={code} style={[styles.rateChip, { backgroundColor: colors.accent }]}>
              <Text style={{ fontSize: 14 }}>{cur.flag}</Text>
              <View>
                <Text style={[styles.rateCode, { color: colors.foreground }]}>{code}</Text>
                <Text style={[styles.rateVal, { color: colors.primary }]}>{rate.toFixed(code === "KWD" ? 4 : code === "INR" ? 2 : 4)}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </TouchableOpacity>
  );
}

// ── Full converter modal ──────────────────────────────────────────────────────
interface ConverterModalProps {
  visible: boolean;
  onClose: () => void;
}

export function CurrencyConverterModal({ visible, onClose }: ConverterModalProps) {
  const colors = useColors();
  const { rates, updateRates, currency, setCurrency } = useCurrency();
  const [fromCode, setFromCode] = useState<CurrencyCode>("QAR");
  const [toCode,   setToCode]   = useState<CurrencyCode>("USD");
  const [amount,   setAmount]   = useState("1000");
  const [loading,  setLoading]  = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const [pickingFrom, setPickingFrom] = useState(false);
  const [pickingTo,   setPickingTo]   = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    authFetch("/api/currency/rates")
      .then((data: { rates: Record<string, number>; lastUpdated: string }) => {
        updateRates(data.rates);
        setLastUpdated(new Date(data.lastUpdated).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [visible]);

  // Convert fromCode → toCode via QAR as base
  const convert = useCallback((val: number, from: CurrencyCode, to: CurrencyCode): number => {
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    const fromRate = allRates[from] ?? 1;
    const toRate   = allRates[to]   ?? 1;
    const inQAR    = val / fromRate;
    return inQAR * toRate;
  }, [rates]);

  const numAmount = parseFloat(amount) || 0;
  const result    = convert(numAmount, fromCode, toCode);
  const fromCur   = CURRENCIES.find(c => c.code === fromCode)!;
  const toCur     = CURRENCIES.find(c => c.code === toCode)!;

  const swapCurrencies = () => {
    setFromCode(toCode);
    setToCode(fromCode);
  };

  const dec = (code: CurrencyCode) => code === "KWD" ? 3 : 2;

  const CurrencyPicker = ({ selecting, current, onSelect, onClose: closeP }: {
    selecting: boolean; current: CurrencyCode; onSelect: (c: CurrencyCode) => void; onClose: () => void;
  }) => (
    <Modal visible={selecting} transparent animationType="slide">
      <View style={[styles.pickerOverlay, { backgroundColor: colors.overlay }]}>
        <View style={[styles.pickerSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.pickerHeader}>
            <Text style={[styles.pickerTitle, { color: colors.foreground }]}>Select Currency</Text>
            <TouchableOpacity onPress={closeP}><Feather name="x" size={20} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
          <ScrollView>
            {CURRENCIES.map(c => (
              <TouchableOpacity
                key={c.code}
                style={[styles.pickerRow, { borderBottomColor: colors.border },
                  c.code === current && { backgroundColor: colors.primary + "12" }]}
                onPress={() => { onSelect(c.code); closeP(); }}
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

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Currency Converter</Text>
                {lastUpdated && <Text style={[styles.sheetSub, { color: colors.mutedForeground }]}>Rates updated {lastUpdated}</Text>}
              </View>
              <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>

            {loading && <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} />}

            {/* From */}
            <View style={[styles.convBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
              <TouchableOpacity style={styles.curPicker} onPress={() => setPickingFrom(true)}>
                <Text style={{ fontSize: 24 }}>{fromCur.flag}</Text>
                <Text style={[styles.curCode, { color: colors.foreground }]}>{fromCode}</Text>
                <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
              <TextInput
                style={[styles.amtInput, { color: colors.foreground }]}
                value={amount}
                onChangeText={setAmount}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
              />
            </View>

            {/* Swap button */}
            <TouchableOpacity style={[styles.swapBtn, { backgroundColor: colors.primary }]} onPress={swapCurrencies}>
              <Feather name="repeat" size={16} color={colors.primaryForeground} />
            </TouchableOpacity>

            {/* To */}
            <View style={[styles.convBox, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
              <TouchableOpacity style={styles.curPicker} onPress={() => setPickingTo(true)}>
                <Text style={{ fontSize: 24 }}>{toCur.flag}</Text>
                <Text style={[styles.curCode, { color: colors.primary }]}>{toCode}</Text>
                <Feather name="chevron-down" size={14} color={colors.primary} />
              </TouchableOpacity>
              <Text style={[styles.resultAmt, { color: colors.primary }]}>
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

            {/* All rates table */}
            <Text style={[styles.allRatesTitle, { color: colors.foreground }]}>All rates vs QAR</Text>
            <ScrollView style={{ maxHeight: 220 }}>
              {CURRENCIES.filter(c => c.code !== "QAR").map(c => {
                const r = (rates[c.code] ?? 0);
                return (
                  <View key={c.code} style={[styles.rateTableRow, { borderBottomColor: colors.border }]}>
                    <Text style={{ fontSize: 18 }}>{c.flag}</Text>
                    <Text style={[styles.rateTableCode, { color: colors.foreground }]}>{c.code}</Text>
                    <Text style={[styles.rateTableName, { color: colors.mutedForeground }]}>{c.name}</Text>
                    <Text style={[styles.rateTableVal, { color: colors.primary }]}>
                      {r.toFixed(c.code === "KWD" ? 4 : c.code === "INR" ? 2 : 4)}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>

            {/* App-wide currency selector */}
            <View style={[styles.appCurSection, { borderTopColor: colors.border }]}>
              <Text style={[styles.appCurLabel, { color: colors.mutedForeground }]}>Display currency in app</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {CURRENCIES.slice(0, 6).map(c => (
                  <TouchableOpacity
                    key={c.code}
                    style={[styles.appCurChip, {
                      backgroundColor: currency === c.code ? colors.primary : colors.accent,
                      borderColor: currency === c.code ? colors.primary : colors.border,
                    }]}
                    onPress={() => setCurrency(c.code)}
                  >
                    <Text style={{ fontSize: 14 }}>{c.flag}</Text>
                    <Text style={[styles.appCurChipText, { color: currency === c.code ? colors.primaryForeground : colors.mutedForeground }]}>{c.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

          </View>
        </View>
      </KeyboardAvoidingView>

      <CurrencyPicker selecting={pickingFrom} current={fromCode} onSelect={setFromCode} onClose={() => setPickingFrom(false)} />
      <CurrencyPicker selecting={pickingTo}   current={toCode}   onSelect={setToCode}   onClose={() => setPickingTo(false)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Strip
  strip: { borderRadius: 20, padding: 16, borderWidth: 1, gap: 12 },
  stripHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stripLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  stripIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stripTitle: { fontSize: 14, fontWeight: "700" },
  stripSub: { fontSize: 11, marginTop: 1 },
  openBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  openBtnText: { fontSize: 12, fontWeight: "600" },
  rateRow: { gap: 8, paddingVertical: 2 },
  rateChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12 },
  rateCode: { fontSize: 11, fontWeight: "700" },
  rateVal: { fontSize: 12, fontWeight: "600" },
  // Modal
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, gap: 14 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sheetTitle: { fontSize: 20, fontWeight: "800" },
  sheetSub: { fontSize: 11, marginTop: 3 },
  convBox: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  curPicker: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 12 },
  curCode: { fontSize: 16, fontWeight: "800" },
  amtInput: { flex: 1, fontSize: 28, fontWeight: "900", textAlign: "right" },
  resultAmt: { flex: 1, fontSize: 28, fontWeight: "900", textAlign: "right" },
  swapBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  rateInfo: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, padding: 10 },
  rateInfoText: { fontSize: 12, flex: 1 },
  allRatesTitle: { fontSize: 13, fontWeight: "700", marginTop: 4 },
  rateTableRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1 },
  rateTableCode: { fontWeight: "700", fontSize: 13, width: 40 },
  rateTableName: { flex: 1, fontSize: 12 },
  rateTableVal: { fontWeight: "700", fontSize: 13 },
  appCurSection: { borderTopWidth: 1, paddingTop: 14, gap: 10 },
  appCurLabel: { fontSize: 12, fontWeight: "600" },
  appCurChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  appCurChipText: { fontSize: 12, fontWeight: "700" },
  // Picker
  pickerOverlay: { flex: 1, justifyContent: "flex-end" },
  pickerSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, borderWidth: 1, borderBottomWidth: 0, maxHeight: "75%" },
  pickerHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  pickerTitle: { fontSize: 17, fontWeight: "700" },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, borderBottomWidth: 1 },
  pickerCode: { fontSize: 14, fontWeight: "700" },
  pickerName: { fontSize: 12, marginTop: 1 },
});
