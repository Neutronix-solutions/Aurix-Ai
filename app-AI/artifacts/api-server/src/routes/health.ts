import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getRedis, isRedisConnected } from "../lib/redis";

const router: IRouter = Router();

// ── In-memory latency tracker ────────────────────────────────────────────
// Keeps a rolling window of the last N request durations (ms) for p50/p95/p99.
// Reset on process restart — purely operational, not persisted.

const LATENCY_WINDOW = 1000;
const latencyBuffer: number[] = [];

export function recordLatency(ms: number): void {
  latencyBuffer.push(ms);
  if (latencyBuffer.length > LATENCY_WINDOW) latencyBuffer.shift();
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function getLatencyStats(): { p50: number; p95: number; p99: number; samples: number } | null {
  if (latencyBuffer.length === 0) return null;
  const sorted = [...latencyBuffer].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    samples: sorted.length,
  };
}

// ── GET /api/healthz ──────────────────────────────────────────────────────
// Lightweight liveness probe — always returns 200 so Railway keeps the container up.
// Never add auth to this endpoint; Railway's health check probes it without credentials.
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// ── GET /api/healthz/deep ─────────────────────────────────────────────────
// Deep readiness probe — checks DB and Redis connectivity plus latency stats.
// Protected by HEALTH_TOKEN when set (passed as Authorization: Bearer <token>
// or ?token=<value> query param).
// Returns 200 only when all critical dependencies are healthy; 503 when degraded.
router.get("/healthz/deep", async (req, res) => {
  // Optional bearer-token auth. When HEALTH_TOKEN is set, reject unauthenticated requests.
  const healthToken = process.env["HEALTH_TOKEN"];
  if (healthToken) {
    const provided =
      (req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "") ||
      String(req.query["token"] ?? "");
    if (provided !== healthToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }

  const checks: Record<string, { status: "ok" | "error"; latencyMs?: number; detail?: string }> = {};

  // ── Database ──────────────────────────────────────────────────────────
  const dbStart = Date.now();
  try {
    await db.execute(sql`SELECT 1`);
    checks["database"] = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (err: unknown) {
    checks["database"] = { status: "error", latencyMs: Date.now() - dbStart, detail: (err as Error)?.message ?? "unknown" };
  }

  // ── Redis ─────────────────────────────────────────────────────────────
  const redisStart = Date.now();
  try {
    const reply = await getRedis().ping();
    checks["redis"] = {
      status: reply === "PONG" ? "ok" : "error",
      latencyMs: Date.now() - redisStart,
      detail: isRedisConnected() ? undefined : "in-memory fallback (no REDIS_URL)",
    };
  } catch (err: unknown) {
    checks["redis"] = { status: "error", latencyMs: Date.now() - redisStart, detail: (err as Error)?.message ?? "unknown" };
  }

  const allOk = Object.values(checks).every(c => c.status === "ok");

  res.status(allOk ? 200 : 503).json({
    status:    allOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    latency:   getLatencyStats(),
  });
});

export default router;
