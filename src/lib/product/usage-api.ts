import { createServerFn } from "@tanstack/react-start";
import type { ProviderId } from "../ai/catalog.ts";
import { executeAi } from "../ai/run.ts";
import { applyMockBilling, billingModeOf, economySurface } from "./billing-mode.ts";
import {
  LOCAL_ACCOUNT,
  refundCredits,
  reserveCredits,
  setPaidConsent,
  setSpendingCap,
  settleCredits,
  type BillingCommand,
} from "./ledger.ts";
import { getEconomy, setEconomy } from "./memory.ts";
import { measuredRunSecrets, managedExecutionPlan } from "./measured-key.ts";
import { metricFrom } from "./metrics.ts";
import { estimateCostUsd, estimateTokens, planById } from "./plans.ts";
import { billUsage } from "./usage.ts";
import { circuitOpen, consumeFree, noteProviderFailure } from "./quota.ts";
import { policyById } from "./registry.ts";
import { buildTrace, decideRoute, type PlanId, type RoutePrefer, type RouteTrace } from "./routing.ts";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type EconomyRequest = {
  action: "snapshot" | "run" | "checkout" | "complete" | "cap" | "webhook" | "metric";
  prefer?: RoutePrefer;
  freeConsent?: boolean;
  paidConsent?: boolean;
  idempotencyKey?: string;
  messages?: ChatMessage[];
  byokProvider?: ProviderId;
  byokModel?: string;
  byokKey?: string;
  planId?: PlanId;
  spendingCapUsd?: number;
  metric?: Record<string, unknown>;
  webhookBody?: string;
  webhookSignature?: string;
};

export type UsageSnapshot = {
  planId: PlanId;
  creditsAvailable: number;
  creditsReserved: number;
  freeRemainingToday: number;
  freeDailyCap: number;
  spendingCapUsd: number;
  spentMonthUsd: number;
  billingProblem: boolean;
  stripeConfigured: boolean;
  billingMode: "mock" | "disabled" | "hosted";
  economyStore: "memory" | "sql";
  priceConfigured: boolean;
  lastTrace: RouteTrace | null;
  runs: number;
  usageConfidence?: "actual" | "estimated" | "unknown";
};

function requestId(key?: string) {
  if (key && /^idem_[A-Za-z0-9_-]{8,80}$/.test(key)) return key;
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function snapshot(): UsageSnapshot {
  const surface = economySurface(process.env);
  const economy = getEconomy();
  const account = economy.ledger.accounts[LOCAL_ACCOUNT];
  const plan = planById(account.planId);
  const day = new Date().toISOString().slice(0, 10);
  const used = economy.quota.day === day ? economy.quota.used : 0;
  return {
    planId: surface.economyStore === "sql" ? "free" : account.planId,
    creditsAvailable: surface.economyStore === "sql" ? 0 : account.credits,
    creditsReserved: surface.economyStore === "sql" ? 0 : account.reserved,
    freeRemainingToday: Math.max(0, plan.freeDailyCap - used),
    freeDailyCap: plan.freeDailyCap,
    spendingCapUsd: surface.economyStore === "sql" ? 0 : account.spendingCapUsd,
    spentMonthUsd: surface.economyStore === "sql" ? 0 : account.spentMonthUsd,
    billingProblem: surface.economyStore === "sql" ? false : account.billingProblem,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    billingMode: surface.billingMode,
    economyStore: surface.economyStore,
    priceConfigured: planById("pro").priceUsd != null,
    lastTrace: surface.economyStore === "sql" ? null : economy.lastTrace,
    runs: surface.economyStore === "sql" ? 0 : economy.runs,
    usageConfidence: economy.lastTrace?.usageConfidence,
  };
}

function sanitize(message: string) {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|rk|hf_|xai-)[A-Za-z0-9._\-]{6,}\b/g, "[redacted]")
    .slice(0, 280);
}

