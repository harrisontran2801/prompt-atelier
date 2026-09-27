import { creditsForCost, planById, type PlanEnv } from "./plans.ts";
import type { PlanId, RouteMode } from "./routing.ts";
import { rateBucketKey, scrubSpan, type EconomySpan } from "./spans.ts";
import { LOCAL_ACCOUNT } from "./ledger.ts";

export type Queryable = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
};

type AccountRow = {
  org_id: string;
  plan_id: string;
  credits_available: number;
  credits_reserved: number;
  spending_cap_usd: string | number;
  spent_month_usd: string | number;
  billing_problem: boolean;
  paid_consent: boolean;
};

function money(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asPlan(value: string): PlanId {
  return value === "pro" || value === "team" ? value : "free";
}

export type SqlAccount = {
  orgId: string;
  planId: PlanId;
  creditsAvailable: number;
  creditsReserved: number;
  spendingCapUsd: number;
  spentMonthUsd: number;
  billingProblem: boolean;
  paidConsent: boolean;
};

function mapAccount(row: AccountRow): SqlAccount {
  return {
    orgId: row.org_id,
    planId: asPlan(row.plan_id),
    creditsAvailable: Number(row.credits_available),
    creditsReserved: Number(row.credits_reserved),
    spendingCapUsd: money(row.spending_cap_usd),
    spentMonthUsd: money(row.spent_month_usd),
    billingProblem: Boolean(row.billing_problem),
    paidConsent: Boolean(row.paid_consent),
  };
}

export async function readAccount(db: Queryable, orgId: string): Promise<SqlAccount | null> {
  const rows = await db.query<AccountRow>("select * from billing_accounts where org_id = $1", [orgId]);
  return rows[0] ? mapAccount(rows[0]) : null;
}

export async function ensurePersonalOrg(db: Queryable, userId: string) {
  if (!userId || userId === LOCAL_ACCOUNT) throw new Error("LOCAL_ACCOUNT không dùng cho hosted billing.");
  return db.transaction(async (tx) => {
    const existing = await tx.query<{ org_id: string }>("select org_id from billing_memberships where user_id = $1", [userId]);
    if (existing[0]) return existing[0].org_id;
    const orgId = `org_${userId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48)}`;
    await tx.query("insert into billing_orgs (id, name) values ($1, $2)", [orgId, "personal"]);
    await tx.query("insert into billing_memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, userId]);
    await tx.query("insert into billing_accounts (org_id) values ($1)", [orgId]);
    return orgId;
  });
}

export type SqlReserveInput = {
  orgId: string;
  requestId: string;
  routeMode: RouteMode;
  requestedProvider: string;
  estimatedTokens: number;
  estimatedCostUsd: number;
  priceVersion: string;
};

export async function reserveHosted(db: Queryable, input: SqlReserveInput) {
  if (input.orgId === LOCAL_ACCOUNT) return { ok: false as const, duplicate: false, reason: "LOCAL_ACCOUNT không dùng cho hosted billing." };
  return db.transaction(async (tx) => {
    const locked = await tx.query<AccountRow>("select * from billing_accounts where org_id = $1 for update", [input.orgId]);
    const row = locked[0];
    if (!row) return { ok: false as const, duplicate: false, reason: "Không thấy tài khoản billing." };
    const hold = await tx.query<{ status: string }>("select status from hosted_holds where org_id = $1 and request_id = $2", [input.orgId, input.requestId]);
    if (hold[0]) return { ok: false as const, duplicate: true, reason: "Request đã được giữ. Không gọi nhà cung cấp lần nữa." };
    const account = mapAccount(row);
    const credits = input.routeMode === "managed-paid" ? creditsForCost(input.estimatedCostUsd) : 0;
    if (input.routeMode === "managed-paid") {
      if (account.billingProblem) return { ok: false as const, duplicate: false, reason: "Hóa đơn lỗi. Tạm dừng route trả phí." };
      if (account.planId === "free") return { ok: false as const, duplicate: false, reason: "Gói Free không giữ tín dụng trả phí." };
      if (account.spentMonthUsd + input.estimatedCostUsd > account.spendingCapUsd) {
        return { ok: false as const, duplicate: false, reason: "Vượt trần chi tiêu tháng này." };
      }
      if (account.creditsAvailable < credits) return { ok: false as const, duplicate: false, reason: "Không đủ tín dụng." };
    }
    await tx.query(
      `insert into hosted_holds (org_id, request_id, credits, estimated_cost_usd, route_mode, requested_provider, estimated_tokens, price_version, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'reserved')`,
      [input.orgId, input.requestId, credits, input.estimatedCostUsd, input.routeMode, input.requestedProvider, input.estimatedTokens, input.priceVersion],
    );
    await tx.query(
      `insert into hosted_credit_ledger (id, org_id, request_id, kind, credits, idempotency_key, metadata)
       values ($1,$2,$3,'reserve',$4,$5,$6)`,
      [
        `led_${input.orgId}_${input.requestId}_reserve`,
        input.orgId,
        input.requestId,
        credits,
        `reserve:${input.orgId}:${input.requestId}`,
        JSON.stringify({ routeMode: input.routeMode, provider: input.requestedProvider, priceVersion: input.priceVersion }),
      ],
    );
    await tx.query(
      `update billing_accounts
       set credits_available = credits_available - $2, credits_reserved = credits_reserved + $2, updated_at = now()
       where org_id = $1`,
      [input.orgId, credits],
    );
    return { ok: true as const, duplicate: false, credits };
  });
}

export async function claimDispatch(db: Queryable, orgId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const existing = await tx.query("select request_id from hosted_dispatches where org_id = $1 and request_id = $2", [orgId, requestId]);
    if (existing[0]) return false;
    await tx.query("insert into hosted_dispatches (org_id, request_id) values ($1, $2)", [orgId, requestId]);
    return true;
  });
}

