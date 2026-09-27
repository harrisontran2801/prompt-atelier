import { emptyLedger, LOCAL_ACCOUNT, type LedgerState } from "./ledger.ts";
import { emptyQuota, type QuotaState } from "./quota.ts";
import type { RouteTrace } from "./routing.ts";

export type EconomyState = {
  ledger: LedgerState;
  quota: QuotaState;
  webhookIds: string[];
  lastTrace: RouteTrace | null;
  runs: number;
};

export function freshEconomy(now = new Date()): EconomyState {
  return { ledger: emptyLedger(), quota: emptyQuota(now), webhookIds: [], lastTrace: null, runs: 0 };
}

let state = freshEconomy();

/** In-memory ledger for Local Free and dev tests. Hosted requests use the SQL repository and never this account. */
export function getEconomy() {
  return state;
}

export function setEconomy(next: EconomyState) {
  state = next;
}

export function resetEconomy() {
  state = freshEconomy();
}

export function localAccount(state: EconomyState = getEconomy()) {
  return state.ledger.accounts[LOCAL_ACCOUNT];
}
