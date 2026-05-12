import { vi } from "vitest";

// Set test env vars before any module loads them
process.env["NODE_ENV"] = "test";
process.env["SESSION_SECRET"] = "test-secret-not-for-production-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/test";
// REDIS_URL intentionally left unset — OTP/auth tests use the in-memory Redis shim.
// In CI, set REDIS_URL via the service container env to test against real Redis.
process.env["PORT"] = "0";

// ── Mock @workspace/db ───────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
  },
  users: {},
  gamificationStats: {},
  eq: vi.fn((a, b) => ({ a, b })),
}));

// ── Mock pino logger to silence test output ──────────────────────────────────
vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

// ── Mock Sentry (no-op in tests) ─────────────────────────────────────────────
vi.mock("../lib/sentry", () => ({
  initSentry: vi.fn(),
  captureException: vi.fn(),
}));
