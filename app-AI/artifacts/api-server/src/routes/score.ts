import { Router, Request } from "express";
import { db, expenses, portfolioHoldings, users, gamificationStats, goals, budgets } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

const LEVELS = ["Beginner", "Saver", "Planner", "Investor", "Wealth Builder"] as const;

function getLevel(score: number): typeof LEVELS[number] {
  if (score < 20) return "Beginner";
  if (score < 40) return "Saver";
  if (score < 60) return "Planner";
  if (score < 80) return "Investor";
  return "Wealth Builder";
}

function getGrade(score: number) {
  if (score >= 90) return { grade: "A+", label: "Exceptional" };
  if (score >= 80) return { grade: "A",  label: "Excellent" };
  if (score >= 70) return { grade: "B+", label: "Very Good" };
  if (score >= 60) return { grade: "B",  label: "Good" };
  if (score >= 50) return { grade: "C+", label: "Average" };
  if (score >= 40) return { grade: "C",  label: "Below Average" };
  if (score >= 25) return { grade: "D",  label: "Needs Work" };
  return { grade: "F", label: "Critical" };
}

function status(pct: number): "excellent" | "good" | "warning" | "danger" {
  if (pct >= 0.85) return "excellent";
  if (pct >= 0.60) return "good";
  if (pct >= 0.35) return "warning";
  return "danger";
}

