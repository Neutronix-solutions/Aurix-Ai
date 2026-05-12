import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Modal, TextInput, ActivityIndicator, Alert, RefreshControl,
  Platform, KeyboardAvoidingView, Switch,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColors } from "@/hooks/useColors";

const API_BASE =
  process.env["EXPO_PUBLIC_API_BASE"] ??
  (process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "");

async function authFetch(path: string, opts: RequestInit = {}) {
  const token = await AsyncStorage.getItem("aurixai_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

type Frequency = "weekly" | "monthly" | "quarterly" | "annual";

type Bill = {
  id: number; name: string; merchantName?: string; amount: number;
  frequency: Frequency; category: string; icon: string; color: string;
  lastPaid?: string; nextDue?: string; isActive: boolean;
  isAutoDetected: boolean; isConfirmed: boolean; notes?: string;
};

type Summary = {
  monthlyTotal: number; totalBills: number;
  dueThisWeek: number; dueThisMonth: number; overdueCount: number;
  upcoming: Bill[];
};

type Detected = {
  name: string; merchantName: string; amount: number; frequency: string;
  category: string; icon: string; color: string; lastPaid: string;
  nextDue: string; confidence: number; occurrences: number;
};

const FREQ_LABELS: Record<string, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };
const FREQ_OPTIONS: Frequency[] = ["weekly", "monthly", "quarterly", "annual"];

function daysUntil(dateStr?: string): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function DueBadge({ days, colors }: { days: number | null; colors: any }) {
  if (days === null) return null;
  if (days < 0)  return <View style={[styles.dueBadge, { backgroundColor: colors.danger  + "20" }]}><Text style={[styles.dueBadgeText, { color: colors.danger  }]}>Overdue</Text></View>;
  if (days === 0) return <View style={[styles.dueBadge, { backgroundColor: colors.danger  + "20" }]}><Text style={[styles.dueBadgeText, { color: colors.danger  }]}>Today</Text></View>;
  if (days <= 3)  return <View style={[styles.dueBadge, { backgroundColor: colors.warning + "20" }]}><Text style={[styles.dueBadgeText, { color: colors.warning }]}>In {days}d</Text></View>;
  if (days <= 7)  return <View style={[styles.dueBadge, { backgroundColor: colors.primary + "20" }]}><Text style={[styles.dueBadgeText, { color: colors.primary }]}>In {days}d</Text></View>;
  return <View style={[styles.dueBadge, { backgroundColor: colors.accent }]}><Text style={[styles.dueBadgeText, { color: colors.mutedForeground }]}>{formatDate(undefined)}</Text></View>;
}

function BillCard({ bill, onPaid, onEdit, onDelete, colors }: {
  bill: Bill; onPaid: () => void; onEdit: () => void; onDelete: () => void; colors: any;
}) {
  const days = daysUntil(bill.nextDue);
  const isOverdue = days !== null && days < 0;
  const isDueSoon = days !== null && days >= 0 && days <= 3;
  const borderColor = isOverdue ? colors.danger : isDueSoon ? colors.warning : colors.border;

  return (
    <View style={[styles.billCard, { backgroundColor: colors.card, borderColor }]}>
      <View style={[styles.billIconWrap, { backgroundColor: bill.color + "18" }]}>
        <Text style={{ fontSize: 22 }}>{bill.icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.billName, { color: colors.foreground }]} numberOfLines={1}>{bill.name}</Text>
          {isOverdue && <View style={[styles.overdotBadge, { backgroundColor: colors.danger }]} />}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 }}>
          <Text style={[styles.billMeta, { color: colors.mutedForeground }]}>{FREQ_LABELS[bill.frequency]}</Text>
          <Text style={[styles.billDot, { color: colors.border }]}>·</Text>
          <Text style={[styles.billMeta, { color: colors.mutedForeground }]}>Due {formatDate(bill.nextDue)}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Text style={[styles.billAmt, { color: bill.color }]}>QAR {bill.amount.toFixed(0)}</Text>
        {days !== null && (
          <Text style={[styles.daysText, { color: isOverdue ? colors.danger : days <= 3 ? colors.warning : colors.mutedForeground }]}>
            {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today!" : `${days}d left`}
          </Text>
        )}
      </View>
      <View style={styles.billActions}>
        <TouchableOpacity style={[styles.billIconBtn, { backgroundColor: colors.success + "15" }]} onPress={onPaid}>
          <Feather name="check" size={13} color={colors.success} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.billIconBtn, { backgroundColor: colors.accent }]} onPress={onEdit}>
          <Feather name="edit-2" size={13} color={colors.mutedForeground} />
        </TouchableOpacity>
        <TouchableOpacity style={[styles.billIconBtn, { backgroundColor: colors.danger + "15" }]} onPress={onDelete}>
          <Feather name="trash-2" size={13} color={colors.danger} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DetectedCard({ item, onAdd, onDismiss, colors }: {
  item: Detected; onAdd: () => void; onDismiss: () => void; colors: any;
}) {
  const confColor = item.confidence >= 80 ? colors.success : item.confidence >= 60 ? colors.warning : colors.mutedForeground;
  return (
    <View style={[styles.detectedCard, { backgroundColor: colors.card, borderColor: colors.primary + "30" }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
        <View style={[styles.detIconWrap, { backgroundColor: item.color + "18" }]}>
          <Text style={{ fontSize: 20 }}>{item.icon}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.detName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
          <Text style={[styles.detMeta, { color: colors.mutedForeground }]}>
            QAR {item.amount.toFixed(0)} · {FREQ_LABELS[item.frequency] ?? item.frequency} · {item.occurrences}× found
          </Text>
          <View style={[styles.confBar, { backgroundColor: colors.accent }]}>
            <View style={[styles.confFill, { width: `${item.confidence}%`, backgroundColor: confColor }]} />
          </View>
          <Text style={[styles.confText, { color: confColor }]}>{item.confidence}% confidence</Text>
        </View>
      </View>
      <View style={styles.detBtns}>
        <TouchableOpacity style={[styles.detAddBtn, { backgroundColor: colors.primary }]} onPress={onAdd}>
          <Feather name="plus" size={13} color={colors.primaryForeground} />
          <Text style={[styles.detAddBtnText, { color: colors.primaryForeground }]}>Add</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDismiss} style={styles.detDismissBtn}>
          <Feather name="x" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function UpcomingTimeline({ bills, colors }: { bills: Bill[]; colors: any }) {
  if (bills.length === 0) return null;
  return (
    <View style={[styles.timelineCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Upcoming Payments</Text>
      {bills.slice(0, 6).map((b, i) => {
        const days = daysUntil(b.nextDue);
        const isOverdue = days !== null && days < 0;
        const barColor = isOverdue ? colors.danger : days !== null && days <= 3 ? colors.warning : b.color;
        return (
          <View key={b.id} style={styles.timelineRow}>
            <View style={[styles.timelineDot, { backgroundColor: barColor }]} />
            {i < bills.length - 1 && <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />}
            <View style={[styles.timelineContent, { borderBottomColor: colors.border }]}>
              <Text style={{ fontSize: 18 }}>{b.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.timelineName, { color: colors.foreground }]}>{b.name}</Text>
                <Text style={[styles.timelineDate, { color: colors.mutedForeground }]}>{formatDate(b.nextDue)}</Text>
              </View>
              <Text style={[styles.timelineAmt, { color: barColor }]}>QAR {b.amount.toFixed(0)}</Text>
              {days !== null && <DueBadge days={days} colors={colors} />}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DEFAULT_FORM = { name: "", amount: "", frequency: "monthly" as Frequency, category: "", notes: "", nextDue: "" };

export default function BillTracker() {
  const colors = useColors();
  const [bills,    setBills]    = useState<Bill[]>([]);
  const [summary,  setSummary]  = useState<Summary | null>(null);
  const [detected, setDetected] = useState<Detected[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [scanning, setScanning] = useState(false);
  const [showAdd,  setShowAdd]  = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const [form,     setForm]     = useState(DEFAULT_FORM);
  const [saving,   setSaving]   = useState(false);
  const [showDetected, setShowDetected] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [billsData, sumData] = await Promise.all([
        authFetch("/api/bills"),
        authFetch("/api/bills/summary"),
      ]);
      setBills(billsData as Bill[]);
      setSummary(sumData as Summary);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const scanDetections = useCallback(async () => {
    setScanning(true);
    try {
      const data = await authFetch("/api/bills/detect");
      setDetected((data as any).detected ?? []);
    } catch { /* ignore */ }
    finally { setScanning(false); }
  }, []);

  useEffect(() => { loadAll(); scanDetections(); }, []);

  const openAdd = useCallback(() => {
    setEditBill(null);
    setForm(DEFAULT_FORM);
    setShowAdd(true);
  }, []);

  const openEdit = useCallback((bill: Bill) => {
    setEditBill(bill);
    setForm({
      name: bill.name, amount: String(bill.amount),
      frequency: bill.frequency, category: bill.category,
      notes: bill.notes ?? "",
      nextDue: bill.nextDue ? new Date(bill.nextDue).toISOString().slice(0, 10) : "",
    });
    setShowAdd(true);
  }, []);

  const handleSave = useCallback(async () => {
    const amt = parseFloat(form.amount);
    if (!form.name || isNaN(amt) || amt <= 0) { Alert.alert("Error", "Name and valid amount required"); return; }
    setSaving(true);
    try {
      const body = { name: form.name, amount: amt, frequency: form.frequency, category: form.category || form.name, notes: form.notes || undefined, ...(form.nextDue ? { nextDue: form.nextDue } : {}) };
      if (editBill) {
        await authFetch(`/api/bills/${editBill.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        await authFetch("/api/bills", { method: "POST", body: JSON.stringify({ ...body, isConfirmed: true }) });
      }
      setShowAdd(false);
      loadAll();
    } catch (e: any) { Alert.alert("Error", "Could not save"); }
    finally { setSaving(false); }
  }, [form, editBill]);

  const handleDelete = useCallback((id: number) => {
    Alert.alert("Delete Bill", "Remove this bill?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await authFetch(`/api/bills/${id}`, { method: "DELETE" }); loadAll(); }
        catch { Alert.alert("Error", "Could not delete"); }
      }},
    ]);
  }, []);

  const handlePaid = useCallback(async (id: number) => {
    try { await authFetch(`/api/bills/${id}/paid`, { method: "POST" }); loadAll(); }
    catch { Alert.alert("Error", "Could not mark as paid"); }
  }, []);

  const handleAddDetected = useCallback(async (item: Detected) => {
    try {
      await authFetch("/api/bills", { method: "POST", body: JSON.stringify({
        name: item.name, merchantName: item.merchantName, amount: item.amount,
        frequency: item.frequency, category: item.category, icon: item.icon, color: item.color,
        lastPaid: item.lastPaid, nextDue: item.nextDue, isAutoDetected: true, isConfirmed: true,
      })});
      setDetected(prev => prev.filter(d => d.merchantName !== item.merchantName));
      loadAll();
    } catch { Alert.alert("Error", "Could not add"); }
  }, []);

  const overdueBills   = bills.filter(b => { const d = daysUntil(b.nextDue); return d !== null && d < 0; });
  const dueSoonBills   = bills.filter(b => { const d = daysUntil(b.nextDue); return d !== null && d >= 0 && d <= 7; });
  const upcomingBills  = bills.filter(b => { const d = daysUntil(b.nextDue); return d !== null && d >= 0 && d <= 30; }).sort((a, b2) => new Date(a.nextDue!).getTime() - new Date(b2.nextDue!).getTime());
  const regularBills   = bills.filter(b => { const d = daysUntil(b.nextDue); return d === null || d > 30; });

  if (loading) {
    return <View style={[styles.center, { backgroundColor: "transparent" }]}><ActivityIndicator color={colors.primary} size="large" /><Text style={[styles.loadText, { color: colors.mutedForeground }]}>Loading bills…</Text></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 110 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => { loadAll(); scanDetections(); }} tintColor={colors.primary} />}
      >

        {/* Summary header */}
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sumRow}>
            <View>
              <Text style={[styles.sumLabel, { color: colors.mutedForeground }]}>Monthly Recurring</Text>
              <Text style={[styles.sumTotal, { color: colors.primary }]}>QAR {(summary?.monthlyTotal ?? 0).toLocaleString("en", { maximumFractionDigits: 0 })}</Text>
            </View>
            <TouchableOpacity style={[styles.addBillBtn, { backgroundColor: colors.primary }]} onPress={openAdd}>
              <Feather name="plus" size={16} color={colors.primaryForeground} />
              <Text style={[styles.addBillBtnText, { color: colors.primaryForeground }]}>Add Bill</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statChips}>
            {[
              { label: "Bills",        val: summary?.totalBills  ?? 0, icon: "list",           color: colors.primary },
              { label: "Due this week",val: summary?.dueThisWeek ?? 0, icon: "calendar",       color: (summary?.dueThisWeek ?? 0) > 0 ? colors.warning : colors.mutedForeground },
              { label: "Overdue",      val: summary?.overdueCount ?? 0, icon: "alert-triangle", color: (summary?.overdueCount ?? 0) > 0 ? colors.danger : colors.mutedForeground },
            ].map(s => (
              <View key={s.label} style={[styles.statChip, { backgroundColor: s.color + "12" }]}>
                <Feather name={s.icon as any} size={12} color={s.color} />
                <Text style={[styles.statChipVal, { color: s.color }]}>{s.val}</Text>
                <Text style={[styles.statChipLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Auto-detected banner */}
        {detected.length > 0 && showDetected && (
          <View style={[styles.detSection, { backgroundColor: colors.primary + "08", borderColor: colors.primary + "25" }]}>
            <View style={styles.detHeader}>
              <View style={styles.detHeaderLeft}>
                <View style={[styles.detIconMini, { backgroundColor: colors.primary + "20" }]}>
                  <Feather name="zap" size={14} color={colors.primary} />
                </View>
                <View>
                  <Text style={[styles.detTitle, { color: colors.foreground }]}>
                    {scanning ? "Scanning…" : `${detected.length} Recurring Pattern${detected.length !== 1 ? "s" : ""} Found`}
                  </Text>
                  <Text style={[styles.detSub, { color: colors.mutedForeground }]}>Auto-detected from your transaction history</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setShowDetected(false)}>
                <Feather name="x" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            {scanning
              ? <ActivityIndicator color={colors.primary} size="small" />
              : detected.slice(0, 5).map(item => (
                  <DetectedCard key={item.merchantName} item={item} colors={colors}
                    onAdd={() => handleAddDetected(item)}
                    onDismiss={() => setDetected(prev => prev.filter(d => d.merchantName !== item.merchantName))}
                  />
                ))
            }
            {detected.length > 5 && (
              <Text style={[styles.moreDet, { color: colors.primary }]}>+{detected.length - 5} more detected</Text>
            )}
          </View>
        )}

        {/* Overdue */}
        {overdueBills.length > 0 && (
          <View style={[styles.urgentSection, { backgroundColor: colors.danger + "08", borderColor: colors.danger + "25" }]}>
            <View style={styles.urgentHeader}>
              <Feather name="alert-triangle" size={15} color={colors.danger} />
              <Text style={[styles.urgentTitle, { color: colors.danger }]}>{overdueBills.length} Overdue Payment{overdueBills.length > 1 ? "s" : ""}</Text>
            </View>
            <View style={{ gap: 8 }}>
              {overdueBills.map(b => (
                <BillCard key={b.id} bill={b} colors={colors}
                  onPaid={() => handlePaid(b.id)} onEdit={() => openEdit(b)} onDelete={() => handleDelete(b.id)} />
              ))}
            </View>
          </View>
        )}

        {/* Upcoming timeline */}
        {upcomingBills.length > 0 && <UpcomingTimeline bills={upcomingBills} colors={colors} />}

        {/* All bills */}
        {bills.length > 0 ? (
          <View style={[styles.allBillsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.allBillsHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>All Bills & Subscriptions</Text>
              <Text style={[styles.billCount, { color: colors.mutedForeground }]}>{bills.length}</Text>
            </View>
            {bills.map(b => (
              <BillCard key={b.id} bill={b} colors={colors}
                onPaid={() => handlePaid(b.id)} onEdit={() => openEdit(b)} onDelete={() => handleDelete(b.id)} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 48 }}>📋</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No bills tracked yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Add a bill manually or tap "Scan" to auto-detect recurring payments from your history.
            </Text>
            <TouchableOpacity style={[styles.emptyBtn, { backgroundColor: colors.primary }]} onPress={openAdd}>
              <Feather name="plus" size={16} color={colors.primaryForeground} />
              <Text style={[styles.emptyBtnText, { color: colors.primaryForeground }]}>Add First Bill</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Re-scan button */}
        <TouchableOpacity
          style={[styles.rescanBtn, { backgroundColor: colors.accent, borderColor: colors.primary + "30" }]}
          onPress={scanDetections} disabled={scanning}
        >
          <Feather name="search" size={14} color={colors.primary} />
          <Text style={[styles.rescanText, { color: colors.primary }]}>
            {scanning ? "Scanning transactions…" : "Re-scan for Recurring Payments"}
          </Text>
          {scanning && <ActivityIndicator size="small" color={colors.primary} />}
        </TouchableOpacity>

      </ScrollView>

      {/* Add/Edit modal */}
      <Modal visible={showAdd} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
          <View style={[styles.modalOverlay, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <ScrollView style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.border }]} keyboardShouldPersistTaps="handled">
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>{editBill ? "Edit Bill" : "Add Bill"}</Text>
                <TouchableOpacity onPress={() => setShowAdd(false)}><Feather name="x" size={22} color={colors.mutedForeground} /></TouchableOpacity>
              </View>
              {[
                { label: "Name / Service", key: "name", ph: "Netflix, Rent, Phone…", kb: "default" as const },
                { label: "Amount (QAR)",   key: "amount", ph: "0.00",              kb: "numeric" as const },
                { label: "Category",       key: "category", ph: "Streaming, Housing…", kb: "default" as const },
                { label: "Next Due Date",  key: "nextDue", ph: "YYYY-MM-DD",       kb: "default" as const },
                { label: "Notes (optional)", key: "notes", ph: "Any notes…",       kb: "default" as const },
              ].map(f => (
                <View key={f.key} style={{ marginBottom: 12 }}>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{f.label}</Text>
                  <TextInput
                    style={[styles.input, { backgroundColor: colors.accent, borderColor: colors.border, color: colors.foreground }]}
                    value={(form as any)[f.key]} onChangeText={v => setForm(prev => ({ ...prev, [f.key]: v }))}
                    keyboardType={f.kb} placeholder={f.ph} placeholderTextColor={colors.mutedForeground}
                  />
                </View>
              ))}
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Frequency</Text>
              <View style={styles.freqRow}>
                {FREQ_OPTIONS.map(f => (
                  <TouchableOpacity key={f}
                    style={[styles.freqChip, { backgroundColor: form.frequency === f ? colors.primary : colors.accent, borderColor: form.frequency === f ? colors.primary : colors.border }]}
                    onPress={() => setForm(prev => ({ ...prev, frequency: f }))}
                  >
                    <Text style={[styles.freqChipText, { color: form.frequency === f ? colors.primaryForeground : colors.mutedForeground }]}>{FREQ_LABELS[f]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.primary, marginTop: 20 }]}
                onPress={handleSave} disabled={saving}
              >
                {saving ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>{editBill ? "Save Changes" : "Add Bill"}</Text>}
              </TouchableOpacity>
              <View style={{ height: 40 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  loadText: { fontSize: 14, marginTop: 8 },
  summaryCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 14 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  sumLabel: { fontSize: 12, fontWeight: "500" },
  sumTotal: { fontSize: 30, fontWeight: "900", marginTop: 4 },
  addBillBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
  addBillBtnText: { fontWeight: "700", fontSize: 13 },
  statChips: { flexDirection: "row", gap: 8 },
  statChip: { flex: 1, borderRadius: 12, padding: 10, gap: 3, alignItems: "center" },
  statChipVal: { fontSize: 18, fontWeight: "800" },
  statChipLabel: { fontSize: 10, textAlign: "center" },
  detSection: { borderRadius: 20, padding: 16, borderWidth: 1, gap: 10 },
  detHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  detHeaderLeft: { flexDirection: "row", alignItems: "flex-start", gap: 10, flex: 1 },
  detIconMini: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  detTitle: { fontSize: 14, fontWeight: "700" },
  detSub: { fontSize: 11, marginTop: 2 },
  detectedCard: { borderRadius: 14, padding: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  detIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  detName: { fontSize: 13, fontWeight: "700" },
  detMeta: { fontSize: 11, marginTop: 2 },
  confBar: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6 },
  confFill: { height: "100%", borderRadius: 2 },
  confText: { fontSize: 10, fontWeight: "600", marginTop: 3 },
  detBtns: { gap: 6, alignItems: "center" },
  detAddBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  detAddBtnText: { fontSize: 12, fontWeight: "700" },
  detDismissBtn: { padding: 4 },
  moreDet: { textAlign: "center", fontSize: 12, fontWeight: "600", marginTop: 4 },
  urgentSection: { borderRadius: 20, padding: 16, borderWidth: 1, gap: 10 },
  urgentHeader: { flexDirection: "row", alignItems: "center", gap: 7 },
  urgentTitle: { fontSize: 14, fontWeight: "700" },
  timelineCard: { borderRadius: 20, padding: 18, borderWidth: 1, gap: 0 },
  sectionTitle: { fontSize: 15, fontWeight: "700", marginBottom: 14 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start" },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 14, marginRight: 10, flexShrink: 0 },
  timelineLine: { position: "absolute", left: 5, top: 26, bottom: -14, width: 2 },
  timelineContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 14, borderBottomWidth: 1 },
  timelineName: { fontSize: 13, fontWeight: "600" },
  timelineDate: { fontSize: 11, marginTop: 2 },
  timelineAmt: { fontSize: 14, fontWeight: "700" },
  billCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, borderWidth: 1.5, gap: 10, marginBottom: 8 },
  billIconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  billName: { fontSize: 14, fontWeight: "700" },
  overdotBadge: { width: 7, height: 7, borderRadius: 4 },
  billMeta: { fontSize: 11 },
  billDot: { fontSize: 11 },
  billAmt: { fontSize: 15, fontWeight: "800" },
  daysText: { fontSize: 10, fontWeight: "600" },
  billActions: { gap: 4 },
  billIconBtn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  dueBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  dueBadgeText: { fontSize: 10, fontWeight: "700" },
  allBillsCard: { borderRadius: 20, padding: 18, borderWidth: 1 },
  allBillsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  billCount: { fontSize: 13, fontWeight: "700" },
  emptyState: { alignItems: "center", padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, marginTop: 4 },
  emptyBtnText: { fontWeight: "700", fontSize: 14 },
  rescanBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: 13, borderWidth: 1 },
  rescanText: { fontWeight: "600", fontSize: 13 },
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modal: { borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderWidth: 1, borderBottomWidth: 0, maxHeight: "92%" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 20, fontWeight: "800" },
  fieldLabel: { fontSize: 13, fontWeight: "500", marginBottom: 6 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  freqRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  freqChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  freqChipText: { fontSize: 13, fontWeight: "600" },
  saveBtn: { borderRadius: 14, paddingVertical: 15, alignItems: "center" },
  saveBtnText: { fontWeight: "700", fontSize: 16 },
});
