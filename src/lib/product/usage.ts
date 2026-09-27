export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
};

export type UsageConfidence = "actual" | "estimated" | "unknown";

export const PRICE_VERSION = "2026-09-28";

type Price = { inputPer1k: number; outputPer1k: number };

const PRICES: Record<string, Price> = {
  "xai:grok-4-fast": { inputPer1k: 0.005, outputPer1k: 0.015 },
  "xai:grok-2-latest": { inputPer1k: 0.002, outputPer1k: 0.01 },
};

function num(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

export function priceFor(provider: string, model: string): { version: string; price: Price } | null {
  const price = PRICES[`${provider}:${model}`];
  if (!price) return null;
  return { version: PRICE_VERSION, price };
}

export function parseOpenAiUsage(payload: unknown): { usage: TokenUsage; providerRequestId?: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { id?: unknown; usage?: Record<string, unknown> };
  const usage = body.usage;
  if (!usage) return null;
  const details = usage.completion_tokens_details as Record<string, unknown> | undefined;
  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const parsed: TokenUsage = {
    inputTokens: num(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: num(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens: num(details?.reasoning_tokens),
    cachedInputTokens: num(promptDetails?.cached_tokens),
    totalTokens: num(usage.total_tokens),
  };
  if (parsed.inputTokens == null && parsed.outputTokens == null && parsed.totalTokens == null) return null;
  const providerRequestId = typeof body.id === "string" && !/sk-|api[_-]?key/i.test(body.id) ? body.id : undefined;
  return { usage: parsed, providerRequestId };
}

export function parseGeminiUsage(payload: unknown): { usage: TokenUsage } | null {
  if (!payload || typeof payload !== "object") return null;
  const meta = (payload as { usageMetadata?: Record<string, unknown> }).usageMetadata;
  if (!meta) return null;
  const usage: TokenUsage = {
    inputTokens: num(meta.promptTokenCount),
    outputTokens: num(meta.candidatesTokenCount),
    reasoningTokens: num(meta.thoughtsTokenCount),
    cachedInputTokens: num(meta.cachedContentTokenCount),
    totalTokens: num(meta.totalTokenCount),
  };
  if (usage.inputTokens == null && usage.outputTokens == null && usage.totalTokens == null) return null;
  return { usage };
}

function round(cost: number) {
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/** Actual only when input and output token counts exist and a price snapshot matches. */
export function billUsage(input: {
  provider: string;
  model: string;
  usage?: TokenUsage;
  estimatedCostUsd: number;
}): { costUsd: number; confidence: UsageConfidence; priceVersion: string; actualTokens?: number } {
  const usage = input.usage;
  const hasSplit = usage?.inputTokens != null && usage.outputTokens != null;
  const priced = priceFor(input.provider, input.model);
  if (!usage || (usage.inputTokens == null && usage.outputTokens == null && usage.totalTokens == null)) {
    return {
      costUsd: input.estimatedCostUsd,
      confidence: input.estimatedCostUsd > 0 ? "estimated" : "unknown",
      priceVersion: priced?.version ?? "unpriced",
    };
  }
  if (!hasSplit || !priced) {
    return {
      costUsd: input.estimatedCostUsd,
      confidence: "estimated",
      priceVersion: priced?.version ?? "unpriced",
      actualTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
    };
  }
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens ?? 0);
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cached);
  const output = (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0);
  const cost =
    (fresh / 1000) * priced.price.inputPer1k +
    (cached / 1000) * priced.price.inputPer1k * 0.5 +
    (output / 1000) * priced.price.outputPer1k;
  return {
    costUsd: round(cost),
    confidence: "actual",
    priceVersion: priced.version,
    actualTokens: usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0),
  };
}
