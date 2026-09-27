import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { economySurface } from "./billing-mode.ts";
import { managedExecutionPlan, measuredRunSecrets } from "./measured-key.ts";
import { retryDecision } from "./retry-policy.ts";
import { genAiAttributes, rateBucketKey, scrubSpan } from "./spans.ts";
import {
  applyMappedStripeEvent,
  claimDispatch,
  readAccount,
  refundHosted,
  reserveHosted,
  settleHosted,
  takeRateLimit,
  writeSpan,
  type Queryable,
} from "./sql-economy.ts";
import { hostedStripeIntent, stripeCustomerId } from "./stripe-intent.ts";
import { verifyStripeSignature } from "./stripe-webhook.ts";
import { scopeHostedRequest } from "./tenant.ts";
import { billUsage, parseGeminiUsage, parseOpenAiUsage } from "./usage.ts";
import { LOCAL_ACCOUNT } from "./ledger.ts";

const schema = readFileSync(new URL("../../../migrations/0003_hosted_economy.sql", import.meta.url), "utf8");

function adapter(pg: PGlite): Queryable {
  return {
    query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
      (await pg.query(text, params ?? [])).rows as T[],
    transaction: (fn) =>
      pg.transaction(async (tx) => {
        const bound: Queryable = {
          query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
            (await tx.query(text, params ?? [])).rows as T[],
          transaction: (inner) => inner(bound),
        };
        return fn(bound);
      }),
  };
}

async function openDb() {
  const pg = new PGlite();
  await pg.exec(schema);
  return { pg, db: adapter(pg) };
}

async function seed(db: Queryable, orgId: string, credits: number) {
  await db.query("insert into billing_orgs (id, name) values ($1, $2)", [orgId, orgId]);
  await db.query(
    "insert into billing_accounts (org_id, plan_id, credits_available, spending_cap_usd, paid_consent) values ($1, 'pro', $2, 10, true)",
    [orgId, credits],
  );
  await db.query("insert into billing_memberships (org_id, user_id, role) values ($1, $2, 'owner')", [orgId, `user_${orgId}`]);
}

