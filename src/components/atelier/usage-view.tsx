import { useEffect, useState } from "react";
import { economyApi, type UsageSnapshot } from "@/lib/product/usage-api";
import { loadPlans } from "@/lib/product/plans";
import { useAtelier } from "./atelier-context";

export function UsageView() {
  const { actions } = useAtelier();
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cap, setCap] = useState("");
  const plans = loadPlans();

  async function reload() {
    try {
      const result = await economyApi({ data: { action: "snapshot" } });
      if (!result.snapshot) throw new Error("Máy chủ không trả hạn mức");
      setSnapshot(result.snapshot);
      setCap(String(result.snapshot.spendingCapUsd));
      setError("");
    } catch (err) {
      setSnapshot(null);
      setError(err instanceof Error ? err.message : "Không đọc được hạn mức từ máy chủ");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div>
      <p className="kicker">Hạn mức</p>
      <h2 className="lede">Tín dụng nằm ở máy chủ, không nằm trong trình duyệt.</h2>
      <p className="muted">Local Free vẫn chạy Sandbox khi không có tài khoản, Stripe hay database. Số dưới đây chỉ hiện sau khi máy chủ trả về.</p>
      {error && <p className="banner error" role="alert">{error}</p>}
      {notice && <p className="banner ok">{notice}</p>}
      {!snapshot && !error && <p className="banner">Đang đọc hạn mức…</p>}
      {snapshot && (
        <div className="cards">
          <article className="card">
            <h3>Gói {snapshot.planId}</h3>
            <p>Free pool còn {snapshot.freeRemainingToday} / {snapshot.freeDailyCap} lượt hôm nay.</p>
            <p>Tín dụng còn {snapshot.creditsAvailable}, đang giữ {snapshot.creditsReserved}.</p>
            <p className="faint">Đã chi ước tính tháng này ${snapshot.spentMonthUsd}. Trần ${snapshot.spendingCapUsd}.</p>
            <p className="faint">Chế độ {snapshot.billingMode}. Stripe {snapshot.stripeConfigured ? "đã cấu hình" : "chưa cấu hình"}.</p>
            {snapshot.lastTrace && (
              <p className="faint">
                Lượt gần nhất: {snapshot.lastTrace.requestedProvider} → {snapshot.lastTrace.finalProvider}. {snapshot.lastTrace.reason}
              </p>
            )}
          </article>
          <article className="card">
            <h3>Trần chi tiêu</h3>
            <label>
              USD mỗi tháng
              <input className="field" aria-label="Trần chi tiêu" value={cap} onChange={(event) => setCap(event.target.value)} />
            </label>
            <button
              className="btn-primary"
              onClick={async () => {
                const result = await economyApi({ data: { action: "cap", spendingCapUsd: Number(cap) } });
                if (result.snapshot) setSnapshot(result.snapshot);
                setNotice("Đã lưu trần trên máy chủ.");
              }}
            >
              Lưu trần
            </button>
          </article>
          {plans.map((plan) => (
            <article key={plan.id} className="card">
              <h3>{plan.name}</h3>
              <p className="muted">
                {plan.id === "free" && "Sandbox không giới hạn, free pool có trần, xuất file trên máy."}
                {plan.id === "pro" && "Tín dụng tháng, model quản lý, đồng bộ khi có hosted mode."}
                {plan.id === "team" && "Tín dụng chung, workflow chia sẻ, trần chi tiêu. Chưa mở trong bản này."}
              </p>
              <p className="faint">
                {plan.priceUsd == null ? "Giá chưa cấu hình trên deployment. Không hiện giá giả." : `$${plan.priceUsd} / tháng`}
                {" · "}
                {plan.monthlyCredits} tín dụng
              </p>
              {plan.id === "pro" && (
                <button
                  className="btn-primary"
                  onClick={async () => {
                    await economyApi({ data: { action: "checkout", planId: "pro" } });
                    const done = await economyApi({
                      data: { action: "complete", planId: "pro", idempotencyKey: "idem_mock_pro_demo1" },
                    });
                    if (done.snapshot) setSnapshot(done.snapshot);
                    setNotice(done.duplicate ? "Bản thử Pro đã kích hoạt trước đó. Không cộng tín dụng lần hai." : "Đã kích hoạt bản thử Pro. Không trừ tiền thật.");
                  }}
                >
                  Kích hoạt bản thử Pro
                </button>
              )}
            </article>
          ))}
        </div>
      )}
      <button className="btn-ghost" onClick={() => actions.setView("quick")}>Quay lại việc cần làm</button>
    </div>
  );
}
