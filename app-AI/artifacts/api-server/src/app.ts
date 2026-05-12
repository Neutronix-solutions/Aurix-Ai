import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { captureException } from "./lib/sentry";
import { recordLatency } from "./routes/health";

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles for the health check page (if any).
  // contentSecurityPolicy disabled here — the API serves JSON, not HTML.
  contentSecurityPolicy: false,
  // hsts: enforced by Railway/reverse-proxy in production; keep enabled here too.
  hsts: process.env["NODE_ENV"] === "production",
}));

// ── Request logging with redacted auth headers ────────────────────────────
app.use(
  pinoHttp({
    logger,
    genReqId(req) {
      // Use X-Request-ID from upstream (Railway/nginx) or generate a simple one.
      return (req.headers["x-request-id"] as string | undefined)
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    },
    customSuccessMessage(req, res, responseTime) {
      recordLatency(responseTime);
      return `${req.method} ${req.url?.split("?")[0]} ${res.statusCode} ${responseTime}ms`;
    },
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────
// Native mobile clients don't send an Origin header — always allow those.
// Web origins are restricted in production via ALLOWED_ORIGINS env var
// (comma-separated list, e.g. "https://app.aurixai.com,https://aurixai.com").
const allowedOrigins = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"].split(",").map(o => o.trim())
  : null;

app.use(
  cors({
    origin: allowedOrigins
      ? (origin, cb) => {
          if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
          cb(new Error(`CORS: origin ${origin} not allowed`));
        }
      : true,
    credentials: true,
  }),
);

// ── Body parsing ──────────────────────────────────────────────────────────
// 10mb allows base64-encoded receipt images (raw JPEG ~1-3MB → base64 ~1.3-4MB)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// ── Routes ────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Error handlers ────────────────────────────────────────────────────────

// 1. Payload-too-large — return JSON rather than Express plain-text default
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Request body too large — max 10 MB", requestId: req.id });
    return;
  }
  next(err);
});

// 2. Global catch-all — log, report to Sentry, return structured JSON
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, requestId: req.id }, "Unhandled error");
  captureException(err, { requestId: req.id, url: req.url, method: req.method });
  const statusCode = typeof err?.status === "number" ? err.status : 500;
  res.status(statusCode).json({
    error: process.env["NODE_ENV"] === "production"
      ? "An unexpected error occurred. Please try again."
      : (err?.message ?? "Internal server error"),
    requestId: req.id,
  });
});

export default app;