describe("hosted economy", () => {
  it("keeps two orgs apart and rejects a foreign reserve", async () => {
    const { db } = await openDb();
    await seed(db, "org_a", 500);
    await seed(db, "org_b", 500);
    const memberships = [
      { userId: "user_org_a", orgId: "org_a", role: "owner" as const },
      { userId: "user_org_b", orgId: "org_b", role: "owner" as const },
    ];
    const denied = scopeHostedRequest("user_org_a", "org_b", memberships);
    assert.equal(denied.ok, false);
    const allowed = scopeHostedRequest("user_org_a", undefined, memberships);
    assert.equal(allowed.ok, true);
    if (!allowed.ok) return;
    const reserved = await reserveHosted(db, {
      orgId: allowed.orgId,
      requestId: "idem_org_a_123456",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 100,
      estimatedCostUsd: 0.05,
      priceVersion: "2026-09-28",
    });
    assert.equal(reserved.ok, true);
    const a = await readAccount(db, "org_a");
    const b = await readAccount(db, "org_b");
    assert.equal(a?.creditsAvailable, 450);
    assert.equal(b?.creditsAvailable, 500);
    const local = scopeHostedRequest("user_org_a", LOCAL_ACCOUNT, [
      { userId: "user_org_a", orgId: LOCAL_ACCOUNT, role: "owner" },
    ]);
    assert.equal(local.ok, false);
  });

  it("does not overspend when two reserves race", async () => {
    const { db } = await openDb();
    await seed(db, "org_race", 100);
    const one = {
      orgId: "org_race",
      routeMode: "managed-paid" as const,
      requestedProvider: "xai",
      estimatedTokens: 80,
      estimatedCostUsd: 0.08,
      priceVersion: "2026-09-28",
    };
    const results = await Promise.all([
      reserveHosted(db, { ...one, requestId: "idem_race_aaaaaaaa" }),
      reserveHosted(db, { ...one, requestId: "idem_race_bbbbbbbb" }),
    ]);
    const wins = results.filter((item) => item.ok);
    assert.equal(wins.length, 1);
    const account = await readAccount(db, "org_race");
    assert.ok((account?.creditsAvailable ?? -1) >= 0);
    assert.equal((account?.creditsAvailable ?? 0) + (account?.creditsReserved ?? 0), 100);
  });

  it("does not call the provider twice for one request id", async () => {
    const { db } = await openDb();
    await seed(db, "org_once", 500);
    let calls = 0;
    const run = async () => {
      const claimed = await claimDispatch(db, "org_once", "idem_once_12345678");
      if (!claimed) return;
      calls += 1;
    };
    await run();
    await run();
    assert.equal(calls, 1);
  });

  it("grants an invoice once, then blocks paid reserve after a failure", async () => {
    const { db } = await openDb();
    await seed(db, "org_bill", 10);
    const paid = await applyMappedStripeEvent(db, {
      eventId: "evt_paid_1",
      type: "invoice.paid",
      orgId: "org_bill",
      invoiceId: "in_1",
    });
    assert.equal(paid.ok, true);
    assert.equal(paid.duplicate, false);
    const again = await applyMappedStripeEvent(db, {
      eventId: "evt_paid_2",
      type: "invoice.paid",
      orgId: "org_bill",
      invoiceId: "in_1",
    });
    assert.equal(again.duplicate, true);
    const afterPaid = await readAccount(db, "org_bill");
    assert.equal(afterPaid?.creditsAvailable, 2000);
    const failed = await applyMappedStripeEvent(db, {
      eventId: "evt_fail_1",
      type: "invoice.failed",
      orgId: "org_bill",
      invoiceId: "in_2",
    });
    assert.equal(failed.ok, true);
    const denied = await reserveHosted(db, {
      orgId: "org_bill",
      requestId: "idem_after_fail_1234",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 10,
      estimatedCostUsd: 0.02,
      priceVersion: "2026-09-28",
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason ?? "", /Hóa đơn/);
    const local = await applyMappedStripeEvent(db, {
      eventId: "evt_local",
      type: "invoice.paid",
      orgId: LOCAL_ACCOUNT,
      invoiceId: "in_local",
    });
    assert.equal(local.ok, false);
  });

  it("refunds a zero actual cost and keeps state after the database reopens", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atelier-econ-"));
    const pg = new PGlite(dir);
    await pg.exec(schema);
    const db = adapter(pg);
    await seed(db, "org_disk", 200);
    const reserved = await reserveHosted(db, {
      orgId: "org_disk",
      requestId: "idem_disk_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 40,
      estimatedCostUsd: 0.04,
      priceVersion: "2026-09-28",
    });
    assert.equal(reserved.ok, true);
    const settled = await settleHosted(db, {
      orgId: "org_disk",
      requestId: "idem_disk_12345678",
      actualCostUsd: 0,
      usageConfidence: "estimated",
      finalProvider: "xai",
    });
    assert.equal(settled.ok, true);
    if (!("creditsRefunded" in settled)) return;
    assert.equal(settled.creditsRefunded, 40);
    await pg.close();
    const reopened = new PGlite(dir);
    const rows = await reopened.query<{ credits_available: number }>("select credits_available from billing_accounts where org_id = $1", ["org_disk"]);
    assert.equal(Number(rows.rows[0].credits_available), 200);
    await reopened.close();
  });

  it("keeps prompts and keys out of spans and separates rate buckets", async () => {
    const { db } = await openDb();
    await seed(db, "org_span", 10);
    const span = await writeSpan(db, {
      name: "provider",
      orgId: "org_span",
      requestId: "idem_span_123456",
      provider: "xai",
      model: "grok-4-fast",
      inputTokens: 12,
      outputTokens: 4,
      prompt: "secret prompt",
      apiKey: "xai-secret",
      usageConfidence: "actual",
    });
    assert.equal(span?.provider, "xai");
    assert.equal(JSON.stringify(span).includes("secret prompt"), false);
    const rows = await db.query<{ provider: string }>("select provider, model, input_tokens from hosted_spans where org_id = $1", ["org_span"]);
    assert.equal(JSON.stringify(rows).includes("secret"), false);
    assert.equal("prompt" in genAiAttributes(span!), false);
    const a = await takeRateLimit(db, "org_span", "xai", 1_700_000_000_000, 2);
    const b = await takeRateLimit(db, "org_other", "xai", 1_700_000_000_000, 2);
    assert.notEqual(a.key, b.key);
    assert.notEqual(rateBucketKey("org_span", "xai", 1_700_000_000_000), rateBucketKey("org_other", "xai", 1_700_000_000_000));
  });
});

