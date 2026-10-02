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

## Result
- Summary: Added per-model scripted provider sequences from `ITSTUDIO_E2E_LLM_SCRIPT`, with `ok`, `stream:<n>`, `http:<status>[:<retryAfterMs>]`, `quota`, `auth`, `content_filter`, and `delay:<ms>` outcomes. Added all requested L3 cases and TC-M2-023 with fake-clock circuit tests. Router branch coverage is 90.44%; circuit-breaker branch coverage is 100%.
- Files changed: `apps/sidecar/src/container.ts`; `apps/sidecar/src/services/llm-router.test.ts`; `apps/sidecar/src/services/circuit-breaker.test.ts`; `apps/sidecar/test/integration/harness.ts`; `apps/sidecar/test/integration/router.test.ts` (TC-M2-001–009, 020–022, 030–033); `apps/sidecar/test/integration/chat.test.ts` (TC-M2-010–013, 040–043, 050–051).
- Dependencies added (with reason): None.
- Decisions taken within scope: Fixtures map model keys to ordered outcome strings and are written into the harness temp data directory. The E2E composition uses an immediate retry wait so boundary and retry-sequence cases stay deterministic; the user-decision timeout case retains its real configured timeout. Test call counts use router attempt/state events; no test-only RPC was added.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass. Targeted coverage runs report 90.44% branches for `llm-router.ts` and 100% for `circuit-breaker.ts`. `npm run test:integration` was attempted in the sandbox, but every spawned sidecar failed in the existing `tsx` launcher at `os.userInfo()` (`uv_os_get_passwd returned ENOMEM`), including unrelated M1/M3 cases. QA must run the required three integration passes outside the sandbox.

## Fix round 1 (QA) — integration run outside the sandbox: 44/47, 3 fail consistently (3/3 runs)
1. **TC-M2-003** — test defect: `toContainEqual({from,to,reason})` needs `expect.objectContaining(...)`; the router DID emit `{type:'fallback', from: gemini, to: groq, reason: rate_limited}`.
2. **TC-M2-004** — real-process event log contains **no `router.event{type:'circuit'}` at all**. ARCH §5.3 requires a `circuit` event (`open` / `half_open` / `closed`) when a model's circuit changes state. Verify in `llm-router.ts` / `circuit-breaker.ts`; if not emitted → **product defect (BUG-M2-001)**: fix it (you may edit those two files + their tests) and assert in the test `type:'circuit', status:'open', modelKey: A` plus that the 2nd request never dispatches A (skipped attempt). Replace the `JSON.stringify(...).toContain('circuit_open')` string search with structured assertions.
3. **TC-M2-011** — `findIndex(...) === -1`: the expected event before B's deltas is missing. Determine what the router emits on a mid-stream failure in a real process (ARCH §5.3: `router.event{type:'fallback'}` and partial discard). If the router skips the fallback event for mid-stream failures → product defect (BUG-M2-002), fix + unit test; otherwise fix the test.
In `## Result — fix round 1` state for each item: test defect vs product defect, and what changed. QA re-runs integration ×3.

## Result — fix round 1
- TC-M2-003: Test defect. The fallback assertion now checks a structured `router.event` with `type: 'fallback'` and the expected model keys and reason.
- TC-M2-004: No product defect found in the inspected path: `CircuitBreaker` calls its change callback when it opens, and `LlmRouter` publishes that as a structured `router.event`. Added a unit regression assertion for the open event and confirmed the next request dispatches the other model. The integration assertion now checks the open event and ensures model A is dispatched only for the first request.
- TC-M2-011: No product defect found in the inspected path: the router machine discards partial output, emits fallback, then dispatches model B. Replaced the test's serialized substring search with a structured event check and added a unit chronology assertion covering reset, fallback, and model B deltas.
- Files changed: `apps/sidecar/test/integration/router.test.ts`, `apps/sidecar/test/integration/chat.test.ts`, `apps/sidecar/src/services/llm-router.test.ts`, `docs/tasks/M2-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Product event paths were already implemented; regression assertions cover circuit event wiring and mid-stream event ordering without changing the product behavior.
- Open issues / follow-ups: `npm run typecheck`, `npm run lint`, and `npm test` pass. The integration process could not start in this sandbox because the existing `tsx` launcher fails at `os.userInfo()` with `uv_os_get_passwd returned ENOMEM`. QA must rerun the three outside-sandbox integration passes to verify real-process delivery and sign off.

## QA (Claude) — final
- Verdict: **PASS**. Integration **47/47 ×3 runs** outside sandbox; unit 369 ✔; llm-router 90.4 % branches, circuit-breaker 100 %.
- Fix-round analysis confirmed by QA: TC-M2-003/004 test defects (fixed by Codex). TC-M2-011 test-design defect fixed by QA: 503 is retryable (ARCH §5.2) so 3 mid-stream failures are needed before fallback, and the custom reply text made A partials indistinguishable from B output. No product defect in M2.
