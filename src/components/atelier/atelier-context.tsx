import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { hasKey, readKeys, writeKeys } from "@/lib/ai/keys";
import { runAi } from "@/lib/ai/run";
import { modelLabel, providerById, type ProviderId } from "@/lib/ai/catalog";
import { passRateOf, runAsserts } from "@/lib/patterns/assert";
import { addPatternToStack, compilePattern, emptyStack, missingRequired, type StackState } from "@/lib/patterns/compose";
import { stableHash } from "@/lib/patterns/hash";
import { productionGate, verifiedGate } from "@/lib/patterns/gates";
import { buildFailureCase, forkPatternInto, importPackInto, rollbackPointer, touchPattern } from "@/lib/patterns/lifecycle";
import { redactPii, sanitizePublicError } from "@/lib/patterns/privacy";
import { caseUserInput, resolveRunVars } from "@/lib/patterns/run-case";
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
  recipes: SavedRecipe[];
  privacy: boolean;
  allowFallback: boolean;
  provider: ProviderId;
  model: string;
  stack: StackState;
};

export type SavedRecipe = {
  id: string;
  name: string;
  jobId: string;
  stack: StackState;
  createdAt: string;
};

export type RunView = {
  patternId: string;
  caseId?: string;
  output: string;
  storedOutput: string;
  redactions: string[];
  provider: string;
  model: string;
  requestedProvider?: string;
  fallback?: string;
  latencyMs: number;
  ok: boolean;
  checks: Array<{ type: string; ok: boolean; detail: string }>;
  passRate: number;
};

type Workspace = Persisted & {
  ready: boolean;
  view: "quick" | "usage" | "library" | "packs" | "roles" | "editor" | "stack";
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
  runCase: (patternId: string, caseId: string, overrideVars?: Record<string, string>) => Promise<void>;
  runSuite: (patternId: string) => Promise<void>;
  reportFailure: (patternId: string, mode: string, note: string) => void;
  promote: (patternId: string, label: "staging" | "production") => void;
  rollback: (patternId: string, snapshotId: string) => void;
  deprecate: (patternId: string) => void;
  setConfirmRead: (value: boolean) => void;
  exportPack: (packId: string, format: "json" | "md") => void;
  importPack: (raw: string) => void;
  clearError: () => void;
  saveRecipe: (input: { name: string; jobId: string; stack: StackState }) => void;
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
    recipes: [],
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
      recipes: parsed.recipes ?? [],
      stack: parsed.stack ?? seed.stack,
    };
  } catch {
    return seed;
  }
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
  const [view, setView] = useState<Workspace["view"]>("quick");
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
    const { patterns, tests, packs, releases, snapshots, history, recentIds, recipes, privacy, allowFallback, provider, model, stack } = data;
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ patterns, tests, packs, releases, snapshots, history, recentIds, recipes, privacy, allowFallback, provider, model, stack }),
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
      saveRecipe: (input) => {
        const id = `recipe.${Date.now().toString(36)}`;
        bump((current) => ({
          ...current,
          stack: input.stack,
          recipes: [
            { id, name: input.name, jobId: input.jobId, stack: input.stack, createdAt: new Date().toISOString() },
            ...current.recipes,
          ].slice(0, 20),
        }));
        setNotice(`Đã lưu workflow “${input.name}”. Mở Studio khi bạn muốn xem khối và test.`);
        setError("");
      },
      openPattern: (id) => {
        setActiveId(id);
        setView("editor");
        setNav(false);
        setConfirmRead(false);
        bump((current) => ({ ...current, recentIds: [id, ...current.recentIds.filter((item) => item !== id)].slice(0, 8) }));
      },
      forkPattern: (id) => {
        let forkId = "";
        bump((current) => {
          const result = forkPatternInto(current, id);
          if (!result) return current;
          forkId = result.forkId;
          return result.next;
        });
        if (forkId) {
          setActiveId(forkId);
          setView("editor");
          setNav(false);
          setNotice(`Đã fork ${forkId}`);
        }
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
      runCase: async (patternId, caseId, overrideVars) => {
        setBusy("case");
        setError("");
        try {
          const pattern = data.patterns.find((item) => item.id === patternId);
          const test = data.tests.find((item) => item.id === caseId);
          if (!pattern || !test) throw new Error("Không thấy test");
          const vars = resolveRunVars(test, overrideVars);
          const missing = missingRequired(pattern.variables, vars);
          if (missing.length) throw new Error(`Thiếu biến bắt buộc: ${missing.map((item) => item.name).join(", ")}`);
          const compiled = compilePattern(pattern, vars, false);
          const result = await executeModel({
            provider: data.provider,
            model: data.model,
            compiled,
            user: caseUserInput(vars),
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
            requestedProvider: data.provider,
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
            const result = await executeModel({
              provider: data.provider,
              model: data.model,
              compiled,
              user: caseUserInput(test.vars),
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
            requestedProvider: data.provider,
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
        const test = buildFailureCase({ patternId, mode, note, base, privacy: data.privacy });
        bump((current) => ({
          ...current,
          tests: [test, ...current.tests],
          patterns: current.patterns.map((item) =>
            item.id === patternId
              ? touchPattern(item, {
                  testCaseIds: [test.id, ...item.testCaseIds],
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
        let moved = false;
        bump((current) => {
          const next = rollbackPointer(current, patternId, snapshotId);
          moved = next !== current;
          return next;
        });
        if (moved) setNotice("Đã chuyển production pointer. Snapshot cũ vẫn còn.");
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
        if (!pack) {
          setError("Không thấy pack để xuất.");
          return;
        }
        try {
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
          setError("");
          setNotice(`Đã xuất ${pack.id}.${format === "json" ? "json" : "md"}.`);
        } catch (err) {
          setError(sanitizePublicError(err instanceof Error ? err.message : "Không xuất được pack"));
        }
      },
      importPack: (raw) => {
        const outcome = importPackInto(data, raw);
        if (!outcome.ok) {
          setImportError(outcome.error);
          return;
        }
        const next = outcome.next;
        bump((current) => ({ ...current, patterns: next.patterns, tests: next.tests, packs: next.packs }));
        setImportError("");
        setNotice(outcome.notice);
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
