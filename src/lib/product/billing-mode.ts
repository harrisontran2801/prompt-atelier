import { applyBillingCommand, type BillingCommand, type LedgerState } from "./ledger.ts";
import type { PlanEnv } from "./plans.ts";

export type BillingMode = "mock" | "disabled" | "hosted";

export function billingModeOf(env: { NODE_ENV?: string } = {}): BillingMode {
  return env.NODE_ENV === "production" ? "disabled" : "mock";
}

export type EconomySurface = {
  economyStore: "memory" | "sql";
  billingMode: BillingMode;
};

/** Production never enables mock or live checkout. SQL is only the ledger. */
export function economySurface(env: { NODE_ENV?: string; DATABASE_URL?: string } = {}): EconomySurface {
  const sql = Boolean(env.DATABASE_URL?.trim());
  if (env.NODE_ENV === "production") return { economyStore: sql ? "sql" : "memory", billingMode: "disabled" };
  if (sql) return { economyStore: "sql", billingMode: "hosted" };
  return { economyStore: "memory", billingMode: "mock" };
}

export function applyMockBilling(
  state: LedgerState,
  seen: string[],
  command: BillingCommand,
  env: { NODE_ENV?: string } & PlanEnv = {},
) {
  if (billingModeOf(env) === "disabled") {
    return {
      ok: false as const,
      state,
      seen,
      duplicate: false,
      error: "Mock billing tắt trên production. Không đổi gói và không cộng tín dụng.",
    };
  }
  const applied = applyBillingCommand(state, seen, command, env);
  return { ok: true as const, ...applied, error: undefined as string | undefined };
}
