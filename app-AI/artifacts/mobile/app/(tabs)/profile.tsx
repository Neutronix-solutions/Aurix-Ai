import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Switch, Modal, Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import {
  useGetMe, useUpdateUserSettings, useGetGamification,
  getGetMeQueryKey, getGetFinancialScoreQueryKey,
} from "@workspace/api-client-react";
import { useAuth, AuthUser } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { useCurrency } from "@/hooks/useCurrency";
import { CurrencyConverterModal } from "@/components/CurrencyConverter";
import { authFetch } from "@/lib/authFetch";

type Sheet = null | "name" | "phone" | "email" | "password";

export default function ProfileScreen() {
  const colors = useColors();
  const { t, isRTL, language, setLanguage } = useLang();
  const { user, signOut, updateUser, signIn } = useAuth();
  const queryClient = useQueryClient();
  const { currency, currentCurrencyInfo } = useCurrency();
  const [showConverter, setShowConverter] = useState(false);

  const [sheet, setSheet] = useState<Sheet>(null);
  const [income, setIncome] = useState(String(user?.monthlyIncome ?? ""));
  const [editingIncome, setEditingIncome] = useState(false);

  const { data: me, refetch: refetchMe } = useGetMe();
  const { data: gamification } = useGetGamification();
  const updateSettings = useUpdateUserSettings();

  const u = (me ?? user) as AuthUser | null;

  // Sync local income state when fresh data arrives
  useEffect(() => { if (u && !editingIncome) setIncome(String(u.monthlyIncome ?? "")); }, [u?.monthlyIncome, editingIncome]);

  const refreshAll = useCallback(async () => {
    const fresh = await refetchMe();
    if (fresh.data) updateUser(fresh.data as AuthUser);
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetFinancialScoreQueryKey() });
  }, [refetchMe, queryClient, updateUser]);

  const handleSaveIncome = useCallback(() => {
    const incomeNum = parseFloat(income);
    updateSettings.mutate(
      { data: { monthlyIncome: isNaN(incomeNum) ? 0 : incomeNum } },
      {
        onSuccess: (data) => {
          updateUser(data as AuthUser);
          setEditingIncome(false);
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetFinancialScoreQueryKey() });
        },
        onError: () => Alert.alert("Error", "Could not save income"),
      },
    );
  }, [income, updateSettings, updateUser, queryClient]);

  const handleToggleLang = useCallback(() => {
    const newLang = language === "en" ? "ar" : "en";
    setLanguage(newLang);
    updateSettings.mutate({ data: { language: newLang } });
  }, [language, setLanguage, updateSettings]);

  const handleLogout = useCallback(() => {
    Alert.alert(t.logout, "Are you sure you want to log out?", [
      { text: t.cancel, style: "cancel" },
      {
        text: t.logout, style: "destructive",
        onPress: async () => { await signOut(); router.replace("/(auth)/login"); },
      },
    ]);
  }, [signOut, t]);

  const pickAvatar = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") { Alert.alert("Permission needed", "Please allow photo access to change your photo."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.5, base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    const asset = result.assets[0];
    const dataUrl = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
    try {
      const updated = await authFetch("/api/auth/me/avatar", { method: "POST", body: JSON.stringify({ dataUrl }) });
      updateUser(updated as AuthUser);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    } catch (err: any) {
      Alert.alert("Error", err?.message ?? "Could not update photo");
    }
  }, [updateUser, queryClient]);

  const g = gamification as any;
  const LEVEL_NAMES = ["Rookie", "Saver", "Tracker", "Planner", "Investor", "Achiever", "Wealth Builder"];
  const levelName = g ? (LEVEL_NAMES[(g.level ?? 1) - 1] ?? "Master") : "—";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>

        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>{t.profile}</Text>
        </View>

        {/* ── Avatar ─────────────────────────────────────────────── */}
        <View style={[styles.avatarSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity onPress={pickAvatar} activeOpacity={0.8}>
            <View style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}>
              {u?.avatarUrl
                ? <Image source={{ uri: u.avatarUrl }} style={{ width: 72, height: 72, borderRadius: 36 }} />
                : <Text style={{ fontSize: 32 }}>👤</Text>}
            </View>
            <View style={[styles.cameraBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
              <Feather name="camera" size={12} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={[styles.userName, { color: colors.foreground }]}>{u?.name ?? "—"}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.userEmail, { color: colors.mutedForeground }]}>{u?.email ?? "—"}</Text>
            {u?.isEmailVerified && <Feather name="check-circle" size={13} color={colors.success} />}
          </View>
          {u?.pendingEmail && (
            <Text style={[styles.pendingNote, { color: colors.warning }]}>
              Pending: {u.pendingEmail} — open settings to verify
            </Text>
          )}
        </View>

        {/* ── Account section ────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Account</Text>

          <RowAction icon="user"     label="Name"     value={u?.name ?? "—"}                  onPress={() => setSheet("name")}     colors={colors} />
          <Divider colors={colors} />
          <RowAction icon="mail"     label="Email"    value={u?.email ?? "—"}                 onPress={() => setSheet("email")}    colors={colors} />
          <Divider colors={colors} />
          <RowAction icon="phone"    label="Phone"    value={u?.phoneNumber ?? "Not set"}     onPress={() => setSheet("phone")}    colors={colors} />
          <Divider colors={colors} />
          <RowAction icon="lock"     label="Password" value="••••••••"                         onPress={() => setSheet("password")} colors={colors} />
        </View>

        {/* ── Progress (gamification) ────────────────────────────── */}
        {g && (
          <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Progress</Text>
            <View style={styles.statsRow}>
              {[
                { label: t.points, value: g.points,                          icon: "star",  color: colors.primary },
                { label: t.streak, value: g.streak + " days",                icon: "zap",   color: colors.warning },
                { label: t.level,  value: `${g.level} · ${levelName}`,       icon: "award", color: colors.success },
              ].map(stat => (
                <View key={stat.label} style={[styles.statItem, { backgroundColor: colors.accent }]}>
                  <Feather name={stat.icon as any} size={20} color={stat.color} />
                  <Text style={[styles.statValue, { color: colors.foreground }]}>{stat.value}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Settings ──────────────────────────────────────────── */}
        <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{t.settings}</Text>

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Feather name="dollar-sign" size={18} color={colors.primary} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.foreground }]}>{t.monthlyIncome}</Text>
                <Text style={[styles.settingSub, { color: colors.mutedForeground }]}>QAR per month</Text>
              </View>
            </View>
            {editingIncome ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <TextInput
                  style={[styles.inlineInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
                  value={income} onChangeText={setIncome} keyboardType="numeric"
                  placeholder="15000" placeholderTextColor={colors.mutedForeground} autoFocus
                />
                <TouchableOpacity onPress={handleSaveIncome} disabled={updateSettings.isPending}>
                  {updateSettings.isPending
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <Feather name="check" size={20} color={colors.primary} />}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setEditingIncome(true)}>
                <Text style={[styles.settingValue, { color: colors.primary }]}>QAR {u?.monthlyIncome ?? 0}</Text>
              </TouchableOpacity>
            )}
          </View>

          <Divider colors={colors} />

          <TouchableOpacity style={styles.settingRow} onPress={() => setShowConverter(true)}>
            <View style={styles.settingLeft}>
              <Feather name="refresh-cw" size={18} color={colors.primary} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.foreground }]}>Display Currency</Text>
                <Text style={[styles.settingSub, { color: colors.mutedForeground }]}>Amounts shown in app</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 18 }}>{currentCurrencyInfo.flag}</Text>
              <Text style={[styles.settingValue, { color: colors.primary }]}>{currency}</Text>
              <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
            </View>
          </TouchableOpacity>

          <Divider colors={colors} />

          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Feather name="globe" size={18} color={colors.primary} />
              <View>
                <Text style={[styles.settingLabel, { color: colors.foreground }]}>{t.language}</Text>
                <Text style={[styles.settingSub, { color: colors.mutedForeground }]}>{language === "en" ? t.english : t.arabic}</Text>
              </View>
            </View>
            <Switch
              value={language === "ar"}
              onValueChange={handleToggleLang}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <CurrencyConverterModal visible={showConverter} onClose={() => setShowConverter(false)} />

        {/*
          Note: the Email OTP and Password change flows are implemented
          below as <EmailSheet /> and <PasswordSheet />, opened via
          setSheet("email" | "password"). Earlier inline Modal drafts
          for those flows were removed because they referenced state and
          handlers that were never declared and were unreachable
          (no caller ever set showEmailOtp / showPasswordModal).
        */}

        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: colors.card, borderColor: colors.danger + "40" }]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>{t.logout}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Edit sheets ──────────────────────────────────────── */}
      <NameSheet     visible={sheet === "name"}     user={u} onClose={() => setSheet(null)} onSaved={refreshAll} />
      <PhoneSheet    visible={sheet === "phone"}    user={u} onClose={() => setSheet(null)} onSaved={refreshAll} />
      <PasswordSheet visible={sheet === "password"}                      onClose={() => setSheet(null)} />
      <EmailSheet
        visible={sheet === "email"}
        user={u}
        onClose={() => setSheet(null)}
        onVerified={async (data: any) => {
          if (data.token && data.user) await signIn(data.token, data.user, data.refreshToken);
          await refreshAll();
        }}
      />
    </SafeAreaView>
  );
}

