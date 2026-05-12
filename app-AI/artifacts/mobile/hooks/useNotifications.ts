import { useEffect, useRef, useCallback } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// expo-notifications handler is not supported on web — use the browser Notification API instead
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

// ── Permission management ─────────────────────────────────────────────────────
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      const perm = await Notification.requestPermission();
      return perm === "granted";
    }
    return typeof Notification !== "undefined" && Notification.permission === "granted";
  }
  // The NotificationPermissionsStatus type extends PermissionResponse from
  // expo-modules-core (which exposes `status` + `granted`), but TS resolution
  // through expo's `react-native` customCondition occasionally drops those
  // base fields. Narrow via a known-shape view.
  type PermView = { status: string; granted: boolean };
  const existing = (await Notifications.getPermissionsAsync()) as unknown as PermView;
  if (existing.granted || existing.status === "granted") return true;
  const result = (await Notifications.requestPermissionsAsync()) as unknown as PermView;
  return result.granted || result.status === "granted";
}

// ── Send helpers ──────────────────────────────────────────────────────────────
export async function sendLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
  if (Platform.OS === "web") {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon.png" });
    }
    return;
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: true, data: data ?? {} },
    trigger: null,
  });
}

export async function sendMarketAlert(symbol: string, change: number, priceQAR: number) {
  const dir   = change >= 0 ? "📈 UP" : "📉 DOWN";
  const emoji = change >= 0 ? "📈" : "📉";
  await sendLocalNotification(
    `${emoji} ${symbol} moved ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
    `${symbol} is ${dir} ${Math.abs(change).toFixed(1)}% today at QAR ${priceQAR.toFixed(2)}. Tap to view.`,
    { type: "market", symbol },
  );
}

export async function sendBudgetAlert(category: string, spent: number, limit: number, pct: number) {
  const exceeded = pct >= 1;
  await sendLocalNotification(
    exceeded ? `🚨 ${category} budget exceeded!` : `⚠️ ${category} at ${Math.round(pct * 100)}%`,
    exceeded
      ? `Spent QAR ${spent.toFixed(0)} — exceeded your QAR ${limit.toFixed(0)} limit this month.`
      : `QAR ${spent.toFixed(0)} of QAR ${limit.toFixed(0)} used. QAR ${(limit - spent).toFixed(0)} left.`,
    { type: "budget", category },
  );
}

export async function checkBudgetAndNotify(monthlySpent: number, monthlyIncome: number) {
  if (monthlyIncome <= 0) return;
  const spendRate = monthlySpent / monthlyIncome;
  if (spendRate >= 0.9) {
    await sendLocalNotification(
      "⚠️ Budget Alert",
      `You've spent QAR ${monthlySpent.toFixed(0)} — ${Math.round(spendRate * 100)}% of your monthly income!`,
      { type: "budget_general" },
    );
  } else if (spendRate >= 0.75) {
    await sendLocalNotification(
      "💡 Spending Check",
      `You've used ${Math.round(spendRate * 100)}% of your monthly income. QAR ${(monthlyIncome - monthlySpent).toFixed(0)} remaining.`,
      { type: "budget_general" },
    );
  }
}

// ── Market prices tracker (in-memory, session only) ───────────────────────────
const lastMarketPrices: Record<string, number> = {};
const THRESHOLD = 2.0; // percent

// ── Server-side alert poller ──────────────────────────────────────────────────
export function useAlertPoller(onNewAlerts: (count: number) => void) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async (currentMarketPrices?: Record<string, number>) => {
    const token = await AsyncStorage.getItem("aurixai_token");
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/alerts/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ marketPrices: currentMarketPrices ?? {} }),
      });
      if (!res.ok) return;
      const data = await res.json() as { new: any[]; count: number };
      if (data.count > 0) {
        // Fire a local notification for each new alert
        for (const a of data.new) {
          await sendLocalNotification(a.title ?? "Aurix AI Alert", a.body ?? "", { type: a.alertType });
        }
        onNewAlerts(data.count);
      }
    } catch { /* ignore network failures */ }
  }, [onNewAlerts]);

  useEffect(() => {
    requestNotificationPermissions();
    // First poll after 5s (on app start), then every 60s
    const initial = setTimeout(() => poll(), 5000);
    timerRef.current = setInterval(() => poll(), 60_000);
    return () => {
      clearTimeout(initial);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  return { pollNow: poll };
}

// ── Market price watcher — call with latest prices from /api/markets ─────────
export async function checkMarketAlertsAndNotify(
  prices: Record<string, number>,
  onAlert?: (symbol: string, change: number) => void
) {
  for (const [sym, price] of Object.entries(prices)) {
    const prev = lastMarketPrices[sym];
    if (prev === undefined) { lastMarketPrices[sym] = price; continue; }
    const change = ((price - prev) / prev) * 100;
    if (Math.abs(change) >= THRESHOLD) {
      await sendMarketAlert(sym, change, price);
      onAlert?.(sym, change);
      lastMarketPrices[sym] = price; // update so we don't re-alert
    }
  }
  // update all tracked prices
  for (const [sym, price] of Object.entries(prices)) {
    lastMarketPrices[sym] = price;
  }
}

// ── Hook used in tab layout ───────────────────────────────────────────────────
// Note: useAlertPoller (called inside this hook) already requests permissions.
// We only add the notification received listener here to avoid a double-prompt.
export function useNotifications(onNewAlerts?: (count: number) => void) {
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const { pollNow } = useAlertPoller(onNewAlerts ?? (() => {}));

  useEffect(() => {
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {});
    return () => {
      if (notificationListener.current) notificationListener.current.remove();
    };
  }, []);

  return { pollNow };
}
