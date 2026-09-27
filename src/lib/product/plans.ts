import type { PlanId } from "./routing.ts";

export type PlanConfig = {
  id: PlanId;
  name: string;
  monthlyCredits: number;
  /** Null means this deployment has not set a price. Do not invent one. */
  priceUsd: number | null;
  freeDailyCap: number;
  perMinuteCap: number;
  cloudSync: boolean;
  managed: boolean;
  pooled: boolean;
};

export type PlanEnv = Record<string, string | undefined>;

function price(env: PlanEnv, key: string): number | null {
  const raw = env[key];
  if (!raw?.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

export function loadPlans(env: PlanEnv = typeof process === "undefined" ? {} : process.env): PlanConfig[] {
  return [
    {
      id: "free",
      name: "Free",
      monthlyCredits: 0,
      priceUsd: 0,
      freeDailyCap: 20,
      perMinuteCap: 4,
      cloudSync: false,
      managed: false,
      pooled: false,
    },
    {
      id: "pro",
      name: "Pro",
      monthlyCredits: 2000,
      priceUsd: price(env, "PLAN_PRO_PRICE_USD"),
      freeDailyCap: 20,
      perMinuteCap: 4,
      cloudSync: true,
      managed: true,
      pooled: false,
    },
    {
      id: "team",
      name: "Team",
      monthlyCredits: 10000,
      priceUsd: price(env, "PLAN_TEAM_PRICE_USD"),
      freeDailyCap: 40,
      perMinuteCap: 8,
      cloudSync: true,
      managed: true,
      pooled: true,
    },
  ];
}

export function planById(id: PlanId, env?: PlanEnv) {
  return loadPlans(env).find((item) => item.id === id) ?? loadPlans(env)[0];
}

export const CREDIT_USD = 0.001;

export function creditsForCost(costUsd: number) {
  if (!(costUsd > 0)) return 0;
  return Math.max(1, Math.ceil(costUsd / CREDIT_USD));
}

export function estimateTokens(inputChars: number, maxOutputTokens: number) {
  return Math.ceil(Math.max(0, inputChars) / 4) + Math.max(0, maxOutputTokens);
}

export function estimateCostUsd(usdPer1k: number, inputChars: number, maxOutputTokens: number) {
  const tokens = estimateTokens(inputChars, maxOutputTokens);
  const cost = (tokens / 1000) * Math.max(0, usdPer1k);
  return Math.round(cost * 1_000_000) / 1_000_000;
}
