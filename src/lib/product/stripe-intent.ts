import type { PlanId } from "./routing.ts";
import type { MappedStripeEvent } from "./sql-economy.ts";

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

/** Reads only ids from a verified raw body. Org comes from the customer map, never from the client. */
export function hostedStripeIntent(raw: string): Omit<MappedStripeEvent, "orgId"> | null {
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
  const customer = typeof object.customer === "string" ? object.customer : null;
  const invoiceId = typeof object.id === "string" && event.type.startsWith("invoice.") ? object.id : undefined;
  if (event.type === "checkout.session.completed") return { eventId: event.id, type: "checkout.completed", planId };
  if (event.type === "customer.subscription.deleted") return { eventId: event.id, type: "subscription.canceled" };
  if (event.type === "customer.subscription.updated") {
    const status = String(object.status ?? "");
    if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
      return { eventId: event.id, type: "subscription.canceled" };
    }
    return null;
  }
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    return { eventId: event.id, type: "invoice.paid", invoiceId, planId };
  }
  if (event.type === "invoice.payment_failed") return { eventId: event.id, type: "invoice.failed", invoiceId };
  void customer;
  return null;
}

export function stripeCustomerId(raw: string): string | null {
  try {
    const event = JSON.parse(raw) as StripeEvent;
    const customer = event.data?.object?.customer;
    return typeof customer === "string" && customer.startsWith("cus_") ? customer : null;
  } catch {
    return null;
  }
}
