# M1 — Test Case Specification (Sidecar core & IPC)

> QA gate `M1-QA` · Author: QA (Claude) · Date: 2026-10-02 · Strategy: `TESTING.md`
> Scope: M1-01…M1-07 — validators, sidecar RPC core, Rust supervisor, UI RpcClient, SQLite settings/projects, keychain secrets, status bar + API Keys page.
> Levels: **L3** = real sidecar process over stdio (`ITSTUDIO_E2E=1`, temp data dir) · **L4** = real Tauri window via WebdriverIO + tauri-driver · **L2** = component test with fakes.

## 1. Black-box test cases

### 1.1 Startup, supervision & IPC (use-case, state transition, error guessing)

| ID | Title | Level | Technique | Trace | Pri | Preconditions | Steps | Test data | Expected result | Auto? |
|---|---|---|---|---|---|---|---|---|---|---|
| TC-M1-001 | App launch reaches Ready | L4 | Use case | ARCH §2.2, M1 exit | P1 | Fresh data dir | 1. Launch app 2. Wait ≤ 15 s | — | Status bar shows `Ready v0.1.0`; no fatal banner | e2e/m1/startup.spec.ts |
| TC-M1-002 | First stdout line is `system.ready` | L3 | Spec-based | ARCH §3.1 | P1 | — | Spawn sidecar, read first line | — | Line parses as notification `system.ready` with `version` | integration/m1/startup.test.ts |
| TC-M1-003 | stdout carries protocol only | L3 | Error guessing | ARCH §3.1 | P1 | — | Run 50 mixed requests, collect stdout | — | Every stdout line is valid JSON-RPC; logs appear only on stderr / log file | integration |
| TC-M1-004 | Sidecar crash → auto-restart → UI recovers | L4 | State transition (running→restarting→ready) | ARCH §2.3, M1 exit | P1 | App Ready | Kill sidecar PID | — | Status `Restarting (1)` then `Ready`; pending calls rejected with "sidecar restarted"; subsequent `system.ping` OK | e2e |
| TC-M1-005 | Restart backoff & fatal limit | L2 (Rust) | BVA (5 vs 6 restarts in 5 min) | M1-03 | P1 | Fake timestamps | Feed 5 then 6 exits within 300 s | — | 5th restarts; 6th → fatal event with logDir | cargo test (exists) |
| TC-M1-006 | Graceful shutdown | L4 | Use case | ARCH §2.3 | P1 | App Ready | Close window | — | App exits ≤ 5 s; sidecar process gone; no restart triggered | e2e |
| TC-M1-007 | In-flight request during crash | L3 | Error guessing | M1-04 | P2 | Slow fake method | Send request, kill sidecar | — | UI client rejects with INTERNAL "sidecar restarted" within 1 s | L2 (exists) + e2e |

### 1.2 RPC protocol (EP, BVA, decision table)

| ID | Title | Level | Technique | Trace | Pri | Steps / data | Expected | Auto? |
|---|---|---|---|---|---|---|---|---|
| TC-M1-010 | Invalid JSON line | L3 | EP (invalid partition) | ARCH §3.3 | P1 | Send `{bad json` | Error `-32700`, id null; sidecar stays up | integration |
| TC-M1-011 | Invalid envelope | L3 | EP | ARCH §3.3 | P1 | `{"jsonrpc":"1.0","id":1,"method":"system.ping"}` | `-32600` | integration |
| TC-M1-012 | Unknown method | L3 | EP | ARCH §3.3 | P1 | `nope.method` | `-32601` | integration |
| TC-M1-013 | Params fail validation | L3 | EP | ARCH §3.3 | P1 | `project.create` with `name: 5` | `-32602`, `data.code = VALIDATION`, no input values echoed | integration |
| TC-M1-014 | Max line size boundary | L3 | BVA | ARCH §3.1 | P2 | Lines of 8 MiB − 1, 8 MiB, 8 MiB + 1 bytes | First two processed/rejected by method rules; > 8 MiB → `-32700`, process alive | integration |
| TC-M1-015 | Concurrent requests keep ids | L3 | Error guessing | M1-02 | P2 | 100 concurrent `system.ping` with shuffled ids | 100 responses, each id matched exactly once | integration |
| TC-M1-016 | Partial / CRLF framing | L3 | Error guessing | ARCH §3.1 | P2 | Write a request split in 3 chunks with `\r\n` | Single correct response | integration |

### 1.3 Settings & projects (EP, BVA, state persistence)

| ID | Title | Level | Technique | Trace | Pri | Steps / data | Expected | Auto? |
|---|---|---|---|---|---|---|---|---|
| TC-M1-020 | Defaults on first run | L3 | Spec-based | M1-05 | P1 | `settings.get` on empty DB | Full `AppSettings` valid against schema; ladder/roles from seeds; `ui.themeId = arctic-focus` | integration |
| TC-M1-021 | Settings persist across restart | L3 | Use case | M1-05 | P1 | Update `router.autoFallback=false` → restart sidecar → get | Value persisted | integration |
| TC-M1-022 | Invalid settings patch rejected | L3 | EP | M1-05 | P1 | `pipeline.maxFixAttempts = 2`; unknown `ui.themeId` | VALIDATION; stored settings unchanged | integration |
| TC-M1-023 | Corrupted settings row recovery | L3 | Error guessing | M1-05 | P2 | Write invalid JSON into settings row, start | Defaults restored; backup file `settings_backup_*.json` created; warning logged | integration |
| TC-M1-024 | Project path partitions | L3 | EP | M1-05 | P1 | relative path / non-existent / a file / filesystem root / valid dir / duplicate | relative → VALIDATION · missing → NOT_FOUND · file → VALIDATION · root → VALIDATION · valid → created · duplicate → CONFLICT *(oracle corrected 2026-10-02: missing path is NOT_FOUND)* | integration |
| TC-M1-025 | Set active project | L3 | Use case | M1-05 | P2 | create → `project.setActive` → `settings.get` | `activeProjectId` matches | integration |

