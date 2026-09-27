# MVP Production checklist — Prompt Atelier

Đối chiếu PromptLayer / Langfuse / AI-MVP launch lists (2026). Scope MVP: một người dùng, local-first, API miễn phí.

## Đã có trong bản này

- Versioning bất biến khi Lưu, rollback, label `production`
- Run traces: provider, model, latency, OK/ERR, preview
- Structural eval trên output vs output contract
- Rate limit server 20 req/phút + quota ngày 80 trên client
- Token/input cap, timeout 28s, sanitize lỗi (che key)
- Fallback Pollinations khi provider lỗi
- Biến `{{name}}` được fill từ test input
- Key không commit; `.env` gitignore

## Cố ý chưa làm

- Auth multi-user, RBAC, SSO
- A/B traffic split
- LLM-as-judge dataset lớn + CI gate
- Sentry / uptime ngoài
