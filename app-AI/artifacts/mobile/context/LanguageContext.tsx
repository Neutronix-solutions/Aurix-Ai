import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { I18nManager, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Language = "en" | "ar";

const LANG_KEY = "aurixai_lang";

const translations = {
  en: {
    // Navigation
    dashboard:       "Dashboard",
    expenses:        "Expenses",
    portfolio:       "Portfolio",
    coach:           "AI Coach",
    profile:         "Profile",
    moneyPage:       "Money",
    finance:         "Finance",
    invest:          "Invest",
    // Common actions
    addExpense:      "Add Expense",
    addIncome:       "Add Income",
    add:             "Add",
    amount:          "Amount",
    category:        "Category",
    merchant:        "Merchant / Store",
    description:     "Description",
    date:            "Date",
    save:            "Save",
    cancel:          "Cancel",
    delete:          "Delete",
    edit:            "Edit",
    done:            "Done",
    confirm:         "Confirm",
    dismiss:         "Dismiss",
    loading:         "Loading...",
    noData:          "No data yet",
    seeAll:          "See All",
    refresh:         "Refresh",
    search:          "Search",
    // Money Page tabs
    transactions:    "Transactions",
    bills:           "Bills",
    currencyTab:     "Currency",
    // Transactions
    income:          "Income",
    incomeLabel:     "Income",
    source:          "Source",
    expense:         "Expense",
    totalSpent:      "Total Spent",
    totalIncome:     "Total Income",
    spentThisMonth:  "Spent This Month",
    savedThisMonth:  "Saved This Month",
    monthlyIncome:   "Monthly Income",
    thisMonth:       "This Month",
    originalCurrency:"Original Currency",
    displayCurrency: "Display Currency",
    convertedTo:     "converted to",
    rateAt:          "Rate at time",
    // Bills
    billsTitle:        "Bills & Subscriptions",
    recurringBills:    "Recurring Bills",
    monthlyRecurring:  "Monthly Recurring",
    addBill:           "Add Bill",
    editBill:          "Edit Bill",
    billName:          "Bill Name",
    frequency:         "Frequency",
    weekly:            "Weekly",
    monthly:           "Monthly",
    quarterly:         "Quarterly",
    annual:            "Annual",
    nextDue:           "Next Due",
    lastPaid:          "Last Paid",
    markPaid:          "Mark Paid",
    overdue:           "Overdue",
    dueToday:          "Due Today",
    upcoming:          "Upcoming",
    autoDetected:      "Auto-Detected",
    scanRecurring:     "Scan for Recurring",
    confidence:        "Confidence",
    occurrences:       "occurrences",
    totalBills:        "Total Bills",
    dueThisWeek:       "Due This Week",
    // Currency
    currencyTitle:     "Currency Converter",
    liveRates:         "Live FX Rates",
    baseCurrency:      "Base Currency",
    appCurrency:       "App Display Currency",
    from:              "From",
    to:                "To",
    swap:              "Swap",
    convert:           "Convert",
    lastUpdated:       "Last Updated",
    rateStrip:         "1 QAR equals",
    selectCurrency:    "Select Currency",
    // Financial overview
    savings:         "Savings",
    savingsRate:     "Savings Rate",
    score:           "Financial Score",
    streak:          "Day Streak",
    points:          "Points",
    level:           "Level",
    goals:           "Goals",
    budgets:         "Budgets",
    alerts:          "Alerts",
    settings:        "Settings",
    breakdown:       "Breakdown",
    // Auth
    logout:          "Logout",
    login:           "Login",
    register:        "Create Account",
    email:           "Email",
    password:        "Password",
    name:            "Full Name",
    welcome:         "Welcome to Aurix AI",
    tagline:         "Your AI Financial Coach",
    // Profile
    editProfile:     "Edit Profile",
    currency:        "Display Currency",
    language:        "Language",
    english:         "English",
    arabic:          "Arabic",
    // Portfolio
    portfolioValue:  "Portfolio Value",
    pnl:             "P&L",
    allocation:      "Allocation",
    addHolding:      "Add Holding",
    symbol:          "Symbol",
    holdingName:     "Name",
    type:            "Type",
    quantity:        "Quantity",
    buyPrice:        "Buy Price",
    currentPrice:    "Current Price",
    // AI Coach
    parseSms:        "Parse SMS",
    smsPlaceholder:  "Paste your bank SMS here...",
    parse:           "Parse",
    chatPlaceholder: "Ask your financial coach...",
    send:            "Send",
    newChat:         "New Chat",
    dailyAction:     "Today's Action",
    // Onboarding
    onboarding:      "Setup Your Profile",
    incomeQuestion:  "What is your monthly income?",
    languageLabel:   "Choose your language",
    continueBtn:     "Continue",
    // Misc
    qar:             "QAR",
    usd:             "USD",
    eur:             "EUR",
    gbp:             "GBP",
    aed:             "AED",
  },
  ar: {
    // Navigation
    dashboard:       "لوحة التحكم",
    expenses:        "المصروفات",
    portfolio:       "المحفظة",
    coach:           "المساعد الذكي",
    profile:         "الملف الشخصي",
    moneyPage:       "المال",
    finance:         "المالية",
    invest:          "الاستثمار",
    // Common actions
    addExpense:      "إضافة مصروف",
    addIncome:       "إضافة دخل",
    add:             "إضافة",
    amount:          "المبلغ",
    category:        "الفئة",
    merchant:        "التاجر / المتجر",
    description:     "الوصف",
    date:            "التاريخ",
    save:            "حفظ",
    cancel:          "إلغاء",
    delete:          "حذف",
    edit:            "تعديل",
    done:            "تم",
    confirm:         "تأكيد",
    dismiss:         "تجاهل",
    loading:         "جاري التحميل...",
    noData:          "لا توجد بيانات",
    seeAll:          "عرض الكل",
    refresh:         "تحديث",
    search:          "بحث",
    // Money Page tabs
    transactions:    "المعاملات",
    bills:           "الفواتير",
    currencyTab:     "العملات",
    // Transactions
    income:          "الدخل",
    incomeLabel:     "الدخل",
    source:          "المصدر",
    expense:         "مصروف",
    totalSpent:      "إجمالي الإنفاق",
    totalIncome:     "إجمالي الدخل",
    spentThisMonth:  "أنفقت هذا الشهر",
    savedThisMonth:  "وفّرت هذا الشهر",
    monthlyIncome:   "الدخل الشهري",
    thisMonth:       "هذا الشهر",
    originalCurrency:"العملة الأصلية",
    displayCurrency: "عملة العرض",
    convertedTo:     "محوّل إلى",
    rateAt:          "السعر وقت الإدخال",
    // Bills
    billsTitle:        "الفواتير والاشتراكات",
    recurringBills:    "الفواتير المتكررة",
    monthlyRecurring:  "الإجمالي الشهري المتكرر",
    addBill:           "إضافة فاتورة",
    editBill:          "تعديل الفاتورة",
    billName:          "اسم الفاتورة",
    frequency:         "التكرار",
    weekly:            "أسبوعي",
    monthly:           "شهري",
    quarterly:         "ربع سنوي",
    annual:            "سنوي",
    nextDue:           "الاستحقاق القادم",
    lastPaid:          "آخر دفعة",
    markPaid:          "تحديد كمدفوع",
    overdue:           "متأخر",
    dueToday:          "مستحق اليوم",
    upcoming:          "القادم",
    autoDetected:      "مكتشف تلقائياً",
    scanRecurring:     "مسح للمدفوعات المتكررة",
    confidence:        "الثقة",
    occurrences:       "مرة",
    totalBills:        "إجمالي الفواتير",
    dueThisWeek:       "مستحق هذا الأسبوع",
    // Currency
    currencyTitle:     "محوّل العملات",
    liveRates:         "أسعار الصرف المباشرة",
    baseCurrency:      "العملة الأساسية",
    appCurrency:       "عملة العرض في التطبيق",
    from:              "من",
    to:                "إلى",
    swap:              "تبديل",
    convert:           "تحويل",
    lastUpdated:       "آخر تحديث",
    rateStrip:         "1 ريال قطري يساوي",
    selectCurrency:    "اختر العملة",
    // Financial overview
    savings:         "المدخرات",
    savingsRate:     "نسبة الادخار",
    score:           "النقاط المالية",
    streak:          "أيام متتالية",
    points:          "النقاط",
    level:           "المستوى",
    goals:           "الأهداف",
    budgets:         "الميزانيات",
    alerts:          "التنبيهات",
    settings:        "الإعدادات",
    breakdown:       "التفاصيل",
    // Auth
    logout:          "تسجيل الخروج",
    login:           "تسجيل الدخول",
    register:        "إنشاء حساب",
    email:           "البريد الإلكتروني",
    password:        "كلمة المرور",
    name:            "الاسم الكامل",
    welcome:         "مرحباً بك في Aurix AI",
    tagline:         "مساعدك المالي الذكي",
    // Profile
    editProfile:     "تعديل الملف",
    currency:        "عملة العرض",
    language:        "اللغة",
    english:         "الإنجليزية",
    arabic:          "العربية",
    // Portfolio
    portfolioValue:  "قيمة المحفظة",
    pnl:             "الربح والخسارة",
    allocation:      "التوزيع",
    addHolding:      "إضافة أصل",
    symbol:          "الرمز",
    holdingName:     "الاسم",
    type:            "النوع",
    quantity:        "الكمية",
    buyPrice:        "سعر الشراء",
    currentPrice:    "السعر الحالي",
    // AI Coach
    parseSms:        "تحليل الرسالة",
    smsPlaceholder:  "الصق رسالة البنك هنا...",
    parse:           "تحليل",
    chatPlaceholder: "اسأل مساعدك المالي...",
    send:            "إرسال",
    newChat:         "محادثة جديدة",
    dailyAction:     "نصيحة اليوم",
    // Onboarding
    onboarding:      "إعداد ملفك الشخصي",
    incomeQuestion:  "ما هو دخلك الشهري؟",
    languageLabel:   "اختر لغتك",
    continueBtn:     "متابعة",
    // Misc
    qar:             "ريال قطري",
    usd:             "دولار أمريكي",
    eur:             "يورو",
    gbp:             "جنيه إسترليني",
    aed:             "درهم إماراتي",
  },
};

export type Translations = typeof translations["en"];

interface LanguageContextValue {
  language: Language;
  t: Translations;
  isRTL: boolean;
  setLanguage: (lang: Language) => void;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<Language>("en");

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then(stored => {
      if (stored === "ar" || stored === "en") setLang(stored);
    });
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLang(lang);
    AsyncStorage.setItem(LANG_KEY, lang);
    // RTL layout requires a full app restart on both iOS and Android.
    // We apply the flag now so it takes effect on the next launch.
    const shouldBeRTL = lang === "ar";
    if (I18nManager.isRTL !== shouldBeRTL) {
      I18nManager.allowRTL(shouldBeRTL);
      I18nManager.forceRTL(shouldBeRTL);
      Alert.alert(
        "Restart Required",
        "Please close and reopen the app to apply the new layout direction.",
        [{ text: "OK" }],
      );
    }
  }, []);

  const isRTL = language === "ar";

  return (
    <LanguageContext.Provider value={{ language, t: translations[language], isRTL, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used within LanguageProvider");
  return ctx;
}
