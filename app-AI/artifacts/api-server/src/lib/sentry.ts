/**
 * Sentry initialisation for the API server.
 *
 * Import this module ONCE at the top of index.ts before anything else.
 * When SENTRY_DSN is not set the SDK is initialised in a no-op state —
 * all calls are safe but nothing is reported.
 */
import * as Sentry from "@sentry/node";

export function initSentry(): void {
  const dsn = process.env["SENTRY_DSN"];
  if (!dsn) return; // no-op in dev / when DSN not configured

  Sentry.init({
    dsn,
    environment:     process.env["NODE_ENV"] ?? "development",
    release:         process.env["RAILWAY_GIT_COMMIT_SHA"] ?? process.env["npm_package_version"],
    tracesSampleRate: process.env["NODE_ENV"] === "production" ? 0.1 : 1.0,
    // Capture unhandled promise rejections automatically.
    integrations: [Sentry.onUnhandledRejectionIntegration({ mode: "warn" })],
  });
}

/** Capture an exception with optional extra context. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  Sentry.withScope(scope => {
    if (context) {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    }
    Sentry.captureException(err);
  });
}

export { Sentry };
