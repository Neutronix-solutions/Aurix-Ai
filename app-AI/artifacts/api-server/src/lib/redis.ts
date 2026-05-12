/**
 * Shared Redis singleton.
 *
 * Behaviour:
 *  - If REDIS_URL is set: connects via ioredis (Upstash-compatible).
 *  - If REDIS_URL is absent in production: logs a hard warning at startup.
 *  - In development without REDIS_URL: silently uses in-memory shim.
 *
 * All callers import { redis, isRedisConnected } from this module rather
 * than managing their own connection, so connection state is consistent
 * across the whole process.
 */

import { logger } from "./logger";

// Minimal interface shared by the real ioredis client and the in-memory shim.
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /**
   * Atomic GET + DEL (Redis 6.2+ `GETDEL`). Returns the previous value, or
   * null if the key did not exist. Used for single-use token consumption
   * where two concurrent callers must not both observe the value.
   */
  getdel(key: string): Promise<string | null>;
  ping(): Promise<string>;
  status: "ready" | "connecting" | "reconnecting" | "end" | "close" | "wait";
}

// ── In-memory shim (dev fallback) ─────────────────────────────────────────
class MemoryRedis implements RedisClient {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  public status: RedisClient["status"] = "ready";

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.value;
  }

  async set(key: string, value: string, _mode: "EX", ttlSeconds: number): Promise<"OK"> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return "OK";
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  // JS is single-threaded, so reading + deleting in the same microtask is
  // already atomic with respect to other JS code. This matches the ioredis
  // GETDEL semantics for tests and dev usage.
  async getdel(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    this.store.delete(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) return null;
    return entry.value;
  }

  async ping(): Promise<string> { return "PONG"; }
}

// ── Module-level singleton ─────────────────────────────────────────────────
let _client: RedisClient | null = null;
let _connected = false;

export function isRedisConnected(): boolean {
  return _connected && _client !== null && _client.status === "ready";
}

export async function initRedis(): Promise<RedisClient> {
  if (_client) return _client;

  const redisUrl = process.env["REDIS_URL"];
  const isProd   = process.env["NODE_ENV"] === "production";

  if (!redisUrl) {
    if (isProd) {
      logger.warn(
        "[redis] ⚠  REDIS_URL is not set in production. " +
        "OTPs and rate-limit state will be stored in-memory and lost on restart. " +
        "This breaks multi-instance deployments and causes OTP loss on redeploy. " +
        "Set REDIS_URL (e.g. Upstash Free tier) before going live."
      );
    } else {
      logger.info("[redis] REDIS_URL not set — using in-memory store (dev mode)");
    }
    _client = new MemoryRedis();
    _connected = true;
    return _client;
  }

  try {
    const { default: Redis } = await import("ioredis") as {
      default: new (url: string, opts?: Record<string, unknown>) => RedisClient & {
        on(event: string, cb: (...args: unknown[]) => void): void;
      };
    };

    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
      // Upstash uses TLS — ioredis handles rediss:// automatically
    });

    client.on("ready",        () => { _connected = true;  logger.info("[redis] ✓ Connected"); });
    client.on("error",        (e: unknown) => logger.error({ err: e }, "[redis] Connection error"));
    client.on("reconnecting", () => logger.warn("[redis] Reconnecting..."));
    client.on("close",        () => { _connected = false; logger.warn("[redis] Connection closed"); });
    client.on("end",          () => { _connected = false; logger.warn("[redis] Connection ended"); });

    _client = client;
    logger.info({ url: redisUrl.replace(/:[^:@]*@/, ":***@") }, "[redis] Initialising connection to Redis");
  } catch (err) {
    logger.error({ err }, "[redis] ioredis failed to load — falling back to in-memory store");
    _client = new MemoryRedis();
    _connected = true;
  }

  return _client;
}

/** Returns the singleton client, throwing if initRedis() was never called. */
export function getRedis(): RedisClient {
  if (!_client) throw new Error("Redis not initialised — call initRedis() at startup before using getRedis()");
  return _client;
}

/** Resets the singleton — for tests only. Never call in production code. */
export function _resetRedisForTesting(): void {
  _client = null;
  _connected = false;
}
