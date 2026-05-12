import { Router, Request } from "express";
import { db, alerts, budgets, expenses, users } from "@workspace/db";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

// ── In-memory dedup: userId → Set of dedup keys sent today ───────────────────
const sentToday = new Map<number, Set<string>>();
function dedupKey(userId: number, key: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  const fullKey = `${today}:${key}`;
  if (!sentToday.has(userId)) sentToday.set(userId, new Set());
  const s = sentToday.get(userId)!;
  if (s.has(fullKey)) return true; // already sent
  s.add(fullKey);
  return false;
}

// ── Qatar stocks base prices (matches markets.ts) ────────────────────────────
const QSE_BASE: Record<string, number> = {
  QNBK: 157.5, QTEL: 38.4, CBQK: 25.9, IQCD: 45.2,
  MARK: 17.7,  QEWS: 254.0, AAMAL: 4.65, WOQOD: 189.3,
};
// Store last known prices per session
const lastPrices: Record<string, number> = { ...QSE_BASE };
const simulatedChanges: Record<string, number> = {};

function getSimulatedMove(sym: string): number {
  if (!simulatedChanges[sym]) simulatedChanges[sym] = (Math.random() - 0.5) * 6; // ±3%
  return simulatedChanges[sym]!;
}

router.get("/alerts", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const userAlerts = await db.select().from(alerts)
      .where(eq(alerts.userId, userId))
      .orderBy(desc(alerts.createdAt))
      .limit(50);
    res.json(userAlerts);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.put("/alerts/:id/read", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const [alert] = await db.update(alerts).set({ isRead: true })
      .where(and(eq(alerts.id, id), eq(alerts.userId, userId))).returning();
    if (!alert) { res.status(404).json({ error: "Not found" }); return; }
    res.json(alert);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.put("/alerts/read-all", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    await db.update(alerts).set({ isRead: true }).where(eq(alerts.userId, userId));
    res.json({ ok: true });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.delete("/alerts/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, userId)));
    res.status(204).send();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.delete("/alerts", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    await db.delete(alerts).where(eq(alerts.userId, userId));
    sentToday.delete(userId);
    res.status(204).send();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

// ── Main check endpoint ───────────────────────────────────────────────────────
router.post("/alerts/check", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const newAlerts: { type: string; title: string; message: string; symbol?: string }[] = [];

    // ── 1. Qatar Stock price alerts (>2% move) ────────────────────────────────
    const { marketPrices } = (req.body ?? {}) as { marketPrices?: Record<string, number> };
    const checkSymbols = marketPrices ? Object.keys(marketPrices) : Object.keys(QSE_BASE);

    for (const sym of checkSymbols) {
      const currentPrice = marketPrices?.[sym] ?? QSE_BASE[sym]!;
      const basePrice    = lastPrices[sym] ?? QSE_BASE[sym]!;
      const move         = basePrice > 0 ? ((currentPrice - basePrice) / basePrice) * 100 : 0;
      const aboveThreshold = Math.abs(move) >= 2;

      if (!aboveThreshold) {
        // Simulate a move for demo purposes when no real move detected
        const sim = getSimulatedMove(sym);
        if (Math.abs(sim) >= 2 && !dedupKey(userId, `qse-${sym}-${sim > 0 ? "up" : "down"}`)) {
          const dir = sim > 0 ? "📈 UP" : "📉 DOWN";
          const emoji = sim > 0 ? "📈" : "📉";
          newAlerts.push({
            type: "market",
            title: `${emoji} ${sym} moved ${sim > 0 ? "+" : ""}${sim.toFixed(1)}%`,
            message: `${sym} is ${dir} ${Math.abs(sim).toFixed(1)}% today (QAR ${(QSE_BASE[sym]! * (1 + sim / 100)).toFixed(2)}). Consider reviewing your position.`,
            symbol: sym,
          });
        }
        continue;
      }

      const dedupK = `qse-${sym}-${move > 0 ? "up" : "down"}`;
      if (!dedupKey(userId, dedupK)) {
        const dir = move > 0 ? "📈 UP" : "📉 DOWN";
        const emoji = move > 0 ? "📈" : "📉";
        newAlerts.push({
          type: "market",
          title: `${emoji} ${sym} moved ${move > 0 ? "+" : ""}${move.toFixed(1)}%`,
          message: `${sym} is ${dir} ${Math.abs(move).toFixed(1)}% today (QAR ${currentPrice.toFixed(2)}). Current price from last known: QAR ${basePrice.toFixed(2)}.`,
          symbol: sym,
        });
        lastPrices[sym] = currentPrice;
      }
    }

    // ── 2. Budget overrun alerts ───────────────────────────────────────────────
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [userBudgets, spendingRows] = await Promise.all([
      db.select().from(budgets).where(eq(budgets.userId, userId)),
      db.select({
        category: expenses.category,
        total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
      }).from(expenses)
        .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)))
        .groupBy(expenses.category),
    ]);

    const spentMap: Record<string, number> = {};
    for (const s of spendingRows) spentMap[s.category] = Number(s.total);

    for (const b of userBudgets) {
      const spent = spentMap[b.category] ?? 0;
      const ratio = b.limitAmount > 0 ? spent / b.limitAmount : 0;

      if (ratio >= 1.0) {
        const dedupK = `budget-exceeded-${b.category}`;
        if (!dedupKey(userId, dedupK)) {
          newAlerts.push({
            type: "budget",
            title: `🚨 ${b.category} budget exceeded`,
            message: `You've spent QAR ${spent.toFixed(0)} on ${b.category} — that's ${Math.round(ratio * 100)}% of your QAR ${b.limitAmount.toFixed(0)} limit this month.`,
          });
        }
      } else if (ratio >= 0.8) {
        const dedupK = `budget-warning-${b.category}`;
        if (!dedupKey(userId, dedupK)) {
          newAlerts.push({
            type: "budget_warning",
            title: `⚠️ ${b.category} at ${Math.round(ratio * 100)}%`,
            message: `Spent QAR ${spent.toFixed(0)} of your QAR ${b.limitAmount.toFixed(0)} ${b.category} budget. QAR ${(b.limitAmount - spent).toFixed(0)} remaining.`,
          });
        }
      }
    }

    // Persist new alerts to DB + return them
    const created = await Promise.all(
      newAlerts.map(a =>
        db.insert(alerts).values({
          userId,
          title: a.title,
          message: a.message,
          type: a.type,
          isRead: false,
        }).returning().then(rows => ({
          ...rows[0],
          body: a.message,
          alertType: a.type,
          symbol: a.symbol,
        }))
      )
    );

    res.json({ new: created, count: created.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed", new: [], count: 0 });
  }
});

export default router;
