import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { useUpdateUserSettings } from "@workspace/api-client-react";
import { useAuth } from "@/context/AuthContext";
import { useLang } from "@/context/LanguageContext";
import C from "@/constants/colors";

const c = C.light;

export default function OnboardingScreen() {
  const { t, setLanguage, isRTL } = useLang();
  const { updateUser } = useAuth();
  const [income, setIncome] = useState("");
  const [selectedLang, setSelectedLang] = useState<"en" | "ar">("en");

  const update = useUpdateUserSettings({
    mutation: {
      onSuccess: (data) => {
        setLanguage(selectedLang);
        updateUser(data as any);
        router.replace("/(tabs)/dashboard");
      },
    },
  });

  const handleContinue = () => {
    const incomeNum = parseFloat(income);
    update.mutate({
      data: { monthlyIncome: isNaN(incomeNum) ? 0 : incomeNum, language: selectedLang },
    });
  };

  return (
    <View style={styles.root}>
      <Text style={styles.emoji}>🚀</Text>
      <Text style={[styles.title, isRTL && styles.rtl]}>{t.onboarding}</Text>
      <Text style={[styles.sub, isRTL && styles.rtl]}>Let's personalise your financial journey</Text>

      <View style={styles.section}>
        <Text style={[styles.label, isRTL && styles.rtl]}>{t.languageLabel}</Text>
        <View style={styles.langRow}>
          {(["en", "ar"] as const).map(lang => (
            <TouchableOpacity
              key={lang}
              style={[styles.langBtn, selectedLang === lang && styles.langBtnActive]}
              onPress={() => setSelectedLang(lang)}
            >
              <Text style={[styles.langBtnText, selectedLang === lang && styles.langBtnTextActive]}>
                {lang === "en" ? "🇬🇧 English" : "🇶🇦 العربية"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, isRTL && styles.rtl]}>{t.incomeLabel}</Text>
        <View style={styles.incomeRow}>
          <Text style={styles.currencyBadge}>QAR</Text>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={income}
            onChangeText={setIncome}
            keyboardType="numeric"
            placeholderTextColor={c.mutedForeground}
            placeholder="15000"
          />
        </View>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleContinue} disabled={update.isPending}>
        {update.isPending ? (
          <ActivityIndicator color={c.primaryForeground} />
        ) : (
          <Text style={styles.buttonText}>{t.continueBtn} →</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background, padding: 32, justifyContent: "center" },
  emoji: { fontSize: 64, textAlign: "center", marginBottom: 16 },
  title: { fontSize: 26, fontWeight: "700", color: c.foreground, textAlign: "center", marginBottom: 8 },
  sub: { fontSize: 14, color: c.mutedForeground, textAlign: "center", marginBottom: 40 },
  rtl: { textAlign: "right" },
  section: { marginBottom: 28 },
  label: { fontSize: 14, color: c.mutedForeground, fontWeight: "600", marginBottom: 10 },
  langRow: { flexDirection: "row", gap: 12 },
  langBtn: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: "center" },
  langBtnActive: { borderColor: c.primary, backgroundColor: c.accent },
  langBtnText: { color: c.mutedForeground, fontWeight: "600" },
  langBtnTextActive: { color: c.primary },
  incomeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  currencyBadge: { backgroundColor: c.accent, color: c.primary, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, fontWeight: "700", fontSize: 14 },
  input: { backgroundColor: c.input, borderRadius: 10, borderWidth: 1, borderColor: c.border, color: c.foreground, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 16 },
  buttonText: { color: c.primaryForeground, fontWeight: "700", fontSize: 17 },
});
