# QA-BREAK-FIX-A — Sidecar defects found by the adversarial suites

Milestone: v1 hardening · Role: Implementer (ROLES §1.3) · Size M · **Deps pre-installed** · Depends on QA-BREAK-01/02, UX-02 (landed)

## Goal

Turn every sidecar `it.fails('QA-BREAK-0x-Dnn …')` in `apps/sidecar/test/integration/break-*.test.ts` into a passing `it(...)` by fixing the product. Desktop defects are in QA-BREAK-FIX-B.

## Read first

`AGENTS.md`, `CONTEXT.md` D4, D7, D10, D11, D32, the defect tables in `docs/tasks/QA-BREAK-01.md` and `docs/tasks/QA-BREAK-02.md`, the failing tests themselves.

## Scope — files you may create/modify

- `apps/sidecar/src/**` (product fixes + unit tests). No SQL migration unless unavoidable (then justify in Result).
- `apps/sidecar/test/integration/break-*.test.ts` — only `it.fails` → `it` for fixed defects and the D01 rewrite below; do not weaken assertions.
- `src/types/schemas.ts` — **only** remove `workspace.readFile` and `workspace.runCommand` from the RPC map (Architect decision below).
- This task file (`## Result`)

## Defects

| ID | Fix |
|---|---|
| QA-BREAK-01-D01 | **Architect decision:** `workspace.readFile` / `workspace.runCommand` are unused by any client. Remove them from `RpcMethodMap` and from `validation/ipc.ts` (params + result). Rewrite the D01 test: both methods return `-32601` and are absent from the contract. |
| QA-BREAK-01-D02 | `pnl.get` errors after adversarial money inputs: unsafe money must be rejected at `revenue.add`/related inputs (finite, safe integer µUSD/VND, non-negative where required) and `pnl.get` must always return finite integer totals. |
| QA-BREAK-01-D04 | RPC params validation must reject unknown keys (`.strict()` on every top-level params object in `validation/ipc.ts`, and nested patch objects such as `SettingsPatch`), never touch `Object.prototype` (`__proto__`, `constructor`, `prototype` keys rejected). Check that the desktop never sends extra keys (run desktop tests). |
| QA-BREAK-02-D05 | Deleting a RAG source during an in-flight (re-)index must win: the ingest job checks a per-source generation/cancel token before every write (metadata and vectors) and drops its results if the source was deleted; no resurrected document or vectors. |
| QA-BREAK-02-D06 | Two same-tick `pipeline.start` for one project: admission must be atomic (synchronous check-and-reserve before any `await`). Exactly one active run; the other request follows the existing queue/reject contract consistently — keep whatever the current contract says for a busy project. |
| QA-BREAK-02-D07 | During a 500-query `rag.query` burst ping p95 must be < 200 ms: workflow activity recording/broadcast must not block the event loop (batch/coalesce activity events, e.g. flush at most every 100 ms, bounded queue). |
| QA-BREAK-02-D08 | Concurrent `settings.update` patches lose fields: serialize updates (single-flight mutex / queue) and apply each patch to the latest persisted state (read-modify-write inside the lock). |

## Flaky test

| ID | Fix |
|---|---|
| FLAKE-3 | `apps/sidecar/src/container.test.ts` "logs lifecycle events in order and creates the daily log file" fails under full-suite load (missing last lifecycle lines, then `EPERM` removing the temp dir); passes alone. Await the log flush deterministically (wait for the expected lines with a bounded poll instead of a fixed delay) and retry temp-dir removal (`fs.rm` with `maxRetries`). |

## Acceptance criteria

- [ ] All seven defects fixed; their tests are plain `it(...)` and pass; no other break or integration test regresses.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass. QA runs `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/` outside the sandbox.

## Hand-back

Append `## Result` per AGENTS.md §3.
