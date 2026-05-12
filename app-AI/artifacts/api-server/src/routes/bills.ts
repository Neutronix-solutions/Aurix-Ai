import { Router, Request } from "express";
import { db, expenses, bills } from "@workspace/db";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

// ── Icon/color/category maps ─────────────────────────────────────────────────
const BILL_ICONS: Record<string, string> = {
  "Rent":           "🏠", "Mortgage":     "🏠", "Housing":      "🏠",
  "Electricity":    "⚡", "Water":        "💧", "Gas":          "🔥",
  "Internet":       "📡", "Phone":        "📱", "Mobile":       "📱",
  "Netflix":        "🎬", "Spotify":      "🎵", "Disney+":      "🎬",
  "Apple":          "🍎", "Google":       "🔍", "Amazon":       "📦",
  "Gym":            "💪", "Insurance":    "🛡️", "Subscription": "📋",
  "Streaming":      "🎬", "Utility":      "⚡", "Telecom":      "📡",
  "Food":           "🍽️", "Transport":   "🚗", "Education":    "📚",
  "Default":        "💳",
};
const BILL_COLORS: Record<string, string> = {
  "Rent": "#FF4D6D", "Mortgage": "#FF4D6D", "Housing": "#FF4D6D",
  "Electricity": "#F59E0B", "Water": "#06B6D4", "Gas": "#F97316",
  "Internet": "#6C63FF", "Phone": "#8B5CF6", "Mobile": "#8B5CF6",
  "Netflix": "#E50914", "Spotify": "#1DB954", "Streaming": "#E50914",
  "Gym": "#00C896", "Insurance": "#D4AF37", "Subscription": "#6C63FF",
  "Transport": "#F59E0B", "Education": "#06B6D4",
  "Default": "#6C63FF",
};

function categorizeRecurring(merchant: string): { category: string; icon: string; color: string } {
  const m = merchant.toLowerCase();
  if (/rent|landlord|apartment|property|housing/i.test(m))      return { category: "Housing",     icon: BILL_ICONS["Rent"]!,         color: BILL_COLORS["Rent"]! };
  if (/electric|kahramaa|utility/i.test(m))                      return { category: "Electricity",  icon: BILL_ICONS["Electricity"]!,  color: BILL_COLORS["Electricity"]! };
  if (/water/i.test(m))                                          return { category: "Water",        icon: BILL_ICONS["Water"]!,        color: BILL_COLORS["Water"]! };
  if (/ooredoo|stc|vodafone|du |etisalat|phone|mobile|telecom/i.test(m)) return { category: "Phone", icon: BILL_ICONS["Phone"]!, color: BILL_COLORS["Phone"]! };
  if (/internet|broadband|fiber|wifi/i.test(m))                  return { category: "Internet",     icon: BILL_ICONS["Internet"]!,     color: BILL_COLORS["Internet"]! };
  if (/netflix/i.test(m))                                        return { category: "Netflix",      icon: BILL_ICONS["Netflix"]!,      color: BILL_COLORS["Netflix"]! };
  if (/spotify/i.test(m))                                        return { category: "Spotify",      icon: BILL_ICONS["Spotify"]!,      color: BILL_COLORS["Spotify"]! };
  if (/disney|hbo|hulu|apple tv|prime video|streaming/i.test(m))return { category: "Streaming",    icon: BILL_ICONS["Streaming"]!,    color: BILL_COLORS["Streaming"]! };
  if (/apple|icloud|itunes/i.test(m))                            return { category: "Apple",        icon: BILL_ICONS["Apple"]!,        color: BILL_COLORS["Apple"]! };
  if (/google|youtube/i.test(m))                                 return { category: "Google",       icon: BILL_ICONS["Google"]!,       color: BILL_COLORS["Google"]! };
  if (/amazon|aws/i.test(m))                                     return { category: "Amazon",       icon: BILL_ICONS["Amazon"]!,       color: BILL_COLORS["Amazon"]! };
  if (/gym|fitness|planet|crossfit/i.test(m))                    return { category: "Gym",          icon: BILL_ICONS["Gym"]!,          color: BILL_COLORS["Gym"]! };
  if (/insurance|takaful/i.test(m))                              return { category: "Insurance",    icon: BILL_ICONS["Insurance"]!,    color: BILL_COLORS["Insurance"]! };
  if (/transport|careem|uber|nol|bus|metro/i.test(m))            return { category: "Transport",    icon: BILL_ICONS["Transport"]!,    color: BILL_COLORS["Transport"]! };
  return { category: "Subscription", icon: BILL_ICONS["Default"]!, color: BILL_COLORS["Default"]! };
}

