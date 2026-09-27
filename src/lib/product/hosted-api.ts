import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "../auth/middleware.ts";
import { dbSource, getPglite, getSql, withTransaction } from "../db.ts";
import type { Sql } from "../db.ts";
import { billingModeOf } from "./billing-mode.ts";
import { ensurePersonalOrg, readAccount, type Queryable } from "./sql-economy.ts";

type HostedRequest = {
  action: "snapshot" | "cap";
  spendingCapUsd?: number;
  requestedOrgId?: string;
};

function bind(query: Queryable["query"]): Queryable {
  const bound: Queryable = {
    query,
    transaction: (fn) => fn(bound),
  };
  return bound;
}

async function economyDb(): Promise<Queryable> {
  if (dbSource === "pglite") {
    const pg = await getPglite();
    return {
      query: async <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
        (await pg.query(text, params ?? [])).rows as T[],
      transaction: (fn) =>
        pg.transaction(async (tx) =>
          fn(
            bind(async <T = Record<string, unknown>>(text: string, params?: unknown[]) =>
              (await tx.query(text, params ?? [])).rows as T[],
            ),
          ),
        ),
    };
  }
  const sql = await getSql();
  return {
    query: (text, params) => sql.query(text, params ?? []),
    transaction: (fn) => withTransaction((tx: Sql) => fn(bind((text, params) => tx.query(text, params ?? [])))),
  };
}

export const hostedEconomyApi = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: HostedRequest) => {
    if (!input || (input.action !== "snapshot" && input.action !== "cap")) throw new Error("Yêu cầu hosted không hợp lệ");
    if ("accountId" in (input as object)) throw new Error("Không gửi accountId.");
    return input;
  })
  .handler(async ({ data, context }) => {
    if (billingModeOf(process.env) === "disabled" && data.action !== "snapshot") {
      return { ok: false as const, error: "Mock billing tắt trên production. Không đổi gói và không cộng tín dụng." };
    }
    const db = await economyDb();
    const orgId = await ensurePersonalOrg(db, context.userId);
    if (data.requestedOrgId && data.requestedOrgId !== orgId) {
      return { ok: false as const, error: "Không được đọc hoặc sửa billing của tổ chức khác." };
    }
    if (data.action === "cap") {
      const cap = Number(data.spendingCapUsd);
      if (!Number.isFinite(cap) || cap < 0) return { ok: false as const, error: "Trần không hợp lệ." };
      await db.query("update billing_accounts set spending_cap_usd = $2, updated_at = now() where org_id = $1", [orgId, cap]);
    }
    const account = await readAccount(db, orgId);
    return {
      ok: true as const,
      orgId,
      billingMode: billingModeOf(process.env) === "disabled" ? "disabled" as const : "hosted" as const,
      checkout: "disabled" as const,
      account,
    };
  });