export async function settleHosted(
  db: Queryable,
  input: {
    orgId: string;
    requestId: string;
    actualCostUsd: number;
    actualTokens?: number;
    finalProvider?: string;
    usageConfidence: string;
    providerRequestId?: string;
  },
) {
  return db.transaction(async (tx) => {
    const holds = await tx.query<{
      credits: number;
      estimated_cost_usd: string | number;
      route_mode: string;
      requested_provider: string;
      estimated_tokens: number;
      price_version: string;
      status: string;
    }>("select * from hosted_holds where org_id = $1 and request_id = $2 for update", [input.orgId, input.requestId]);
    const hold = holds[0];
    if (!hold) return { ok: false as const, duplicate: false, reason: "Không có khoản giữ." };
    if (hold.status === "settled" || hold.status === "refunded") return { ok: true as const, duplicate: true };
    const actual = Number.isFinite(input.actualCostUsd) && input.actualCostUsd > 0 ? input.actualCostUsd : 0;
    const priced = hold.credits === 0 ? 0 : Math.min(Number(hold.credits), actual === 0 ? 0 : creditsForCost(actual));
    const refund = Number(hold.credits) - priced;
    await tx.query(
      `update billing_accounts
       set credits_available = credits_available + $2,
           credits_reserved = greatest(0, credits_reserved - $3),
           spent_month_usd = spent_month_usd + $4,
           updated_at = now()
       where org_id = $1`,
      [input.orgId, refund, Number(hold.credits), actual],
    );
    await tx.query(
      `update hosted_holds set status = 'settled', actual_cost_usd = $3, settled_credits = $4 where org_id = $1 and request_id = $2`,
      [input.orgId, input.requestId, actual, priced],
    );
    await tx.query(
      `insert into hosted_credit_ledger (id, org_id, request_id, kind, credits, idempotency_key, metadata)
       values ($1,$2,$3,'settle',$4,$5,$6)`,
      [
        `led_${input.orgId}_${input.requestId}_settle`,
        input.orgId,
        input.requestId,
        priced,
        `settle:${input.orgId}:${input.requestId}`,
        JSON.stringify({ provider: hold.requested_provider, confidence: input.usageConfidence, priceVersion: hold.price_version }),
      ],
    );
    await tx.query(
      `insert into hosted_usage_events (
         id, org_id, request_id, route_mode, requested_provider, final_provider, estimated_tokens, actual_tokens,
         estimated_cost_usd, actual_cost_usd, credits_reserved, credits_settled, credits_refunded, status, usage_confidence, price_version, provider_request_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'settled',$14,$15,$16)`,
      [
        `use_${input.orgId}_${input.requestId}_settle`,
        input.orgId,
        input.requestId,
        hold.route_mode,
        hold.requested_provider,
        input.finalProvider ?? null,
        hold.estimated_tokens,
        input.actualTokens ?? null,
        money(hold.estimated_cost_usd),
        actual,
        Number(hold.credits),
        priced,
        refund,
        input.usageConfidence,
        hold.price_version,
        input.providerRequestId ?? null,
      ],
    );
    return { ok: true as const, duplicate: false, creditsSettled: priced, creditsRefunded: refund };
  });
}

export async function refundHosted(db: Queryable, orgId: string, requestId: string) {
  return db.transaction(async (tx) => {
    const holds = await tx.query<{ credits: number; status: string; estimated_cost_usd: string | number; route_mode: string; requested_provider: string; estimated_tokens: number; price_version: string }>(
      "select * from hosted_holds where org_id = $1 and request_id = $2 for update",
      [orgId, requestId],
    );
    const hold = holds[0];
    if (!hold) return { ok: false as const, duplicate: false, reason: "Không có khoản giữ để hoàn." };
    if (hold.status === "refunded") return { ok: true as const, duplicate: true };
    if (hold.status === "settled") return { ok: false as const, duplicate: false, reason: "Đã chốt, không hoàn lại bằng retry." };
    await tx.query(
      `update billing_accounts
       set credits_available = credits_available + $2, credits_reserved = greatest(0, credits_reserved - $2), updated_at = now()
       where org_id = $1`,
      [orgId, Number(hold.credits)],
    );
    await tx.query("update hosted_holds set status = 'refunded', settled_credits = 0 where org_id = $1 and request_id = $2", [orgId, requestId]);
    await tx.query(
      `insert into hosted_credit_ledger (id, org_id, request_id, kind, credits, idempotency_key, metadata)
       values ($1,$2,$3,'refund',$4,$5,$6)`,
      [ `led_${orgId}_${requestId}_refund`, orgId, requestId, Number(hold.credits), `refund:${orgId}:${requestId}`, JSON.stringify({ provider: hold.requested_provider }) ],
    );
    return { ok: true as const, duplicate: false };
  });
}

