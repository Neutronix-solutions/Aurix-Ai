import { Router, Request } from "express";
import { db, goldAssets, goldTransactions } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

const QAR_RATE    = 3.64;
const TROY_OZ_TO_GRAM = 31.1035;

const PURITY: Record<string, number> = {
  "24K":  1.0,
  "21K":  0.875,
  "18K":  0.75,
  "coin": 1.0,
  "bar":  0.9999,
};

// ── Gold price cache (5 min) ─────────────────────────────────────────────────
let priceCache: { goldUSD: number; source: string; at: number } | null = null;

async function tryYahooFinance(): Promise<number | null> {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MoneyMind/1.0)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice as number | undefined;
    return price && price > 500 ? price : null;
  } catch { return null; }
}

async function tryMetalsLive(): Promise<number | null> {
  try {
    const res = await fetch("https://api.metals.live/v1/spot", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const raw = await res.json() as Array<Record<string, number>>;
    if (!Array.isArray(raw)) return null;
    for (const item of raw) {
      if (item["gold"] && item["gold"] > 500) return item["gold"];
    }
    return null;
  } catch { return null; }
}

async function tryAlternativeSource(): Promise<number | null> {
  try {
    // Use open.er-api for XAU (gold as currency vs USD)
    const res = await fetch("https://open.er-api.com/v6/latest/XAU", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { result: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) return null;
    const usdPerOz = data.rates["USD"];
    return usdPerOz && usdPerOz > 500 ? usdPerOz : null;
  } catch { return null; }
}

async function getLiveGoldPrice(): Promise<{ goldUSD: number; source: string }> {
  if (priceCache && Date.now() - priceCache.at < 300_000) {
    return { goldUSD: priceCache.goldUSD, source: priceCache.source };
  }

  // Try sources in order of reliability
  let goldUSD: number | null = null;
  let source = "cache";

  goldUSD = await tryYahooFinance();
  if (goldUSD) { source = "Yahoo Finance"; }

  if (!goldUSD) {
    goldUSD = await tryAlternativeSource();
    if (goldUSD) source = "Open Exchange Rates";
  }

  if (!goldUSD) {
    goldUSD = await tryMetalsLive();
    if (goldUSD) source = "metals.live";
  }

  if (!goldUSD) {
    goldUSD = priceCache?.goldUSD ?? 3318;
    source = priceCache ? "cached" : "fallback";
  }

  priceCache = { goldUSD, source, at: Date.now() };
  return { goldUSD, source };
}

// Price per gram in QAR for each karat
function buildPrices(goldOzUSD: number) {
  const perGramQAR24K = (goldOzUSD * QAR_RATE) / TROY_OZ_TO_GRAM;
  const prices: Record<string, number> = {};
  for (const [type, purity] of Object.entries(PURITY)) {
    prices[type] = parseFloat((perGramQAR24K * purity).toFixed(2));
  }
  return { perGramQAR24K, prices };
}

// ── Partner stores ─────────────────────────────────────────────────────────
const PARTNER_STORES = [
  { id: "qge",     name: "Qatar Gold Exchange", verified: true, emoji: "🏆", location: "Souq Waqif, Doha",     rating: 4.9, fee: 0.015, speciality: "Bullion & Bars",   goldTypes: ["24K", "bar", "coin"] },
  { id: "damas",   name: "Damas Jewellers",     verified: true, emoji: "💎", location: "Villaggio Mall, Doha", rating: 4.7, fee: 0.020, speciality: "21K Jewellery",    goldTypes: ["21K", "18K"]         },
  { id: "mannai",  name: "Mannai Jewellers",     verified: true, emoji: "⭐", location: "Al Mirqab Mall, Doha", rating: 4.8, fee: 0.018, speciality: "GCC Gold",         goldTypes: ["21K", "24K"]         },
  { id: "alfardan",name: "Al Fardan Jewellery",  verified: true, emoji: "🌟", location: "The Pearl, Doha",      rating: 4.9, fee: 0.025, speciality: "Luxury & Coins",   goldTypes: ["24K", "coin", "bar"] },
  { id: "almana",  name: "Al Mana Jewellers",    verified: true, emoji: "🥇", location: "Lagoona Mall, Doha",  rating: 4.6, fee: 0.015, speciality: "All Types",        goldTypes: ["24K", "21K", "18K", "coin"] },
];

// ── GET /gold/price ────────────────────────────────────────────────────────
router.get("/gold/price", requireAuth, async (req, res) => {
  try {
    const { goldUSD, source } = await getLiveGoldPrice();
    const { perGramQAR24K, prices } = buildPrices(goldUSD);
    res.json({
      goldOzUSD: goldUSD,
      perGramQAR24K: parseFloat(perGramQAR24K.toFixed(2)),
      pricesByType: prices,
      source,
      nextRefreshMs: priceCache ? Math.max(0, 300_000 - (Date.now() - priceCache.at)) : 0,
      lastUpdated: priceCache ? new Date(priceCache.at).toISOString() : new Date().toISOString(),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch gold price" });
  }
});

// ── GET /gold/stores ───────────────────────────────────────────────────────
router.get("/gold/stores", requireAuth, async (_req, res) => {
  try {
    const { goldUSD } = await getLiveGoldPrice();
    const { prices } = buildPrices(goldUSD);
    const stores = PARTNER_STORES.map(s => ({
      ...s,
      pricesByType: Object.fromEntries(s.goldTypes.map(gt => [gt, prices[gt] ?? prices["24K"]])),
    }));
    res.json(stores);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stores" });
  }
});

// ── GET /gold/portfolio ────────────────────────────────────────────────────
router.get("/gold/portfolio", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const assets = await db.select().from(goldAssets).where(eq(goldAssets.userId, userId));
    const { goldUSD } = await getLiveGoldPrice();
    const { prices } = buildPrices(goldUSD);

    const holdings = assets.map(a => {
      const currentPricePerGram = prices[a.goldType] ?? prices["24K"]!;
      const currentValue  = a.quantityGrams * currentPricePerGram;
      const investedValue = a.quantityGrams * a.avgBuyPrice;
      const pnl    = currentValue - investedValue;
      const pnlPct = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
      return { ...a, currentPricePerGram, currentValue: +currentValue.toFixed(2), investedValue: +investedValue.toFixed(2), pnl: +pnl.toFixed(2), pnlPct: +pnlPct.toFixed(2) };
    });

    const totalValue    = holdings.reduce((s, h) => s + h.currentValue,   0);
    const totalInvested = holdings.reduce((s, h) => s + h.investedValue, 0);
    const totalPnl      = totalValue - totalInvested;
    const totalPnlPct   = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

    res.json({ holdings, summary: { totalValue: +totalValue.toFixed(2), totalInvested: +totalInvested.toFixed(2), totalPnl: +totalPnl.toFixed(2), totalPnlPct: +totalPnlPct.toFixed(2) } });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch gold portfolio" });
  }
});

// ── GET /gold/transactions ─────────────────────────────────────────────────
router.get("/gold/transactions", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const txns = await db.select().from(goldTransactions).where(eq(goldTransactions.userId, userId)).orderBy(desc(goldTransactions.createdAt)).limit(100);
    res.json(txns);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// ── POST /gold/buy ─────────────────────────────────────────────────────────
router.post("/gold/buy", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { goldType, quantityGrams, storeId, note } = req.body as { goldType: string; quantityGrams: number; storeId?: string; note?: string };

    if (!goldType || !quantityGrams || quantityGrams <= 0) { res.status(400).json({ error: "goldType and quantityGrams are required" }); return; }

    const { goldUSD } = await getLiveGoldPrice();
    const { prices } = buildPrices(goldUSD);
    const pricePerGram = prices[goldType] ?? prices["24K"]!;
    const store = PARTNER_STORES.find(s => s.id === storeId);
    const fee = store?.fee ?? 0.015;
    const totalAmount = +(quantityGrams * pricePerGram * (1 + fee)).toFixed(2);
    const storeName   = store?.name ?? "Direct Purchase";

    const [existing] = await db.select().from(goldAssets).where(and(eq(goldAssets.userId, userId), eq(goldAssets.goldType, goldType))).limit(1);

    if (existing) {
      const totalGrams  = existing.quantityGrams + quantityGrams;
      const newAvgPrice = (existing.quantityGrams * existing.avgBuyPrice + quantityGrams * pricePerGram) / totalGrams;
      await db.update(goldAssets).set({ quantityGrams: totalGrams, avgBuyPrice: +newAvgPrice.toFixed(4), updatedAt: new Date() }).where(eq(goldAssets.id, existing.id));
    } else {
      await db.insert(goldAssets).values({ userId, goldType, quantityGrams, avgBuyPrice: pricePerGram });
    }

    const [txn] = await db.insert(goldTransactions).values({ userId, type: "buy", goldType, quantityGrams, pricePerGram, totalAmount, storeName, storeId: storeId ?? null, note: note ?? null }).returning();

    res.status(201).json({ transaction: txn, pricePerGram, totalAmount, fee: +(quantityGrams * pricePerGram * fee).toFixed(2), storeName });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to process purchase" });
  }
});

export default router;
