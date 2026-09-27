export type Breaker = { failures: number[]; openUntil?: number };

export type QuotaState = {
  day: string;
  used: number;
  minuteHits: number[];
  breakers: Record<string, Breaker>;
};

export function emptyQuota(now = new Date()): QuotaState {
  return { day: now.toISOString().slice(0, 10), used: 0, minuteHits: [], breakers: {} };
}

export function consumeFree(
  state: QuotaState,
  nowMs: number,
  dailyCap: number,
  perMinute: number,
): { state: QuotaState; ok: boolean; remaining: number; reason?: string } {
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const base = state.day === day ? state : { ...state, day, used: 0, minuteHits: [] };
  const hits = base.minuteHits.filter((ts) => nowMs - ts < 60_000);
  if (base.used >= dailyCap) {
    return { state: { ...base, minuteHits: hits }, ok: false, remaining: 0, reason: "Hết lượt free pool trong ngày." };
  }
  if (hits.length >= perMinute) {
    return { state: { ...base, minuteHits: hits }, ok: false, remaining: dailyCap - base.used, reason: "Quá số lượt mỗi phút." };
  }
  const next = { ...base, used: base.used + 1, minuteHits: [...hits, nowMs] };
  return { state: next, ok: true, remaining: dailyCap - next.used };
}

export function noteProviderFailure(state: QuotaState, provider: string, nowMs: number): QuotaState {
  const current = state.breakers[provider] ?? { failures: [] };
  const failures = [...current.failures.filter((ts) => nowMs - ts < 60_000), nowMs];
  const openUntil = failures.length >= 3 ? nowMs + 120_000 : current.openUntil;
  return { ...state, breakers: { ...state.breakers, [provider]: { failures, openUntil } } };
}

export function circuitOpen(state: QuotaState, provider: string, nowMs: number) {
  const until = state.breakers[provider]?.openUntil;
  return typeof until === "number" && nowMs < until;
}
