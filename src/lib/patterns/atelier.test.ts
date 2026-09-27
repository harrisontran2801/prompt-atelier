import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAsserts } from "./assert.ts";
import { compilePattern, compileStack, emptyStack, fillTemplate, missingRequired } from "./compose.ts";
import { productionGate, verifiedGate } from "./gates.ts";
import { forkPatternInto, importPackInto, rollbackPointer } from "./lifecycle.ts";
import { redactPii, sanitizePublicError } from "./privacy.ts";
import { caseFormVars, resolveRunVars, runSandboxCase, suiteSandboxOutputs } from "./run-case.ts";
import { sandboxAnswer } from "./sandbox.ts";
import { buildSeed } from "./seed.ts";
import type { Pattern, ReleasePointer, TestCase } from "./types.ts";

const seed = buildSeed();
const byId = (id: string) => {
  const pattern = seed.patterns.find((item) => item.id === id);
  if (!pattern) throw new Error(`missing ${id}`);
  return pattern;
};

function blankPattern(
  partial: Omit<Partial<Pattern>, "components" | "id" | "kind" | "name"> & {
    id: string;
    kind: Pattern["kind"];
    name: string;
    components?: Partial<Pattern["components"]>;
  },
): Pattern {
  const { components: componentPatch, ...rest } = partial;
  return {
    version: "0.1.0",
    summary: "t",
    useCase: "t",
    antiUseCase: "t",
    category: "t",
    tags: [],
    roles: [],
    status: "draft",
    variables: [],
    outputContract: "",
    testCaseIds: [],
    evaluatorIds: [],
    failureModes: [],
    compatibleModels: ["sandbox:deterministic"],
    redTeamNotes: "",
    evidence: { nTests: 0, verifiedModels: [] },
    provenance: { author: "tester", license: "MIT", changelog: ["0.1.0"] },
    checksum: "abc",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...rest,
    components: { directive: "", context: "", task: "", guardrails: "", output: "", ...componentPatch },
  };
}

describe("seed", () => {
  it("ships the minimum patterns and packs", () => {
    assert.ok(seed.patterns.length >= 12);
    assert.ok(seed.packs.length >= 3);
    for (const pack of seed.packs) {
      assert.ok(pack.patterns.length >= 2, pack.id);
      assert.ok(pack.manifestHash);
      assert.equal(pack.testSuite.length, seed.tests.filter((item) => pack.patterns.includes(item.patternId)).length);
    }
    const kinds = new Set(seed.patterns.map((item) => item.kind));
    for (const kind of ["persona", "protocol", "task", "format", "guardrail", "safety", "evaluator"]) {
      assert.ok(kinds.has(kind as Pattern["kind"]), kind);
    }
    assert.ok(seed.tests.filter((item) => item.patternId === "pat.task.research-brief").length >= 3);
  });
});

describe("fillTemplate and required variables", () => {
  const variables = [
    { name: "topic", type: "string" as const, required: true, example: "tools" },
    { name: "tone", type: "string" as const, required: false, default: "thẳng" },
    { name: "key", type: "string" as const, required: false, secret: true, example: "x" },
  ];

  it("fills, falls back to default, and leaves unknown tokens", () => {
    const text = fillTemplate("{{topic}} / {{ tone }} / {{missing}}", { topic: "visa" }, variables, false);
    assert.equal(text, "visa / thẳng / {{missing}}");
  });

  it("masks secret variables only when asked", () => {
    const masked = fillTemplate("k={{key}}", { key: "sk-supersecretvalue" }, variables, true);
    const raw = fillTemplate("k={{key}}", { key: "sk-supersecretvalue" }, variables, false);
    assert.equal(masked, "k=••••");
    assert.equal(raw, "k=sk-supersecretvalue");
  });

  it("flags required variables that will actually run", () => {
    const missing = missingRequired(variables, { topic: "  " });
    assert.deepEqual(missing.map((item) => item.name), ["topic"]);
    assert.deepEqual(missingRequired(variables, { topic: "visa" }), []);
    assert.deepEqual(
      missingRequired([{ name: "n", type: "string", required: true, default: "1" }], {}),
      [],
    );
  });
});

