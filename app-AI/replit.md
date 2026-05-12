# Aurix AI — AI Financial App

## Overview

Full-stack AI financial app for Qatar (QAR currency). Expo React Native mobile frontend + Express backend.

**Theme**: White (#FFFFFF) background, green (#16A34A) primary accent.

## Architecture

```
pnpm monorepo
├── artifacts/api-server     → Express 5 REST API (port 8080, path /api)
├── artifacts/mobile         → Expo React Native app
├── lib/api-spec             → OpenAPI spec + codegen
├── lib/api-client-react     → Generated React Query hooks
├── lib/api-zod              → Generated Zod schemas
├── lib/db                   → PostgreSQL + Drizzle ORM schema
├── lib/integrations-openai-ai-server  → OpenAI server client (Replit AI proxy)
└── lib/integrations-openai-ai-react   → OpenAI react hooks
```

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **TypeScript**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (v4), drizzle-zod
- **Auth**: JWT (jose), SESSION_SECRET env var
- **AI**: OpenAI gpt-4o-mini via Replit AI Integrations proxy (AI_INTEGRATIONS_OPENAI_BASE_URL + AI_INTEGRATIONS_OPENAI_API_KEY)
- **Mobile**: Expo SDK 53, React Native, expo-router v6
- **Notifications**: expo-notifications (local), browser Notification API (web)

## Mobile App — Tabs (6)

1. **Dashboard** — Score ring, stats grid, DailyInsightCard (AI coach, 4h cache), SmartAlertBanner
2. **Money** — Expenses + Income toggle, 4-tab SMS scan modal (Auto SMS / Camera / Gallery / Paste), push notification on overspend
3. **Coach** — AI GPT chat (non-streaming), conversation history, context-aware QAR advice with comprehensive system prompt
4. **Invest** — Qatar/GCC/US Markets with live prices (30s auto-refresh, flash animation), Gold marketplace (buy/track), Portfolio P&L
5. **Reports** — 4 tabs: Analytics (6-month charts, category breakdown), Budgets, Goals, Weekly AI Report
6. **Profile** — Achievements, gamification stats, settings, language toggle (EN/AR RTL), currency picker

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login, get JWT |
| GET  | /api/auth/me | Get profile |
| PATCH | /api/auth/settings | Update settings |
| GET/POST/DELETE | /api/expenses | Expense CRUD |
| GET  | /api/expenses/summary | Monthly stats |
| GET/POST/DELETE | /api/income | Income CRUD |
| GET  | /api/reports | 6-month analytics |
| GET  | /api/report/weekly | AI-generated weekly report |
| GET/POST/PATCH/DELETE | /api/portfolio | Holdings CRUD |
| GET  | /api/portfolio/summary | P&L + allocation |
| GET  | /api/score | Financial health score (0–100) |
| GET/POST/DELETE | /api/goals | Goals CRUD |
| GET/POST/DELETE | /api/budgets | Budgets CRUD |
| GET  | /api/gamification | Stats + achievements |
| POST | /api/gamification/points | Award points |
| GET/DELETE | /api/alerts | Smart alerts |
| POST | /api/alerts/check | Generate new alerts (budget overrun, market moves) |
| POST | /api/sms/parse | Parse bank SMS — rule-based (40+ merchants) + AI fallback |
| POST | /api/sms/parse-batch | Batch SMS parsing |
| GET  | /api/ai/daily-action | Personalized daily tip (AI) |
| POST | /api/openai/quick-insight | Quick one-off AI insight (dashboard card) |
| GET/POST/DELETE | /api/openai/conversations | AI coach conversations |
| POST | /api/openai/conversations/:id/messages | Send message to AI coach |
| GET  | /api/markets | Live market data (Qatar stocks, gold, crypto, US, ETFs) |
| GET  | /api/gold/price | Live gold price (QAR/gram by karat) |
| GET  | /api/gold/stores | Qatar gold stores |
| GET/POST | /api/gold/portfolio | Gold holdings |
| GET  | /api/currency/rates | Live FX rates |
| GET  | /api/bills | Bills & subscriptions |

## DB Schema (PostgreSQL)

Tables: `users`, `expenses`, `income`, `portfolio_holdings`, `goals`, `budgets`, `gamification_stats`, `achievements`, `alerts`, `conversations`, `messages`, `bills`, `gold_holdings`, `gold_transactions`

Push schema: `pnpm --filter @workspace/db run push`

## Key Files

- `artifacts/api-server/src/routes/` — all route handlers
- `artifacts/api-server/src/routes/openai/index.ts` — AI coach with comprehensive `buildCoachPrompt()` + quick-insight endpoint
- `artifacts/api-server/src/routes/sms.ts` — Rule-based SMS parser (40+ merchant rules, Arabic support)
- `artifacts/api-server/src/lib/openai.ts` — OpenAI client (prefers Replit AI proxy, falls back to OPENAI_API_KEY)
- `artifacts/mobile/app/(tabs)/` — 6 tab screens
- `artifacts/mobile/hooks/useSmsReader.ts` — Android SMS reading hook (READ_SMS permission)
- `artifacts/mobile/hooks/useNotifications.ts` — push notification logic
- `artifacts/mobile/context/AuthContext.tsx` — JWT auth (signIn/signOut + AsyncStorage)
- `artifacts/mobile/context/LanguageContext.tsx` — EN/AR RTL with full translations
- `lib/db/src/schema/` — Drizzle table schemas

## Environment Variables

- `SESSION_SECRET` — JWT signing secret (Replit secret)
- `AI_INTEGRATIONS_OPENAI_BASE_URL` — OpenAI proxy URL (auto via Replit AI Integrations)
- `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI proxy key (auto via Replit AI Integrations)
- `OPENAI_API_KEY` — fallback direct key (currently placeholder, proxy is used)
- `GEMINI_API_KEY` — saved as secret; not currently used (project standardized on OpenAI)
- `RESEND_API_KEY` — Resend API key for sending email-OTP verification codes
- `RESEND_FROM_EMAIL` — optional sender (defaults to `Aurix AI <onboarding@resend.dev>` sandbox sender, which Resend only delivers to the account-owner's email until a domain is verified at resend.com/domains)
- `EXPO_PUBLIC_API_BASE` — API base URL for mobile (set in artifacts/mobile/.env)
- `DATABASE_URL` — set by Replit PostgreSQL integration

## Email OTP — production checklist

Resend's default sender (`onboarding@resend.dev`) is **sandbox-only**: it
delivers to the email address that owns the Resend account and rejects all other
recipients with HTTP 403. To send OTPs to real users you must:

1. Verify a sender domain in the Resend dashboard (resend.com/domains).
2. Set `RESEND_FROM_EMAIL=Aurix AI <noreply@your-verified-domain.com>` in Replit
   secrets.

Until that's done, registration still works — the API returns the OTP in the
JSON response field `devOtp` so you can sign up locally with any email.

Disposable / temp email providers (mailinator, yopmail, 10minutemail, ~50 more)
are blocked at signup with a clear error message.

## Critical Bug Fixes Applied (May 2026)

### Drizzle SQL Aggregate Type Coercion
Drizzle returns `sql<number>` tagged columns as **strings** at runtime. Every route using `.toFixed()`, arithmetic, or comparisons on these values was fixed with `Number(...)`:
- `openai/index.ts` — `weeklySpent`, `incomeThisMonth`, `totalSpent` (category reduce)
- `score.ts` — `monthlySpent`, `topCatAmt`
- `alerts.ts` — `spentMap[s.category]` (budget ratio comparisons)
- `ai.ts` — `expResult.reduce`, `.sort` comparisons
- `goals.ts` — `spentMap[s.category]`, budget `spentAmount`
- `expenses.ts` — `monthlyTotal` (high-spending alert trigger)

### OpenAI Client (AI Coach)
The `OPENAI_API_KEY` secret was a placeholder (`sk-xxxxx`). Fixed `lib/openai.ts` to prefer `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` (Replit AI proxy) over the direct key.

### Alerts Insert Schema
`alerts` table `title` column is NOT NULL. Fixed `alerts/check` to pass `title` separately instead of concatenating it into `message`.

## SMS Rule Engine

Pre-processes SMS with 40+ merchant→category rules before AI:
- Talabat → Food & Dining
- Uber/Careem → Transport
- Carrefour/LuLu/Spinneys → Food & Dining
- Amazon/H&M/Zara → Shopping
- VOX/Netflix/Spotify → Entertainment
- Naufar/Hamad → Health
- DEWA/Kahramaa/Ooredoo → Bills & Utilities

Arabic bank SMS fully supported (amount extraction in both EN/AR scripts).

## Bilingual Support (EN/AR)

Full translation coverage in `artifacts/mobile/context/LanguageContext.tsx`:
- 80+ string keys covering all app screens
- RTL layout via `I18nManager.forceRTL()`
- Language preference persisted in AsyncStorage
- Toggle in Profile tab → synced to user's DB record via PATCH /api/auth/settings

## Notifications

Triggers when monthly spending exceeds 75% or 90% of monthly income.
- Native: `expo-notifications` scheduled local notification
- Web: Browser `Notification` API

## Android Build

- Package: `com.moneymind.app`
- EAS build profiles: development, preview, production
- `react-native-get-sms-android` for SMS auto-read (works in EAS Build APK, not Expo Go)
- `eas.json` configured in `artifacts/mobile/`
