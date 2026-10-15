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

## Result

- Summary: Added DeepSeek, OpenRouter, Qwen (Alibaba Cloud), and Mistral through the OpenAI-compatible adapter, including API-key verification, Qwen region/custom HTTPS endpoints, ten enabled model seeds, unverified prices, and refresh sources. Existing router ladders and pipeline role defaults are preserved. No commit was created.
- Files changed:
  - `src/types/schemas.ts`; `config/models.seed.json`, `config/pricing.seed.json`, `config/pricing.sources.json`.
  - `apps/sidecar/src/container.ts` and `container.test.ts`; `domain/default-settings.ts`, `domain/provider-endpoints.ts`, `domain/remediation.ts`, `domain/price-validation.ts` and its test.
  - `apps/sidecar/src/config/load-seeds.test.ts`; `infra/http/provider-key-verifier.ts` and its test; `providers/openai-compatible/openai-compatible-provider.ts` and its test.
  - `apps/sidecar/src/services/settings-service.ts`, `pricing-service.ts`, `pricing-updater.ts` and their tests; `services/secrets-service.test.ts`; `validation/common.ts`, `validation/settings.ts`.
  - `apps/desktop/src/features/settings/api-keys/ApiKeysPage.tsx`, its test, and `QwenEndpoint.tsx`; new keys only in `apps/desktop/src/i18n/en.json` and `vi.json`.
- Dependencies added (with reason): None. Ran `npm.cmd --cache .npm-cache install` because `node_modules` was absent; package manifests and lockfile are unchanged. Used `npm.cmd` because PowerShell blocks `npm.ps1` under this session's execution policy.
- Decisions taken within scope:
  - Centralized compatible endpoints/attribution headers and read saved Qwen settings for each request. The UI persists the selected endpoint successfully before submitting the candidate key for verification.
  - Qwen verification sends a one-token completion using the cheapest enabled Qwen seed model, selected from seed prices at composition time; model IDs are not hard-coded in implementation logic. Alibaba documents model listing at a separate `/api/v1/models` route, so verification uses the configured compatible chat endpoint. OpenRouter verifies with `/key`, never its public `/models` route. DeepSeek and Mistral use authenticated `/models` requests.
  - Allowed additional slash-separated model-ID segments in validation; pricing provider attribution uses the first segment or the descriptor's provider, preserving complete nested IDs in requests, registry lookup, and extraction.
  - Required cached-input prices default to the corresponding input price where the task specifies no discount; DeepSeek V4 Flash uses the specified 2,800 microUSD/MTok cached rate. All added rows remain seed/unverified.
  - Also wired the remediation provider-name map and added an immutable price-table version on upgrade when new seed rows are missing. Existing prices, row provenance, manual overrides, old table versions, and price age are preserved. This is necessary for existing installations to meter the new models immediately.
- Validation:
  - Ran Prettier on changed files before checks; repository ignore rules retain the existing compact seed/schema formatting.
  - `npm.cmd --cache .npm-cache run typecheck`: passed; final test additions also checked separately.
  - Full Vitest command (`npm.cmd --cache .npm-cache exec -- vitest run --project sidecar --project desktop --project vscode-ext`): 158 files passed, 1 skipped; 1,383 tests passed, 1 skipped. Subsequent container/nested-pricing regression additions: 37 tests passed across 2 files. Focused feature run: 238 tests passed across 8 files.
  - `npm.cmd --cache .npm-cache test`: pretest stopped before Vitest because four existing secret-scanner regression tests require empty stderr, but Git emits permission denied for `C:/Users/admin/.config/git/ignore` in the sandbox. Direct Vitest execution above passed without changing tooling.
  - Direct release/build/dev script tests: 25 passed, 1 failed. Existing `REPO-01` reference-guard failure identifies `docs/HANDOFF.md:136` and the original Read-first paragraph in this task at line 11. Neither specification text was edited.
  - Requested secrets/router/settings-projects integration files: all 27 cases could not start the sidecar because `tsx` calls `os.userInfo()` and receives `uv_os_get_passwd ENOMEM`, a documented sandbox limit.
  - API Keys E2E launch: WDIO fails while importing `tsx` with the same `os.userInfo()` sandbox error; no UI cases ran. The wrapper does not forward its `--spec` argument; the import failure happens before any suite starts.
  - `npm.cmd --cache .npm-cache run build:app`: failed at sidecar esbuild, with access denied reading a parent directory and resolving `apps/sidecar/src/main.ts`. `smoke:sidecar` subsequently failed with ENOENT because the packaged executable was not produced. Tooling was not changed to work around sandbox limits.
- Open issues / follow-ups: QA must rerun the checks affected by sandbox restrictions outside the sandbox; the integration provider-count fixture requires the scope clarification below. `npm.cmd --cache .npm-cache run lint` passed (exit 0), including ESLint, Prettier check and secret scan; Git still emitted its global-ignore permission warning. The final verifier-only rerun passed all 68 cases.
- Changelog draft (for Architect; protected changelog not edited): Add DeepSeek, OpenRouter, Qwen regional/custom endpoints, and Mistral with unverified seed pricing (PROV-01).

## Result

- Summary: Applied the approved TC-M1-032 provider-count correction from seven to eleven (test title and count assertion only).
- Files changed: `apps/sidecar/test/integration/secrets.test.ts`; this task file.
- Dependencies added (with reason): None; `node_modules` is present.
- Decisions taken within scope: Used the Architect's approved scope extension below; no other implementation changes.
- Open issues / follow-ups: Full suite rerun skipped as requested; prior validation and sandbox limitations remain documented above. No commit created.

## Answer to Blocked (Architect, 2026-10-15)

Approved: update `apps/sidecar/test/integration/secrets.test.ts` TC-M1-032 from seven to eleven providers (count + title only). QA already ran: unit 1 386 pass; integration secrets/router/settings-projects/startup — only TC-M1-032 fails. Do that one change, then replace `## Blocked` with `## Result`.
