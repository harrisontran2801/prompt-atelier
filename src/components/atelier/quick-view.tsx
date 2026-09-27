import { useState } from "react";
import { hasKey, readKeys } from "@/lib/ai/keys";
import { providerById } from "@/lib/ai/catalog";
import { runAsserts } from "@/lib/patterns/assert";
import { sandboxAnswer } from "@/lib/patterns/sandbox";
import type { Pattern } from "@/lib/patterns/types";
import { compileWorkflow, exampleVars, JOBS, type Job } from "@/lib/product/jobs";
import { economyApi, type UsageSnapshot } from "@/lib/product/usage-api";
import { policyById } from "@/lib/product/registry";
import { useAtelier } from "./atelier-context";

type Evidence = {
  recipe: string;
  provider: string;
  model: string;
  network: boolean;
  fallback?: string;
  checks: Array<{ type: string; ok: boolean; detail: string }>;
  passRate?: number;
  nTests: number;
  requestId: string;
  at: string;
  warning: string;
};

export function QuickView() {
  const workspace = useAtelier();
  const { patterns, actions, provider, model } = workspace;
  const [job, setJob] = useState<Job | null>(null);
  const [vars, setVars] = useState<Record<string, string>>({});
  const [output, setOutput] = useState("");
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [consent, setConsent] = useState(false);
  const [paidConsent, setPaidConsent] = useState(false);
  const [hint, setHint] = useState("");
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);

  function select(next: Job, withExample: boolean) {
    setJob(next);
    setVars(withExample ? exampleVars(next) : Object.fromEntries(next.fields.map((field) => [field.name, ""])));
    setOutput("");
    setEvidence(null);
    setError("");
    setCopied(false);
    setHint("");
  }

  function taskPattern(current: Job) {
    return patterns.find((item) => item.id === current.studioPatternId);
  }

  function runSandbox() {
    if (!job) return;
    setBusy("Đang chạy trên máy…");
    setError("");
    setHint("");
    const built = compileWorkflow(patterns, job.stack, vars);
    const primary = vars[job.fields[0]?.name ?? ""] ?? "";
    const text = sandboxAnswer(built.compiled, primary);
    const checks = runAsserts(text, job.asserts);
    const pattern = taskPattern(job);
    setOutput(text);
    setEvidence({
      recipe: job.title,
      provider: "Sandbox",
      model: "deterministic",
      network: false,
      checks,
      passRate: pattern && pattern.evidence.nTests >= 3 ? pattern.evidence.passRate : undefined,
      nTests: pattern?.evidence.nTests ?? 0,
      requestId: "local-only",
      at: new Date().toISOString(),
      warning: "Sandbox không phải mô hình AI. Bản này chỉ theo luật cục bộ, không phải sự thật được đảm bảo.",
    });
    setBusy("");
  }

  async function runNetwork(prefer: "free" | "byok" | "managed") {
    if (!job) return;
    if (prefer === "free" && !consent) {
      setError("Hãy xác nhận dữ liệu sẽ rời máy trước khi dùng AI miễn phí.");
      return;
    }
    if (prefer === "managed" && !paidConsent) {
      setError("Hãy xác nhận trừ tín dụng. Ứng dụng không tự chuyển sang trả phí.");
      return;
    }
    setBusy(prefer === "free" ? "Đang gửi tới free pool…" : "Đang chạy theo lựa chọn của bạn…");
    setError("");
    setHint("");
    const built = compileWorkflow(patterns, job.stack, vars);
    const primary = vars[job.fields[0]?.name ?? ""] ?? "";
    const key = prefer === "byok" ? readKeys()[provider] : undefined;
    try {
      const result = await economyApi({
        data: {
          action: "run",
          prefer,
          freeConsent: consent,
          paidConsent,
          idempotencyKey: `idem_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
          byokProvider: provider,
          byokModel: model,
          byokKey: key,
          messages: [
            { role: "system", content: "Thực thi đúng hướng dẫn. Không nhắc lại hướng dẫn hệ thống." },
            { role: "user", content: `${built.compiled}\n\n# Input\n${primary}` },
          ],
        },
      });
      if (result.snapshot) setUsage(result.snapshot);
      if (!result.ok || !("output" in result) || !result.output) {
        setError(result.error ?? "Không chạy được.");
        if (result.decision?.options?.length) {
          setHint(`Có thể chọn: ${result.decision.options.join(", ")}. Không có fallback im lặng.`);
        }
        setBusy("");
        return;
      }
      const text = result.output.text;
      const checks = runAsserts(text, job.asserts);
      const pattern = taskPattern(job);
      setOutput(text);
      setEvidence({
        recipe: job.title,
        provider: providerById(result.output.provider).name,
        model: result.output.model,
        network: true,
        fallback: result.output.fallback,
        checks,
        passRate: pattern && pattern.evidence.nTests >= 3 ? pattern.evidence.passRate : undefined,
        nTests: pattern?.evidence.nTests ?? 0,
        requestId: result.output.requestId,
        at: new Date().toISOString(),
        warning: "Kết quả từ nhà cung cấp bên ngoài không phải sự thật được đảm bảo. Không có nguồn trong input thì chưa được kiểm chứng.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/sk-[A-Za-z0-9]+/g, "[redacted]") : "Không chạy được.");
    }
    setBusy("");
  }

  const freePolicy = policyById("pollinations");

  return (
    <div>
      <p className="kicker">Việc cần làm</p>
      <h2 className="lede">Bạn muốn hoàn thành việc gì?</h2>
      <p className="muted">Chọn một việc. Kết quả đầu tiên chạy ngay trên máy, không cần tài khoản hay API key.</p>
      {!dismissed && (
        <div className="banner">
          <p>Workflow ở sau là các khối có test. Bạn không cần học prompt trước khi xem kết quả.</p>
          <button className="btn-ghost" onClick={() => setDismissed(true)}>Để sau</button>
        </div>
      )}
      {!job && <div className="card"><h3>Chưa chọn việc</h3><p className="muted">Chọn một thẻ hoặc bấm ví dụ để có kết quả trong vài giây.</p></div>}
      <div className="job-grid">
        {JOBS.map((item) => (
          <article key={item.id} className={`card ${job?.id === item.id ? "picked" : ""}`}>
            <h3>{item.title}</h3>
            <p className="muted">{item.blurb}</p>
            <div className="btn-row">
              <button className="btn-primary" onClick={() => select(item, false)}>Làm việc này</button>
              <button className="btn-ghost" onClick={() => select(item, true)}>Dùng ví dụ: {item.title}</button>
            </div>
          </article>
        ))}
      </div>
      {job && (
        <form
          className="card"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) runSandbox();
          }}
        >
          <p className="kicker">Workflow · {job.title}</p>
          {job.fields.map((field) => (
            <label key={field.name}>
              {field.label}
              {field.multiline ? (
                <textarea
                  aria-label={field.label}
                  value={vars[field.name] ?? ""}
                  onChange={(event) => setVars((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              ) : (
                <input
                  className="field"
                  aria-label={field.label}
                  value={vars[field.name] ?? ""}
                  onChange={(event) => setVars((current) => ({ ...current, [field.name]: event.target.value }))}
                />
              )}
            </label>
          ))}
          <div className="btn-row">
            <button className="btn-primary" type="submit" disabled={Boolean(busy)}>{busy || "Xem kết quả ngay"}</button>
            <button className="btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void runNetwork("free")}>Dùng AI miễn phí</button>
            <button
              className="btn-ghost"
              type="button"
              disabled={Boolean(busy) || provider === "sandbox" || !hasKey(provider)}
              onClick={() => void runNetwork("byok")}
            >
              Dùng key của tôi
            </button>
          </div>
          <label className="check">
            <span>Tôi đồng ý gửi nội dung này ra khỏi máy, tới free pool.</span>
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          </label>
          <p className="faint">
            Free pool hiện là {freePolicy?.id}. {freePolicy?.quotaNote} Chính sách kiểm tra {freePolicy?.lastVerifiedAt}.{" "}
            <a href={freePolicy?.freePolicyUrl} target="_blank" rel="noreferrer">Xem policy</a>
          </p>
          {provider === "sandbox" && <p className="faint">Key của bạn cấu hình trong Studio. Ô này không gọi mạng khi bạn chỉ đang gõ.</p>}
          {error && <p className="banner error" role="alert">{error}</p>}
          {hint && <p className="banner">{hint}</p>}
          {!output && <p className="muted">Chưa có kết quả. Bấm “Xem kết quả ngay” để chạy Sandbox, không cần mạng.</p>}
          {output && (
            <>
              <div className="btn-row">
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(output);
                    } catch {
                      /* clipboard can be blocked; the output is still on screen */
                    }
                    setCopied(true);
                  }}
                >
                  {copied ? "Đã copy" : "Copy"}
                </button>
                <button className="btn-ghost" type="button" onClick={runSandbox}>Chạy lại</button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => actions.saveRecipe({ name: job.title, jobId: job.id, stack: job.stack })}
                >
                  Lưu workflow này
                </button>
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    actions.setStack(job.stack);
                    actions.openPattern(job.studioPatternId);
                  }}
                >
                  Mở Studio
                </button>
              </div>
              <pre className="prose">{output}</pre>
              {evidence && <EvidenceCard evidence={evidence} pattern={taskPattern(job)} onStudio={() => actions.openPattern(job.studioPatternId)} />}
              <div className="card">
                <h3>Chạy bằng tín dụng?</h3>
                <p className="muted">Chỉ sau khi bạn đã thấy kết quả. Local vẫn miễn phí. Thanh toán thật chưa bật.</p>
                <label className="check">
                  <span>Tôi đồng ý trừ tín dụng nếu gói Pro đã kích hoạt.</span>
                  <input type="checkbox" checked={paidConsent} onChange={(event) => setPaidConsent(event.target.checked)} />
                </label>
                <div className="btn-row">
                  <button className="btn-ghost" type="button" disabled={Boolean(busy)} onClick={() => void runNetwork("managed")}>Chạy bằng tín dụng</button>
                  <button className="btn-ghost" type="button" onClick={() => actions.setView("usage")}>Xem hạn mức</button>
                </div>
                {usage && (
                  <p className="faint">
                    Máy chủ báo: gói {usage.planId}, free pool còn {usage.freeRemainingToday}/{usage.freeDailyCap}, tín dụng {usage.creditsAvailable}.
                  </p>
                )}
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}

