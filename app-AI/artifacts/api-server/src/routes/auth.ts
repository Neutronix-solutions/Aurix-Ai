import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { db } from "@workspace/db";
import { users, gamificationStats } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { requireAuth, signToken, AuthPayload } from "../middlewares/auth";
import { getRedis } from "../lib/redis";
import {
  generateRefreshToken,
  refreshTokenSet,
  refreshTokenConsume,
  refreshTokenDelete,
  revokeAllUserSessions,
} from "../lib/refreshTokenStore";
import {
  otpSet, otpGet, otpDelete,
  getOtpAttempts, incrementOtpAttempts, resetOtpAttempts,
  checkAndUpdateRateLimit,
  OTP_TTL_SECONDS, OTP_MAX_ATTEMPTS,
} from "../lib/otpStore";
import { Request } from "express";

// ── Auth-route rate limiters ───────────────────────────────────────────────

const loginRateLimit = rateLimit({
  windowMs:               15 * 60 * 1000,
  max:                    10,
  standardHeaders:        true,
  legacyHeaders:          false,
  message:                { error: "Too many login attempts. Please wait 15 minutes and try again." },
  skipSuccessfulRequests: true,
});

const registerRateLimit = rateLimit({
  windowMs:      15 * 60 * 1000,
  max:           5,
  standardHeaders: true,
  legacyHeaders: false,
  message:       { error: "Too many registration attempts. Please wait 15 minutes and try again." },
});

const router = Router();

// ── Constants ──────────────────────────────────────────────────────────────
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;       // 60s between sends
const OTP_TTL_MS             = 5 * 60 * 1000;   // 5 minute validity
const OTP_MAX_VERIFY_ATTEMPTS = 5;
const PENDING_REG_TTL_MS     = 30 * 60 * 1000;  // pending registration kept 30 min
const AVATAR_MAX_BYTES       = 2 * 1024 * 1024; // 2 MB raw

// ── In-memory stores ──────────────────────────────────────────────────────
type OtpRecord = { otp: string; expiresAt: number; attempts: number; lastSentAt: number };
const phoneOtpStore = new Map<string, OtpRecord>();           // key: phone
const emailOtpStore = new Map<string, OtpRecord>();           // key: email (for email change)

type PendingRegistration = {
  email: string;
  passwordHash: string;
  name: string;
  otp: string;
  expiresAt: number;
  attempts: number;
  lastSentAt: number;
};
const pendingRegistrations = new Map<string, PendingRegistration>(); // key: email

// ── Helpers ────────────────────────────────────────────────────────────────
function generateOtp(): string {
  // Cryptographically secure 6-digit code (100000–999999)
  return String(randomInt(100000, 1000000));
}

const ALLOWED_AVATAR_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Common disposable / temporary email providers — prevents throwaway signups.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org",
  "guerrillamail.biz", "sharklasers.com", "10minutemail.com", "10minutemail.net",
  "tempmail.com", "tempmail.net", "temp-mail.org", "temp-mail.io", "tmpmail.org",
  "tmpmail.net", "yopmail.com", "yopmail.net", "yopmail.fr", "throwawaymail.com",
  "trashmail.com", "trashmail.net", "trashmail.de", "maildrop.cc", "getairmail.com",
  "fakeinbox.com", "dispostable.com", "mintemail.com", "mohmal.com", "moakt.com",
  "tempinbox.com", "spam4.me", "mailnesia.com", "inboxbear.com", "mt2015.com",
  "discard.email", "emailondeck.com", "luxusmail.org", "mailcatch.com", "minuteinbox.com",
  "mvrht.com", "nada.email", "mytrashmail.com", "tempr.email", "wegwerfemail.de",
  "armyspy.com", "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu", "gustr.com",
  "jourrapide.com", "rhyta.com", "superrito.com", "teleworm.us",
]);

function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  return DISPOSABLE_EMAIL_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.startsWith("974") ? `+${digits}` : digits.startsWith("+") ? phone.replace(/\s/g, "") : `+974${digits}`;
}

function isDev(): boolean {
  return process.env["NODE_ENV"] !== "production";
}

