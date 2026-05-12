import { logger } from "./logger";

interface EnvSpec {
  name: string;
  required: boolean;
  description: string;
}

// isProd is evaluated lazily inside validateEnv() so it reflects the actual
// NODE_ENV at the time the function runs rather than module load time.
const SPECS: EnvSpec[] = [
  { name: "PORT",           required: true,  description: "HTTP server port" },
  { name: "DATABASE_URL",   required: true,  description: "PostgreSQL connection string (postgresql://user:pass@host:5432/db)" },
  { name: "SESSION_SECRET", required: true,  description: "JWT signing secret — generate with: openssl rand -hex 32" },
  // AI provider — Gemini is the SOLE provider. Required in production.
  { name: "GEMINI_API_KEY",     required: true,  description: "Google Gemini API key — the sole AI provider for chat, receipt scanning and SMS parsing (free at aistudio.google.com)" },
  // REDIS_URL is required in production — without it, OTPs/refresh tokens are in-memory and lost on restart.
  { name: "REDIS_URL",          required: false, description: "Redis connection string — refresh tokens, OTPs and rate-limit state require Redis in production" },
  { name: "TWILIO_ACCOUNT_SID", required: false, description: "Twilio SID — SMS OTP delivery will fail without Twilio credentials" },
  { name: "RESEND_API_KEY",      required: false, description: "Resend API key — email OTP delivery (free 3k/month at resend.com); falls back to SMTP if not set" },
  { name: "RESEND_FROM",        required: false, description: "Resend sender address — defaults to 'Aurix AI <noreply@neutronixs.com>' (neutronixs.com is verified); override only if sending from a different domain" },
  { name: "SMTP_HOST",          required: false, description: "SMTP host — email OTP delivery fallback when RESEND_API_KEY is not set" },
];

const INSECURE_SESSION_SECRET = "moneymind-secret";

export function validateEnv(): void {
  const isProd = process.env["NODE_ENV"] === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const spec of SPECS) {
    const val = (process.env[spec.name] ?? "").trim();
    const missing = val === "";

    if (spec.name === "SESSION_SECRET" && val === INSECURE_SESSION_SECRET) {
      const msg = "SESSION_SECRET is still the default insecure value — run: openssl rand -hex 32";
      if (isProd) errors.push(msg); else warnings.push(msg);
      continue;
    }

    // REDIS_URL — required in production. Without it, refresh tokens and OTPs are in-memory:
    // lost on restart, not shared across instances, and unrevokable (security risk).
    if (spec.name === "REDIS_URL" && missing && isProd) {
      errors.push(
        "REDIS_URL is required in production — refresh tokens, OTPs and rate-limit state require Redis. " +
        "Use Upstash free tier (upstash.com) or any Redis 6+ instance."
      );
      continue;
    }

    if (missing) {
      if (spec.required) {
        errors.push(`${spec.name} — ${spec.description}`);
      } else {
        warnings.push(`${spec.name} not set — ${spec.description}`);
      }
    }
  }

  // GEMINI is the only AI provider — its absence is now caught above as a
  // hard required-var error in production. No multi-provider group check.

  for (const w of warnings) {
    logger.warn(`[env] ⚠  ${w}`);
  }

  if (errors.length > 0) {
    for (const e of errors) {
      logger.error(`[env] ✗  ${e}`);
    }
    throw new Error(
      `[env] Server startup aborted — ${errors.length} required env var(s) missing or insecure:\n` +
      errors.map(e => `  • ${e}`).join("\n") + "\n" +
      `Copy artifacts/api-server/.env.example to .env and fill in the values.`
    );
  }

  const optionalMissing = warnings.filter(w => !w.includes("SESSION_SECRET")).length;
  if (optionalMissing > 0) {
    logger.warn(`[env] ${optionalMissing} optional env var(s) not set — some features will be degraded (see warnings above)`);
  }

  logger.info("[env] ✓ Environment validated");
}
