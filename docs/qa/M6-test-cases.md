# M6 — Test Case Specification (pipeline: roles, worker writes, rollback, Code tab)

> QA gate `M6-QA` · Author: QA (Claude) · 2026-10-02 · Strategy: `TESTING.md`
> Scope: M6-01…M6-08. Levels: **L1/L2** unit · **L3** real sidecar, scripted role replies (`ITSTUDIO_E2E_LLM_TEXT` / script fixtures), real file system in a temp workspace, real child processes for validation commands (`node` scripts only) · **L4** Code tab — batched E2E session (QA).
> Status: **exists** / **new** / **defect** (product fix required).

## 1. Black-box cases

### 1.1 Pipeline outcomes (decision table: review verdict × validation result × cancel point)

| ID | Review 1 | Review 2 | Validation | Expected final stage | Files on disk | Level | Pri | Status |
|---|---|---|---|---|---|---|---|---|
| TC-M6-001 | approve | — | pass | COMPLETED | written | L3 | P1 | exists |
| TC-M6-002 | approve | — | fail | ROLLED_BACK + failure report | byte-identical to before | L3 | P1 | exists |
| TC-M6-003 | reject | approve | pass | COMPLETED (FIXING → RE_REVIEWING visited) | written | L3 | P1 | new |
| TC-M6-004 | reject | reject | — | FAILED, report with findings | untouched (nothing written) | L3 | P1 | new |
| TC-M6-005 | blocker finding but verdict "approve" | — | — | treated as reject (reviewer override) | — | L2 | P1 | exists (role-caller) — verify |
| TC-M6-006 | invalid JSON from coder twice | — | — | FAILED after one re-ask, `INVALID_ROLE_OUTPUT`-style error | untouched | L3 | P1 | new |

### 1.2 Cancel at every stage

| ID | Cancel during | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M6-010 | SPECIFYING / CODING / REVIEWING / FIXING | CANCELLED, nothing written | L2 | P1 | exists (unit) — verify each |
| TC-M6-011 | WRITING | ROLLED_BACK, byte-identical | L2 | P1 | exists — verify |
| TC-M6-012 | VALIDATING (long-running command) | child process tree killed, ROLLED_BACK, byte-identical | L3 | P1 | new |

### 1.3 Worker safety — path-traversal corpus (security)

Coder output proposes writes to each path below; every one must be rejected **before** anything is written and the run must end FAILED with a report.

| ID | Path | Level | Pri | Status |
|---|---|---|---|---|
| TC-M6-020 | `../escape.txt` | L2+L3 | P1 | exists (path-guard unit) — add L3 |
| TC-M6-021 | `C:\Windows\System32\drivers\etc\hosts` / `/etc/passwd` | L2 | P1 | exists — verify |
| TC-M6-022 | `src/../../escape.txt`, `src\..\..\escape.txt`, `%2e%2e/escape.txt` | L2 | P1 | verify / new |
| TC-M6-023 | Path outside `TaskSpec.allowedPaths` but inside workspace | L3 | P1 | exists (unit) — add L3 |
| TC-M6-024 | Junction / symlink inside workspace pointing outside | L2 | P1 | new |
| TC-M6-025 | `.git/config`, `.itstudio/tx/...` | L2 | P1 | new (must be rejected) |
| TC-M6-026 | Reserved device names `CON`, `NUL.txt`, trailing dot/space `a.txt.` | L2 | P2 | new |

### 1.4 Journal & crash recovery

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M6-030 | Crash after `prepare` | next sidecar start rolls back, failure report queued | L3 | P1 | new (kill sidecar process between stages) |
| TC-M6-031 | Crash mid-`commit` (some files renamed) | restart → all restored byte-identical | L3 | P1 | new |
| TC-M6-032 | Base-hash conflict (file changed after coder read it) | `PATCH_CONFLICT`, nothing written | L2 | P1 | exists — verify |
| TC-M6-033 | Rollback failure (restore target locked) | `ROLLBACK_FAILED` report with exact journal paths in next steps | L2 | P2 | exists — verify |

