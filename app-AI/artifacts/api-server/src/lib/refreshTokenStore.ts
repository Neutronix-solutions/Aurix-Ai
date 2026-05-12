/**
 * Refresh-token storage backed by the shared Redis singleton.
 *
 * Lifecycle:
 *  - generateRefreshToken() returns a fresh 256-bit random token (URL-safe).
 *  - refreshTokenSet(token, userId) persists it with a 30-day TTL.
 *  - refreshTokenGet(token) returns the {userId, issuedAt} record or null.
 *  - refreshTokenDelete(token) revokes a single token (used on rotation/logout).
 *  - revokeAllUserSessions(userId) marks every refresh token issued before
 *    "now" as invalid for that user. Used after password change so old
 *    sessions cannot continue to refresh.
 *
 * The check is timestamp-based rather than per-token enumeration so the
 * MemoryRedis shim (no SCAN/SET ops) keeps working in dev and tests.
 */

import { randomBytes } from "node:crypto";
import { getRedis } from "./redis";

export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface RefreshRecord {
  userId: number;
  issuedAt: number; // epoch ms
}

const refreshKey       = (token: string)  => `refresh:${token}`;
const userInvalidKey   = (userId: number) => `refresh_invalidated_before:${userId}`;

// ── Token generation ──────────────────────────────────────────────────────
export function generateRefreshToken(): string {
  // 32 random bytes → ~43 char base64url string. Cryptographically secure.
  return randomBytes(32).toString("base64url");
}

// ── CRUD ──────────────────────────────────────────────────────────────────
export async function refreshTokenSet(token: string, userId: number): Promise<void> {
  const rec: RefreshRecord = { userId, issuedAt: Date.now() };
  await getRedis().set(refreshKey(token), JSON.stringify(rec), "EX", REFRESH_TTL_SECONDS);
}

export async function refreshTokenGet(token: string): Promise<RefreshRecord | null> {
  const raw = await getRedis().get(refreshKey(token));
  return parseAndCheckRevocation(raw, token);
}

/**
 * Atomic single-use consume: GETDEL the token from Redis so that two
 * concurrent callers cannot both pass validation on the same token. The
 * caller is then expected to issue a fresh token. Returns the record on
 * the winning caller and null on every other caller (or for an unknown /
 * expired / revoked token).
 */
export async function refreshTokenConsume(token: string): Promise<RefreshRecord | null> {
  const raw = await getRedis().getdel(refreshKey(token));
  return parseAndCheckRevocation(raw, token);
}

async function parseAndCheckRevocation(raw: string | null, token: string): Promise<RefreshRecord | null> {
  if (!raw) return null;
  try {
    const rec = JSON.parse(raw) as RefreshRecord;
    // Honor user-wide revocation watermark (e.g. after password change).
    // `<=` (not `<`) so a token issued in the same millisecond as the
    // revocation event is also rejected — important on fast machines.
    const cutoffRaw = await getRedis().get(userInvalidKey(rec.userId));
    if (cutoffRaw) {
      const cutoff = Number(cutoffRaw);
      if (Number.isFinite(cutoff) && rec.issuedAt <= cutoff) {
        await getRedis().del(refreshKey(token));
        return null;
      }
    }
    return rec;
  } catch {
    return null;
  }
}

export async function refreshTokenDelete(token: string): Promise<void> {
  await getRedis().del(refreshKey(token));
}

/**
 * Mark every refresh token issued for `userId` before "now" as invalid.
 * Existing access tokens (15-min JWTs) are NOT revoked; they simply expire.
 * Call after password change, email change, or any account-takeover-mitigation
 * event.
 */
export async function revokeAllUserSessions(userId: number): Promise<void> {
  await getRedis().set(userInvalidKey(userId), String(Date.now()), "EX", REFRESH_TTL_SECONDS);
}
