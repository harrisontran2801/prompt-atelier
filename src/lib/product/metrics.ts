export const METRIC_NAMES = [
  "onboarding_completed",
  "first_run_success",
  "recipe_saved",
  "repeat_run",
  "recipe_reused",
  "pack_imported",
  "suite_pass",
  "failure_reported",
  "fallback_used",
  "paywall_seen",
  "checkout_started",
  "subscription_active",
  "credit_low",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

export type MetricEvent = {
  name: MetricName;
  at: string;
  count: number;
  latencyMs?: number;
  routeMode?: "sandbox" | "free-public" | "byok" | "managed-paid" | "blocked";
};

const ALLOWED = new Set<string>(METRIC_NAMES);

/** Analytics payload is an enum plus counts. Text fields are dropped. */
export function metricFrom(input: Record<string, unknown>, nowIso: string): MetricEvent | null {
  const name = String(input.name ?? "");
  if (!ALLOWED.has(name)) return null;
  return {
    name: name as MetricName,
    at: nowIso,
    count: Number(input.count ?? 1) || 1,
    latencyMs: typeof input.latencyMs === "number" ? input.latencyMs : undefined,
    routeMode: typeof input.routeMode === "string" ? (input.routeMode as MetricEvent["routeMode"]) : undefined,
  };
}
