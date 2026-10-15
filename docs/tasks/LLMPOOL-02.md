# LLMPOOL-02 — LLM key pool: desktop page

Milestone: LLMPOOL add-on (CONTEXT D36) · **After LLMPOOL-01 lands** · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed**

## Goal

A React page in the app to manage the key pool and watch it live: add/remove keys, priorities, limits, state badges with countdowns, usage bars, strategy and on/off. Self-contained in `apps/desktop/src/features/llm-pool/`.

## Read first

`AGENTS.md`, `CONVENTIONS.md`, `CONTEXT.md` D36, `src/types/schemas.ts` §LLM-POOL, `apps/desktop/src/features/settings/api-keys/**` (masked key + verify UX to mirror), `apps/desktop/src/shell/{AppShell,MainNav}.tsx`, shared UI primitives used by OWNER-FB1.

## Scope

- `apps/desktop/src/features/llm-pool/**` (new, + tests, `README.md`)
- `apps/desktop/src/shell/{AppShell,MainNav}.tsx` — only: route `settings-llm-pool` and one Settings nav entry "Key pool"
- `apps/desktop/src/i18n/{en,vi}.json` — only `llmPool.*` keys and the nav label
- This task file (`## Result`)

## Requirements

1. **Header:** pool on/off toggle, strategy select (Priority / Round robin / Least used), "max keys per request" (1–5), "use Settings key as fallback" toggle; Save via `llmPool.updateConfig`.
2. **Key table grouped by provider:** label, masked key, priority (number input + up/down; drag optional), state badge — ACTIVE green, COOLDOWN amber with live countdown to `cooldownUntil`, EXHAUSTED red with "resets at …", INVALID red "key rejected — replace or reset", DISABLED grey — `stateReason` as tooltip/secondary text, in-flight count, usage today (requests, tokens) and month (USD) with progress bars against limits when set, last used.
3. **Actions per key:** enable/disable, edit (label, priority, limits), reset state, remove (confirm dialog). Provider group actions: "Add key" dialog (provider, label, key input type=password, priority, optional limits, "Verify before saving" checked by default) and "Import key from API Keys" when that provider has a Settings key.
4. **Live:** subscribe to `llmPool.event`; refetch `llmPool.list` (debounced ≤ 1/s); show a short toast for `rotated` events ("OpenAI: switched from Key A to Key B — rate limited").
5. **Safety:** the full key is never rendered after save; the add dialog clears the input on close; errors use the existing `<ErrorPanel>`.
6. **A11y/i18n:** labelled controls, en + vi, visible focus, badges have text not colour only.

## Tests (RTL + fake RPC)

Config save; add with verify (success / `VALIDATION` error keeps dialog open); import; edit/limits validation; remove confirm; reset; countdown renders and expires to ACTIVE after refetch; `rotated` event shows toast and triggers one refetch per burst; full key never in the DOM after save.

## Acceptance criteria

- [ ] Requirements met and tested; `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.