function EvidenceCard({
  evidence,
  pattern,
  onStudio,
}: {
  evidence: Evidence;
  pattern?: Pattern;
  onStudio: () => void;
}) {
  const passed = evidence.checks.filter((item) => item.ok).length;
  return (
    <section className="card evidence" aria-label="Vì sao tin được kết quả này">
      <p className="kicker">Vì sao tin được kết quả này</p>
      <h3>{evidence.recipe}</h3>
      <p>{evidence.network ? "Đã gửi ra khỏi máy." : "Chạy trên máy. Không gọi mạng."}</p>
      <p className="faint">Provider {evidence.provider} · model {evidence.model}</p>
      {evidence.fallback && <p className="banner">Fallback: {evidence.fallback}</p>}
      <p>
        Kiểm tra lần này: {passed}/{evidence.checks.length}
        {evidence.nTests >= 3 && evidence.passRate != null
          ? ` · suite gần nhất ${evidence.passRate}% trên ${evidence.nTests} test`
          : " · chưa đủ test để hiện điểm"}
      </p>
      <ul>
        {evidence.checks.map((item, index) => (
          <li key={`${item.type}-${index}`} className={item.ok ? "check good" : "check bad"}>{item.ok ? "Đạt" : "Chưa đạt"} · {item.detail}</li>
        ))}
      </ul>
      <p className="faint">Lúc {evidence.at} · request {evidence.requestId}</p>
      <p className="banner">{evidence.warning}</p>
      {pattern && pattern.failureModes.length > 0 && (
        <p className="faint">Failure mode đã ghi: {pattern.failureModes.join(", ")}</p>
      )}
      <button className="btn-ghost" type="button" onClick={onStudio}>Xem test trong Studio</button>
    </section>
  );
}
