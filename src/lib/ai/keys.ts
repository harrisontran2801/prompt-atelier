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
  const clean: KeyBag = {};
  for (const [id, value] of Object.entries(keys)) {
    if (value?.trim()) clean[id as ProviderId] = value.trim();
  }
  window.localStorage.setItem(STORAGE, JSON.stringify(clean));
}

export function hasKey(id: ProviderId) {
  return Boolean(readKeys()[id]);
}