async function sendOtpViaTwilio(phone: string, otp: string): Promise<boolean> {
  const sid   = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from  = process.env["TWILIO_PHONE_NUMBER"];
  if (!sid || !token || !from) return false;
  try {
    const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
    const body = new URLSearchParams({ To: phone, From: from, Body: `Aurix AI verification code: ${otp}. Valid for 5 minutes.` });
    const res  = await fetch(url, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    return res.ok;
  } catch (err) {
    console.error("[twilio] Exception:", err);
    return false;
  }
}

const OTP_EMAIL_HTML = (otp: string) => `
  <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f9fafb;border-radius:16px;">
    <h2 style="color:#16A34A;margin-bottom:8px;">Aurix AI</h2>
    <p style="color:#374151;font-size:15px;">Your verification code is:</p>
    <div style="background:#fff;border:2px solid #16A34A;border-radius:12px;padding:20px;text-align:center;margin:16px 0;">
      <span style="font-size:36px;font-weight:900;letter-spacing:12px;color:#111827;">${otp}</span>
    </div>
    <p style="color:#6B7280;font-size:13px;">This code expires in <strong>5 minutes</strong>. Do not share it with anyone.</p>
    <p style="color:#9CA3AF;font-size:12px;margin-top:24px;">If you did not request this code, please ignore this email.</p>
  </div>
`;

async function sendOtpViaEmail(
  toEmail: string,
  otp: string,
  purpose: "register" | "change-email" = "register",
  log: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void } = console,
): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from   = process.env["RESEND_FROM_EMAIL"] ?? "Aurix AI <onboarding@resend.dev>";
  if (!apiKey) return false;

  const subject = purpose === "register" ? "Verify your Aurix AI account" : "Confirm your new email — Aurix AI";
  const intro   = purpose === "register"
    ? "Welcome to Aurix AI! Use the code below to finish creating your account."
    : "Use the code below to confirm your new email address on Aurix AI.";

  const html = `
    <div style="font-family:Inter,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0F172A">
      <h1 style="color:#16A34A;margin:0 0 8px;font-size:24px;font-weight:800">Aurix AI</h1>
      <p style="margin:0 0 24px;color:#475569">${intro}</p>
      <div style="background:#F0FDF4;border:1px solid #16A34A;border-radius:14px;padding:24px;text-align:center">
        <div style="font-size:36px;font-weight:800;letter-spacing:8px;color:#15803D">${otp}</div>
        <div style="font-size:12px;color:#475569;margin-top:8px">Valid for 5 minutes</div>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#94A3B8">If you didn't request this, you can safely ignore this email.</p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [toEmail], subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.warn({ status: res.status, body, to: toEmail, from }, "Resend API rejected email");
      return false;
    }
    return true;
  } catch (err) {
    log.error({ err }, "Resend API call threw");
    return false;
  }
}

function userToPublic(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    monthlyIncome: u.monthlyIncome,
    language: u.language,
    phoneNumber: u.phoneNumber,
    isPhoneVerified: u.isPhoneVerified,
    isEmailVerified: u.isEmailVerified,
    pendingEmail: u.pendingEmail,
    avatarUrl: u.avatarUrl,
    currency: u.currency,
    createdAt: u.createdAt,
  };
}

// Periodic cleanup of expired pending registrations / OTPs
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingRegistrations) if (now > v.expiresAt + PENDING_REG_TTL_MS) pendingRegistrations.delete(k);
  for (const [k, v] of phoneOtpStore)        if (now > v.expiresAt + OTP_TTL_MS)         phoneOtpStore.delete(k);
  for (const [k, v] of emailOtpStore)        if (now > v.expiresAt + OTP_TTL_MS)         emailOtpStore.delete(k);
}, 5 * 60 * 1000).unref();

// ════════════════════════════════════════════════════════════════════════════
// REGISTRATION (email-OTP, two-step)
// ════════════════════════════════════════════════════════════════════════════

// ── POST /auth/register/start ─────────────────────────────────────────────
// Validates inputs, hashes password, generates OTP, sends via email.
// No DB row is created until the OTP is verified.
router.post("/auth/register/start", registerRateLimit, async (req, res) => {
  try {
    const { email: rawEmail, password, name } = req.body as { email: string; password: string; name: string };

    if (!rawEmail || !password || !name) {
      res.status(400).json({ error: "Email, password, and name are required" });
      return;
    }
    if (!isValidEmail(rawEmail)) { res.status(400).json({ error: "Please enter a valid email address" }); return; }
    if (password.length < 6)     { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }
    if (name.trim().length < 2)  { res.status(400).json({ error: "Please enter your name" }); return; }

    const email = normalizeEmail(rawEmail);

    if (isDisposableEmail(email)) {
      res.status(400).json({ error: "Temporary or disposable email addresses are not allowed. Please use a permanent email." });
      return;
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) { res.status(400).json({ error: "Email already registered. Please log in instead." }); return; }

    // Cooldown if there's an active pending registration for this email
    const prior = pendingRegistrations.get(email);
    if (prior && Date.now() - prior.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - prior.lastSentAt)) / 1000);
      res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otp = generateOtp();
    pendingRegistrations.set(email, {
      email, passwordHash, name: name.trim(),
      otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, lastSentAt: Date.now(),
    });

    const sent = await sendOtpViaEmail(email, otp, "register", req.log);
    const resendConfigured = Boolean(process.env["RESEND_API_KEY"]);

    if (!sent && !isDev()) {
      req.log.error({ email }, "Email OTP delivery failed in production");
      res.status(503).json({ error: "Email delivery is temporarily unavailable. Please try again later." });
      return;
    }

    const payload: Record<string, unknown> = {
      success: true,
      email,
      message: sent
        ? "Verification code sent to your email"
        : resendConfigured
          ? "Email could not be delivered (sender domain not verified in Resend). Use the dev code below to test."
          : "Verification code ready (dev mode — RESEND_API_KEY not set)",
    };
    if (!sent && isDev()) payload["devOtp"] = otp;
    res.status(200).json(payload);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Could not start registration. Please try again." });
  }
});

// ── POST /auth/register/verify ────────────────────────────────────────────
// Verifies OTP, creates the user row, returns JWT.
router.post("/auth/register/verify", async (req, res) => {
  try {
    const { email: rawEmail, otp } = req.body as { email: string; otp: string };
    if (!rawEmail || !otp) { res.status(400).json({ error: "Email and code are required" }); return; }

    const email = normalizeEmail(rawEmail);
    const pending = pendingRegistrations.get(email);
    if (!pending)                       { res.status(400).json({ error: "Registration session expired. Please start over." }); return; }
    if (Date.now() > pending.expiresAt) { pendingRegistrations.delete(email); res.status(400).json({ error: "Code expired. Please request a new one." }); return; }
    if (pending.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      pendingRegistrations.delete(email);
      res.status(429).json({ error: "Too many incorrect attempts. Please start over." });
      return;
    }
    if (pending.otp !== String(otp).trim()) {
      pending.attempts += 1;
      res.status(400).json({ error: `Incorrect code. ${OTP_MAX_VERIFY_ATTEMPTS - pending.attempts} attempts remaining.` });
      return;
    }

    // Race-safe: re-check uniqueness in case someone else registered while pending
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      pendingRegistrations.delete(email);
      res.status(400).json({ error: "Email already registered. Please log in instead." });
      return;
    }

    const [user] = await db.insert(users).values({
      email, passwordHash: pending.passwordHash, name: pending.name,
      language: "en", isEmailVerified: true,
    }).returning();
    await db.insert(gamificationStats).values({ userId: user.id, points: 0, streak: 0, level: 1 });
    pendingRegistrations.delete(email);

    const token        = signToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await refreshTokenSet(refreshToken, user.id);
    res.status(201).json({ token, refreshToken, user: userToPublic(user) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Verification failed. Please try again." });
  }
});

// ── POST /auth/register/resend ────────────────────────────────────────────
router.post("/auth/register/resend", async (req, res) => {
  try {
    const { email: rawEmail } = req.body as { email: string };
    if (!rawEmail) { res.status(400).json({ error: "Email required" }); return; }
    const email = normalizeEmail(rawEmail);

    const pending = pendingRegistrations.get(email);
    if (!pending) { res.status(400).json({ error: "Registration session not found. Please start over." }); return; }

    if (Date.now() - pending.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - pending.lastSentAt)) / 1000);
      res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
      return;
    }

    pending.otp = generateOtp();
    pending.expiresAt = Date.now() + OTP_TTL_MS;
    pending.attempts = 0;
    pending.lastSentAt = Date.now();

    const sent = await sendOtpViaEmail(email, pending.otp, "register", req.log);
    const payload: Record<string, unknown> = { success: true, message: sent ? "New code sent" : "New code generated" };
    if (!sent && isDev()) payload["devOtp"] = pending.otp;
    if (!sent && !isDev()) { res.status(503).json({ error: "Email delivery is temporarily unavailable." }); return; }
    res.json(payload);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Resend failed" });
  }
});

// ── POST /auth/register (legacy direct, kept for backward compat) ─────────
// Deprecated: prefer /auth/register/start + /auth/register/verify
router.post("/auth/register", registerRateLimit, async (req, res) => {
  try {
    const { email: rawEmail, password, name } = req.body as { email: string; password: string; name: string };
    if (!rawEmail || !password || !name) { res.status(400).json({ error: "Email, password, and name are required" }); return; }
    if (!isValidEmail(rawEmail))         { res.status(400).json({ error: "Please enter a valid email address" }); return; }
    if (password.length < 6)             { res.status(400).json({ error: "Password must be at least 6 characters" }); return; }

    const email = normalizeEmail(rawEmail);
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) { res.status(400).json({ error: "Email already registered" }); return; }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({ email, passwordHash, name, language: "en" }).returning();
    await db.insert(gamificationStats).values({ userId: user.id, points: 0, streak: 0, level: 1 });

    const token        = signToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await refreshTokenSet(refreshToken, user.id);

    res.status(201).json({ token, refreshToken, user: userToPublic(user) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LOGIN / SESSION
// ════════════════════════════════════════════════════════════════════════════

router.post("/auth/login", loginRateLimit, async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body as { email: string; password: string };
    if (!rawEmail || !password) { res.status(400).json({ error: "Email and password required" }); return; }
    const email = normalizeEmail(rawEmail);
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }

    const token        = signToken({ userId: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await refreshTokenSet(refreshToken, user.id);

    res.json({ token, refreshToken, user: userToPublic(user) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ── POST /auth/refresh ────────────────────────────────────────────────────
// Rotates the refresh token: validates the presented token, deletes it,
// issues a brand-new pair. Old refresh tokens issued before a password
// change cutoff are rejected by refreshTokenGet.
router.post("/auth/refresh", async (req, res) => {
  try {
    const { refreshToken: presented } = req.body as { refreshToken?: string };
    if (!presented || typeof presented !== "string") {
      res.status(400).json({ error: "refreshToken required" });
      return;
    }

    // Atomic single-use consume (Redis GETDEL): two concurrent refresh
    // calls with the same token cannot both succeed. The losing caller
    // sees null and must re-login — preferable to the alternative of
    // multiple valid successor tokens being issued from one parent.
    const rec = await refreshTokenConsume(presented);
    if (!rec) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    // Verify the user still exists and load the current email claim
    const [user] = await db.select().from(users).where(eq(users.id, rec.userId)).limit(1);
    if (!user) {
      res.status(401).json({ error: "Account no longer exists" });
      return;
    }

    const newRefresh = generateRefreshToken();
    await refreshTokenSet(newRefresh, user.id);
    const newAccess  = signToken({ userId: user.id, email: user.email });

    res.json({ token: newAccess, refreshToken: newRefresh });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Refresh failed" });
  }
});

// ── POST /auth/logout ─────────────────────────────────────────────────────
// Best-effort revocation. Always returns success so a logged-out client
// never gets stuck on the logout step due to a stale refresh token.
router.post("/auth/logout", async (req, res) => {
  try {
    const { refreshToken: presented } = req.body as { refreshToken?: string };
    if (presented && typeof presented === "string") {
      await refreshTokenDelete(presented);
    }
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.json({ success: true });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    res.json(userToPublic(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

router.put("/auth/me/settings", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { monthlyIncome, language, name, currency } = req.body as { monthlyIncome?: number; language?: string; name?: string; currency?: string };
    const patch: Partial<typeof users.$inferInsert> = {};
    if (monthlyIncome !== undefined) patch.monthlyIncome = monthlyIncome;
    if (language      !== undefined) patch.language      = language;
    if (name          !== undefined) patch.name          = name;
    if (currency      !== undefined) patch.currency      = currency;
    const [user] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    res.json(userToPublic(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PROFILE MANAGEMENT (name, phone, password, email change, avatar)
// ════════════════════════════════════════════════════════════════════════════

// ── PATCH /auth/me/profile  (name, phoneNumber) ──────────────────────────
router.patch("/auth/me/profile", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { name, phoneNumber } = req.body as { name?: string; phoneNumber?: string | null };

    const patch: Partial<typeof users.$inferInsert> = {};
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) { res.status(400).json({ error: "Please enter a valid name" }); return; }
      patch.name = name.trim();
    }
    if (phoneNumber !== undefined) {
      if (phoneNumber === null || phoneNumber === "") {
        patch.phoneNumber = null;
        patch.isPhoneVerified = false;
      } else {
        if (!isValidPhone(phoneNumber)) { res.status(400).json({ error: "Please enter a valid phone number" }); return; }
        patch.phoneNumber = normalizePhone(phoneNumber);
        patch.isPhoneVerified = false;
      }
    }
    if (Object.keys(patch).length === 0) { res.status(400).json({ error: "No changes provided" }); return; }

    const [user] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
    res.json(userToPublic(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// ── POST /auth/me/password ───────────────────────────────────────────────
router.post("/auth/me/password", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { oldPassword, newPassword } = req.body as { oldPassword: string; newPassword: string };
    if (!oldPassword || !newPassword) { res.status(400).json({ error: "Both current and new password are required" }); return; }
    if (newPassword.length < 6)       { res.status(400).json({ error: "New password must be at least 6 characters" }); return; }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) { res.status(400).json({ error: "Current password is incorrect" }); return; }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId));
    // Invalidate every refresh token issued before now so any stolen session
    // cookies can no longer mint new access tokens after a password change.
    await revokeAllUserSessions(userId);
    res.json({ success: true, message: "Password updated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update password" });
  }
});

// ── POST /auth/me/avatar  ({ dataUrl }) ──────────────────────────────────
router.post("/auth/me/avatar", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { dataUrl } = req.body as { dataUrl: string | null };

    if (dataUrl === null || dataUrl === "") {
      const [user] = await db.update(users).set({ avatarUrl: null }).where(eq(users.id, userId)).returning();
      res.json(userToPublic(user));
      return;
    }
    if (typeof dataUrl !== "string") {
      res.status(400).json({ error: "Invalid image. Please choose a JPG, PNG or WEBP." });
      return;
    }
    const m = /^data:([a-z0-9+/.\-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
    if (!m || !ALLOWED_AVATAR_MIME.has(m[1].toLowerCase())) {
      res.status(400).json({ error: "Invalid image. Please choose a JPG, PNG or WEBP." });
      return;
    }
    const base64 = m[2];
    const approxBytes = Math.floor((base64.length * 3) / 4);
    if (approxBytes > AVATAR_MAX_BYTES) {
      res.status(413).json({ error: "Image is too large. Please use one under 2 MB." });
      return;
    }

    const [user] = await db.update(users).set({ avatarUrl: dataUrl }).where(eq(users.id, userId)).returning();
    res.json(userToPublic(user));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to update photo" });
  }
});

// ── POST /auth/me/email/change-request  ({ newEmail }) ───────────────────
router.post("/auth/me/email/change-request", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { newEmail: rawNew, password } = req.body as { newEmail: string; password?: string };
    if (!rawNew || !isValidEmail(rawNew)) { res.status(400).json({ error: "Please enter a valid email address" }); return; }
    const newEmail = normalizeEmail(rawNew);

    const [me] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // Re-auth: changing the email requires the current password to mitigate session hijack
    if (!password) { res.status(400).json({ error: "Please confirm your current password" }); return; }
    const valid = await bcrypt.compare(password, me.passwordHash);
    if (!valid)   { res.status(400).json({ error: "Current password is incorrect" }); return; }

    if (me.email === newEmail) { res.status(400).json({ error: "This is already your email" }); return; }

    const taken = await db.select().from(users).where(and(eq(users.email, newEmail), ne(users.id, userId))).limit(1);
    if (taken.length > 0) { res.status(400).json({ error: "Email already in use" }); return; }

    const prior = emailOtpStore.get(newEmail);
    if (prior && Date.now() - prior.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - prior.lastSentAt)) / 1000);
      res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
      return;
    }

    const otp = generateOtp();
    emailOtpStore.set(newEmail, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, lastSentAt: Date.now() });
    await db.update(users).set({ pendingEmail: newEmail }).where(eq(users.id, userId));

    const sent = await sendOtpViaEmail(newEmail, otp, "change-email", req.log);
    const payload: Record<string, unknown> = { success: true, message: sent ? "Verification code sent to new email" : "Verification code generated" };
    if (!sent && isDev()) payload["devOtp"] = otp;
    if (!sent && !isDev()) { res.status(503).json({ error: "Email delivery is temporarily unavailable." }); return; }
    res.json(payload);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to start email change" });
  }
});

// ── POST /auth/me/email/change-verify  ({ otp }) ─────────────────────────
router.post("/auth/me/email/change-verify", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { otp } = req.body as { otp: string };
    if (!otp) { res.status(400).json({ error: "Code required" }); return; }

    const [me] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!me?.pendingEmail) { res.status(400).json({ error: "No pending email change. Request one first." }); return; }

    const stored = emailOtpStore.get(me.pendingEmail);
    if (!stored)                       { res.status(400).json({ error: "Code expired or not found. Please resend." }); return; }
    if (Date.now() > stored.expiresAt) { emailOtpStore.delete(me.pendingEmail); res.status(400).json({ error: "Code expired. Please resend." }); return; }
    if (stored.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      emailOtpStore.delete(me.pendingEmail);
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }
    if (stored.otp !== String(otp).trim()) {
      stored.attempts += 1;
      res.status(400).json({ error: `Incorrect code. ${OTP_MAX_VERIFY_ATTEMPTS - stored.attempts} attempts remaining.` });
      return;
    }

    // Final uniqueness check before swap
    const taken = await db.select().from(users).where(and(eq(users.email, me.pendingEmail), ne(users.id, userId))).limit(1);
    if (taken.length > 0) {
      emailOtpStore.delete(me.pendingEmail);
      await db.update(users).set({ pendingEmail: null }).where(eq(users.id, userId));
      res.status(400).json({ error: "Email already in use" });
      return;
    }

    const newEmail = me.pendingEmail;
    emailOtpStore.delete(newEmail);
    const [updated] = await db.update(users).set({
      email: newEmail, pendingEmail: null, isEmailVerified: true,
    }).where(eq(users.id, userId)).returning();

    // Re-issue both JWT and refresh token after an email change, and
    // invalidate every previously-issued refresh token so prior sessions
    // can't keep authenticating with the stale email claim.
    await revokeAllUserSessions(updated.id);
    const token        = signToken({ userId: updated.id, email: updated.email });
    const refreshToken = generateRefreshToken();
    await refreshTokenSet(refreshToken, updated.id);
    res.json({ success: true, token, refreshToken, user: userToPublic(updated) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PHONE OTP (kept for optional phone verification post-signup)
// ════════════════════════════════════════════════════════════════════════════

router.post("/auth/send-otp", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { phoneNumber } = req.body as { phoneNumber: string };
    if (!phoneNumber || !isValidPhone(phoneNumber)) { res.status(400).json({ error: "Please enter a valid phone number" }); return; }

    const phone = normalizePhone(phoneNumber);
    const existing = phoneOtpStore.get(phone);
    if (existing && Date.now() - existing.lastSentAt < OTP_RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
      res.status(429).json({ error: `Please wait ${wait}s before requesting another code.` });
      return;
    }

    const otp = generateOtp();
    phoneOtpStore.set(phone, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0, lastSentAt: Date.now() });

    await db.update(users).set({ phoneNumber: phone, isPhoneVerified: false }).where(eq(users.id, userId));

    const sent = await sendOtpViaTwilio(phone, otp);
    if (sent) { res.json({ success: true, message: "OTP sent to your phone" }); return; }
    if (isDev()) { res.json({ success: true, message: "OTP ready (dev mode — Twilio not configured)", devOtp: otp }); return; }
    req.log.error({ phone }, "OTP delivery failed in production — Twilio not configured");
    res.status(503).json({ error: "SMS delivery is temporarily unavailable. Please try again later." });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

router.post("/auth/verify-otp", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { otp } = req.body as { otp: string };
    if (!otp) { res.status(400).json({ error: "otp required" }); return; }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.phoneNumber) { res.status(400).json({ error: "No phone number on file. Send OTP first." }); return; }

    const stored = phoneOtpStore.get(user.phoneNumber);
    if (!stored)                       { res.status(400).json({ error: "OTP expired or not found. Please resend." }); return; }
    if (Date.now() > stored.expiresAt) { phoneOtpStore.delete(user.phoneNumber); res.status(400).json({ error: "OTP expired. Please resend." }); return; }
    if (stored.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
      phoneOtpStore.delete(user.phoneNumber);
      res.status(429).json({ error: "Too many incorrect attempts. Please request a new code." });
      return;
    }
    if (stored.otp !== String(otp).trim()) {
      stored.attempts += 1;
      res.status(400).json({ error: `Incorrect OTP. ${OTP_MAX_VERIFY_ATTEMPTS - stored.attempts} attempts remaining.` });
      return;
    }

    phoneOtpStore.delete(user.phoneNumber);
    const [updated] = await db.update(users).set({ isPhoneVerified: true }).where(eq(users.id, userId)).returning();
    res.json({ success: true, user: userToPublic(updated) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ── POST /auth/send-email-otp ──────────────────────────────────────────────
router.post("/auth/send-email-otp", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Check attempt counter before allowing a new send
    const attemptRec = await getOtpAttempts(user.email);
    if (attemptRec.lockedUntil && Date.now() < attemptRec.lockedUntil) {
      const waitMin = Math.ceil((attemptRec.lockedUntil - Date.now()) / 60000);
      res.status(429).json({ error: `Too many failed attempts. Please try again in ${waitMin} minute(s).` });
      return;
    }

    const rateLimitError = await checkAndUpdateRateLimit(user.email);
    if (rateLimitError) { res.status(429).json({ error: rateLimitError }); return; }

    const otp = generateOtp();
    await otpSet(user.email, { otp, expiresAt: Date.now() + OTP_TTL_SECONDS * 1000 });

    const sent     = await sendOtpViaEmail(user.email, otp, "register", req.log);
    const isDevEnv = isDev();

    if (sent) {
      res.json({ success: true, message: `Verification code sent to ${user.email}` });
    } else if (isDevEnv) {
      res.json({ success: true, message: "OTP ready (dev mode — SMTP not configured)", devOtp: otp });
    } else {
      req.log.error({ email: user.email }, "Email OTP delivery failed — SMTP not configured");
      res.status(503).json({ error: "Email delivery is temporarily unavailable. Please try again later." });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to send email OTP" });
  }
});

// ── POST /auth/verify-email-otp ────────────────────────────────────────────
router.post("/auth/verify-email-otp", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { otp } = req.body as { otp: string };
    if (!otp) { res.status(400).json({ error: "otp required" }); return; }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const attemptRec = await getOtpAttempts(user.email);
    if (attemptRec.lockedUntil && Date.now() < attemptRec.lockedUntil) {
      const waitMin = Math.ceil((attemptRec.lockedUntil - Date.now()) / 60000);
      res.status(429).json({ error: `Too many failed attempts. Please try again in ${waitMin} minute(s).` });
      return;
    }

    const stored = await otpGet(user.email);
    if (!stored)                       { res.status(400).json({ error: "OTP expired or not found. Please resend." }); return; }
    if (Date.now() > stored.expiresAt) { await otpDelete(user.email); res.status(400).json({ error: "OTP expired. Please resend." }); return; }

    if (stored.otp !== otp.trim()) {
      const updated = await incrementOtpAttempts(user.email);
      if (updated.lockedUntil) {
        await otpDelete(user.email);
        res.status(429).json({ error: "Too many incorrect attempts. Your account is temporarily locked for 24 hours." });
      } else {
        const remaining = OTP_MAX_ATTEMPTS - updated.attempts;
        res.status(400).json({ error: `Incorrect OTP. ${remaining} attempt(s) remaining.` });
      }
      return;
    }

    await otpDelete(user.email);
    await resetOtpAttempts(user.email);
    const [updated] = await db.update(users).set({ isEmailVerified: true }).where(eq(users.id, userId)).returning();
    res.json({ success: true, user: userToPublic(updated) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Email verification failed" });
  }
});

// ── PATCH /auth/me/password ────────────────────────────────────────────────
router.patch("/auth/me/password", requireAuth, async (req, res) => {
  try {
    const { userId } = (req as Request & { user: AuthPayload }).user;
    const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
    if (!currentPassword || !newPassword) { res.status(400).json({ error: "currentPassword and newPassword required" }); return; }
    if (newPassword.length < 6) { res.status(400).json({ error: "New password must be at least 6 characters" }); return; }

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) { res.status(400).json({ error: "Current password is incorrect" }); return; }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
    // Match POST /auth/me/password: invalidate every refresh token issued
    // before now so any stolen session can't continue to mint access tokens.
    await revokeAllUserSessions(userId);
    res.json({ success: true });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to change password" });
  }
});

// NOTE: a second `POST /auth/me/avatar` previously appeared here with weaker
// validation (no MIME check, smaller size limit, different field name). Express
// only ever invokes the first registered handler for a given method+path, so
// the duplicate was unreachable dead code that drifted out of sync with the
// canonical handler above. Removed during the auth-hardening pass.

export default router;
