# HANDOFF — read this first if you are a new AI / engineer picking up IT Studio

> Last updated: 2026-10-04 by the Architect / QA agent (Claude). Keep this file current when you stop.
> It complements — does not replace — `CONTEXT.md` (product + decisions), `ARCHITECTURE.md`, `ROADMAP.md` (task checklist), `CONVENTIONS.md`, `TESTING.md`, `ROLES.md`, `AGENTS.md` (implementer rules) and `docs/RUNNING.md` (run / build / install).

## 1. Where the project stands

| Area | Status |
|---|---|
| **v1 core** M0–M7 (sidecar, router, cost/P&L, UI, RAG, pipeline, VS Code companion) | Done. QA reports `docs/qa/M3…M7-report.md` (M4/M5/M6 conditional: some E2E cases in backlog `QA-E2E-FIX4`). |
| **SEC-01** dependency audit | Done — `npm run audit:prod` = 0 vulnerabilities (overrides for `sharp`, `dompurify`). |
| **PERF-01** startup | Done — dev sidecar 2.8 s, packaged sidecar ~0.6 s warm; main JS chunk < 700 kB. |
| **M9** packaging | Done except **M9-QA**: SEA sidecar (`npm run build:sidecar`), NSIS + MSI (`npm run build:app`), install smoke 7/7 (`npm run smoke:install`), version bump (`npm run release:bump`). Unsigned by decision **D33** (single user). |
| **M8** image generation | Features done (DALL·E 3, FLUX Together/Replicate, `generate_image` tool, chat images, Gallery, Settings → Images; **off by default**). **M8-QA** in progress (see §4). |
| **MW** Workflow map (D32) | MW-00…MW-03 done (Workflow tab: module graph, live activity, module panel). **MW-04** (extra events + selecting deep links) and **MW-QA** in progress (see §4). |
| **v2** M10–M14 (agents, memory, channels, Gmail, Facebook) | Not started — specified in ARCHITECTURE Part II, ADR-0003, schemas §14–§16, ROADMAP. |
| **v3** M15–M19 (agentless server management over SSH) | Not started — ARCHITECTURE Part III, ADR-0004, schemas §17, ROADMAP. |

`ROADMAP.md` is the source of truth for task status (`- [x]` done). Every implemented task has a work order + result + QA verdict in `docs/tasks/<ID>.md`; milestone QA specs and reports are in `docs/qa/`.

## 2. Roles and workflow (how work is done here)

- **Architect / PM / QA** (an AI like Claude): writes specs (`docs/tasks/<ID>.md`), contracts (`src/types/schemas.ts`, additive only), docs, decisions; runs QA; lands work. Does **not** write feature code — delegates it.
- **Implementer** (Codex CLI) follows `AGENTS.md`. Drive it with:
  ```bash
  scripts/dev/run-task.sh <ID> ["extra instruction"]          # worktree C:/Users/admin/itstudio-wt/<ID>, branch task/<ID>
  CODEX_EFFORT=medium scripts/dev/run-task.sh <ID>            # cheaper for test-only / small tasks
  scripts/dev/land-task.sh <ID> "type(scope): subject [<ID>]"  # commit, merge --no-ff into main, remove worktree
  ```
  Run each Codex job as its own tracked background job; up to ~4 in parallel on disjoint scopes. Fix rounds: append `## QA (Claude) — round N` with the **exact error** to the task file, then `run-task.sh <ID> "This is FIX ROUND N …"`.
- **Codex sandbox limits** (do the step yourself outside the sandbox): it cannot spawn the sidecar with `tsx` (`uv_os_get_passwd ENOMEM`), cannot run esbuild (access denied), cannot download crates, and must not open GUI windows. So QA always re-runs integration, builds and E2E outside the sandbox.
- **Things only the Architect does:** pre-install dependencies (npm / cargo) before a task needs them; generate Drizzle migrations (`npm run db:generate -w @itstudio/sidecar`, never hand-written); resolve merge conflicts (usually both sides additive: `container.ts`, `AppShell.tsx`, `MainNav.tsx`, `i18n/*.json`, `e2e/wdio.conf.ts`).