function nextDueDate(lastPaid: Date, frequency: string): Date {
  const next = new Date(lastPaid);
  switch (frequency) {
    case "weekly":    next.setDate(next.getDate() + 7);    break;
    case "monthly":   next.setMonth(next.getMonth() + 1);  break;
    case "quarterly": next.setMonth(next.getMonth() + 3);  break;
    case "annual":    next.setFullYear(next.getFullYear() + 1); break;
    default:          next.setMonth(next.getMonth() + 1);  break;
  }
  return next;
}

function detectFrequency(gaps: number[]): "weekly" | "monthly" | "quarterly" | "annual" | null {
  if (gaps.length === 0) return null;
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avg >= 5  && avg <= 10) return "weekly";
  if (avg >= 25 && avg <= 35) return "monthly";
  if (avg >= 80 && avg <= 100) return "quarterly";
  if (avg >= 330 && avg <= 400) return "annual";
  return null;
}

// ── Auto-detect recurring expenses from history ───────────────────────────────
router.get("/bills/detect", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;

    // Look back 180 days for recurring patterns
    const since = new Date(); since.setDate(since.getDate() - 180);
    const allExp = await db.select().from(expenses)
      .where(and(eq(expenses.userId, userId), gte(expenses.date, since)))
      .orderBy(desc(expenses.date));

    // Group by normalized merchant name
    const merchantGroups: Record<string, { date: Date; amount: number }[]> = {};
    for (const e of allExp) {
      if (!e.merchant) continue;
      const key = e.merchant.toLowerCase().trim().slice(0, 30);
      if (!merchantGroups[key]) merchantGroups[key] = [];
      merchantGroups[key].push({ date: new Date(e.date), amount: e.amount });
    }

    // Also group by category for merchants without names
    const categoryGroups: Record<string, { date: Date; amount: number; merchant?: string }[]> = {};
    for (const e of allExp) {
      if (e.merchant) continue; // already handled
      const key = e.category;
      if (!categoryGroups[key]) categoryGroups[key] = [];
      categoryGroups[key].push({ date: new Date(e.date), amount: e.amount, merchant: e.merchant ?? undefined });
    }

    const detected: {
      name: string; merchantName: string; amount: number; frequency: string;
      category: string; icon: string; color: string; lastPaid: Date; nextDue: Date;
      confidence: number; occurrences: number;
    }[] = [];

    // Process merchant groups
    for (const [merchant, entries] of Object.entries(merchantGroups)) {
      if (entries.length < 2) continue;
      const sorted = entries.sort((a, b) => b.date.getTime() - a.date.getTime());
      const gaps: number[] = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        gaps.push(Math.round((sorted[i]!.date.getTime() - sorted[i + 1]!.date.getTime()) / (1000 * 60 * 60 * 24)));
      }
      const freq = detectFrequency(gaps);
      if (!freq) continue;

      // Amount consistency check (within 20%)
      const avgAmt = entries.reduce((s, e) => s + e.amount, 0) / entries.length;
      const amtVariance = entries.every(e => Math.abs(e.amount - avgAmt) / avgAmt < 0.2);
      if (!amtVariance && entries.length < 4) continue;

      const lastPaid = sorted[0]!.date;
      const nextDue  = nextDueDate(lastPaid, freq);
      const meta     = categorizeRecurring(merchant);
      const name     = merchant.charAt(0).toUpperCase() + merchant.slice(1);
      const confidence = Math.min(100, 50 + entries.length * 10 + (amtVariance ? 20 : 0));

      detected.push({
        name, merchantName: merchant, amount: parseFloat(avgAmt.toFixed(2)), frequency: freq,
        category: meta.category, icon: meta.icon, color: meta.color,
        lastPaid, nextDue, confidence, occurrences: entries.length,
      });
    }

    // Get existing confirmed bills to avoid duplicates
    const existing = await db.select().from(bills).where(eq(bills.userId, userId));
    const existingMerchants = new Set(existing.map(b => b.merchantName?.toLowerCase().trim()));
    const fresh = detected.filter(d => !existingMerchants.has(d.merchantName.toLowerCase()));

    res.json({ detected: fresh.slice(0, 20), total: fresh.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Detection failed" });
  }
});

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.get("/bills", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const result = await db.select().from(bills)
      .where(and(eq(bills.userId, userId), eq(bills.isActive, true)))
      .orderBy(bills.nextDue);
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/bills", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { name, merchantName, amount, frequency, category, icon, color, lastPaid, nextDue, isAutoDetected, isConfirmed, notes } = req.body as {
      name: string; merchantName?: string; amount: number; frequency: string;
      category: string; icon?: string; color?: string; lastPaid?: string;
      nextDue?: string; isAutoDetected?: boolean; isConfirmed?: boolean; notes?: string;
    };
    if (!name || !amount || !category) { res.status(400).json({ error: "name, amount, category required" }); return; }
    const meta = icon ? { icon, color: color ?? "#6C63FF" } : categorizeRecurring(name);
    const lastPaidDate = lastPaid ? new Date(lastPaid) : new Date();
    const nextDueDate2 = nextDue  ? new Date(nextDue)  : nextDueDate(lastPaidDate, frequency ?? "monthly");
    const [bill] = await db.insert(bills).values({
      userId, name, merchantName, amount, frequency: frequency ?? "monthly",
      category, icon: meta.icon, color: meta.color,
      lastPaid: lastPaidDate, nextDue: nextDueDate2,
      isAutoDetected: isAutoDetected ?? false,
      isConfirmed: isConfirmed ?? true,
      notes,
    }).returning();
    res.status(201).json(bill);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/bills/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const { name, amount, frequency, category, icon, color, lastPaid, nextDue, isActive, isConfirmed, notes } = req.body as any;
    const updates: any = {};
    if (name !== undefined)        updates.name        = name;
    if (amount !== undefined)      updates.amount      = amount;
    if (frequency !== undefined)   updates.frequency   = frequency;
    if (category !== undefined)    updates.category    = category;
    if (icon !== undefined)        updates.icon        = icon;
    if (color !== undefined)       updates.color       = color;
    if (lastPaid !== undefined)    updates.lastPaid    = new Date(lastPaid);
    if (nextDue !== undefined)     updates.nextDue     = new Date(nextDue);
    if (isActive !== undefined)    updates.isActive    = isActive;
    if (isConfirmed !== undefined) updates.isConfirmed = isConfirmed;
    if (notes !== undefined)       updates.notes       = notes;
    const [bill] = await db.update(bills).set(updates).where(and(eq(bills.id, id), eq(bills.userId, userId))).returning();
    res.json(bill);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/bills/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(bills).where(and(eq(bills.id, id), eq(bills.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/bills/summary", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const activeBills = await db.select().from(bills)
      .where(and(eq(bills.userId, userId), eq(bills.isActive, true), eq(bills.isConfirmed, true)));

    const now   = new Date();
    const week  = new Date(); week.setDate(week.getDate() + 7);
    const month = new Date(); month.setDate(month.getDate() + 30);

    // Monthly cost normalised
    const monthlyTotal = activeBills.reduce((sum, b) => {
      const amt = b.amount ?? 0;
      switch (b.frequency) {
        case "weekly":    return sum + amt * 4.33;
        case "monthly":   return sum + amt;
        case "quarterly": return sum + amt / 3;
        case "annual":    return sum + amt / 12;
        default:          return sum + amt;
      }
    }, 0);

    const dueThisWeek  = activeBills.filter(b => b.nextDue && new Date(b.nextDue) <= week  && new Date(b.nextDue) >= now);
    const dueThisMonth = activeBills.filter(b => b.nextDue && new Date(b.nextDue) <= month && new Date(b.nextDue) >= now);
    const overdue      = activeBills.filter(b => b.nextDue && new Date(b.nextDue) < now);

    res.json({
      monthlyTotal: parseFloat(monthlyTotal.toFixed(2)),
      totalBills: activeBills.length,
      dueThisWeek: dueThisWeek.length,
      dueThisMonth: dueThisMonth.length,
      overdueCount: overdue.length,
      upcoming: dueThisMonth
        .sort((a, b) => new Date(a.nextDue!).getTime() - new Date(b.nextDue!).getTime())
        .slice(0, 5),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

// Mark a bill as paid — advances nextDue
router.post("/bills/:id/paid", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id    = Number(req.params["id"]);
    const [bill] = await db.select().from(bills).where(and(eq(bills.id, id), eq(bills.userId, userId)));
    if (!bill) { res.status(404).json({ error: "Not found" }); return; }
    const now  = new Date();
    const next = nextDueDate(now, bill.frequency);
    const [updated] = await db.update(bills).set({ lastPaid: now, nextDue: next }).where(eq(bills.id, id)).returning();
    res.json(updated);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
