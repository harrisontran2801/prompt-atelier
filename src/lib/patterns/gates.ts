import { HIGH_FAILURES, type Pattern, type ReleasePointer, type TestCase } from "./types";

const FRESH_MS = 14 * 24 * 60 * 60 * 1000;

export function verifiedGate(pattern: Pattern, tests: TestCase[]) {
  const reasons: string[] = [];
  const mine = tests.filter((item) => item.patternId === pattern.id);
  if (mine.length < 3) reasons.push("Cần ít nhất 3 test case.");
  if (!pattern.evidence.testsetHash) reasons.push("Thiếu test-set hash.");
  if (pattern.evidence.passRate !== 100 || !pattern.evidence.suitePass) {
    reasons.push("Deterministic assertions chưa pass 100% trên model đã pin.");
  }
  if (!pattern.evidence.verifiedModels.length) reasons.push("Chưa có model được pin sau một suite xanh.");
  if (!pattern.provenance.license || !pattern.provenance.author) reasons.push("Thiếu license hoặc author.");
  if (!pattern.checksum) reasons.push("Thiếu checksum.");
  const missingExample = pattern.variables.filter((item) => item.required && !item.example?.trim());
  if (missingExample.length) {
    reasons.push(`Biến bắt buộc chưa có example: ${missingExample.map((item) => item.name).join(", ")}.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function productionGate(
  pattern: Pattern,
  tests: TestCase[],
  releases: ReleasePointer[],
  confirmed: boolean,
) {
  const base = verifiedGate(pattern, tests);
  const reasons = [...base.reasons];
  const current = releases.find((item) => item.patternId === pattern.id && item.label === "production");
  if (current && (pattern.evidence.passRate ?? 0) < current.passRate) {
    reasons.push(`Pass rate ${pattern.evidence.passRate ?? 0}% thấp hơn production hiện tại (${current.passRate}%).`);
  }
  const covered = new Set(tests.filter((item) => item.patternId === pattern.id && item.failureMode).map((item) => item.failureMode));
  const openHigh = pattern.failureModes.filter((id) => HIGH_FAILURES.has(id) && !covered.has(id));
  if (openHigh.length) reasons.push(`High failure chưa có test: ${openHigh.join(", ")}.`);
  if (!pattern.evidence.lastRunAt || Date.now() - Date.parse(pattern.evidence.lastRunAt) > FRESH_MS) {
    reasons.push("Suite chưa chạy trong 14 ngày.");
  }
  if (!confirmed) reasons.push("Chưa xác nhận đã đọc anti-use-case và red-team notes.");
  return { ok: reasons.length === 0, reasons };
}
