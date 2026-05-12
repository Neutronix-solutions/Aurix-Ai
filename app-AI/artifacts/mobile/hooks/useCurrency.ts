import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const CURRENCIES = [
  { code: "QAR", symbol: "QAR", name: "Qatari Riyal",    flag: "🇶🇦" },
  { code: "USD", symbol: "$",   name: "US Dollar",        flag: "🇺🇸" },
  { code: "EUR", symbol: "€",   name: "Euro",             flag: "🇪🇺" },
  { code: "GBP", symbol: "£",   name: "British Pound",    flag: "🇬🇧" },
  { code: "INR", symbol: "₹",   name: "Indian Rupee",     flag: "🇮🇳" },
  { code: "SAR", symbol: "SAR", name: "Saudi Riyal",      flag: "🇸🇦" },
  { code: "AED", symbol: "AED", name: "UAE Dirham",       flag: "🇦🇪" },
  { code: "KWD", symbol: "KWD", name: "Kuwaiti Dinar",    flag: "🇰🇼" },
  { code: "EGP", symbol: "EGP", name: "Egyptian Pound",   flag: "🇪🇬" },
] as const;

export type CurrencyCode = typeof CURRENCIES[number]["code"];

const STORAGE_KEY = "aurixai_currency";

// Default fallback rates (QAR → X), updated from the API
const FALLBACK_RATES: Record<string, number> = {
  QAR: 1,
  USD: 0.2747,
  EUR: 0.2534,
  GBP: 0.2169,
  INR: 22.88,
  SAR: 1.030,
  AED: 1.009,
  KWD: 0.0843,
  EGP: 13.47,
};

let globalCurrency: CurrencyCode = "QAR";
let globalRates: Record<string, number> = { ...FALLBACK_RATES };
const listeners = new Set<() => void>();

function notify() { listeners.forEach(fn => fn()); }

export function useCurrency() {
  const [currency, _setCurrency] = useState<CurrencyCode>(globalCurrency);
  const [rates, setRates]        = useState<Record<string, number>>(globalRates);

  // Subscribe to global changes
  useEffect(() => {
    const update = () => { _setCurrency(globalCurrency); setRates({ ...globalRates }); };
    listeners.add(update);
    return () => { listeners.delete(update); };
  }, []);

  // Rehydrate from storage on first mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved && CURRENCIES.some(c => c.code === saved)) {
        globalCurrency = saved as CurrencyCode;
        _setCurrency(globalCurrency);
        notify();
      }
    });
  }, []);

  const setCurrency = useCallback(async (code: CurrencyCode) => {
    globalCurrency = code;
    await AsyncStorage.setItem(STORAGE_KEY, code);
    notify();
  }, []);

  const updateRates = useCallback((newRates: Record<string, number>) => {
    globalRates = { QAR: 1, ...newRates };
    setRates({ ...globalRates });
  }, []);

  /** Convert from QAR to the selected display currency */
  const fromQAR = useCallback((qar: number): number => {
    const rate = globalRates[globalCurrency] ?? 1;
    return qar * rate;
  }, [currency]);

  /** Format QAR amount in the display currency */
  const formatAmount = useCallback((qar: number, opts?: { decimals?: number }): string => {
    const converted = fromQAR(qar);
    const cur = CURRENCIES.find(c => c.code === globalCurrency);
    const sym = cur?.symbol ?? globalCurrency;
    const dec = opts?.decimals ?? (globalCurrency === "KWD" ? 3 : globalCurrency === "INR" ? 0 : 2);
    return `${sym} ${converted.toLocaleString("en", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
  }, [currency, rates]);

  const currentCurrencyInfo = CURRENCIES.find(c => c.code === currency)!;

  return { currency, setCurrency, rates, updateRates, formatAmount, fromQAR, currentCurrencyInfo };
}
