# V1-QA — Final v1 gate (2026-10-15)

Verdict: **PASS — ready for owner acceptance** (`docs/qa/V1-owner-checklist.md`).

## Build under test

| Item | Value |
|---|---|
| Commit | `50cbd1a` (main, after REPO-01) + docs-only commits |
| NSIS installer | `apps/desktop/src-tauri/target/release/bundle/nsis/IT Studio_0.1.0_x64-setup.exe` — 93 375 129 bytes |
| SHA-256 (NSIS) | `c692db41b95ba88024044e380c331cc14059cbe20bcda5bec389d5c2226fb15f` |
| MSI | `apps/desktop/src-tauri/target/release/bundle/msi/IT Studio_0.1.0_x64_en-US.msi` — 147 939 904 bytes |
| Start from source | `Start-IT-Studio.bat` (root) |

## Automated results (run with no Codex job active)

| Gate | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | pass |
| `npm test` (unit + build/release node tests) | 1 277 passed, 1 skipped, **0 expected failures left** |
| Integration (`vitest.integration.config.ts`, all 23 files incl. adversarial suites) | 162 passed, 1 skipped |
| E2E (`npm run test:e2e`, 14 spec files) | 14 / 14 passed (after rebuilding the stale debug exe — see below) |
| `npm run build:app` | NSIS + MSI built; no tracked icon file modified |
| `npm run smoke:sidecar` | cold 3 785 ms, measured median **475 ms** (< 1 500 ms) |
| `npm run smoke:install` | 7 / 7 checks pass (silent install, bundled self-contained sidecar, ready < 30 s, graceful exit, clean uninstall) |
| Pipeline Studio visual check | Mock-harness screenshots (Edge 1280×800 and 1600×900): layout, ✓/✕/? badges, panels, glow — accepted after QA rounds 1–3 of PSTUDIO-02 |

## Scope covered since M9 sign-off

PSTUDIO-01, PSTUDIO-FIX1, PSTUDIO-02, QA-BREAK-01, QA-BREAK-02, UX-02, V1-POLISH-01, QA-BREAK-FIX-A (D01, D02, D04–D09, FLAKE-3), QA-BREAK-FIX-B (D01–D04, FLAKE-1/2), REPO-01.

## Findings during V1-QA

| ID | Severity | Finding | Status |
|---|---|---|---|
| V1QA-01 | S3 (tooling) | E2E reuses `target/debug/itstudio-desktop.exe` when it exists, so a stale frontend produced 12/14 false failures. | Worked around (exe deleted, rebuilt). Follow-up: make `e2e/wdio.conf.ts` rebuild when `apps/desktop/src` or `src-tauri` is newer than the exe. |
| V1QA-02 | S4 (tooling) | Gates run while a Codex job runs time out randomly (CPU contention). | Mitigated by REPO-01 unit timeouts; process rule recorded in `docs/HANDOFF.md` §4. |

## Not covered by automation (owner checklist)

Real provider keys and answers, real image providers, embedded web-chat sign-in, VS Code auto-launch with a real install, visual review of all 21 themes, killing the sidecar by hand during a write.

## Addendum — PROV-01 rebuild (2026-10-15 23:40)

PROV-01 (DeepSeek, OpenRouter, Qwen, Mistral) landed at `caadd00`. Lean QA (owner request): typecheck, lint, unit 1 386 pass; integration `secrets`, `router`, `settings-projects`, `startup` 30/30; repo-layout 4/4; `build:app` OK; `smoke:sidecar` median 477 ms. New NSIS SHA-256: `c51491d4e2cc763eb1bff8cba4d1a8b5a64e83022f9b1bdeeddd04c738f7d395` (93 412 320 bytes). Full E2E / install smoke not re-run for this provider-only change.

## Addendum — owner feedback build (2026-10-16 01:33)

Landed: OWNER-FB2-A/B, UX-03, PROC-01 (+PROC-01T), PROC-02. Lean QA: typecheck, lint, unit 1 519 pass; targeted integration (router, chat, settings-projects, processes, pipeline, rag-ingest, startup) pass after fixture fixes; `smoke:sidecar` median 477 ms; `smoke:install` 7/7. NSIS SHA-256 `c97d23758041879536be9fdbd2c8eb1c9c5762f4350566c89a67711522715a1b` (93 456 372 bytes). The MSI step of `build:app` failed with `timeout: global` (bundler download); NSIS is the owner's installer. E2E not yet re-run after the navigation change (UX-03) — scheduled next.
