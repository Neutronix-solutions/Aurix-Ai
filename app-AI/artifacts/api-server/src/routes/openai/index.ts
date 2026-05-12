import { Router, Request } from "express";
import { db, conversations, messages, expenses, goals, budgets, income, users } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../../middlewares/auth";
import { captureException } from "../../lib/sentry";
import { generateCompletion, streamCompletion } from "../../lib/ai";

const router = Router();

// ── Conversation CRUD ──────────────────────────────────────────────────────
router.get("/openai/conversations", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const convs = await db.select().from(conversations).where(eq(conversations.userId, userId)).orderBy(desc(conversations.createdAt));
    res.json(convs);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.post("/openai/conversations", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { title } = req.body as { title?: string };
    const [conv] = await db.insert(conversations).values({ userId, title: title ?? "New Chat" }).returning();
    res.status(201).json(conv);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.get("/openai/conversations/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId))).limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id));
    res.json({ ...conv, messages: msgs });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.delete("/openai/conversations/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(messages).where(eq(messages.conversationId, id));
    await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId)));
    res.status(204).send();
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

router.get("/openai/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const [conv] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, userId))).limit(1);
    if (!conv) { res.status(404).json({ error: "Not found" }); return; }
    const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt);
    res.json(msgs);
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Failed" }); }
});