// ─── Reusable row + sheet helpers ────────────────────────────────
function RowAction({ icon, label, value, onPress, colors }: any) {
  return (
    <TouchableOpacity style={styles.settingRow} onPress={onPress}>
      <View style={styles.settingLeft}>
        <Feather name={icon} size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingLabel, { color: colors.foreground }]}>{label}</Text>
          <Text style={[styles.settingSub, { color: colors.mutedForeground }]} numberOfLines={1}>{value}</Text>
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}
function Divider({ colors }: any) { return <View style={[styles.divider, { backgroundColor: colors.border }]} />; }

function SheetShell({ visible, onClose, title, children }: any) {
  const colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetOverlay}>
        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
          <View style={styles.sheetHeader}>
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>{title}</Text>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function NameSheet({ visible, user, onClose, onSaved }: any) {
  const colors = useColors();
  const [name, setName] = useState(user?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  useEffect(() => { if (visible) { setName(user?.name ?? ""); setErr(""); } }, [visible, user?.name]);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await authFetch("/api/auth/me/profile", { method: "PATCH", body: JSON.stringify({ name }) });
      await onSaved(); onClose();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="Change name">
      {err !== "" && <Text style={styles.sheetErr}>{err}</Text>}
      <TextInput style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border }]}
        value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.mutedForeground} autoCapitalize="words" />
      <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnText}>Save</Text>}
      </TouchableOpacity>
    </SheetShell>
  );
}

