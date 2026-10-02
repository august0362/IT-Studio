# M4 — Test Case Specification (desktop UI: shell, themes, chat, cost, settings)

> QA gate `M4-QA` · Author: QA (Claude) · 2026-10-02 · Strategy: `TESTING.md`
> Scope: M4-01, M4-01b, M4-02…M4-05 and the UI parts of M5-07 / M6-07 that live in the shell. Levels: **L2** component tests (Testing Library, fake RPC client) · **L4** real app via WebdriverIO + tauri-driver (`ITSTUDIO_E2E=1`, in-memory secrets, scripted LLM, temp data dir) — **executed only in the batched E2E session with the user's permission** (opens app windows).
> Status: **exists** / **new**.

## 1. Black-box cases

### 1.1 Shell, projects, i18n

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-010 | Create project → tab selected | | L4 | P1 | exists |
| TC-M4-011 | vi locale persists after reload | | L4 | P1 | exists |
| TC-M4-012 | Open 3 projects, switch, close middle tab | active tab moves to neighbour; "All projects" always present; closed project not deleted | L4 | P1 | new |
| TC-M4-013 | Every visible string translated | no raw i18n keys (`x.y.z`) in en or vi on any tab (DOM scan) | L4 | P2 | new |
| TC-M4-014 | i18n key parity | en.json and vi.json have identical key sets; no unused keys (e.g. `cost.budgetContractUnavailable`) | L1 | P2 | new |

### 1.2 Themes (D-THEMES)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-001 | Theme change persists across restart | | L4 | P1 | exists |
| TC-M4-002 | 36 theme/mode pairs | every pair applies without console errors; WCAG contrast test (unit) green | L1+L4 smoke | P1 | exists (unit) — add L4 smoke loop |
| TC-M4-003 | System mode follows OS | `prefers-color-scheme` change → mode updates without reload | L2 | P2 | exists — verify |
| TC-M4-004 | No raw colours | ESLint rule test (currently slow under coverage — set an explicit 60 s timeout) | L1 | P2 | exists — **fix flaky timeout** |

### 1.3 Chat (M4-04)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-020 | Send → scripted reply + Money line | | L4 | P1 | exists |
| TC-M4-021 | Stop while streaming | `chat.cancel`, bubble shows cancelled, no assistant message persisted | L4 | P1 | new (scripted slow stream) |
| TC-M4-022 | Fallback badge | script A → 503, B → ok → badge "Answered by B (fallback from A …)" | L4 | P1 | new (needs per-model script env in wdio driver) |
| TC-M4-023 | Fallback modal (Auto OFF) | modal lists candidate with `<Money>` estimate, *Use* → answer from B; Esc = cancel | L4 | P1 | new |
| TC-M4-024 | XSS corpus in assistant reply | every corpus string rendered inert (no script execution, no `javascript:` links) | L2 | P1 | exists — verify against the full corpus |
| TC-M4-025 | Keyboard-only chat | Tab order reaches conversation list, model picker, composer, send; Enter sends, Shift+Enter newline | L4 | P2 | new |

### 1.4 Cost & P&L (M4-05)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-030 | Add revenue → KPI | | L4 | P1 | exists |
| TC-M4-031 | Budget edit `"12.5"` USD | bar shows limit; invalid `"1e3"` → sidecar error shown | L4 | P1 | new |
| TC-M4-032 | All projects dashboard | two projects, per-project margin table ordered worst first; totals = sum | L4 | P1 | new |
| TC-M4-033 | Live refresh | send a chat in another tab → Cost tab updates within ~1 s debounce | L4 | P2 | new |
| TC-M4-034 | No client-side money formatting | static check: no `toFixed`/`Intl.NumberFormat` on money values in `features/**` (percentages allowed) | L1 | P2 | new |

### 1.5 Settings (M4-03)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-040 | Auto Fallback persists after reload | | L4 | P1 | exists |
| TC-M4-041 | Ladder reorder by keyboard | Space, ArrowDown, Space → order saved; screen-reader announcement text present | L4 | P1 | new |
| TC-M4-042 | Hard Stop toggle | ON → chat beyond budget fails `BUDGET_HARD_STOP` with remediation | L4 | P1 | new |
| TC-M4-043 | Price override dialog | `"0.15"` saved → row shows `$0.15`; invalid → error | L4 | P2 | new |
| TC-M4-044 | Update prices without active project | button disabled with D31 message | L4 | P2 | new |
| TC-M4-045 | FX override + clear | rate shown; Money VND lines change after override | L4 | P2 | new |
| TC-M4-046 | API keys write-only | key never re-displayed; only hint `••••1234` | L4 | P1 | exists (TC-M1-030) |

### 1.6 Cross-tab (UI parts of M5/M6)

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M4-050 | Code tab loads lazily | first visit shows loading state, then the page; Monaco from local assets (no network request to a CDN) | L4 | P1 | new |
| TC-M4-051 | Tab switching during a running pipeline / ingest | no lost events: returning to the tab shows the current stage / progress | L4 | P2 | new |

## 2. White-box targets

| Module | Gate | Action |
|---|---|---|
| `features/chat/chat-store.ts`, `features/code/pipeline-store.ts`, `features/knowledge/ingest-store.ts`, `features/cost/date-range.ts` | 100 % | keep (measured 100 %) |
| `components/SafeMarkdown.tsx` | 100 % | measure; XSS corpus |
| `rpc/rpc-client.ts` | ≥ 90 % | measure |
| Desktop overall | ≥ 80 % lines | measure and report |
| Performance | main JS chunk < 1.5 MB (now 1.13 MB) | keep; lazy-load Cost tab under PERF-01 |

## 3. Traceability

| Requirement | Cases |
|---|---|
| D8 USD/VND display | TC-M4-020, 030, 034, 045 |
| D10 Auto Fallback / modal / lock | TC-M4-022, 023, 040, 041 |
| D7 Hard Stop | TC-M4-042 |
| D9 manual pricing, D31 | TC-M4-043, 044 |
| D13 multi-project, portfolio | TC-M4-012, 032 |
| Themes (THEMES.md) | TC-M4-001…004 |
| Security (XSS, write-only keys) | TC-M4-024, 046 |
| Accessibility (keyboard) | TC-M4-025, 041 |

## 4. Exploratory charter (20 min, QA, in the E2E session)
Resize the window to 1024×700, switch themes on every tab, use only the keyboard for a full chat → cost → settings round, toggle vi/en mid-stream, open many conversations; look for clipped layouts, unreadable contrast, focus traps, stale data after tab switches.