describe("compilePattern", () => {
  it("keeps directive, context, task, guardrails, output in that order", () => {
    const pattern = blankPattern({
      id: "p",
      kind: "task",
      name: "P",
      outputContract: "contract",
      components: {
        directive: "D",
        context: "C {{topic}}",
        task: "T",
        guardrails: "G",
        output: "O",
      },
      variables: [{ name: "topic", type: "string", required: true, example: "x" }],
    });
    const compiled = compilePattern(pattern, { topic: "visa" }, false);
    const order = ["# Directive", "# Context", "# Task", "# Guardrails", "# Output contract"].map((label) =>
      compiled.indexOf(label),
    );
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
    assert.ok(order.every((index) => index >= 0));
    assert.match(compiled, /C visa/);
  });
});

describe("compileStack", () => {
  const safety = blankPattern({
    id: "safe",
    kind: "safety",
    name: "PII",
    components: { guardrails: "SAFETY_WINS không lặp email" },
  });
  const plainA = blankPattern({
    id: "ga",
    kind: "guardrail",
    name: "No fab",
    components: { guardrails: "Không bịa số liệu" },
  });
  const plainB = blankPattern({
    id: "gb",
    kind: "guardrail",
    name: "Invent",
    components: { guardrails: "Được bịa nếu cần" },
  });
  const task = blankPattern({
    id: "task",
    kind: "task",
    name: "Json task",
    components: { task: "Làm việc", output: "Trả về JSON object" },
  });
  const format = blankPattern({
    id: "fmt",
    kind: "format",
    name: "Memo",
    components: { output: "Năm mục văn xuôi." },
  });
  const evaluator = blankPattern({
    id: "ev",
    kind: "evaluator",
    name: "Structural",
    components: { output: "EVALUATOR_SECRET_BLOCK" },
  });
  const all = [safety, plainA, plainB, task, format, evaluator];

  it("lets safety win and refuses to merge opposite guardrails silently", () => {
    const stack = {
      ...emptyStack(),
      safetyIds: ["safe"],
      guardrailIds: ["ga", "gb"],
    };
    const open = compileStack(stack, all);
    const conflict = open.conflicts.find((item) => item.id === "guard-ga-gb");
    assert.ok(conflict);
    assert.equal(conflict.blocking, true);
    assert.match(conflict.message, /Không merge thầm/);
    assert.match(open.compiled, /SAFETY_WINS/);
    const safetyLine = open.sources.find((item) => item.id === "safe");
    assert.equal(safetyLine?.included, true);
    assert.match(safetyLine?.note ?? "", /thắng/);

    const chosen = compileStack({ ...stack, resolutions: { "guard-ga-gb": "ga" } }, all);
    assert.match(chosen.compiled, /Không bịa số liệu/);
    assert.doesNotMatch(chosen.compiled, /Được bịa/);
    assert.match(chosen.compiled, /SAFETY_WINS/);
    assert.equal(chosen.sources.find((item) => item.id === "gb")?.included, false);
  });

  it("resolves a format/task contract conflict and defaults to format", () => {
    const stack = { ...emptyStack(), taskId: "task", formatId: "fmt" };
    const result = compileStack(stack, all);
    const conflict = result.conflicts.find((item) => item.id === "format-vs-task");
    assert.ok(conflict);
    assert.equal(conflict.blocking, false);
    assert.match(result.compiled, /Năm mục văn xuôi/);
    assert.doesNotMatch(result.compiled, /JSON object/);

    const taskWins = compileStack({ ...stack, resolutions: { "format-vs-task": "task" } }, all);
    assert.match(taskWins.compiled, /JSON object/);
    assert.doesNotMatch(taskWins.compiled, /Năm mục văn xuôi/);
  });

  it("keeps the evaluator out of the compiled prompt", () => {
    const result = compileStack({ ...emptyStack(), evaluatorIds: ["ev"], taskId: "task" }, all);
    assert.deepEqual(result.evaluatorNames, ["Structural"]);
    assert.equal(result.sources.find((item) => item.id === "ev")?.included, false);
    assert.doesNotMatch(result.compiled, /EVALUATOR_SECRET_BLOCK/);
  });
});

