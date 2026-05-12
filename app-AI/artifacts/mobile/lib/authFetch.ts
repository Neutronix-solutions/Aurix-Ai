/**
 * Shared authenticated HTTP client for all manual fetch calls in the mobile app.
 *
 * Features:
 *  - Reads access token from AsyncStorage on every call (picks up rotated tokens).
 *  - On HTTP 401: attempts a single token refresh via POST /auth/refresh, then retries.
 *    If refresh fails, clears stored tokens so the app redirects to login.
 *  - Retries transient failures (502/503/504, DNS errors, network drops) up to
 *    MAX_RETRIES times with exponential backoff (300 → 600 → 1200 ms).
 *  - Does NOT retry 4xx client errors (except 401 handled above).
 *  - Classifies errors so callers can show context-appropriate messages.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

export const TOKEN_KEY   = "aurixai_token";
export const REFRESH_KEY = "aurixai_refresh_token";

const MAX_RETRIES   = 2;   // up to 3 total attempts
const BASE_DELAY_MS = 300; // 300 ms → 600 ms → 1200 ms

// Server-side transient errors worth retrying
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Token refresh ─────────────────────────────────────────────────────────
// All concurrent 401s share a single in-flight refresh promise so that we
// don't burn through refresh-token rotations (each rotate invalidates the
// previous one server-side, which would otherwise cause a thundering-herd of
// failed refreshes the moment the access token expires).

let inFlightRefresh: Promise<string | null> | null = null;

// ── Session-expiry hook ───────────────────────────────────────────────────
// AuthContext registers a callback here on mount. When a 401 response cannot
// be recovered via refresh (no refresh token, expired refresh token, server
// rejected it), we invoke this callback so the app can clear in-memory user
// state and the navigation guard in (tabs)/_layout.tsx can redirect to login.
// Without this, the user would see "Session expired" alerts on every action
// while still appearing to be signed in.

let onSessionExpired: (() => void) | null = null;

export function setOnSessionExpired(cb: (() => void) | null): void {
  onSessionExpired = cb;
}

function fireSessionExpired(): void {
  if (onSessionExpired) {
    try { onSessionExpired(); } catch { /* swallow — callback is best-effort */ }
  }
}

async function performRefresh(): Promise<string | null> {
  const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      // Refresh token is invalid or expired — force re-login
      await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY]);
      return null;
    }
    const data = (await res.json()) as { token: string; refreshToken: string };
    await AsyncStorage.multiSet([
      [TOKEN_KEY,   data.token],
      [REFRESH_KEY, data.refreshToken],
    ]);
    return data.token;
  } catch {
    return null;
  }
}

async function attemptTokenRefresh(): Promise<string | null> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = performRefresh().finally(() => { inFlightRefresh = null; });
  return inFlightRefresh;
}

// ── Error class ───────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: "offline" | "timeout" | "session_expired" | "service_unavailable" | "server_error" | "client_error",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Raw response variant (for callers that consume Response directly) ─────
// Handles retry + token refresh but returns the raw Response instead of parsed JSON.

export async function authFetchRaw(
  path: string,
  options: RequestInit = {},
  _attempt = 0,
): Promise<Response> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (err: unknown) {
    if (_attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * Math.pow(2, _attempt));
      return authFetchRaw(path, options, _attempt + 1);
    }
    throw err;
  }

  // 401 → try refresh once
  if (res.status === 401 && _attempt === 0) {
    const newToken = await attemptTokenRefresh();
    if (newToken) return authFetchRaw(path, options, 1);
    fireSessionExpired();
    // Return the 401 as-is so callers can handle it
    return res;
  }

  // Retry gateway errors
  if (RETRYABLE_STATUSES.has(res.status) && _attempt < MAX_RETRIES) {
    await sleep(BASE_DELAY_MS * Math.pow(2, _attempt));
    return authFetchRaw(path, options, _attempt + 1);
  }

  return res;
}

// ── Core fetch ────────────────────────────────────────────────────────────

export async function authFetch(
  path: string,
  options: RequestInit = {},
  _attempt = 0,
): Promise<any> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    });
  } catch (err: unknown) {
    // Network-level failure (DNS, no connection, timeout from AbortController)
    if (_attempt < MAX_RETRIES) {
      await sleep(BASE_DELAY_MS * Math.pow(2, _attempt));
      return authFetch(path, options, _attempt + 1);
    }
    const msg = (err as Error)?.message ?? "";
    const isOffline = msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch");
    throw new ApiError(
      isOffline ? "You appear to be offline — check your connection" : `Network error: ${msg}`,
      undefined,
      isOffline ? "offline" : "timeout",
    );
  }

  // ── 401: try refresh once, then retry ────────────────────────────────
  if (res.status === 401 && _attempt === 0) {
    const newToken = await attemptTokenRefresh();
    if (newToken) return authFetch(path, options, 1); // retry with new token
    fireSessionExpired();
    throw new ApiError("Session expired — please log in again", 401, "session_expired");
  }

  // ── Gateway / server transient errors: retry with backoff ────────────
  if (RETRYABLE_STATUSES.has(res.status) && _attempt < MAX_RETRIES) {
    await sleep(BASE_DELAY_MS * Math.pow(2, _attempt));
    return authFetch(path, options, _attempt + 1);
  }

  // ── Parse body ────────────────────────────────────────────────────────
  const text = await res.text();
  let data: unknown;
  try {
    data = text.trim() ? JSON.parse(text) : {};
  } catch {
    if (res.status === 503) throw new ApiError("Service temporarily unavailable", 503, "service_unavailable");
    if (!res.ok)            throw new ApiError(`Server error (${res.status})`, res.status, "server_error");
    throw new ApiError("Unexpected response from server", res.status);
  }

  if (!res.ok) {
    const obj = data as Record<string, unknown>;
    const message = res.status === 413
      ? "Image is too large — please crop or reduce the photo quality and try again"
      : (obj?.error ?? obj?.message ?? `Request failed (${res.status})`) as string;
    throw new ApiError(message, res.status, res.status >= 500 ? "server_error" : "client_error");
  }

  return data;
}
