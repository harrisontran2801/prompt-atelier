import type { ProviderId } from "../ai/catalog.ts";
import { approvedFreePool, policyById, type ProviderPolicy } from "./registry.ts";

export type RouteMode = "sandbox" | "free-public" | "byok" | "managed-paid" | "blocked";
export type RouteIntent = "preview" | "regression" | "user-run";
export type RoutePrefer = "sandbox" | "free" | "byok" | "managed";
export type PlanId = "free" | "pro" | "team";

export type RouteDecision = {
  mode: RouteMode;
  provider: ProviderId | "none";
  model: string;
  reason: string;
  options: Array<"sandbox" | "byok" | "paid">;
  fellBack: false;
};

export type RouteTrace = {
  requestId: string;
  requestedProvider: string;
  attemptedProvider: string;
  finalProvider: string;
  reason: string;
  estimatedCostUsd: number;
  actualCostUsd: number | null;
  mode: RouteMode;
  fellBack: boolean;
};

export type RouteInput = {
  intent: RouteIntent;
  prefer: RoutePrefer;
  byokProvider?: ProviderId;
  byokModel?: string;
  byokHasKey: boolean;
  freeConsent: boolean;
  paidConsent: boolean;
  entitlement: PlanId;
  freeRemaining: number;
  circuitOpen: boolean;
  nowIso: string;
};

const SANDBOX: RouteDecision = {
  mode: "sandbox",
  provider: "sandbox",
  model: "deterministic",
  reason: "Xem trước hoặc kiểm tra hồi quy chạy trên máy, không gọi mạng.",
  options: [],
  fellBack: false,
};

function blocked(reason: string, options: RouteDecision["options"]): RouteDecision {
  return { mode: "blocked", provider: "none", model: "", reason, options, fellBack: false };
}

export function decideRoute(input: RouteInput): RouteDecision {
  if (input.intent === "preview" || input.intent === "regression" || input.prefer === "sandbox") {
    return SANDBOX;
  }

  if (input.prefer === "byok") {
    const provider = input.byokProvider;
    const policy = provider ? policyById(provider) : undefined;
    if (!provider || provider === "sandbox" || !policy) {
      return blocked("Chưa chọn nhà cung cấp cho key của bạn.", ["sandbox"]);
    }
    if (policy.requiresKey && !input.byokHasKey) {
      return blocked("Chưa có API key trên máy này. Key nằm trong bộ nhớ trình duyệt, không gửi vào sổ tín dụng.", ["sandbox", "paid"]);
    }
    return {
      mode: "byok",
      provider,
      model: input.byokModel || "",
      reason: "Dùng key của bạn. Không chuyển sang trả phí và không fallback im lặng.",
      options: [],
      fellBack: false,
    };
  }

  if (input.prefer === "free") {
    if (!input.freeConsent) {
      return blocked("Chưa đồng ý gửi dữ liệu ra khỏi máy.", ["sandbox", "byok"]);
    }
    const pool = approvedFreePool(input.nowIso);
    const policy: ProviderPolicy | undefined = pool[0];
    if (!policy) {
      return blocked("Free pool chưa có chính sách còn hiệu lực. Không gọi endpoint lạ.", ["sandbox", "byok", "paid"]);
    }
    if (input.circuitOpen || policy.health === "down") {
      return blocked("Free pool đang ngắt mạch sau lỗi. Thử lại sau hoặc đổi cách chạy.", ["sandbox", "byok", "paid"]);
    }
    if (input.freeRemaining <= 0) {
      return blocked("Hết lượt free pool hôm nay. Không tự chuyển sang trừ tiền.", ["sandbox", "byok", "paid"]);
    }
    return {
      mode: "free-public",
      provider: policy.id,
      model: "openai",
      reason: policy.quotaNote,
      options: [],
      fellBack: false,
    };
  }

  if (input.entitlement !== "pro" && input.entitlement !== "team") {
    return blocked("Gói Free không chạy model trả phí.", ["sandbox", "byok"]);
  }
  if (!input.paidConsent) {
    return blocked("Chưa đồng ý trừ tín dụng. Không tự chuyển từ free sang trả phí.", ["sandbox", "byok"]);
  }
  return {
    mode: "managed-paid",
    provider: "xai",
    model: "grok-4-fast",
    reason: "Model quản lý chỉ chạy sau khi giữ tín dụng. Ước tính, không phải hóa đơn hãng.",
    options: [],
    fellBack: false,
  };
}

export function buildTrace(requestId: string, requested: string, decision: RouteDecision, estimatedCostUsd: number, actualCostUsd: number | null = null): RouteTrace {
  const finalProvider = decision.provider === "none" ? "none" : decision.provider;
  return {
    requestId,
    requestedProvider: requested,
    attemptedProvider: finalProvider,
    finalProvider,
    reason: decision.reason,
    estimatedCostUsd,
    actualCostUsd,
    mode: decision.mode,
    fellBack: false,
  };
}
