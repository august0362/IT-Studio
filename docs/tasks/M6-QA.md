# M6-QA — Automate the M6 test-case specification (+ fix TC-M6-060 defect)

Milestone: M6 · Role: Implementer (ROLES §1.3) · **Deps pre-installed** (`@stryker-mutator/core` + `vitest-runner` ~10.0)

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M6-test-cases.md`** (your work order), existing pipeline / worker tests, `apps/sidecar/test/integration/pipeline.test.ts`

## Scope
- Tests: `apps/sidecar/src/{domain,services}/**/*.test.ts` for pipeline, worker, command runner, path guard, template, role caller, journal; `apps/sidecar/src/container.test.ts` (temp dataDir only); `apps/sidecar/test/integration/pipeline*.test.ts` (+ new `pipeline-*.test.ts`), `apps/sidecar/test/fixtures/sample-project/**`, `e2e/specs/m6/**`. Other QA tasks edit M3 / RAG tests in parallel — do not touch them.
- Product fix: `apps/sidecar/src/domain/template.ts` (TC-M6-060, case-insensitive neutralisation). Other production code only if a new test exposes a defect — fix minimally and list it under *Decisions*.
- Mutation testing: `stryker.config.mjs` (repo root) + root `package.json` script `test:mutation` (scripts only).

## Requirements
1. Implement every case marked **new** / **defect** and complete every **verify** / **add L3** item; case ID in the test name.
2. Rename the E2E test `TC-M6-010` in `code.spec.ts` to `TC-M6-070`; write TC-M6-071/072 there but **do not run E2E**.
3. Crash-recovery cases (TC-M6-030/031): kill the spawned sidecar between stages using a test-only hook already available or a new env flag `ITSTUDIO_E2E_CRASH_AT=<stage>` honoured only when `ITSTUDIO_E2E=1`.
4. Gates: `command-runner.ts` ≥ 90 %, `template.ts` 100 %, `path-guard.ts` / `write-transaction.ts` stay 100 % branches; run Stryker on the four listed files and report the score (target ≥ 80 %; below target → list surviving mutants under *Open issues*).
5. No real network, no GUI/E2E runs.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; coverage gates met; mutation score reported; QA runs integration

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status, and the mutation score.