// ── Build comprehensive financial coach system prompt ──────────────────────
async function buildCoachPrompt(userId: number): Promise<string> {
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sevenDaysAgo  = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Fetch all financial data in parallel
  const [
    [user],
    expCategoryResult,
    recentExpenses,
    lastWeekTotal,
    incomeResult,
    userGoals,
    userBudgets,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1),
    // Category breakdown last 30 days
    db.select({
      category: expenses.category,
      total: sql<number>`round(sum(${expenses.amount})::numeric, 2)`,
      count: sql<number>`count(*)`,
    }).from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, thirtyDaysAgo)))
      .groupBy(expenses.category)
      .orderBy(desc(sql`sum(${expenses.amount})`)),
    // Recent transactions (last 10)
    db.select().from(expenses).where(eq(expenses.userId, userId)).orderBy(desc(expenses.date)).limit(10),
    // Last 7 days total
    db.select({ total: sql<number>`coalesce(round(sum(${expenses.amount})::numeric,2), 0)` })
      .from(expenses).where(and(eq(expenses.userId, userId), gte(expenses.date, sevenDaysAgo))),
    // Income last 30 days
    db.select({ total: sql<number>`coalesce(round(sum(${income.amount})::numeric,2), 0)` })
      .from(income).where(and(eq(income.userId, userId), gte(income.date, thirtyDaysAgo))),
    // Goals
    db.select().from(goals).where(eq(goals.userId, userId)),
    // Budgets
    db.select().from(budgets).where(eq(budgets.userId, userId)),
  ]);

  const monthlyIncome    = user?.monthlyIncome ?? 0;
  const totalSpent       = expCategoryResult.reduce((s, r) => s + Number(r.total), 0);
  const weeklySpent      = Number(lastWeekTotal[0]?.total ?? 0);
  const incomeThisMonth  = Number(incomeResult[0]?.total ?? 0);
  // Salary + any additional logged income (bonuses, freelance, etc.)
  const effectiveIncome  = monthlyIncome + incomeThisMonth;
  const savings          = Math.max(0, effectiveIncome - totalSpent);
  const savingsRate      = effectiveIncome > 0 ? Math.round((savings / effectiveIncome) * 100) : 0;
  const spendingRatio    = effectiveIncome > 0 ? Math.round((totalSpent / effectiveIncome) * 100) : 0;

  // Build category breakdown.
  // NOTE: Drizzle returns sql<number> aggregates and decimal columns as
  // STRINGS at runtime — coerce explicitly or `.toFixed` / arithmetic break.
  const categoryLines = expCategoryResult.map(c => {
    const total = Number(c.total);
    const pct = effectiveIncome > 0 ? Math.round((total / effectiveIncome) * 100) : 0;
    const budget = userBudgets.find(b => b.category === c.category);
    const budgetLimit = budget ? Number(budget.limitAmount) : 0;
    const budgetNote = budget
      ? total > budgetLimit
        ? ` ⚠️ OVER BUDGET by QAR ${(total - budgetLimit).toFixed(0)}`
        : ` (budget: QAR ${budgetLimit})`
      : "";
    return `  • ${c.category}: QAR ${total.toFixed(0)} (${pct}% of income, ${c.count} transactions)${budgetNote}`;
  }).join("\n");

  // Build recent transactions
  const txLines = recentExpenses.map(e => {
    const d = new Date(e.date).toLocaleDateString("en", { month: "short", day: "numeric" });
    return `  • ${d} — QAR ${Number(e.amount).toFixed(0)} at ${e.merchant ?? e.category} (${e.category})`;
  }).join("\n");

  // Build goals
  const goalLines = userGoals.length > 0
    ? userGoals.map(g => {
        const target  = Number(g.targetAmount);
        const current = Number(g.currentAmount);
        const pct = target > 0 ? Math.round((current / target) * 100) : 0;
        const remaining = target - current;
        const deadline  = g.deadline ? new Date(g.deadline).toLocaleDateString("en", { month: "short", year: "numeric" }) : "No deadline";
        return `  • ${g.name}: QAR ${current.toFixed(0)} / QAR ${target.toFixed(0)} (${pct}% — needs QAR ${remaining.toFixed(0)} more, deadline: ${deadline})`;
      }).join("\n")
    : "  • No goals set yet";

  // Behavioral observations
  const observations: string[] = [];
  if (spendingRatio > 90) observations.push(`🚨 CRITICAL: Spending ${spendingRatio}% of income — almost nothing left`);
  else if (spendingRatio > 70) observations.push(`⚠️ High spending: ${spendingRatio}% of income used`);
  else if (savingsRate >= 20) observations.push(`✅ Healthy savings rate at ${savingsRate}%`);

  const topCategory = expCategoryResult[0];
  if (topCategory && effectiveIncome > 0) {
    const topPct = Math.round((Number(topCategory.total) / effectiveIncome) * 100);
    if (topPct > 30) observations.push(`⚠️ ${topCategory.category} is ${topPct}% of income — significantly high`);
  }

  const weeklyAvgExpected = effectiveIncome / 4;
  if (weeklySpent > weeklyAvgExpected * 1.4) {
    observations.push(`⚠️ This week's spending (QAR ${weeklySpent.toFixed(0)}) is 40%+ above your weekly average`);
  }

  const overBudgetCategories = userBudgets.filter(b => {
    const spent = Number(expCategoryResult.find(c => c.category === b.category)?.total ?? 0);
    return spent > Number(b.limitAmount);
  });
  if (overBudgetCategories.length > 0) {
    observations.push(`🚫 Over budget in: ${overBudgetCategories.map(b => b.category).join(", ")}`);
  }

  if (observations.length === 0) observations.push("Data looks normal — no major concerns detected");

  return `You are Aurix AI — a personal AI financial coach for ${user?.name ?? "this user"} in Qatar. You are NOT a generic chatbot.

━━━ CRITICAL RULES (never break these) ━━━
1. Every response MUST reference the user's actual QAR numbers — never speak in abstractions
2. Every response MUST end with ONE specific actionable step with a real number attached
3. NEVER say "it depends", "generally speaking", or give generic financial tips
4. If data is missing, ask ONE specific question to get it — don't make assumptions
5. Respond in the same language as the user (if they write Arabic, respond in Arabic)
6. Be direct and honest — a coach tells hard truths kindly

━━━ COACHING MINDSET ━━━
You track this person's financial behavior over time through this conversation.
When you see overspending, say so: "You've spent QAR X on Y this month — that's more than your income allows."
When you see progress, acknowledge it: "Your food spending dropped QAR X from last month — keep it up."
Push for specific commitments: "Can you cut QAR 200 from [category] this week? Yes or no?"

━━━ USER'S FINANCIAL SNAPSHOT ━━━
Name: ${user?.name ?? "Unknown"}
Monthly Salary: QAR ${monthlyIncome.toLocaleString()}
Additional Income This Month: QAR ${incomeThisMonth.toFixed(0)}
Total Income This Month: QAR ${effectiveIncome.toFixed(0)}
This Month's Spending: QAR ${totalSpent.toFixed(0)} (${spendingRatio}% of income)
This Month's Savings: QAR ${savings.toFixed(0)} (${savingsRate}% savings rate)
This Week's Spending: QAR ${weeklySpent.toFixed(0)}

━━━ SPENDING BY CATEGORY (last 30 days) ━━━
${categoryLines || "  • No expenses recorded yet — ask the user to add some"}

━━━ RECENT TRANSACTIONS (last 10) ━━━
${txLines || "  • No recent transactions"}

━━━ SAVINGS GOALS ━━━
${goalLines}

━━━ BEHAVIORAL OBSERVATIONS ━━━
${observations.map(o => `  ${o}`).join("\n")}

━━━ RESPONSE FORMAT ━━━
• 2–4 sentences max unless user asks for more detail
• Lead with the specific insight or direct answer
• Reference actual QAR amounts from their data above
• End with one concrete, numbered action step
• Use simple formatting — no excessive markdown`;
}

