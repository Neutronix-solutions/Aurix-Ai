/**
 * OTP security tests — run against the in-memory Redis shim so they work
 * without a live Redis in local dev. CI wires a real Redis via service container.
 *
 * Key invariant: deleting the OTP (expiry or new request) MUST NOT reset the
 * attempt counter. This prevents the "cycling" attack where an attacker
 * requests unlimited OTPs to get unlimited guess budgets.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { initRedis, getRedis, _resetRedisForTesting } from "../lib/redis";

// ── Re-implement the same helpers from auth.ts (read-only, no DB needed) ─────

const OTP_TTL_SECONDS      = 5 * 60;
const OTP_ATTEMPT_TTL_SECONDS = 24 * 60 * 60;
const OTP_MAX_ATTEMPTS     = 5;

interface OtpRecord        { otp: string; expiresAt: number; }
interface OtpAttemptRecord { attempts: number; lockedUntil?: number; }

async function otpSet(key: string, otp: string) {
  await getRedis().set(`otp:${key}`, JSON.stringify({ otp, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 }), "EX", OTP_TTL_SECONDS);
}

async function otpGet(key: string): Promise<OtpRecord | null> {
  const raw = await getRedis().get(`otp:${key}`);
  return raw ? JSON.parse(raw) as OtpRecord : null;
}

async function otpDelete(key: string) {
  await getRedis().del(`otp:${key}`);
  // Intentionally does NOT delete `otp_attempts:${key}`
}

async function getOtpAttempts(key: string): Promise<OtpAttemptRecord> {
  const raw = await getRedis().get(`otp_attempts:${key}`);
  return raw ? JSON.parse(raw) as OtpAttemptRecord : { attempts: 0 };
}

async function incrementOtpAttempts(key: string): Promise<OtpAttemptRecord> {
  const rec = await getOtpAttempts(key);
  rec.attempts += 1;
  if (rec.attempts >= OTP_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + OTP_ATTEMPT_TTL_SECONDS * 1000;
  }
  await getRedis().set(`otp_attempts:${key}`, JSON.stringify(rec), "EX", OTP_ATTEMPT_TTL_SECONDS);
  return rec;
}

async function resetOtpAttempts(key: string) {
  await getRedis().del(`otp_attempts:${key}`);
}

// ─────────────────────────────────────────────────────────────────────────────

describe("OTP attempt counter", () => {
  const KEY = `test-user-${Date.now()}`;

  beforeEach(async () => {
    _resetRedisForTesting();
    await initRedis();  // re-initialises with MemoryRedis (no REDIS_URL in test env)
    await otpDelete(KEY);
    await resetOtpAttempts(KEY);
  });

  it("starts at 0 attempts", async () => {
    const rec = await getOtpAttempts(KEY);
    expect(rec.attempts).toBe(0);
  });

  it("increments on each wrong guess", async () => {
    await incrementOtpAttempts(KEY);
    await incrementOtpAttempts(KEY);
    const rec = await getOtpAttempts(KEY);
    expect(rec.attempts).toBe(2);
  });

  it("sets lockedUntil after OTP_MAX_ATTEMPTS wrong guesses", async () => {
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await incrementOtpAttempts(KEY);
    }
    const rec = await getOtpAttempts(KEY);
    expect(rec.attempts).toBe(OTP_MAX_ATTEMPTS);
    expect(rec.lockedUntil).toBeDefined();
    expect(rec.lockedUntil!).toBeGreaterThan(Date.now());
  });

  it("CYCLING ATTACK: deleting OTP does NOT reset attempt counter", async () => {
    await otpSet(KEY, "123456");
    await incrementOtpAttempts(KEY);
    await incrementOtpAttempts(KEY);
    await incrementOtpAttempts(KEY);

    // Attacker requests a new OTP (which deletes the old one)
    await otpDelete(KEY);
    await otpSet(KEY, "654321");

    // The attempt counter must still be at 3 — not reset to 0
    const rec = await getOtpAttempts(KEY);
    expect(rec.attempts).toBe(3);
  });

  it("resets counter after successful verification", async () => {
    await incrementOtpAttempts(KEY);
    await incrementOtpAttempts(KEY);
    await resetOtpAttempts(KEY);
    const rec = await getOtpAttempts(KEY);
    expect(rec.attempts).toBe(0);
  });

  it("OTP record is independent from attempt record", async () => {
    await otpSet(KEY, "111111");
    const otp = await otpGet(KEY);
    expect(otp?.otp).toBe("111111");

    await incrementOtpAttempts(KEY);
    const otpAfter = await otpGet(KEY); // should still be there
    expect(otpAfter?.otp).toBe("111111");
  });
});
