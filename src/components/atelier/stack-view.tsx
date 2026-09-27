import { compileStack } from "@/lib/patterns/compose";
import { KIND_ORDER } from "@/lib/patterns/types";
import { useAtelier } from "./atelier-context";

export function StackView() {
  const { patterns, stack, actions } = useAtelier();
  const result = compileStack(stack, patterns);
  const blocking = result.conflicts.some((item) => item.blocking);

  return (
    <div>
      <p className="kicker">Pattern stack</p>
      <h2 className="lede">Lắp persona đến evaluator</h2>
      <p className="muted">Safety thắng mọi lớp. Format thắng mô tả format trong task. Evaluator không vào prompt.</p>
      <div className="stack-grid">
        <section className="card">
          <div className="btn-row">
            <button className="btn-ghost" onClick={actions.clearStack}>Gỡ stack</button>
          </div>
          {KIND_ORDER.map((kind) => {
            const rows = result.sources.filter((item) => item.kind === kind);
            return (
              <div key={kind}>
                <p className="kicker">{kind}</p>
                {rows.length === 0 && <p className="faint">Chưa có. Dùng Add to stack từ thư viện.</p>}
                {rows.map((row) => (
                  <div key={row.id} className="meta-row">
                    <strong>{row.name}</strong>
                    <span className="tag">{row.included ? "trong prompt" : "ngoài prompt"}</span>
                    <span className="faint">{row.note}</span>
                  </div>
                ))}
              </div>
            );
          })}
          {result.conflicts.map((conflict) => (
            <div key={conflict.id} className={`banner ${conflict.blocking ? "error" : ""}`} role="status">
              <p>{conflict.message}</p>
              <div className="btn-row">
                {conflict.options.map((option) => (
                  <button
                    key={option.id}
                    className={`chip ${stack.resolutions[conflict.id] === option.id ? "active" : ""}`}
                    onClick={() => actions.setStack({ ...stack, resolutions: { ...stack.resolutions, [conflict.id]: option.id } })}
                  >
                    Giữ {option.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {blocking && <p className="banner error">Còn xung đột trái dấu. Chọn một guardrail trước khi tin preview.</p>}
        </section>
        <section className="card">
          <p className="kicker">Compiled preview</p>
          <pre className="prose">{result.compiled || "Stack trống."}</pre>
          {result.evaluatorNames.length > 0 && (
            <p className="muted">Evaluator sau inference: {result.evaluatorNames.join(", ")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
