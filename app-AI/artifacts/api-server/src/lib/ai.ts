/**
 * Gemini-only AI abstraction.
 *
 * Single source of truth for every AI call in the server. There is no
 * fallback provider, no multi-provider switching, no OpenAI/Anthropic
 * shim — Gemini is the one and only provider.
 *
 * Errors are re-thrown with their original stack so route handlers (and
 * pino) can log the real failure cause. Do NOT swallow errors in here.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { logger } from "./logger";

type ChatMessage = { role: "user" | "assistant"; content: string };

const API_KEY    = (process.env["GEMINI_API_KEY"] ?? "").trim();
const MODEL_NAME = "gemini-1.5-flash";

if (!API_KEY) {
  // Hard-fail at boot so we don't silently start without an AI provider.
  throw new Error(
    "[AI] GEMINI_API_KEY is missing — set it in Replit Secrets. Gemini is the only supported provider."
  );
}

logger.info({ provider: "gemini", model: MODEL_NAME }, "[AI] provider selected");

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// ── Plain-text completion ──────────────────────────────────────────────────
export async function generateCompletion(
  systemPrompt: string,
  history: ChatMessage[],
  maxTokens = 500,
  temperature = 0.4,
): Promise<string> {
  logger.debug({ provider: "gemini", historyLen: history.length, maxTokens }, "[AI] generateCompletion");

  const contents = [
    { role: "user" as const, parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
    ...history.map(m => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    })),
  ];

  const result = await model.generateContent({
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });

  const text = result.response.text();
  if (!text) throw new Error("[AI] Gemini returned an empty response");
  return text;
}

// ── Streaming completion ───────────────────────────────────────────────────
export async function streamCompletion(
  systemPrompt: string,
  history: ChatMessage[],
  onDelta: (chunk: string) => void,
  maxTokens = 800,
  temperature = 0.4,
): Promise<string> {
  logger.debug({ provider: "gemini", historyLen: history.length, maxTokens }, "[AI] streamCompletion");

  const contents = [
    { role: "user" as const, parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
    ...history.map(m => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }],
    })),
  ];

  const result = await model.generateContentStream({
    contents,
    generationConfig: { maxOutputTokens: maxTokens, temperature },
  });

  let full = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      full += text;
      onDelta(text);
    }
  }

  if (!full) throw new Error("[AI] Gemini returned an empty streaming response");
  return full;
}

// ── JSON-structured completion (used by SMS parser, weekly report) ────────
/**
 * Calls Gemini in JSON mode and returns the parsed object. Uses a low
 * temperature by default for deterministic structured output.
 */
export async function generateJSON<T = unknown>(
  systemPrompt: string,
  userContent: string,
  maxTokens = 400,
  temperature = 0.1,
): Promise<T> {
  logger.debug({ provider: "gemini", maxTokens }, "[AI] generateJSON");

  const result = await model.generateContent({
    contents: [
      { role: "user" as const, parts: [{ text: `[SYSTEM]\n${systemPrompt}` }] },
      { role: "user" as const, parts: [{ text: userContent }] },
    ],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature,
      responseMimeType: "application/json",
    },
  });

  const raw = result.response.text();
  if (!raw) throw new Error("[AI] Gemini returned an empty JSON response");
  // Gemini JSON mode is reliable, but strip any stray code fences just in case.
  return JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as T;
}

/**
 * Vision JSON: parse a receipt image and return structured data.
 */
export async function generateJSONFromImage<T = unknown>(
  systemPrompt: string,
  base64: string,
  mimeType = "image/jpeg",
  maxTokens = 350,
): Promise<T> {
  const data = base64.includes(",") ? base64.split(",")[1]! : base64;
  logger.debug({ provider: "gemini", mimeType, maxTokens }, "[AI] generateJSONFromImage");

  const result = await model.generateContent({
    contents: [{
      role: "user" as const,
      parts: [
        { text: `${systemPrompt}\n\nAnalyze this receipt image.` },
        { inlineData: { mimeType, data } },
      ],
    }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const raw = result.response.text();
  if (!raw) throw new Error("[AI] Gemini returned an empty image-JSON response");
  return JSON.parse(raw.replace(/```json\n?|```\n?/g, "").trim()) as T;
}
