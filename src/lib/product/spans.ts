import type { UsageConfidence } from "./usage.ts";

export type EconomySpan = {
  name: "route" | "reserve" | "provider" | "settle" | "refund";
  orgId: string;
  requestId: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  usageConfidence?: UsageConfidence;
};

const NAMES = new Set(["route", "reserve", "provider", "settle", "refund"]);

/** Drops prompt, output, keys, and any other free text before a span is stored. */
export function scrubSpan(input: Record<string, unknown>): EconomySpan | null {
  const name = String(input.name ?? "");
  if (!NAMES.has(name)) return null;
  const orgId = String(input.orgId ?? "");
  const requestId = String(input.requestId ?? "");
  if (!orgId || !requestId || orgId.length > 80 || requestId.length > 80) return null;
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined);
  const confidence = input.usageConfidence;
  return {
    name: name as EconomySpan["name"],
    orgId,
    requestId,
    provider: typeof input.provider === "string" ? input.provider.slice(0, 40) : undefined,
    model: typeof input.model === "string" ? input.model.slice(0, 80) : undefined,
    inputTokens: num(input.inputTokens),
    outputTokens: num(input.outputTokens),
    latencyMs: num(input.latencyMs),
    usageConfidence:
      confidence === "actual" || confidence === "estimated" || confidence === "unknown" ? confidence : undefined,
  };
}

export function genAiAttributes(span: EconomySpan): Record<string, string | number> {
  return {
    "gen_ai.provider.name": span.provider ?? "unknown",
    "gen_ai.request.model": span.model ?? "unknown",
    "gen_ai.usage.input_tokens": span.inputTokens ?? 0,
    "gen_ai.usage.output_tokens": span.outputTokens ?? 0,
    "gen_ai.response.latency_ms": span.latencyMs ?? 0,
  };
}

export function rateBucketKey(orgId: string, route: string, nowMs: number) {
  const minute = Math.floor(nowMs / 60_000);
  return `${orgId}:${route}:${minute}`;
}
