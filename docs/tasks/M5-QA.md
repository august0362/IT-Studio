# M5-QA — Automate the M5 test-case specification

Milestone: M5 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Read first
- `AGENTS.md`, `TESTING.md`, **`docs/qa/M5-test-cases.md`** (your work order), existing tests under `apps/sidecar/src/**/*.test.ts` and `apps/sidecar/test/integration/{rag-ingest,rag-retrieval}.test.ts`

## Scope
- Tests only: `apps/sidecar/src/**/*.test.ts` (RAG, chunker, parsers, embeddings, vector store), `apps/sidecar/test/integration/rag-*.test.ts` (+ new `rag-*.test.ts` files), `apps/sidecar/test/fixtures/rag/**`, `e2e/specs/m5/**`. Another QA task edits other sidecar tests in parallel — do not touch M3 test files. Production code **only** if a new test exposes a defect — then fix minimally and list it under *Decisions*.

## Requirements
1. Implement every case marked **new** and complete every **verify** / **→ add L3** item; use the case ID in the test name (`it('TC-M5-034 …')`).
2. **Split** combined tests so each case ID has its own `it` (TC-M5-001/002/003, TC-M5-010/011). Write the L4 cases TC-M5-021…023 in `e2e/specs/m5/knowledge.spec.ts` but **do not run E2E**.
3. Reach the white-box gates in §2: `chunker.ts` ≥ 90 %, `parse-document.ts` and `rag-service.ts` ≥ 90 %, `vector-store.ts` ≥ 80 % branches.
4. No real network, no real keychain, no GUI/E2E runs (they open windows on the user's desktop).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; coverage gates met (report numbers); QA runs integration

## Hand-back
Append `## Result` per AGENTS.md §3 including a table: case ID → test file → status.