function PhoneSheet({ visible, user, onClose, onSaved }: any) {
  const colors = useColors();
  const [phone, setPhone] = useState(user?.phoneNumber ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState("");
  useEffect(() => { if (visible) { setPhone(user?.phoneNumber ?? ""); setErr(""); } }, [visible, user?.phoneNumber]);

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await authFetch("/api/auth/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ phoneNumber: phone.trim() === "" ? null : phone.trim() }),
      });
      await onSaved(); onClose();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="Change phone number">
      {err !== "" && <Text style={styles.sheetErr}>{err}</Text>}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={[styles.phonePrefix, { borderColor: colors.border }]}>
          <Text style={{ fontSize: 16 }}>🇶🇦</Text>
          <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 14 }}>+974</Text>
        </View>
        <TextInput
          style={[styles.sheetInput, { flex: 1, color: colors.foreground, borderColor: colors.border }]}
          value={phone} onChangeText={setPhone} keyboardType="phone-pad"
          placeholder="5x xxx xxxx" placeholderTextColor={colors.mutedForeground}
        />
      </View>
      <Text style={[styles.sheetHint, { color: colors.mutedForeground }]}>Leave empty to remove your phone number.</Text>
      <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnText}>Save</Text>}
      </TouchableOpacity>
    </SheetShell>
  );
}

