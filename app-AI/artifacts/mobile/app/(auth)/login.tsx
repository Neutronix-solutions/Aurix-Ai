import { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { useLoginUser } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import C from "@/constants/colors";

const c = C.light;

export default function LoginScreen() {
  const { t, isRTL } = useLang();
  const { signIn } = useAuth();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const login = useLoginUser({
    mutation: {
      onSuccess: async (data) => {
        setErrorMsg("");
        await signIn(data.token, data.user as any, (data as any).refreshToken);
        router.replace("/(tabs)/dashboard");
      },
      onError: (err: any) => {
        const msg =
          err?.data?.error ??
          err?.message ??
          "Invalid email or password. Please try again.";
        setErrorMsg(msg);
      },
    },
  });

  const handleLogin = () => {
    setErrorMsg("");
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please fill in your email and password.");
      return;
    }
    login.mutate({ data: { email: email.trim(), password } });
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo + branding */}
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>💰</Text>
          </View>
          <Text style={styles.appName}>Aurix AI</Text>
          <Text style={styles.tagline}>{t.tagline}</Text>
        </View>

        {/* Card */}
        <View style={styles.card}>
          <Text style={[styles.title, isRTL && styles.rtl]}>{t.login}</Text>

          {/* Inline error banner */}
          {errorMsg !== "" && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtl]}>{t.email}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              value={email}
              onChangeText={v => { setEmail(v); setErrorMsg(""); }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={c.mutedForeground}
              placeholder="you@example.com"
            />
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtl]}>{t.password}</Text>
            <TextInput
              style={[styles.input, isRTL && styles.rtlInput]}
              value={password}
              onChangeText={v => { setPassword(v); setErrorMsg(""); }}
              secureTextEntry
              placeholderTextColor={c.mutedForeground}
              placeholder="••••••••"
            />
          </View>

          <TouchableOpacity
            style={[styles.button, login.isPending && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={login.isPending}
          >
            {login.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>{t.login}</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push("/(auth)/register")} style={styles.link}>
            <Text style={styles.linkText}>
              Don't have an account?{" "}
              <Text style={styles.linkBold}>{t.register}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:           { flex: 1, backgroundColor: c.background },
  scroll:         { flexGrow: 1, justifyContent: "center", padding: 24 },
  header:         { alignItems: "center", marginBottom: 36 },
  logoCircle:     { width: 80, height: 80, borderRadius: 40, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  logoEmoji:      { fontSize: 40 },
  appName:        { fontSize: 30, fontWeight: "800", color: c.primary, letterSpacing: 0.5 },
  tagline:        { fontSize: 14, color: c.mutedForeground, marginTop: 4 },
  card:           { backgroundColor: c.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: c.border },
  title:          { fontSize: 22, fontWeight: "700", color: c.foreground, marginBottom: 20 },
  rtl:            { textAlign: "right" },
  errorBanner:    { backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12, marginBottom: 16, borderLeftWidth: 3, borderLeftColor: "#EF4444" },
  errorText:      { color: "#B91C1C", fontSize: 13, fontWeight: "500" },
  field:          { marginBottom: 16 },
  label:          { fontSize: 13, color: c.mutedForeground, marginBottom: 6, fontWeight: "500" },
  input:          {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: c.border,
    color: c.foreground,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
  },
  rtlInput:       { textAlign: "right" },
  button:         { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 8, marginBottom: 16 },
  buttonDisabled: { opacity: 0.7 },
  buttonText:     { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
  link:           { alignItems: "center" },
  linkText:       { color: c.mutedForeground, fontSize: 14 },
  linkBold:       { color: c.primary, fontWeight: "600" },
});