describe("assertions", () => {
  const schema = JSON.stringify({ required: ["summary"] });

  it("covers every deterministic assert type", () => {
    const output = ["1. Fact một", "2. Fact hai", "3. Fact ba", "xem https://example.com/a", ""].join("\n");
    const rows = runAsserts(
      output,
      [
        { type: "min_chars", value: 10 },
        { type: "contains", value: "Fact" },
        { type: "not_contains", value: "mật khẩu của bạn là" },
        { type: "regex", value: "fact" },
        { type: "numbered_min", value: 3 },
        { type: "has_url" },
      ],
    );
    assert.ok(rows.every((row) => row.ok));

    const bad = runAsserts("ngắn", [
      { type: "min_chars", value: 40 },
      { type: "contains", value: "Fact" },
      { type: "not_contains", value: "ngắn" },
      { type: "regex", value: "^Fact" },
      { type: "numbered_min", value: 2 },
      { type: "has_url" },
      { type: "json_valid" },
    ]);
    assert.ok(bad.every((row) => !row.ok));

    const jsonOk = runAsserts('{"summary":"ok"}', [{ type: "json_valid" }, { type: "schema" }], schema);
    assert.ok(jsonOk.every((row) => row.ok));
    const jsonBad = runAsserts('{"other":1}', [{ type: "schema" }], schema);
    assert.equal(jsonBad[0]?.ok, false);
    assert.match(jsonBad[0]?.detail ?? "", /summary/);
    const brokenRegex = runAsserts("x", [{ type: "regex", value: "(" }]);
    assert.equal(brokenRegex[0]?.ok, false);
  });
});

describe("gates", () => {
  const research = byId("pat.task.research-brief");

  it("verified gate is fail-closed", () => {
    assert.equal(verifiedGate(research, seed.tests).ok, true);
    const stripped = { ...research, evidence: { ...research.evidence, passRate: 80, suitePass: false, verifiedModels: [] } };
    const result = verifiedGate(stripped, seed.tests);
    assert.equal(result.ok, false);
    assert.ok(result.reasons.length >= 1);

    const noTests = verifiedGate(research, []);
    assert.equal(noTests.ok, false);
    assert.match(noTests.reasons.join(" "), /3 test/);

    const noExample = verifiedGate(
      { ...research, variables: [{ name: "topic", type: "string", required: true }] },
      seed.tests,
    );
    assert.match(noExample.reasons.join(" "), /example/);
  });

  it("production gate blocks a drop, an uncovered high failure, a stale suite, and unread notes", () => {
    const fresh = { ...research, evidence: { ...research.evidence, lastRunAt: new Date().toISOString(), passRate: 100, suitePass: true } };
    const ready = productionGate(fresh, seed.tests, [], true);
    assert.equal(ready.ok, true, ready.reasons.join(" | "));

    const unread = productionGate(fresh, seed.tests, [], false);
    assert.match(unread.reasons.join(" "), /anti-use-case/);

    const stale = productionGate(
      { ...fresh, evidence: { ...fresh.evidence, lastRunAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() } },
      seed.tests,
      [],
      true,
    );
    assert.match(stale.reasons.join(" "), /14 ngày/);

    const current: ReleasePointer = {
      patternId: fresh.id,
      label: "production",
      version: "1.0.0",
      snapshotId: "snap-old",
      passRate: 100,
      testsetHash: "abc",
      promotedAt: "2026-09-01T00:00:00.000Z",
    };
    const dropped = productionGate(
      { ...fresh, evidence: { ...fresh.evidence, passRate: 80 } },
      seed.tests,
      [current],
      true,
    );
    assert.match(dropped.reasons.join(" "), /thấp hơn production/);

    const uncovered = productionGate(
      { ...fresh, failureModes: [...fresh.failureModes, "prompt-injection"] },
      seed.tests,
      [],
      true,
    );
    assert.match(uncovered.reasons.join(" "), /prompt-injection/);
  });
});

