-- Hosted economy. Local Free does not need this schema.
-- No prompt, output, API key, card, or raw PII columns.

CREATE TABLE IF NOT EXISTS billing_orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS billing_memberships (
  org_id TEXT NOT NULL REFERENCES billing_orgs (id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_memberships_user_idx ON billing_memberships (user_id);

CREATE TABLE IF NOT EXISTS billing_accounts (
  org_id TEXT PRIMARY KEY REFERENCES billing_orgs (id),
  plan_id TEXT NOT NULL DEFAULT 'free',
  credits_available INTEGER NOT NULL DEFAULT 0,
  credits_reserved INTEGER NOT NULL DEFAULT 0,
  spending_cap_usd NUMERIC NOT NULL DEFAULT 0,
  spent_month_usd NUMERIC NOT NULL DEFAULT 0,
  billing_problem BOOLEAN NOT NULL DEFAULT false,
  paid_consent BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hosted_credit_ledger (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT,
  kind TEXT NOT NULL,
  credits INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hosted_holds (
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  credits INTEGER NOT NULL,
  estimated_cost_usd NUMERIC NOT NULL,
  route_mode TEXT NOT NULL,
  requested_provider TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  price_version TEXT NOT NULL,
  status TEXT NOT NULL,
  actual_cost_usd NUMERIC,
  settled_credits INTEGER,
  PRIMARY KEY (org_id, request_id)
);

CREATE TABLE IF NOT EXISTS hosted_usage_events (
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
  usage_confidence TEXT NOT NULL DEFAULT 'unknown',
  price_version TEXT NOT NULL DEFAULT 'unpriced',
  provider_request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, request_id, status)
);

CREATE TABLE IF NOT EXISTS hosted_dispatches (
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, request_id)
);

CREATE TABLE IF NOT EXISTS provider_billing_events (
  provider_event_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  invoice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_billing_invoice_grant
  ON provider_billing_events (invoice_id)
  WHERE invoice_id IS NOT NULL AND event_type = 'invoice.paid';

CREATE TABLE IF NOT EXISTS stripe_customer_map (
  stripe_customer_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT
);

CREATE TABLE IF NOT EXISTS hosted_rate_buckets (
  bucket_key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS hosted_spans (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  usage_confidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
