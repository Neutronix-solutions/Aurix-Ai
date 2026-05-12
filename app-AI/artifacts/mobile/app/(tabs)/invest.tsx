import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView,
  Platform, ScrollView, RefreshControl, Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortfolio, useCreatePortfolioHolding, useDeletePortfolioHolding,
  useUpdatePortfolioHolding, useGetPortfolioSummary, useAwardPoints,
  getGetPortfolioQueryKey, getGetPortfolioSummaryQueryKey,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/context/LanguageContext";
import { authFetchRaw } from "@/lib/authFetch";

// ─── Types ────────────────────────────────────────────────────────────────────
type MarketItem = {
  symbol: string; name: string; emoji: string; type: string;
  priceUSD: number; priceQAR: number; change24h: number;
  sector?: string; featured?: boolean; extra?: string | null;
  market?: string; localPrice?: number; localCurrency?: string;
};
type MarketData = {
  qse: MarketItem[]; gcc: MarketItem[]; us: MarketItem[];
  metals: MarketItem[]; crypto: MarketItem[]; etfs: MarketItem[];
  lastUpdated: string;
};
type GoldPrice = {
  goldOzUSD: number;
  perGramQAR24K: number;
  pricesByType: Record<string, number>;
  lastUpdated: string;
};
type GoldStore = {
  id: string; name: string; verified: boolean; emoji: string;
  location: string; rating: number; fee: number; speciality: string;
  goldTypes: string[];
  pricesByType: Record<string, number>;
};
type GoldHolding = {
  id: number; goldType: string; quantityGrams: number; avgBuyPrice: number;
  currentPricePerGram: number; currentValue: number; investedValue: number;
  pnl: number; pnlPct: number;
};
type GoldPortfolio = {
  holdings: GoldHolding[];
  summary: { totalValue: number; totalInvested: number; totalPnl: number; totalPnlPct: number };
};
type GoldTxn = {
  id: number; type: string; goldType: string; quantityGrams: number;
  pricePerGram: number; totalAmount: number; storeName: string | null; createdAt: string;
};

const GOLD_TYPE_LABELS: Record<string, string> = {
  "24K": "24K Gold (Pure)",
  "21K": "21K Gold (GCC)",
  "18K": "18K Gold",
  "coin": "Gold Coin (1oz)",
  "bar": "Gold Bar",
};
const GOLD_TYPE_ICONS: Record<string, string> = {
  "24K": "🥇", "21K": "🏅", "18K": "✨", "coin": "🪙", "bar": "🧱",
};

const MAIN_TABS = ["📊 Markets", "🥇 Gold", "💼 Portfolio"] as const;
type MainTab = typeof MAIN_TABS[number];
const SECTION_FILTERS = ["All", "Qatar", "GCC", "🇺🇸 US", "Gold & Metals", "Crypto", "ETFs"] as const;
type Filter = typeof SECTION_FILTERS[number];
const GOLD_TABS = ["🏪 Buy Gold", "📊 My Gold", "📜 History"] as const;
type GoldTab = typeof GOLD_TABS[number];

// ─── Sub-components ───────────────────────────────────────────────────────────
function PriceTag({ change, colors }: { change: number; colors: any }) {
  const isUp = change >= 0;
  return (
    <View style={[styles.changeChip, { backgroundColor: isUp ? colors.success + "20" : colors.danger + "20" }]}>
      <Feather name={isUp ? "trending-up" : "trending-down"} size={10} color={isUp ? colors.success : colors.danger} />
      <Text style={{ color: isUp ? colors.success : colors.danger, fontSize: 11, fontWeight: "700" }}>
        {isUp ? "+" : ""}{change.toFixed(2)}%
      </Text>
    </View>
  );
}

function FlashRow({ item, onAdd, colors, prevPrice }: { item: MarketItem; onAdd: () => void; colors: any; prevPrice?: number }) {
  const flashAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (prevPrice !== undefined && prevPrice !== item.priceQAR) {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: false }),
        Animated.timing(flashAnim, { toValue: 0, duration: 500, useNativeDriver: false }),
      ]).start();
    }
  }, [item.priceQAR]);
  const flashBg = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", item.change24h >= 0 ? "#00C89628" : "#FF4D6D28"],
  });
  return (
    <Animated.View style={{ backgroundColor: flashBg, borderRadius: 14 }}>
      <View style={[styles.marketRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.mktEmoji, { backgroundColor: colors.accent }]}>
          <Text style={{ fontSize: 18 }}>{item.emoji}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.mktSymbol, { color: colors.foreground }]}>{item.symbol}</Text>
          <Text style={[styles.mktName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {item.name}{item.sector ? ` · ${item.sector}` : ""}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 3, marginRight: 8 }}>
          <Text style={[styles.mktPrice, { color: colors.foreground }]}>
            QAR {item.priceQAR >= 1000
              ? item.priceQAR.toLocaleString("en", { maximumFractionDigits: 0 })
              : item.priceQAR.toFixed(item.priceQAR < 1 ? 4 : 2)}
          </Text>
          <PriceTag change={item.change24h} colors={colors} />
        </View>
        <TouchableOpacity style={[styles.addMktBtn, { backgroundColor: colors.primary + "20" }]} onPress={onAdd}>
          <Feather name="plus" size={14} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function SectionHeader({ title, emoji, colors }: { title: string; emoji: string; colors: any }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={{ fontSize: 16 }}>{emoji}</Text>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

function HoldingRow({ item, onDelete, onEdit, colors }: { item: any; onDelete: () => void; onEdit: () => void; colors: any }) {
  const pnl = (item.currentPrice - item.buyPrice) * item.quantity;
  const isProfit = pnl >= 0;
  const pnlPct = item.buyPrice > 0 ? (pnl / (item.buyPrice * item.quantity)) * 100 : 0;
  return (
    <View style={[styles.holdingRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.holdingBadge, { backgroundColor: isProfit ? colors.success + "18" : colors.danger + "18" }]}>
        <Text style={[styles.holdingBadgeText, { color: isProfit ? colors.success : colors.danger }]}>
          {item.symbol?.slice(0, 3).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.holdingName, { color: colors.foreground }]}>{item.name}</Text>
        <Text style={[styles.holdingMeta, { color: colors.mutedForeground }]}>
          {item.quantity} × QAR {Number(item.currentPrice).toLocaleString("en", { maximumFractionDigits: 2 })}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[styles.holdingValue, { color: colors.foreground }]}>
          QAR {(item.currentPrice * item.quantity).toLocaleString("en", { maximumFractionDigits: 0 })}
        </Text>
        <Text style={[styles.holdingPnl, { color: isProfit ? colors.success : colors.danger }]}>
          {isProfit ? "+" : ""}{pnl.toFixed(0)} ({isProfit ? "+" : ""}{pnlPct.toFixed(1)}%)
        </Text>
      </View>
      <View style={styles.holdingBtns}>
        <TouchableOpacity onPress={onEdit} style={styles.holdIconBtn}><Feather name="edit-2" size={13} color={colors.mutedForeground} /></TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.holdIconBtn}><Feather name="trash-2" size={13} color={colors.mutedForeground} /></TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Gold Marketplace ─────────────────────────────────────────────────────────
