import { Router, Request } from "express";
import { db, portfolioHoldings } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

router.get("/portfolio", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const holdings = await db.select().from(portfolioHoldings).where(eq(portfolioHoldings.userId, userId));
    res.json(holdings);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.post("/portfolio", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { symbol, name, type, quantity, buyPrice, currentPrice } = req.body as {
      symbol: string; name: string; type: string; quantity: number; buyPrice: number; currentPrice: number;
    };
    const [holding] = await db.insert(portfolioHoldings).values({ userId, symbol, name, type, quantity, buyPrice, currentPrice }).returning();
    res.status(201).json(holding);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.get("/portfolio/summary", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const holdings = await db.select().from(portfolioHoldings).where(eq(portfolioHoldings.userId, userId));
    const totalValue = holdings.reduce((s, h) => s + h.currentPrice * h.quantity, 0);
    const totalCost = holdings.reduce((s, h) => s + h.buyPrice * h.quantity, 0);
    const totalPnl = totalValue - totalCost;
    const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const typeMap: Record<string, number> = {};
    for (const h of holdings) {
      typeMap[h.type] = (typeMap[h.type] ?? 0) + h.currentPrice * h.quantity;
    }
    const allocation = Object.entries(typeMap).map(([type, value]) => ({
      type, value, percentage: totalValue > 0 ? (value / totalValue) * 100 : 0,
    }));
    res.json({ totalValue, totalCost, totalPnl, totalPnlPercent, allocation });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/portfolio/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    const { currentPrice, quantity } = req.body as { currentPrice: number; quantity?: number };
    const updateData: Partial<typeof portfolioHoldings.$inferInsert> = { currentPrice };
    if (quantity !== undefined) updateData.quantity = quantity;
    const [holding] = await db.update(portfolioHoldings).set(updateData)
      .where(and(eq(portfolioHoldings.id, id), eq(portfolioHoldings.userId, userId))).returning();
    res.json(holding);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.delete("/portfolio/:id", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const id = Number(req.params["id"]);
    await db.delete(portfolioHoldings).where(and(eq(portfolioHoldings.id, id), eq(portfolioHoldings.userId, userId)));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

export default router;
