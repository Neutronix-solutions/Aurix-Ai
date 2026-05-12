import { Router, Request } from "express";
import { generateJSON, generateJSONFromImage } from "../lib/ai";
import { requireAuth, AuthPayload } from "../middlewares/auth";

const router = Router();

// ── Qatar/GCC merchant → category rules ──────────────────────────────────
const MERCHANT_RULES: Array<{ pattern: RegExp; category: string; type?: "debit" | "credit" }> = [
  // Food & Dining
  { pattern: /talabat|طلبات/i,                    category: "Food & Dining" },
  { pattern: /carrefour|كارفور/i,                  category: "Food & Dining" },
  { pattern: /lulu|لولو/i,                         category: "Food & Dining" },
  { pattern: /mcdonalds|mcdonald|ماكدونالدز/i,     category: "Food & Dining" },
  { pattern: /kfc|كنتاكي/i,                        category: "Food & Dining" },
  { pattern: /starbucks|ستاربكس/i,                  category: "Food & Dining" },
  { pattern: /burger king|برغر كنج/i,              category: "Food & Dining" },
  { pattern: /subway|صب واي/i,                     category: "Food & Dining" },
  { pattern: /pizza hut|بيتزا هت/i,               category: "Food & Dining" },
  { pattern: /hungerstation/i,                     category: "Food & Dining" },
  { pattern: /noon food|نون فود/i,                 category: "Food & Dining" },
  // Transport
  { pattern: /uber|أوبر/i,                         category: "Transport" },
  { pattern: /careem|كريم/i,                       category: "Transport" },
  { pattern: /karwa|كروة/i,                        category: "Transport" },
  { pattern: /woqod|وقود/i,                        category: "Transport" },
  { pattern: /q-ride|qride/i,                      category: "Transport" },
  { pattern: /qatar airways|قطر ايرويز/i,          category: "Travel" },
  { pattern: /indigo/i,                            category: "Travel" },
  { pattern: /booking\.com|airbnb/i,               category: "Travel" },
  // Shopping
  { pattern: /amazon|أمازون/i,                     category: "Shopping" },
  { pattern: /noon|نون/i,                          category: "Shopping" },
  { pattern: /centrepoint|سنتر بوينت/i,            category: "Shopping" },
  { pattern: /h&m|h and m/i,                       category: "Shopping" },
  { pattern: /zara|زارا/i,                         category: "Shopping" },
  { pattern: /ikea|ايكيا/i,                        category: "Shopping" },
  { pattern: /max fashion/i,                       category: "Shopping" },
  { pattern: /aldo|الدو/i,                         category: "Shopping" },
  // Entertainment
  { pattern: /netflix|نتفليكس/i,                   category: "Entertainment" },
  { pattern: /spotify|سبوتيفاي/i,                  category: "Entertainment" },
  { pattern: /apple music/i,                       category: "Entertainment" },
  { pattern: /youtube premium/i,                   category: "Entertainment" },
  { pattern: /playstation|ps store|بلايستيشن/i,   category: "Entertainment" },
  { pattern: /cinema|سينما/i,                      category: "Entertainment" },
  // Bills & Utilities
  { pattern: /ooredoo|أوريدو/i,                    category: "Bills & Utilities" },
  { pattern: /stc|s\.t\.c/i,                       category: "Bills & Utilities" },
  { pattern: /vodafone|فودافون/i,                  category: "Bills & Utilities" },
  { pattern: /kahramaa|كهرماء/i,                   category: "Bills & Utilities" },
  { pattern: /woqod electricity/i,                 category: "Bills & Utilities" },
  // Health
  { pattern: /pharmacy|صيدلية/i,                   category: "Health" },
  { pattern: /hamad medical|حمد|hmc/i,             category: "Health" },
  { pattern: /sidra|سدرة/i,                        category: "Health" },
  { pattern: /al ahli hospital|المستشفى/i,         category: "Health" },
  // Income signals (credits from employers/government)
  { pattern: /salary|راتب/i,                       category: "Other", type: "credit" },
  { pattern: /refund|استرداد/i,                    category: "Other", type: "credit" },
];

// ── Qatar bank SMS patterns ────────────────────────────────────────────────
const QATAR_BANKS = [
  "QNB", "CBQ", "Doha Bank", "QIIB", "Masraf Al Rayan",
  "Al Khaliji", "Arab Bank", "QIB", "Qatar Islamic Bank",
  "HSBC Qatar", "Standard Chartered Qatar", "Ahlibank",
  "بنك قطر الوطني", "بنك قطر", "مصرف الريان", "بنك الدوحة",
];

