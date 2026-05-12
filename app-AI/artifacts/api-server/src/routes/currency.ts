import { Router } from "express";

const router = Router();

// ── FX rate cache (1 hour) ─────────────────────────────────────────────────
let rateCache: { rates: Record<string, number>; at: number } | null = null;

const FALLBACK_RATES: Record<string, number> = {
  USD: 0.2747, EUR: 0.2534, GBP: 0.2169, INR: 22.88,
  SAR: 1.0300, AED: 1.0090, KWD: 0.0843, EGP: 13.47,
  BHD: 0.1035, OMR: 0.1057, PKR: 76.50, PHP: 15.78,
  JOD: 0.1948, LBP: 246.10, CNY: 1.9920, JPY: 41.03,
  TRY: 9.400,  MYR: 1.2140, SGD: 0.3655, CAD: 0.3820,
  AUD: 0.4180, CHF: 0.2415,
};

async function getLiveRates(): Promise<Record<string, number>> {
  if (rateCache && Date.now() - rateCache.at < 3_600_000) return rateCache.rates;
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/QAR", {
      headers: { Accept: "application/json", "User-Agent": "MoneyMind/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { result: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) throw new Error("Bad response");
    const rates = { ...FALLBACK_RATES, ...data.rates };
    rateCache = { rates, at: Date.now() };
    return rates;
  } catch {
    const fallback = rateCache?.rates ?? FALLBACK_RATES;
    rateCache = { rates: fallback, at: Date.now() - 3_200_000 }; // re-try soon
    return fallback;
  }
}

// ── GET /currency/rates ────────────────────────────────────────────────────
router.get("/currency/rates", async (_req, res) => {
  try {
    const rates = await getLiveRates();
    res.json({
      base: "QAR",
      rates,
      lastUpdated: rateCache ? new Date(rateCache.at).toISOString() : new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch exchange rates" });
  }
});

// ── GET /currency/convert?from=USD&to=QAR&amount=100 ──────────────────────
router.get("/currency/convert", async (req, res) => {
  try {
    const { from = "USD", to = "QAR", amount = "1" } = req.query as Record<string, string>;
    const amt = parseFloat(amount);
    if (isNaN(amt)) { res.status(400).json({ error: "Invalid amount" }); return; }

    const rates = await getLiveRates();
    const allRates: Record<string, number> = { QAR: 1, ...rates };
    const fromRate = allRates[from] ?? 1;
    const toRate   = allRates[to]   ?? 1;
    const inQAR    = amt / fromRate;
    const result   = inQAR * toRate;

    res.json({ from, to, amount: amt, result: parseFloat(result.toFixed(6)), rate: parseFloat((toRate / fromRate).toFixed(8)) });
  } catch {
    res.status(500).json({ error: "Conversion failed" });
  }
});

export default router;
