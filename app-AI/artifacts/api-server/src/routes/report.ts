import { Router, Request } from "express";
import { db, expenses, users, gamificationStats } from "@workspace/db";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";
import { generateJSON } from "../lib/ai";

const router = Router();

// ── Per-user weekly report cache ──────────────────────────────────────────────
const reportCache = new Map<number, { weekKey: string; report: WeeklyReportData }>();

interface WeeklyReportData {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  generated: string;
  // Financial data
  weeklyIncome: number;
  weeklyExpenses: number;
  netSavings: number;
  savingsRate: number;
  avgDailySpend: number;
  score: number;
  scoreTrend: number;           // vs prior week
  expenseTrend: number;         // % change vs prior week
  byCategory: { category: string; amount: number; pct: number; change: number }[];
  topCategory: string;
  topCategoryAmount: number;
  totalTransactions: number;
  // AI-generated content
  mood: "great" | "good" | "neutral" | "concern";
  moodEmoji: string;
  moodLabel: string;
  personalizedSummary: string;
  keyInsight: string;
  actionTip: string;
  tipCategory: string;
}

function getWeekKey(d: Date): string {
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function getMoodConfig(mood: string): { emoji: string; label: string } {
  switch (mood) {
    case "great":   return { emoji: "🌟", label: "On Fire!" };
    case "good":    return { emoji: "💪", label: "Doing Well" };
    case "neutral": return { emoji: "📊", label: "On Track" };
    default:        return { emoji: "💡", label: "Room to Improve" };
  }
}

router.get("/report/weekly", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const forceRefresh = req.query["refresh"] === "true";
    const now     = new Date();
    const weekKey = getWeekKey(now);

    // Return cache if fresh and not forcing refresh
    const cached = reportCache.get(userId);
    if (!forceRefresh && cached?.weekKey === weekKey) {
      res.json(cached.report); return;
    }

    // ── Fetch data ────────────────────────────────────────────────────────────
    const weekStart = new Date(weekKey);
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
    const prevStart = new Date(weekStart); prevStart.setDate(weekStart.getDate() - 7);

    const [user, thisWeekExp, prevWeekExp, allUsers] = await Promise.all([
      db.select().from(users).where(eq(users.id, userId)).limit(1),
      db.select().from(expenses)
        .where(and(eq(expenses.userId, userId), gte(expenses.date, weekStart))),
      db.select().from(expenses)
        .where(and(eq(expenses.userId, userId), gte(expenses.date, prevStart), lt(expenses.date, weekStart))),
      db.select().from(gamificationStats).where(eq(gamificationStats.userId, userId)).limit(1),
    ]);

    // Income from monthly income (pro-rated to week)
    const monthlyIncome  = user[0]?.monthlyIncome ?? 0;
    const weeklyIncome   = parseFloat(((monthlyIncome / 30) * 7).toFixed(2));

    // This-week expenses
    const weeklyExpenses = thisWeekExp.reduce((s, e) => s + e.amount, 0);
    const prevExpTotal   = prevWeekExp.reduce((s, e) => s + e.amount, 0);
    const netSavings     = weeklyIncome - weeklyExpenses;
    const savingsRate    = weeklyIncome > 0 ? Math.max(0, (netSavings / weeklyIncome) * 100) : 0;
    const avgDailySpend  = weeklyExpenses / 7;
    const expenseTrend   = prevExpTotal > 0 ? ((weeklyExpenses - prevExpTotal) / prevExpTotal) * 100 : 0;

    // Category breakdown this week
    const catMap: Record<string, number> = {};
    const prevCatMap: Record<string, number> = {};
    for (const e of thisWeekExp) catMap[e.category] = (catMap[e.category] ?? 0) + e.amount;
    for (const e of prevWeekExp)  prevCatMap[e.category] = (prevCatMap[e.category] ?? 0) + e.amount;

    const byCategory = Object.entries(catMap)
      .map(([cat, amt]) => ({
        category: cat, amount: parseFloat(amt.toFixed(2)),
        pct: weeklyExpenses > 0 ? parseFloat(((amt / weeklyExpenses) * 100).toFixed(1)) : 0,
        change: prevCatMap[cat] ? parseFloat((((amt - prevCatMap[cat]!) / prevCatMap[cat]!) * 100).toFixed(1)) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const topCat    = byCategory[0]?.category ?? "Other";
    const topCatAmt = byCategory[0]?.amount ?? 0;

    // Score (quick computation)
    const spendRatio  = monthlyIncome > 0 ? Math.min(weeklyExpenses * 4.3 / monthlyIncome, 1) : 0.8;
    const saveRate    = monthlyIncome > 0 ? Math.max(0, (monthlyIncome - weeklyExpenses * 4.3) / monthlyIncome) : 0;
    const score       = Math.round(Math.min(100, Math.max(0, (1 - spendRatio) * 25 + saveRate * 25 + 30)));
    const scoreTrend  = expenseTrend < 0 ? 3 : expenseTrend > 10 ? -3 : 0;

    // ── AI generation ─────────────────────────────────────────────────────────
    const catSummary = byCategory.slice(0, 4).map(c => `${c.category}: QAR ${c.amount.toFixed(0)} (${c.pct}%${c.change !== 0 ? ", " + (c.change > 0 ? "+" : "") + c.change.toFixed(0) + "% vs last week" : ""})`).join(", ");
    const spendingStatus = savingsRate >= 30 ? "excellent" : savingsRate >= 15 ? "good" : savingsRate >= 0 ? "tight" : "overspending";

    let aiJson = {
      mood: "neutral" as "great" | "good" | "neutral" | "concern",
      personalizedSummary: `This week you spent QAR ${weeklyExpenses.toFixed(0)} against an estimated income of QAR ${weeklyIncome.toFixed(0)}.`,
      keyInsight: `${topCat} was your biggest expense category at QAR ${topCatAmt.toFixed(0)}.`,
      actionTip: `Review your ${topCat} spending and set a weekly limit to stay on track.`,
      tipCategory: topCat,
    };

    try {
      const systemPrompt = `You are Aurix AI, a friendly financial coach for users in Qatar.
Generate a weekly financial report summary. Return ONLY valid JSON (no markdown) with exactly these fields:
- mood: one of "great", "good", "neutral", "concern" based on spending health
- personalizedSummary: 2 engaging sentences about this week's performance (mention specific numbers in QAR)
- keyInsight: 1 sentence about the most interesting pattern or the top spending category
- actionTip: 1 specific, concrete action they can take THIS WEEK (not vague advice)
- tipCategory: the expense category this tip relates to`;

      const userPrompt = `Data:
- Weekly income estimate: QAR ${weeklyIncome.toFixed(0)}
- Weekly spending: QAR ${weeklyExpenses.toFixed(0)}
- Net savings this week: QAR ${netSavings.toFixed(0)}
- Savings rate: ${savingsRate.toFixed(0)}%
- Spending vs last week: ${expenseTrend > 0 ? "+" : ""}${expenseTrend.toFixed(0)}%
- Spending by category: ${catSummary || "No spending recorded yet"}
- Spending status: ${spendingStatus}
- Total transactions: ${thisWeekExp.length}`;

      const parsed = await generateJSON<{
        mood?: string;
        personalizedSummary?: string;
        keyInsight?: string;
        actionTip?: string;
        tipCategory?: string;
      }>(systemPrompt, userPrompt, 400);

      aiJson = {
        mood: (["great","good","neutral","concern"].includes(parsed.mood ?? "") ? parsed.mood : "neutral") as typeof aiJson.mood,
        personalizedSummary: parsed.personalizedSummary ?? aiJson.personalizedSummary,
        keyInsight: parsed.keyInsight ?? aiJson.keyInsight,
        actionTip: parsed.actionTip ?? aiJson.actionTip,
        tipCategory: parsed.tipCategory ?? topCat,
      };
    } catch (err) {
      // Log full error — never silently swallow AI failures.
      req.log.error({ err }, "[report] Gemini weekly report generation failed; using deterministic fallback");
    }

    const moodCfg = getMoodConfig(aiJson.mood);

    const report: WeeklyReportData = {
      weekKey,
      weekStart: weekStart.toISOString(),
      weekEnd:   weekEnd.toISOString(),
      generated: now.toISOString(),
      weeklyIncome,
      weeklyExpenses: parseFloat(weeklyExpenses.toFixed(2)),
      netSavings:     parseFloat(netSavings.toFixed(2)),
      savingsRate:    parseFloat(savingsRate.toFixed(1)),
      avgDailySpend:  parseFloat(avgDailySpend.toFixed(2)),
      score, scoreTrend,
      expenseTrend:   parseFloat(expenseTrend.toFixed(1)),
      byCategory,
      topCategory: topCat,
      topCategoryAmount: parseFloat(topCatAmt.toFixed(2)),
      totalTransactions: thisWeekExp.length,
      mood: aiJson.mood,
      moodEmoji: moodCfg.emoji,
      moodLabel: moodCfg.label,
      personalizedSummary: aiJson.personalizedSummary,
      keyInsight: aiJson.keyInsight,
      actionTip: aiJson.actionTip,
      tipCategory: aiJson.tipCategory,
    };

    reportCache.set(userId, { weekKey, report });
    res.json(report);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

export default router;
