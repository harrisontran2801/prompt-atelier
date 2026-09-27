# PROMPT ATELIER

Workbench local-first để thiết kế prompt có cấu trúc, nhiều role, và chạy thật trên API AI miễn phí.

## AI miễn phí đã gắn

| Provider | Key | Dùng để |
|---|---|---|
| **Pollinations** | Không cần | Default. Generate / chấm điểm / test lab |
| **Groq** | Free tier | Llama 3.1/3.3, rất nhanh |
| **Gemini** | AI Studio free | Flash 2.0 / 2.5 |
| **OpenRouter `:free`** | Key $0 | Qwen3.8, Gemma 4, Nemotron |
| **Hugging Face** | Token free | Router open models |
| **Together / Mistral** | Credit lúc đăng ký | Fallback thêm |
| **xAI Grok** | `XAI_API_KEY` server hoặc key user | Nếu có quota |

Key lưu `localStorage`. Server chỉ forward khi bạn bấm Generate / Cải thiện / Chấm điểm / Chạy model. Provider lỗi thì tự fallback sang Pollinations.

## Tính năng

- Role library + 5 khối: directive, context, task, guardrails, output
- AI Compose: một câu ý tưởng thành đủ 5 khối
- AI cải thiện từng khối
- Quality score bằng model
- Test lab gọi model thật
- Preview biến `{{variable}}`, copy, export MD/JSON, lưu cục bộ

## Chạy

```bash
npm install
npm run dev
```

App lắng nghe cổng `8080`.

Lấy key (tuỳ chọn): [Pollinations](https://enter.pollinations.ai) · [Groq](https://console.groq.com/keys) · [Gemini](https://aistudio.google.com/apikey) · [OpenRouter](https://openrouter.ai/keys) · [Hugging Face](https://huggingface.co/settings/tokens)
