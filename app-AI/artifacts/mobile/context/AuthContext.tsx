import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setBaseUrl, setAuthTokenGetter, setOnUnauthorized } from "@workspace/api-client-react";
import { TOKEN_KEY, REFRESH_KEY, setOnSessionExpired } from "@/lib/authFetch";

const API_BASE = process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

const USER_KEY = "aurixai_user";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  monthlyIncome: number | null;
  language: string | null;
  phoneNumber?: string | null;
  isPhoneVerified?: boolean;
  isEmailVerified?: boolean;
  pendingEmail?: string | null;
  avatarUrl?: string | null;
  currency?: string | null;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  signIn: (token: string, user: AuthUser, refreshToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [token,     setToken]     = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setBaseUrl(API_BASE);

    // The React Query client picks up the latest token from AsyncStorage before
    // each request. When a token is silently refreshed by authFetch, subsequent
    // React Query calls will automatically use the new token without re-rendering.
    setAuthTokenGetter(async () => AsyncStorage.getItem(TOKEN_KEY));
  }, []);

  // ── Session-expiry handler ────────────────────────────────────────────
  // When authFetch detects an unrecoverable 401 (refresh failed / no refresh
  // token), it invokes this callback. We clear in-memory user state so the
  // (tabs)/_layout.tsx guard redirects to login. Storage is also cleared so
  // the stale token can't keep firing failed refreshes.
  useEffect(() => {
    const expire = () => {
      AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]).catch(() => {});
      setToken(null);
      setUser(null);
    };
    // Manual fetches via authFetch
    setOnSessionExpired(expire);
    // Generated React Query hooks via @workspace/api-client-react
    setOnUnauthorized(expire);
    return () => {
      setOnSessionExpired(null);
      setOnUnauthorized(null);
    };
  }, []);

  useEffect(() => {
    AsyncStorage.multiGet([TOKEN_KEY, USER_KEY]).then(([tokenPair, userPair]) => {
      const storedToken = tokenPair[1];
      const storedUser  = userPair[1];
      if (storedToken && storedUser) {
        try {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as AuthUser);
        } catch {}
      }
      setIsLoading(false);
    });
  }, []);

  const signIn = useCallback(async (newToken: string, newUser: AuthUser, refreshToken?: string) => {
    const pairs: [string, string][] = [
      [TOKEN_KEY, newToken],
      [USER_KEY,  JSON.stringify(newUser)],
    ];
    if (refreshToken) pairs.push([REFRESH_KEY, refreshToken]);
    await AsyncStorage.multiSet(pairs);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort server-side refresh token invalidation
    try {
      const [accessToken, refreshToken] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(REFRESH_KEY),
      ]);
      if (accessToken && refreshToken) {
        fetch(`${API_BASE}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
      }
    } catch {}

    await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]);
    setToken(null);
    setUser(null);
  }, []);

  const updateUser = useCallback((newUser: AuthUser) => {
    setUser(newUser);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