// ── Streaming endpoint ─────────────────────────────────────────────────────
router.post("/openai/conversations/:id/messages/stream", requireAuth, async (req, res) => {
  const { userId } = (req as Request & { user: AuthPayload }).user;
  const convId     = Number(req.params["id"]);
  const { content } = req.body as { content: string };

  if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

  // Verify conversation ownership before opening SSE stream
  const [ownedConv] = await db.select().from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.userId, userId))).limit(1);
  if (!ownedConv) { res.status(404).json({ error: "Not found" }); return; }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  req.log.info({ provider: "gemini", path: req.path, convId, userId },
    "[AI:stream] starting Gemini stream");

  try {
    await db.insert(messages).values({ conversationId: convId, role: "user", content });
    const [history, systemPrompt] = await Promise.all([
      db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.createdAt),
      buildCoachPrompt(userId),
    ]);

    const chatHistory = history.slice(-24).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    let fullContent = "";
    fullContent = await streamCompletion(
      systemPrompt,
      chatHistory,
      (delta) => { send({ type: "delta", content: delta }); },
      600,
      0.4,
    );

    // streamCompletion throws on empty — this branch only runs after the model
    // returned at least one delta. Persist what we have.
    const [saved] = await db.insert(messages)
      .values({ conversationId: convId, role: "assistant", content: fullContent })
      .returning();

    send({ type: "done", id: saved.id, content: fullContent });
    res.end();
  } catch (err: unknown) {
    // Surface the FULL error to logs — never silently swallow.
    const e = err as { message?: string; stack?: string; status?: number };
    req.log.error({ err: e, convId, userId, route: "stream", provider: "gemini" },
      `[AI:stream] Gemini call failed: ${e?.message ?? "unknown error"}`);
    captureException(err, { convId, userId, route: "stream" });

    // Surface the verbatim Gemini error to the client during the debug
    // window so the user can see exactly what went wrong (e.g. 403
    // SERVICE_DISABLED with the GCP enable-API URL).
    send({ type: "error", message: e?.message ?? "AI request failed" });
    res.end();
  }
});

// ── Non-streaming fallback ─────────────────────────────────────────────────
router.post("/openai/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const { userId }  = (req as Request & { user: AuthPayload }).user;
    const convId      = Number(req.params["id"]);
    const { content } = req.body as { content: string };
    if (!content?.trim()) { res.status(400).json({ error: "content required" }); return; }

    const [ownedConv] = await db.select().from(conversations)
      .where(and(eq(conversations.id, convId), eq(conversations.userId, userId))).limit(1);
    if (!ownedConv) { res.status(404).json({ error: "Not found" }); return; }

    await db.insert(messages).values({ conversationId: convId, role: "user", content });
    const [history, systemPrompt] = await Promise.all([
      db.select().from(messages).where(eq(messages.conversationId, convId)).orderBy(messages.createdAt),
      buildCoachPrompt(userId),
    ]);

    const chatHistory = history.slice(-24).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    req.log.info({ provider: "gemini", path: req.path, convId, historyLen: chatHistory.length },
      "[AI] non-streaming chat completion");

    const text = await generateCompletion(systemPrompt, chatHistory, 600, 0.4);

    await db.insert(messages)
      .values({ conversationId: convId, role: "assistant", content: text })
      .returning();

    // Strict contract: always return { text } — nothing else.
    res.json({ text });
  } catch (err: unknown) {
    const e = err as { message?: string };
    req.log.error({ err: e, provider: "gemini", path: req.path },
      `[AI] non-streaming chat failed: ${e?.message ?? "unknown error"}`);
    res.status(503).json({ error: `AI temporarily unavailable: ${e?.message ?? "unknown error"}` });
  }
});

// ── Quick insight (no conversation needed) ────────────────────────────────
router.post("/openai/quick-insight", requireAuth, async (req, res) => {
  try {
    const { userId }  = (req as Request & { user: AuthPayload }).user;
    const { prompt }  = req.body as { prompt: string };
    if (!prompt?.trim()) { res.status(400).json({ error: "prompt required" }); return; }

    req.log.info({ provider: "gemini", path: req.path, userId }, "[AI] quick-insight");

    const systemPrompt = await buildCoachPrompt(userId);
    const text = await generateCompletion(systemPrompt, [{ role: "user", content: prompt }], 200, 0.3);

    // Contract: always return { text } — never `{ insight }`, never raw string.
    res.json({ text });
  } catch (err: unknown) {
    const e = err as { message?: string };
    req.log.error({ err: e, provider: "gemini", path: req.path },
      `[AI] quick-insight failed: ${e?.message ?? "unknown error"}`);
    res.status(503).json({ error: `AI unavailable: ${e?.message ?? "unknown error"}` });
  }
});

export default router;