function PasswordSheet({ visible, onClose }: any) {
  const colors = useColors();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState("");
  useEffect(() => { if (visible) { setOldPw(""); setNewPw(""); setErr(""); } }, [visible]);

  const save = async () => {
    if (newPw.length < 6) { setErr("New password must be at least 6 characters"); return; }
    setBusy(true); setErr("");
    try {
      await authFetch("/api/auth/me/password", { method: "POST", body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }) });
      Alert.alert("Success", "Password updated");
      onClose();
    } catch (e: any) { setErr(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="Change password">
      {err !== "" && <Text style={styles.sheetErr}>{err}</Text>}
      <TextInput style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border }]}
        value={oldPw} onChangeText={setOldPw} secureTextEntry placeholder="Current password" placeholderTextColor={colors.mutedForeground} />
      <TextInput style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, marginTop: 10 }]}
        value={newPw} onChangeText={setNewPw} secureTextEntry placeholder="New password (6+ chars)" placeholderTextColor={colors.mutedForeground} />
      <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnText}>Update password</Text>}
      </TouchableOpacity>
    </SheetShell>
  );
}

function EmailSheet({ visible, user, onClose, onVerified }: any) {
  const colors = useColors();
  const [step, setStep]         = useState<"request" | "verify">("request");
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp]           = useState("");
  const [devOtp, setDevOtp]     = useState("");
  const [err, setErr]           = useState("");
  const [busy, setBusy]         = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      setStep(user?.pendingEmail ? "verify" : "request");
      setNewEmail(user?.pendingEmail ?? "");
      setPassword(""); setOtp(""); setErr(""); setDevOtp("");
    }
    return () => { if (cdRef.current) clearInterval(cdRef.current); };
  }, [visible, user?.pendingEmail]);

  const startCd = (s: number) => {
    setCooldown(s);
    if (cdRef.current) clearInterval(cdRef.current);
    cdRef.current = setInterval(() => setCooldown((x) => { if (x <= 1) { if (cdRef.current) clearInterval(cdRef.current); return 0; } return x - 1; }), 1000);
  };

  const sendOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim())) { setErr("Please enter a valid email"); return; }
    if (!password)                                            { setErr("Please confirm your current password"); return; }
    setBusy(true); setErr("");
    try {
      const data = await authFetch("/api/auth/me/email/change-request", {
        method: "POST",
        body: JSON.stringify({ newEmail: newEmail.trim(), password }),
      });
      setDevOtp(data?.devOtp ?? ""); setStep("verify"); startCd(60);
    } catch (e: any) { setErr(e?.message ?? "Failed to send code"); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    if (otp.length !== 6) { setErr("Enter the 6-digit code"); return; }
    setBusy(true); setErr("");
    try {
      const data = await authFetch("/api/auth/me/email/change-verify", { method: "POST", body: JSON.stringify({ otp: otp.trim() }) });
      await onVerified(data); onClose();
    } catch (e: any) { setErr(e?.message ?? "Verification failed"); }
    finally { setBusy(false); }
  };

  return (
    <SheetShell visible={visible} onClose={onClose} title="Change email">
      {err !== "" && <Text style={styles.sheetErr}>{err}</Text>}
      {step === "request" ? (
        <>
          <Text style={[styles.sheetHint, { color: colors.mutedForeground, marginBottom: 8 }]}>
            Current: <Text style={{ color: colors.foreground, fontWeight: "600" }}>{user?.email}</Text>
          </Text>
          <TextInput style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border }]}
            value={newEmail} onChangeText={setNewEmail} placeholder="new@example.com"
            placeholderTextColor={colors.mutedForeground} autoCapitalize="none" keyboardType="email-address" />
          <TextInput style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, marginTop: 10 }]}
            value={password} onChangeText={setPassword} secureTextEntry
            placeholder="Confirm current password" placeholderTextColor={colors.mutedForeground} />
          <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]} onPress={sendOtp} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnText}>Send verification code</Text>}
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.sheetHint, { color: colors.mutedForeground, marginBottom: 8 }]}>
            Code sent to <Text style={{ color: colors.foreground, fontWeight: "600" }}>{newEmail}</Text>
          </Text>
          {devOtp !== "" && __DEV__ && (
            <View style={styles.devBanner}><Text style={styles.devText}>🔧 Dev OTP: <Text style={{ fontWeight: "800" }}>{devOtp}</Text></Text></View>
          )}
          <TextInput style={[styles.otpInput, { color: colors.foreground, borderColor: colors.primary }]}
            value={otp} onChangeText={(v) => setOtp(v.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad" maxLength={6} placeholder="------"
            placeholderTextColor={colors.mutedForeground} textAlign="center" />
          <TouchableOpacity style={[styles.sheetBtn, { backgroundColor: colors.primary }, busy && { opacity: 0.6 }]} onPress={verify} disabled={busy || otp.length < 6}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.sheetBtnText}>Verify & change email</Text>}
          </TouchableOpacity>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <TouchableOpacity onPress={sendOtp} disabled={cooldown > 0 || busy}>
              <Text style={[{ color: colors.primary, fontWeight: "600" }, (cooldown > 0 || busy) && { opacity: 0.4 }]}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep("request")}>
              <Text style={{ color: colors.mutedForeground }}>Edit email</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SheetShell>
  );
}