function GoldTickerBar({ goldPrice, colors }: { goldPrice: GoldPrice | null; colors: any }) {
  if (!goldPrice) return null;
  return (
    <View style={[styles.goldTicker, { backgroundColor: "#D4AF3712", borderColor: "#D4AF3740" }]}>
      <Text style={{ fontSize: 18 }}>🥇</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#D4AF37", fontWeight: "800", fontSize: 16 }}>
          QAR {goldPrice.perGramQAR24K.toFixed(2)} / gram (24K)
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          ${goldPrice.goldOzUSD.toLocaleString("en", { maximumFractionDigits: 0 })} / troy oz · Live
        </Text>
      </View>
      <View style={[styles.liveBadge, { backgroundColor: colors.success + "22" }]}>
        <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
        <Text style={{ color: colors.success, fontSize: 10, fontWeight: "700" }}>LIVE</Text>
      </View>
    </View>
  );
}

function StoreCard({ store, onSelect, colors }: { store: GoldStore; onSelect: () => void; colors: any }) {
  return (
    <TouchableOpacity
      style={[styles.storeCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onSelect}
      activeOpacity={0.8}
    >
      <View style={styles.storeTop}>
        <View style={[styles.storeEmoji, { backgroundColor: "#D4AF3718" }]}>
          <Text style={{ fontSize: 26 }}>{store.emoji}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.storeName, { color: colors.foreground }]}>{store.name}</Text>
            {store.verified && (
              <View style={[styles.verifiedBadge, { backgroundColor: colors.success + "22" }]}>
                <Feather name="check-circle" size={10} color={colors.success} />
                <Text style={{ color: colors.success, fontSize: 9, fontWeight: "700" }}>Verified</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Feather name="map-pin" size={11} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{store.location}</Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>⭐ {store.rating} · {store.speciality}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Fee</Text>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 13 }}>{(store.fee * 100).toFixed(1)}%</Text>
        </View>
      </View>
      <View style={[styles.storeTypes, { borderTopColor: colors.border }]}>
        {store.goldTypes.map(gt => (
          <View key={gt} style={[styles.goldTypeChip, { backgroundColor: "#D4AF3718", borderColor: "#D4AF3730" }]}>
            <Text style={{ fontSize: 12 }}>{GOLD_TYPE_ICONS[gt] ?? "🥇"}</Text>
            <View>
              <Text style={{ color: "#D4AF37", fontWeight: "700", fontSize: 11 }}>{gt}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                QAR {(store.pricesByType[gt] ?? 0).toFixed(0)}/g
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={[styles.buyNowBtn, { backgroundColor: "#D4AF37" }]}>
        <Feather name="shopping-cart" size={14} color="#0A0A0F" />
        <Text style={{ color: "#0A0A0F", fontWeight: "700", fontSize: 13 }}>Buy Gold Here</Text>
      </View>
    </TouchableOpacity>
  );
}

function GoldHoldingCard({ h, colors }: { h: GoldHolding; colors: any }) {
  const isProfit = h.pnl >= 0;
  return (
    <View style={[styles.goldHoldCard, { backgroundColor: colors.card, borderColor: isProfit ? colors.success + "30" : colors.danger + "30" }]}>
      <View style={styles.goldHoldTop}>
        <View style={[styles.goldHoldIcon, { backgroundColor: "#D4AF3718" }]}>
          <Text style={{ fontSize: 22 }}>{GOLD_TYPE_ICONS[h.goldType] ?? "🥇"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.goldHoldName, { color: colors.foreground }]}>{GOLD_TYPE_LABELS[h.goldType] ?? h.goldType}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            {h.quantityGrams.toFixed(2)}g · Avg QAR {h.avgBuyPrice.toFixed(2)}/g
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>
            QAR {h.currentValue.toLocaleString("en", { maximumFractionDigits: 0 })}
          </Text>
          <Text style={{ color: isProfit ? colors.success : colors.danger, fontSize: 13, fontWeight: "600" }}>
            {isProfit ? "+" : ""}QAR {h.pnl.toFixed(0)} ({isProfit ? "+" : ""}{h.pnlPct.toFixed(1)}%)
          </Text>
        </View>
      </View>
      <View style={[styles.goldHoldDetails, { borderTopColor: colors.border }]}>
        <View style={styles.goldHoldStat}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Invested</Text>
          <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>QAR {h.investedValue.toLocaleString("en", { maximumFractionDigits: 0 })}</Text>
        </View>
        <View style={styles.goldHoldStat}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>Live Price</Text>
          <Text style={{ color: "#D4AF37", fontSize: 12, fontWeight: "600" }}>QAR {h.currentPricePerGram.toFixed(2)}/g</Text>
        </View>
        <View style={styles.goldHoldStat}>
          <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>P&L</Text>
          <Text style={{ color: isProfit ? colors.success : colors.danger, fontSize: 12, fontWeight: "700" }}>
            {isProfit ? "+" : ""}{h.pnlPct.toFixed(2)}%
          </Text>
        </View>
      </View>
    </View>
  );
}

function TxnRow({ txn, colors }: { txn: GoldTxn; colors: any }) {
  const isBuy = txn.type === "buy";
  return (
    <View style={[styles.txnRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.txnIcon, { backgroundColor: isBuy ? colors.success + "18" : colors.danger + "18" }]}>
        <Feather name={isBuy ? "arrow-down-circle" : "arrow-up-circle"} size={20} color={isBuy ? colors.success : colors.danger} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.txnTitle, { color: colors.foreground }]}>
          {isBuy ? "Bought" : "Sold"} {GOLD_TYPE_LABELS[txn.goldType] ?? txn.goldType}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>
          {txn.quantityGrams.toFixed(2)}g · {txn.storeName ?? "Direct"} · {new Date(txn.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: isBuy ? colors.danger : colors.success, fontWeight: "700", fontSize: 14 }}>
          {isBuy ? "-" : "+"}QAR {txn.totalAmount.toLocaleString("en", { maximumFractionDigits: 0 })}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>@ QAR {txn.pricePerGram.toFixed(2)}/g</Text>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function InvestScreen() {
  const colors = useColors();
  const { formatAmount } = useCurrency();
  const tabBarPadding = useTabBarPadding();
  const { language } = useLang();
  const queryClient = useQueryClient();

  const [mainTab,   setMainTab]   = useState<MainTab>("📊 Markets");
  const [goldTab,   setGoldTab]   = useState<GoldTab>("🏪 Buy Gold");
  const [filter,    setFilter]    = useState<Filter>("Qatar");
  const [markets,   setMarkets]   = useState<MarketData | null>(null);
  const [prevPrices, setPrevPrices] = useState<Record<string, number>>({});
  const [mktLoading, setMktLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Gold state
  const [goldPrice,     setGoldPrice]     = useState<GoldPrice | null>(null);
  const [goldStores,    setGoldStores]    = useState<GoldStore[]>([]);
  const [goldPortfolio, setGoldPortfolio] = useState<GoldPortfolio | null>(null);
  const [goldTxns,      setGoldTxns]      = useState<GoldTxn[]>([]);
  const [goldLoading,   setGoldLoading]   = useState(false);
  const [buyModal,      setBuyModal]      = useState(false);
  const [selectedStore, setSelectedStore] = useState<GoldStore | null>(null);
  const [buyType,       setBuyType]       = useState("24K");
  const [buyGrams,      setBuyGrams]      = useState("5");
  const [buying,        setBuying]        = useState(false);

  // Portfolio state
  const [showAdd,   setShowAdd]   = useState(false);
  const [editItem,  setEditItem]  = useState<any>(null);
  const [prefill,   setPrefill]   = useState<Partial<MarketItem> | null>(null);
  const [symbol,    setSymbol]    = useState("");
  const [holdName,  setHoldName]  = useState("");
  const [holdType,  setHoldType]  = useState("stock");
  const [qty,       setQty]       = useState("");
  const [buyP,      setBuyP]      = useState("");
  const [curP,      setCurP]      = useState("");
  const [updatedP,  setUpdatedP]  = useState("");

  const { data: holdings, isLoading: holdLoading, refetch: refetchHoldings } = useGetPortfolio();
  const { data: summary } = useGetPortfolioSummary();
  const createHolding = useCreatePortfolioHolding();
  const deleteHolding = useDeletePortfolioHolding();
  const updateHolding = useUpdatePortfolioHolding();
  const awardPoints   = useAwardPoints();

  // ── Market fetching ──────────────────────────────────────────────────────────
  const fetchMarkets = useCallback(async (silent = false) => {
    if (!silent) setMktLoading(true);
    try {
      const res = await authFetchRaw("/api/markets");
      if (res.ok) {
        const data: MarketData = await res.json();
        setMarkets(prev => {
          if (prev) {
            const pp: Record<string, number> = {};
            [...prev.qse, ...(prev.gcc ?? []), ...(prev.us ?? []), ...prev.metals, ...prev.crypto, ...prev.etfs]
              .forEach(i => { pp[i.symbol] = i.priceQAR; });
            setPrevPrices(pp);
          }
          return data;
        });
        setLastUpdated(new Date().toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    } catch { /* ignore */ } finally {
      if (!silent) setMktLoading(false);
    }
  }, []);

  // ── Gold fetching ────────────────────────────────────────────────────────────
  const fetchGoldData = useCallback(async () => {
    setGoldLoading(true);
    try {
      const [priceRes, storesRes, portfolioRes, txnsRes] = await Promise.all([
        authFetchRaw("/api/gold/price"),
        authFetchRaw("/api/gold/stores"),
        authFetchRaw("/api/gold/portfolio"),
        authFetchRaw("/api/gold/transactions"),
      ]);
      if (priceRes.ok)     setGoldPrice(await priceRes.json());
      if (storesRes.ok)    setGoldStores(await storesRes.json());
      if (portfolioRes.ok) setGoldPortfolio(await portfolioRes.json());
      if (txnsRes.ok)      setGoldTxns(await txnsRes.json());
    } catch { /* ignore */ } finally {
      setGoldLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
    timerRef.current = setInterval(() => fetchMarkets(true), 30_000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchMarkets]);

  useEffect(() => {
    if (mainTab === "🥇 Gold") fetchGoldData();
  }, [mainTab, fetchGoldData]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetPortfolioQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPortfolioSummaryQueryKey() });
  }, [queryClient]);

  const resetForm = () => { setSymbol(""); setHoldName(""); setHoldType("stock"); setQty(""); setBuyP(""); setCurP(""); setPrefill(null); };

  const openFromMarket = (item: MarketItem) => {
    setPrefill(item); setSymbol(item.symbol); setHoldName(item.name);
    setHoldType(item.type); setCurP(String(item.priceQAR)); setBuyP(String(item.priceQAR));
    setShowAdd(true);
  };

  const handleAdd = useCallback(() => {
    const q = parseFloat(qty), bp = parseFloat(buyP), cp = parseFloat(curP);
    if (!symbol || !holdName || isNaN(q) || isNaN(bp) || isNaN(cp)) { Alert.alert("Error", "Fill in all fields"); return; }
    createHolding.mutate(
      { data: { symbol, name: holdName, type: holdType as "stock" | "crypto" | "etf", quantity: q, buyPrice: bp, currentPrice: cp } },
      { onSuccess: () => { setShowAdd(false); resetForm(); invalidate(); awardPoints.mutate({ data: { action: "update_portfolio" } }); } },
    );
  }, [symbol, holdName, holdType, qty, buyP, curP, createHolding, invalidate, awardPoints]);

  // ── Gold buy ─────────────────────────────────────────────────────────────────
  const buyTotalQAR = (() => {
    const grams = parseFloat(buyGrams) || 0;
    const price = goldPrice?.pricesByType[buyType] ?? 0;
    const fee = selectedStore?.fee ?? 0.015;
    return parseFloat((grams * price * (1 + fee)).toFixed(2));
  })();

  const handleBuyGold = useCallback(() => {
    // Direct in-app gold purchases are not available yet — partner integration pending.
    // Show a friendly bilingual notice instead of attempting a checkout that would fail.
    const isAr = language === "ar";
    Alert.alert(
      isAr ? "الشراء غير متاح حالياً" : "Purchase Unavailable",
      isAr
        ? "شراء الذهب داخل التطبيق غير متاح حالياً. يرجى زيارة المتجر الشريك مباشرةً لإتمام الشراء. سنُفعّل الشراء المباشر قريباً."
        : "In-app gold purchases aren't available yet. Please visit the partner store directly to complete your purchase — direct buying is coming soon.",
      [{ text: "OK", onPress: () => setBuyModal(false) }],
    );
  }, [language]);

  // ── Build market list ────────────────────────────────────────────────────────
  const getFilteredItems = (): Array<{ type: "section"; title: string; emoji: string } | { type: "item"; item: MarketItem }> => {
    if (!markets) return [];
    const result: Array<{ type: "section"; title: string; emoji: string } | { type: "item"; item: MarketItem }> = [];
    if (filter === "All" || filter === "Qatar") {
      result.push({ type: "section", title: "Qatar Stock Exchange (QSE)", emoji: "🇶🇦" });
      markets.qse.forEach(i => result.push({ type: "item", item: i }));
    }
    if (filter === "All" || filter === "GCC") {
      result.push({ type: "section", title: "GCC Markets", emoji: "🌍" });
      (markets.gcc ?? []).forEach(i => result.push({ type: "item", item: i }));
    }
    if (filter === "All" || filter === "🇺🇸 US") {
      result.push({ type: "section", title: "US Stocks (NYSE / NASDAQ)", emoji: "🇺🇸" });
      (markets.us ?? []).forEach(i => result.push({ type: "item", item: i }));
    }
    if (filter === "All" || filter === "Gold & Metals") {
      result.push({ type: "section", title: "Precious Metals", emoji: "🥇" });
      markets.metals.forEach(i => result.push({ type: "item", item: i }));
    }
    if (filter === "All" || filter === "Crypto") {
      result.push({ type: "section", title: "Cryptocurrency", emoji: "₿" });
      markets.crypto.forEach(i => result.push({ type: "item", item: i }));
    }
    if (filter === "All" || filter === "ETFs") {
      result.push({ type: "section", title: "Global ETFs", emoji: "💹" });
      markets.etfs.forEach(i => result.push({ type: "item", item: i }));
    }
    return result;
  };

  const listData   = getFilteredItems();
  const holdingList = (holdings as any[]) ?? [];
  const s           = summary as any;
  const pnlColor    = (s?.totalPnl ?? 0) >= 0 ? colors.success : colors.danger;
  const gSummary    = goldPortfolio?.summary;

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.screenTitle, { color: colors.foreground }]}>
          {mainTab === "📊 Markets" ? "Markets" : mainTab === "🥇 Gold" ? "Gold Investment" : "Portfolio"}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          {mainTab === "📊 Markets" && lastUpdated
            ? <Text style={{ color: colors.success, fontSize: 10, fontWeight: "600" }}>● {lastUpdated}</Text>
            : null}
          {mainTab === "📊 Markets" && (
            <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.accent }]} onPress={() => fetchMarkets()}>
              <Feather name="refresh-cw" size={14} color={colors.primary} />
            </TouchableOpacity>
          )}
          {mainTab === "🥇 Gold" && (
            <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.accent }]} onPress={fetchGoldData}>
              <Feather name="refresh-cw" size={14} color={colors.primary} />
            </TouchableOpacity>
          )}
          {mainTab === "📊 Markets" && (
            <TouchableOpacity style={[styles.iconBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAdd(true)}>
              <Feather name="plus" size={18} color="#000" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main tab row */}
      <View style={[styles.mainTabRow, { borderBottomColor: colors.border }]}>
        {MAIN_TABS.map(t => (
          <TouchableOpacity
            key={t}
            style={[styles.mainTabBtn, mainTab === t && { borderBottomColor: t === "🥇 Gold" ? "#D4AF37" : colors.primary, borderBottomWidth: 2 }]}
            onPress={() => setMainTab(t)}
          >
            <Text style={[styles.mainTabText, { color: mainTab === t ? (t === "🥇 Gold" ? "#D4AF37" : colors.primary) : colors.mutedForeground }]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── MARKETS TAB ── */}
      {mainTab === "📊 Markets" && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
            {SECTION_FILTERS.map(f => (
              <TouchableOpacity key={f}
                style={[styles.filterChip, { backgroundColor: filter === f ? colors.primary : colors.accent }]}
                onPress={() => setFilter(f)}
              >
                <Text style={{ color: filter === f ? "#000" : colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {mktLoading ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 60 }} /> : (
            <FlatList
              data={listData}
              keyExtractor={(item, idx) => item.type === "section" ? `sec-${idx}` : item.item.symbol}
              contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: tabBarPadding }}
              renderItem={({ item: row }) => {
                if (row.type === "section") return <SectionHeader title={row.title} emoji={row.emoji} colors={colors} />;
                return <FlashRow item={row.item} colors={colors} onAdd={() => openFromMarket(row.item)} prevPrice={prevPrices[row.item.symbol]} />;
              }}
            />
          )}
        </>
      )}

      {/* ── GOLD TAB ── */}
      {mainTab === "🥇 Gold" && (
        <>
          {/* Gold sub-tabs */}
          <View style={[styles.goldSubTabRow, { borderBottomColor: colors.border }]}>
            {GOLD_TABS.map(gt => (
              <TouchableOpacity key={gt}
                style={[styles.goldSubTabBtn, goldTab === gt && { borderBottomColor: "#D4AF37", borderBottomWidth: 2 }]}
                onPress={() => setGoldTab(gt)}
              >
                <Text style={[styles.goldSubTabText, { color: goldTab === gt ? "#D4AF37" : colors.mutedForeground }]}>{gt}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {goldLoading && <ActivityIndicator color="#D4AF37" style={{ marginTop: 40 }} />}

          {/* 🏪 Buy Gold */}
          {goldTab === "🏪 Buy Gold" && !goldLoading && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: tabBarPadding }}>
              <GoldTickerBar goldPrice={goldPrice} colors={colors} />

              {/* Gold type selector */}
              <View style={[styles.goldTypeSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Select Gold Type</Text>
                <View style={styles.goldTypeGrid}>
                  {Object.entries(GOLD_TYPE_LABELS).map(([type, label]) => (
                    <TouchableOpacity
                      key={type}
                      style={[styles.goldTypeBtn, { backgroundColor: buyType === type ? "#D4AF3722" : colors.accent, borderColor: buyType === type ? "#D4AF37" : colors.border }]}
                      onPress={() => setBuyType(type)}
                    >
                      <Text style={{ fontSize: 20 }}>{GOLD_TYPE_ICONS[type] ?? "🥇"}</Text>
                      <Text style={{ color: buyType === type ? "#D4AF37" : colors.foreground, fontWeight: "700", fontSize: 12 }}>{type}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>{label.split(" ").slice(2).join(" ")}</Text>
                      <Text style={{ color: "#D4AF37", fontWeight: "700", fontSize: 11 }}>
                        QAR {(goldPrice?.pricesByType[type] ?? 0).toFixed(2)}/g
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Partner stores */}
              <Text style={[styles.sectionLabelBig, { color: colors.foreground }]}>🏪 Partner Stores</Text>
              {goldStores
                .filter(s => s.goldTypes.includes(buyType))
                .map(store => (
                  <StoreCard key={store.id} store={store} colors={colors} onSelect={() => { setSelectedStore(store); setBuyModal(true); }} />
                ))}
            </ScrollView>
          )}

          {/* 📊 My Gold */}
          {goldTab === "📊 My Gold" && !goldLoading && (
            <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: tabBarPadding }}
              refreshControl={<RefreshControl refreshing={false} onRefresh={fetchGoldData} tintColor="#D4AF37" />}>

              {/* Summary card */}
              {gSummary && (
                <View style={[styles.goldSummaryCard, { borderColor: "#D4AF3740" }]}>
                  <View style={styles.goldSummaryTop}>
                    <View>
                      <Text style={{ color: "#D4AF37AA", fontSize: 12, fontWeight: "600", marginBottom: 4 }}>Total Gold Value</Text>
                      <Text style={{ color: "#D4AF37", fontWeight: "800", fontSize: 26 }}>
                        {formatAmount(gSummary.totalValue, { decimals: 0 })}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: "#D4AF37AA", fontSize: 12, marginBottom: 4 }}>P&L</Text>
                      <Text style={{ color: gSummary.totalPnl >= 0 ? colors.success : colors.danger, fontWeight: "700", fontSize: 18 }}>
                        {gSummary.totalPnl >= 0 ? "+" : "-"}{formatAmount(Math.abs(gSummary.totalPnl), { decimals: 0 })}
                      </Text>
                      <Text style={{ color: gSummary.totalPnl >= 0 ? colors.success : colors.danger, fontSize: 13 }}>
                        {gSummary.totalPnl >= 0 ? "+" : ""}{gSummary.totalPnlPct.toFixed(2)}%
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.goldSummaryDetails, { borderTopColor: "#D4AF3730" }]}>
                    <View>
                      <Text style={{ color: "#D4AF37AA", fontSize: 10 }}>Total Invested</Text>
                      <Text style={{ color: "#D4AF37", fontWeight: "600", fontSize: 13 }}>
                        {formatAmount(gSummary.totalInvested, { decimals: 0 })}
                      </Text>
                    </View>
                    <View style={{ alignItems: "center" }}>
                      <Text style={{ color: "#D4AF37AA", fontSize: 10 }}>Live Price</Text>
                      <Text style={{ color: "#D4AF37", fontWeight: "600", fontSize: 13 }}>
                        QAR {(goldPrice?.perGramQAR24K ?? 0).toFixed(2)}/g (24K)
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={{ color: "#D4AF37AA", fontSize: 10 }}>Holdings</Text>
                      <Text style={{ color: "#D4AF37", fontWeight: "600", fontSize: 13 }}>
                        {goldPortfolio?.holdings.length ?? 0} types
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {goldPortfolio?.holdings.length === 0 ? (
                <View style={{ alignItems: "center", paddingTop: 40, gap: 12 }}>
                  <Text style={{ fontSize: 56 }}>🥇</Text>
                  <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>No gold yet</Text>
                  <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 13 }}>
                    Go to "Buy Gold" to purchase your first gold from verified Doha stores.
                  </Text>
                  <TouchableOpacity
                    style={[styles.buyFirstBtn, { backgroundColor: "#D4AF37" }]}
                    onPress={() => setGoldTab("🏪 Buy Gold")}
                  >
                    <Text style={{ color: "#0A0A0F", fontWeight: "700", fontSize: 15 }}>🏪 Browse Stores</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                goldPortfolio?.holdings.map(h => <GoldHoldingCard key={h.id} h={h} colors={colors} />)
              )}
            </ScrollView>
          )}

          {/* 📜 History */}
          {goldTab === "📜 History" && !goldLoading && (
            <FlatList
              data={goldTxns}
              keyExtractor={item => String(item.id)}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: tabBarPadding }}
              refreshControl={<RefreshControl refreshing={false} onRefresh={fetchGoldData} tintColor="#D4AF37" />}
              ListEmptyComponent={
                <View style={{ alignItems: "center", paddingTop: 60, gap: 12 }}>
                  <Text style={{ fontSize: 44 }}>📜</Text>
                  <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>No transactions yet</Text>
                  <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 13 }}>Buy gold to see your history here.</Text>
                </View>
              }
              renderItem={({ item }) => <TxnRow txn={item} colors={colors} />}
            />
          )}
        </>
      )}

      {/* ── PORTFOLIO TAB ── */}
      {mainTab === "💼 Portfolio" && (
        <ScrollView contentContainerStyle={{ paddingBottom: tabBarPadding }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={refetchHoldings} tintColor={colors.primary} />}>
          {s && (
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.summaryRow}>
                <View>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Value</Text>
                  <Text style={[styles.summaryVal, { color: colors.foreground }]}>
                    {formatAmount(s.totalValue ?? 0, { decimals: 0 })}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total P&L</Text>
                  <Text style={[styles.summaryVal, { color: pnlColor }]}>
                    {(s.totalPnl ?? 0) >= 0 ? "+" : "-"}{formatAmount(Math.abs(s.totalPnl ?? 0), { decimals: 0 })}
                    {" "}({(s.totalPnlPercent ?? 0) >= 0 ? "+" : ""}{(s.totalPnlPercent ?? 0).toFixed(1)}%)
                  </Text>
                </View>
              </View>
              {s.allocation?.length > 0 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {s.allocation.map((a: any, i: number) => (
                    <View key={a.type} style={[styles.allocChip, { backgroundColor: colors.accent }]}>
                      <View style={[styles.allocDot, { backgroundColor: [colors.chart1, colors.chart2, colors.chart3, colors.chart4, colors.chart5][i % 5] }]} />
                      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{a.type}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>{a.percentage.toFixed(0)}%</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
          {holdLoading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> :
            holdingList.length === 0 ? (
              <View style={{ alignItems: "center", paddingTop: 60, gap: 12, padding: 24 }}>
                <Text style={{ fontSize: 48 }}>📊</Text>
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No holdings yet</Text>
                <Text style={{ color: colors.mutedForeground, textAlign: "center", fontSize: 13 }}>
                  Switch to Live Markets, tap any row and add it to your portfolio.
                </Text>
              </View>
            ) : (
              <View style={{ padding: 16, gap: 10 }}>
                {holdingList.map((item: any) => (
                  <HoldingRow key={item.id} item={item} colors={colors}
                    onDelete={() => Alert.alert("Delete", "Remove this holding?", [
                      { text: "Cancel", style: "cancel" },
                      { text: "Delete", style: "destructive", onPress: () => deleteHolding.mutate({ id: item.id }, { onSuccess: invalidate }) },
                    ])}
                    onEdit={() => { setEditItem(item); setUpdatedP(String(item.currentPrice)); }}
                  />
                ))}
              </View>
            )}
        </ScrollView>
      )}

      {/* ── BUY GOLD MODAL ── */}
      <Modal visible={buyModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.modal, { backgroundColor: colors.card, borderColor: "#D4AF3740" }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>Buy Gold</Text>
                  {selectedStore && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <Feather name="check-circle" size={12} color={colors.success} />
                      <Text style={{ color: colors.success, fontSize: 12 }}>{selectedStore.name} · Verified Partner</Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity onPress={() => setBuyModal(false)}>
                  <Feather name="x" size={22} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {/* Gold type chips */}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Gold Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {(selectedStore?.goldTypes ?? Object.keys(GOLD_TYPE_LABELS)).map(type => (
                    <TouchableOpacity key={type}
                      style={[styles.goldModalChip, { backgroundColor: buyType === type ? "#D4AF3722" : colors.accent, borderColor: buyType === type ? "#D4AF37" : colors.border }]}
                      onPress={() => setBuyType(type)}
                    >
                      <Text style={{ fontSize: 16 }}>{GOLD_TYPE_ICONS[type] ?? "🥇"}</Text>
                      <Text style={{ color: buyType === type ? "#D4AF37" : colors.foreground, fontWeight: "700", fontSize: 12 }}>{type}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 10 }}>
                        QAR {(goldPrice?.pricesByType[type] ?? 0).toFixed(2)}/g
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Grams input */}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Amount (grams)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.input, borderColor: "#D4AF3760", color: colors.foreground }]}
                value={buyGrams} onChangeText={setBuyGrams} keyboardType="numeric" placeholder="e.g. 5"
                placeholderTextColor={colors.mutedForeground}
              />

              {/* Quick gram buttons */}
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
                {["1", "2", "5", "10", "20"].map(g => (
                  <TouchableOpacity key={g}
                    style={[styles.quickGram, { backgroundColor: buyGrams === g ? "#D4AF3722" : colors.accent, borderColor: buyGrams === g ? "#D4AF37" : colors.border }]}
                    onPress={() => setBuyGrams(g)}
                  >
                    <Text style={{ color: buyGrams === g ? "#D4AF37" : colors.mutedForeground, fontWeight: "600", fontSize: 12 }}>{g}g</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Price breakdown */}
              {goldPrice && (
                <View style={[styles.priceBreakdown, { backgroundColor: colors.accent, borderColor: "#D4AF3730" }]}>
                  <View style={styles.priceRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Price per gram ({buyType})</Text>
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>QAR {(goldPrice.pricesByType[buyType] ?? 0).toFixed(2)}</Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{parseFloat(buyGrams) || 0}g × QAR {(goldPrice.pricesByType[buyType] ?? 0).toFixed(2)}</Text>
                    <Text style={{ color: colors.foreground, fontWeight: "600" }}>
                      QAR {((parseFloat(buyGrams) || 0) * (goldPrice.pricesByType[buyType] ?? 0)).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.priceRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Partner fee ({((selectedStore?.fee ?? 0.015) * 100).toFixed(1)}%)</Text>
                    <Text style={{ color: colors.mutedForeground }}>
                      +QAR {((parseFloat(buyGrams) || 0) * (goldPrice.pricesByType[buyType] ?? 0) * (selectedStore?.fee ?? 0.015)).toFixed(2)}
                    </Text>
                  </View>
                  <View style={[styles.priceRow, { borderTopWidth: 1, borderTopColor: "#D4AF3730", paddingTop: 8, marginTop: 4 }]}>
                    <Text style={{ color: "#D4AF37", fontWeight: "700", fontSize: 15 }}>Total</Text>
                    <Text style={{ color: "#D4AF37", fontWeight: "800", fontSize: 17 }}>QAR {buyTotalQAR.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[styles.confirmBuyBtn, { backgroundColor: "#D4AF37", opacity: buying ? 0.7 : 1 }]}
                onPress={handleBuyGold}
                disabled={buying}
              >
                {buying
                  ? <ActivityIndicator color="#0A0A0F" />
                  : <>
                      <Feather name="shopping-cart" size={18} color="#0A0A0F" />
                      <Text style={{ color: "#0A0A0F", fontWeight: "800", fontSize: 16 }}>
                        Confirm Purchase · QAR {buyTotalQAR.toLocaleString("en", { maximumFractionDigits: 0 })}
                      </Text>
                    </>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Add Portfolio Holding Modal ── */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
            <ScrollView style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>{prefill ? `Add ${prefill.symbol}` : "Add Holding"}</Text>
                <TouchableOpacity onPress={() => { setShowAdd(false); resetForm(); }}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
              </View>
              {[
                { label: "Symbol",              value: symbol,   set: setSymbol,   ph: "QNBK",    kb: "default" as const },
                { label: "Name",                value: holdName, set: setHoldName, ph: "QNB Group",kb: "default" as const },
                { label: "Quantity",            value: qty,      set: setQty,      ph: "10",      kb: "numeric" as const },
                { label: "Buy Price (QAR)",     value: buyP,     set: setBuyP,     ph: "0.00",    kb: "numeric" as const },
                { label: "Current Price (QAR)", value: curP,     set: setCurP,     ph: "0.00",    kb: "numeric" as const },
              ].map(f => (
                <View key={f.label} style={{ marginBottom: 12 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                  <TextInput style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
                    value={f.value} onChangeText={f.set} keyboardType={f.kb} placeholder={f.ph} placeholderTextColor={colors.mutedForeground} />
                </View>
              ))}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {["stock", "crypto", "etf", "commodity", "bond", "cash"].map(ht => (
                  <TouchableOpacity key={ht} style={[styles.typeChip, { backgroundColor: holdType === ht ? colors.primary : colors.accent }]} onPress={() => setHoldType(ht)}>
                    <Text style={{ color: holdType === ht ? "#000" : colors.mutedForeground, fontSize: 12, fontWeight: "600" }}>{ht}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={handleAdd} disabled={createHolding.isPending}>
                {createHolding.isPending ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>Add Holding</Text>}
              </TouchableOpacity>
              <View style={{ height: 32 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Update price modal ── */}
      <Modal visible={!!editItem} animationType="slide" transparent>
        <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
          <View style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Update Price</Text>
              <TouchableOpacity onPress={() => setEditItem(null)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
            </View>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Current Price (QAR)</Text>
            <TextInput style={[styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }]}
              value={updatedP} onChangeText={setUpdatedP} keyboardType="numeric" placeholderTextColor={colors.mutedForeground} />
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                const cp = parseFloat(updatedP);
                if (isNaN(cp)) { Alert.alert("Error", "Enter valid price"); return; }
                updateHolding.mutate({ id: editItem.id, data: { currentPrice: cp } }, {
                  onSuccess: () => { setEditItem(null); setUpdatedP(""); invalidate(); },
                });
              }}
              disabled={updateHolding.isPending}
            >
              {updateHolding.isPending ? <ActivityIndicator color="#000" /> : <Text style={{ color: "#000", fontWeight: "700", fontSize: 16 }}>Update</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  screenTitle: { fontSize: 22, fontWeight: "700" },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  mainTabRow: { flexDirection: "row", borderBottomWidth: 1 },
  mainTabBtn: { flex: 1, paddingVertical: 12, alignItems: "center" },
  mainTabText: { fontWeight: "700", fontSize: 13 },
  goldSubTabRow: { flexDirection: "row", borderBottomWidth: 1 },
  goldSubTabBtn: { flex: 1, paddingVertical: 10, alignItems: "center" },
  goldSubTabText: { fontWeight: "600", fontSize: 12 },

  // Market rows
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  marketRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, borderWidth: 1, gap: 10 },
  mktEmoji: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  mktSymbol: { fontWeight: "700", fontSize: 14 },
  mktName: { fontSize: 11, marginTop: 1 },
  mktPrice: { fontWeight: "600", fontSize: 13 },
  changeChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  addMktBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  sectionTitle: { fontWeight: "700", fontSize: 13 },

  // Gold ticker
  goldTicker: { borderRadius: 16, padding: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },

  // Gold type section
  goldTypeSection: { borderRadius: 16, padding: 16, borderWidth: 1, gap: 12 },
  sectionLabel: { fontSize: 12, fontWeight: "600" },
  sectionLabelBig: { fontSize: 16, fontWeight: "700" },
  goldTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  goldTypeBtn: { width: "47%", borderRadius: 14, padding: 14, borderWidth: 1.5, alignItems: "center", gap: 4 },

  // Store card
  storeCard: { borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  storeTop: { flexDirection: "row", alignItems: "flex-start", padding: 16, gap: 12 },
  storeEmoji: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  storeName: { fontSize: 15, fontWeight: "700" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  storeTypes: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 12, borderTopWidth: 1, paddingTop: 12 },
  goldTypeChip: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, padding: 8, borderWidth: 1 },
  buyNowBtn: { margin: 12, marginTop: 4, borderRadius: 12, paddingVertical: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },

  // Gold holding card
  goldSummaryCard: { borderRadius: 20, padding: 20, borderWidth: 1, backgroundColor: "#D4AF3710" },
  goldSummaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  goldSummaryDetails: { flexDirection: "row", justifyContent: "space-between", paddingTop: 16, borderTopWidth: 1 },
  goldHoldCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  goldHoldTop: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  goldHoldIcon: { width: 46, height: 46, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  goldHoldName: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  goldHoldDetails: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderTopWidth: 1 },
  goldHoldStat: { alignItems: "center", gap: 3 },
  buyFirstBtn: { paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginTop: 4 },

  // Transaction row
  txnRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, borderWidth: 1, gap: 12 },
  txnIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  txnTitle: { fontWeight: "600", fontSize: 14, marginBottom: 2 },

  // Portfolio summary
  summaryCard: { margin: 16, borderRadius: 20, padding: 18, borderWidth: 1, gap: 14 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 12, fontWeight: "500", marginBottom: 4 },
  summaryVal: { fontSize: 20, fontWeight: "800" },
  allocChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  allocDot: { width: 8, height: 8, borderRadius: 4 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },

  // Holdings
  holdingRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, borderWidth: 1, gap: 10 },
  holdingBadge: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  holdingBadgeText: { fontWeight: "800", fontSize: 12 },
  holdingName: { fontWeight: "600", fontSize: 14 },
  holdingMeta: { fontSize: 11, marginTop: 2 },
  holdingValue: { fontWeight: "700", fontSize: 14 },
  holdingPnl: { fontSize: 12, fontWeight: "600" },
  holdingBtns: { flexDirection: "row", gap: 4 },
  holdIconBtn: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },

  // Modals
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 8 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 6 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center", marginTop: 4 },

  // Gold modal
  goldModalChip: { borderRadius: 12, padding: 10, borderWidth: 1.5, alignItems: "center", gap: 3, minWidth: 80 },
  quickGram: { flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  priceBreakdown: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 10, marginBottom: 16 },
  priceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  confirmBuyBtn: { borderRadius: 16, paddingVertical: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
});
