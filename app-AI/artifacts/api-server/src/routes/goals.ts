import { Router, Request } from "express";
import { db, goals, budgets, expenses, users } from "@workspace/db";
import { eq, and, gte, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

router.get("/goals", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;

    const [userGoals, userBudgets, [user]] = await Promise.all([
      db.select().from(goals).where(eq(goals.userId, userId)),
      db.select().from(budgets).where(eq(budgets.userId, userId)),
      db.select().from(users).where(eq(users.id, userId)).limit(1),
    ]);

    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const spendingByCategory = await db.select({
      category: expenses.category,
      total: sql<number>`coalesce(sum(${expenses.amount}), 0)`,
    }).from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)))
      .groupBy(expenses.category);

    const spentMap: Record<string, number> = {};
    for (const s of spendingByCategory) spentMap[s.category] = Number(s.total);
    const budgetsWithSpent = userBudgets.map(b => ({ ...b, spentAmount: spentMap[b.category] ?? 0 }));

    const totalSpent = Object.values(spentMap).reduce((a, b) => a + b, 0);
    const monthlyIncome = user?.monthlyIncome ?? 0;
    const monthlySavings = Math.max(0, monthlyIncome - totalSpent);
    const now = new Date();

    const goalsWithTimeline = userGoals.map(g => {
      const remaining = Math.max(0, g.targetAmount - g.currentAmount);
      const progress = g.targetAmount > 0 ? Math.min(g.currentAmount / g.targetAmount, 1) : 0;
      let monthsToGoal: number | null = null;
      let completionDate: string | null = null;
      if (remaining === 0) {
        monthsToGoal = 0;
        completionDate = now.toISOString();
      } else if (monthlySavings > 0) {
        monthsToGoal = Math.ceil(remaining / monthlySavings);
        const target = new Date(now);
        target.setMonth(target.getMonth() + monthsToGoal);
        completionDate = target.toISOString();
      }
      return { ...g, remaining, progress, monthsToGoal, completionDate, monthlySavings };
    });

    res.json({ goals: goalsWithTimeline, budgets: budgetsWithSpent, monthlySavings });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/goals", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { name, targetAmount, currentAmount, deadline, emoji } = req.body as {
      name: string; targetAmount: number; currentAmount?: number; deadline?: string; emoji?: string;
    };
    if (!name || !targetAmount || targetAmount <= 0) {
      res.status(400).json({ error: "name and targetAmount required" }); return;
    }
    const [goal] = await db.insert(goals).values({
      userId, name: emoji ? `${emoji} ${name}` : name,
      targetAmount, currentAmount: currentAmount ?? 0,
      deadline: deadline ? new Date(deadline) : undefined,
    }).returning();
    res.status(201).json({ ...goal, remaining: goal.targetAmount - goal.currentAmount, progress: 0, monthsToGoal: null, completionDate: null });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.patch("/goals/:id/contribute", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const { amount } = req.body as { amount: number };
    if (!amount || amount <= 0) { res.status(400).json({ error: "Valid amount required" }); return; }

    const [goal] = await db.select().from(goals).where(and(eq(goals.id, id), eq(goals.userId, userId))).limit(1);
    if (!goal) { res.status(404).json({ error: "Not found" }); return; }

    const newAmount = Math.min(goal.currentAmount + amount, goal.targetAmount);
    const [updated] = await db.update(goals).set({ currentAmount: newAmount })
      .where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();

    const remaining = Math.max(0, updated.targetAmount - updated.currentAmount);
    const progress = updated.targetAmount > 0 ? updated.currentAmount / updated.targetAmount : 0;
    res.json({ ...updated, remaining, progress });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.patch("/goals/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const { name, targetAmount } = req.body as { name?: string; targetAmount?: number };
    const [updated] = await db.update(goals).set({
      ...(name ? { name } : {}),
      ...(targetAmount ? { targetAmount } : {}),
    }).where(and(eq(goals.id, id), eq(goals.userId, userId))).returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/goals/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(goals).where(and(eq(goals.id, id), eq(goals.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/goals/budgets", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { category, limitAmount, period } = req.body as { category: string; limitAmount: number; period?: string };
    const [budget] = await db.insert(budgets).values({
      userId, category, limitAmount, period: period ?? "monthly",
    }).returning();
    res.status(201).json({ ...budget, spentAmount: 0 });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/goals/budgets/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(budgets).where(and(eq(budgets.id, id), eq(budgets.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.patch("/goals/budgets/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const { limitAmount } = req.body as { limitAmount: number };
    const [updated] = await db.update(budgets)
      .set({ limitAmount })
      .where(and(eq(budgets.id, id), eq(budgets.userId, userId)))
      .returning();
    const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const [spent] = await db.select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)` })
      .from(expenses).where(and(eq(expenses.userId, userId), eq(expenses.category, updated.category), gte(expenses.date, thirtyDaysAgo)));
    res.json({ ...updated, spentAmount: Number(spent?.total ?? 0) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