describe("usage, retry, and billing surface", () => {
  it("parses provider usage and does not call an estimate actual", () => {
    const openai = parseOpenAiUsage({
      id: "chatcmpl_1",
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 30, completion_tokens_details: { reasoning_tokens: 2 }, prompt_tokens_details: { cached_tokens: 4 } },
    });
    assert.equal(openai?.usage.inputTokens, 20);
    assert.equal(openai?.usage.reasoningTokens, 2);
    const gemini = parseGeminiUsage({ usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } });
    assert.equal(gemini?.usage.outputTokens, 4);
    const actual = billUsage({ provider: "xai", model: "grok-4-fast", usage: openai?.usage, estimatedCostUsd: 9 });
    assert.equal(actual.confidence, "actual");
    assert.notEqual(actual.costUsd, 9);
    const missing = billUsage({ provider: "pollinations", model: "openai", estimatedCostUsd: 0 });
    assert.equal(missing.confidence, "unknown");
    const estimated = billUsage({ provider: "pollinations", model: "openai", estimatedCostUsd: 0.02 });
    assert.equal(estimated.confidence, "estimated");
  });

  it("does not retry a managed timeout or 500 without an idempotency key", () => {
    assert.equal(retryDecision({ status: 500, attempt: 0, allowRetry: false, hasIdempotencyKey: false }), "fail");
    assert.equal(retryDecision({ message: "The operation was aborted due to timeout", attempt: 0, allowRetry: true, hasIdempotencyKey: false }), "fail");
    assert.equal(retryDecision({ status: 500, attempt: 0, allowRetry: true, hasIdempotencyKey: true }), "retry");
    assert.equal(retryDecision({ status: 500, attempt: 1, allowRetry: true, hasIdempotencyKey: true }), "fail");
    assert.equal(retryDecision({ status: 429, attempt: 0, allowRetry: true, hasIdempotencyKey: false }), "retry");
  });

  it("never gives BYOK the server key and refunds a managed run that has none", () => {
    const env = { XAI_API_KEY: "xai-server-secret" };
    const byok = managedExecutionPlan("byok", measuredRunSecrets("byok", "user-key", env));
    assert.equal(byok.action, "run");
    if (byok.action === "run") assert.equal(byok.managedServerKey, undefined);
    const missing = managedExecutionPlan("managed-paid", measuredRunSecrets("managed-paid", "user-key", {}));
    assert.deepEqual(missing, { action: "refund", fallback: false });
  });

  it("drops free text from a span and keeps production billing closed", () => {
    const span = scrubSpan({ name: "provider", orgId: "org_a", requestId: "idem_span_1", prompt: "hello", output: "world", apiKey: "sk-test" });
    assert.equal(JSON.stringify(span).includes("hello"), false);
    assert.equal(JSON.stringify(genAiAttributes(span!)).includes("sk-test"), false);
    assert.deepEqual(economySurface({ NODE_ENV: "production", DATABASE_URL: "postgres://db" }), {
      economyStore: "sql",
      billingMode: "disabled",
    });
    assert.equal(economySurface({}).billingMode, "mock");
    assert.equal(economySurface({ DATABASE_URL: "postgres://db" }).billingMode, "hosted");
  });

  it("maps a webhook by customer id and checks every v1 signature", () => {
    const raw = JSON.stringify({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_9", customer: "cus_123", metadata: { accountId: LOCAL_ACCOUNT } } },
    });
    assert.equal(stripeCustomerId(raw), "cus_123");
    assert.equal(hostedStripeIntent(raw)?.type, "invoice.paid");
    assert.equal(JSON.stringify(hostedStripeIntent(raw)).includes(LOCAL_ACCOUNT), false);
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    assert.equal(verifyStripeSignature(raw, `t=${timestamp},v1=${"ab".repeat(32)},v1=${signature}`, secret), true);
  });
});

describe("hosted refund isolation", () => {
  it("refunds only the org that reserved", async () => {
    const { db } = await openDb();
    await seed(db, "org_ref", 100);
    await seed(db, "org_other", 100);
    await reserveHosted(db, {
      orgId: "org_ref",
      requestId: "idem_ref_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 10,
      estimatedCostUsd: 0.02,
      priceVersion: "2026-09-28",
    });
    await refundHosted(db, "org_ref", "idem_ref_12345678");
    assert.equal((await readAccount(db, "org_ref"))?.creditsAvailable, 100);
    assert.equal((await readAccount(db, "org_other"))?.creditsAvailable, 100);
  });
});
