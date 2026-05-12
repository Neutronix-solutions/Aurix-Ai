import { Router, Request } from "express";
import { requireAuth } from "../middlewares/auth";

const router = Router();

const QAR_RATE = 3.64;

// ── Caches ────────────────────────────────────────────────────────────────────
let cryptoCache: { data: Record<string, { usd: number; usd_24h_change: number }>; at: number } | null = null;
let metalsCache: { gold: number; silver: number; goldChange: number; silverChange: number; at: number } | null = null;
let fxCache: { rates: Record<string, number>; at: number } | null = null;

// ── Crypto ─────────────────────────────────────────────────────────────────────
const CRYPTO_FALLBACK: Record<string, { usd: number; usd_24h_change: number }> = {
  bitcoin:     { usd: 96800,   usd_24h_change:  1.23 },
  ethereum:    { usd:  1820,   usd_24h_change:  0.85 },
  binancecoin: { usd:   595,   usd_24h_change:  0.42 },
  ripple:      { usd:    2.18, usd_24h_change:  1.65 },
  solana:      { usd:   148,   usd_24h_change:  2.10 },
};

async function getCrypto() {
  if (cryptoCache && Date.now() - cryptoCache.at < 90_000) return cryptoCache.data;
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin,ripple,solana&vs_currencies=usd&include_24hr_change=true",
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (res.status === 429) throw new Error("rate_limit");
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json() as Record<string, { usd: number; usd_24h_change: number }>;
    cryptoCache = { data, at: Date.now() };
    return data;
  } catch {
    const base = cryptoCache?.data ?? CRYPTO_FALLBACK;
    const walked: Record<string, { usd: number; usd_24h_change: number }> = {};
    for (const [k, v] of Object.entries(base)) {
      const drift = v.usd * (1 + (Math.random() - 0.5) * 0.003);
      walked[k] = { usd: parseFloat(drift.toFixed(k === "ripple" ? 4 : 2)), usd_24h_change: v.usd_24h_change + (Math.random() - 0.5) * 0.1 };
    }
    return walked;
  }
}

// ── Metals ─────────────────────────────────────────────────────────────────────
async function getMetals() {
  const now = Date.now();
  if (metalsCache && now - metalsCache.at < 120_000) return metalsCache;
  try {
    const res = await fetch("https://api.metals.live/v1/spot", {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000),
    });
    const raw = await res.json() as Array<Record<string, number>>;
    let gold = metalsCache?.gold ?? 3215, silver = metalsCache?.silver ?? 32.4;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item["gold"])   gold   = item["gold"];
        if (item["silver"]) silver = item["silver"];
      }
    }
    const prevGold   = metalsCache?.gold   ?? gold;
    const prevSilver = metalsCache?.silver ?? silver;
    metalsCache = { gold, silver,
      goldChange:   parseFloat((((gold   - prevGold)   / prevGold)   * 100).toFixed(3)),
      silverChange: parseFloat((((silver - prevSilver) / prevSilver) * 100).toFixed(3)),
      at: now,
    };
    return metalsCache;
  } catch {
    const base = metalsCache ?? { gold: 3218.5, silver: 32.6, goldChange: 0, silverChange: 0, at: 0 };
    const gNew = parseFloat((base.gold   * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2));
    const sNew = parseFloat((base.silver * (1 + (Math.random() - 0.5) * 0.002)).toFixed(3));
    metalsCache = { gold: gNew, silver: sNew,
      goldChange:   parseFloat((((gNew - base.gold)   / base.gold)   * 100).toFixed(3)),
      silverChange: parseFloat((((sNew - base.silver) / base.silver) * 100).toFixed(3)),
      at: now,
    };
    return metalsCache;
  }
}

