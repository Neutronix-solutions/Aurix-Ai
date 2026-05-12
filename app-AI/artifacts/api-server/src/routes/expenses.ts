import { Router, Request } from "express";
import { db, expenses, alerts } from "@workspace/db";
import { eq, desc, and, gte, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

function categorize(merchant?: string, description?: string): string {
  const text = `${merchant ?? ""} ${description ?? ""}`.toLowerCase();
  if (/restaurant|cafe|food|pizza|burger|coffee|lunch|dinner|breakfast|delivery/i.test(text)) return "Food & Dining";
  if (/uber|taxi|gas|fuel|transport|metro|bus|lyft|careem/i.test(text)) return "Transport";
  if (/amazon|mall|shop|store|market|fashion|clothes|shoe/i.test(text)) return "Shopping";
  if (/cinema|movie|netflix|game|spotify|entertainment|subscription/i.test(text)) return "Entertainment";
  if (/hospital|pharmacy|doctor|health|clinic|medicine/i.test(text)) return "Health";
  if (/electric|water|internet|phone|bill|utility|stc|ooredoo/i.test(text)) return "Bills & Utilities";
  if (/hotel|flight|airline|travel|booking|airbnb/i.test(text)) return "Travel";
  return "Other";
}

router.get("/expenses", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const limit    = Number(req.query["limit"]    ?? 50);
    const offset   = Number(req.query["offset"]   ?? 0);
    const category = req.query["category"] as string | undefined;
    const results  = await db.select().from(expenses)
      .where(category
        ? and(eq(expenses.userId, userId), eq(expenses.category, category))
        : eq(expenses.userId, userId))
      .orderBy(desc(expenses.date))
      .limit(limit)
      .offset(offset);
    res.json(results);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/expenses", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const {
      amount, category, merchant, description, date,
      originalAmount, originalCurrency, exchangeRateUsed,
    } = req.body as {
      amount: number; category?: string; merchant?: string;
      description?: string; date?: string;
      originalAmount?: number;
      originalCurrency?: string;
      exchangeRateUsed?: number;
    };
    if (!amount || amount <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }
    const resolvedCategory = category || categorize(merchant, description);

    // amount is always in QAR (the canonical internal currency)
    // originalAmount/originalCurrency preserve the user's original entry (audit-safe)
    const origCurr = originalCurrency?.toUpperCase() ?? "QAR";
    const origAmt  = origCurr !== "QAR" ? (originalAmount ?? amount) : null;
    const rate     = origCurr !== "QAR" ? (exchangeRateUsed ?? 1) : 1;

    const [expense] = await db.insert(expenses).values({
      userId, amount, category: resolvedCategory, merchant, description,
      date: date ? new Date(date) : new Date(),
      originalAmount: origAmt ?? undefined,
      originalCurrency: origCurr,
      exchangeRateUsed: rate,
    }).returning();

    // Spending alert (in QAR)
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const summary = await db.select({ total: sql<number>`sum(${expenses.amount})` })
      .from(expenses).where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)));
    const monthlyTotal = Number(summary[0]?.total ?? 0);
    if (monthlyTotal > 10000) {
      await db.insert(alerts).values({
        userId, title: "High Spending Alert", severity: "warning",
        message: `You've spent QAR ${monthlyTotal.toFixed(0)} this month. Consider reviewing your budget.`,
      }).onConflictDoNothing();
    }
    res.status(201).json(expense);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/expenses/summary", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const allExpenses = await db.select().from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)));
    const totalSpent = allExpenses.reduce((s, e) => s + e.amount, 0);
    const byCategoryMap: Record<string, number> = {};
    for (const e of allExpenses) {
      byCategoryMap[e.category] = (byCategoryMap[e.category] ?? 0) + e.amount;
    }
    const byCategory = Object.entries(byCategoryMap)
      .map(([category, total]) => ({ category, total, percentage: totalSpent > 0 ? (total / totalSpent) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);
    res.json({ totalSpent, byCategory, count: allExpenses.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/expenses/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