### 1.5 Command runner

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M6-040 | Non-allow-listed executable (`cmd`, `powershell`, `bash`) | `VALIDATION`, never spawned | L2 | P1 | exists — verify |
| TC-M6-041 | Env allow-list | secrets in parent env (e.g. `OPENAI_API_KEY`) not visible to the child | L3 | P1 | new |
| TC-M6-042 | Timeout | tree-kill, `timedOut=true`, run ROLLED_BACK | L2 | P1 | new (raises `command-runner.ts` from 54.5 %) |
| TC-M6-043 | Output cap | > cap bytes → truncated flag, no memory blow-up | L2 | P2 | new |
| TC-M6-044 | Shell metacharacters in args (`&&`, `|`, `$(…)`) | passed literally, no shell expansion | L2 | P1 | new |

### 1.6 Queue, budget, cost

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M6-050 | Second start on same project | queued, runs after the first; `pipeline.list` order | L2 | P1 | exists — verify |
| TC-M6-051 | Hard Stop before WRITING / during VALIDATING | FAILED nothing written / ROLLED_BACK | L2 | P1 | exists — verify |
| TC-M6-052 | Run cost = Σ attributed ledger rows | equality, > 0 | L3 | P1 | exists (in TC-M6-001) |

### 1.7 Prompt-injection (carry-over from M6-04)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M6-060 | File content / CONVENTIONS.md containing `</CONTEXT>` (upper/mixed case) | neutralised in every `<context>` block | L1 | P1 | **defect**: `domain/template.ts` replaces only lowercase `</context>` — fix to case-insensitive and test `</CONTEXT>`, `</Context >`, `</context\n>` |
| TC-M6-061 | Reviewer verdict JSON smuggled in coder output | ignored; reviewer verdict only from reviewer call | L2 | P2 | new |

### 1.8 Code tab (L4 — batched E2E session)

| ID | Case | Expected | Pri | Status |
|---|---|---|---|---|
| TC-M6-070 | Run scripted pipeline → timeline reaches COMPLETED, cost shown | as described | P1 | exists (`TC-M6-010` in code.spec.ts → **rename to TC-M6-070**) |
| TC-M6-071 | Failing validation → failure report panel with next steps | P1 | new |
| TC-M6-072 | Cancel during VALIDATING asks for confirmation | P2 | new |

## 2. White-box targets

| Module | Gate | Measured 2026-10-02 (branches) | Action |
|---|---|---|---|
| `domain/path-guard.ts` (`resolveSafe`) | 100 % | 100 % | keep |
| `services/write-transaction.ts` | 100 % | 100 % | keep |
| `domain/template.ts` | 100 % | — | after the TC-M6-060 fix |
| `services/command-runner.ts` | ≥ 90 % | **54.5 %** | TC-M6-041…044 |
| `services/pipeline-orchestrator.ts` | ≥ 85 % | 85.1 % | keep ≥ 85 % |
| **Mutation (StrykerJS 10)** on `domain/path-guard.ts`, `services/write-transaction.ts`, `domain/pipeline-machine.ts`, `domain/template.ts` | score reported; target ≥ 80 % | — | add `stryker.config.mjs` (vitest runner) + `npm run test:mutation`; report score |

Hygiene (carry-over from M6-05 QA): `container.test.ts` cases without `dataDir` write to `./data` and persist across runs — use a temp dir.

## 3. Traceability

| Requirement | Cases |
|---|---|
| D5 roles + ≤ 1 fix round | TC-M6-001…006 |
| D11 rollback + report with next steps | TC-M6-002, 011, 012, 030…033, 071 |
| D16 worker safety | TC-M6-020…026, 040…044 |
| ARCH §8.1 stages / cancel | TC-M6-010…012, 050 |
| ARCH §9.4 crash recovery | TC-M6-030, 031 |
| ARCH §11 prompt injection | TC-M6-060, 061 |
| D7 Hard Stop | TC-M6-051 |
| M6-08 run cost | TC-M6-052 |

## 4. Exploratory charter (20 min, QA)
Run pipelines on a real small repo with real validation commands (`npm test`), edit a file in VS Code while VALIDATING, kill the app during WRITING, run two projects at once; look for partial writes, stale journals, zombie processes.
