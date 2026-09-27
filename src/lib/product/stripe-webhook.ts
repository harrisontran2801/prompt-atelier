import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingCommand } from "./ledger.ts";
import type { PlanId } from "./routing.ts";

const TOLERANCE_SEC = 300;

export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowMs = Date.now()) {
  if (!header || !secret || !payload) return false;
  const pairs = header.split(",").map((piece) => {
    const index = piece.indexOf("=");
    return [piece.slice(0, index), piece.slice(index + 1)] as const;
  });
  const timestamp = pairs.find((item) => item[0] === "t")?.[1];
  const signatures = pairs.filter((item) => item[0] === "v1").map((item) => item[1]).filter(Boolean);
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(nowMs / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const left = Buffer.from(expected);
  return signatures.some((signature) => {
    const right = Buffer.from(signature);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  });
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

export function commandFromStripeEvent(raw: string, accountId: string): BillingCommand | null {
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return null;
  }
  if (!event.id || !event.type) return null;
  const object = event.data?.object ?? {};
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const planRaw = String(metadata.planId ?? "pro");
  const planId: PlanId = planRaw === "team" || planRaw === "free" ? planRaw : "pro";
  if (event.type === "checkout.session.completed") {
    return { type: "checkout.completed", eventId: event.id, accountId, planId };
  }
  if (event.type === "customer.subscription.deleted") {
    return { type: "subscription.canceled", eventId: event.id, accountId };
  }
  if (event.type === "customer.subscription.updated") {
    const status = String(object.status ?? "");
    if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      return { type: "subscription.canceled", eventId: event.id, accountId };
    }
    return null;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    return { type: "invoice.paid", eventId: event.id, accountId };
  }
  if (event.type === "invoice.payment_failed") {
    return { type: "invoice.failed", eventId: event.id, accountId };
  }
  return null;
}

export function stripeConfigured(env: Record<string, string | undefined>) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}
