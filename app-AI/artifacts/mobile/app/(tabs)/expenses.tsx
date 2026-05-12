import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView, Image,
} from "react-native";
import { useSmsReader, type RawSms } from "@/hooks/useSmsReader";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import {
  useGetExpenses, useCreateExpense, useDeleteExpense, useAwardPoints,
  getGetExpensesQueryKey, getGetExpenseSummaryQueryKey, getGetFinancialScoreQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useLang } from "@/context/LanguageContext";
import { useCurrency, CURRENCIES, CurrencyCode } from "@/hooks/useCurrency";
import { checkBudgetAndNotify } from "@/hooks/useNotifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import BillTracker from "@/components/BillTracker";
import CurrencyPage from "@/components/CurrencyPage";
import { validateReceiptImage } from "@/lib/imageUtils";
import { authFetch } from "@/lib/authFetch";

const EXPENSE_CATEGORIES = [
  "Food & Dining", "Shopping", "Transport", "Entertainment",
  "Health", "Bills & Utilities", "Travel", "Other",
];
const INCOME_SOURCES = ["Salary", "Freelance", "Business", "Investment", "Rental", "Gift", "Other"];
const CATEGORY_ICONS: Record<string, string> = {
  "Food & Dining": "coffee", Shopping: "shopping-bag", Transport: "navigation",
  Entertainment: "film", Health: "heart", "Bills & Utilities": "zap",
  Travel: "globe", Other: "more-horizontal",
  Salary: "briefcase", Freelance: "code", Business: "trending-up",
  Investment: "bar-chart-2", Rental: "home", Gift: "gift",
};
const CATEGORY_EMOJI: Record<string, string> = {
  "Food & Dining": "🍽️", Shopping: "🛍️", Transport: "🚗", Entertainment: "🎬",
  Health: "💊", "Bills & Utilities": "⚡", Travel: "✈️", Other: "📦",
};
const CONFIDENCE_LABELS: Record<string, string> = {
  high: "High confidence", medium: "Medium confidence", low: "Low confidence",
};

type EntryMode = "expenses" | "income";
type ScanMode  = "camera" | "gallery" | "text" | "auto";
type MoneyTab  = "transactions" | "bills" | "currency";

type ParsedResult = {
  amount: number | null; merchant: string | null; type: string;
  date: string | null; category: string; description: string | null;
  confidence: number; source: string;
};

// ── EntryItem with multi-currency badge ───────────────────────────────────────
function EntryItem({ item, mode, onDelete, colors, formatAmount }: {
  item: any; mode: EntryMode; onDelete: () => void; colors: any;
  formatAmount: (qar: number) => string;
}) {
  const icon = CATEGORY_ICONS[mode === "expenses" ? item.category : item.source] ?? "circle";
  const date = new Date(item.date).toLocaleDateString("en", { month: "short", day: "numeric" });
  const isIncome = mode === "income";
  const hasOrigCurr = item.originalCurrency && item.originalCurrency !== "QAR";
  const origCur = CURRENCIES.find(c => c.code === item.originalCurrency);

  return (
    <View style={[styles.entryItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.entryIcon, { backgroundColor: (isIncome ? colors.success : colors.primary) + "15" }]}>
        <Feather name={icon as any} size={16} color={isIncome ? colors.success : colors.primary} />
      </View>
      <View style={styles.entryInfo}>
        <Text style={[styles.entryMain, { color: colors.foreground }]}>
          {isIncome ? (item.source ?? "Income") : (item.merchant ?? item.category)}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          <Text style={[styles.entryMeta, { color: colors.mutedForeground }]}>
            {isIncome ? (item.description ?? "—") : item.category} · {date}
          </Text>
          {hasOrigCurr && (
            <View style={[styles.origCurrBadge, { backgroundColor: colors.primary + "15" }]}>
              <Text style={{ fontSize: 11 }}>{origCur?.flag ?? ""}</Text>
              <Text style={[styles.origCurrText, { color: colors.primary }]}>{item.originalCurrency}</Text>
            </View>
          )}
        </View>
      </View>
      <View style={styles.entryRight}>
        <Text style={[styles.entryAmount, { color: isIncome ? colors.success : colors.danger }]}>
          {isIncome ? "+" : "-"}{formatAmount(Number(item.amount))}
        </Text>
        {hasOrigCurr && item.originalAmount && (
          <Text style={[styles.origAmtText, { color: colors.mutedForeground }]}>
            {origCur?.symbol ?? item.originalCurrency} {Number(item.originalAmount).toFixed(2)}
          </Text>
        )}
        <TouchableOpacity onPress={onDelete} style={styles.delBtn}>
          <Feather name="trash-2" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ConfidenceBadge({ confidence, colors }: { confidence: number; colors: any }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  const color = confidence >= 0.8 ? colors.success : confidence >= 0.5 ? colors.warning : colors.danger;
  const dots = [0.33, 0.66, 1].map(thresh => confidence >= thresh);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ flexDirection: "row", gap: 3 }}>
        {dots.map((filled, i) => (
          <View key={i} style={[styles.confDot, { backgroundColor: filled ? color : color + "30" }]} />
        ))}
      </View>
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{CONFIDENCE_LABELS[level]}</Text>
    </View>
  );
}

