import { createServerFn } from "@tanstack/react-start";
import type { ProviderId } from "./catalog";
import { retryDecision } from "../product/retry-policy";
import { parseGeminiUsage, parseOpenAiUsage, type UsageConfidence } from "../product/usage";
import { resolveXaiKey } from "./xai-key";

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
  latencyMs?: number;
  requestId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
  };
  usageConfidence?: UsageConfidence;
  providerRequestId?: string;
};

export type ExecuteControl = {
  managedServerKey?: string;
  idempotencyKey?: string;
  skipGlobalRateLimit?: boolean;
};

const TIMEOUT_MS = 28_000;
const MAX_INPUT_CHARS = 18_000;
const MAX_OUTPUT_TOKENS = 900;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const buckets = new Map<string, number[]>();

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeError(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/key=[A-Za-z0-9._\-]+/gi, "key=[redacted]")
    .replace(/\b(?:sk|pk|rk|hf_|xai-)[A-Za-z0-9._\-]{6,}\b/g, "[redacted]")
    .slice(0, 280);
}

function rateLimit(token: string) {
  const now = Date.now();
  const hits = (buckets.get(token) ?? []).filter((ts) => now - ts < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    throw new Error(`Rate limit: tối đa ${MAX_PER_WINDOW} request/phút`);
  }
  hits.push(now);
  buckets.set(token, hits);
}

function validateInput(input: AiRunInput) {
  if (!input || typeof input !== "object") throw new Error("Payload không hợp lệ");
  if (!Array.isArray(input.messages) || input.messages.length === 0) throw new Error("Thiếu messages");
  if (input.messages.length > 12) throw new Error("Quá nhiều messages");
  for (const message of input.messages) {
    if (!message || !["system", "user", "assistant"].includes(message.role)) throw new Error("Role không hợp lệ");
    if (typeof message.content !== "string") throw new Error("Content phải là string");
  }
  if (input.model && input.model.length > 120) throw new Error("Model id quá dài");
  if (input.userKey && input.userKey.length > 256) throw new Error("API key không hợp lệ");
}

function clipMessages(messages: ChatMessage[]) {
  let total = 0;
  const clipped: ChatMessage[] = [];
  for (const message of messages.slice(-8).reverse()) {
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
  return "";
}

function extractGeminiText(payload: unknown): string {
  const data = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

async function readJson(response: Response) {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { text: raw };
  }
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  attempt = 0,
  idempotencyKey?: string,
  allowRetry = true,
): Promise<unknown> {
  const sent = idempotencyKey ? { ...headers, "idempotency-key": idempotencyKey } : headers;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...sent },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await readJson(response);
    if (!response.ok) {
      const err =
        (json as { error?: { message?: string }; message?: string }).error?.message ||
        (json as { message?: string }).message ||
        `HTTP ${response.status}`;
      if (retryDecision({ status: response.status, message: err, attempt, allowRetry, hasIdempotencyKey: Boolean(idempotencyKey) }) === "retry") {
        return postJson(url, body, headers, attempt + 1, idempotencyKey, allowRetry);
      }
      throw new Error(err);
    }
    return json;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (retryDecision({ message, attempt, allowRetry, hasIdempotencyKey: Boolean(idempotencyKey) }) === "retry") {
      return postJson(url, body, headers, attempt + 1, idempotencyKey, allowRetry);
    }
    throw error;
  }
}

function attachUsage(result: AiRunResult, payload: unknown, kind: "openai" | "gemini" | "none"): AiRunResult {
  if (kind === "none") return { ...result, usageConfidence: "unknown" };
  const parsed = kind === "openai" ? parseOpenAiUsage(payload) : parseGeminiUsage(payload);
  if (!parsed) return { ...result, usageConfidence: "unknown" };
  return {
    ...result,
    usage: parsed.usage,
    usageConfidence: parsed.usage.inputTokens != null && parsed.usage.outputTokens != null ? "actual" : "estimated",
    providerRequestId:
      "providerRequestId" in parsed && typeof parsed.providerRequestId === "string" ? parsed.providerRequestId : undefined,
  };
}