### 1.4 Secrets / API keys (EP, BVA, security negatives)

| ID | Title | Level | Technique | Trace | Pri | Steps / data | Expected | Auto? |
|---|---|---|---|---|---|---|---|---|
| TC-M1-030 | Save key via UI, write-only | L4 | Use case | D2, M1-07 | P1 | Enter key for openai, Save | Input cleared; chip `Set ••••<last4>`; key never re-rendered | e2e |
| TC-M1-031 | Key length/charset partitions | L3 | EP + BVA | M1-06 | P1 | "" · "   " · 512 chars · 513 chars · key with space · key with `\n` | VALIDATION · VALIDATION · ok · VALIDATION · VALIDATION · VALIDATION | integration |
| TC-M1-032 | Status for all 7 providers | L3 | Spec-based | M1-06 | P2 | `secrets.status` | 7 entries, only hints, no key material | integration |
| TC-M1-033 | Verify outcomes | L3 | Decision table (200/401/500/timeout) | M1-06 | P1 | Fake HTTP per outcome | verified · PROVIDER_AUTH + remediation · PROVIDER_SERVER retryable · PROVIDER_SERVER after 10 s | integration |
| TC-M1-034 | No key leakage | L3 | Security negative | D2, ARCH §11 | P1 | Save key `sk-TEST…`, verify, error paths; grep stdout, stderr, log file, DB file | Key string absent everywhere | integration |
| TC-M1-035 | Delete key with confirmation | L4 | Use case | M1-07 | P2 | Delete → Cancel → Delete → Confirm | First keeps key; second chip `Not set` | e2e |
| TC-M1-036 | Real Credential Manager round trip | manual / opt-in | Spec-based | D2 | P2 | `ITSTUDIO_KEYCHAIN_TEST=1` | set/get/delete OK, no residue in Credential Manager | executed by QA 2026-10-02 ✔ |

### 1.5 UI accessibility & resilience

| ID | Title | Level | Technique | Pri | Expected | Auto? |
|---|---|---|---|---|---|---|
| TC-M1-040 | Keyboard-only API Keys flow | L4 | Use case | P2 | Tab order reaches every input/button; Enter saves; Escape closes confirm dialog | e2e |
| TC-M1-041 | Fatal banner | L4 | Error guessing | P2 | Force 6 crashes → blocking banner with log folder path | e2e (via env `ITSTUDIO_E2E_CRASH_ON_START=1`) |

## 2. White-box targets (L1/L2)

| Module | Required | Current (QA measured) | Action |
|---|---|---|---|
| `apps/sidecar/src/rpc/**` | ≥ 85 % lines, every error-code branch | ~95 % | none |
| `apps/sidecar/src/validation/**` | ≥ 90 % lines | 100 % | none |
| `apps/sidecar/src/services/{settings,project,secrets}-service.ts` | ≥ 80 % lines, every `Result` error path | services ~92 % | verify error paths per TC-M1-022/024/031 |
| `apps/desktop/src/rpc/rpc-client.ts` | 100 % branch (safety-critical: restart/queue/timeout) | 81.8 % branch | **gap → add cases for uncovered lines 63, 131, 196** |
| `apps/desktop/src-tauri/src/sidecar/**` | backoff/fatal/exit decisions 100 % branch | unit-tested (12 tests) | add line-codec overlong + CRLF already ✔ |
| Mutation (StrykerJS) | report only | not run | run on `apps/sidecar/src/rpc/**` at gate |

## 3. Traceability matrix (M1 exit criteria → P1 cases)

| Requirement | Test cases |
|---|---|
| UI ↔ sidecar round trip `system.ping`, `settings.get` | TC-M1-001, 002, 020 |
| Sidecar killed → auto-restart, UI recovers | TC-M1-004, 005, 007 |
| Keys stored/verified via keychain (D2) | TC-M1-030, 031, 033, 034, 036 |
| Protocol errors per ARCH §3.3 | TC-M1-010…013 |
| Settings/projects persistence | TC-M1-021, 022, 024 |

## 4. Automation hand-off (for Codex, task `M1-QA`)

Implement: (1) `apps/sidecar/test/integration/` harness + all `integration` cases; (2) E2E harness (WebdriverIO + tauri-driver, Edge WebDriver auto-matched to installed WebView2) + all `e2e` cases; (3) `ITSTUDIO_E2E` composition-root switch (fakes) and `ITSTUDIO_E2E_CRASH_ON_START`; (4) missing branch tests for `rpc-client.ts`; (5) scripts `test:integration`, `test:e2e`, `test:all`. Test names must start with the TC id.