// ── Transactions tab content ───────────────────────────────────────────────────
function TransactionsContent({ colors, t, isRTL, rates, formatAmount, tabBarPadding }: {
  colors: any; t: any; isRTL: boolean; rates: Record<string, number>; formatAmount: (qar: number) => string; tabBarPadding: number;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<EntryMode>("expenses");
  const [showAdd, setShowAdd] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>("camera");

  // Form state
  const [amount,      setAmount]      = useState("");
  const [category,    setCategory]    = useState("Other");
  const [source,      setSource]      = useState("Salary");
  const [merchant,    setMerchant]    = useState("");
  const [description, setDescription] = useState("");
  const [entryCurrency, setEntryCurrency] = useState<CurrencyCode>("QAR");
  const [showCurPicker, setShowCurPicker] = useState(false);

  // Scanner state
  const [capturedImage,    setCapturedImage]    = useState<string | null>(null);
  const [smsText,          setSmsText]          = useState("");
  const [parsing,          setParsing]          = useState(false);
  const [scanStage,        setScanStage]        = useState<"uploading" | "analyzing" | null>(null);
  const [parsedResult,     setParsedResult]     = useState<ParsedResult | null>(null);
  const [editAmount,       setEditAmount]       = useState("");
  const [editMerchant,     setEditMerchant]     = useState("");
  const [editCategory,     setEditCategory]     = useState("Other");
  const [editDescription,  setEditDescription]  = useState("");
  const [confirming,       setConfirming]       = useState(false);

  // Android SMS auto-scan state
  const { readSms, requestPermission, isReading } = useSmsReader();
  const [smsList,          setSmsList]          = useState<RawSms[]>([]);
  const [selectedSms,      setSelectedSms]      = useState<string | null>(null);

  const [incomeList,    setIncomeList]    = useState<any[]>([]);
  const [incomeLoading, setIncomeLoading] = useState(false);

  const { data: expenses, isLoading: expLoading, refetch } = useGetExpenses();
  const createExpense = useCreateExpense();
  const deleteExpense = useDeleteExpense();
  const awardPoints   = useAwardPoints();

  const loadIncome = useCallback(async () => {
    setIncomeLoading(true);
    try { const d = await authFetch("/api/income"); setIncomeList(Array.isArray(d) ? d : []); }
    catch { setIncomeList([]); }
    finally { setIncomeLoading(false); }
  }, []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetExpensesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinancialScoreQueryKey() });
  }, [queryClient]);

  const handleModeChange = useCallback((newMode: EntryMode) => {
    setMode(newMode);
    if (newMode === "income") loadIncome();
  }, [loadIncome]);

  const resetScanner = useCallback(() => {
    setCapturedImage(null); setSmsText(""); setParsedResult(null);
    setEditAmount(""); setEditMerchant(""); setEditCategory("Other"); setEditDescription("");
    setSmsList([]); setSelectedSms(null); setScanStage(null);
  }, []);

  const handleAndroidScan = useCallback(async () => {
    if (Platform.OS !== "android") {
      Alert.alert("Android Only", "SMS auto-read is only available on Android. Use 'Paste Text' on iOS.");
      return;
    }
    const granted = await requestPermission();
    if (!granted) {
      Alert.alert("Permission Required", "Allow SMS access to automatically detect bank transactions. You can still use 'Paste Text' without this permission.");
      return;
    }
    const msgs = await readSms({ maxCount: 50, filter: "bank" });
    if (msgs.length === 0) {
      Alert.alert("No Bank SMS Found", "No recent bank transaction messages found in the last 24 hours. Try 'Paste Text' to add one manually.");
      return;
    }
    setSmsList(msgs);
  }, [readSms, requestPermission]);

  const handleSelectAndParseSms = useCallback(async (smsBody: string) => {
    setSelectedSms(smsBody);
    setParsing(true);
    try {
      const data = await authFetch("/api/sms/parse", { method: "POST", body: JSON.stringify({ message: smsBody }) });
      if (data.error) throw new Error(data.error);
      setParsedResult(data);
      setEditAmount(data.amount ? String(data.amount) : "");
      setEditMerchant(data.merchant ?? "");
      setEditCategory(data.category ?? "Other");
      setEditDescription(data.description ?? "");
      setSmsList([]);
    } catch (err: any) {
      Alert.alert("Parse failed", err.message ?? "Could not parse this SMS");
    } finally { setParsing(false); }
  }, []);

  const pasteFromClipboard = useCallback(async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text?.trim()) {
        setSmsText(text.trim());
      } else {
        Alert.alert("Clipboard empty", "Copy your bank SMS first, then tap Paste.");
      }
    } catch {
      Alert.alert("Clipboard unavailable", "Could not read clipboard. Please paste manually.");
    }
  }, []);

  // Convert entered amount to QAR for storage
  const getQarAmount = useCallback((rawAmt: number, curr: CurrencyCode) => {
    if (curr === "QAR") return rawAmt;
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    return rawAmt / (allRates[curr] ?? 1);
  }, [rates]);

  // Camera / Gallery
  const launchCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Camera permission is required."); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.6, base64: true });
    if (!result.canceled && result.assets[0]) {
      setCapturedImage(result.assets[0].uri); setParsedResult(null);
      parseImage(result.assets[0].base64 ?? null);
    }
  }, []);

  const launchGallery = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") { Alert.alert("Permission needed", "Photo library access is required."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.6, base64: true });
    if (!result.canceled && result.assets[0]) {
      setCapturedImage(result.assets[0].uri); setParsedResult(null);
      parseImage(result.assets[0].base64 ?? null);
    }
  }, []);

  const parseImage = useCallback(async (base64: string | null) => {
    if (!base64) { Alert.alert("Error", "Could not read image data"); return; }
    const validationError = validateReceiptImage(base64);
    if (validationError) { Alert.alert("Image too large", validationError); return; }
    setParsing(true);
    setScanStage("uploading");
    try {
      setScanStage("analyzing");
      const data = await authFetch("/api/sms/parse", { method: "POST", body: JSON.stringify({ imageBase64: base64 }) });
      if (data.error) throw new Error(data.error);
      setParsedResult(data);
      setEditAmount(data.amount ? String(data.amount) : "");
      setEditMerchant(data.merchant ?? ""); setEditCategory(data.category ?? "Other"); setEditDescription(data.description ?? "");
    } catch (err: any) { Alert.alert("Scan failed", err.message ?? "Could not analyze receipt."); }
    finally { setParsing(false); setScanStage(null); }
  }, []);

  const parseText = useCallback(async () => {
    if (!smsText.trim()) { Alert.alert("Error", "Paste some text first"); return; }
    setParsing(true);
    try {
      const data = await authFetch("/api/sms/parse", { method: "POST", body: JSON.stringify({ message: smsText.trim() }) });
      if (data.error) throw new Error(data.error);
      setParsedResult(data);
      setEditAmount(data.amount ? String(data.amount) : "");
      setEditMerchant(data.merchant ?? ""); setEditCategory(data.category ?? "Other"); setEditDescription(data.description ?? "");
    } catch (err: any) { Alert.alert("Parse failed", err.message ?? "Could not parse text"); }
    finally { setParsing(false); }
  }, [smsText]);

  const confirmScannedExpense = useCallback(async () => {
    const amt = parseFloat(editAmount);
    if (isNaN(amt) || amt <= 0) { Alert.alert("Error", t.amount + " required"); return; }
    setConfirming(true);
    try {
      await new Promise<void>((resolve, reject) => {
        createExpense.mutate(
          { data: { amount: amt, category: editCategory, merchant: editMerchant || undefined, description: editDescription || undefined } },
          {
            onSuccess: async () => {
              setShowScan(false); resetScanner(); invalidate();
              awardPoints.mutate({ data: { action: "add_expense" } });
              const user = await AsyncStorage.getItem("aurixai_user");
              const inc = user ? JSON.parse(user).monthlyIncome ?? 0 : 0;
              const expList2 = (expenses as any[]) ?? [];
              const total = expList2.reduce((s: number, e: any) => s + e.amount, 0) + amt;
              await checkBudgetAndNotify(total, inc);
              resolve();
            },
            onError: reject,
          },
        );
      });
    } catch { Alert.alert("Error", "Could not save expense"); }
    finally { setConfirming(false); }
  }, [editAmount, editCategory, editMerchant, editDescription, createExpense, resetScanner, invalidate, awardPoints, expenses, t.amount]);

  const handleAddExpense = useCallback(() => {
    const rawAmt = parseFloat(amount);
    if (isNaN(rawAmt) || rawAmt <= 0) { Alert.alert("Error", t.amount + " required"); return; }
    const qarAmt   = getQarAmount(rawAmt, entryCurrency);
    const isNonQAR = entryCurrency !== "QAR";
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    const rateUsed = isNonQAR ? (1 / (allRates[entryCurrency] ?? 1)) : 1;
    createExpense.mutate(
      {
        data: {
          amount: parseFloat(qarAmt.toFixed(2)),
          category, merchant: merchant || undefined,
          // @ts-ignore extra fields passed through
          originalAmount: isNonQAR ? rawAmt : undefined,
          originalCurrency: entryCurrency,
          exchangeRateUsed: parseFloat(rateUsed.toFixed(6)),
        },
      },
      {
        onSuccess: async () => {
          setShowAdd(false); setAmount(""); setMerchant(""); setCategory("Other"); setEntryCurrency("QAR");
          invalidate(); awardPoints.mutate({ data: { action: "add_expense" } });
          const user = await AsyncStorage.getItem("aurixai_user");
          const inc = user ? JSON.parse(user).monthlyIncome ?? 0 : 0;
          const expList2 = (expenses as any[]) ?? [];
          const total = expList2.reduce((s: number, e: any) => s + e.amount, 0) + qarAmt;
          await checkBudgetAndNotify(total, inc);
        },
        onError: () => Alert.alert("Error", "Could not add expense"),
      },
    );
  }, [amount, category, merchant, entryCurrency, rates, expenses, getQarAmount, createExpense, invalidate, awardPoints, t.amount]);

  const handleAddIncome = useCallback(async () => {
    const rawAmt = parseFloat(amount);
    if (isNaN(rawAmt) || rawAmt <= 0) { Alert.alert("Error", t.amount + " required"); return; }
    const qarAmt   = getQarAmount(rawAmt, entryCurrency);
    const isNonQAR = entryCurrency !== "QAR";
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    const rateUsed = isNonQAR ? (1 / (allRates[entryCurrency] ?? 1)) : 1;
    try {
      await authFetch("/api/income", {
        method: "POST",
        body: JSON.stringify({
          amount: parseFloat(qarAmt.toFixed(2)),
          source, description: description || undefined,
          originalAmount: isNonQAR ? rawAmt : undefined,
          originalCurrency: entryCurrency,
          exchangeRateUsed: parseFloat(rateUsed.toFixed(6)),
        }),
      });
      setShowAdd(false); setAmount(""); setDescription(""); setSource("Salary"); setEntryCurrency("QAR");
      loadIncome();
      // Sync dashboard / score / gamification / reports immediately after income change
      queryClient.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFinancialScoreQueryKey() });
    } catch (err: any) {
      const msg = err?.message ?? "Could not add income. Please check your connection and try again.";
      Alert.alert("Error", msg);
    }
  }, [amount, source, description, entryCurrency, rates]);

  const handleDeleteIncome = useCallback(async (id: number) => {
    Alert.alert(t.delete, "Remove this income entry?", [
      { text: t.cancel, style: "cancel" },
      { text: t.delete, style: "destructive", onPress: async () => {
        await authFetch(`/api/income/${id}`, { method: "DELETE" });
        loadIncome();
        queryClient.invalidateQueries({ queryKey: ["income-monthly"] });
        queryClient.invalidateQueries({ queryKey: getGetExpenseSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetFinancialScoreQueryKey() });
      }},
    ]);
  }, [t]);

  const expList = (expenses as any[]) ?? [];
  const expTotal = expList.reduce((s: number, e: any) => s + e.amount, 0);
  const incTotal = incomeList.reduce((s: number, e: any) => s + Number(e.amount), 0);

  // QAR amount display for real-time preview in form
  const rawAmt = parseFloat(amount) || 0;
  const qarPreview = entryCurrency === "QAR" ? rawAmt : getQarAmount(rawAmt, entryCurrency);
  const entCur     = CURRENCIES.find(c => c.code === entryCurrency)!;

  return (
    <View style={{ flex: 1 }}>
      {/* Header actions */}
      <View style={[styles.actionsRow, { borderBottomColor: colors.border }]}>
        {/* Mode toggle */}
        <View style={[styles.modeToggle, { backgroundColor: colors.accent }]}>
          {(["expenses", "income"] as const).map(m => (
            <TouchableOpacity
              key={m}
              style={[styles.modeBtn, mode === m && { backgroundColor: colors.card, borderRadius: 10 }]}
              onPress={() => handleModeChange(m)}
            >
              <Text style={{ fontSize: 14 }}>{m === "expenses" ? "💸" : "💰"}</Text>
              <Text style={[styles.modeBtnText, { color: mode === m ? (m === "income" ? colors.success : colors.danger) : colors.mutedForeground }]}>
                {m === "expenses" ? t.expenses : t.incomeLabel}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {mode === "expenses" && (
            <TouchableOpacity
              style={[styles.scanBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "35", borderWidth: 1 }]}
              onPress={() => { resetScanner(); setScanMode("camera"); setShowScan(true); }}
            >
              <Feather name="camera" size={14} color={colors.primary} />
              <Text style={[styles.scanBtnText, { color: colors.primary }]}>Scan</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.addFab, { backgroundColor: colors.primary }]} onPress={() => setShowAdd(true)}>
            <Feather name="plus" size={18} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Total banner */}
      <View style={[styles.totalBanner, { backgroundColor: mode === "expenses" ? colors.danger + "08" : colors.success + "08", borderColor: colors.border }]}>
        <View>
          <Text style={[styles.bannerLabel, { color: colors.mutedForeground }]}>
            {mode === "expenses" ? t.totalSpent : t.totalIncome} (30d)
          </Text>
          <Text style={[styles.bannerValue, { color: mode === "expenses" ? colors.danger : colors.success }]}>
            {formatAmount(mode === "expenses" ? expTotal : incTotal)}
          </Text>
        </View>
        {mode === "expenses" && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.bannerLabel, { color: colors.mutedForeground }]}>Entries</Text>
            <Text style={[styles.bannerValue, { color: colors.foreground }]}>{expList.length}</Text>
          </View>
        )}
      </View>

      {/* List */}
      {mode === "expenses" ? (
        expLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={expList}
            keyExtractor={(item: any) => String(item.id)}
            renderItem={({ item }) => (
              <EntryItem item={item} mode="expenses" colors={colors} formatAmount={formatAmount}
                onDelete={() => Alert.alert(t.delete, "Remove?", [
                  { text: t.cancel, style: "cancel" },
                  { text: t.delete, style: "destructive", onPress: () => deleteExpense.mutate({ id: item.id }, { onSuccess: invalidate }) },
                ])}
              />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: tabBarPadding }}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={{ fontSize: 40 }}>💸</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No expenses yet</Text>
                <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>Tap + or use Scan to add one</Text>
              </View>
            }
            refreshing={false} onRefresh={refetch}
          />
        )
      ) : (
        incomeLoading ? <ActivityIndicator color={colors.success} style={{ marginTop: 40 }} /> : (
          <FlatList
            data={incomeList}
            keyExtractor={(item: any) => String(item.id)}
            renderItem={({ item }) => (
              <EntryItem item={item} mode="income" colors={colors} formatAmount={formatAmount} onDelete={() => handleDeleteIncome(item.id)} />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: tabBarPadding }}
            ListEmptyComponent={<Text style={{ color: colors.mutedForeground, textAlign: "center", marginTop: 40 }}>No income entries yet</Text>}
            refreshing={false} onRefresh={loadIncome}
          />
        )
      )}

      {/* ── Manual Add Modal ─────────────────────────────────────────────── */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <ScrollView style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  {mode === "expenses" ? t.addExpense : t.addIncome}
                </Text>
                <TouchableOpacity onPress={() => setShowAdd(false)}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {/* Currency selector */}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.originalCurrency}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
                {CURRENCIES.map(c => (
                  <TouchableOpacity
                    key={c.code}
                    style={[styles.curChip, {
                      backgroundColor: entryCurrency === c.code ? colors.primary : colors.accent,
                      borderColor: entryCurrency === c.code ? colors.primary : colors.border,
                    }]}
                    onPress={() => setEntryCurrency(c.code)}
                  >
                    <Text style={{ fontSize: 14 }}>{c.flag}</Text>
                    <Text style={[styles.curChipText, { color: entryCurrency === c.code ? colors.primaryForeground : colors.mutedForeground }]}>{c.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Amount */}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                {t.amount} ({entryCurrency})
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                value={amount} onChangeText={setAmount} keyboardType="numeric"
                placeholder="0.00" placeholderTextColor={colors.mutedForeground} autoFocus
              />
              {/* QAR equivalent preview */}
              {entryCurrency !== "QAR" && rawAmt > 0 && (
                <View style={[styles.qarPreview, { backgroundColor: colors.primary + "10" }]}>
                  <Feather name="info" size={12} color={colors.primary} />
                  <Text style={[styles.qarPreviewText, { color: colors.primary }]}>
                    ≈ QAR {qarPreview.toFixed(2)} stored internally (rate: {(1/(({QAR:1,...rates} as Record<string,number>)[entryCurrency]??1)).toFixed(4)})
                  </Text>
                </View>
              )}

              {mode === "expenses" ? (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.merchant}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                    value={merchant} onChangeText={setMerchant}
                    placeholder="Where did you spend?" placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.category}</Text>
                  <View style={styles.chipGrid}>
                    {EXPENSE_CATEGORIES.map(cat => (
                      <TouchableOpacity key={cat} style={[styles.chip, { backgroundColor: category === cat ? colors.primary : colors.accent }]} onPress={() => setCategory(cat)}>
                        <Text style={{ color: category === cat ? colors.primaryForeground : colors.mutedForeground, fontSize: 11, fontWeight: "600" }}>
                          {CATEGORY_EMOJI[cat] ?? ""} {cat}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.danger, marginTop: 16 }]} onPress={handleAddExpense} disabled={createExpense.isPending}>
                    {createExpense.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{t.addExpense}</Text>}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.description}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                    value={description} onChangeText={setDescription}
                    placeholder="e.g. Monthly salary" placeholderTextColor={colors.mutedForeground}
                  />
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{t.source}</Text>
                  <View style={styles.chipGrid}>
                    {INCOME_SOURCES.map(s => (
                      <TouchableOpacity key={s} style={[styles.chip, { backgroundColor: source === s ? colors.success : colors.accent }]} onPress={() => setSource(s)}>
                        <Text style={{ color: source === s ? colors.successForeground : colors.mutedForeground, fontSize: 11, fontWeight: "600" }}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.success, marginTop: 16 }]} onPress={handleAddIncome}>
                    <Text style={[styles.saveBtnText, { color: colors.successForeground }]}>{t.addIncome}</Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Receipt Scanner Modal ───────────────────────────────────────── */}
      <Modal visible={showScan} animationType="slide" transparent onRequestClose={() => { setShowScan(false); resetScanner(); }}>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.scanModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Receipt Scanner</Text>
                <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>AI-powered transaction extraction</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowScan(false); resetScanner(); }}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
              <View style={[styles.scanTabRow, { backgroundColor: colors.accent, borderRadius: 12 }]}>
                {([
                  { key: "auto",    icon: "smartphone", label: "Auto SMS" },
                  { key: "camera",  icon: "camera",     label: "Camera" },
                  { key: "gallery", icon: "image",      label: "Gallery" },
                  { key: "text",    icon: "type",       label: "Paste SMS" },
                ] as { key: ScanMode; icon: any; label: string }[]).map(tab => (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.scanTab, scanMode === tab.key && { backgroundColor: colors.card, borderRadius: 10 }]}
                    onPress={() => { setScanMode(tab.key); resetScanner(); if (tab.key === "auto") handleAndroidScan(); }}
                  >
                    <Feather name={tab.icon} size={13} color={scanMode === tab.key ? colors.primary : colors.mutedForeground} />
                    <Text style={{ color: scanMode === tab.key ? colors.primary : colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>{tab.label}</Text>
                    {tab.key === "auto" && Platform.OS === "android" && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success, marginLeft: 2 }} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {(scanMode === "camera" || scanMode === "gallery") && (
                <>
                  {!capturedImage ? (
                    <TouchableOpacity
                      style={[styles.captureArea, { backgroundColor: colors.accent, borderColor: colors.border }]}
                      onPress={scanMode === "camera" ? launchCamera : launchGallery}
                    >
                      <View style={[styles.captureIconWrap, { backgroundColor: colors.primary + "20" }]}>
                        <Feather name={scanMode === "camera" ? "camera" : "image"} size={32} color={colors.primary} />
                      </View>
                      <Text style={[styles.captureTitle, { color: colors.foreground }]}>
                        {scanMode === "camera" ? "Tap to take a photo" : "Choose from gallery"}
                      </Text>
                      <Text style={[styles.captureSub, { color: colors.mutedForeground }]}>
                        {scanMode === "camera"
                          ? "Point at your receipt — AI will extract amount, merchant & category"
                          : "Select a receipt or bank statement screenshot"}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ gap: 12 }}>
                      <View style={styles.imagePreviewWrap}>
                        <Image source={{ uri: capturedImage }} style={styles.imagePreview} resizeMode="cover" />
                        <TouchableOpacity style={[styles.retakeBtn, { backgroundColor: colors.card }]} onPress={() => { setCapturedImage(null); setParsedResult(null); }}>
                          <Feather name="refresh-cw" size={14} color={colors.primary} />
                          <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Retake</Text>
                        </TouchableOpacity>
                      </View>
                      {parsing && (
                        <View style={[styles.analysingBox, { backgroundColor: colors.accent }]}>
                          <ActivityIndicator color={colors.primary} size="small" />
                          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                            {scanStage === "uploading" ? "Uploading image…" : "AI analyzing receipt…"}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              {scanMode === "auto" && !parsedResult && (
                <>
                  {Platform.OS !== "android" ? (
                    <View style={[styles.captureArea, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                      <View style={[styles.captureIconWrap, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 32 }}>📱</Text>
                      </View>
                      <Text style={[styles.captureTitle, { color: colors.foreground }]}>Android Only Feature</Text>
                      <Text style={[styles.captureSub, { color: colors.mutedForeground }]}>SMS auto-read requires Android. Use "Paste SMS" tab to add transactions manually on iOS.</Text>
                    </View>
                  ) : isReading ? (
                    <View style={[styles.analysingBox, { backgroundColor: colors.accent }]}>
                      <ActivityIndicator color={colors.primary} size="small" />
                      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Reading bank SMS from your inbox…</Text>
                    </View>
                  ) : smsList.length > 0 ? (
                    <View style={{ gap: 10 }}>
                      <View style={[styles.textHintBox, { backgroundColor: colors.primary + "10" }]}>
                        <Feather name="check-circle" size={13} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 12, flex: 1, fontWeight: "600" }}>
                          Found {smsList.length} bank SMS — tap one to extract the transaction
                        </Text>
                      </View>
                      {smsList.map(sms => (
                        <TouchableOpacity
                          key={sms._id}
                          style={[styles.smsListItem, { backgroundColor: colors.card, borderColor: colors.border }]}
                          onPress={() => handleSelectAndParseSms(sms.body)}
                          disabled={parsing && selectedSms === sms.body}
                        >
                          <View style={styles.smsListLeft}>
                            <Text style={[styles.smsListSender, { color: colors.primary }]}>{sms.address}</Text>
                            <Text style={[styles.smsListBody, { color: colors.foreground }]} numberOfLines={2}>{sms.body}</Text>
                            <Text style={[styles.smsListDate, { color: colors.mutedForeground }]}>
                              {new Date(Number(sms.date)).toLocaleDateString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </Text>
                          </View>
                          {parsing && selectedSms === sms.body ? (
                            <ActivityIndicator color={colors.primary} size="small" />
                          ) : (
                            <View style={[styles.parseSmsBtn, { backgroundColor: colors.primary }]}>
                              <Feather name="zap" size={14} color="#fff" />
                            </View>
                          )}
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : (
                    <View style={[styles.captureArea, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                      <View style={[styles.captureIconWrap, { backgroundColor: colors.primary + "20" }]}>
                        <Text style={{ fontSize: 32 }}>📩</Text>
                      </View>
                      <Text style={[styles.captureTitle, { color: colors.foreground }]}>Auto-Read Bank SMS</Text>
                      <Text style={[styles.captureSub, { color: colors.mutedForeground }]}>
                        Aurix AI will scan your inbox for bank transaction messages. Only financial SMS are processed — nothing else is read or stored.
                      </Text>
                      <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary, paddingHorizontal: 24, marginTop: 8 }]} onPress={handleAndroidScan}>
                        <Feather name="smartphone" size={16} color="#fff" />
                        <Text style={styles.saveBtnText}>Scan My Bank SMS</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}

              {scanMode === "text" && !parsedResult && (
                <>
                  <View style={[styles.textHintBox, { backgroundColor: colors.accent }]}>
                    <Feather name="info" size={13} color={colors.primary} />
                    <Text style={{ color: colors.mutedForeground, fontSize: 12, flex: 1 }}>
                      Copy a bank SMS or receipt, then tap "Paste" — AI will extract the transaction instantly
                    </Text>
                  </View>

                  {/* Auto-paste from clipboard */}
                  <TouchableOpacity
                    style={[styles.clipboardBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "40" }]}
                    onPress={pasteFromClipboard}
                  >
                    <Feather name="clipboard" size={15} color={colors.primary} />
                    <Text style={[styles.clipboardBtnText, { color: colors.primary }]}>Paste from Clipboard</Text>
                    <View style={[styles.clipboardBadge, { backgroundColor: colors.primary }]}>
                      <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>AUTO</Text>
                    </View>
                  </TouchableOpacity>

                  <TextInput
                    style={[styles.smsInput, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                    value={smsText} onChangeText={setSmsText} multiline numberOfLines={6}
                    placeholder="Or type / paste a bank SMS here…
Example: 'QNB: QAR 250.00 debited from your account at LULU HYPERMARKET on 04/05/2026'"
                    placeholderTextColor={colors.mutedForeground}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity style={[styles.parseBtn, { backgroundColor: smsText.trim() ? colors.primary : colors.accent }]} onPress={parseText} disabled={parsing || !smsText.trim()}>
                    {parsing ? <ActivityIndicator color={colors.primaryForeground} /> : (
                      <><Feather name="zap" size={15} color={smsText.trim() ? colors.primaryForeground : colors.mutedForeground} />
                        <Text style={[styles.parseBtnText, { color: smsText.trim() ? colors.primaryForeground : colors.mutedForeground }]}>{t.parseSms}</Text></>
                    )}
                  </TouchableOpacity>
                </>
              )}

              {parsedResult && (
                <View style={[styles.parsedCard, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  <View style={styles.parsedHeader}>
                    <View style={[styles.parsedIconWrap, { backgroundColor: colors.success + "20" }]}>
                      <Feather name="check-circle" size={20} color={colors.success} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.parsedTitle, { color: colors.foreground }]}>Transaction Detected</Text>
                      <ConfidenceBadge confidence={parsedResult.confidence} colors={colors} />
                    </View>
                  </View>
                  <View style={{ gap: 10 }}>
                    {[
                      { label: "Amount", value: editAmount, setter: setEditAmount, kb: "numeric" as const },
                      { label: "Merchant", value: editMerchant, setter: setEditMerchant, kb: "default" as const },
                    ].map(f => (
                      <View key={f.label}>
                        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                        <TextInput
                          style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                          value={f.value} onChangeText={f.setter} keyboardType={f.kb}
                          placeholderTextColor={colors.mutedForeground}
                        />
                      </View>
                    ))}
                    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
                    <View style={styles.chipGrid}>
                      {EXPENSE_CATEGORIES.map(cat => (
                        <TouchableOpacity key={cat} style={[styles.chip, { backgroundColor: editCategory === cat ? colors.primary : colors.card }]} onPress={() => setEditCategory(cat)}>
                          <Text style={{ color: editCategory === cat ? colors.primaryForeground : colors.mutedForeground, fontSize: 11, fontWeight: "600" }}>
                            {CATEGORY_EMOJI[cat] ?? ""} {cat}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.success }]} onPress={confirmScannedExpense} disabled={confirming}>
                    {confirming ? <ActivityIndicator color={colors.successForeground} /> : (
                      <><Feather name="check" size={16} color={colors.successForeground} />
                        <Text style={[styles.saveBtnText, { color: colors.successForeground }]}>Confirm & Save</Text></>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Main Money Page ────────────────────────────────────────────────────────────
export default function MoneyPage() {
  const colors = useColors();
  const { t, isRTL }  = useLang();
  const { rates, formatAmount } = useCurrency();
  const tabBarPadding = useTabBarPadding();
  const [activeTab, setActiveTab] = useState<MoneyTab>("transactions");

  const TABS: { key: MoneyTab; icon: string; label: string }[] = [
    { key: "transactions", icon: "credit-card", label: t.transactions },
    { key: "bills",        icon: "file-text",   label: t.bills },
    { key: "currency",     icon: "globe",        label: t.currencyTab },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Page header */}
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>{t.moneyPage}</Text>
      </View>

      {/* Sub-tab navigation */}
      <View style={[styles.tabRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && { borderBottomColor: colors.primary, borderBottomWidth: 2.5 }]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Feather name={tab.icon as any} size={14} color={activeTab === tab.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.tabText, { color: activeTab === tab.key ? colors.primary : colors.mutedForeground, fontWeight: activeTab === tab.key ? "700" : "500" }]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tab content */}
      {activeTab === "bills" ? (
        <BillTracker />
      ) : activeTab === "currency" ? (
        <CurrencyPage />
      ) : (
        <TransactionsContent colors={colors} t={t} isRTL={isRTL} rates={rates} formatAmount={formatAmount} tabBarPadding={tabBarPadding} />
      )}
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  screenTitle: { fontSize: 26, fontWeight: "900" },
  tabRow: { flexDirection: "row", borderBottomWidth: 1 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 13 },
  actionsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  modeToggle: { flexDirection: "row", borderRadius: 12, padding: 4, flex: 1, marginRight: 10 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 7 },
  modeBtnText: { fontSize: 13, fontWeight: "600" },
  scanBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12 },
  scanBtnText: { fontSize: 13, fontWeight: "600" },
  addFab: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  totalBanner: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  bannerLabel: { fontSize: 12, fontWeight: "500" },
  bannerValue: { fontSize: 22, fontWeight: "900", marginTop: 2 },
  entryItem: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1 },
  entryIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginRight: 12 },
  entryInfo: { flex: 1, gap: 3 },
  entryMain: { fontSize: 14, fontWeight: "700" },
  entryMeta: { fontSize: 11 },
  origCurrBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  origCurrText: { fontSize: 10, fontWeight: "700" },
  entryRight: { alignItems: "flex-end", gap: 3 },
  entryAmount: { fontSize: 15, fontWeight: "800" },
  origAmtText: { fontSize: 10 },
  delBtn: { padding: 4 },
  emptyList: { alignItems: "center", paddingTop: 60, gap: 10 },
  emptyText: { fontSize: 16, fontWeight: "700" },
  emptyHint: { fontSize: 13 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  // Add modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  modalSub: { fontSize: 12, marginTop: 3 },
  fieldLabel: { fontSize: 13, fontWeight: "600", marginBottom: 6 },
  input: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 14 },
  curChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  curChipText: { fontSize: 11, fontWeight: "700" },
  qarPreview: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, padding: 8, marginTop: -10, marginBottom: 14 },
  qarPreviewText: { fontSize: 11, fontWeight: "500", flex: 1 },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  saveBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, paddingVertical: 15 },
  saveBtnText: { fontWeight: "800", fontSize: 16, color: "#fff" },
  // Scanner
  scanModal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, maxHeight: "92%", flex: 1 },
  scanTabRow: { flexDirection: "row", padding: 4, marginBottom: 16 },
  scanTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 8 },
  captureArea: { borderRadius: 20, padding: 32, alignItems: "center", gap: 12, borderWidth: 1, borderStyle: "dashed", marginBottom: 16 },
  captureIconWrap: { width: 72, height: 72, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  captureTitle: { fontSize: 16, fontWeight: "700" },
  captureSub: { fontSize: 13, textAlign: "center" },
  imagePreviewWrap: { borderRadius: 16, overflow: "hidden", position: "relative" },
  imagePreview: { width: "100%", height: 200 },
  retakeBtn: { position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  analysingBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 14 },
  textHintBox: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, marginBottom: 12 },
  clipboardBtn: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 12 },
  clipboardBtnText: { flex: 1, fontSize: 14, fontWeight: "600" },
  clipboardBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  smsListItem: { flexDirection: "row", alignItems: "center", borderRadius: 16, padding: 14, borderWidth: 1, gap: 12 },
  smsListLeft: { flex: 1, gap: 3 },
  smsListSender: { fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  smsListBody: { fontSize: 13, lineHeight: 18 },
  smsListDate: { fontSize: 11 },
  parseSmsBtn: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  smsInput: { borderRadius: 14, borderWidth: 1, padding: 14, minHeight: 120, fontSize: 14, marginBottom: 14 },
  parseBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 14 },
  parseBtnText: { fontWeight: "700", fontSize: 15 },
  parsedCard: { borderRadius: 20, padding: 16, borderWidth: 1, gap: 14 },
  parsedHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  parsedIconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  parsedTitle: { fontSize: 15, fontWeight: "700" },
});
