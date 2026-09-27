import { creditsForCost, planById, type PlanEnv } from "./plans.ts";
import type { PlanId, RouteMode } from "./routing.ts";

export const LOCAL_ACCOUNT = "local-preview";

export type HoldStatus = "reserved" | "settled" | "refunded";

export type Account = {
  id: string;
  planId: PlanId;
  credits: number;
  reserved: number;
  spendingCapUsd: number;
  spentMonthUsd: number;
  paidConsent: boolean;
  billingProblem: boolean;
};

export type Hold = {
  requestId: string;
  accountId: string;
  credits: number;
  estimatedCostUsd: number;
  routeMode: RouteMode;
  requestedProvider: string;
  estimatedTokens: number;
  status: HoldStatus;
  actualCostUsd?: number;
  settledCredits?: number;
};

export type UsageEvent = {
  id: string;
  accountId: string;
  requestId: string;
  routeMode: RouteMode;
  requestedProvider: string;
  finalProvider?: string;
  estimatedTokens: number;
  actualTokens?: number;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  creditsReserved: number;
  creditsSettled: number;
  creditsRefunded: number;
  status: HoldStatus | "rejected";
  createdAt: string;
};

export type LedgerState = {
  accounts: Record<string, Account>;
  holds: Record<string, Hold>;
  events: UsageEvent[];
};

export function emptyAccount(id = LOCAL_ACCOUNT): Account {
  return {
    id,
    planId: "free",
    credits: 0,
    reserved: 0,
    spendingCapUsd: 0,
    spentMonthUsd: 0,
    paidConsent: false,
    billingProblem: false,
  };
}

export function emptyLedger(): LedgerState {
  return { accounts: { [LOCAL_ACCOUNT]: emptyAccount() }, holds: {}, events: [] };
}

export type ReserveInput = {
  accountId: string;
  requestId: string;
  routeMode: RouteMode;
  requestedProvider: string;
  estimatedTokens: number;
  estimatedCostUsd: number;
  nowIso: string;
};

export type ReserveResult = {
  state: LedgerState;
  ok: boolean;
  duplicate: boolean;
  reason?: string;
};

function push(state: LedgerState, event: UsageEvent): LedgerState {
  return { ...state, events: [...state.events, event] };
}

