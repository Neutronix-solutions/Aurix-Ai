import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env["SESSION_SECRET"] ?? "moneymind-secret";

// Fail fast in production when the default insecure secret is still in use.
if (process.env["NODE_ENV"] === "production" && JWT_SECRET === "moneymind-secret") {
  throw new Error(
    "FATAL: SESSION_SECRET environment variable is not set. " +
    "Set it to a long random string (e.g. openssl rand -hex 32) before starting in production."
  );
}

export interface AuthPayload {
  userId: number;
  email: string;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    (req as Request & { user: AuthPayload }).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// Mobile-friendly TTL: 30 days. The mobile app cannot reliably perform
// background refresh-token rotations every 15 minutes (apps are backgrounded,
// network is intermittent, refresh tokens are single-use and easily lost on
// race conditions). A 30-day access token matches industry-standard mobile
// session lengths (Spotify, Twitter, etc.) and prevents users from being
// silently logged out between sessions. The refresh endpoint remains
// available as a defense-in-depth mechanism for password changes.
export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}
