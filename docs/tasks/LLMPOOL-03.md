# LLMPOOL-03 — Optional local OpenAI-compatible gateway (phase 2)

Milestone: LLMPOOL add-on (CONTEXT D36) · **Phase 2 — only after LLMPOOL-01/02 are stable and the owner asks for it** · Role: Implementer · Size M · **Deps pre-installed** (node:http only)

## Goal (outline — Architect refines before scheduling)

Let external tools (Cursor, Cline, scripts) call IT Studio's router + key pool through `http://127.0.0.1:<port>/v1/chat/completions` (OpenAI wire format, incl. SSE streaming) and `/v1/models`, without changing the core architecture.

## Constraints to settle at scheduling time

- `node:http` inside the module (`apps/sidecar/src/modules/llm-pool/gateway/`), bound to `127.0.0.1` only, **off by default**, toggle + port in the Key pool page.
- Auth: random bearer token generated on enable, stored in the keychain, shown/copied in the UI, rotatable; reuse the VS Code bridge token approach where possible. Reject missing/wrong token with 401 and constant-time compare.
- Model names: IT Studio model keys and aliases (e.g. `gpt-4o` → configured ladder entry); unknown model → 404 in OpenAI error format.
- Requests go through `LlmRouter` (budget guard, ledger with purpose `gateway`, key pool); no tools/function-calling in the first version unless the owner asks.
- Limits: body size cap, request timeout, max concurrent gateway requests, per-token RPM.
- Optional read-only browser dashboard at `/ui` (same token) — only if the owner still wants it.
- Tests: 401/404/413, streaming parity, budget block, key rotation visible through the gateway, port in use → clear error.
