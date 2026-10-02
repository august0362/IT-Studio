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

## Result
- Summary: Automated the M5 parser, chunker, ingest, retrieval, vector-store, and Knowledge UI cases. Split TC-M5-001/002/003 and TC-M5-010/011 into individual tests. No production code or dependencies changed.
- Files changed: `apps/sidecar/src/domain/chunker.test.ts`, `apps/sidecar/src/infra/lancedb/vector-store.test.ts`, `apps/sidecar/src/services/chat-service.test.ts`, `apps/sidecar/src/services/embedding-dispatcher.test.ts`, `apps/sidecar/src/services/rag/discover-files.test.ts`, `apps/sidecar/src/services/rag/parsers/parse-document.test.ts`, `apps/sidecar/src/services/rag/rag-service.test.ts`, `apps/sidecar/test/integration/rag-ingest.test.ts`, `apps/sidecar/test/integration/rag-retrieval.test.ts`, `e2e/specs/m5/knowledge.spec.ts`, `docs/tasks/M5-QA.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Used deterministic fake embeddings and temporary local storage in L3 specs. Kept the prompt-sanitization and citation-order checks in the existing chat-service unit test. Did not run E2E as requested.
- Open issues / follow-ups: The integration suite could not launch sidecar child processes in this sandbox: Node failed in `os.userInfo()` with `uv_os_get_passwd returned ENOMEM`, matching the documented sandbox limitation. QA should rerun L3 outside the sandbox. TC-M5-009 is covered by the embedding-dispatcher fallback unit test; an L3 503 case needs fake-provider failure scripting, which the current integration harness does not expose. QA should execute TC-M5-020 through TC-M5-023 in the planned E2E session, with a scripted assistant response containing `[1]` for TC-M5-023.

### Case status

| Case ID | Test file | Status |
|---|---|---|
| TC-M5-001 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-002 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-003 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-004 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-005 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-006 | `apps/sidecar/src/services/rag/rag-service.test.ts` | Implemented; unit test verifies hard stop leaves the next file untouched |
| TC-M5-007 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-008 | `apps/sidecar/src/services/rag/rag-service.test.ts` | Existing dimension-change coverage identified by case ID; unit suite passes |
| TC-M5-009 | `apps/sidecar/src/services/embedding-dispatcher.test.ts` | Fallback and metering automated at L2; L3 scripting follow-up needed |
| TC-M5-010 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-011 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-012 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-013 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-014 | `apps/sidecar/src/services/chat-service.test.ts`; `apps/sidecar/test/integration/rag-retrieval.test.ts` | Prompt neutralization verified at L2; hostile-content retrieval case added at L3 |
| TC-M5-015 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-016 | `apps/sidecar/src/services/chat-service.test.ts`; `apps/sidecar/test/integration/rag-retrieval.test.ts` | Retrieval failure fallback and warning covered; L3 run blocked by sandbox |
| TC-M5-017 | `apps/sidecar/src/services/chat-service.test.ts` | Citation order, de-duplication, and out-of-range handling automated at L2 |
| TC-M5-018 | `apps/sidecar/test/integration/rag-retrieval.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-020 | `e2e/specs/m5/knowledge.spec.ts` | Existing spec; not run |
| TC-M5-021 | `e2e/specs/m5/knowledge.spec.ts` | Implemented; not run per instruction |
| TC-M5-022 | `e2e/specs/m5/knowledge.spec.ts` | Implemented; not run per instruction |
| TC-M5-023 | `e2e/specs/m5/knowledge.spec.ts` | Implemented; not run per instruction |
| TC-M5-030 | `apps/sidecar/src/services/rag/parsers/parse-document.test.ts` | Seven supported formats automated; unit suite passes |
| TC-M5-031 | `apps/sidecar/src/services/rag/parsers/parse-document.test.ts`; `apps/sidecar/test/integration/rag-ingest.test.ts` | Zero-byte, binary, and mixed-failure cases automated; L3 run blocked |
| TC-M5-032 | `apps/sidecar/src/services/rag/parsers/parse-document.test.ts`; `apps/sidecar/src/services/rag/discover-files.test.ts` | Size boundary automated; unit suite passes |
| TC-M5-033 | `apps/sidecar/src/services/rag/discover-files.test.ts` | Ignored directories and symlink loop automated; unit suite passes |
| TC-M5-034 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-035 | `apps/sidecar/test/integration/rag-ingest.test.ts` | Implemented; L3 run blocked by sandbox |
| TC-M5-040 | `apps/sidecar/src/domain/chunker.test.ts` | Automated; chunker branches 90.81% |
| TC-M5-041 | `apps/sidecar/src/domain/chunker.test.ts` | Automated; unit suite passes |
| TC-M5-042 | `apps/sidecar/src/domain/chunker.test.ts` | Automated; unit suite passes |

### Verification

- `npm --cache .npm-cache run typecheck`: passed.
- `npm --cache .npm-cache run lint`: passed.
- `npm --cache .npm-cache test`: passed (677 passed, 1 skipped).
- Branch coverage: `chunker.ts` 90.81%; `parse-document.ts` 92.95%; `rag-service.ts` 90.76%; `vector-store.ts` 80.48%.
- `npm --cache .npm-cache run test:integration`: blocked because child sidecar startup failed in Node `os.userInfo()` with `uv_os_get_passwd returned ENOMEM`.
- E2E suite: not run, as requested.
