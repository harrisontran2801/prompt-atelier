import { useMemo, useState } from "react";
import { PROVIDERS } from "@/lib/ai/catalog";
import { runAsserts } from "@/lib/patterns/assert";
import { compilePattern, missingRequired } from "@/lib/patterns/compose";
import { productionGate, verifiedGate } from "@/lib/patterns/gates";
import { FAILURE_MODES, type Pattern } from "@/lib/patterns/types";
import { useAtelier } from "./atelier-context";

const BLOCKS: Array<{ key: keyof Pattern["components"]; label: string }> = [
  { key: "directive", label: "Directive" },
  { key: "context", label: "Context" },
  { key: "task", label: "Task" },
  { key: "guardrails", label: "Guardrails — hướng dẫn model" },
  { key: "output", label: "Output contract" },
];

export function EditorView() {
  const workspace = useAtelier();
  const { patterns, tests, releases, snapshots, history, actions, busy, run, provider, model, allowFallback, confirmRead, keySaved } = workspace;
  const pattern = patterns.find((item) => item.id === workspace.activeId) ?? patterns[0];
  const [tab, setTab] = useState<"blocks" | "tests" | "release">("blocks");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [caseId, setCaseId] = useState("");
  const [failMode, setFailMode] = useState(FAILURE_MODES[0].id);
  const [failNote, setFailNote] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const mine = tests.filter((item) => item.patternId === pattern?.id);
  const selected = mine.find((item) => item.id === caseId) ?? mine[0];
  const activeVars = { ...(selected?.vars ?? {}), ...vars };
  const compiled = pattern ? compilePattern(pattern, activeVars, true) : "";
  const missing = pattern ? missingRequired(pattern.variables, selected?.vars ?? vars) : [];
  const verified = pattern ? verifiedGate(pattern, tests) : { ok: false, reasons: [] };
  const production = pattern ? productionGate(pattern, tests, releases, confirmRead) : { ok: false, reasons: [] };
  const points = pattern ? history[pattern.id] ?? [] : [];
  const previous = points.length > 1 ? points[points.length - 2] : undefined;
  const currentProd = releases.find((item) => item.patternId === pattern?.id && item.label === "production");
  const prodSnaps = snapshots.filter((item) => item.patternId === pattern?.id);

  const providerDef = useMemo(() => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0], [provider]);

  if (!pattern) return <p>Chưa có pattern.</p>;

  return (
    <div>
      <p className="kicker">{pattern.id}</p>
      <div className="card-top">
        <h2 className="lede">{pattern.name}</h2>
        <span className={`pill ${pattern.status}`}>{pattern.status}</span>
      </div>
      <p className="muted">{pattern.summary}</p>
      <div className="meta-row">
        <span className="tag">v{pattern.version}</span>
        <span className="tag">{pattern.kind}</span>
        <span className="tag">{pattern.category}</span>
        <span className="tag">{pattern.provenance.license}</span>
        <span className="tag">hash {pattern.evidence.testsetHash ?? "—"}</span>
        <span className="tag">{pattern.evidence.nTests} tests</span>
        {pattern.evidence.nTests >= 3 && pattern.evidence.passRate !== undefined ? (
          <span className="score">{pattern.evidence.passRate}%</span>
        ) : (
          <span className="faint">chưa đủ 3 test để hiện điểm</span>
        )}
      </div>
      <div className="filters">
        <button className={`chip ${tab === "blocks" ? "active" : ""}`} onClick={() => setTab("blocks")}>Blocks</button>
        <button className={`chip ${tab === "tests" ? "active" : ""}`} onClick={() => setTab("tests")}>Test lab</button>
        <button className={`chip ${tab === "release" ? "active" : ""}`} onClick={() => setTab("release")}>Release</button>
      </div>

      {tab === "blocks" && (
        <div className="editor-grid">
          <div className="card">
            <label className="muted">Tên
              <input className="field" value={pattern.name} onChange={(event) => actions.updatePattern(pattern.id, { name: event.target.value })} />
            </label>
            <label className="muted">Version
              <input className="field" value={pattern.version} onChange={(event) => actions.updatePattern(pattern.id, { version: event.target.value })} />
            </label>
            <label className="muted">Use case
              <textarea value={pattern.useCase} onChange={(event) => actions.updatePattern(pattern.id, { useCase: event.target.value })} />
            </label>
            <label className="muted">Anti-use-case
              <textarea value={pattern.antiUseCase} onChange={(event) => actions.updatePattern(pattern.id, { antiUseCase: event.target.value })} />
            </label>
            {BLOCKS.map((block) => (
              <label key={block.key} className="muted">{block.label}
                <textarea value={pattern.components[block.key]} onChange={(event) => actions.updateComponent(pattern.id, block.key, event.target.value)} />
              </label>
            ))}
            <p className="faint">Guardrail model nằm trong prompt. Redact email, token, thẻ chạy bằng code khi Privacy bật.</p>
          </div>
          <div className="card">
            <p className="kicker">Variables</p>
            {pattern.variables.map((variable, index) => (
              <div key={`${variable.name}-${index}`} className="var-line">
                <input className="field" value={variable.name} onChange={(event) => actions.updateVariable(pattern.id, index, { name: event.target.value })} />
                <select className="field" value={variable.type} onChange={(event) => actions.updateVariable(pattern.id, index, { type: event.target.value as Pattern["variables"][number]["type"] })}>
                  {["string", "text", "number", "enum", "json", "code"].map((type) => <option key={type}>{type}</option>)}
                </select>
                <label className="chip">required
                  <input type="checkbox" checked={variable.required} onChange={(event) => actions.updateVariable(pattern.id, index, { required: event.target.checked })} />
                </label>
                <label className="chip">secret
                  <input type="checkbox" checked={Boolean(variable.secret)} onChange={(event) => actions.updateVariable(pattern.id, index, { secret: event.target.checked })} />
                </label>
                <input className="field" placeholder="example" value={variable.example ?? ""} onChange={(event) => actions.updateVariable(pattern.id, index, { example: event.target.value })} />
                <input className="field" placeholder="default" value={variable.default ?? ""} onChange={(event) => actions.updateVariable(pattern.id, index, { default: event.target.value })} />
                <button className="btn-ghost" onClick={() => actions.removeVariable(pattern.id, index)}>Xoá</button>
              </div>
            ))}
            <button className="btn-ghost" onClick={() => actions.addVariable(pattern.id)}>Thêm biến</button>
            <p className="kicker">Preview đã che secret</p>
            <pre className="prose">{compiled}</pre>
            <p className="faint">Checksum {pattern.checksum} · {pattern.provenance.author}</p>
            <p className="muted">{pattern.redTeamNotes}</p>
          </div>
        </div>
      )}

      {tab === "tests" && (
        <div className="editor-grid">
          <section className="card">
            <p className="kicker">Provider</p>
            <div className="btn-row">
              <select className="field" value={provider} onChange={(event) => {
                const next = PROVIDERS.find((item) => item.id === event.target.value) ?? PROVIDERS[0];
                actions.setProvider(next.id, next.models[0].id);
                setKeyDraft("");
              }}>
                {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select className="field" value={model} onChange={(event) => actions.setProvider(provider, event.target.value)}>
                {providerDef.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </div>
            <p className="faint">{providerDef.blurb}</p>
            <a href={providerDef.keyUrl} target="_blank" rel="noreferrer">Lấy key</a>
            {providerDef.needsKey && (
              <div className="btn-row">
                <input className="field" type="password" placeholder={keySaved ? "Key đã lưu — không hiện lại" : "Dán key, bấm lưu"} value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} autoComplete="off" />
                <button className="btn-primary" onClick={() => { actions.saveKey(provider, keyDraft); setKeyDraft(""); }}>Lưu key</button>
              </div>
            )}
            <label className="chip">Fallback Pollinations
              <input type="checkbox" checked={allowFallback} onChange={(event) => actions.setFallback(event.target.checked)} />
            </label>
            <p className="kicker">Cases</p>
            {mine.map((item) => (
              <button key={item.id} className={`nav-btn ${selected?.id === item.id ? "active" : ""}`} onClick={() => { setCaseId(item.id); setVars({}); }}>
                {item.description} · {item.origin}
              </button>
            ))}
            {selected && (
              <div>
                {pattern.variables.map((variable) => (
                  <label key={variable.name} className="muted">{variable.name} {variable.required ? "· required" : ""}
                    <textarea value={activeVars[variable.name] ?? ""} onChange={(event) => setVars((current) => ({ ...current, [variable.name]: event.target.value }))} />
                  </label>
                ))}
                {missing.length > 0 && <p className="banner error">Thiếu {missing.map((item) => item.name).join(", ")}. Không chạy.</p>}
                <div className="btn-row">
                  <button className="btn-primary" disabled={!!busy || missing.length > 0} onClick={() => actions.runCase(pattern.id, selected.id)}>
                    {busy === "case" ? "Đang chạy…" : "Chạy case"}
                  </button>
                  <button className="btn-ghost" disabled={!!busy} onClick={() => actions.runSuite(pattern.id)}>
                    {busy === "suite" ? "Đang chạy suite…" : "Chạy cả suite"}
                  </button>
                </div>
              </div>
            )}
          </section>
          <section className="card">
            <p className="kicker">Output</p>
            {run?.fallback && <p className="banner">Fallback sang {run.fallback}. Kết quả không còn đúng provider đã chọn.</p>}
            {run && run.patternId === pattern.id ? (
              <>
                <p className="meta-row">
                  <span className="tag">{run.provider}</span>
                  <span className="tag">{run.model}</span>
                  <span className="tag">{run.latencyMs} ms</span>
                  <span className={`pill ${run.ok ? "verified" : "deprecated"}`}>{run.passRate}%</span>
                </p>
                <pre className="prose">{workspace.privacy ? run.storedOutput : run.output}</pre>
                {workspace.privacy && run.redactions.length > 0 && <p className="faint">Đã che: {Array.from(new Set(run.redactions)).join(", ")}</p>}
                {run.checks.map((check) => (
                  <div key={`${check.type}-${check.detail}`} className={`check ${check.ok ? "good" : "bad"}`}>
                    <span>{check.type}</span><span>{check.detail}</span>
                  </div>
                ))}
                {previous && <p className="muted">So với bản trước {previous.version}: {previous.passRate}% → {points.at(-1)?.passRate ?? run.passRate}%</p>}
              </>
            ) : (
              <p className="faint">Chưa chạy. Sandbox là code deterministic, không phải LLM.</p>
            )}
            {selected && (
              <div>
                <p className="kicker">Report failure</p>
                <select className="field" value={failMode} onChange={(event) => setFailMode(event.target.value)}>
                  {FAILURE_MODES.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.severity}</option>)}
                </select>
                <textarea placeholder="Ghi chú ngắn" value={failNote} onChange={(event) => setFailNote(event.target.value)} />
                <button className="btn-ghost" onClick={() => actions.reportFailure(pattern.id, failMode, failNote)}>Report failure</button>
              </div>
            )}
            <p className="faint">Assert trên case này: {(selected ? runAsserts(" ", selected.asserts).map((item) => item.type) : []).join(", ") || "—"}</p>
          </section>
        </div>
      )}

      {tab === "release" && (
        <section className="card">
          <p className="kicker">Gates</p>
          <p>Verified {verified.ok ? "đạt" : "chưa đạt"}</p>
          {!verified.ok && <ul>{verified.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <p>Production {production.ok ? "đạt" : "chưa đạt"}</p>
          {!production.ok && <ul>{production.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          <label className="chip">Đã đọc anti-use-case và red-team notes
            <input type="checkbox" checked={confirmRead} onChange={(event) => actions.setConfirmRead(event.target.checked)} />
          </label>
          <div className="btn-row">
            <button className="btn-ghost" disabled={!verified.ok || !!busy} onClick={() => actions.promote(pattern.id, "staging")}>Promote to Staging</button>
            <button className="btn-primary" disabled={!production.ok || !!busy} onClick={() => actions.promote(pattern.id, "production")}>Promote to Production</button>
            <button className="btn-ghost" onClick={() => actions.deprecate(pattern.id)}>Deprecate</button>
          </div>
          {currentProd && <p className="muted">Production pointer: v{currentProd.version} · {currentProd.passRate}% · {currentProd.testsetHash}</p>}
          <p className="kicker">Snapshots</p>
          {prodSnaps.length === 0 && <p className="faint">Chưa có snapshot. Promote sẽ tạo version, không ghi đè lịch sử.</p>}
          {prodSnaps.map((snap) => (
            <div key={snap.id} className="meta-row">
              <span>v{snap.version}</span>
              <span className="faint">{snap.note}</span>
              <button className="btn-ghost" onClick={() => actions.rollback(pattern.id, snap.id)}>Rollback pointer</button>
            </div>
          ))}
          <p className="kicker">Failure modes</p>
          <p>{pattern.failureModes.join(", ") || "chưa ghi"}</p>
          <p className="kicker">Changelog</p>
          {pattern.provenance.changelog.map((line) => <p key={line}>{line}</p>)}
          <p className="faint">Models đã pin: {pattern.evidence.verifiedModels.join(", ") || "chưa"}</p>
          <p className="faint">Compatible: {pattern.compatibleModels.join(", ")}</p>
        </section>
      )}
    </div>
  );
}
