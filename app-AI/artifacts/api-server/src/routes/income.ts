import { Router, Request } from "express";
import { db, income, expenses } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

router.get("/income", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const limit  = Number(req.query["limit"]  ?? 50);
    const offset = Number(req.query["offset"] ?? 0);
    const entries = await db.select().from(income)
      .where(eq(income.userId, userId))
      .orderBy(desc(income.date))
      .limit(limit).offset(offset);
    res.json(entries);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/income", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { amount, source, description, date, originalAmount, originalCurrency, exchangeRateUsed } = req.body as {
      amount: number; source?: string; description?: string; date?: string;
      originalAmount?: number; originalCurrency?: string; exchangeRateUsed?: number;
    };
    if (!amount || amount <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }

    const origCurr = originalCurrency?.toUpperCase() ?? "QAR";
    const origAmt  = origCurr !== "QAR" ? (originalAmount ?? amount) : undefined;
    const rate     = origCurr !== "QAR" ? (exchangeRateUsed ?? 1) : undefined;

    const [entry] = await db.insert(income).values({
      userId, amount, source: source ?? "Salary", description,
      date: date ? new Date(date) : new Date(),
      ...(origAmt !== undefined ? { originalAmount: origAmt } : {}),
      originalCurrency: origCurr,
      ...(rate !== undefined ? { exchangeRateUsed: rate } : {}),
    }).returning();
    res.status(201).json(entry);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/income/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(income).where(and(eq(income.id, id), eq(income.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/reports", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;

    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: d.toLocaleString("en", { month: "short" }) });
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const allExpenses = await db.select().from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, sixMonthsAgo)));
    const allIncome = await db.select().from(income)
      .where(and(eq(income.userId, userId), gte(income.date, sixMonthsAgo)));

    const monthly = months.map(m => {
      const exp = allExpenses.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === m.year && d.getMonth() + 1 === m.month;
      }).reduce((s, e) => s + e.amount, 0);
      const inc = allIncome.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === m.year && d.getMonth() + 1 === m.month;
      }).reduce((s, e) => s + Number(e.amount), 0);
      return { label: m.label, expenses: exp, income: inc, savings: inc - exp };
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentExpenses = allExpenses.filter(e => new Date(e.date) >= thirtyDaysAgo);
    const byCategoryMap: Record<string, number> = {};
    for (const e of recentExpenses) {
      byCategoryMap[e.category] = (byCategoryMap[e.category] ?? 0) + e.amount;
    }
    const totalSpent = Object.values(byCategoryMap).reduce((a, b) => a + b, 0);
    const byCategory = Object.entries(byCategoryMap)
      .map(([category, total]) => ({ category, total, percentage: totalSpent > 0 ? (total / totalSpent) * 100 : 0 }))
      .sort((a, b) => b.total - a.total);

    const totalIncomeLast30 = allIncome.filter(e => new Date(e.date) >= thirtyDaysAgo)
      .reduce((s, e) => s + Number(e.amount), 0);

    res.json({
      monthly,
      byCategory,
      summary: {
        totalSpent30d: totalSpent,
        totalIncome30d: totalIncomeLast30,
        savings30d: totalIncomeLast30 - totalSpent,
        savingsRate: totalIncomeLast30 > 0 ? Math.round(((totalIncomeLast30 - totalSpent) / totalIncomeLast30) * 100) : 0,
      },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