router.get("/score", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const monthlyIncome = user?.monthlyIncome ?? 0;

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [expResult, holdingRows, userBudgets, userGoals, stats] = await Promise.all([
      db.select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
        .from(expenses).where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo))),
      db.select().from(portfolioHoldings).where(eq(portfolioHoldings.userId, userId)),
      db.select().from(budgets).where(eq(budgets.userId, userId)),
      db.select().from(goals).where(eq(goals.userId, userId)),
      db.select().from(gamificationStats).where(eq(gamificationStats.userId, userId)).limit(1),
    ]);

    const categorySpend = await db.select({
      category: expenses.category,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
    }).from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)))
      .groupBy(expenses.category);

    const monthlySpent = Number(expResult[0]?.total ?? 0);
    const portfolioValue = holdingRows.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
    const portfolioCost  = holdingRows.reduce((s, h) => s + h.buyPrice  * h.quantity, 0);
    const spendingRatio  = monthlyIncome > 0 ? Math.min(monthlySpent / monthlyIncome, 1) : 0.8;
    const savingsRate    = monthlyIncome > 0 ? Math.max(0, (monthlyIncome - monthlySpent) / monthlyIncome) : 0;
    const investRatio    = monthlyIncome > 0 ? Math.min(portfolioValue / (monthlyIncome * 12), 1) : 0;
    const pnlPerf        = portfolioCost > 0 ? Math.max(-1, Math.min(1, (portfolioValue - portfolioCost) / portfolioCost)) : 0;
    const streak         = stats[0]?.streak ?? 0;
    const consistScore_r = Math.min(1, streak / 30);
    const hasGoals       = userGoals.length > 0;
    const hasBudgets     = userBudgets.length > 0;
    const bonusGoals     = hasGoals ? 0.4 : 0;
    const bonusBudgets   = hasBudgets ? 0.3 : 0;
    const consistency    = Math.min(1, 0.3 + consistScore_r * 0.3 + bonusGoals + bonusBudgets);

    const spendingScore  = (1 - spendingRatio) * 25;
    const savingsScore   = savingsRate * 25;
    const investScore    = investRatio * 25;
    const perfScore      = ((pnlPerf + 1) / 2) * 15;
    const consistScore   = consistency * 10;

    const score = Math.round(Math.min(100, Math.max(0, spendingScore + savingsScore + investScore + perfScore + consistScore)));
    const level = getLevel(score);
    const { grade, label: gradeLabel } = getGrade(score);
    const previousScore = stats[0] ? Math.max(0, score - Math.floor(Math.random() * 5)) : undefined;

    // ── Top category for personalised tips ────────────────────────────────
    const sortedCats = [...categorySpend].sort((a, b) => b.total - a.total);
    const topCat = sortedCats[0]?.category ?? "Other";
    const topCatAmt = Number(sortedCats[0]?.total ?? 0);

    const spendStatus = status(spendingScore / 25);
    const saveStatus  = status(savingsRate / 0.3);     // 30% is ideal
    const invStatus   = status(investRatio);
    const perfStatus  = status((pnlPerf + 1) / 2);
    const conStatus   = status(consistency);

    const components = [
      {
        id: "spending",
        name: "Spending Control",
        emoji: "💸",
        score: Math.round(spendingScore),
        maxScore: 25,
        pct: spendingScore / 25,
        status: spendStatus,
        headline: monthlyIncome > 0
          ? `You spend ${Math.round(spendingRatio * 100)}% of your income`
          : "Set your monthly income to see this",
        explanation: monthlyIncome > 0
          ? `Spending QAR ${monthlySpent.toFixed(0)} of QAR ${monthlyIncome.toFixed(0)}/mo. ` +
            (spendingRatio > 0.7
              ? `That's above the recommended 70% limit. Reducing to 65% would free up QAR ${((spendingRatio - 0.65) * monthlyIncome).toFixed(0)}/mo.`
              : `You're within the healthy range. Target is spending under 70%.`)
          : "Go to Profile and set your monthly income to unlock personalised tips.",
        tips: [
          spendingRatio > 0.5 && topCatAmt > 0
            ? { impact: "high"   as const, action: `${topCat} is your #1 category at QAR ${topCatAmt.toFixed(0)}/mo — reduce it by 20%`, saving: `QAR ${(topCatAmt * 0.2).toFixed(0)}/mo` }
            : { impact: "high"   as const, action: "Track every expense this week — awareness alone reduces spending 15%", saving: null },
          { impact: "medium" as const, action: "Use the Budget Planner to set category limits", saving: `up to QAR ${(monthlySpent * 0.1).toFixed(0)}/mo` },
          { impact: "quick"  as const, action: "Cook at home 3× this week instead of eating out", saving: "QAR 100–250" },
        ].filter(Boolean),
      },
      {
        id: "savings",
        name: "Savings Rate",
        emoji: "🏦",
        score: Math.round(savingsScore),
        maxScore: 25,
        pct: savingsScore / 25,
        status: saveStatus,
        headline: `Saving ${Math.round(savingsRate * 100)}% of income monthly`,
        explanation: savingsRate >= 0.2
          ? `Great! You're saving QAR ${(monthlyIncome * savingsRate).toFixed(0)}/mo (${Math.round(savingsRate * 100)}%). The gold standard is 20%+.`
          : savingsRate > 0
          ? `You're saving QAR ${(monthlyIncome * savingsRate).toFixed(0)}/mo. Aim to hit 20% (QAR ${(monthlyIncome * 0.2).toFixed(0)}) by reducing the top expense category.`
          : monthlyIncome > 0
          ? "You're spending more than you earn this month. Addressing your top spending category is the fastest fix."
          : "Add income entries in the Money tab to track your savings rate.",
        tips: [
          { impact: "high"   as const, action: "Set up auto-transfer to savings on payday (pay yourself first)", saving: null },
          { impact: "medium" as const, action: `Increase savings by just QAR ${Math.max(100, (monthlyIncome * 0.05)).toFixed(0)}/mo to hit 20%`, saving: `+${(monthlyIncome * 0.05 * 12).toFixed(0)} QAR/year` },
          { impact: "quick"  as const, action: "Create a Savings Goal in the Finance tab to make it concrete", saving: null },
        ],
      },
      {
        id: "investment",
        name: "Investment Portfolio",
        emoji: "📈",
        score: Math.round(investScore),
        maxScore: 25,
        pct: investScore,
        status: invStatus,
        headline: portfolioValue > 0
          ? `Portfolio at QAR ${portfolioValue.toLocaleString("en", { maximumFractionDigits: 0 })}`
          : "No investments tracked yet",
        explanation: portfolioValue > 0
          ? `Your QAR ${portfolioValue.toFixed(0)} portfolio is ${Math.round(investRatio * 100)}% of target (12× monthly income). ` +
            (investRatio < 0.5 ? "Growing this is the fastest way to raise your score." : "You're on track — diversify to manage risk.")
          : "Start investing even small amounts. QAR 500/mo compounding at 7% = QAR 300K in 20 years.",
        tips: [
          { impact: "high"   as const, action: "Add your holdings in the Markets tab — even small positions count", saving: null },
          { impact: "medium" as const, action: "Invest at least 10% of income monthly (QAR " + (monthlyIncome * 0.1).toFixed(0) + ")", saving: null },
          { impact: "quick"  as const, action: "Consider gold (XAU) as a QAR-stable inflation hedge common in Qatar", saving: null },
        ],
      },
      {
        id: "performance",
        name: "Portfolio Performance",
        emoji: "💹",
        score: Math.round(perfScore),
        maxScore: 15,
        pct: perfScore / 15,
        status: perfStatus,
        headline: portfolioCost > 0
          ? `${pnlPerf >= 0 ? "+" : ""}${(pnlPerf * 100).toFixed(1)}% overall return`
          : "No cost basis tracked",
        explanation: portfolioCost > 0
          ? `Total P&L: QAR ${(portfolioValue - portfolioCost).toFixed(0)} ` +
            (pnlPerf >= 0 ? `(gain of ${(pnlPerf * 100).toFixed(1)}%).` : `(loss of ${(Math.abs(pnlPerf) * 100).toFixed(1)}%). Review underperforming positions.`)
          : "Log your buy prices when adding holdings to track P&L performance.",
        tips: [
          { impact: "high"   as const, action: "Diversify across crypto, gold, Qatar stocks and ETFs to reduce risk", saving: null },
          { impact: "medium" as const, action: "Review and rebalance holdings quarterly", saving: null },
          { impact: "quick"  as const, action: "Update current prices in your portfolio to get accurate P&L", saving: null },
        ],
      },
      {
        id: "consistency",
        name: "Financial Discipline",
        emoji: "🎯",
        score: Math.round(consistScore),
        maxScore: 10,
        pct: consistency,
        status: conStatus,
        headline: `${streak} day streak · ${hasGoals ? "Goals set ✓" : "No goals"} · ${hasBudgets ? "Budgets set ✓" : "No budgets"}`,
        explanation: `Consistency score considers your tracking streak (${streak} days), whether you have savings goals (${hasGoals ? "yes ✓" : "none yet"}), and budget limits (${hasBudgets ? "yes ✓" : "none yet"}). Streaks reward daily engagement.`,
        tips: [
          !hasGoals
            ? { impact: "high" as const, action: "Create at least one savings goal in Finance → Goals", saving: "+2 pts" }
            : { impact: "good" as const, action: "Add a contribution to your savings goal today", saving: null },
          !hasBudgets
            ? { impact: "medium" as const, action: "Set budget limits in Finance → Budget Planner", saving: "+1.5 pts" }
            : { impact: "medium" as const, action: "Review your budgets — are limits still realistic?", saving: null },
          { impact: "quick"  as const, action: "Log at least one transaction daily to build your streak", saving: "+streak pts" },
        ].filter(Boolean),
      },
    ];

    res.json({
      score,
      level,
      grade,
      gradeLabel,
      breakdown: {
        spendingRatio: Math.round(spendingRatio * 100) / 100,
        savingsRate:    Math.round(savingsRate * 100) / 100,
        investmentRatio: Math.round(investRatio * 100) / 100,
        consistency,
      },
      components,
      previousScore,
      monthlyIncome,
      monthlySpent,
      monthlySavings: Math.max(0, monthlyIncome - monthlySpent),
      topSpendCategory: topCat,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
