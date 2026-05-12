/**
 * Pings the backend health endpoint at app startup and exposes a reactive
 * status so any screen can show a connectivity banner.
 *
 * States:
 *   "unknown"      — not yet checked
 *   "checking"     — request in flight
 *   "ok"           — 200 received within timeout
 *   "unreachable"  — network error, DNS failure, or timeout
 *   "misconfigured"— EXPO_PUBLIC_API_BASE is empty/missing
 */

import { useState, useEffect, useCallback, useRef } from "react";

export type ApiHealthStatus = "unknown" | "checking" | "ok" | "unreachable" | "misconfigured";

export interface ApiHealthResult {
  status: ApiHealthStatus;
  /** Human-readable reason string, set on non-ok states */
  reason: string | null;
  /** Ping the backend right now, regardless of cache */
  recheck: () => void;
}

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

// Cache result for 60 s so we don't hammer the backend on every re-render
const CACHE_TTL_MS = 60_000;
let _cachedStatus: ApiHealthStatus | null = null;
let _cachedAt = 0;

export function useApiHealth(): ApiHealthResult {
  const [status, setStatus]   = useState<ApiHealthStatus>("unknown");
  const [reason, setReason]   = useState<string | null>(null);
  const mountedRef             = useRef(true);

  const check = useCallback(async (force = false) => {
    if (!API_BASE) {
      setStatus("misconfigured");
      setReason(
        "EXPO_PUBLIC_API_BASE is not set. " +
        "Add it to artifacts/mobile/.env (e.g. http://192.168.1.x:3000)"
      );
      _cachedStatus = "misconfigured";
      return;
    }

    // Use cached result if fresh and not forcing a recheck
    if (!force && _cachedStatus && Date.now() - _cachedAt < CACHE_TTL_MS) {
      if (mountedRef.current) { setStatus(_cachedStatus); setReason(null); }
      return;
    }

    if (mountedRef.current) setStatus("checking");

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 8_000);

    try {
      const res = await fetch(`${API_BASE}/api/healthz`, {
        method:  "GET",
        signal:  controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeout);

      if (res.ok) {
        _cachedStatus = "ok";
        _cachedAt     = Date.now();
        if (mountedRef.current) { setStatus("ok"); setReason(null); }
      } else {
        _cachedStatus = "unreachable";
        const msg = `Server returned HTTP ${res.status}`;
        if (mountedRef.current) { setStatus("unreachable"); setReason(msg); }
      }
    } catch (err: unknown) {
      clearTimeout(timeout);
      _cachedStatus = "unreachable";
      const isAbort = (err as Error)?.name === "AbortError";
      const msg = isAbort
        ? "Health check timed out — server may be slow or unreachable"
        : `Cannot reach ${API_BASE} — ${(err as Error)?.message ?? "network error"}`;
      if (mountedRef.current) { setStatus("unreachable"); setReason(msg); }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    check();
    return () => { mountedRef.current = false; };
  }, [check]);

  const recheck = useCallback(() => {
    _cachedStatus = null; // invalidate cache
    check(true);
  }, [check]);

  return { status, reason, recheck };
}