const styles = StyleSheet.create({
  headerRow:     { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1 },
  screenTitle:   { fontSize: 22, fontWeight: "700" },
  avatarSection: { margin: 16, borderRadius: 20, padding: 24, alignItems: "center", gap: 8, borderWidth: 1 },
  avatar:        { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4, overflow: "hidden" },
  cameraBadge:   { position: "absolute", right: -2, bottom: 0, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  userName:      { fontSize: 20, fontWeight: "700" },
  userEmail:     { fontSize: 14 },
  pendingNote:   { fontSize: 11, marginTop: 4 },
  statsCard:     { marginHorizontal: 16, marginBottom: 16, borderRadius: 20, padding: 20, borderWidth: 1 },
  sectionTitle:  { fontSize: 16, fontWeight: "700", marginBottom: 14 },
  statsRow:      { flexDirection: "row", gap: 10 },
  statItem:      { flex: 1, borderRadius: 14, padding: 12, alignItems: "center", gap: 6 },
  statValue:     { fontSize: 15, fontWeight: "700", textAlign: "center" },
  statLabel:     { fontSize: 11, textAlign: "center" },
  sectionCard:   { marginHorizontal: 16, marginBottom: 16, borderRadius: 20, padding: 20, borderWidth: 1 },
  settingRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  settingLeft:   { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  settingLabel:  { fontSize: 15, fontWeight: "600" },
  settingSub:    { fontSize: 12, marginTop: 1 },
  settingValue:  { fontSize: 16, fontWeight: "700" },
  inlineInput:   { borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, fontSize: 14, width: 100, textAlign: "right" },
  divider:       { height: 1, marginVertical: 2 },
  logoutBtn:     { marginHorizontal: 16, marginBottom: 16, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1 },
  logoutText:    { fontWeight: "700", fontSize: 15 },
  // sheet
  sheetOverlay:  { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet:         { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 36 },
  sheetHeader:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sheetTitle:    { fontSize: 18, fontWeight: "700" },
  sheetInput:    { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  sheetHint:     { fontSize: 12, marginTop: 6 },
  sheetErr:      { color: "#B91C1C", fontSize: 13, marginBottom: 10, fontWeight: "500" },
  sheetBtn:      { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  sheetBtnText:  { color: "#fff", fontWeight: "700", fontSize: 15 },
  phonePrefix:   { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, paddingVertical: 12 },
  devBanner:     { backgroundColor: "#FFF7ED", borderRadius: 10, padding: 10, borderWidth: 1, borderColor: "#F59E0B", marginBottom: 10 },
  devText:       { color: "#92400E", fontSize: 13, textAlign: "center" },
  otpInput:      { backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 2, fontSize: 28, fontWeight: "900", letterSpacing: 10, paddingVertical: 14, marginTop: 4 },
});
