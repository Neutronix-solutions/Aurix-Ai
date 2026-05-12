/**
 * Canonical OTP storage backed by the shared Redis singleton.
 *
 * One source of truth for the OTP code, attempt counter, and per-email
 * resend cooldown — so that the same OTP state is visible across every
 * server instance under horizontal scaling.
 *
 * Critical invariant: deleting an OTP (`otpDelete`) MUST NOT reset the
 * attempt counter. This prevents the "request a fresh OTP to refresh
 * your guess budget" brute-force attack. See
 * `src/tests/otp.security.test.ts` for the contract.
 */

import { getRedis } from "./redis";

export const OTP_TTL_SECONDS          = 5 * 60;        // 5-minute code validity
export const OTP_ATTEMPT_TTL_SECONDS  = 24 * 60 * 60;  // 24-hour lockout window
export const OTP_MAX_ATTEMPTS         = 5;             // wrong guesses before lock
export const OTP_RESEND_COOLDOWN_MS   = 60 * 1000;     // 60s between sends
export const OTP_RESEND_HOURLY_MAX    = 5;             // sends per email per hour

export interface OtpRecord        { otp: string; expiresAt: number }
export interface OtpAttemptRecord { attempts: number; lockedUntil?: number }
interface ResendRecord            { count: number; windowStart: number; lastSentAt: number }

const RESEND_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling window

const otpKey      = (email: string) => `otp:${email}`;
const attemptsKey = (email: string) => `otp_attempts:${email}`;
const resendKey   = (email: string) => `otp_resend:${email}`;

// ── OTP code ──────────────────────────────────────────────────────────────
export async function otpSet(email: string, rec: OtpRecord): Promise<void> {
  await getRedis().set(otpKey(email), JSON.stringify(rec), "EX", OTP_TTL_SECONDS);
}

export async function otpGet(email: string): Promise<OtpRecord | null> {
  const raw = await getRedis().get(otpKey(email));
  return raw ? (JSON.parse(raw) as OtpRecord) : null;
}

export async function otpDelete(email: string): Promise<void> {
  await getRedis().del(otpKey(email));
  // Intentionally does NOT touch attempt counter — see file header.
}

// ── Attempt counter (per-email) ───────────────────────────────────────────
export async function getOtpAttempts(email: string): Promise<OtpAttemptRecord> {
  const raw = await getRedis().get(attemptsKey(email));
  return raw ? (JSON.parse(raw) as OtpAttemptRecord) : { attempts: 0 };
}

export async function incrementOtpAttempts(email: string): Promise<OtpAttemptRecord> {
  const rec = await getOtpAttempts(email);
  rec.attempts += 1;
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + OTP_ATTEMPT_TTL_SECONDS * 1000;
  }
  await getRedis().set(attemptsKey(email), JSON.stringify(rec), "EX", OTP_ATTEMPT_TTL_SECONDS);
  return rec;
}

export async function resetOtpAttempts(email: string): Promise<void> {
  await getRedis().del(attemptsKey(email));
}

// ── Resend rate limit (per-email, 60s + hourly cap) ───────────────────────
/**
 * Returns a user-facing error string when the email has hit the cooldown or
 * hourly cap, or `null` when a new send is allowed. On allow, the resend
 * counter is incremented.
 */
export async function checkAndUpdateRateLimit(email: string): Promise<string | null> {
  const raw = await getRedis().get(resendKey(email));
  const now = Date.now();
  const rec: ResendRecord = raw
    ? (JSON.parse(raw) as ResendRecord)
    : { count: 0, windowStart: now, lastSentAt: 0 };

  // Roll the hourly window over once an hour passes
  if (now - rec.windowStart > RESEND_WINDOW_MS) {
    rec.count       = 0;
    rec.windowStart = now;
  }

  // 60s cooldown between consecutive sends (prevents burst-spam)
  if (rec.lastSentAt && now - rec.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - rec.lastSentAt)) / 1000);
    return `Please wait ${waitSec}s before requesting another code.`;
  }

  if (rec.count >= OTP_RESEND_HOURLY_MAX) {
    const waitMin = Math.ceil((RESEND_WINDOW_MS - (now - rec.windowStart)) / 60000);
    return `Too many code requests. Please wait ${waitMin} minute(s) before trying again.`;
  }

  rec.count     += 1;
  rec.lastSentAt = now;
  // TTL = remaining window time so the record clears itself
  const ttlSec = Math.max(60, Math.ceil((RESEND_WINDOW_MS - (now - rec.windowStart)) / 1000));
  await getRedis().set(resendKey(email), JSON.stringify(rec), "EX", ttlSec);
  return null;
}