async function callProvider(input: AiRunInput, managedServerKey?: string, idempotencyKey?: string, allowRetry = true): Promise<AiRunResult> {
  const messages = clipMessages(input.messages);
  const maxTokens = Math.min(input.maxTokens ?? 700, MAX_OUTPUT_TOKENS);
  const temperature = input.temperature ?? 0.2;
  const key = input.userKey?.trim();

  if (input.provider === "sandbox") {
    throw new Error("Sandbox chạy trên client");
  }
  if (input.provider === "pollinations") {
    const json = await postJson(
      "https://text.pollinations.ai/openai",
      { model: input.model || "openai", messages, temperature, max_tokens: maxTokens, private: true },
      { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      0,
      idempotencyKey,
      allowRetry,
    );
    const text = extractOpenAiText(json);
    if (!text) throw new Error("Pollinations không trả nội dung");
    return attachUsage({ text, provider: "pollinations", model: input.model }, json, "openai");
  }
  if (input.provider === "groq") {
    if (!key) throw new Error("Cần Groq API key");
    const json = await postJson(
      "https://api.groq.com/openai/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "groq", model: input.model }, json, "openai");
  }
  if (input.provider === "openrouter") {
    if (!key) throw new Error("Cần OpenRouter API key");
    const json = await postJson(
      "https://openrouter.ai/api/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}`, "http-referer": "https://prompt-atelier.local", "x-title": "Prompt Atelier" },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "openrouter", model: input.model }, json, "openai");
  }
  if (input.provider === "together") {
    if (!key) throw new Error("Cần Together API key");
    const json = await postJson(
      "https://api.together.xyz/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "together", model: input.model }, json, "openai");
  }
  if (input.provider === "mistral") {
    if (!key) throw new Error("Cần Mistral API key");
    const json = await postJson(
      "https://api.mistral.ai/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "mistral", model: input.model }, json, "openai");
  }
  if (input.provider === "huggingface") {
    if (!key) throw new Error("Cần Hugging Face token");
    const json = await postJson(
      "https://router.huggingface.co/v1/chat/completions",
      { model: input.model, messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${key}` },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "huggingface", model: input.model }, json, "openai");
  }
  if (input.provider === "gemini") {
    if (!key) throw new Error("Cần Gemini API key");
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n");
    const contents = messages
      .filter((item) => item.role !== "system")
      .map((item) => ({ role: item.role === "assistant" ? "model" : "user", parts: [{ text: item.content }] }));
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(key)}`;
    const json = await postJson(
      url,
      { contents, systemInstruction: system ? { parts: [{ text: system }] } : undefined, generationConfig: { temperature, maxOutputTokens: maxTokens } },
      {},
      0,
      idempotencyKey,
      allowRetry,
    );
    const text = extractGeminiText(json);
    if (!text) throw new Error("Gemini không trả nội dung");
    return attachUsage({ text, provider: "gemini", model: input.model }, json, "gemini");
  }
  if (input.provider === "xai") {
    const xaiKey = resolveXaiKey(key, managedServerKey);
    if (!xaiKey) throw new Error("xAI BYOK cần API key của bạn. Request thường không dùng key trên server.");
    const json = await postJson(
      "https://api.x.ai/v1/chat/completions",
      { model: input.model || "grok-4-fast", messages, temperature, max_tokens: maxTokens },
      { authorization: `Bearer ${xaiKey}` },
      0,
      idempotencyKey,
      allowRetry,
    );
    return attachUsage({ text: extractOpenAiText(json), provider: "xai", model: input.model }, json, "openai");
  }
  throw new Error("Provider không hỗ trợ");
}

async function fallbackPollinations(input: AiRunInput): Promise<AiRunResult> {
  const result = await callProvider({ ...input, provider: "pollinations", model: "openai", userKey: undefined });
  return { ...result, fallback: "pollinations" };
}

function controlOf(second?: string | ExecuteControl): ExecuteControl {
  if (typeof second === "string" || second == null) return { managedServerKey: second };
  return second;
}

export async function executeAi(data: AiRunInput, second?: string | ExecuteControl): Promise<AiRunResult> {
  const control = controlOf(second);
  const started = Date.now();
  const id = control.idempotencyKey || requestId();
  validateInput(data);
  if (!control.skipGlobalRateLimit) rateLimit((data.provider || "anon").slice(0, 24));
  const managed = Boolean(control.managedServerKey);
  const allowRetry = managed ? Boolean(control.idempotencyKey) : true;
  const finish = (result: AiRunResult): AiRunResult => ({
    ...result,
    latencyMs: Date.now() - started,
    requestId: id,
    usageConfidence: result.usageConfidence ?? "unknown",
  });
  try {
    const result = await callProvider(data, control.managedServerKey, managed ? control.idempotencyKey : undefined, allowRetry);
    if (!result.text?.trim()) throw new Error("Model trả về rỗng");
    return finish(result);
  } catch (error) {
    const message = sanitizeError(error instanceof Error ? error.message : "Lỗi AI");
    if (data.allowFallback !== false && data.provider !== "pollinations" && data.provider !== "sandbox") {
      try {
        return finish(await fallbackPollinations(data));
      } catch (fallbackError) {
        throw new Error(sanitizeError(fallbackError instanceof Error ? fallbackError.message : message));
      }
    }
    throw new Error(message);
  }
}

export const runAi = createServerFn({ method: "POST" })
  .validator((input: AiRunInput) => input)
  .handler(async ({ data }) => executeAi(data));
