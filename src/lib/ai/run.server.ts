import { createServerFn } from "@tanstack/react-start";
import { env } from "@/lib/env.server";
import type { ProviderId } from "./catalog";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type AiRunInput = {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  userKey?: string;
  maxTokens?: number;
  temperature?: number;
  allowFallback?: boolean;
};

export type AiRunResult = {
  text: string;
  provider: ProviderId;
  model: string;
  fallback?: ProviderId;
  usage?: { prompt?: number; completion?: number };
};

const TIMEOUT_MS = 28_000;
const MAX_INPUT_CHARS = 24_000;
const MAX_OUTPUT_TOKENS = 1_200;

function clipMessages(messages: ChatMessage[]) {
  let total = 0;
  const clipped: ChatMessage[] = [];
  for (const message of messages.slice(-12).reverse()) {
    const content = message.content.slice(0, 8_000);
    total += content.length;
    if (total > MAX_INPUT_CHARS) break;
    clipped.push({ ...message, content });
  }
  return clipped.reverse();
}

function extractOpenAiText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as {
    choices?: Array<{ message?: { content?: unknown }; text?: string }>;
    output_text?: string;
    text?: string;
  };
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join("")
      .trim();
  }
  if (typeof choice?.text === "string") return choice.text.trim();
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (typeof data.text === "string") return data.text.trim();
  return "";
}

function extractGeminiText(payload: unknown): string {
  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { text: raw };
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = await readJson(response);
  if (!response.ok) {
    const err =
      (json as { error?: { message?: string }; message?: string }).error?.message ||
      (json as { message?: string }).message ||
      `HTTP ${response.status}`;
    throw new Error(err);
  }
  return json;
}

async function callProvider(input: AiRunInput): Promise<AiRunResult> {
  const messages = clipMessages(input.messages);
  const maxTokens = Math.min(input.maxTokens ?? 700, MAX_OUTPUT_TOKENS);
  const temperature = input.temperature ?? 0.4;
  const key = input.userKey?.trim();

  if (input.provider === "pollinations") {
    const json = await postJson(
      "https://text.pollinations.ai/openai",
      {
        model: input.model || "openai",
        messages,
        temperature,
        max_tokens: maxTokens,
        private: true,
      },
      { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    );
    const text = extractOpenAiText(json) || (typeof json === "string" ? json : "");
    if (!text) throw new Error("Pollinations không trả nội dung");
    return { text, provider: "pollinations", model: input.model };
  }

  if (input.provider === "groq") {
    if (!key) throw new Error("Cần Groq API key");
    const json = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
    );
    return { text: extractOpenAiText(json), provider: "groq", model: input.model };
  }

  if (input.provider === "openrouter") {
    if (!key) throw new Error("Cần OpenRouter API key");
    const json = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      {
        authorization: `Bearer ${key}`,
        "http-referer": "https://prompt-atelier.local",
        "x-title": "Prompt Atelier",
      },
    );
    return { text: extractOpenAiText(json), provider: "openrouter", model: input.model };
  }

  if (input.provider === "together") {
    if (!key) throw new Error("Cần Together API key");
    const json = await postJson(
      "https://api.together.xyz/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
    );
    return { text: extractOpenAiText(json), provider: "together", model: input.model };
  }

  if (input.provider === "mistral") {
    if (!key) throw new Error("Cần Mistral API key");
    const json = await postJson(
      "https://api.mistral.ai/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
    );
    return { text: extractOpenAiText(json), provider: "mistral", model: input.model };
  }

  if (input.provider === "huggingface") {
    if (!key) throw new Error("Cần Hugging Face token");
    const json = await postJson(
      "https://router.huggingface.co/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
    );
    return { text: extractOpenAiText(json), provider: "huggingface", model: input.model };
  }

  if (input.provider === "gemini") {
    if (!key) throw new Error("Cần Gemini API key");
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    const contents = messages
      .filter((item) => item.role !== "system")
      .map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(key)}`;
    const json = await postJson(
      url,
      {
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      },
      {},
    );
    const text = extractGeminiText(json);
    if (!text) throw new Error("Gemini không trả nội dung");
    return { text, provider: "gemini", model: input.model };
  }

  if (input.provider === "xai") {
    const xaiKey = key || env("XAI_API_KEY");
    if (!xaiKey) throw new Error("Chưa có XAI_API_KEY trên server hoặc key người dùng");
    const json = await postJson(
      "https://api.x.ai/v1/chat/completions",
      { model: input.model || "grok-4-fast", messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${xaiKey}` },
    );
    return { text: extractOpenAiText(json), provider: "xai", model: input.model };
  }

  throw new Error("Provider không hỗ trợ");
}

async function fallbackPollinations(input: AiRunInput, reason: string): Promise<AiRunResult> {
  const result = await callProvider({
    ...input,
    provider: "pollinations",
    model: "openai",
    userKey: undefined,
  });
  return { ...result, fallback: "pollinations", text: result.text, usage: { prompt: reason.length } };
}

export const runAi = createServerFn({ method: "POST" })
  .validator((input: AiRunInput) => input)
  .handler(async ({ data }): Promise<AiRunResult> => {
    if (!data?.messages?.length) throw new Error("Thiếu messages");
    try {
      const result = await callProvider(data);
      if (!result.text?.trim()) throw new Error("Model trả về rỗng");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lỗi AI";
      if (data.allowFallback !== false && data.provider !== "pollinations") {
        try {
          return await fallbackPollinations(data, message);
        } catch {
          throw new Error(message);
        }
      }
      throw new Error(message);
    }
  });
