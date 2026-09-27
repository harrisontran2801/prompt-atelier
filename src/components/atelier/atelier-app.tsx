import { useMemo, useState } from "react";
import { Menu, X } from "lucide-react";
import { AtelierProvider, useAtelier } from "./atelier-context";
import { EditorView } from "./editor-view";
import { QuickView } from "./quick-view";
import { StackView } from "./stack-view";
import { UsageView } from "./usage-view";
import { ROLES, type Pattern, type PatternStatus } from "@/lib/patterns/types";

function Shell() {
  const workspace = useAtelier();
  const { actions, view, navOpen, privacy, error, notice, importError } = workspace;
  return (
    <div className="studio">
      <header className="topbar">
        <button className="icon-btn menu-btn" aria-label="Mở menu" onClick={() => actions.setNav(!navOpen)}>
          {navOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
        <div className="brand">
          <strong>Prompt Atelier</strong>
          <span>Việc lặp lại, kết quả kiểm tra được</span>
        </div>
        <div className="top-actions">
          <button className={`chip ${privacy ? "active" : ""}`} onClick={() => actions.setPrivacy(!privacy)}>
            Privacy {privacy ? "on" : "off"}
          </button>
        </div>
      </header>
      {navOpen && <button className="backdrop" aria-label="Đóng menu" onClick={() => actions.setNav(false)} />}
      <div className="shell">
        <aside className={`side ${navOpen ? "open" : ""}`}>
          <nav className="nav-list">
            <button className={`nav-btn ${view === "quick" ? "active" : ""}`} onClick={() => { actions.setView("quick"); actions.setNav(false); }}>Việc cần làm</button>
            <button className={`nav-btn ${view === "usage" ? "active" : ""}`} onClick={() => { actions.setView("usage"); actions.setNav(false); }}>Hạn mức</button>
            <button className={`nav-btn ${view === "library" ? "active" : ""}`} onClick={() => { actions.setView("library"); actions.setNav(false); }}>Thư viện</button>
            <button className={`nav-btn ${view === "packs" ? "active" : ""}`} onClick={() => { actions.setView("packs"); actions.setNav(false); }}>Gói pattern</button>
            <button className={`nav-btn ${view === "roles" ? "active" : ""}`} onClick={() => { actions.setView("roles"); actions.setNav(false); }}>Roles</button>
            <button className={`nav-btn ${view === "stack" ? "active" : ""}`} onClick={() => { actions.setView("stack"); actions.setNav(false); }}>Workflow</button>
            <button className={`nav-btn ${view === "editor" ? "active" : ""}`} onClick={() => { actions.setView("editor"); actions.setNav(false); }}>Studio</button>
          </nav>
          <div>
            <p className="kicker">Gần đây</p>
            {workspace.recentIds.map((id) => {
              const pattern = workspace.patterns.find((item) => item.id === id);
              if (!pattern) return null;
              return (
                <button key={id} className="nav-btn" onClick={() => actions.openPattern(id)}>{pattern.name}</button>
              );
            })}
          </div>
        </aside>
        <main className="main">
          {error && <div className="banner error" role="alert">{error} <button className="btn-ghost" onClick={actions.clearError}>Đóng</button></div>}
          {notice && <div className="banner ok" role="status">{notice}</div>}
          {importError && <div className="banner error" role="alert">{importError}</div>}
          {view === "quick" && <QuickView />}
          {view === "usage" && <UsageView />}
          {view === "library" && <Library />}
          {view === "packs" && <Packs />}
          {view === "roles" && <Roles />}
          {view === "stack" && <StackView />}
          {view === "editor" && <EditorView />}
        </main>
      </div>
    </div>
  );
}

function Library() {
  const { patterns, actions, roleFilter } = useAtelier();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<PatternStatus | "">("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"score" | "updated" | "tests">("updated");
  const categories = Array.from(new Set(patterns.map((item) => item.category)));
  const tags = Array.from(new Set(patterns.flatMap((item) => item.tags)));
  const rows = useMemo(() => {
    const filtered = patterns.filter((item) => {
      const blob = `${item.name} ${item.summary} ${item.tags.join(" ")}`.toLowerCase();
      if (query && !blob.includes(query.toLowerCase())) return false;
      if (category && item.category !== category) return false;
      if (status && item.status !== status) return false;
      if (tag && !item.tags.includes(tag)) return false;
      if (roleFilter && !item.roles.includes(roleFilter)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sort === "tests") return b.evidence.nTests - a.evidence.nTests;
      if (sort === "score") return (b.evidence.passRate ?? -1) - (a.evidence.passRate ?? -1);
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [patterns, query, category, status, tag, sort, roleFilter]);

  return (
    <div>
      <p className="kicker">Library</p>
      <h2 className="lede">Pattern có bằng chứng, không phải snippet.</h2>
      <div className="filters">
        <input className="search" placeholder="Tìm tên hoặc mô tả" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="field" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Mọi nhóm</option>
          {categories.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="field" value={status} onChange={(event) => setStatus(event.target.value as PatternStatus | "")}>
          <option value="">Mọi trạng thái</option>
          <option value="draft">draft</option>
          <option value="verified">verified</option>
          <option value="production">production</option>
          <option value="deprecated">deprecated</option>
        </select>
        <select className="field" value={tag} onChange={(event) => setTag(event.target.value)}>
          <option value="">Mọi tag</option>
          {tags.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="field" value={sort} onChange={(event) => setSort(event.target.value as "score" | "updated" | "tests")}>
          <option value="updated">Mới cập nhật</option>
          <option value="score">Verified score</option>
          <option value="tests">Số test</option>
        </select>
        {roleFilter && <button className="chip active" onClick={() => actions.setRoleFilter("")}>Role: {roleFilter} · bỏ</button>}
      </div>
      {rows.length === 0 && <div className="card"><h3>Không có pattern khớp</h3><p className="muted">Đổi bộ lọc hoặc import pack.</p></div>}
      <div className="cards">
        {rows.map((pattern) => <PatternCard key={pattern.id} pattern={pattern} />)}
      </div>
    </div>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  const { actions } = useAtelier();
  const showScore = pattern.evidence.nTests >= 3 && pattern.evidence.passRate !== undefined;
  return (
    <article className="card">
      <div className="card-top">
        <h3>{pattern.name}</h3>
        <span className={`pill ${pattern.status}`}>{pattern.status}</span>
      </div>
      <p className="muted">{pattern.summary}</p>
      <div className="tag-row">
        <span className="tag">{pattern.category}</span>
        {pattern.roles.map((role) => <span key={role} className="tag">{role}</span>)}
        {pattern.tags.slice(0, 3).map((item) => <span key={item} className="tag">{item}</span>)}
      </div>
      <div className="meta-row">
        <span>v{pattern.version}</span>
        <span>{pattern.evidence.nTests} tests</span>
        {showScore ? <span className="score">{pattern.evidence.passRate}%</span> : <span className="faint">điểm ẩn</span>}
        <span className="faint">{pattern.evidence.testsetHash}</span>
      </div>
      <p className="faint">{pattern.evidence.verifiedModels.join(", ") || "chưa pin model"} · {pattern.failureModes.join(", ") || "chưa ghi failure"}</p>
      <p className="faint">{pattern.provenance.license} · {pattern.provenance.author}</p>
      <div className="btn-row">
        <button className="btn-primary" onClick={() => actions.openPattern(pattern.id)}>Open</button>
        <button className="btn-ghost" onClick={() => actions.forkPattern(pattern.id)}>Fork</button>
        <button className="btn-ghost" onClick={() => actions.addToStack(pattern.id)}>Add to stack</button>
      </div>
    </article>
  );
}

function Packs() {
  const { packs, actions } = useAtelier();
  return (
    <div>
      <p className="kicker">Packs</p>
      <h2 className="lede">Ba pack seed, import không đè production.</h2>
      <label className="btn-ghost">
        Import JSON
        <input
          type="file"
          accept="application/json,.json"
          hidden
          aria-label="Import pack JSON"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            actions.importPack(await file.text());
          }}
        />
      </label>
      <div className="cards">
        {packs.map((pack) => (
          <article key={pack.id} className="card">
            <h3>{pack.name}</h3>
            <p className="muted">{pack.summary}</p>
            <p className="faint">{pack.id} · v{pack.version} · {pack.license}</p>
            <p className="faint">deps {pack.dependsOn.join(", ") || "none"} · hash {pack.manifestHash}</p>
            <p className="faint">{pack.patterns.length} patterns · {pack.testSuite.length} tests</p>
            <div className="btn-row">
              <button className="btn-primary" onClick={() => actions.exportPack(pack.id, "json")}>Export JSON</button>
              <button className="btn-ghost" onClick={() => actions.exportPack(pack.id, "md")}>Markdown bundle</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Roles() {
  const { patterns, actions } = useAtelier();
  return (
    <div>
      <p className="kicker">Roles</p>
      <h2 className="lede">Chọn vai, lọc library.</h2>
      <div className="cards">
        {ROLES.map((role) => {
          const count = patterns.filter((item) => item.roles.includes(role.id)).length;
          return (
            <article key={role.id} className="card">
              <h3>{role.name}</h3>
              <p className="muted">{role.detail}</p>
              <p className="faint">{count} pattern</p>
              <button className="btn-primary" onClick={() => { actions.setRoleFilter(role.id); actions.setView("library"); }}>Xem pattern</button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function AtelierApp() {
  return (
    <AtelierProvider>
      <Shell />
    </AtelierProvider>
  );
}
