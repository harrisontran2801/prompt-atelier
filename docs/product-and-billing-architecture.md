# Prompt Atelier — product and billing boundary

Checked against commit `1625287` and the code in this tree. Local mode stays the default. Hosted billing is a separate path and is not required to get a result.

## What the user buys

People do not come for a prompt. They come to finish a job: reply, summarize, compare, rewrite, review code, or research. A **workflow** (the stack of existing patterns) is how the job stays repeatable. Patterns stay the advanced building blocks. Studio, tests, and release gates stay available after the first result.

## Two modes

| | Local Free | Hosted Cloud |
|---|---|---|
| Account | Not required | Required only for sync, managed execution, or billing |
| Storage | `localStorage`, import/export | Server rows when `DATABASE_URL` is set |
| Sandbox | Unlimited, on-device, not an LLM | Same |
| Free public model | Only after consent, with a server cap | Same cap, keyed later by org |
| BYOK | Browser `localStorage`, user is warned | Not copied to the server ledger |
| Managed models | Do not run | Only with entitlement and explicit consent |
| Stripe | Not required | Server adapter. Mock checkout when secrets are absent |

Missing Stripe, auth, or database must not block Local Free.

## Routing

Order, no silent paid fallback:

1. Preview or regression → Sandbox. No network.
2. User picked BYOK and a key exists → that provider only. `allowFallback` is off on the metered path.
3. User opted into “use free AI when available” and the provider is still inside the verified free-public policy → Approved Free Pool (Pollinations only, until another policy is re-verified).
4. Free pool exhausted, unverified, or circuit-open → stop. Offer Sandbox, BYOK, or paid credits. Do not run paid.
5. Managed route only if plan is Pro or Team, the user consented, credits were reserved, and the spend cap allows it.

Every metered run stores a trace: requested provider, attempted provider, final provider, reason, estimated cost, actual cost if known. The trace has no prompt, output, API key, or raw PII.

Free-public eligibility requires `access: free-public`, a policy URL, and `lastVerifiedAt` within 45 days. The UI must not say “free forever”.

## Plans

Prices are not hardcoded in React. `loadPlans()` reads `PLAN_PRO_PRICE_USD` and `PLAN_TEAM_PRICE_USD`. If unset, the UI says the price is not configured and checkout is a mock. Test defaults: Free = unlimited sandbox + 20 free-public runs/day; Pro = 2000 monthly credits; Team = 10000 pooled credits. One credit is an internal unit equal to $0.001 of estimated provider cost, not a cash balance the browser can edit.

## Ledger

`migrations/0002_billing.sql` is the hosted schema (`billing_customers`, `subscriptions`, `entitlements`, `plans`, append-only `credit_ledger` and `usage_events`, `provider_prices`, `checkout_events` with an idempotency key). Local and preview builds do not have `DATABASE_URL`, so the running app uses an in-memory server ledger with the same reserve → settle → refund rules. The browser only renders the server snapshot. It does not decide the remaining balance.

Retry with the same idempotency key must not charge twice and must not call the provider again after a settle.

## Privacy

- Sandbox never leaves the machine.
- Network runs say so before the click.
- Usage rows store ids, enums, token estimates, and cost. Not the prompt or the output.
- Privacy Mode still redacts PII before a failure is saved locally.
- Provider errors are sanitized before they reach the UI.
- Stripe webhook signatures are verified. Card data is never handled here.