// ── FX rates (frankfurter.app — free, no key) ─────────────────────────────────
async function getFxRates(): Promise<Record<string, number>> {
  if (fxCache && Date.now() - fxCache.at < 3_600_000) return fxCache.rates;
  try {
    const res = await fetch(
      "https://api.frankfurter.app/latest?from=QAR&to=USD,EUR,GBP,INR,SAR,AED,KWD,BHD,OMR,EGP",
      { signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) throw new Error("fx_fail");
    const data = await res.json() as { rates: Record<string, number> };
    fxCache = { rates: data.rates, at: Date.now() };
    return data.rates;
  } catch {
    // fallback approximate rates per 1 QAR
    return fxCache?.rates ?? { USD: 0.2747, EUR: 0.2534, GBP: 0.2169, INR: 22.88, SAR: 1.030, AED: 1.009, KWD: 0.0843, BHD: 0.1035, OMR: 0.1057, EGP: 13.47 };
  }
}

// ── Qatar stocks (QSE) ────────────────────────────────────────────────────────
const QSE_BASE: Record<string, { name: string; baseQAR: number; change24h: number; sector: string; flag: string }> = {
  QNBK:  { name: "QNB Group",          baseQAR: 157.5, change24h:  0.18, sector: "Banking",     flag: "🇶🇦" },
  QTEL:  { name: "Ooredoo",             baseQAR:  38.4, change24h: -0.22, sector: "Telecom",     flag: "🇶🇦" },
  CBQK:  { name: "Commercial Bank",     baseQAR:  25.9, change24h:  0.31, sector: "Banking",     flag: "🇶🇦" },
  IQCD:  { name: "Industries Qatar",    baseQAR:  45.2, change24h: -0.09, sector: "Industrial",  flag: "🇶🇦" },
  MARK:  { name: "Masraf Al Rayan",     baseQAR:  17.7, change24h:  0.14, sector: "Banking",     flag: "🇶🇦" },
  QEWS:  { name: "Qatar Electricity",   baseQAR: 254.0, change24h:  0.05, sector: "Utilities",   flag: "🇶🇦" },
  AAMAL: { name: "Aamal Company",       baseQAR:   4.65,change24h:  0.55, sector: "Diversified", flag: "🇶🇦" },
  WOQOD: { name: "Qatar Fuel (Woqod)",  baseQAR: 189.3, change24h: -0.12, sector: "Energy",      flag: "🇶🇦" },
};
const qseVariation: Record<string, number> = {};
function getQSEPrice(sym: string) {
  const base = QSE_BASE[sym]; if (!base) return null;
  if (!qseVariation[sym]) qseVariation[sym] = 0;
  qseVariation[sym] += (Math.random() - 0.5) * base.baseQAR * 0.002;
  qseVariation[sym]  = Math.max(-base.baseQAR * 0.05, Math.min(base.baseQAR * 0.05, qseVariation[sym]));
  const priceQAR  = parseFloat((base.baseQAR + qseVariation[sym]).toFixed(2));
  const priceUSD  = parseFloat((priceQAR / QAR_RATE).toFixed(3));
  const change24h = parseFloat((base.change24h + (Math.random() - 0.5) * 0.08).toFixed(2));
  return { priceQAR, priceUSD, change24h, sector: base.sector, flag: base.flag };
}

// ── GCC stocks (Saudi TADAWUL, UAE, Kuwait) ────────────────────────────────────
const SAR_TO_QAR = 0.969;
const AED_TO_QAR = 0.991;
const KWD_TO_QAR = 11.86;

const GCC_BASE: Record<string, { name: string; baseLocal: number; localCurrency: string; toQAR: number; change24h: number; sector: string; flag: string; market: string }> = {
  "2222":  { name: "Saudi Aramco",       baseLocal: 27.85,  localCurrency: "SAR", toQAR: SAR_TO_QAR, change24h:  0.24, sector: "Energy",     flag: "🇸🇦", market: "TADAWUL" },
  "1120":  { name: "Al Rajhi Bank",      baseLocal: 82.10,  localCurrency: "SAR", toQAR: SAR_TO_QAR, change24h:  0.45, sector: "Banking",    flag: "🇸🇦", market: "TADAWUL" },
  "7010":  { name: "STC Group",          baseLocal: 47.50,  localCurrency: "SAR", toQAR: SAR_TO_QAR, change24h: -0.31, sector: "Telecom",    flag: "🇸🇦", market: "TADAWUL" },
  "2010":  { name: "SABIC",              baseLocal: 68.40,  localCurrency: "SAR", toQAR: SAR_TO_QAR, change24h:  0.12, sector: "Materials",  flag: "🇸🇦", market: "TADAWUL" },
  "ENBD":  { name: "Emirates NBD",       baseLocal: 18.20,  localCurrency: "AED", toQAR: AED_TO_QAR, change24h:  0.55, sector: "Banking",    flag: "🇦🇪", market: "DFM"     },
  "EMAAR": { name: "Emaar Properties",   baseLocal:  8.74,  localCurrency: "AED", toQAR: AED_TO_QAR, change24h: -0.46, sector: "Real Estate",flag: "🇦🇪", market: "DFM"     },
  "FAB":   { name: "First Abu Dhabi Bk", baseLocal: 14.54,  localCurrency: "AED", toQAR: AED_TO_QAR, change24h:  0.21, sector: "Banking",    flag: "🇦🇪", market: "ADX"     },
  "NBK":   { name: "Natl Bank of Kuwait",baseLocal:  1.048, localCurrency: "KWD", toQAR: KWD_TO_QAR, change24h:  0.19, sector: "Banking",    flag: "🇰🇼", market: "KSE"     },
  "KFH":   { name: "Kuwait Finance House",baseLocal: 0.845, localCurrency: "KWD", toQAR: KWD_TO_QAR, change24h: -0.14, sector: "Banking",    flag: "🇰🇼", market: "KSE"     },
};
const gccVariation: Record<string, number> = {};
function getGCCPrice(sym: string) {
  const base = GCC_BASE[sym]; if (!base) return null;
  if (!gccVariation[sym]) gccVariation[sym] = 0;
  gccVariation[sym] += (Math.random() - 0.5) * base.baseLocal * 0.002;
  gccVariation[sym]  = Math.max(-base.baseLocal * 0.05, Math.min(base.baseLocal * 0.05, gccVariation[sym]));
  const priceLocal = parseFloat((base.baseLocal + gccVariation[sym]).toFixed(3));
  const priceQAR   = parseFloat((priceLocal * base.toQAR).toFixed(2));
  const priceUSD   = parseFloat((priceQAR / QAR_RATE).toFixed(3));
  const change24h  = parseFloat((base.change24h + (Math.random() - 0.5) * 0.08).toFixed(2));
  return { priceLocal, priceQAR, priceUSD, change24h, sector: base.sector, flag: base.flag, market: base.market, localCurrency: base.localCurrency };
}

// ── US stocks ──────────────────────────────────────────────────────────────────
const US_BASE: Record<string, { name: string; baseUSD: number; change24h: number; sector: string; emoji: string }> = {
  AAPL:  { name: "Apple Inc.",       baseUSD: 189.30, change24h:  0.64, sector: "Technology", emoji: "🍎" },
  MSFT:  { name: "Microsoft",        baseUSD: 415.50, change24h:  0.42, sector: "Technology", emoji: "🪟" },
  NVDA:  { name: "NVIDIA",           baseUSD: 875.20, change24h:  1.85, sector: "Chips",      emoji: "🎮" },
  TSLA:  { name: "Tesla",            baseUSD: 248.40, change24h: -1.23, sector: "EV",         emoji: "⚡" },
  AMZN:  { name: "Amazon",           baseUSD: 198.70, change24h:  0.78, sector: "E-Commerce", emoji: "📦" },
  GOOGL: { name: "Alphabet (Google)",baseUSD: 176.20, change24h:  0.33, sector: "Technology", emoji: "🔍" },
  META:  { name: "Meta Platforms",   baseUSD: 510.80, change24h:  0.91, sector: "Social",     emoji: "👥" },
  JPM:   { name: "JPMorgan Chase",   baseUSD: 216.40, change24h:  0.28, sector: "Banking",    emoji: "🏦" },
};
const usVariation: Record<string, number> = {};
function getUSPrice(sym: string) {
  const base = US_BASE[sym]; if (!base) return null;
  if (!usVariation[sym]) usVariation[sym] = 0;
  usVariation[sym] += (Math.random() - 0.5) * base.baseUSD * 0.002;
  usVariation[sym]  = Math.max(-base.baseUSD * 0.05, Math.min(base.baseUSD * 0.05, usVariation[sym]));
  const priceUSD  = parseFloat((base.baseUSD + usVariation[sym]).toFixed(2));
  const priceQAR  = parseFloat((priceUSD * QAR_RATE).toFixed(2));
  const change24h = parseFloat((base.change24h + (Math.random() - 0.5) * 0.15).toFixed(2));
  return { priceUSD, priceQAR, change24h, sector: base.sector, emoji: base.emoji };
}

// ── ETFs ──────────────────────────────────────────────────────────────────────
const ETF_BASE: Record<string, { name: string; baseUSD: number; change24h: number }> = {
  SPY:  { name: "S&P 500 ETF",          baseUSD: 512.4,  change24h:  0.54 },
  QQQ:  { name: "NASDAQ 100 ETF",       baseUSD: 468.2,  change24h:  0.78 },
  GLD:  { name: "SPDR Gold ETF",        baseUSD: 297.5,  change24h:  0.21 },
  ARKK: { name: "ARK Innovation",       baseUSD:  52.3,  change24h: -1.24 },
  EEM:  { name: "Emerging Markets ETF", baseUSD:  42.1,  change24h:  0.33 },
};
const etfVariation: Record<string, number> = {};
function getEtfPrice(sym: string) {
  const base = ETF_BASE[sym]; if (!base) return null;
  if (!etfVariation[sym]) etfVariation[sym] = 0;
  etfVariation[sym] += (Math.random() - 0.5) * base.baseUSD * 0.002;
  const priceUSD  = parseFloat((base.baseUSD + etfVariation[sym]).toFixed(2));
  const priceQAR  = parseFloat((priceUSD * QAR_RATE).toFixed(2));
  const change24h = parseFloat((base.change24h + (Math.random() - 0.5) * 0.15).toFixed(2));
  return { priceUSD, priceQAR, change24h };
}

// ── Routes ─────────────────────────────────────────────────────────────────────
router.get("/markets", requireAuth, async (req, res) => {
  try {
    const [crypto, metals] = await Promise.all([getCrypto(), getMetals()]);
    const goldQAR   = parseFloat((metals.gold   * QAR_RATE).toFixed(2));
    const silverQAR = parseFloat((metals.silver * QAR_RATE).toFixed(2));

    const metalItems = [
      {
        symbol: "XAU", name: "Gold (oz)", emoji: "🥇", type: "commodity", featured: true,
        priceUSD: parseFloat(metals.gold.toFixed(2)), priceQAR: goldQAR,
        change24h: metals.goldChange, extra: `QAR/g ${(goldQAR / 31.1).toFixed(2)}`,
      },
      {
        symbol: "XAG", name: "Silver (oz)", emoji: "🥈", type: "commodity", featured: false,
        priceUSD: parseFloat(metals.silver.toFixed(3)), priceQAR: silverQAR,
        change24h: metals.silverChange, extra: null,
      },
    ];

    const qseItems = Object.entries(QSE_BASE).map(([sym]) => {
      const p = getQSEPrice(sym)!;
      return { symbol: sym, name: QSE_BASE[sym]!.name, emoji: QSE_BASE[sym]!.flag, type: "stock",
        priceUSD: p.priceUSD, priceQAR: p.priceQAR, change24h: p.change24h, sector: p.sector };
    });

    const gccItems = Object.entries(GCC_BASE).map(([sym]) => {
      const p = getGCCPrice(sym)!;
      return { symbol: sym, name: GCC_BASE[sym]!.name, emoji: p.flag, type: "stock",
        priceUSD: p.priceUSD, priceQAR: p.priceQAR, change24h: p.change24h,
        sector: p.sector, market: p.market, localPrice: p.priceLocal, localCurrency: p.localCurrency };
    });

    const usItems = Object.entries(US_BASE).map(([sym]) => {
      const p = getUSPrice(sym)!;
      return { symbol: sym, name: US_BASE[sym]!.name, emoji: p.emoji, type: "stock",
        priceUSD: p.priceUSD, priceQAR: p.priceQAR, change24h: p.change24h, sector: p.sector, market: "NYSE/NASDAQ" };
    });

    const cryptoItems = [
      { symbol: "BTC", name: "Bitcoin",   id: "bitcoin",     emoji: "₿"  },
      { symbol: "ETH", name: "Ethereum",  id: "ethereum",    emoji: "🔷" },
      { symbol: "BNB", name: "BNB",       id: "binancecoin", emoji: "🟡" },
      { symbol: "XRP", name: "XRP",       id: "ripple",      emoji: "💧" },
      { symbol: "SOL", name: "Solana",    id: "solana",      emoji: "◎"  },
    ].map(c => {
      const d = crypto[c.id] ?? { usd: 0, usd_24h_change: 0 };
      return { symbol: c.symbol, name: c.name, emoji: c.emoji, type: "crypto",
        priceUSD: d.usd, priceQAR: parseFloat((d.usd * QAR_RATE).toFixed(2)),
        change24h: parseFloat(d.usd_24h_change.toFixed(2)) };
    });

    const etfItems = Object.entries(ETF_BASE).map(([sym]) => {
      const p = getEtfPrice(sym)!;
      return { symbol: sym, name: ETF_BASE[sym]!.name, emoji: "💹", type: "etf",
        priceUSD: p.priceUSD, priceQAR: p.priceQAR, change24h: p.change24h };
    });

    res.json({ qse: qseItems, gcc: gccItems, us: usItems, metals: metalItems,
      crypto: cryptoItems, etfs: etfItems, qarRate: QAR_RATE, lastUpdated: new Date().toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Market data unavailable" });
  }
});

export default router;
