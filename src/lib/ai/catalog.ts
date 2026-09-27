export type ProviderId =
  | "sandbox"
  | "pollinations"
  | "groq"
  | "gemini"
  | "openrouter"
  | "huggingface"
  | "together"
  | "mistral"
  | "xai";

export type AiModel = {
  id: string;
  label: string;
  note?: string;
};

export type ProviderDef = {
  id: ProviderId;
  name: string;
  blurb: string;
  needsKey: boolean;
  keyHint: string;
  keyUrl: string;
  envFallback?: string;
  models: AiModel[];
};

export const PROVIDERS: ProviderDef[] = [
  {
    id: "sandbox",
    name: "Sandbox",
    blurb: "Chạy local, deterministic. Không gọi mạng. Dùng để chấm regression.",
    needsKey: false,
    keyHint: "Không cần key",
    keyUrl: "https://github.com/harrisontran2801/prompt-atelier",
    models: [{ id: "deterministic", label: "Sandbox · deterministic", note: "code runner" }],
  },
  {
    id: "pollinations",
    name: "Pollinations",
    blurb: "Không cần key. OpenAI-compatible, dùng được ngay.",
    needsKey: false,
    keyHint: "Tuỳ chọn — nâng hạn mức tại enter.pollinations.ai",
    keyUrl: "https://enter.pollinations.ai",
    models: [
      { id: "openai", label: "Pollinations · openai", note: "mặc định" },
      { id: "openai-fast", label: "Pollinations · openai-fast" },
      { id: "openai-large", label: "Pollinations · openai-large" },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    blurb: "Free tier rất nhanh. Cần GroqCloud key.",
    needsKey: true,
    keyHint: "GROQ_API_KEY · console.groq.com/keys",
    keyUrl: "https://console.groq.com/keys",
    models: [
      { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
    ],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    blurb: "Free tier AI Studio. Flash ổn để iterate prompt.",
    needsKey: true,
    keyHint: "GEMINI_API_KEY · aistudio.google.com/apikey",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter :free",
    blurb: "Nhiều model $0/token. Key miễn phí, không cần thẻ.",
    needsKey: true,
    keyHint: "OPENROUTER_API_KEY · openrouter.ai/keys",
    keyUrl: "https://openrouter.ai/keys",
    models: [
      { id: "openrouter/free", label: "OpenRouter Auto Free" },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B :free" },
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    blurb: "Router miễn phí với token HF.",
    needsKey: true,
    keyHint: "HF token · huggingface.co/settings/tokens",
    keyUrl: "https://huggingface.co/settings/tokens",
    models: [
      { id: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen2.5 7B Instruct" },
      { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct" },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    blurb: "Credit miễn phí khi đăng ký.",
    needsKey: true,
    keyHint: "TOGETHER_API_KEY · api.together.xyz",
    keyUrl: "https://api.together.xyz/settings/api-keys",
    models: [{ id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo", label: "Llama 3.1 8B Turbo" }],
  },
  {
    id: "mistral",
    name: "Mistral",
    blurb: "Free experiment tier trên console.",
    needsKey: true,
    keyHint: "MISTRAL_API_KEY · console.mistral.ai",
    keyUrl: "https://console.mistral.ai/api-keys",
    models: [{ id: "mistral-small-latest", label: "Mistral Small" }],
  },
  {
    id: "xai",
    name: "xAI Grok",
    blurb: "Dùng key server nếu có, hoặc key của bạn. Không hiện lại sau khi lưu.",
    needsKey: false,
    envFallback: "XAI_API_KEY",
    keyHint: "Tuỳ chọn XAI_API_KEY · console.x.ai",
    keyUrl: "https://console.x.ai",
    models: [
      { id: "grok-4-fast", label: "Grok 4 Fast" },
      { id: "grok-2-latest", label: "Grok 2" },
    ],
  },
];

export const providerById = (id: string) => PROVIDERS.find((item) => item.id === id) ?? PROVIDERS[0];

export const modelLabel = (providerId: string, modelId: string) => {
  const provider = providerById(providerId);
  return provider.models.find((item) => item.id === modelId)?.label ?? modelId;
};
