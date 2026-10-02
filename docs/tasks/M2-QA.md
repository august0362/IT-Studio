# M2-QA — Automate the M2 QA gate

Milestone: M2 · Depends on: M2-01…M2-10, M3-02 (container changes land first) · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Goal
Automate every case in `docs/qa/M2-test-cases.md` marked L3, and close the white-box gaps listed there.

## Read first
- `AGENTS.md`, `TESTING.md`, `docs/qa/M2-test-cases.md` (your work list, §4 hand-off), `apps/sidecar/test/integration/**`, the `ITSTUDIO_E2E` scripted provider in the sidecar composition root

## Scope
- `apps/sidecar/test/**`, the `ITSTUDIO_E2E` scripted-provider code (file(s) where it lives, plus the minimal `container.ts` change to load a per-test fixture via env var `ITSTUDIO_E2E_LLM_SCRIPT`), `apps/sidecar/src/services/llm-router.test.ts`, `apps/sidecar/src/services/circuit-breaker.test.ts`

## Requirements
1. Scripted provider: per-model outcome sequences (`ok`, `stream:<n>`, `http:<status>[:<retryAfterMs>]`, `quota`, `auth`, `content_filter`, `delay:<ms>`), from a JSON file given by `ITSTUDIO_E2E_LLM_SCRIPT`; call counter exposed through a test-only RPC is **not allowed** — count calls by inspecting `router.event`/attempts in responses instead.
2. Implement TC-M2-001…013, 020–022, 030–033, 040–043, 050–051 (L3) with TC ids in titles; TC-M2-023 as L2 with fake clock.
3. Raise `llm-router.ts` branch coverage to ≥ 90 %; circuit-breaker 100 % branches.
4. Keep tests deterministic: no fixed sleeps (use `waitFor`), fake clock where timing matters (decision timeout uses the minimum 10 s config only in one P2 case).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; QA runs `npm run test:integration` ×3 outside the sandbox — all pass
- [ ] Coverage targets in `docs/qa/M2-test-cases.md` §2 met

## Hand-back
Append `## Result` per AGENTS.md §3, mapping each TC id to its test file.
