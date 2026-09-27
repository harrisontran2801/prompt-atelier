import { checksumOf } from "./hash.ts";
import { redactPii } from "./privacy.ts";
import type { Pattern, PatternPack, ReleasePointer, Snapshot, TestCase } from "./types.ts";

export function touchPattern(pattern: Pattern, patch: Partial<Pattern>): Pattern {
  const next: Pattern = {
    ...pattern,
    ...patch,
    components: patch.components ?? pattern.components,
    variables: patch.variables ?? pattern.variables,
    evidence: patch.evidence ?? pattern.evidence,
    provenance: patch.provenance ?? pattern.provenance,
    updatedAt: new Date().toISOString(),
  };
  if ((pattern.status === "verified" || pattern.status === "production") && patch.status === undefined) {
    next.status = "draft";
    next.evidence = { ...next.evidence, suitePass: false };
  }
  next.checksum = checksumOf({
    id: next.id,
    version: next.version,
    components: next.components,
    variables: next.variables,
    outputContract: next.outputContract,
  });
  return next;
}

type Forkable = {
  patterns: Pattern[];
  tests: TestCase[];
  recentIds: string[];
};

export function forkPatternInto<T extends Forkable>(current: T, id: string): { next: T; forkId: string } | null {
  const source = current.patterns.find((item) => item.id === id);
  if (!source) return null;
  const slug = `${source.id}-fork`;
  const count = current.patterns.filter((item) => item.id.startsWith(slug)).length + 1;
  const forkId = `${slug}-${count}`;
  const fork = touchPattern(
    { ...source, id: forkId, name: `${source.name} fork`, status: "draft", version: "0.1.0" },
    { evidence: { ...source.evidence, suitePass: false, passRate: undefined, verifiedModels: [] } },
  );
  fork.status = "draft";
  const cloned = current.tests
    .filter((item) => item.patternId === id)
    .map((item) => ({ ...item, id: `${item.id}-fork-${count}`, patternId: forkId }));
  fork.testCaseIds = cloned.map((item) => item.id);
  return {
    forkId,
    next: {
      ...current,
      patterns: [fork, ...current.patterns],
      tests: [...cloned, ...current.tests],
      recentIds: [forkId, ...current.recentIds].slice(0, 8),
    },
  };
}

type Importable = {
  patterns: Pattern[];
  tests: TestCase[];
  packs: PatternPack[];
};

export function importPackInto<T extends Importable>(
  current: T,
  raw: string,
  stamp = Date.now().toString(36).slice(-4),
): { ok: true; next: T; notice: string } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "File trống. Chọn một pack JSON đã export từ Atelier." };
  let parsed: { pack?: PatternPack; patterns?: Pattern[]; tests?: TestCase[] };
  try {
    parsed = JSON.parse(text) as { pack?: PatternPack; patterns?: Pattern[]; tests?: TestCase[] };
  } catch {
    return {
      ok: false,
      error: "Không đọc được JSON. Pack Atelier là file JSON có pack.id và mảng patterns. Dữ liệu hiện tại không đổi.",
    };
  }
  if (!parsed.pack?.id || !Array.isArray(parsed.patterns)) {
    return {
      ok: false,
      error: "File không phải pack Atelier. Cần JSON với pack.id và patterns[]. Dữ liệu hiện tại không đổi.",
    };
  }

  const notes: string[] = [];
  let patterns = [...current.patterns];
  let tests = [...current.tests];
  for (const incoming of parsed.patterns) {
    const existing = patterns.find((item) => item.id === incoming.id);
    if (existing && (existing.status === "production" || existing.status === "verified")) {
      const forkId = `${incoming.id}-import-${stamp}`;
      patterns = [{ ...incoming, id: forkId, status: "draft", name: `${incoming.name} import` }, ...patterns];
      notes.push(`${incoming.id} đang ${existing.status} — tạo fork ${forkId}, không ghi đè.`);
      for (const test of parsed.tests ?? []) {
        if (test.patternId === incoming.id) tests = [{ ...test, id: `${test.id}-imp`, patternId: forkId }, ...tests];
      }
    } else if (existing) {
      patterns = patterns.map((item) => (item.id === incoming.id ? incoming : item));
      notes.push(`Đã cập nhật draft ${incoming.id}`);
    } else {
      patterns = [incoming, ...patterns];
    }
  }
  if (!notes.length) {
    for (const test of parsed.tests ?? []) {
      if (!tests.some((item) => item.id === test.id)) tests = [test, ...tests];
    }
  }
  const packs = current.packs.some((item) => item.id === parsed.pack!.id)
    ? current.packs.map((item) => (item.id === parsed.pack!.id ? parsed.pack! : item))
    : [parsed.pack!, ...current.packs];
  return {
    ok: true,
    notice: notes.join(" ") || `Đã nhập ${parsed.pack.id}`,
    next: { ...current, patterns, tests, packs },
  };
}

type Releasable = {
  patterns: Pattern[];
  releases: ReleasePointer[];
  snapshots: Snapshot[];
};

/** Moves the production pointer. Does not remove snapshots or old pointers' history rows. */
export function rollbackPointer<T extends Releasable>(
  current: T,
  patternId: string,
  snapshotId: string,
  promotedAt = new Date().toISOString(),
): T {
  const snapshot = current.snapshots.find((item) => item.id === snapshotId && item.patternId === patternId);
  if (!snapshot) return current;
  return {
    ...current,
    snapshots: current.snapshots,
    patterns: current.patterns.map((item) => (item.id === patternId ? { ...snapshot.pattern, status: "production" } : item)),
    releases: current.releases.map((item) =>
      item.patternId === patternId && item.label === "production"
        ? {
            ...item,
            version: snapshot.version,
            snapshotId: snapshot.id,
            promotedAt,
            passRate: snapshot.pattern.evidence.passRate ?? item.passRate,
          }
        : item,
    ),
  };
}

export function buildFailureCase(input: {
  patternId: string;
  mode: string;
  note: string;
  base?: TestCase;
  privacy: boolean;
  now?: number;
}): TestCase {
  const rawVars = { ...(input.base?.vars ?? {}), note: input.note };
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawVars)) {
    vars[key] = input.privacy ? redactPii(String(value)).text : String(value);
  }
  const stamp = (input.now ?? Date.now()).toString(36);
  return {
    id: `tst.${input.patternId.split(".").slice(-1)[0]}.fail-${stamp}`,
    patternId: input.patternId,
    description: `Failure ${input.mode}`,
    vars,
    asserts: input.base?.asserts ?? [{ type: "min_chars", value: 40 }],
    origin: "failure-loop",
    failureMode: input.mode,
    note: input.privacy ? redactPii(input.note).text : input.note,
    createdAt: new Date(input.now ?? Date.now()).toISOString(),
  };
}
