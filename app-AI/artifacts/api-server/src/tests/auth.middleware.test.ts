import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import { requireAuth, signToken } from "../middlewares/auth";
import type { Request, Response, NextFunction } from "express";

const SECRET = process.env["SESSION_SECRET"]!;

function mockReq(authHeader?: string): Request {
  return { headers: { authorization: authHeader } } as unknown as Request;
}

function mockRes(): { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("signToken", () => {
  it("returns a JWT signed with the session secret", () => {
    const token = signToken({ userId: 1, email: "a@b.com" });
    const payload = jwt.verify(token, SECRET) as any;
    expect(payload.userId).toBe(1);
    expect(payload.email).toBe("a@b.com");
  });

  it("expires in 30 days (mobile-friendly TTL)", () => {
    const token = signToken({ userId: 1, email: "a@b.com" });
    const payload = jwt.decode(token) as any;
    const expiresIn = payload.exp - payload.iat;
    expect(expiresIn).toBe(30 * 24 * 60 * 60);
  });
});

describe("requireAuth middleware", () => {
  it("calls next() with valid Bearer token", () => {
    const token = signToken({ userId: 42, email: "user@test.com" });
    const req = mockReq(`Bearer ${token}`);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(req, res as unknown as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).user.userId).toBe(42);
  });

  it("returns 401 when no Authorization header", () => {
    const req = mockReq();
    const res = mockRes();
    requireAuth(req, res as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("returns 401 when token is malformed", () => {
    const req = mockReq("Bearer not.a.valid.jwt");
    const res = mockRes();
    requireAuth(req, res as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid token" });
  });

  it("returns 401 when token is signed with wrong secret", () => {
    const badToken = jwt.sign({ userId: 1, email: "x@x.com" }, "wrong-secret", { expiresIn: "15m" });
    const req = mockReq(`Bearer ${badToken}`);
    const res = mockRes();
    requireAuth(req, res as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 401 when token is expired", () => {
    const expiredToken = jwt.sign({ userId: 1, email: "x@x.com" }, SECRET, { expiresIn: -1 });
    const req = mockReq(`Bearer ${expiredToken}`);
    const res = mockRes();
    requireAuth(req, res as unknown as Response, vi.fn() as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