export async function takeRateLimit(db: Queryable, orgId: string, route: string, nowMs: number, limit: number) {
  const key = rateBucketKey(orgId, route, nowMs);
  const rows = await db.query<{ hits: number }>(
    `insert into hosted_rate_buckets (bucket_key, hits, window_start) values ($1, 1, now())
     on conflict (bucket_key) do update set hits = hosted_rate_buckets.hits + 1
     returning hits`,
    [key],
  );
  return { ok: Number(rows[0]?.hits ?? 1) <= limit, key };
}

export async function writeSpan(db: Queryable, input: Record<string, unknown>) {
  const span: EconomySpan | null = scrubSpan(input);
  if (!span) return null;
  await db.query(
    `insert into hosted_spans (id, org_id, request_id, name, provider, model, input_tokens, output_tokens, latency_ms, usage_confidence)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      `sp_${span.orgId}_${span.requestId}_${span.name}`,
      span.orgId,
      span.requestId,
      span.name,
      span.provider ?? null,
      span.model ?? null,
      span.inputTokens ?? null,
      span.outputTokens ?? null,
      span.latencyMs ?? null,
      span.usageConfidence ?? null,
    ],
  );
  return span;
}

export type MappedStripeEvent = {
  eventId: string;
  type: "checkout.completed" | "subscription.canceled" | "invoice.paid" | "invoice.failed";
  orgId: string;
  invoiceId?: string;
  planId?: PlanId;
};

export async function applyMappedStripeEvent(db: Queryable, event: MappedStripeEvent, env?: PlanEnv) {
  if (!event.orgId || event.orgId === LOCAL_ACCOUNT) {
    return { ok: false as const, duplicate: false, error: "Webhook không nhận LOCAL_ACCOUNT hoặc org tùy ý." };
  }
  return db.transaction(async (tx) => {
    const locked = await tx.query<AccountRow>("select * from billing_accounts where org_id = $1 for update", [event.orgId]);
    const account = locked[0] ? mapAccount(locked[0]) : null;
    if (!account) return { ok: false as const, duplicate: false, error: "Không thấy tài khoản billing." };
    const dup = await tx.query(
      `select provider_event_id from provider_billing_events
       where provider_event_id = $1 or ($2::text is not null and invoice_id = $2 and event_type = 'invoice.paid')`,
      [event.eventId, event.type === "invoice.paid" ? event.invoiceId ?? null : null],
    );
    if (dup[0]) return { ok: true as const, duplicate: true };
    await tx.query(
      "insert into provider_billing_events (provider_event_id, org_id, event_type, invoice_id) values ($1,$2,$3,$4)",
      [event.eventId, event.orgId, event.type, event.invoiceId ?? null],
    );
    if (event.type === "checkout.completed") {
      const plan = planById(event.planId ?? "pro", env);
      await tx.query(
        `update billing_accounts
         set plan_id = $2, credits_available = $3, spending_cap_usd = case when spending_cap_usd > 0 then spending_cap_usd else 10 end,
             billing_problem = false, updated_at = now()
         where org_id = $1`,
        [event.orgId, plan.id, Math.max(0, plan.monthlyCredits - account.creditsReserved)],
      );
    } else if (event.type === "subscription.canceled") {
      await tx.query(
        `update billing_accounts set plan_id = 'free', spending_cap_usd = 0, paid_consent = false, updated_at = now() where org_id = $1`,
        [event.orgId],
      );
    } else if (event.type === "invoice.failed") {
      await tx.query("update billing_accounts set billing_problem = true, updated_at = now() where org_id = $1", [event.orgId]);
    } else if (event.type === "invoice.paid") {
      const plan = planById(account.planId, env);
      await tx.query(
        `update billing_accounts
         set credits_available = $2, spent_month_usd = 0, billing_problem = false, updated_at = now()
         where org_id = $1`,
        [event.orgId, Math.max(0, plan.monthlyCredits - account.creditsReserved)],
      );
    }
    return { ok: true as const, duplicate: false };
  });
}

export async function orgForStripeCustomer(db: Queryable, customerId: string) {
  const rows = await db.query<{ org_id: string }>("select org_id from stripe_customer_map where stripe_customer_id = $1", [customerId]);
  return rows[0]?.org_id ?? null;
}
