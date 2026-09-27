import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { runAsserts } from "../patterns/assert.ts";
import { buildSeed } from "../patterns/seed.ts";
import {
  applyBillingCommand,
  emptyLedger,
  LOCAL_ACCOUNT,
  refundCredits,
  reserveCredits,
  scrubUsage,
  setSpendingCap,
  settleCredits,
} from "./ledger.ts";
import { compileWorkflow, exampleVars, JOBS } from "./jobs.ts";
import { metricFrom } from "./metrics.ts";
import { estimateCostUsd, loadPlans, planById } from "./plans.ts";
import { circuitOpen, consumeFree, emptyQuota, noteProviderFailure } from "./quota.ts";
import { approvedFreePool, isFreeEligible, policyById, type ProviderPolicy } from "./registry.ts";
import { decideRoute, type RouteInput } from "./routing.ts";
import { commandFromStripeEvent, verifyStripeSignature } from "./stripe-webhook.ts";

const NOW = "2026-09-28T03:00:00.000Z";

function route(partial: Partial<RouteInput> = {}): RouteInput {
  return {
    intent: "user-run",
    prefer: "sandbox",
    byokHasKey: false,
    freeConsent: false,
    paidConsent: false,
    entitlement: "free",
    freeRemaining: 20,
    circuitOpen: false,
    nowIso: NOW,
    ...partial,
  };
}

describe("routing", () => {
  it("preview and regression stay on sandbox", () => {
    assert.equal(decideRoute(route({ intent: "preview", prefer: "free", freeConsent: true })).mode, "sandbox");
    assert.equal(decideRoute(route({ intent: "regression", prefer: "managed", paidConsent: true, entitlement: "pro" })).mode, "sandbox");
  });

  it("uses BYOK only when a key is present and does not become paid", () => {
    const missing = decideRoute(route({ prefer: "byok", byokProvider: "groq", byokHasKey: false }));
    assert.equal(missing.mode, "blocked");
    const ok = decideRoute(route({ prefer: "byok", byokProvider: "groq", byokModel: "llama-3.1-8b-instant", byokHasKey: true }));
    assert.equal(ok.mode, "byok");
    assert.equal(ok.provider, "groq");
    assert.equal(ok.fellBack, false);
  });

  it("free pool needs consent, a live policy, and remaining quota", () => {
    const noConsent = decideRoute(route({ prefer: "free", freeConsent: false }));
    assert.equal(noConsent.mode, "blocked");
    const ok = decideRoute(route({ prefer: "free", freeConsent: true, freeRemaining: 2 }));
    assert.equal(ok.mode, "free-public");
    assert.equal(ok.provider, "pollinations");
    const empty = decideRoute(route({ prefer: "free", freeConsent: true, freeRemaining: 0 }));
    assert.equal(empty.mode, "blocked");
    assert.equal(empty.options.includes("paid"), true);
    assert.notEqual(empty.mode, "managed-paid");
  });

  it("managed route refuses missing entitlement or consent", () => {
    assert.equal(decideRoute(route({ prefer: "managed", paidConsent: true, entitlement: "free" })).mode, "blocked");
    assert.equal(decideRoute(route({ prefer: "managed", paidConsent: false, entitlement: "pro" })).mode, "blocked");
    const ok = decideRoute(route({ prefer: "managed", paidConsent: true, entitlement: "pro" }));
    assert.equal(ok.mode, "managed-paid");
    assert.equal(ok.provider, "xai");
    assert.equal(ok.fellBack, false);
  });

  it("does not treat an unverified provider as free", () => {
    const pollinations = policyById("pollinations");
    assert.equal(isFreeEligible(pollinations, NOW), true);
    const stale = { ...pollinations, lastVerifiedAt: "2026-01-01" } as ProviderPolicy;
    assert.equal(isFreeEligible(stale, NOW), false);
    const unlabeled = { ...pollinations, lastVerifiedAt: undefined, freePolicyUrl: undefined } as ProviderPolicy;
    assert.equal(isFreeEligible(unlabeled, NOW), false);
    assert.equal(approvedFreePool(NOW).every((item) => item.access === "free-public"), true);
  });
});

