# M7 — Test Case Specification (VS Code bridge, companion extension, launcher)

> QA gate `M7-QA` · Author: QA (Claude) · 2026-10-02 · Strategy: `TESTING.md`
> Scope: M7-01…M7-05. Levels: **L1/L2** unit (extension logic with fake `EditorPort`, launcher with fake runner) · **L3** real sidecar + real WebSocket client acting as the extension (no VS Code) · **L4** `@vscode/test-electron` (downloads a VS Code build and **opens a window**) + manual check on the user's VS Code — both in the batched E2E session, with the user's permission.
> Status: **exists** / **new**.

## 1. Black-box cases

### 1.1 Handshake & security (L3, fake extension client)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M7-001 | Session file + handshake | `.itstudio/session.json` written, hello → welcome, `vscode.status{connected:true}` | L3 | P1 | exists |
| TC-M7-002 | Wrong token | socket closed, no welcome, status stays disconnected; constant-time compare (unit) | L3 | P1 | new |
| TC-M7-003 | `Origin` header present (browser page) | rejected before handshake | L3 | P1 | new |
| TC-M7-004 | Protocol version mismatch | closed with a clear reason | L3 | P2 | new |
| TC-M7-005 | No hello within timeout | closed after the timeout | L2 | P2 | exists (unit) — verify |
| TC-M7-006 | Bridge binds loopback only | listening address is `127.0.0.1`, never `0.0.0.0` | L3 | P1 | new |
| TC-M7-007 | Token rotates per sidecar session | restart sidecar → new token, old token rejected | L3 | P2 | new |
| TC-M7-008 | `.itstudio/` git-ignored | project with existing `.gitignore` gets `.itstudio/` appended once (idempotent) | L2 | P2 | exists — verify |

### 1.2 Actions (L2 with fake EditorPort; L4 visual)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M7-010 | `reveal` | opens file at line; ack | L2 | P1 | exists |
| TC-M7-011 | `show_diff` | virtual before/after docs, diff opened; LRU max 20 | L2 | P1 | exists |
| TC-M7-012 | `transaction committed` / `rolled_back` | decorations applied / cleared + warning | L2 | P1 | exists |
| TC-M7-013 | Path attacks from sidecar | absolute, `..`, escaping root → ack without action, logged | L2 | P1 | exists — verify all three |
| TC-M7-014 | `request_diagnostics` | workspace-relative paths, 1-based lines, severity mapping | L2 | P1 | exists |

### 1.3 Diagnostics push & user-save conflict

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M7-020 | Debounce 500 ms, cap 500 (errors first) | one snapshot per burst; ordering | L2 | P1 | exists |
| TC-M7-021 | Disconnected → nothing sent | | L2 | P1 | exists |
| TC-M7-022 | Save filtering | `.itstudio/`, `node_modules/`, `.git/` ignored; own write within 2 s ignored, at 2 001 ms reported | L2 | P1 | exists — add the 2 000 / 2 001 ms BVA |
| TC-M7-023 | Sidecar validates inbound messages | malformed `diagnostics` / `file_saved_by_user` dropped, no crash | L3 | P1 | new |

### 1.4 Resilience

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M7-030 | VS Code closes mid-pipeline | pipeline continues and completes; status `connected:false` | L3 | P1 | new (fake client disconnects during VALIDATING) |
| TC-M7-031 | Reconnect | client reconnects with the same session file → connected again | L3 | P2 | new |
| TC-M7-032 | Sidecar stops (stdin EOF) with client connected | socket closed 1001, sidecar exits ≤ 3 s (BUG-M7-001 regression) | L3 | P1 | exists (TC-M1-020) — add connected-client variant |

### 1.5 Launcher & installer

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M7-040 | Real `code.cmd` parsing | VS Code 1.140 file with ` %*` | L1 | P1 | exists (fix round) |
| TC-M7-041 | Resolution order | setting > PATH > default dirs; none → status `installed:false`, activation not failed | L2 | P1 | exists — verify |
| TC-M7-042 | Install when missing / outdated, skip when same version | | L2 | P1 | exists |
| TC-M7-043 | Spawn safety | `shell:false`, args array, env allow-list + `ELECTRON_RUN_AS_NODE` only on Windows, no free-form executable accepted by `ICodeCliRunner` | L2 | P1 | exists — verify |
| TC-M7-044 | autoLaunch off | no launch, still installs nothing | L2 | P2 | exists — verify |
| TC-M7-045 | vsix build | `npm run package -w itstudio-vscode` produces a vsix with only `extension.js` + `package.json` | L3 (script) | P2 | QA manual (done 2026-10-02) |

### 1.6 L4 — batched E2E session (needs the user's permission; opens windows)

| ID | Case | Expected | Pri | Status |
|---|---|---|---|---|
| TC-M7-050 | `@vscode/test-electron`: extension activates on `workspaceContains:.itstudio/session.json`, connects to a test sidecar, receives `reveal` → editor shows file | P1 | new |
| TC-M7-051 | `@vscode/test-electron`: pipeline commit → changed file revealed + decorated; rollback → decorations cleared | P2 | new |
| TC-M7-052 | **Manual on the user's VS Code:** activate a project in IT Studio → extension installed from vsix, VS Code opens the folder, status bar shows "IT Studio: connected" | P1 | QA manual |

## 2. White-box targets

| Module | Gate | Action |
|---|---|---|
| `apps/vscode-ext/src/actions.ts` | ≥ 90 % | measured 92.3 % — keep |
| `apps/vscode-ext/src/{bridge,diagnostics-push,save-watcher,session}.ts` | ≥ 90 % | measure; add tests where below |
| `apps/sidecar/src/services/vscode-bridge.ts` | ≥ 90 % (security boundary) | measure; add TC-M7-002…007 |
| `apps/sidecar/src/domain/code-cli.ts` | 100 % | keep |
| `apps/sidecar/src/services/vscode-launcher.ts` | ≥ 90 % | keep |

## 3. Traceability

| Requirement | Cases |
|---|---|
| D3 VS Code companion, auto | TC-M7-001, 040…045, 052 |
| ARCH §10.1 token, Origin, loopback | TC-M7-002…007 |
| ARCH §10.2 behaviour | TC-M7-010…023, 050, 051 |
| ARCH §11 path safety in extension | TC-M7-013 |
| Resilience (VS Code optional, never fails pipeline) | TC-M7-030…032 |

## 4. Exploratory charter (20 min, QA, in the E2E session)
Open two IT Studio projects and switch while VS Code is connected, save files rapidly during VALIDATING, close/reopen VS Code, start IT Studio with VS Code already open on the folder; look for stale sessions, wrong project focus, duplicate windows.
