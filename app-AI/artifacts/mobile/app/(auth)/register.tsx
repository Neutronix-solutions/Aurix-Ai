import { useState, useCallback, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import C from "@/constants/colors";

const c = C.light;

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function apiPost(path: string, body: object): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* may be empty */ }
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status}). Please try again.`);
  return data;
}

export default function RegisterScreen() {
  const { t, isRTL } = useLang();
  const { signIn } = useAuth();

  // Step 1 — credentials form
  const [step, setStep]         = useState<"form" | "otp">("form");
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [busy, setBusy]         = useState(false);

  // Step 2 — email OTP
  const [otp, setOtp]               = useState("");
  const [otpError, setOtpError]     = useState("");
  const [devOtp, setDevOtp]         = useState("");
  const [verifying, setVerifying]   = useState(false);
  const [resending, setResending]   = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (cooldownTimer.current) clearInterval(cooldownTimer.current); };
  }, []);

  const startCooldown = useCallback((seconds: number) => {
    setResendCooldown(seconds);
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) { if (cooldownTimer.current) clearInterval(cooldownTimer.current); return 0; }
        return s - 1;
      });
    }, 1000);
  }, []);

  const handleStartRegister = useCallback(async () => {
    setErrorMsg("");
    if (!name.trim() || !email.trim() || !password.trim()) {
      setErrorMsg("Please fill in all fields."); return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg("Please enter a valid email address."); return;
    }
    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters."); return;
    }
    setBusy(true);
    try {
      const data = await apiPost("/api/auth/register/start", {
        name: name.trim(), email: email.trim(), password,
      });
      setDevOtp(data?.devOtp ?? "");
      setOtp("");
      setOtpError("");
      setStep("otp");
      startCooldown(60);
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Could not start registration. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [name, email, password, startCooldown]);

  const handleVerifyOtp = useCallback(async () => {
    if (!otp.trim() || otp.trim().length !== 6) {
      setOtpError("Enter the 6-digit code"); return;
    }
    setVerifying(true);
    setOtpError("");
    try {
      const data = await apiPost("/api/auth/register/verify", { email: email.trim(), otp: otp.trim() });
      await signIn(data.token, data.user, data.refreshToken);
      router.replace("/(auth)/onboarding");
    } catch (err: any) {
      setOtpError(err?.message ?? "Incorrect code. Try again.");
    } finally {
      setVerifying(false);
    }
  }, [otp, email, signIn]);

  // Email-OTP resend on the post-signup verification screen lives in
  // (auth)/verify-email.tsx — this register screen only handles the initial
  // registration OTP via handleResendOtp below. The previous duplicate
  // handler referenced state that was never declared on this screen.

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0) return;
    setResending(true);
    setOtpError("");
    try {
      const data = await apiPost("/api/auth/register/resend", { email: email.trim() });
      setDevOtp(data?.devOtp ?? "");
      setOtp("");
      startCooldown(60);
    } catch (err: any) {
      setOtpError(err?.message ?? "Failed to resend");
    } finally {
      setResending(false);
    }
  }, [email, resendCooldown, startCooldown]);

  const handleBackToForm = useCallback(() => {
    setStep("form"); setOtp(""); setOtpError(""); setDevOtp("");
  }, []);

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>💰</Text>
          </View>
          <Text style={styles.appName}>Aurix AI</Text>
          <Text style={styles.tagline}>{t.tagline}</Text>
        </View>

        {step === "form" ? (
          <View style={styles.card}>
            <Text style={[styles.title, isRTL && styles.rtl]}>{t.register}</Text>

            {errorMsg !== "" && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtl]}>{t.name}</Text>
              <TextInput style={[styles.input, isRTL && styles.rtlInput]} value={name}
                onChangeText={v => { setName(v); setErrorMsg(""); }}
                autoCorrect={false} autoCapitalize="words"
                placeholderTextColor={c.mutedForeground} placeholder="John Doe" />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtl]}>{t.email}</Text>
              <TextInput style={[styles.input, isRTL && styles.rtlInput]} value={email}
                onChangeText={v => { setEmail(v); setErrorMsg(""); }}
                keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
                placeholderTextColor={c.mutedForeground} placeholder="you@example.com" />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtl]}>{t.password}</Text>
              <TextInput style={[styles.input, isRTL && styles.rtlInput]} value={password}
                onChangeText={v => { setPassword(v); setErrorMsg(""); }}
                secureTextEntry placeholderTextColor={c.mutedForeground} placeholder="••••••••" />
              <Text style={styles.hint}>At least 6 characters</Text>
            </View>

            <TouchableOpacity
              style={[styles.button, busy && styles.buttonDisabled]}
              onPress={handleStartRegister} disabled={busy}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Send verification code</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push("/(auth)/login")} style={styles.link}>
              <Text style={styles.linkText}>Already have an account? <Text style={styles.linkBold}>{t.login}</Text></Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.title}>Verify your email</Text>
            <Text style={styles.otpSub}>Enter the 6-digit code sent to{"\n"}<Text style={{ fontWeight: "700", color: c.foreground }}>{email}</Text></Text>

            {devOtp !== "" && __DEV__ && (
              <View style={styles.devBanner}>
                <Text style={styles.devText}>🔧 Dev mode — OTP: <Text style={{ fontWeight: "800" }}>{devOtp}</Text></Text>
                <Text style={styles.devSub}>Set RESEND_API_KEY to send real emails</Text>
              </View>
            )}

            {otpError !== "" && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>⚠️ {otpError}</Text>
              </View>
            )}

            <TextInput
              style={styles.otpInput}
              value={otp}
              onChangeText={v => { setOtp(v.replace(/\D/g, "").slice(0, 6)); setOtpError(""); }}
              keyboardType="number-pad" placeholder="------"
              placeholderTextColor={c.mutedForeground} maxLength={6} textAlign="center"
            />

            <TouchableOpacity
              style={[styles.button, (verifying || otp.length < 6) && styles.buttonDisabled]}
              onPress={handleVerifyOtp} disabled={verifying || otp.length < 6}>
              {verifying ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify & create account</Text>}
            </TouchableOpacity>

            <View style={styles.otpFooter}>
              <TouchableOpacity onPress={handleResendOtp} disabled={resendCooldown > 0 || resending}>
                <Text style={[styles.resendText, (resendCooldown > 0 || resending) && { opacity: 0.4 }]}>
                  {resending ? "Sending…" : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleBackToForm}>
                <Text style={styles.skipText}>Edit email</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:          { flex: 1, backgroundColor: c.background },
  scroll:        { flexGrow: 1, justifyContent: "center", padding: 24 },
  header:        { alignItems: "center", marginBottom: 28 },
  logoCircle:    { width: 80, height: 80, borderRadius: 40, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  logoEmoji:     { fontSize: 40 },
  appName:       { fontSize: 30, fontWeight: "800", color: c.primary, letterSpacing: 0.5 },
  tagline:       { fontSize: 14, color: c.mutedForeground, marginTop: 4 },
  card:          { backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: c.border },
  title:         { fontSize: 22, fontWeight: "700", color: c.foreground, marginBottom: 14 },
  rtl:           { textAlign: "right" },
  errorBanner:   { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: "#EF4444" },
  errorText:     { color: "#B91C1C", fontSize: 13, fontWeight: "500" },
  field:         { marginBottom: 16 },
  label:         { fontSize: 13, color: c.mutedForeground, marginBottom: 6, fontWeight: "500" },
  hint:          { fontSize: 11, color: c.mutedForeground, marginTop: 5 },
  input:         { backgroundColor: "#FFFFFF", borderRadius: 10, borderWidth: 1.5, borderColor: c.border, color: c.foreground, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  rtlInput:      { textAlign: "right" },
  button:        { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 8, marginBottom: 16 },
  buttonDisabled:{ opacity: 0.55 },
  buttonText:    { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  link:          { alignItems: "center" },
  linkText:      { color: c.mutedForeground, fontSize: 14 },
  linkBold:      { color: c.primary, fontWeight: "600" },
  otpSub:        { fontSize: 14, color: c.mutedForeground, textAlign: "center", lineHeight: 20, marginBottom: 16 },
  devBanner:     { backgroundColor: "#FFF7ED", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#F59E0B", gap: 4, marginBottom: 12 },
  devText:       { color: "#92400E", fontSize: 14, textAlign: "center" },
  devSub:        { color: "#92400E", fontSize: 11, textAlign: "center" },
  otpInput:      { backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 2, borderColor: c.primary, fontSize: 32, fontWeight: "900", letterSpacing: 12, paddingVertical: 16, color: c.foreground, marginBottom: 8 },
  otpFooter:     { flexDirection: "row", justifyContent: "space-between", paddingTop: 4 },
  resendText:    { color: c.primary, fontWeight: "600", fontSize: 14 },
  skipText:      { color: c.mutedForeground, fontSize: 14 },
});
