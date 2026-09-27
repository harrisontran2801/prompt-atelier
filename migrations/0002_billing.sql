-- Hosted billing schema. Not required for Local Free.
-- No prompt, output, API key, or card data columns.

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_credits INTEGER NOT NULL DEFAULT 0,
  price_usd NUMERIC,
  features TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS billing_customers (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_customer_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES billing_customers (id),
  plan_id TEXT NOT NULL REFERENCES plans (id),
  status TEXT NOT NULL,
  provider_subscription_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  status TEXT NOT NULL,
  spending_cap_usd NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT,
  kind TEXT NOT NULL,
  credits INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  route_mode TEXT NOT NULL,
  requested_provider TEXT NOT NULL,
  final_provider TEXT,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  actual_tokens INTEGER,
  estimated_cost_usd NUMERIC NOT NULL DEFAULT 0,
  actual_cost_usd NUMERIC,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  credits_settled INTEGER NOT NULL DEFAULT 0,
  credits_refunded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_prices (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  usd_per_1k_tokens NUMERIC NOT NULL,
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (provider, model)
);

CREATE TABLE IF NOT EXISTS checkout_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name, monthly_credits, price_usd, features)
VALUES
  ('free', 'Free', 0, 0, '{"sandbox":true,"cloudSync":false}'),
  ('pro', 'Pro', 2000, NULL, '{"cloudSync":true,"managed":true}'),
  ('team', 'Team', 10000, NULL, '{"pooled":true,"roles":true}')
ON CONFLICT (id) DO NOTHING;
