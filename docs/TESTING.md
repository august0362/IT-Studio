# TESTING.md — Test Strategy, Techniques & QA Process

> Binding for every milestone. Owner: **QA role (Claude)** designs test cases, executes QA and signs off. **Codex** implements the automated tests from the test-case documents.
> Aligned with ISO/IEC/IEEE 29119 (test process & documentation) and ISTQB technique definitions.

---

## 1. Test levels

| Level | What | Tooling | Owner | When |
|---|---|---|---|---|
| **L1 Unit** (white-box) | Pure functions, classes, adapters in isolation | Vitest, Rust `cargo test` | Codex (per task) | Every task |
| **L2 Component / contract** | Service + fakes; provider contract suite; RPC handlers through `RpcServer` | Vitest + msw | Codex (per task) | Every task |
| **L3 Integration** (sidecar) | Real sidecar process over NDJSON stdio, real SQLite/LanceDB in a temp dir, fake LLM providers | `apps/sidecar/test/integration` harness (spawns `tsx main.ts`) | Codex from QA test cases | End of every milestone |
| **L4 System / E2E** (black-box) | Real Tauri app window + sidecar, driven through the UI | WebdriverIO + `tauri-driver` + Edge WebDriver (matches WebView2) | Codex from QA test cases | End of every milestone with UI impact |
| **L5 Acceptance** | ROADMAP exit criteria demonstrated; manual exploratory session | QA checklist + test report | Claude (QA) + user spot-check | End of every milestone |

VS Code extension E2E uses `@vscode/test-electron` (M7+). Real-provider smoke tests (real API keys, real cost) run only on demand: `ITSTUDIO_LIVE=1 npm run test:live` — never in the default suite.

## 2. Test environment for L3/L4

- `ITSTUDIO_E2E=1` makes the composition root use: `FakeLlmProvider` scripts (from `test/fixtures/llm/*.json`), `MemorySecretStore`, fake FX/pricing HTTP, a fresh temp `ITSTUDIO_DATA_DIR`, and a temp project workspace copied from `test/fixtures/sample-project/`. No network, no keychain, no real money.
- **E2E drivers (installed by QA 2026-10-02):** `tauri-driver` in `%USERPROFILE%.cargoin`; Edge WebDriver `C:Usersadmin.itstudio-toolsmsedgedriver.exe` (154.0.4258.48 = installed WebView2). Start with `tauri-driver --native-driver <msedgedriver path>`; the wdio config reads `ITSTUDIO_MSEDGEDRIVER` (default: that path). Re-download when WebView2 updates.
- Deterministic clock option `ITSTUDIO_FAKE_NOW=<iso>` for time-dependent cases.
- Commands: `npm run test` (L1–L2), `npm run test:integration` (L3), `npm run test:e2e` (L4, builds the debug app first), `npm run test:all`.

## 3. Black-box techniques (specification-based) — used to design L3/L4/L5 cases

| Technique | Applied to (examples) |
|---|---|
| **Equivalence partitioning (EP)** | API key input (valid / empty / whitespace / > 512 chars); project path (absolute dir / relative / file / non-existent / duplicate); currency input (USD / VND) |
| **Boundary value analysis (BVA)** | Budget thresholds (49.99 %, 50 %, 80 %, 99.99 %, 100 %); `retryAfterMs` 9 999 / 10 000 / 10 001; NDJSON line 8 MiB ± 1 byte; poll interval 2 / 3 / 60 / 61 s; Facebook 24 h window ± 1 s |
| **Decision tables** | Router fallback (failure kind × autoFallback × candidates left × retries left); Budget guard (level × hardStop); email command acceptance (sender allow-listed × `[ITS]` prefix × DKIM pass) |
| **State-transition testing** | Router machine (ARCH §5.3), pipeline stages (§8.1), write transaction (§9.2), Outbox lifecycle (§17.2), SSH connection states (§18) — cover all valid transitions + every invalid transition at least once |
| **Use-case / scenario testing** | "Add key → chat → fallback → see cost in P&L"; "Run pipeline → rollback on failing test"; "Sync Gmail → triage → draft → approve → sent" |
| **Error guessing** | Sidecar killed mid-request, disk full during journal write, corrupted settings row, VS Code closed mid-run, expired OAuth token, host key changed |
| **Security (negative) testing** | XSS payload corpus in chat/markdown, path-traversal corpus for Worker/SFTP, secret leakage scans of logs and RPC output, prompt-injection emails |

