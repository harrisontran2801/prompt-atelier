# Prompt Atelier

Local-first prompt workbench. Mỗi pattern là một artifact có phiên bản: tìm được, lắp ghép được, chạy test được, và chỉ lên production khi không regression.

Không bắt buộc tài khoản. Dữ liệu nằm trên máy (`localStorage`). Key API không được ghi vào repo.

## Làm được gì

- **Pattern library** — persona, protocol, task, format, guardrail, evaluator, safety. Mỗi pattern có use case, anti-use, biến, hợp đồng output, evidence (số test, pass rate, hash bộ test).
- **Stack** — ghép nhiều pattern. Safety thắng conflict; format thắng format; guardrail được hợp nhất.
- **Test lab** — Sandbox chấm assertion tại chỗ, không cần key. Có key thì chạy model thật. Lỗi có thể biến thành test hồi quy.
- **Cổng phát hành** — draft → verified → production. Production yêu cầu suite không tụt và lỗi nghiêm trọng đã có test.
- **Pack** — xuất / nhập JSON để chia sẻ hoặc rollback.
- **Privacy** — redact PII trước khi lưu.

## Provider

| Provider | Key | Ghi chú |
|---|---|---|
| Sandbox | Không | Deterministic, mặc định khi test |
| Pollinations | Không | Fallback miễn phí |
| Groq | Free tier | Nhanh |
| Gemini | AI Studio | Flash |
| OpenRouter | Key, có model `:free` | |
| Hugging Face | Token | |
| Together / Mistral | Credit đăng ký | |
| xAI | `XAI_API_KEY` hoặc key người dùng | Server-only nếu đặt env |

Key người dùng chỉ nằm trong `localStorage`. Server forward khi bạn bấm chạy, và che key khỏi thông báo lỗi.

## Mã nguồn

| Đường dẫn | Việc |
|---|---|
| `src/lib/patterns/` | Schema, seed, compose, assert, gate, privacy, sandbox |
| `src/components/atelier/` | Thư viện, editor, stack, test lab |
| `src/lib/ai/` | Catalog provider và proxy |

## Chạy

```bash
npm install
npm run dev
```

Dev server lắng nghe `0.0.0.0:8080`. Auth tắt qua `.grok/app-env.json` (`VITE_AUTH_ENABLED=false`).

Lấy key (tuỳ chọn): [Groq](https://console.groq.com/keys) · [Gemini](https://aistudio.google.com/apikey) · [OpenRouter](https://openrouter.ai/keys) · [Hugging Face](https://huggingface.co/settings/tokens)

## License

MIT
