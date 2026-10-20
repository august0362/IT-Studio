# 05 — CI and repository governance

## 1. Before this pass (checked 2026-10-20)

- No `.github/` directory: no GitHub Actions, no PR checks.
- `main` unprotected: `GET https://api.github.com/repos/august0362/IT-Studio/branches/main` → `"protected": false`
  (anonymous request; the repository is public).
- `gh` CLI 2.102.0 installed but **not logged in**; `git push` works through Git Credential Manager (used only to
  push the `stabilization/v1-hardening` branch — nothing was pushed to `main`).

## 2. CI workflow — `.github/workflows/ci.yml`

Triggers: every pull request, every push to any branch, manual dispatch. `permissions: contents: read`; no secrets
used or needed (all tests use fake providers). Concurrency cancels superseded runs of the same ref. Runner
`windows-latest` (the app and the SEA sidecar are Windows-only), Node pinned to `24.19.0`, npm cache via
`actions/setup-node`, dependencies from the lockfile (`npm ci`).

| Job (= required check name) | Steps | Typical time |
|---|---|---|
| `Typecheck, lint, format, secret scan` | `npm run typecheck`; `eslint . --max-warnings 0`; `prettier --check .`; `node scripts/scan-secrets.mjs`; `npm run lint:selftest` | ~5 min |
| `Unit tests` | `npm test` (vitest sidecar/desktop/vscode-ext + node script tests) | ~4 min |
| `Integration tests` | `npm run test:integration` (real sidecar over stdio, real SQLite/LanceDB/Git in temp folders, fake providers) | ~19 min |
| `Build and sidecar smoke` | desktop `vite build`; VS Code extension build; `npm run build:sidecar` (SEA); `npm run smoke:sidecar` | ~2 min |

Not in CI (deliberately): Tauri release build and installer smoke (`build:app`, `smoke:install` — long Rust builds),
E2E (needs Edge WebDriver matching WebView2 and an interactive desktop), real-provider smoke (`ITSTUDIO_LIVE=1`,
costs money). They stay manual release-gate steps (`../../RUNNING.md`, `../../TESTING.md`).

Actions are pinned to major tags (`actions/checkout@v5`, `actions/setup-node@v5`); pinning to commit SHAs is a
follow-up (OBS-04).

## 3. What CI found

| Run | Commit | Outcome | Finding |
|---|---|---|---|
| `39451656683` | `ec27caa` | unit ✗, integration ✗, static ✓, build ✓ | Real defect STAB-D08: the runner's `TEMP` is an 8.3 short path (`C:\Users\RUNNER~1\…`); orchestration refused valid projects and Knowledge indexed nothing. Fixed in `2c63e6b`. |
| `39470943728` | `2c63e6b` | static ✓, build ✓, unit ✗, integration ✗ | Unit: one desktop test (`WorkflowPage` M9-OBS-05) timed out in `findByLabelText` after Testing Library's 1 s default on the loaded runner (it passed in the first run) → `asyncUtilTimeout` raised to 5 s in `apps/desktop/src/test-setup.ts`. Integration: all orchestration and Knowledge cases now pass; only **BRK-C12** (ping p95 320 ms vs a fixed 200 ms budget) and **BRK-D07** (sidecar still starts on a data directory made read-only with `icacls` — the runner account is an elevated administrator) failed → machine-sensitive split, §4. |

## 4. Machine-sensitive cases and final CI status

`vitest.integration.config.ts` names two cases whose result depends on the machine rather than the code:

| Case | Why it is machine-sensitive | Where it runs |
|---|---|---|
| BRK-C12 | Absolute latency budget (ping p95 < 200 ms during a query burst); hosted runners measure ~320 ms; it also failed locally under load at baseline | CI job `Integration (machine-sensitive, non-blocking)` (`continue-on-error`), every local full run |
| BRK-D07 | Expects startup to fail on a read-only data directory; `icacls` RX-only does not stop the elevated runner account | same |

The required `Integration tests` job runs every other integration case (`ITSTUDIO_INTEGRATION_SELECTION=stable`);
no test was deleted or weakened. Follow-ups: express BRK-C12 relative to a measured baseline; make BRK-D07 deny write
explicitly (deny ACE) or skip it with a reason when the process token is elevated.

Final run: _filled in below._

## 5. Branch protection — status: **NOT ACTIVE (blocked on permissions)**

Not configured: this session has no authenticated GitHub API access (`gh auth status` → not logged in), and
protection settings require repository admin rights. Nothing was claimed or simulated; verification of an actual
rejection of a direct push to `main` was therefore not possible.

Ready-to-apply ruleset: `.github/rulesets/main-protection.json` — targets the default branch; blocks deletion and
force pushes; requires a pull request (stale approvals dismissed on push, review threads resolved); requires the
four CI checks above with the branch up to date; **no bypass actors** (including automation).

`required_approving_review_count` is `0` on purpose: the repository has a single maintainer and GitHub does not let an
author approve their own pull request, so `1` would block every merge (or force a bypass). Set it to `1` as soon as a
second reviewer exists.

**Smallest owner action** (either one):

1. In a terminal: `gh auth login` (GitHub.com, HTTPS, browser login, account with admin on `august0362/IT-Studio`).
   Then ask Claude to continue: it will run
   `gh api -X POST repos/august0362/IT-Studio/rulesets --input .github/rulesets/main-protection.json`, read the
   ruleset back, and verify with a throw-away branch that a direct push to `main` is rejected (no owner work touched).
2. Or in the browser: *Settings → Rules → Rulesets → New ruleset → Import a ruleset* → choose
   `.github/rulesets/main-protection.json` → *Create*.

Until then `main` accepts direct pushes; the stabilization work is only on `stabilization/v1-hardening`.