function finiteNonNegative(value: number | undefined, fallback: number) {
  const raw = value == null ? fallback : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

export function reserveCredits(state: LedgerState, input: ReserveInput): ReserveResult {
  const existing = state.holds[input.requestId];
  if (existing) return { state, ok: existing.status !== "refunded", duplicate: true };
  const account = state.accounts[input.accountId] ?? emptyAccount(input.accountId);
  const estimatedCostUsd = finiteNonNegative(input.estimatedCostUsd, 0);
  const credits = input.routeMode === "managed-paid" ? creditsForCost(estimatedCostUsd) : 0;
  if (input.routeMode === "managed-paid") {
    if (account.billingProblem) {
      return { state, ok: false, duplicate: false, reason: "Hóa đơn lỗi. Tạm dừng route trả phí." };
    }
    if (account.planId === "free") {
      return { state, ok: false, duplicate: false, reason: "Gói Free không giữ tín dụng trả phí." };
    }
    if (account.spentMonthUsd + estimatedCostUsd > account.spendingCapUsd) {
      return { state, ok: false, duplicate: false, reason: "Vượt trần chi tiêu tháng này." };
    }
    if (account.credits < credits) {
      return { state, ok: false, duplicate: false, reason: "Không đủ tín dụng." };
    }
  }
  const hold: Hold = {
    requestId: input.requestId,
    accountId: account.id,
    credits,
    estimatedCostUsd,
    routeMode: input.routeMode,
    requestedProvider: input.requestedProvider,
    estimatedTokens: Number.isFinite(input.estimatedTokens) && input.estimatedTokens > 0 ? Math.floor(input.estimatedTokens) : 0,
    status: "reserved",
  };
  const nextAccount: Account = {
    ...account,
    credits: account.credits - credits,
    reserved: account.reserved + credits,
  };
  const event: UsageEvent = {
    id: `evt_${input.requestId}_reserve`,
    accountId: account.id,
    requestId: input.requestId,
    routeMode: input.routeMode,
    requestedProvider: input.requestedProvider,
    estimatedTokens: hold.estimatedTokens,
    estimatedCostUsd,
    creditsReserved: credits,
    creditsSettled: 0,
    creditsRefunded: 0,
    status: "reserved",
    createdAt: input.nowIso,
  };
  return {
    ok: true,
    duplicate: false,
    state: push(
      { ...state, accounts: { ...state.accounts, [account.id]: nextAccount }, holds: { ...state.holds, [hold.requestId]: hold } },
      event,
    ),
  };
}

export function settleCredits(
  state: LedgerState,
  input: { requestId: string; actualCostUsd?: number; actualTokens?: number; finalProvider?: string; nowIso: string },
): ReserveResult {
  const hold = state.holds[input.requestId];
  if (!hold) return { state, ok: false, duplicate: false, reason: "Không có khoản giữ cho request này." };
  if (hold.status === "settled" || hold.status === "refunded") return { state, ok: true, duplicate: true };
  const account = state.accounts[hold.accountId];
  if (!account) return { state, ok: false, duplicate: false, reason: "Không thấy tài khoản." };
  const actualCost = finiteNonNegative(input.actualCostUsd, hold.estimatedCostUsd);
  const priced = creditsForCost(actualCost);
  const used = hold.credits === 0 ? 0 : Math.min(hold.credits, priced);
  const refund = hold.credits - used;
  const next: Account = {
    ...account,
    credits: account.credits + refund,
    reserved: Math.max(0, account.reserved - hold.credits),
    spentMonthUsd: Math.round((account.spentMonthUsd + actualCost) * 1_000_000) / 1_000_000,
  };
  const closed: Hold = { ...hold, status: "settled", actualCostUsd: actualCost, settledCredits: used };
  const event: UsageEvent = {
    id: `evt_${hold.requestId}_settle`,
    accountId: account.id,
    requestId: hold.requestId,
    routeMode: hold.routeMode,
    requestedProvider: hold.requestedProvider,
    finalProvider: input.finalProvider,
    estimatedTokens: hold.estimatedTokens,
    actualTokens: input.actualTokens,
    estimatedCostUsd: hold.estimatedCostUsd,
    actualCostUsd: actualCost,
    creditsReserved: hold.credits,
    creditsSettled: used,
    creditsRefunded: refund,
    status: "settled",
    createdAt: input.nowIso,
  };
  return {
    ok: true,
    duplicate: false,
    state: push(
      { ...state, accounts: { ...state.accounts, [account.id]: next }, holds: { ...state.holds, [hold.requestId]: closed } },
      event,
    ),
  };
}

export function refundCredits(state: LedgerState, input: { requestId: string; nowIso: string; reason: string }): ReserveResult {
  const hold = state.holds[input.requestId];
  if (!hold) return { state, ok: false, duplicate: false, reason: "Không có khoản giữ để hoàn." };
  if (hold.status === "refunded") return { state, ok: true, duplicate: true };
  if (hold.status === "settled") return { state, ok: false, duplicate: false, reason: "Đã chốt, không hoàn lại bằng retry." };
  const account = state.accounts[hold.accountId];
  if (!account) return { state, ok: false, duplicate: false, reason: "Không thấy tài khoản." };
  const next: Account = {
    ...account,
    credits: account.credits + hold.credits,
    reserved: Math.max(0, account.reserved - hold.credits),
  };
  const event: UsageEvent = {
    id: `evt_${hold.requestId}_refund`,
    accountId: account.id,
    requestId: hold.requestId,
    routeMode: hold.routeMode,
    requestedProvider: hold.requestedProvider,
    estimatedTokens: hold.estimatedTokens,
    estimatedCostUsd: hold.estimatedCostUsd,
    creditsReserved: hold.credits,
    creditsSettled: 0,
    creditsRefunded: hold.credits,
    status: "refunded",
    createdAt: input.nowIso,
  };
  return {
    ok: true,
    duplicate: false,
    state: push(
      {
        ...state,
        accounts: { ...state.accounts, [account.id]: next },
        holds: { ...state.holds, [hold.requestId]: { ...hold, status: "refunded", settledCredits: 0 } },
      },
      event,
    ),
  };
}

export type BillingCommand =
  | { type: "checkout.completed"; eventId: string; accountId: string; planId: PlanId }
  | { type: "subscription.canceled"; eventId: string; accountId: string }
  | { type: "invoice.paid"; eventId: string; accountId: string }
  | { type: "invoice.failed"; eventId: string; accountId: string };

export function applyBillingCommand(
  state: LedgerState,
  seen: string[],
  command: BillingCommand,
  env?: PlanEnv,
): { state: LedgerState; seen: string[]; duplicate: boolean } {
  if (seen.includes(command.eventId)) return { state, seen, duplicate: true };
  const account = state.accounts[command.accountId] ?? emptyAccount(command.accountId);
  let next = account;
  if (command.type === "checkout.completed") {
    const plan = planById(command.planId, env);
    next = {
      ...account,
      planId: command.planId,
      credits: plan.monthlyCredits,
      reserved: 0,
      spendingCapUsd: command.planId === "free" ? 0 : account.spendingCapUsd || 10,
      billingProblem: false,
    };
  } else if (command.type === "subscription.canceled") {
    next = { ...account, planId: "free", spendingCapUsd: 0, paidConsent: false };
  } else if (command.type === "invoice.failed") {
    next = { ...account, billingProblem: true };
  } else if (command.type === "invoice.paid") {
    const plan = planById(account.planId, env);
    next = {
      ...account,
      credits: Math.max(0, plan.monthlyCredits - account.reserved),
      reserved: account.reserved,
      spentMonthUsd: 0,
      billingProblem: false,
    };
  }
  return {
    duplicate: false,
    seen: [...seen, command.eventId],
    state: { ...state, accounts: { ...state.accounts, [account.id]: next } },
  };
}

export function setSpendingCap(state: LedgerState, accountId: string, capUsd: number): LedgerState {
  const account = state.accounts[accountId] ?? emptyAccount(accountId);
  const cap = Number.isFinite(capUsd) && capUsd >= 0 ? Math.round(capUsd * 100) / 100 : account.spendingCapUsd;
  return { ...state, accounts: { ...state.accounts, [account.id]: { ...account, spendingCapUsd: cap } } };
}

export function setPaidConsent(state: LedgerState, accountId: string, consent: boolean): LedgerState {
  const account = state.accounts[accountId] ?? emptyAccount(accountId);
  return { ...state, accounts: { ...state.accounts, [account.id]: { ...account, paidConsent: consent } } };
}

const USAGE_KEYS = [
  "id",
  "accountId",
  "requestId",
  "routeMode",
  "requestedProvider",
  "finalProvider",
  "estimatedTokens",
  "actualTokens",
  "estimatedCostUsd",
  "actualCostUsd",
  "creditsReserved",
  "creditsSettled",
  "creditsRefunded",
  "status",
  "createdAt",
] as const;

/** Drops prompt, output, keys, and any other field before a row is stored. */
export function scrubUsage(input: Record<string, unknown>, nowIso: string): UsageEvent {
  const picked: Record<string, unknown> = {};
  for (const key of USAGE_KEYS) {
    if (key in input) picked[key] = input[key];
  }
  return {
    id: String(picked.id ?? `evt_${nowIso}`),
    accountId: String(picked.accountId ?? LOCAL_ACCOUNT),
    requestId: String(picked.requestId ?? ""),
    routeMode: (picked.routeMode as RouteMode) ?? "sandbox",
    requestedProvider: String(picked.requestedProvider ?? "sandbox"),
    finalProvider: picked.finalProvider ? String(picked.finalProvider) : undefined,
    estimatedTokens: Number(picked.estimatedTokens ?? 0),
    actualTokens: picked.actualTokens == null ? undefined : Number(picked.actualTokens),
    estimatedCostUsd: Number(picked.estimatedCostUsd ?? 0),
    actualCostUsd: picked.actualCostUsd == null ? undefined : Number(picked.actualCostUsd),
    creditsReserved: Number(picked.creditsReserved ?? 0),
    creditsSettled: Number(picked.creditsSettled ?? 0),
    creditsRefunded: Number(picked.creditsRefunded ?? 0),
    status: (picked.status as UsageEvent["status"]) ?? "rejected",
    createdAt: String(picked.createdAt ?? nowIso),
  };
}
