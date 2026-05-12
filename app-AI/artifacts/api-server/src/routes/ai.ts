import { Router, Request } from "express";
import { db, expenses, income, portfolioHoldings, users } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";
import { generateCompletion } from "../lib/ai";

const router = Router();

router.get("/ai/daily-action", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const monthStart    = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

    const [expResult, incomeResult, holdings] = await Promise.all([
      db.select({
        total:    sql<number>`coalesce(sum(${expenses.amount}), 0)`,
        category: expenses.category,
      }).from(expenses)
        .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)))
        .groupBy(expenses.category),

      db.select({ total: sql<number>`coalesce(sum(${income.amount}), 0)` })
        .from(income)
        .where(and(eq(income.userId, userId), gte(income.date, monthStart))),

      db.select().from(portfolioHoldings).where(eq(portfolioHoldings.userId, userId)),
    ]);

    const salaryIncome     = user?.monthlyIncome ?? 0;
    const loggedIncome     = Number(incomeResult[0]?.total ?? 0);
    // Salary + any additional logged income this month
    const totalIncome      = salaryIncome + loggedIncome;
    const totalSpent       = expResult.reduce((s, e) => s + Number(e.total), 0);
    const savings          = Math.max(0, totalIncome - totalSpent);
    const topCategory      = expResult.sort((a, b) => Number(b.total) - Number(a.total))[0];
    const portfolioValue   = holdings.reduce((s, h) => s + h.currentPrice * h.quantity, 0);

    const staticTips = [
      `You've spent QAR ${Math.round(totalSpent)} this month. Try setting a daily limit to stay on track.`,
      `Your top spending category is ${topCategory?.category ?? "expenses"}. Review it today to find savings opportunities.`,
      `With QAR ${Math.round(savings)} remaining this month, consider putting 10% into savings now.`,
      "Review your last 5 transactions and identify one you could have avoided.",
      "Set up a budget for your top spending category to better control monthly expenses.",
    ];
    const fallbackTip = staticTips[new Date().getDate() % staticTips.length]!;

    const context = `User financial snapshot (Qatar):
- Monthly salary: QAR ${salaryIncome}
- Additional income logged this month: QAR ${loggedIncome}
- Total available income: QAR ${totalIncome}
- Monthly spending (30 days): QAR ${Math.round(totalSpent)}
- Top category: ${topCategory?.category ?? "None"} (QAR ${Math.round(topCategory?.total ?? 0)})
- Portfolio: QAR ${Math.round(portfolioValue)}
- Savings this month: QAR ${Math.round(savings)}`;

    const systemPrompt = `You are Aurix AI, a financial coach for Qatar residents.
Give ONE specific, actionable financial tip for today based on the user's data.
Reference their actual QAR numbers. Keep it under 2 sentences. Be concrete and direct.`;

    const aiText = await generateCompletion(systemPrompt, [{ role: "user", content: context }], 120, 0.4);

    res.json({
      action:       aiText || fallbackTip,
      reasoning:    `Based on QAR ${Math.round(totalSpent)} spent vs QAR ${totalIncome} total income`,
      category:     topCategory?.category,
      targetAmount: topCategory ? Math.max(0, Number(topCategory.total) * 0.8) : undefined,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get daily action" });
  }
});

export default router;