describe("plans and cost", () => {
  it("reads prices from env and does not invent them", () => {
    assert.equal(planById("pro", {}).priceUsd, null);
    assert.equal(planById("pro", { PLAN_PRO_PRICE_USD: "12" }).priceUsd, 12);
    assert.equal(loadPlans({}).find((item) => item.id === "free")?.monthlyCredits, 0);
    assert.equal(estimateCostUsd(0, 4000, 800), 0);
    assert.ok(estimateCostUsd(0.005, 4000, 800) > 0);
  });
});

describe("ledger", () => {
  it("reserves, settles the surplus, and ignores a retry", () => {
    let state = emptyLedger();
    const granted = applyBillingCommand(state, [], {
      type: "checkout.completed",
      eventId: "evt_checkout",
      accountId: LOCAL_ACCOUNT,
      planId: "pro",
    });
    state = setSpendingCap(granted.state, LOCAL_ACCOUNT, 5);
    assert.equal(state.accounts[LOCAL_ACCOUNT].credits, 2000);
    const again = applyBillingCommand(state, granted.seen, {
      type: "checkout.completed",
      eventId: "evt_checkout",
      accountId: LOCAL_ACCOUNT,
      planId: "pro",
    });
    assert.equal(again.duplicate, true);
    assert.equal(again.state.accounts[LOCAL_ACCOUNT].credits, 2000);

    const reserved = reserveCredits(state, {
      accountId: LOCAL_ACCOUNT,
      requestId: "idem_once_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 1000,
      estimatedCostUsd: 0.8,
      nowIso: NOW,
    });
    assert.equal(reserved.ok, true);
    assert.equal(reserved.state.accounts[LOCAL_ACCOUNT].credits, 1200);
    const retry = reserveCredits(reserved.state, {
      accountId: LOCAL_ACCOUNT,
      requestId: "idem_once_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 1000,
      estimatedCostUsd: 0.8,
      nowIso: NOW,
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.state.accounts[LOCAL_ACCOUNT].credits, 1200);

    const settled = settleCredits(reserved.state, { requestId: "idem_once_12345678", actualCostUsd: 0.2, nowIso: NOW });
    assert.equal(settled.state.accounts[LOCAL_ACCOUNT].credits, 1800);
    assert.equal(settled.state.accounts[LOCAL_ACCOUNT].reserved, 0);
    const settledAgain = settleCredits(settled.state, { requestId: "idem_once_12345678", actualCostUsd: 0.2, nowIso: NOW });
    assert.equal(settledAgain.duplicate, true);
    assert.equal(settledAgain.state.accounts[LOCAL_ACCOUNT].credits, 1800);
  });

  it("refunds a provider failure and blocks a spend cap", () => {
    let state = applyBillingCommand(emptyLedger(), [], {
      type: "checkout.completed",
      eventId: "evt_cap",
      accountId: LOCAL_ACCOUNT,
      planId: "pro",
    }).state;
    state = setSpendingCap(state, LOCAL_ACCOUNT, 0.1);
    const denied = reserveCredits(state, {
      accountId: LOCAL_ACCOUNT,
      requestId: "idem_cap_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 100,
      estimatedCostUsd: 0.8,
      nowIso: NOW,
    });
    assert.equal(denied.ok, false);
    assert.match(denied.reason ?? "", /trần/);

    state = setSpendingCap(state, LOCAL_ACCOUNT, 10);
    const reserved = reserveCredits(state, {
      accountId: LOCAL_ACCOUNT,
      requestId: "idem_fail_12345678",
      routeMode: "managed-paid",
      requestedProvider: "xai",
      estimatedTokens: 100,
      estimatedCostUsd: 0.2,
      nowIso: NOW,
    });
    const before = reserved.state.accounts[LOCAL_ACCOUNT].credits;
    const refunded = refundCredits(reserved.state, { requestId: "idem_fail_12345678", nowIso: NOW, reason: "provider-error" });
    assert.equal(refunded.ok, true);
    assert.ok(refunded.state.accounts[LOCAL_ACCOUNT].credits > before);
    const twice = refundCredits(refunded.state, { requestId: "idem_fail_12345678", nowIso: NOW, reason: "provider-error" });
    assert.equal(twice.duplicate, true);
    assert.equal(twice.state.accounts[LOCAL_ACCOUNT].credits, refunded.state.accounts[LOCAL_ACCOUNT].credits);
  });

  it("stores no prompt in a usage row", () => {
    const row = scrubUsage(
      {
        id: "evt_public",
        accountId: LOCAL_ACCOUNT,
        requestId: "req_1",
        routeMode: "free-public",
        requestedProvider: "pollinations",
        prompt: "mail ada@example.com token sk-supersecretvalue",
        output: "secret output",
        userKey: "sk-supersecretvalue",
        estimatedTokens: 10,
        estimatedCostUsd: 0,
        status: "settled",
      },
      NOW,
    );
    const blob = JSON.stringify(row);
    assert.equal(blob.includes("ada@"), false);
    assert.equal(blob.includes("sk-super"), false);
    assert.equal(blob.includes("prompt"), false);
    assert.equal(blob.includes("secret output"), false);
  });
});

describe("quota, stripe, jobs", () => {
  it("stops at the daily cap and opens a circuit", () => {
    let quota = emptyQuota(new Date(NOW));
    for (let i = 0; i < 20; i += 1) {
      const step = consumeFree(quota, Date.parse(NOW) + i, 20, 100);
      assert.equal(step.ok, true);
      quota = step.state;
    }
    const denied = consumeFree(quota, Date.parse(NOW) + 30, 20, 100);
    assert.equal(denied.ok, false);
    let broke = emptyQuota(new Date(NOW));
    const t0 = Date.parse(NOW);
    broke = noteProviderFailure(broke, "pollinations", t0);
    broke = noteProviderFailure(broke, "pollinations", t0 + 1);
    assert.equal(circuitOpen(broke, "pollinations", t0 + 2), false);
    broke = noteProviderFailure(broke, "pollinations", t0 + 2);
    assert.equal(circuitOpen(broke, "pollinations", t0 + 3), true);
  });

  it("verifies stripe signatures and parses a checkout event once", () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { metadata: { planId: "pro" } } },
    });
    const timestamp = "1727481600";
    const now = 1_727_481_600_000;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, now), true);
    assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${"0".repeat(signature.length)}`, secret, now), false);
    assert.equal(verifyStripeSignature(payload, `t=${timestamp},v1=${signature}`, secret, now + 600_000), false);
    const command = commandFromStripeEvent(payload, LOCAL_ACCOUNT);
    assert.equal(command?.type, "checkout.completed");
    assert.equal(commandFromStripeEvent("{", LOCAL_ACCOUNT), null);
  });

  it("compiles a job through the existing stack, not a second prompt engine", () => {
    const seed = buildSeed();
    const job = JOBS.find((item) => item.id === "reply");
    assert.ok(job);
    const vars = exampleVars(job);
    const built = compileWorkflow(seed.patterns, job.stack, vars);
    assert.match(built.compiled, /hoàn tiền đơn #1842/);
    assert.equal(built.compiled.includes("Evaluator này không được chèn"), false);
    assert.equal(built.sources.some((item) => item.kind === "evaluator" && item.included === false), true);
    const output = [
      "1. Mình hiểu yêu cầu hoàn tiền.",
      "2. Đơn #1842 sẽ được kiểm tra.",
      "3. Bước tiếp: phản hồi trong ngày làm việc.",
    ].join("\n");
    assert.equal(runAsserts(output, job.asserts).every((item) => item.ok), true);
    assert.equal(JOBS.length, 6);
  });

  it("drops free text from metrics", () => {
    const event = metricFrom({ name: "first_run_success", prompt: "ada@example.com", count: 1, routeMode: "sandbox" }, NOW);
    assert.equal(event?.name, "first_run_success");
    assert.equal(JSON.stringify(event).includes("ada@"), false);
    assert.equal(metricFrom({ name: "not-a-metric" }, NOW), null);
  });
});