// ── Amount extraction (handles Arabic digits + common SMS formats) ─────────
function extractAmount(text: string): number | null {
  // Normalize Arabic-Indic digits to Western
  const normalized = text.replace(/[٠١٢٣٤٥٦٧٨٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

  const patterns = [
    // "QAR 1,234.56" or "QAR1234.56"
    /(?:QAR|ريال قطري|ر\.ق\.?)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    // "1,234.56 QAR"
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:QAR|ريال قطري|ر\.ق\.?)/i,
    // "charged with 1234.56" or "debited 1234"
    /(?:charged|debited|deducted|spent|paid|purchase of|amount of)\s+(?:QAR\s*)?([0-9,]+(?:\.[0-9]{1,2})?)/i,
    // Arabic: "تم خصم 500 ريال"
    /(?:تم خصم|خصم مبلغ|مبلغ)\s+([0-9,]+(?:\.[0-9]{1,2})?)/,
    // Fallback: any decimal/integer near "QAR"
    /([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/,
  ];

  for (const pat of patterns) {
    const m = normalized.match(pat);
    if (m?.[1]) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(n) && n > 0 && n < 500_000) return n;
    }
  }
  return null;
}

// ── Transaction type detection ─────────────────────────────────────────────
function detectType(text: string): "debit" | "credit" {
  const debitKeywords  = /debit|charged|debited|spent|paid|purchase|payment|withdrawal|POS|خصم|سداد|شراء|سحب/i;
  const creditKeywords = /credit|credited|received|refund|salary|deposit|transfer in|واردة|إيداع|راتب|استرداد/i;
  if (creditKeywords.test(text)) return "credit";
  if (debitKeywords.test(text)) return "debit";
  return "debit"; // default assumption for bank SMS
}

// ── Merchant extraction ────────────────────────────────────────────────────
function extractMerchant(text: string): { merchant: string | null; category: string } {
  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(text)) {
      const m = text.match(rule.pattern);
      return { merchant: m?.[0] ?? null, category: rule.category };
    }
  }

  // Try to extract "at <MERCHANT>" pattern
  const atPattern = /(?:at|@|من|عند|لدى)\s+([A-Z][A-Za-z\s&'-]{2,30})/;
  const m = text.match(atPattern);
  if (m?.[1]) return { merchant: m[1].trim(), category: "Other" };

  return { merchant: null, category: "Other" };
}

// ── Date extraction ────────────────────────────────────────────────────────
function extractDate(text: string): string | null {
  const patterns = [
    /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/,
    /(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,
    /(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i,
  ];
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const d = new Date(m[0]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }
  return null;
}

// ── Is this a bank SMS? ────────────────────────────────────────────────────
function isBankSms(text: string): boolean {
  const bankKeywords = /debit|credit|charged|balance|account|card|transaction|QAR|خصم|حساب|بطاقة|رصيد/i;
  const hasBank      = QATAR_BANKS.some(b => text.toLowerCase().includes(b.toLowerCase()));
  return hasBank || bankKeywords.test(text);
}

// ── Duplicate detection helper ─────────────────────────────────────────────
function generateSmsHash(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 80);
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) - hash) + clean.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

// ── POST /sms/parse ────────────────────────────────────────────────────────
router.post("/sms/parse", requireAuth, async (req, res) => {
  try {
    const { message, imageBase64 } = req.body as { message?: string; imageBase64?: string };
    if (!message && !imageBase64) {
      res.status(400).json({ error: "message or imageBase64 required" }); return;
    }

    // ── Fast rule-based path (text SMS) ───────────────────────────────────
    if (message && !imageBase64) {
      const ruleAmount   = extractAmount(message);
      const ruleType     = detectType(message);
      const { merchant: ruleMerchant, category: ruleCategory } = extractMerchant(message);
      const ruleDate     = extractDate(message);
      const bankSms      = isBankSms(message);
      const ruleConfidence = ruleAmount !== null && ruleMerchant !== null ? 0.92
        : ruleAmount !== null && bankSms ? 0.80
        : 0.50;

      // High confidence rule-based result — skip AI
      if (ruleConfidence >= 0.80) {
        res.json({
          amount:          ruleAmount,
          merchant:        ruleMerchant,
          type:            ruleType,
          date:            ruleDate,
          category:        ruleCategory,
          description:     ruleMerchant ? `${ruleType === "credit" ? "Received from" : "Paid to"} ${ruleMerchant}` : message.slice(0, 60),
          currencyOriginal: "QAR",
          confidence:      ruleConfidence,
          source:          "rule-engine",
          smsHash:         generateSmsHash(message),
        });
        return;
      }

      // Low confidence — try AI to fill gaps, fall back to rule-based on failure
      const hintContext = [
        ruleAmount !== null ? `Detected amount: ${ruleAmount} QAR` : "",
        ruleMerchant ? `Detected merchant: ${ruleMerchant}` : "",
      ].filter(Boolean).join(". ");

      try {
        const aiContent = await callAI(message, hintContext);
        res.json({
          ...aiContent,
          smsHash:     generateSmsHash(message),
          // Override with rule results if AI is less accurate
          amount:      aiContent.amount ?? ruleAmount,
          type:        aiContent.type ?? ruleType,
          category:    aiContent.category ?? ruleCategory,
          merchant:    aiContent.merchant ?? ruleMerchant,
          date:        aiContent.date ?? ruleDate,
          source:      "ai-enhanced",
        });
      } catch {
        // AI unavailable — return best rule-based guess
        res.json({
          amount:           ruleAmount,
          merchant:         ruleMerchant,
          type:             ruleType,
          date:             ruleDate,
          category:         ruleCategory,
          description:      message.slice(0, 60),
          currencyOriginal: "QAR",
          confidence:       ruleConfidence,
          source:           "rule-engine",
          smsHash:          generateSmsHash(message),
        });
      }
      return;
    }

    // ── Image path (receipt scan) ─────────────────────────────────────────
    const imageData = imageBase64!;

    // Validate MIME type. Only JPEG, PNG, and WebP are accepted.
    // Other types (GIF, BMP, TIFF, SVG) are rejected before reaching the AI model.
    const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    let detectedMime = "image/jpeg"; // bare base64 (no data URI) assumes JPEG

    if (imageData.startsWith("data:")) {
      const mimeMatch = imageData.match(/^data:([^;,]+);base64,/);
      if (!mimeMatch?.[1]) {
        res.status(415).json({ error: "Invalid image format. Expected data:image/...;base64,... encoding." });
        return;
      }
      detectedMime = mimeMatch[1].toLowerCase();
    }

    if (!ALLOWED_MIME_TYPES.has(detectedMime)) {
      res.status(415).json({
        error: `Unsupported image type '${detectedMime}'. Please use JPEG, PNG, or WebP.`,
      });
      return;
    }

    try {
      const aiContent = await callAIWithImage(imageData);
      // Warn caller when AI confidence is very low
      const low = typeof aiContent?.confidence === "number" && aiContent.confidence < 0.4;
      res.json({
        ...aiContent,
        source: "vision-ai",
        ...(low ? { warning: "Low confidence result — please review the extracted details carefully." } : {}),
      });
    } catch {
      res.status(503).json({ error: "Receipt scanning requires AI — please enter details manually" });
    }

  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Parsing failed" });
  }
});

// ── POST /sms/parse-batch (process multiple SMS at once) ──────────────────
router.post("/sms/parse-batch", requireAuth, async (req, res) => {
  try {
    const { messages: smsMessages } = req.body as { messages: string[] };
    if (!Array.isArray(smsMessages) || smsMessages.length === 0) {
      res.status(400).json({ error: "messages array required" }); return;
    }

    // Filter to bank SMS only and limit to 50
    const bankMessages = smsMessages.filter(isBankSms).slice(0, 50);

    const results = bankMessages.map(msg => {
      const amount   = extractAmount(msg);
      if (!amount) return null;
      const type     = detectType(msg);
      const { merchant, category } = extractMerchant(msg);
      const date     = extractDate(msg);
      return {
        amount, merchant, type, date, category,
        description:     merchant ? `${type === "credit" ? "Received from" : "Paid to"} ${merchant}` : msg.slice(0, 60),
        currencyOriginal: "QAR",
        confidence:      merchant ? 0.90 : 0.75,
        source:          "rule-engine",
        smsHash:         generateSmsHash(msg),
        rawSms:          msg.slice(0, 100),
      };
    }).filter(Boolean);

    res.json({ parsed: results, total: bankMessages.length, extracted: results.length });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Batch parsing failed" });
  }
});

// ── AI helpers ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a financial transaction extractor for Qatar. Extract transaction details and return ONLY valid JSON with exactly these fields:
- amount (number in QAR — if USD/AED/SAR, convert: 1 USD=3.64, 1 AED=0.99, 1 SAR=0.97)
- merchant (string — store/restaurant/service name, or null)
- type ("debit" for spending, "credit" for income/refund)
- date (ISO 8601 string or null)
- category (one of: "Food & Dining", "Shopping", "Transport", "Entertainment", "Health", "Bills & Utilities", "Travel", "Other")
- description (brief human-readable description)
- currency_original (original currency code if not QAR, else "QAR")
- confidence (number 0-1)

Qatar context: Common banks include QNB, CBQ, Doha Bank, QIIB, Masraf Al Rayan. Common merchants: Talabat (food), LuLu/Carrefour (groceries), Uber/Careem (transport), Kahramaa (electricity/water), Ooredoo/STC (telecom).`;

async function callAI(text: string, hint = ""): Promise<any> {
  const userMsg = hint
    ? `Transaction text: "${text}"\n\nHints from pattern analysis: ${hint}`
    : `Transaction text: "${text}"`;
  try {
    return await generateJSON(SYSTEM_PROMPT, userMsg, 300);
  } catch (err) {
    // Defensive fallback for SMS parsing only — Gemini occasionally returns
    // malformed JSON for free-form bank SMS. Logged with full error so we
    // can monitor frequency.
    // eslint-disable-next-line no-console
    console.error("[sms.callAI] Gemini JSON parse failed:", err);
    return { type: "debit", merchant: null, confidence: 0.3 };
  }
}

async function callAIWithImage(base64: string): Promise<any> {
  // Detect mime type from data URL prefix; default to jpeg.
  const m = /^data:([a-z0-9+/.\-]+);base64,/i.exec(base64);
  const mimeType = m ? m[1]! : "image/jpeg";
  try {
    return await generateJSONFromImage(SYSTEM_PROMPT, base64, mimeType, 350);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sms.callAIWithImage] Gemini vision JSON failed:", err);
    return { type: "debit", merchant: null, confidence: 0.3 };
  }
}

export default router;
