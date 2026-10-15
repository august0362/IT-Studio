# PROV-01 — Add DeepSeek, OpenRouter, Qwen and Mistral providers

Milestone: v1 owner feedback (CONTEXT D38) · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** · **Broad scope: do not stop for edits strictly needed to wire a provider — list them in Result**

## Goal

The owner wants keys for **DeepSeek, OpenRouter, Qwen (Alibaba Cloud Model Studio) and Mistral**. All four expose an OpenAI-compatible Chat Completions API, so they reuse the existing OpenAI-compatible adapter exactly like `xai`, `groq` and `together` (D15). After this task each appears in Settings → API Keys with *Verify & save*, its models appear in model pickers / router ladder / pipeline role settings, and cost is tracked from seed prices (marked unverified until *Update prices* confirms them).

## Read first

`AGENTS.md`, `../CONTEXT.md` D15, D31, D38, `src/types/schemas.ts` (`ProviderId`, settings), `config/models.seed.json`, `config/pricing.seed.json`, `config/pricing.sources.json`, `apps/sidecar/src/providers/**` (how `xai`/`groq`/`together` get their base URL and the OpenAI SDK client), `apps/sidecar/src/services/secrets-service.ts` (+ its verifier), `apps/desktop/src/features/settings/api-keys/**`.

## Scope (broad)

- `src/types/schemas.ts` — additive: `ProviderId` members `DEEPSEEK: 'deepseek'`, `OPENROUTER: 'openrouter'`, `QWEN: 'qwen'`, `MISTRAL: 'mistral'`; optional settings field for the Qwen base URL (below).
- `config/models.seed.json`, `config/pricing.seed.json`, `config/pricing.sources.json`.
- `apps/sidecar/src/**` — provider registry/base URLs, verifier, validation, default settings + normalisation, anything that enumerates providers (+ tests).
- `apps/desktop/src/**` — API Keys page (and any provider label/icon map, pricing/pipeline pickers that enumerate providers) (+ tests); `apps/desktop/src/i18n/{en,vi}.json` new keys only.
- `e2e/specs/m1/api-keys.spec.ts` only if it enumerates providers.
- This task file (`## Result`).

## Providers

| ProviderId | Display name | Base URL | Notes |
|---|---|---|---|
| `deepseek` | DeepSeek | `https://api.deepseek.com` | Key at platform.deepseek.com. |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | Send `HTTP-Referer: https://itstudio.local` and `X-OpenRouter-Title: IT Studio` (also `X-Title: IT Studio`). Provider model ids contain a slash (e.g. `deepseek/deepseek-v4-flash`) → model key `openrouter/deepseek/deepseek-v4-flash`; make sure every place that parses a `ModelKey` splits **only at the first `/`**. |
| `qwen` | Qwen (Alibaba Cloud) | default `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | Keys are **region-bound**. Add optional setting `providers.qwen.baseUrl` (HTTPS only, validated URL, max 300 chars) and on the API Keys page a "Region / endpoint" select: *International (Singapore)* = default above, *United States (Virginia)* = `https://dashscope-us.aliyuncs.com/compatible-mode/v1`, *China (Beijing)* = `https://dashscope.aliyuncs.com/compatible-mode/v1`, *Custom…* = free text (for per-workspace endpoints). Saved before verification so verify uses it. |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | — |

## Seed models (all `enabled: true`, **not** added to default router ladders or pipeline role defaults)

| Model key | Display | Capabilities | Context / max out | Seed price µUSD per MTok in / out (unverified) | Source URL |
|---|---|---|---|---|---|
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | chat, tool_calling, code, json_mode | 1 000 000 / 32 768 | 140 000 / 280 000 (cached in 2 800) | https://api-docs.deepseek.com/quick_start/pricing |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | chat, tool_calling, code, json_mode | 1 000 000 / 32 768 | 1 740 000 / 3 480 000 | same |
| `mistral/mistral-large-latest` | Mistral Large | chat, tool_calling, code, json_mode | 128 000 / 32 768 | 500 000 / 1 500 000 | https://mistral.ai/pricing |
| `mistral/mistral-medium-latest` | Mistral Medium | chat, tool_calling, code, json_mode | 128 000 / 32 768 | 1 500 000 / 7 500 000 | same |
| `mistral/mistral-small-latest` | Mistral Small | chat, tool_calling, json_mode | 128 000 / 32 768 | 150 000 / 600 000 | same |
| `qwen/qwen-max` | Qwen Max | chat, tool_calling, code, json_mode | 131 072 / 8 192 | 1 600 000 / 6 400 000 | https://www.alibabacloud.com/help/en/model-studio/models |
| `qwen/qwen-plus` | Qwen Plus | chat, tool_calling, code, json_mode | 131 072 / 16 384 | 400 000 / 1 200 000 | same |
| `qwen/qwen-flash` | Qwen Flash | chat, tool_calling, json_mode | 1 000 000 / 16 384 | 50 000 / 400 000 | same |
| `openrouter/openrouter/auto` | OpenRouter Auto | chat, tool_calling, code, json_mode | 128 000 / 16 384 | 1 000 000 / 4 000 000 (placeholder, unverified) | https://openrouter.ai/models |
| `openrouter/deepseek/deepseek-v4-flash` | DeepSeek V4 Flash (OpenRouter) | chat, tool_calling, code, json_mode | 1 000 000 / 32 768 | 140 000 / 280 000 | https://openrouter.ai/deepseek |

Model ids and prices come from third-party listings on 2026-10-15 — keep seed rows marked unverified (existing provenance mechanism). Add each provider's pricing page(s) to `pricing.sources.json` so *Settings → Pricing → Update prices* can refresh them.

## Verification (`secrets.verifyAndSave` / `secrets.verify`)

Use the same approach as the existing OpenAI-compatible providers. If `GET {base}/models` does not prove the key (OpenRouter's `/models` is public), use: OpenRouter `GET https://openrouter.ai/api/v1/key`; otherwise a 1-token chat completion with the provider's cheapest seed model. 401/403 → rejected with the existing message; network error → existing "could not verify" path. Never log or echo the key.

## Tests (keep it lean)

- Unit: registry returns the right base URL/headers per provider (incl. Qwen custom URL and OpenRouter headers); `ModelKey` parsing with a slash in the provider model id (`openrouter/deepseek/deepseek-v4-flash` → provider `openrouter`, model id `deepseek/deepseek-v4-flash`) everywhere it is parsed; verifier request per provider (fake HTTP); settings normalisation/validation for `providers.qwen.baseUrl` (rejects http://, invalid URL, > 300 chars); seed files load and every seed model has a price row.
- Desktop: API Keys page lists the four providers; Qwen region select saves the base URL before verify; Custom accepts only https.
- Existing tests stay green (update provider-count fixtures only).

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.
- [ ] QA (lean, owner request): unit + `secrets`/`router`/`settings-projects` integration files + `e2e/specs/m1/api-keys.spec.ts`, then `build:app` + `smoke:sidecar`.

## Hand-back

Append `## Result` per AGENTS.md §3.
