import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hasKey, readKeys, writeKeys } from "@/lib/ai/keys";
import { runAi } from "@/lib/ai/run";
import { modelLabel, providerById, type ProviderId } from "@/lib/ai/catalog";
import { passRateOf, runAsserts } from "@/lib/patterns/assert";
import { addPatternToStack, compilePattern, emptyStack, missingRequired, type StackState } from "@/lib/patterns/compose";
import { checksumOf, stableHash } from "@/lib/patterns/hash";
import { productionGate, verifiedGate } from "@/lib/patterns/gates";
import { redactPii, sanitizePublicError } from "@/lib/patterns/privacy";
import { sandboxAnswer } from "@/lib/patterns/sandbox";
import { buildSeed } from "@/lib/patterns/seed";
import type { Pattern, PatternPack, ReleasePointer, Snapshot, SuitePoint, TestCase } from "@/lib/patterns/types";

const STORAGE = "prompt-atelier-workspace-v1";

type Persisted = {
  patterns: Pattern[];
  tests: TestCase[];
  packs: PatternPack[];
  releases: ReleasePointer[];
  snapshots: Snapshot[];
  history: Record<string, SuitePoint[]>;
  recentIds: string[];
  privacy: boolean;
  allowFallback: boolean;
  provider: ProviderId;
  model: string;
  stack: StackState;
};

export type RunView = {
  patternId: string;
  caseId?: string;
  output: string;
  storedOutput: string;
  redactions: string[];
  provider: string;
  model: string;
  fallback?: string;
  latencyMs: number;
  ok: boolean;
  checks: Array<{ type: string; ok: boolean; detail: string }>;
  passRate: number;
};

type Workspace = Persisted & {
  ready: boolean;
  view: "library" | "packs" | "roles" | "editor" | "stack";
  activeId: string | null;
  roleFilter: string;
  navOpen: boolean;
  busy: string;
  error: string;
  notice: string;
  importError: string;
  run: RunView | null;
  confirmRead: boolean;
  keySaved: boolean;
  actions: Actions;
};

type Actions = {
  setView: (view: Workspace["view"]) => void;
  setNav: (open: boolean) => void;
  setRoleFilter: (role: string) => void;
  openPattern: (id: string) => void;
  forkPattern: (id: string) => void;
  addToStack: (id: string) => void;
  updatePattern: (id: string, patch: Partial<Pattern>) => void;
  updateComponent: (id: string, key: keyof Pattern["components"], value: string) => void;
  updateVariable: (id: string, index: number, patch: Partial<Pattern["variables"][number]>) => void;
  addVariable: (id: string) => void;
  removeVariable: (id: string, index: number) => void;
  setStack: (stack: StackState) => void;
  clearStack: () => void;
  setPrivacy: (value: boolean) => void;
  setFallback: (value: boolean) => void;
  setProvider: (provider: ProviderId, model: string) => void;
  saveKey: (provider: ProviderId, key: string) => void;
  runCase: (patternId: string, caseId: string) => Promise<void>;
  runSuite: (patternId: string) => Promise<void>;
  reportFailure: (patternId: string, mode: string, note: string) => void;
  promote: (patternId: string, label: "staging" | "production") => void;
  rollback: (patternId: string, snapshotId: string) => void;
  deprecate: (patternId: string) => void;
  setConfirmRead: (value: boolean) => void;
  exportPack: (packId: string, format: "json" | "md") => void;
  importPack: (raw: string) => void;
  clearError: () => void;
};

const AtelierContext = createContext<Workspace | null>(null);

function seedState(): Persisted {
  const seed = buildSeed();
  return {
    patterns: seed.patterns,
    tests: seed.tests,
    packs: seed.packs,
    releases: [],
    snapshots: [],
    history: {},
    recentIds: [seed.patterns[2]?.id].filter(Boolean),
    privacy: true,
    allowFallback: true,
    provider: "sandbox",
    model: "deterministic",
    stack: emptyStack(),
  };
}