## 3. Working rules agreed with the owner (important — not in the code)

1. **Talk to the owner in Vietnamese**; every file in the repo is written in **English**.
2. **Delegate to Codex** — the Architect specifies, coordinates and verifies; does not hand-edit product / test code (trivial merge fixes excepted).
3. **Lean QA:** typecheck + lint + unit once; integration **once** (second run only on failure); coverage only for gated modules; E2E only for the affected specs.
4. **6-attempt rule:** if the same error survives 6 fix attempts, skip it, record it in the report / ROADMAP backlog, and move on (or stop the session if blocked).
5. **GUI is allowed** (since 2026-10-04): E2E and app / VS Code windows may be opened without asking; stop immediately if the owner says "stop". VS Code: always open a **new** window, never touch the owner's existing windows.
6. **Ask the owner only for real decisions** (product scope, money, credentials). Record decisions in `CONTEXT.md` §decisions (latest D33).
7. **Never** commit secrets; the owner's API keys live only in Windows Credential Manager via the app.

## 4. In flight at the time of writing (finish these first)

| Task | Where | State / next step |
|---|---|---|
| **M8-QA** | worktree `itstudio-wt/M8-QA` | Codex done; QA merged main (resolved `e2e/wdio.conf.ts`), typecheck / lint / 860 unit / integration 111 ✔. **Next:** run `e2e/specs/m8/images.spec.ts`, write `docs/qa/M8-report.md`, land, tick M8-QA. |
| **MW-04** | worktree `itstudio-wt/MW-04` | Codex done (internal events for retriever / commands / VS Code / images / embeddings; deep-link selection intents). **Next:** commit, merge main, gates + integration + `e2e/specs/mw/workflow.spec.ts`, land. Note: image activity is mapped to the Chat node (no image node in the topology) — acceptable or add a node in a follow-up. |
| **MW-QA** | not started | Write `docs/qa/MW-test-cases.md` per ROADMAP MW-QA, automate via Codex, report. |
| **M9-QA** | not started | Write `docs/qa/M9-test-cases.md` (build:sidecar, smoke:sidecar, build:app, smoke:install, release:bump dry-run, audit:prod) and a report; mostly re-running existing scripts. |

## 5. Backlog / follow-ups (not blocking)

- `QA-E2E-FIX4`: remaining flaky / setup-dependent E2E cases (list in ROADMAP); approach: per-spec fresh app + data dir, DOM snapshot + screenshot on failure.
- `QA-TOOL-01`: StrykerJS 10 × Vitest 5 reports 0 % — make mutation testing work.
- Pricing: clearing a manual override after a restart falls back to the seed price (repository keeps only the latest table).
- `scripts/dev/measure-startup.mjs` exits early (no stdin pipe) — use `npm run smoke:sidecar` for timing.
- Workflow deep links: verify they select the item after MW-04 lands.
- Auto-update key pair (M9-04 remainder) only if auto-update is wanted.

## 6. Environment facts that cost time to rediscover

- Windows 11 Home (no Windows Sandbox / Hyper-V). Repo path contains spaces: `C:\Users\admin\Desktop\File All\Demo project\Project\IT Studio`.
- E2E: `npm run test:e2e` (WebdriverIO + tauri-driver + msedgedriver at `C:\Users\admin\.itstudio-tools\msedgedriver.exe`, native ports 4454/4455). Run a subset with `npx wdio run e2e/wdio.conf.ts --spec <file>`.
- VS Code E2E: `npm run test:vscode-e2e`; must run **without** `ELECTRON_RUN_AS_NODE` (set automatically when launched from a VS Code terminal — the runner now strips it).
- Release builds ignore `ITSTUDIO_DATA_DIR` (debug-only); app data is `%APPDATA%\com.itstudio.app`. Release-only Tauri settings live in `apps/desktop/src-tauri/tauri.conf.release.json`.
- LanceDB's native binary is ~317 MB — installers: NSIS ~93 MB, MSI ~147 MB.
- `npm test` also runs `node --test scripts/release/*.test.mjs scripts/build/*.test.mjs`.
