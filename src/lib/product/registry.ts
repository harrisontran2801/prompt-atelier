import type { ProviderId } from "../ai/catalog.ts";

export type AccessMode = "sandbox" | "free-public" | "byok" | "managed-paid";
export type ProviderHealth = "ok" | "degraded" | "down" | "unknown";

export type ProviderPolicy = {
  id: ProviderId;
  access: AccessMode;
  requiresKey: boolean;
  freePolicyUrl?: string;
  termsUrl: string;
  quotaNote: string;
  lastVerifiedAt?: string;
  health: ProviderHealth;
  maxTokens: number;
  /** Blended estimate in USD. 0 means we do not meter a provider bill. */
  estimatedCostPer1kTokens: number;
};

/** Policy notes are not a promise that a vendor will stay free. */
export const PROVIDER_POLICIES: ProviderPolicy[] = [
  {
    id: "sandbox",
    access: "sandbox",
    requiresKey: false,
    termsUrl: "https://github.com/harrisontran2801/prompt-atelier",
    quotaNote: "Chạy trên máy. Không gọi mạng. Không phải mô hình AI.",
    lastVerifiedAt: "2026-09-28",
    health: "ok",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0,
  },
  {
    id: "pollinations",
    access: "free-public",
    requiresKey: false,
    freePolicyUrl: "https://enter.pollinations.ai",
    termsUrl: "https://github.com/pollinations/pollinations",
    quotaNote: "Endpoint công khai, có giới hạn phía nhà cung cấp. Có thể đổi hoặc ngừng. Không phải free forever.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0,
  },
  {
    id: "groq",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://console.groq.com/docs/rate-limits",
    quotaNote: "Hạng miễn phí là của Groq, gắn với key của bạn. Atelier không đứng giữa để né quota.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0.0002,
  },
  {
    id: "gemini",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://ai.google.dev/gemini-api/terms",
    quotaNote: "Free tier thuộc AI Studio của bạn.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0.0002,
  },
  {
    id: "openrouter",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://openrouter.ai/terms",
    quotaNote: "Model :free vẫn cần key của bạn và có thể hết.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0,
  },
  {
    id: "huggingface",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://huggingface.co/terms-of-service",
    quotaNote: "Router dùng token HF của bạn.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0,
  },
  {
    id: "together",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://www.together.ai/terms-of-service",
    quotaNote: "Credit đăng ký là của tài khoản Together.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0.0002,
  },
  {
    id: "mistral",
    access: "byok",
    requiresKey: true,
    termsUrl: "https://legal.mistral.ai/terms",
    quotaNote: "Experiment tier thuộc console của bạn.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0.0003,
  },
  {
    id: "xai",
    access: "managed-paid",
    requiresKey: false,
    termsUrl: "https://x.ai/legal/terms-of-service",
    quotaNote: "Key server chỉ chạy khi có gói trả phí và bạn đồng ý trừ tín dụng. Không nằm trong free pool.",
    lastVerifiedAt: "2026-09-20",
    health: "unknown",
    maxTokens: 800,
    estimatedCostPer1kTokens: 0.005,
  },
];

export const policyById = (id: string) => PROVIDER_POLICIES.find((item) => item.id === id);

const DAY = 86_400_000;

export function isFreeEligible(policy: ProviderPolicy | undefined, nowIso: string, maxAgeDays = 45) {
  if (!policy || policy.access !== "free-public") return false;
  if (!policy.freePolicyUrl || !policy.lastVerifiedAt) return false;
  if (policy.health === "down") return false;
  const age = Date.parse(nowIso) - Date.parse(policy.lastVerifiedAt);
  if (Number.isNaN(age) || age < 0 || age > maxAgeDays * DAY) return false;
  return true;
}

export function approvedFreePool(nowIso: string) {
  return PROVIDER_POLICIES.filter((item) => isFreeEligible(item, nowIso));
}
