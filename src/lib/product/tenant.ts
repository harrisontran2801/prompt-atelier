import { LOCAL_ACCOUNT } from "./ledger.ts";

export type Membership = { userId: string; orgId: string; role: "owner" | "member" };

export function billingOrgForUser(userId: string, memberships: Membership[]) {
  const row = memberships.find((item) => item.userId === userId);
  if (!row) return { ok: false as const, error: "Chưa có tổ chức billing." };
  return { ok: true as const, orgId: row.orgId, role: row.role };
}

/** The client never chooses the billing account. A foreign org id is rejected. */
export function scopeHostedRequest(userId: string, requestedOrgId: string | undefined, memberships: Membership[]) {
  const actor = billingOrgForUser(userId, memberships);
  if (!actor.ok) return actor;
  if (actor.orgId === LOCAL_ACCOUNT) {
    return { ok: false as const, error: "LOCAL_ACCOUNT không dùng cho hosted billing." };
  }
  if (requestedOrgId && requestedOrgId !== actor.orgId) {
    return { ok: false as const, error: "Không được đọc hoặc sửa billing của tổ chức khác." };
  }
  return { ok: true as const, orgId: actor.orgId };
}
