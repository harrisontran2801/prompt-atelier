import type { ProviderId } from "./catalog";

const STORAGE = "prompt-atelier-ai-keys";

export type KeyBag = Partial<Record<ProviderId, string>>;

export function readKeys(): KeyBag {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as KeyBag;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeKeys(keys: KeyBag) {
  window.localStorage.setItem(STORAGE, JSON.stringify(keys));
}

export function readPref(): { provider: ProviderId; model: string } {
  if (typeof window === "undefined") return { provider: "pollinations", model: "openai" };
  try {
    const raw = window.localStorage.getItem("prompt-atelier-ai-pref");
    if (!raw) return { provider: "pollinations", model: "openai" };
    const parsed = JSON.parse(raw) as { provider?: ProviderId; model?: string };
    return {
      provider: parsed.provider ?? "pollinations",
      model: parsed.model ?? "openai",
    };
  } catch {
    return { provider: "pollinations", model: "openai" };
  }
}

export function writePref(provider: ProviderId, model: string) {
  window.localStorage.setItem("prompt-atelier-ai-pref", JSON.stringify({ provider, model }));
}