## 4. White-box techniques (structure-based) — enforced at L1/L2

| Technique / metric | Target |
|---|---|
| **Statement coverage** | ≥ 70 % overall (gate), ≥ 80 % services |
| **Branch (decision) coverage** | ≥ 90 % for `domain/**`; **100 %** for safety-critical modules: `router-machine`, `cost`, `money`, budget guard, `resolveSafe`, write transaction, outbox approval, key vault |
| **Condition / MC-DC-lite** | Compound decisions in safety-critical modules: each atomic condition shown to independently change the outcome (documented in test names) |
| **Path testing** | Loops in tool loop / retry loop: 0, 1, max, max+1 iterations |
| **Data-flow / error-path** | Every `Result` error branch exercised; every `ErrorCode` produced has a test and a remediation |
| **Mutation testing** (periodic) | StrykerJS on `domain/**` once per milestone; mutation score ≥ 70 % (report only, not a gate until M6) |
| **Static analysis** | `tsc --strict`, typescript-eslint strict-type-checked, boundaries, secret scan, `cargo clippy -D warnings` (existing gates) |

## 5. Test case specification (template — `docs/qa/<Milestone>-test-cases.md`)

```markdown
| ID | Title | Level | Technique | Req. trace | Priority | Preconditions | Steps | Test data | Expected result | Auto? |
|----|-------|-------|-----------|------------|----------|---------------|-------|-----------|-----------------|-------|
| TC-M2-014 | 429 on model A falls back to B | L3 | Decision table R3 | D10, ARCH §5.3 | P1 | Ladder A,B; A scripted 429 (retry-after 30 s) | 1. chat.send … | fixture llm/429-a.json | Answer from B; router.event{fallback A→B}; 1 ledger row for B | ✔ e2e/router.spec.ts |
```

- **ID:** `TC-<milestone>-<nnn>`; **Priority:** P1 (blocker for release) / P2 / P3.
- **Req. trace:** CONTEXT decision, ARCH section, or ROADMAP exit criterion → every exit criterion must map to ≥ 1 P1 case (traceability matrix at the end of each test-case document).
- **Auto?:** path of the automated test, or `manual` with reason.

## 6. Defect report (template — appended to `docs/qa/<Milestone>-report.md`)

`BUG-<milestone>-<nnn>` · severity (S1 crash/data loss/security · S2 major function · S3 minor · S4 cosmetic) · steps to reproduce · expected vs actual · evidence (log excerpt, screenshot path) · linked TC · status (open / fixed in <task> / verified / won't fix + reason).

## 7. Milestone QA gate (entry / exit criteria)

Every milestone ends with a **`Mx-QA` task**:

1. **QA (Claude) designs** `docs/qa/Mx-test-cases.md`: black-box cases for every exit criterion and decision in scope, white-box targets for new critical modules, traceability matrix.
2. **Codex implements** the automated L3/L4 cases (and any missing L1/L2 coverage) per that document.
3. **QA executes** all levels, performs a 20-minute exploratory session, writes `docs/qa/Mx-report.md` (pass/fail per TC, coverage numbers, mutation score if run, defects, sign-off).

**Entry:** all functional tasks of the milestone are checked; `npm run test:all` green on `main`.
**Exit (milestone may be marked Done only when):** 100 % of P1 cases pass; ≥ 95 % of P2 pass; no open S1/S2 defects; coverage gates met; traceability matrix complete; report committed.
Failures → defects → fix tasks (`Mx-FIXn`) → re-test (regression of the whole milestone suite).

## 8. Regression policy

- L1–L3 run on every task QA (fast suite).
- L4 E2E suites of **all previous milestones** run at every milestone QA gate (full regression).
- A bug fix always adds a test that fails before the fix.
