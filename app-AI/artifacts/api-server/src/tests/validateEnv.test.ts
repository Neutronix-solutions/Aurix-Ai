import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Dynamically import to test with different env states
async function load() {
  vi.resetModules();
  const { validateEnv } = await import("../lib/validateEnv");
  return validateEnv;
}

const BASE_ENV = {
  NODE_ENV: "test",
  PORT: "3000",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  SESSION_SECRET: "a-good-long-random-secret-that-is-not-the-default",
  OPENAI_API_KEY: "sk-test",
  REDIS_URL: "redis://localhost:6379",
};

describe("validateEnv", () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k]);
    Object.assign(process.env, BASE_ENV);
  });

  afterEach(() => {
    Object.keys(process.env).forEach(k => delete process.env[k]);
    Object.assign(process.env, original);
  });

  it("passes when all required vars are set", async () => {
    const validateEnv = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", async () => {
    delete process.env["DATABASE_URL"];
    const validateEnv = await load();
    expect(() => validateEnv()).toThrow(/DATABASE_URL/);
  });

  it("throws when SESSION_SECRET is the insecure default in production", async () => {
    process.env["NODE_ENV"] = "production";
    process.env["SESSION_SECRET"] = "moneymind-secret";
    const validateEnv = await load();
    expect(() => validateEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when OPENAI_API_KEY is missing in production", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["OPENAI_API_KEY"];
    const validateEnv = await load();
    expect(() => validateEnv()).toThrow(/OPENAI_API_KEY/);
  });

  it("throws when REDIS_URL is missing in production", async () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["REDIS_URL"];
    const validateEnv = await load();
    expect(() => validateEnv()).toThrow(/REDIS_URL/);
  });

  it("does not throw when REDIS_URL is missing in non-production", async () => {
    process.env["NODE_ENV"] = "development";
    delete process.env["REDIS_URL"];
    const validateEnv = await load();
    expect(() => validateEnv()).not.toThrow();
  });
});