export const economyApi = createServerFn({ method: "POST" })
  .validator((input: EconomyRequest) => {
    const action = input?.action;
    if (!action || !["snapshot", "run", "checkout", "complete", "cap", "webhook", "metric"].includes(action)) {
      throw new Error("Yêu cầu không hợp lệ");
    }
    return input;
  })
  .handler(async ({ data }) => {
    if (process.env.DATABASE_URL?.trim()) {
      return {
        ok: false as const,
        error: "Hosted mode không dùng LOCAL_ACCOUNT. Đăng nhập rồi gọi hosted economy. Thanh toán thật vẫn tắt.",
        snapshot: snapshot(),
      };
    }
    if (data.action === "snapshot") return { ok: true as const, snapshot: snapshot() };

    if (data.action === "metric") {
      const event = metricFrom(data.metric ?? {}, new Date().toISOString());
      return { ok: Boolean(event), snapshot: snapshot() };
    }

    if (data.action === "cap") {
      const economy = getEconomy();
      setEconomy({ ...economy, ledger: setSpendingCap(economy.ledger, LOCAL_ACCOUNT, Number(data.spendingCapUsd ?? 0)) });
      return { ok: true as const, snapshot: snapshot() };
    }

    if (data.action === "checkout" || data.action === "complete" || data.action === "webhook") {
      if (billingModeOf(process.env) === "disabled") {
        return {
          ok: false as const,
          error: "Mock billing tắt trên production. Không đổi gói và không cộng tín dụng.",
          snapshot: snapshot(),
        };
      }
    }

    if (data.action === "checkout") {
      return {
        ok: true as const,
        checkout: {
          mode: "mock" as const,
          url: "",
          message: "Stripe chưa cấu hình. Bản thử không trừ tiền thật.",
          planId: data.planId === "team" ? "team" as const : "pro" as const,
        },
        snapshot: snapshot(),
      };
    }

    if (data.action === "complete" || data.action === "webhook") {
      const stripe = await import("./stripe-webhook.ts");
      let command: BillingCommand | null = null;
      if (data.action === "webhook") {
        const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
        if (!stripe.verifyStripeSignature(data.webhookBody ?? "", data.webhookSignature ?? null, secret)) {
          return { ok: false as const, error: "Chữ ký webhook không hợp lệ", snapshot: snapshot() };
        }
        command = stripe.commandFromStripeEvent(data.webhookBody ?? "", LOCAL_ACCOUNT);
      } else {
        const plan = data.planId === "team" ? "team" : "pro";
        command = {
          type: "checkout.completed" as const,
          eventId: data.idempotencyKey && data.idempotencyKey.startsWith("idem_") ? data.idempotencyKey : `idem_mock_${plan}`,
          accountId: LOCAL_ACCOUNT,
          planId: plan as "pro" | "team",
        };
      }
      if (!command) return { ok: false as const, error: "Sự kiện không được xử lý", snapshot: snapshot() };
      const economy = getEconomy();
      const applied = applyMockBilling(economy.ledger, economy.webhookIds, command, process.env);
      if (!applied.ok) return { ok: false as const, error: applied.error, snapshot: snapshot() };
      setEconomy({ ...economy, ledger: applied.state, webhookIds: applied.seen });
      return { ok: true as const, duplicate: applied.duplicate, snapshot: snapshot() };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const economy = getEconomy();
    const account = economy.ledger.accounts[LOCAL_ACCOUNT];
    const plan = planById(account.planId);
    const prefer = data.prefer ?? "sandbox";
    const providerForCircuit = prefer === "free" ? "pollinations" : prefer === "managed" ? "xai" : data.byokProvider ?? "sandbox";
    const ledger = data.paidConsent ? setPaidConsent(economy.ledger, LOCAL_ACCOUNT, true) : economy.ledger;
    const dayUsed = economy.quota.day === nowIso.slice(0, 10) ? economy.quota.used : 0;
    const decision = decideRoute({
      intent: "user-run",
      prefer,
      byokProvider: data.byokProvider,
      byokModel: data.byokModel,
      byokHasKey: Boolean(data.byokKey && data.byokKey.trim()),
      freeConsent: Boolean(data.freeConsent),
      paidConsent: Boolean(data.paidConsent),
      entitlement: ledger.accounts[LOCAL_ACCOUNT].planId,
      freeRemaining: Math.max(0, plan.freeDailyCap - dayUsed),
      circuitOpen: circuitOpen(economy.quota, providerForCircuit, now.getTime()),
      nowIso,
    });
    const id = requestId(data.idempotencyKey);
    const existing = ledger.holds[id];
    if (existing && (existing.status === "settled" || existing.status === "refunded" || existing.status === "reserved")) {
      return {
        ok: false as const,
        error: "Request này đã được giữ hoặc đã chốt. Không gọi nhà cung cấp lần nữa.",
        decision,
        trace: economy.lastTrace,
        snapshot: snapshot(),
      };
    }

    if (decision.mode === "sandbox") {
      const trace = buildTrace(id, "sandbox", decision, 0, 0);
      setEconomy({ ...economy, ledger, lastTrace: trace });
      return { ok: true as const, local: true as const, decision, trace, snapshot: snapshot() };
    }
    if (decision.mode === "blocked") {
      const trace = buildTrace(id, prefer, decision, 0, null);
      setEconomy({ ...economy, ledger, lastTrace: trace });
      return { ok: false as const, error: decision.reason, decision, trace, snapshot: snapshot() };
    }

    const policy = policyById(decision.provider === "none" ? "sandbox" : decision.provider);
    const chars = (data.messages ?? []).reduce((sum, item) => sum + (item.content?.length ?? 0), 0);
    const estimatedTokens = estimateTokens(chars, policy?.maxTokens ?? 800);
    const estimatedCostUsd = estimateCostUsd(policy?.estimatedCostPer1kTokens ?? 0, chars, policy?.maxTokens ?? 800);
    let quota = economy.quota;
    if (decision.mode === "free-public") {
      const consumed = consumeFree(quota, now.getTime(), plan.freeDailyCap, plan.perMinuteCap);
      if (!consumed.ok) {
        const blocked = decideRoute({
          intent: "user-run",
          prefer: "free",
          byokHasKey: false,
          freeConsent: true,
          paidConsent: false,
          entitlement: account.planId,
          freeRemaining: 0,
          circuitOpen: false,
          nowIso,
        });
        const trace = buildTrace(id, "pollinations", blocked, 0, null);
        setEconomy({ ...economy, ledger, lastTrace: trace });
        return { ok: false as const, error: consumed.reason ?? blocked.reason, decision: blocked, trace, snapshot: snapshot() };
      }
      quota = consumed.state;
    }

    const reserved = reserveCredits(ledger, {
      accountId: LOCAL_ACCOUNT,
      requestId: id,
      routeMode: decision.mode,
      requestedProvider: decision.provider,
      estimatedTokens,
      estimatedCostUsd,
      nowIso,
    });
    if (!reserved.ok || reserved.duplicate) {
      const reason = reserved.reason ?? "Request đã được giữ. Không gọi nhà cung cấp lần nữa.";
      const trace = buildTrace(id, String(decision.provider), { ...decision, mode: "blocked", provider: "none", reason }, estimatedCostUsd, null);
      setEconomy({ ...economy, ledger, quota, lastTrace: trace });
      return { ok: false as const, error: reason, decision, trace, snapshot: snapshot() };
    }

    setEconomy({ ...economy, ledger: reserved.state, quota, lastTrace: buildTrace(id, String(decision.provider), decision, estimatedCostUsd, null) });

    try {
      const model = decision.mode === "byok" ? data.byokModel || "" : decision.model;
      const secrets = measuredRunSecrets(decision.mode, data.byokKey, process.env);
      const plan = managedExecutionPlan(decision.mode, secrets);
      if (plan.action === "refund") {
        const refunded = refundCredits(reserved.state, { requestId: id, nowIso, reason: "missing-server-key" });
        const trace = buildTrace(id, String(decision.provider), decision, estimatedCostUsd, 0);
        trace.reason = "Route trả phí chưa có key server. Không lấy key từ request thường và không chuyển sang free.";
        trace.usageConfidence = "unknown";
        setEconomy({ ...getEconomy(), ledger: refunded.state, quota, lastTrace: trace });
        return { ok: false as const, error: trace.reason, decision, trace, snapshot: snapshot() };
      }
      const result = await executeAi({
        provider: decision.provider as ProviderId,
        model,
        messages: (data.messages ?? []).slice(0, 8),
        userKey: plan.userKey,
        maxTokens: policy?.maxTokens ?? 800,
        allowFallback: false,
      }, {
        managedServerKey: plan.managedServerKey,
        idempotencyKey: decision.mode === "managed-paid" ? id : undefined,
      });
      const billed = billUsage({
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        estimatedCostUsd,
      });
      const actualCost = decision.mode === "managed-paid" ? billed.costUsd : 0;
      const settled = settleCredits(getEconomy().ledger, {
        requestId: id,
        actualCostUsd: actualCost,
        actualTokens: billed.actualTokens,
        finalProvider: result.provider,
        nowIso,
      });
      const trace = buildTrace(id, String(decision.provider), decision, estimatedCostUsd, actualCost);
      trace.finalProvider = result.provider;
      trace.fellBack = Boolean(result.fallback);
      trace.usageConfidence = decision.mode === "managed-paid" ? billed.confidence : result.usageConfidence ?? "unknown";
      if (billed.confidence !== "actual" && decision.mode === "managed-paid") {
        trace.reason = "Chưa có usage thực từ provider. Đang chốt theo ước tính, không phải hóa đơn hãng.";
      }
      if (result.fallback) trace.reason = `Đã chuyển sang ${result.fallback}. Không im lặng.`;
      const current = getEconomy();
      setEconomy({ ...current, ledger: settled.state, quota, lastTrace: trace, runs: current.runs + 1 });
      return {
        ok: true as const,
        decision,
        trace,
        output: {
          text: result.text,
          provider: result.provider,
          model: result.model,
          fallback: result.fallback,
          latencyMs: result.latencyMs,
          requestId: result.requestId ?? id,
        },
        snapshot: snapshot(),
      };
    } catch (error) {
      const current = getEconomy();
      const refunded = refundCredits(current.ledger, { requestId: id, nowIso, reason: "provider-error" });
      const quotaNext = decision.mode === "free-public" ? noteProviderFailure(quota, "pollinations", now.getTime()) : current.quota;
      const trace = buildTrace(id, String(decision.provider), decision, estimatedCostUsd, 0);
      trace.reason = sanitize(error instanceof Error ? error.message : "Lỗi nhà cung cấp");
      setEconomy({ ...current, ledger: refunded.state, quota: quotaNext, lastTrace: trace });
      return { ok: false as const, error: trace.reason, decision, trace, snapshot: snapshot() };
    }
  });