describe("privacy", () => {
  it("redacts email, phone, token and card", () => {
    const sample = "mail ada@example.com phone +84 912 345 678 token sk-supersecretvalue card 4242424242424242";
    const { text, hits } = redactPii(sample);
    assert.equal(text.includes("ada@example.com"), false);
    assert.equal(text.includes("sk-supersecretvalue"), false);
    assert.equal(text.includes("4242424242424242"), false);
    assert.equal(text.includes("912 345 678"), false);
    assert.ok(hits.includes("email"));
    assert.ok(hits.includes("phone"));
    assert.ok(hits.includes("token"));
    assert.ok(hits.includes("card"));
  });

  it("does not leak a secret in a public error", () => {
    const message = sanitizePublicError("fail Bearer sk-supersecretvalue key=hf_abcdefghijklmnopqrstuvwxyz");
    assert.equal(message.includes("sk-supersecretvalue"), false);
    assert.equal(message.includes("hf_abcdefghijklmnopqrstuvwxyz"), false);
    assert.match(message, /\[redacted\]/);
  });
});

describe("sandbox", () => {
  it("is deterministic for research, code review, support, strategy and JSON", () => {
    const research = sandboxAnswer("Nghiên cứu chủ đề", "topic: visa");
    assert.equal(research, sandboxAnswer("Nghiên cứu chủ đề", "topic: visa"));
    assert.match(research, /Fact/);
    assert.match(research, /https?:\/\//);

    const review = sandboxAnswer("Đây là code review severity P0", "code: fn()");
    assert.match(review, /P1/);
    assert.match(review, /Test plan/);

    const support = sandboxAnswer("Trả lời khách hàng", "issue: hoàn tiền");
    assert.match(support, /Mình hiểu/);

    const strategy = sandboxAnswer("Viết chiến lược", "product: Atelier");
    assert.match(strategy, /Khuyến nghị/);
    assert.match(strategy, /Rủi ro/);

    const json = sandboxAnswer("Trả JSON", "topic: visa");
    assert.equal(json, sandboxAnswer("Trả JSON", "topic: visa"));
    const parsed = JSON.parse(json) as { summary: string };
    assert.match(parsed.summary, /visa/);
  });
});

describe("test lab vars", () => {
  const pattern = byId("pat.task.research-brief");
  const saved = seed.tests.find((item) => item.id === "tst.research.1");
  if (!saved) throw new Error("missing research case");

  it("prefills the form from the selected case without aliasing saved vars", () => {
    const form = caseFormVars(saved);
    assert.deepEqual(form, saved.vars);
    assert.notEqual(form, saved.vars);
    assert.equal(form.topic, "AI writing tools");
    form.topic = "changed in the form";
    assert.equal(saved.vars.topic, "AI writing tools");
  });

  it("uses override vars for one sandbox run and leaves the saved case alone", () => {
    const before = saved.vars.topic;
    const result = runSandboxCase(pattern, saved, { topic: "OVERRIDE_TOKEN_91", market: saved.vars.market });
    assert.match(result.output, /OVERRIDE_TOKEN_91/);
    assert.doesNotMatch(runSandboxCase(pattern, saved).output, /OVERRIDE_TOKEN_91/);
    assert.equal(saved.vars.topic, before);
    assert.notEqual(result.vars, saved.vars);
    const resolved = resolveRunVars(saved, { topic: "" });
    assert.equal(resolved.topic, "");
    assert.equal(saved.vars.topic, before);
  });

  it("runs the suite from saved cases, ignoring a temporary single-case override", () => {
    const cases = seed.tests.filter((item) => item.patternId === pattern.id);
    const before = suiteSandboxOutputs(pattern, cases);
    const form = caseFormVars(cases[0]);
    form.topic = "OVERRIDE_TOKEN_91";
    const single = runSandboxCase(pattern, cases[0], form);
    assert.match(single.output, /OVERRIDE_TOKEN_91/);
    assert.deepEqual(suiteSandboxOutputs(pattern, cases), before);
    assert.equal(cases[0].vars.topic, "AI writing tools");
    assert.equal(before.length, cases.length);
  });
});

describe("pack import, fork, rollback", () => {
  it("forks a production id instead of overwriting it, and rejects a bad file", () => {
    const research = byId("pat.task.research-brief");
    const production: Pattern = { ...research, status: "production" };
    const state = {
      patterns: [production],
      tests: seed.tests.filter((item) => item.patternId === research.id),
      packs: seed.packs,
    };
    const hijack = JSON.stringify({
      pack: { id: "pack.evil", name: "Evil", version: "9.0.0", summary: "", license: "MIT", dependsOn: [], patterns: [research.id], testSuite: [], manifestHash: "x" },
      patterns: [{ ...research, name: "Hijack", status: "production" }],
      tests: state.tests,
    });
    const imported = importPackInto(state, hijack, "abcd");
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    const original = imported.next.patterns.find((item) => item.id === research.id);
    assert.equal(original?.name, research.name);
    assert.equal(original?.status, "production");
    const fork = imported.next.patterns.find((item) => item.id === `${research.id}-import-abcd`);
    assert.equal(fork?.status, "draft");
    assert.match(fork?.name ?? "", /import/);
    assert.match(imported.notice, /không ghi đè/);

    const bad = importPackInto(state, "{not json");
    assert.equal(bad.ok, false);
    if (bad.ok) return;
    assert.match(bad.error, /Không đọc được JSON/);
    assert.equal(importPackInto(state, '{"pack":{}}').ok, false);
  });

  it("gives a fork its own test ids", () => {
    const result = forkPatternInto(
      { patterns: seed.patterns, tests: seed.tests, recentIds: [] },
      "pat.task.research-brief",
    );
    assert.ok(result);
    if (!result) return;
    const cloned = result.next.tests.filter((item) => item.patternId === result.forkId);
    const originals = new Set(seed.tests.map((item) => item.id));
    assert.ok(cloned.length >= 3);
    for (const test of cloned) {
      assert.equal(originals.has(test.id), false);
      assert.match(test.id, /-fork-/);
    }
    assert.equal(seed.tests.find((item) => item.id === "tst.research.1")?.patternId, "pat.task.research-brief");
  });

  it("moves the production pointer and keeps every snapshot", () => {
    const pattern = byId("pat.task.research-brief");
    const older: Pattern = { ...pattern, version: "1.0.0", status: "production" };
    const newer: Pattern = { ...pattern, version: "1.2.0", status: "production" };
    const snapshots = [
      { id: "snap-a", patternId: pattern.id, version: "1.0.0", pattern: older, note: "production", createdAt: "2026-09-01T00:00:00.000Z" },
      { id: "snap-b", patternId: pattern.id, version: "1.2.0", pattern: newer, note: "production", createdAt: "2026-09-02T00:00:00.000Z" },
    ];
    const state = {
      patterns: [newer],
      releases: [
        {
          patternId: pattern.id,
          label: "production" as const,
          version: "1.2.0",
          snapshotId: "snap-b",
          passRate: 100,
          testsetHash: "h",
          promotedAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      snapshots,
    };
    const next = rollbackPointer(state, pattern.id, "snap-a", "2026-09-03T00:00:00.000Z");
    assert.equal(next.snapshots.length, 2);
    assert.equal(next.snapshots[0].id, "snap-a");
    assert.equal(next.snapshots[1].id, "snap-b");
    assert.equal(next.releases[0].snapshotId, "snap-a");
    assert.equal(next.releases[0].version, "1.0.0");
    assert.equal(next.patterns[0].version, "1.0.0");
    assert.equal(state.releases[0].snapshotId, "snap-b");
  });
});

describe("failure loop", () => {
  it("stores a redacted regression case", async () => {
    const { buildFailureCase } = await import("./lifecycle.ts");
    const test = buildFailureCase({
      patternId: "pat.task.support-reply",
      mode: "prompt-injection",
      note: "mail ada@example.com token sk-supersecretvalue",
      privacy: true,
      now: 1_700_000_000_000,
      base: seed.tests.find((item) => item.id === "tst.support.1"),
    });
    assert.equal(test.origin, "failure-loop");
    assert.equal(test.failureMode, "prompt-injection");
    assert.equal(JSON.stringify(test).includes("ada@example.com"), false);
    assert.equal(JSON.stringify(test).includes("sk-supersecretvalue"), false);
    assert.match(test.note ?? "", /\[email\]/);
    assert.match(test.note ?? "", /\[token\]/);
  });
});
