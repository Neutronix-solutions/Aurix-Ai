/**
 * Sentry initialisation for the mobile app.
 *
 * Call initSentry() once at app startup (before the Expo Router renders).
 * When EXPO_PUBLIC_SENTRY_DSN is not set, the SDK is a no-op — safe to call
 * in development without a DSN.
 */
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";

export function initSentry(): void {
  const dsn =
    process.env["EXPO_PUBLIC_SENTRY_DSN"] ??
    (Constants.expoConfig?.extra?.sentryDsn as string | undefined);

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:      __DEV__ ? "development" : "production",
    enableNativeNagger: false,
    tracesSampleRate:   __DEV__ ? 1.0 : 0.1,
    // Attach user context from AsyncStorage at breadcrumb time if available.
    beforeBreadcrumb(breadcrumb) {
      return breadcrumb;
    },
  });
}

/** Report a caught error to Sentry with optional extra context. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  Sentry.withScope(scope => {
    if (context) {
      Object.entries(context).forEach(([k, v]) => scope.setExtra(k, v));
    }
    Sentry.captureException(err);
  });
}

export { Sentry };
