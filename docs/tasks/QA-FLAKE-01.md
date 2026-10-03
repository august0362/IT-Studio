# QA-FLAKE-01 — Remove known flaky tests and wire script tests into `npm test`

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Effort: small · Tests / config only

## Known flakes (seen repeatedly by QA, all pass when rerun alone)
| Test | Symptom | Likely cause |
|---|---|---|
| `apps/sidecar/src/services/rag/parsers/parse-document.test.ts` › "converts DOCX headings to markdown" | 5 s timeout under load | first call lazily imports `mammoth` (PERF-01) |
| `apps/sidecar/src/infra/lancedb/vector-store.test.ts` › contract "orders by cosine score…" | timeout under load | lazy LanceDB native load |
| `apps/sidecar/src/container.test.ts` › "round trips all project and settings RPC methods" | assertion on project fixture under parallel load | cases without `dataDir` default to `./data` and share a persistent DB across runs / files |
| Google embedding success (embedding providers test) | timeout under load | lazy SDK import |

## Scope
The test files above, `vitest.config.ts` / project configs (test timeouts, `hookTimeout`), root `package.json` scripts (only to add script tests to `npm test`).

## Requirements
1. Warm the lazy imports in a `beforeAll` (or raise the per-test timeout to 30 s for these suites only) — no production code changes.
2. `container.test.ts`: every case uses a fresh temp `dataDir` (mkdtemp) and removes it after; no test writes to `./data`.
3. Make `npm test` also run the node-test script suites (`node --test scripts/release/*.test.mjs scripts/build/*.test.mjs`), e.g. `"test": "vitest run && node --test …"`.
4. Prove stability: run `npm test` 3 times in a row in the sandbox (report results).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0 (3 consecutive runs). Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.