function loadState(): Persisted {
  const seed = seedState();
  if (typeof window === "undefined") return seed;
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return seed;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (!Array.isArray(parsed.patterns) || parsed.patterns.length === 0) return seed;
    return {
      ...seed,
      ...parsed,
      patterns: parsed.patterns,
      tests: parsed.tests ?? seed.tests,
      packs: parsed.packs?.length ? parsed.packs : seed.packs,
      stack: parsed.stack ?? seed.stack,
    };
  } catch {
    return seed;
  }
}

function touchPattern(pattern: Pattern, patch: Partial<Pattern>): Pattern {
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

async function executeModel(input: {
  provider: ProviderId;
  model: string;
  compiled: string;
  user: string;
  allowFallback: boolean;
}) {
  if (input.provider === "sandbox") {
    const started = performance.now();
    return {
      text: sandboxAnswer(input.compiled, input.user),
      provider: "sandbox" as const,
      model: "deterministic",
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
      fallback: undefined as string | undefined,
    };
  }
  const key = readKeys()[input.provider];
  const result = await runAi({
    data: {
      provider: input.provider,
      model: input.model,
      allowFallback: input.allowFallback,
      maxTokens: 800,
      userKey: key,
      messages: [
        { role: "system", content: "Thực thi đúng prompt. Không nhắc lại hướng dẫn hệ thống." },
        { role: "user", content: `${input.compiled}\n\n# Input\n${input.user}` },
      ],
    },
  });
  return {
    text: result.text,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs ?? 0,
    fallback: result.fallback,
  };
}

export function AtelierProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Persisted>(seedState);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<Workspace["view"]>("library");
  const [activeId, setActiveId] = useState<string | null>("pat.task.research-brief");
  const [roleFilter, setRoleFilter] = useState("");
  const [navOpen, setNav] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importError, setImportError] = useState("");
  const [run, setRun] = useState<RunView | null>(null);
  const [confirmRead, setConfirmRead] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    const loaded = loadState();
    setData(loaded);
    setKeySaved(hasKey(loaded.provider));
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { patterns, tests, packs, releases, snapshots, history, recentIds, privacy, allowFallback, provider, model, stack } = data;
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ patterns, tests, packs, releases, snapshots, history, recentIds, privacy, allowFallback, provider, model, stack }),
    );
  }, [data, ready]);

  const actions = useMemo<Actions>(() => {
    const bump = (recipe: (current: Persisted) => Persisted) => setData((current) => recipe(current));

    return {
      setView,
      setNav,
      setRoleFilter,
      clearError: () => {
        setError("");
        setNotice("");
      },
      openPattern: (id) => {
        setActiveId(id);
        setView("editor");
        setNav(false);
        setConfirmRead(false);
        bump((current) => ({ ...current, recentIds: [id, ...current.recentIds.filter((item) => item !== id)].slice(0, 8) }));
      },
      forkPattern: (id) => {
        bump((current) => {
          const source = current.patterns.find((item) => item.id === id);
          if (!source) return current;
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
          setActiveId(forkId);
          setView("editor");
          setNotice(`Đã fork ${forkId}`);
          return { ...current, patterns: [fork, ...current.patterns], tests: [...cloned, ...current.tests], recentIds: [forkId, ...current.recentIds].slice(0, 8) };
        });
      },
      addToStack: (id) => {
        let message = "";
        bump((current) => {
          const pattern = current.patterns.find((item) => item.id === id);
          if (!pattern) return current;
          const result = addPatternToStack(current.stack, pattern);
          message = result.notice ?? `Đã thêm ${pattern.name} vào stack.`;
          return { ...current, stack: result.stack };
        });
        setNotice(message);
        setView("stack");
        setNav(false);
      },
      updatePattern: (id, patch) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) => (item.id === id ? touchPattern(item, patch) : item)),
        }));
      },
      updateComponent: (id, key, value) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) =>
            item.id === id ? touchPattern(item, { components: { ...item.components, [key]: value } }) : item,
          ),
        }));
      },
      updateVariable: (id, index, patch) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) => {
            if (item.id !== id) return item;
            const variables = item.variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable));
            return touchPattern(item, { variables });
          }),
        }));
      },
      addVariable: (id) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) =>
            item.id === id
              ? touchPattern(item, {
                  variables: [...item.variables, { name: "field", type: "string", required: false, example: "" }],
                })
              : item,
          ),
        }));
      },
      removeVariable: (id, index) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) =>
            item.id === id ? touchPattern(item, { variables: item.variables.filter((_, i) => i !== index) }) : item,
          ),
        }));
      },
      setStack: (stack) => bump((current) => ({ ...current, stack })),
      clearStack: () => bump((current) => ({ ...current, stack: emptyStack() })),
      setPrivacy: (privacy) => bump((current) => ({ ...current, privacy })),
      setFallback: (allowFallback) => bump((current) => ({ ...current, allowFallback })),
      setProvider: (provider, model) => {
        setKeySaved(hasKey(provider));
        bump((current) => ({ ...current, provider, model }));
      },
      saveKey: (provider, key) => {
        const bag = readKeys();
        if (key.trim()) bag[provider] = key.trim();
        writeKeys(bag);
        setKeySaved(hasKey(provider));
        setNotice("Đã lưu key trên máy này. Ô nhập được xoá, key không hiện lại.");
      },
      runCase: async (patternId, caseId) => {
        setBusy("case");
        setError("");
        try {
          const pattern = data.patterns.find((item) => item.id === patternId);
          const test = data.tests.find((item) => item.id === caseId);
          if (!pattern || !test) throw new Error("Không thấy test");
          const missing = missingRequired(pattern.variables, test.vars);
          if (missing.length) throw new Error(`Thiếu biến bắt buộc: ${missing.map((item) => item.name).join(", ")}`);
          const compiled = compilePattern(pattern, test.vars, false);
          const user = Object.entries(test.vars).map(([key, value]) => `${key}: ${value}`).join("\n");
          const result = await executeModel({
            provider: data.provider,
            model: data.model,
            compiled,
            user,
            allowFallback: data.allowFallback,
          });
          const checks = runAsserts(result.text, test.asserts, pattern.outputSchema);
          const ok = checks.every((item) => item.ok);
          const redacted = data.privacy ? redactPii(result.text) : { text: result.text, hits: [] };
          setRun({
            patternId,
            caseId,
            output: result.text,
            storedOutput: data.privacy ? redacted.text : result.text,
            redactions: redacted.hits,
            provider: result.provider,
            model: modelLabel(result.provider, result.model),
            fallback: result.fallback,
            latencyMs: result.latencyMs,
            ok,
            checks,
            passRate: passRateOf(checks),
          });
        } catch (err) {
          setError(sanitizePublicError(err instanceof Error ? err.message : "Lỗi chạy test"));
        } finally {
          setBusy("");
        }
      },
      runSuite: async (patternId) => {
        setBusy("suite");
        setError("");
        try {
          const pattern = data.patterns.find((item) => item.id === patternId);
          const cases = data.tests.filter((item) => item.patternId === patternId);
          if (!pattern) throw new Error("Không thấy pattern");
          if (!cases.length) throw new Error("Pattern chưa có test");
          let passed = 0;
          let lastOutput = "";
          let lastMeta = { provider: data.provider, model: data.model, fallback: undefined as string | undefined, latencyMs: 0 };
          for (const test of cases) {
            const missing = missingRequired(pattern.variables, test.vars);
            if (missing.length) continue;
            const compiled = compilePattern(pattern, test.vars, false);
            const user = Object.entries(test.vars).map(([key, value]) => `${key}: ${value}`).join("\n");
            const result = await executeModel({
              provider: data.provider,
              model: data.model,
              compiled,
              user,
              allowFallback: data.allowFallback,
            });
            lastOutput = result.text;
            lastMeta = result;
            const checks = runAsserts(result.text, test.asserts, pattern.outputSchema);
            if (checks.every((item) => item.ok)) passed += 1;
          }
          const rate = Math.round((passed / cases.length) * 100);
          const pin = `${data.provider}:${data.model}`;
          const redacted = data.privacy ? redactPii(lastOutput) : { text: lastOutput, hits: [] };
          setRun({
            patternId,
            output: lastOutput,
            storedOutput: data.privacy ? redacted.text : lastOutput,
            redactions: redacted.hits,
            provider: lastMeta.provider,
            model: modelLabel(lastMeta.provider, lastMeta.model),
            fallback: lastMeta.fallback,
            latencyMs: lastMeta.latencyMs,
            ok: rate === 100,
            checks: [{ type: "suite", ok: rate === 100, detail: `${passed}/${cases.length} case` }],
            passRate: rate,
          });
          bump((current) => ({
            ...current,
            history: {
              ...current.history,
              [patternId]: [...(current.history[patternId] ?? []), { version: pattern.version, passRate: rate, at: new Date().toISOString() }].slice(-8),
            },
            patterns: current.patterns.map((item) =>
              item.id === patternId
                ? {
                    ...item,
                    evidence: {
                      ...item.evidence,
                      nTests: cases.length,
                      passRate: rate,
                      suitePass: rate === 100,
                      lastRunAt: new Date().toISOString(),
                      verifiedModels: rate === 100 ? Array.from(new Set([...item.evidence.verifiedModels, pin])) : item.evidence.verifiedModels,
                      testsetHash: stableHash(JSON.stringify(cases.map((test) => ({ id: test.id, asserts: test.asserts, vars: test.vars })))),
                    },
                  }
                : item,
            ),
          }));
          setNotice(rate === 100 ? "Suite xanh 100%." : `Suite ${rate}%. Chưa đủ để verify.`);
        } catch (err) {
          setError(sanitizePublicError(err instanceof Error ? err.message : "Lỗi suite"));
        } finally {
          setBusy("");
        }
      },
      reportFailure: (patternId, mode, note) => {
        const pattern = data.patterns.find((item) => item.id === patternId);
        if (!pattern) return;
        const base = data.tests.find((item) => item.patternId === patternId);
        const rawVars = { ...(base?.vars ?? {}), note };
        const vars: Record<string, string> = {};
        for (const [key, value] of Object.entries(rawVars)) {
          vars[key] = data.privacy ? redactPii(String(value)).text : String(value);
        }
        const id = `tst.${patternId.split(".").slice(-1)[0]}.fail-${Date.now().toString(36)}`;
        const test: TestCase = {
          id,
          patternId,
          description: `Failure ${mode}`,
          vars,
          asserts: base?.asserts ?? [{ type: "min_chars", value: 40 }],
          origin: "failure-loop",
          failureMode: mode,
          note: data.privacy ? redactPii(note).text : note,
          createdAt: new Date().toISOString(),
        };
        bump((current) => ({
          ...current,
          tests: [test, ...current.tests],
          patterns: current.patterns.map((item) =>
            item.id === patternId
              ? touchPattern(item, {
                  testCaseIds: [id, ...item.testCaseIds],
                  failureModes: item.failureModes.includes(mode) ? item.failureModes : [...item.failureModes, mode],
                  evidence: { ...item.evidence, nTests: item.evidence.nTests + 1, suitePass: false },
                })
              : item,
          ),
        }));
        setNotice("Đã tạo regression test. Chạy lại suite để so pass rate.");
      },
      promote: (patternId, label) => {
        const pattern = data.patterns.find((item) => item.id === patternId);
        if (!pattern) return;
        const gate = label === "production" ? productionGate(pattern, data.tests, data.releases, confirmRead) : verifiedGate(pattern, data.tests);
        if (!gate.ok) {
          setError(gate.reasons.join(" "));
          return;
        }
        const snapshot: Snapshot = {
          id: `snap-${pattern.id}-${pattern.version}-${Date.now().toString(36)}`,
          patternId: pattern.id,
          version: pattern.version,
          pattern: { ...pattern, status: label === "production" ? "production" : "verified" },
          note: label,
          createdAt: new Date().toISOString(),
        };
        const pointer: ReleasePointer = {
          patternId: pattern.id,
          label,
          version: pattern.version,
          snapshotId: snapshot.id,
          passRate: pattern.evidence.passRate ?? 0,
          testsetHash: pattern.evidence.testsetHash ?? "",
          promotedAt: snapshot.createdAt,
        };
        bump((current) => ({
          ...current,
          snapshots: [...current.snapshots, snapshot],
          releases: [...current.releases.filter((item) => !(item.patternId === patternId && item.label === label)), pointer],
          patterns: current.patterns.map((item) =>
            item.id === patternId ? { ...item, status: label === "production" ? "production" : "verified" } : item,
          ),
        }));
        setError("");
        setNotice(label === "production" ? "Đã trỏ production tới version này." : "Đã gắn staging / verified.");
      },
      rollback: (patternId, snapshotId) => {
        bump((current) => {
          const snapshot = current.snapshots.find((item) => item.id === snapshotId && item.patternId === patternId);
          if (!snapshot) return current;
          return {
            ...current,
            patterns: current.patterns.map((item) => (item.id === patternId ? { ...snapshot.pattern, status: "production" } : item)),
            releases: current.releases.map((item) =>
              item.patternId === patternId && item.label === "production"
                ? { ...item, version: snapshot.version, snapshotId: snapshot.id, promotedAt: new Date().toISOString(), passRate: snapshot.pattern.evidence.passRate ?? item.passRate }
                : item,
            ),
          };
        });
        setNotice("Đã chuyển production pointer. Version cũ vẫn còn.");
      },
      deprecate: (patternId) => {
        bump((current) => ({
          ...current,
          patterns: current.patterns.map((item) => (item.id === patternId ? { ...item, status: "deprecated" } : item)),
        }));
        setNotice("Đã deprecate. Không xoá version.");
      },
      setConfirmRead,
      exportPack: (packId, format) => {
        const pack = data.packs.find((item) => item.id === packId);
        if (!pack) return;
        const patterns = data.patterns.filter((item) => pack.patterns.includes(item.id));
        const tests = data.tests.filter((item) => pack.patterns.includes(item.patternId));
        const body = format === "json"
          ? JSON.stringify({ pack, patterns, tests }, null, 2)
          : [
              `# ${pack.name}`,
              ``,
              `id: ${pack.id}`,
              `version: ${pack.version}`,
              `license: ${pack.license}`,
              `manifestHash: ${pack.manifestHash}`,
              `dependsOn: [${pack.dependsOn.join(", ")}]`,
              ``,
              ...patterns.map((pattern) =>
                [
                  `## ${pattern.name}`,
                  `id: ${pattern.id}`,
                  `version: ${pattern.version}`,
                  `status: ${pattern.status}`,
                  `license: ${pattern.provenance.license}`,
                  ``,
                  "```",
                  pattern.components.directive,
                  pattern.components.task,
                  "```",
                  "",
                ].join("\n"),
              ),
            ].join("\n");
        const blob = new Blob([body], { type: format === "json" ? "application/json" : "text/markdown" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${pack.id}.${format === "json" ? "json" : "md"}`;
        link.click();
        URL.revokeObjectURL(url);
      },
      importPack: (raw) => {
        setImportError("");
        try {
          const parsed = JSON.parse(raw) as { pack?: PatternPack; patterns?: Pattern[]; tests?: TestCase[] };
          if (!parsed.pack?.id || !Array.isArray(parsed.patterns)) throw new Error("File không phải pack Atelier");
          const notes: string[] = [];
          bump((current) => {
            let patterns = [...current.patterns];
            let tests = [...current.tests];
            for (const incoming of parsed.patterns ?? []) {
              const existing = patterns.find((item) => item.id === incoming.id);
              if (existing && (existing.status === "production" || existing.status === "verified")) {
                const forkId = `${incoming.id}-import-${Date.now().toString(36).slice(-4)}`;
                patterns = [{ ...incoming, id: forkId, status: "draft", name: `${incoming.name} import` }, ...patterns];
                notes.push(`${incoming.id} đang ${existing.status} — tạo fork ${forkId}`);
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
            return { ...current, patterns, tests, packs };
          });
          setNotice(notes.join(" ") || `Đã nhập ${parsed.pack.id}`);
        } catch (err) {
          setImportError(err instanceof Error ? err.message : "Import lỗi");
        }
      },
    };
  }, [confirmRead, data]);

  const value: Workspace = { ...data, ready, view, activeId, roleFilter, navOpen, busy, error, notice, importError, run, confirmRead, keySaved, actions };
  return <AtelierContext.Provider value={value}>{children}</AtelierContext.Provider>;
}

export function useAtelier() {
  const value = useContext(AtelierContext);
  if (!value) throw new Error("Atelier missing");
  return value;
}

export function providerName(id: string) {
  return providerById(id).name;
}
