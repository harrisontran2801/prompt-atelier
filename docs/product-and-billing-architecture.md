# Prompt Atelier — product and billing boundary

Local mode stays the default. Hosted billing is a separate SQL path and is not required to get a result. Production does not charge anyone.

## What the user buys

People do not come for a prompt. They come to finish a job: reply, summarize, compare, rewrite, review code, or research. A workflow is how the job stays repeatable. Patterns stay the advanced building blocks.

## Two repositories

| | Local Free | Hosted |
|---|---|---|
| Account | Not required | Signed-in user, one billing org |
| Ledger | In-memory `LOCAL_ACCOUNT` | `billing_accounts` locked per org |
| When | No `DATABASE_URL` | `DATABASE_URL` set |
| Sandbox | Unlimited, on device | Same, still local |
| BYOK | Browser key only | Server never substitutes its xAI key |
| Managed | Does not run as a paid product | Entitlement, consent, reserve, then server key |
| Stripe | Mock only outside production | Mapping tables exist. Checkout stays closed |

`LOCAL_ACCOUNT` is the preview account. Production billing and hosted requests reject it. The client cannot send an account id.

## Routing

No silent paid fallback:

1. Preview or regression stays on Sandbox.
2. BYOK runs only with the user's key. Pollinations without a key is not BYOK; it has to be the free pool.
3. Free-public needs consent, a live policy, remaining quota, and a closed circuit.
4. Exhausted free quota stops.
5. Managed runs only after entitlement, paid consent, a committed reserve, and spend-cap room.

A managed call is not retried on timeout or HTTP 5xx unless the same idempotency key is sent. The dispatch row is committed before the provider call, so a retry does not call the provider again.

Usage is `actual` only when the provider returns input and output tokens and a price snapshot exists. Otherwise the trace says `estimated` or `unknown`. BYOK and free do not spend managed credits.

## Ledger

`migrations/0002_billing.sql` is the earlier hosted shape. `migrations/0003_hosted_economy.sql` adds orgs, memberships, balances, an append-only credit ledger, usage events, dispatch keys, Stripe customer mapping, and provider event ids. Reserve, settle, and refund run in a transaction with a row lock. Invoice grants are unique per invoice id. A failed invoice sets `billing_problem` and blocks the next paid reserve.

Prices are read from `PLAN_PRO_PRICE_USD` and `PLAN_TEAM_PRICE_USD`. If unset, the UI does not invent a price. Provider token prices live in the server price snapshot (`2026-09-28`), not in React.

## Privacy

Usage rows, spans, and traces store ids, enums, token counts, and cost. They do not store the prompt, the output, an API key, or raw PII. Webhook handling keeps the event id and the mapped org, not the raw card payload. Stripe signatures are checked on the raw body and accept multiple `v1` signatures.
