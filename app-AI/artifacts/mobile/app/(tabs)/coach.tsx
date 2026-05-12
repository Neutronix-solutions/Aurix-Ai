import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform, Animated,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useTabBarPadding } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import { useLang } from "@/context/LanguageContext";
import { useColors } from "@/hooks/useColors";
import { authFetchRaw } from "@/lib/authFetch";

// Dynamically computed inside the component using useSafeAreaInsets
const BASE_TAB_HEIGHT = 50;

type Msg = { id: number; role: "user" | "assistant"; content: string; streaming?: boolean };
type Conv = { id: number; title: string; createdAt: string };

function Cursor({ colors }: { colors: ReturnType<typeof useColors> }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return <Animated.Text style={{ opacity, color: colors.primary, fontSize: 16 }}>▌</Animated.Text>;
}

function MessageBubble({ msg, colors }: { msg: Msg; colors: ReturnType<typeof useColors> }) {
  const isUser = msg.role === "user";
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAI]}>
      {!isUser && (
        <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
          <Text style={{ fontSize: 16 }}>🤖</Text>
        </View>
      )}
      <View style={[
        styles.bubble,
        isUser
          ? { backgroundColor: colors.primary }
          : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
      ]}>
        <Text style={[styles.bubbleText, { color: isUser ? "#fff" : colors.foreground }]}>
          {msg.content}
        </Text>
        {msg.streaming && !isUser && <Cursor colors={colors} />}
      </View>
    </View>
  );
}

function ThinkingBubble({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [frame, setFrame] = useState(0);
  const frames = ["thinking .", "thinking ..", "thinking ..."];
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % 3), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <View style={[styles.bubbleRowAI, { marginBottom: 4 }]}>
      <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
        <Text style={{ fontSize: 16 }}>🤖</Text>
      </View>
      <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 13, fontStyle: "italic" }}>
          {frames[frame]}
        </Text>
      </View>
    </View>
  );
}

const STARTERS = [
  { icon: "📉", q: "How can I cut my monthly expenses?" },
  { icon: "📈", q: "Should I invest in gold or stocks?" },
  { icon: "💰", q: "How do I improve my savings rate?" },
  { icon: "🍽️", q: "What's a good food budget in Qatar?" },
  { icon: "🏠", q: "Tips for saving for a house in Doha?" },
  { icon: "💳", q: "How do I get out of debt faster?" },
];

