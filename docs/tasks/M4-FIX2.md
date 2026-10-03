# M4-FIX2 — Chat model choice must not disable fallback (BUG-M4-002) · Code-tab timeline on early failure (BUG-M6-001)

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Found in the QA batched E2E session 2026-10-03.

## Defects
- **BUG-M4-002 (S2):** picking a specific model in the Chat model dropdown sends `modelOverride`; `ChatService` turns it into `ladderOverride: [model]`, a one-model ladder, so **any 429 / quota / 5xx ends in `LADDER_EXHAUSTED` with no fallback**. This contradicts D10 (fallback is mandatory; Auto Fallback ON switches automatically, OFF asks the user) and ARCH §5.4 (even a locked model keeps fallback). Evidence: E2E TC-M4-022 — "Attempts: openai/gpt-5.4-mini: server_error ×3 … LADDER_EXHAUSTED".
- **BUG-M6-001 (S3):** when a pipeline fails in SPECIFYING, the Code tab timeline shows Code / Review / Write changes / Validate as **done** and only the final node as failed, although those stages never ran (report correctly says "Failed during Specify"). Stages that were never entered must render as *skipped/not run*.

## Read first
- `AGENTS.md`, CONTEXT D10, `ARCHITECTURE.md` §5.3–§5.4, §8.1, `schemas.ts` §5 (`LlmRequest`, `RouterConfig`), `apps/sidecar/src/services/{chat-service,llm-router}.ts`, `apps/desktop/src/features/code/{StageTimeline.tsx,pipeline-store.ts}`

## Scope
- `src/types/schemas.ts` — **additive only**: in `LlmRequest` add `/** Chat model choice: tried first, then the rest of the ladder (fallback per autoFallback). */ readonly preferredModelKey?: ModelKey;`
- `apps/sidecar/src/validation/**` (matching optional field if `LlmRequest` is validated), `apps/sidecar/src/services/{chat-service,llm-router}.ts` (+ tests), `apps/sidecar/test/integration/router.test.ts` or `chat.test.ts` (one new case)
- `apps/desktop/src/features/code/{StageTimeline.tsx,pipeline-store.ts}` (+ tests)

## Requirements
1. `ChatService` maps `modelOverride` → `preferredModelKey` (no longer `ladderOverride`). Router ordering: `preferredModelKey` first (even if its ladder entry is disabled — the user picked it explicitly), then `lockedModelKey` if set and different, then the remaining **enabled** ladder entries by priority; de-duplicated. `ladderOverride` keeps its current meaning (pipeline role ladders).
2. Auto Fallback ON → automatic switch; OFF → `router.fallbackRequired` exactly as for the ladder.
3. Timeline: derive per-stage state from the stages actually entered (`pipeline.event{type:'stage'}` history / run stage); stages never entered before a terminal FAILED / CANCELLED / ROLLED_BACK render as "not run" (i18n en + vi, text + icon, not colour alone).

## Tests
- Router unit: ordering table (preferred only; preferred + lock; preferred disabled; preferred == lock; no preference).
- Integration `TC-M4-026` (L3): conversation send with `modelOverride` = model A scripted `http:503`×3, model B `ok` → answer from B with a `router.event{fallback A→B}`.
- Desktop: timeline for failure in SPECIFYING / REVIEWING / VALIDATING shows the correct done / failed / not-run states.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; QA runs integration (+ the E2E re-run later). Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.
