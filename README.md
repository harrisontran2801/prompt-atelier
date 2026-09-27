# Prompt Atelier

Local-first prompt workbench. Quick Mode runs six jobs on a deterministic sandbox. Studio keeps the pattern library, tests, and release gates.

## Run

```bash
npm install
npm run dev
```

No account, database, or API key is required for sandbox results.

## Routes

- Sandbox: on device. Preview and regression never call the network.
- BYOK: only the key you paste. xAI BYOK does not read the server key.
- Free-public: Pollinations only after consent, a still-valid policy, remaining quota, and a closed circuit. Exhausted quota stops. It does not switch to paid.
- Managed-paid: Pro or Team, paid consent, a successful credit reserve, and room under the spend cap. The server xAI key is used only on this path. `allowFallback` stays off. A missing server key refunds the hold.

Production sets billing to `disabled`. Mock checkout cannot change a plan there. Stripe Checkout is not open.

## Storage

Local Free keeps the ledger in process memory (`LOCAL_ACCOUNT`, preview only). Hosted mode (`DATABASE_URL`) uses `migrations/0003_hosted_economy.sql` and the signed-in user's org. The browser does not choose the account id.