export default function CoachScreen() {
  const colors = useColors();
  const { t } = useLang();
  const insets = useSafeAreaInsets();
  const TAB_BAR_HEIGHT = BASE_TAB_HEIGHT + insets.bottom;
  const tabBarPadding = useTabBarPadding();
  const flatRef = useRef<FlatList>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [convList, setConvList]               = useState<Conv[]>([]);
  const [convsLoading, setConvsLoading]       = useState(false);
  const [activeConvId, setActiveConvId]       = useState<number | null>(null);
  const [activeConvTitle, setActiveConvTitle] = useState("");
  const [messages, setMessages]               = useState<Msg[]>([]);
  const [inputText, setInputText]             = useState("");
  const [isSending, setIsSending]             = useState(false);
  const [isThinking, setIsThinking]           = useState(false);
  const [creating, setCreating]               = useState(false);
  const [error, setError]                     = useState("");

  const scrollToBottom = useCallback(() => {
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 80);
  }, []);

  const loadConversations = useCallback(async () => {
    setConvsLoading(true);
    try {
      const res = await authFetchRaw("/api/openai/conversations");
      if (res.ok) {
        const data = await res.json();
        setConvList(Array.isArray(data) ? data : []);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[coach] loadConversations non-OK status:", res.status);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[coach] loadConversations failed:", err);
    } finally { setConvsLoading(false); }
  }, []);

  const loadMessages = useCallback(async (convId: number) => {
    try {
      const res = await authFetchRaw(`/api/openai/conversations/${convId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      } else {
        // eslint-disable-next-line no-console
        console.warn("[coach] loadMessages non-OK status:", res.status);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[coach] loadMessages failed:", err);
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => { if (messages.length > 0) scrollToBottom(); }, [messages.length, scrollToBottom]);

  // ── Core streaming send ────────────────────────────────────────────────────
  const streamMessage = useCallback(async (convId: number, text: string) => {
    if (!text.trim() || isSending) return;
    const content = text.trim();
    setInputText("");
    setIsSending(true);
    setIsThinking(true);
    setError("");

    const userMsg: Msg = { id: Date.now(), role: "user", content };
    setMessages(prev => [...prev, userMsg]);
    scrollToBottom();

    const controller = new AbortController();
    abortRef.current = controller;
    const streamId = Date.now() + 1;

    // Auto-abort after 60 seconds to prevent the UI from hanging forever
    const timeoutId = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort();
    }, 60_000);

    try {
      const response = await authFetchRaw(`/api/openai/conversations/${convId}/messages/stream`, {
        method: "POST",
        body: JSON.stringify({ content }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        let errMsg = `HTTP ${response.status}`;
        try { errMsg = JSON.parse(errText)?.error ?? errMsg; } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[coach] non-JSON error body:", errText.slice(0, 200), e);
        }
        throw new Error(errMsg);
      }

      // ── Streaming path (web / modern environments) ─────────────────────
      if (response.body) {
        setIsThinking(false);
        setMessages(prev => [...prev, { id: streamId, role: "assistant", content: "", streaming: true }]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === "delta") {
                setMessages(prev => prev.map(m =>
                  m.id === streamId ? { ...m, content: m.content + (evt.content as string) } : m
                ));
                scrollToBottom();
              } else if (evt.type === "done") {
                setMessages(prev => prev.map(m =>
                  m.id === streamId
                    ? { id: evt.id ?? streamId, role: "assistant", content: evt.content as string, streaming: false }
                    : m
                ));
                scrollToBottom();
              } else if (evt.type === "error") {
                throw new Error(evt.message as string);
              }
            } catch (parseErr) {
              // eslint-disable-next-line no-console
              console.warn("[coach] malformed SSE delta:", line.slice(0, 200), parseErr);
            }
          }
        }
      } else {
        // ── Fallback path (React Native native — no ReadableStream) ────────
        // Read the full SSE text buffer and extract the final message
        const fullText = await response.text();
        setIsThinking(false);
        let finalContent = "";
        let finalId = streamId;
        let hadError = false;

        for (const line of fullText.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === "done") {
              finalContent = (evt.content as string) ?? "";
              finalId = evt.id ?? streamId;
            } else if (evt.type === "error") {
              // Backend sent an error event — show it as content instead of generic message
              finalContent = evt.message ? `⚠️ ${evt.message}` : "";
              hadError = true;
            }
          } catch (parseErr) {
            // eslint-disable-next-line no-console
            console.warn("[coach] malformed SSE line (fallback path):", line.slice(0, 200), parseErr);
          }
        }

        if (!finalContent && !hadError) {
          console.warn("[coach] No done/error event in SSE buffer. Buffer length:", fullText.length);
        }

        const defaultMsg = "I'm temporarily unable to respond. Please check your connection and try again.";

        setMessages(prev => [...prev, {
          id: finalId,
          role: "assistant" as const,
          content: finalContent || defaultMsg,
          streaming: false,
        }]);
        scrollToBottom();
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if ((err as Error)?.name === "AbortError") {
        setMessages(prev => {
          const cleaned = prev.filter(m => m.id !== streamId);
          return [...cleaned, { id: Date.now() + 2, role: "assistant" as const, content: "⚠️ Request timed out after 60 seconds. Please try again.", streaming: false }];
        });
        scrollToBottom();
        return;
      }
      setIsThinking(false);
      const msg = (err as Error)?.message ?? "unknown error";
      const isTimeout = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted");
      const isNetworkErr = msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch");
      const userFacingMsg = isTimeout
        ? "The request timed out. Please check your connection and try again."
        : isNetworkErr
        ? "Network error — make sure the API server is running and reachable."
        : msg;
      setError(userFacingMsg);
      setMessages(prev => {
        const cleaned = prev.filter(m => m.id !== streamId);
        return [...cleaned, { id: Date.now() + 2, role: "assistant" as const, content: `⚠️ ${userFacingMsg}` }];
      });
    } finally {
      clearTimeout(timeoutId);
      setIsSending(false);
      setIsThinking(false);
      abortRef.current = null;
    }
  }, [isSending, scrollToBottom]);

  const handleNewChat = useCallback(async (autoSend?: string) => {
    setCreating(true);
    setError("");
    try {
      const res = await authFetchRaw("/api/openai/conversations", {
        method: "POST",
        body: JSON.stringify({ title: `Chat ${new Date().toLocaleDateString("en", { month: "short", day: "numeric" })}` }),
      });
      if (!res.ok) throw new Error("Failed to create chat");
      const conv: Conv = await res.json();
      setConvList(prev => [conv, ...prev]);
      setActiveConvId(conv.id);
      setActiveConvTitle(conv.title);
      setMessages([]);
      if (autoSend) setTimeout(() => streamMessage(conv.id, autoSend), 200);
    } catch (err: any) {
      setError(err?.message ?? "Could not create chat");
    } finally { setCreating(false); }
  }, [streamMessage]);

  const handleOpenConv  = useCallback((conv: Conv) => { setActiveConvId(conv.id); setActiveConvTitle(conv.title); setMessages([]); loadMessages(conv.id); }, [loadMessages]);
  const handleDeleteConv = useCallback(async (id: number) => {
    try {
      await authFetchRaw(`/api/openai/conversations/${id}`, { method: "DELETE" });
      setConvList(prev => prev.filter(c => c.id !== id));
      if (activeConvId === id) { setActiveConvId(null); setMessages([]); }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[coach] handleDeleteConv failed:", err);
    }
  }, [activeConvId]);

  const sendMessage   = useCallback((text: string) => { if (activeConvId) streamMessage(activeConvId, text); }, [activeConvId, streamMessage]);
  const stopStreaming  = useCallback(() => { abortRef.current?.abort(); setIsSending(false); setIsThinking(false); setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m)); }, []);

  // ── Conversation list ──────────────────────────────────────────────────────
  if (activeConvId === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          <Text style={[styles.screenTitle, { color: colors.foreground }]}>AI Coach</Text>
          <TouchableOpacity style={[styles.newChatBtn, { backgroundColor: colors.primary }]} onPress={() => handleNewChat()} disabled={creating}>
            {creating
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Feather name="plus" size={15} color="#fff" /><Text style={[styles.newChatText, { color: "#fff" }]}>New Chat</Text></>
            }
          </TouchableOpacity>
        </View>

        {error !== "" && (
          <View style={[styles.errorBar, { backgroundColor: "#FEF2F2", borderColor: "#EF4444" }]}>
            <Feather name="alert-circle" size={14} color="#B91C1C" />
            <Text style={{ color: "#B91C1C", fontSize: 13, flex: 1 }}>{error}</Text>
          </View>
        )}

        {convsLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} size="large" />
        ) : convList.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 64, marginBottom: 8 }}>🤖</Text>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Your AI Financial Coach</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              I know your real QAR numbers. Ask me anything about budgets, investing, or saving.
            </Text>
            <View style={styles.starterGrid}>
              {STARTERS.map(({ icon, q }) => (
                <TouchableOpacity key={q} style={[styles.starterChip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleNewChat(q)} disabled={creating}>
                  <Text style={{ fontSize: 18 }}>{icon}</Text>
                  <Text style={[styles.starterText, { color: colors.foreground }]}>{q}</Text>
                  <Feather name="arrow-right" size={13} color={colors.primary} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.startBtn, { backgroundColor: colors.primary }]} onPress={() => handleNewChat()} disabled={creating}>
              <Feather name="message-circle" size={18} color="#fff" />
              <Text style={[styles.startBtnText, { color: "#fff" }]}>{creating ? "Starting…" : "Start Chatting"}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={convList}
            keyExtractor={item => String(item.id)}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: tabBarPadding }}
            ListHeaderComponent={
              <View style={[styles.infoBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={{ fontSize: 16 }}>✨</Text>
                <Text style={[styles.infoText, { color: colors.mutedForeground }]}>I can see your spending, income & portfolio. Responses stream live.</Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.convItem, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleOpenConv(item)} activeOpacity={0.7}>
                <View style={[styles.convIcon, { backgroundColor: colors.primary + "20" }]}>
                  <Feather name="message-circle" size={18} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.convTitle, { color: colors.foreground }]}>{item.title}</Text>
                  <Text style={[styles.convDate, { color: colors.mutedForeground }]}>{new Date(item.createdAt).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}</Text>
                </View>
                <TouchableOpacity style={[styles.delConvBtn, { backgroundColor: colors.accent }]} onPress={() => handleDeleteConv(item.id)}>
                  <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                </TouchableOpacity>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    );
  }

  // ── Active chat ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => { abortRef.current?.abort(); setActiveConvId(null); setMessages([]); loadConversations(); }}>
          <Feather name="arrow-left" size={21} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={[styles.onlineDot, { backgroundColor: isSending ? colors.primary : colors.success }]} />
          <Text style={{ fontSize: 18 }}>🤖</Text>
          <View>
            <Text style={[styles.convHeaderTitle, { color: colors.foreground }]}>Aurix AI</Text>
            <Text style={{ fontSize: 11, color: isSending ? colors.primary : colors.success }}>{isSending ? "typing…" : "online"}</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.backBtn} onPress={() => handleDeleteConv(activeConvId)}>
          <Feather name="trash-2" size={17} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? TAB_BAR_HEIGHT : 0}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={item => String(item.id)}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 16 }}
          renderItem={({ item }) => <MessageBubble msg={item} colors={colors} />}
          ListFooterComponent={isThinking ? <ThinkingBubble colors={colors} /> : null}
          ListEmptyComponent={
            <View style={styles.emptyChatState}>
              <Text style={{ fontSize: 44, marginBottom: 12 }}>💬</Text>
              <Text style={[styles.emptyChatTitle, { color: colors.foreground }]}>Ask me anything</Text>
              <Text style={[styles.emptyChatSub, { color: colors.mutedForeground }]}>I have access to your real spending data. Try one of these:</Text>
              <View style={{ marginTop: 14, gap: 8, width: "100%" }}>
                {STARTERS.slice(0, 4).map(({ icon, q }) => (
                  <TouchableOpacity key={q} style={[styles.starterChip, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => sendMessage(q)}>
                    <Text style={{ fontSize: 16 }}>{icon}</Text>
                    <Text style={[styles.starterText, { color: colors.foreground }]}>{q}</Text>
                    <Feather name="arrow-right" size={13} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          }
          onContentSizeChange={scrollToBottom}
        />

        {/* Lift input bar above the floating tab bar so it's never hidden */}
        <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: 12 + TAB_BAR_HEIGHT - (Platform.OS === "ios" ? insets.bottom : 0) }]}>
          <TextInput
            style={[styles.chatInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Ask about your finances…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={600}
            editable={!isSending}
            returnKeyType="send"
            onSubmitEditing={() => { if (!isSending && inputText.trim()) sendMessage(inputText); }}
            blurOnSubmit={false}
          />
          {isSending ? (
            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.danger + "22" }]} onPress={stopStreaming}>
              <Feather name="square" size={16} color={colors.danger} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: inputText.trim() ? colors.primary : colors.accent }]}
              onPress={() => sendMessage(inputText)}
              disabled={!inputText.trim()}
            >
              <Feather name="send" size={18} color={inputText.trim() ? "#fff" : colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  screenTitle:     { fontSize: 22, fontWeight: "700" },
  newChatBtn:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  newChatText:     { fontWeight: "600", fontSize: 14 },
  backBtn:         { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerCenter:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8 },
  onlineDot:       { width: 8, height: 8, borderRadius: 4 },
  convHeaderTitle: { fontSize: 15, fontWeight: "700" },
  errorBar:        { flexDirection: "row", alignItems: "center", gap: 8, margin: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  emptyState:      { flex: 1, alignItems: "center", padding: 24, paddingTop: 32, gap: 10 },
  emptyTitle:      { fontSize: 21, fontWeight: "700", textAlign: "center" },
  emptySub:        { fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: 4 },
  starterGrid:     { width: "100%", gap: 8, marginBottom: 8 },
  starterChip:     { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 13, borderWidth: 1, gap: 10 },
  starterText:     { flex: 1, fontSize: 13, lineHeight: 18 },
  startBtn:        { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14, marginTop: 4 },
  startBtnText:    { fontWeight: "700", fontSize: 16 },
  infoBar:         { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1 },
  infoText:        { fontSize: 12, flex: 1, lineHeight: 17 },
  convItem:        { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, padding: 16, borderWidth: 1 },
  convIcon:        { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  convTitle:       { fontSize: 15, fontWeight: "600" },
  convDate:        { fontSize: 12, marginTop: 2 },
  delConvBtn:      { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  bubbleRow:       { flexDirection: "row" },
  bubbleRowUser:   { justifyContent: "flex-end" },
  bubbleRowAI:     { justifyContent: "flex-start", gap: 8 },
  avatar:          { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", alignSelf: "flex-end" },
  bubble:          { maxWidth: "80%", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleText:      { fontSize: 15, lineHeight: 23 },
  emptyChatState:  { padding: 24, alignItems: "center", paddingTop: 36 },
  emptyChatTitle:  { fontSize: 18, fontWeight: "700", marginBottom: 6 },
  emptyChatSub:    { fontSize: 13, textAlign: "center", lineHeight: 20 },
  inputBar:        { flexDirection: "row", alignItems: "flex-end", gap: 10, padding: 12, borderTopWidth: 1 },
  chatInput:       { flex: 1, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 110, lineHeight: 22 },
  sendBtn:         { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", marginBottom: 1 },
});
