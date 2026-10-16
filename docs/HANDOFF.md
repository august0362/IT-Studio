# HANDOFF — read this first if you are a new AI / engineer continuing IT Studio

> Last updated: **2026-10-14** by the Architect / QA agent (Claude) during v1 hardening.
> Keep this file current whenever you stop. It complements — does not replace — the binding documents:
>
> | Document | What it is |
> |---|---|
> | `CONTEXT.md` | Product, glossary, **decisions D1–D34**. Wins over every other document. |
> | `ARCHITECTURE.md` | Part I (v1), §13.1 Workflow map, Part II (v2 orchestration hub), Part III (v3 servers). |
> | `src/types/schemas.ts` | All shared contracts (`@itstudio/schemas`). Additive changes only. |
> | `ROADMAP.md` | Task checklist — **source of truth for status** (`- [x]` = done and QA-passed). |
> | `ROLES.md`, `AGENTS.md` | Dev roles; rules for the implementer (Codex). |
> | `CONVENTIONS.md`, `TESTING.md` | Coding rules + review checklist; test levels L1–L4, QA gate procedure. |
> | `docs/RUNNING.md` | How to run, build, install and release the app (owner-facing). |
> | `docs/tasks/<ID>.md` | One work order per task, with Codex `## Result` and QA verdict sections. |
> | `docs/qa/Mx-test-cases.md`, `docs/qa/Mx-report.md` | Milestone QA specs and sign-off reports. |
> | `docs/decisions/ADR-000x-*.md` | ADR-0001 foundations, 0002 toolchain pins, 0003 v2, 0004 v3, 0005 owner-feedback desktop integration. |
> | `docs/specs/v2-requirements.md`, `docs/specs/v3-requirements.md` | v2 / v3 software requirements specifications (ISO/IEC/IEEE 29148 structure). |
> | `docs/plans/v2-v3-delivery-plan.md` | v2 / v3 WBS, dependencies, estimates, risks, gates. |
> | `docs/reports/overnight-2026-10-02.md` | Environment findings (ENV-1 … : sandbox limits). |

---

## 0. TL;DR for the next agent

1. Read §3 (owner rules) and §2 (how work is done) — they are not written anywhere else.
2. v1 is feature-complete, M1–M9 gates are signed off and **v1 hardening is done** (§4, V1-QA 2026-10-15). The owner is testing the build with `docs/qa/V1-owner-checklist.md`.
3. Next, only after the owner's verdict: **MOD-01/02** (sidecar feature modules, D37) → **LLMPOOL-01/02** (key pool, D36) → ask before v2 (M10).
4. Talk to the owner in **Vietnamese**; write repo files in **English**, except documents the owner personally uses (e.g. the owner checklist), which are Vietnamese.
5. Project documents live in `docs/` since REPO-01; `AGENTS.md` and `CHANGELOG.md` stay at the root.

---

## 1. Status per milestone (2026-10-14)

| Milestone | Tasks done | Status | Notes |
|---|---|---|---|
| M0 env / scaffold | 8/8 | ✅ | |
| M1 sidecar + JSON-RPC | 8/8 | ✅ signed off | |
| M2 router + fallback | 11/11 | ✅ signed off | |
| M3 ledger / pricing / P&L | 8/8 | ✅ signed off | |
| M4 chat UI | 8/8 | ✅ | L4 regression reverified in `QA-E2E-FIX4` |
| M5 RAG | 8/8 | ✅ | L4 regression reverified in `QA-E2E-FIX4` |
| M6 pipeline + worker writes | 9/9 | ✅ | L4 regression reverified in `QA-E2E-FIX4` |
| M7 VS Code companion | 6/6 | ✅ signed off | |
| **MW** Workflow map (D32) | 6/6 | ✅ | exploratory follow-up open |
| **WC** Web chat (D34) | 1/1 | ✅ | |
| **M8** image generation | 6/6 | ✅ | exploratory follow-up open |
| **M9** packaging | 7/7 | ✅ signed off 2026-10-14 | `` |
| **OWNER-FB1** owner feedback | 5/5 packages | ✅ landed 2026-10-14 | native web-chat / theme follow-ups open |
| **V1 hardening** | 2/6 | 🟡 in progress | §4 |
| **v2** M10–M14 (+ REL-V2) | 0/46 | ⏸ not started | SRS, plan and all 46 task files written (see §7) |
| **v3** M15–M19 (+ REL-V3) | 0/37 | ⏸ not started | SRS, plan and all 37 task files written (see §7) |

Numbers on `main` after OWNER-FB1 (2026-10-14): 1 041 unit tests (1 skipped), 115 integration tests, 28 Rust tests, 14 E2E specs. M9 artifacts: SEA sidecar 96 MB, NSIS 93 MB, MSI 148 MB; install smoke 7/7; coverage 85.55 % statements; domain mutation score 77.53 %.

---

## 2. How work is done (process)

### 2.1 Roles
- **Architect / PM / QA** (Claude): decides, writes specs (`docs/tasks/<ID>.md`), contracts (`src/types/schemas.ts`, additive only), docs and decisions; pre-installs dependencies; triages test failures (test defect vs product defect); runs the gates that the Codex sandbox cannot run; resolves merge conflicts; lands work. Does **not** write feature or test code (owner instruction, re-confirmed 2026-10-14: "dùng codex làm agent thực thi, bạn đưa ra quyết định").
- **Implementer** (Codex CLI, following `AGENTS.md`): writes all code and tests within the task Scope.
- History: on 2026-10-04 the owner temporarily let Codex act as lead for OWNER-FB1 and M9-QA. That arrangement ended when OWNER-FB1 landed; `AGENTS.md` and `CONTEXT.md` keep the split above.

### 2.2 Task lifecycle

1. **Write the spec.** Create `docs/tasks/<ID>.md` using the existing files as templates. Sections, in order: header, Read first, Scope (exact paths), Requirements, Tests, Acceptance criteria, Hand-back. Mark it **"Deps pre-installed"** when you have installed the packages yourself.
2. **Commit the spec on `main`.** `run-task.sh` refuses to run on an uncommitted task file.
3. **Run Codex** as a tracked background job (never detached):
   ```bash
   scripts/dev/run-task.sh <ID> ["extra instruction"]   # creates worktree C:/Users/admin/itstudio-wt/<ID>, branch task/<ID>
   CODEX_EFFORT=medium scripts/dev/run-task.sh <ID>     # cheaper; for test-only or small tasks
   ```
   - Logs go to `$TEMP/itstudio-codex/<ID>.log` and `<ID>.last.txt`.
   - Run at most 2 Implementer jobs in parallel, with **disjoint scopes**: never two tasks touching the same `package.json` or lockfile.
4. **QA in the worktree.** Commit the Codex changes on the task branch, then `git merge main` to resolve conflicts early. After that, run the lean QA routine (§2.3).
5. **Fix round.** If a check fails, append `## QA (Claude) — round N` to the task file with the **exact error** and the expected fix, then:
   ```bash
   scripts/dev/run-task.sh <ID> "This is FIX ROUND N: read the QA section at the end of docs/tasks/<ID>.md …"
   ```
6. **Land the task:**
   Inspect the script and the worktree first. The current `land-task.sh` stages all worktree changes and force-removes the worktree, so do not use it while unrelated owner files or uncommitted QA evidence could be included. In that situation, stage only the task's scoped paths, commit on its branch, merge without rewriting history, and preserve the worktree until QA evidence is secured.
   ```bash
   scripts/dev/land-task.sh <ID> "type(scope): subject [<ID>]"
   ```
   This commits, merges `--no-ff` into `main`, and removes the worktree. Then append `## QA (Claude) — final` to the task file, tick the task in `ROADMAP.md`, and commit `docs: tick <ID>`.
   - **Caveat:** if the worktree has nothing left to commit, `land-task.sh` stops (`set -e`) before merging. Finish by hand:
     ```bash
     git merge -q --no-ff task/<ID> -m "merge: task/<ID>"
     git worktree remove --force C:/Users/admin/itstudio-wt/<ID>
     rm -rf C:/Users/admin/itstudio-wt/<ID>
     git branch -D task/<ID>
     ```
7. **Typical merge conflicts.** Both sides are usually additive in:
   - `apps/sidecar/src/container.ts`
   - `apps/desktop/src/shell/{AppShell,MainNav}.tsx`
   - `apps/desktop/src/i18n/{en,vi}.json`
   - `e2e/wdio.conf.ts` (spec list; `shutdown.spec.ts` must stay **last**)

   Keep both sides.

### 2.3 Lean QA routine (owner asked to cut QA cost)

Run in the task worktree:

```bash
npm run typecheck && npm run lint && npx vitest run      # once each
npm run test:integration                                 # once; rerun only failing files
npx vitest run --coverage <files>                        # only for modules with a coverage gate
npx wdio run e2e/wdio.conf.ts --spec e2e/specs/<area>/<file>.spec.ts   # only the affected E2E specs
```

- **Debug app build for E2E:** E2E uses the debug binary `apps/desktop/src-tauri/target/debug/itstudio-desktop.exe`. Rebuild it first whenever Rust, the desktop UI or the sidecar changed: `npm run tauri -w @itstudio/desktop -- build --debug --no-bundle` (with `$USERPROFILE/.cargo/bin` on PATH). The E2E runner does **not** build it for you.
- **Milestone QA gate** (TESTING.md §7):
  1. QA writes `docs/qa/Mx-test-cases.md`.
  2. Codex automates the cases marked automated; the case ID goes in the test name.
  3. QA executes them and writes `docs/qa/Mx-report.md`. The verdict is SIGNED OFF, or CONDITIONAL with backlog items.

### 2.4 Things only the Architect does (Codex cannot, or must not)

| Job | Why / how |
|---|---|
| Install npm / cargo dependencies | Done once per milestone in a single commit. Tasks marked "deps pre-installed" must not touch `package.json`. |
| Drizzle migrations | `npm run db:generate -w @itstudio/sidecar`; never hand-written; existing `0000`–`0011`. |
| Integration tests | Codex sandbox: `tsx` fails on `os.userInfo()` (`uv_os_get_passwd ENOMEM`). |
| esbuild / SEA builds, installers | Codex sandbox: esbuild access denied; cargo cannot download crates (TLS). |
| E2E (WebdriverIO, VS Code E2E) | GUI; the Architect runs them. |
| Secrets | Never in files. The owner enters API keys in the app (Settings → API Keys → Windows Credential Manager). |

---

## 3. Owner's working rules (agreed in chat — not written anywhere else)

1. **Language:** chat with the owner in **Vietnamese**; every file in the repo is in **English**.
2. **Autonomy:** work fully automatically. Ask the owner only for real decisions (product scope, money, credentials, anything irreversible). Record decisions in `CONTEXT.md` (next number: **D38**).
3. **Delegate:** "Giao việc cho codex, đừng làm hết". The Architect specifies, coordinates and verifies; Codex writes code and tests. Use several Codex jobs in parallel when scopes are disjoint.
4. **Lean QA** as in §2.3: no repeated full suites, no full E2E runs unless needed.
5. **6-attempt rule:** if the same error survives 6 fix attempts, stop fixing it. Skip it, record it in the QA report and the ROADMAP backlog, report it to the owner, and move on (or stop the session if blocked).
6. **GUI:** since 2026-10-04 the owner allows opening app / E2E / VS Code windows without asking.
   - Stop immediately when the owner says "stop" / "dừng".
   - For VS Code, always open a **new** window; never touch the owner's existing windows.
   - If the owner says they are using the mouse and keyboard, wait.
7. **Scope stop:** the owner wanted to **stop after v1** to try and adjust the app themselves. Do not start v2 (M10) without the owner's go-ahead.
8. **Distribution:** single user (D33). No code signing, no clean-VM test (replaced by the isolated install smoke). Pricing-extraction cost is charged to the active project (D31).
9. **Security:** the owner once pasted a Google AI Studio API key into the chat. It was **not** written anywhere, and the owner was advised to rotate it. Never write any key into the repo, tests, logs or commits.

---

## 4. Current work (2026-10-15)

v1 hardening is complete and V1-QA passed (`docs/qa/V1-report.md`). Landed today: PSTUDIO-01/FIX1/02 (clarifying step + Pipeline Studio, D35), QA-BREAK-01/02 (adversarial suites), UX-02, V1-POLISH-01, QA-BREAK-FIX-A/B (all 12 suite defects fixed, no `it.fails` left), REPO-01 (docs moved into `docs/`, `Start-IT-Studio.bat`, unit test timeouts).

| Next | State | Notes |
|---|---|---|
| Owner acceptance | waiting | `docs/qa/V1-owner-checklist.md` (Vietnamese). Fix reported issues before anything else. |
| `MOD-01`, `MOD-02` | spec ready | Move-only refactor of `apps/sidecar/src` into `kernel/` + `modules/<feature>/` (D37). |
| `LLMPOOL-01/02` | spec ready | Key pool add-on (D36); paths adapt to the MOD layout. `LLMPOOL-03` (HTTP gateway) only on owner request. |

QA lessons from 2026-10-15:
- Always run the **integration** suite for sidecar changes (PSTUDIO-01 broke 10 pipeline cases that unit tests did not catch).
- Never run gates while a Codex run is active: CPU contention produced random timeouts (fixed partly by REPO-01's 15 s unit timeout).
- E2E (`e2e/wdio.conf.ts`) rebuilds the debug app **only if the exe is missing**; delete `apps/desktop/src-tauri/target/debug/itstudio-desktop.exe` before E2E after frontend changes (a stale exe produced 12/14 false failures). Follow-up: rebuild when sources are newer.
- Codex's sandbox cannot run `git mv`/other git writes in a worktree; the Architect performs file moves, Codex updates references.

## 5. Follow-ups and resolved QA tooling

| ID / item | Details |
|---|---|
| `QA-E2E-FIX4` | Closed: per-spec isolated app/data sessions and DOM/screenshot diagnostics restored all historical M4–M6 L4 cases; full GUI suite 44/44. |
| `QA-TOOL-01` | Closed: Stryker/Vitest integration fixed; full M9 production-domain mutation score measured at 77.53%. |
| Pricing override after restart | Clearing a manual price override after an app restart falls back to the **seed** price, not the last fetched price (found in M4-FIX3). Scheduled in `V1-POLISH-01`. |
| M9 S3 observations | M9-OBS-02/03/05/06 and the cold-start outlier M9-OBS-04. Scheduled in `V1-POLISH-01`. |
| Build leaves `icon.icns` modified | `tauri icon` regenerates a non-identical `.icns` on every `npm run build:app`. Scheduled in `V1-POLISH-01`; until then, do not commit that file after a build. |
| `scripts/dev/measure-startup.mjs` | Closed by `QA-E2E-FIX4`: all five real Ready measurements completed and the focused regression passed. |
| Image node in the workflow map | Image activity is mapped to Chat under the MW v1 topology; a separate image node would require an additive contract/topology follow-up. |
| Dry-run diff cosmetics | Minor display issues in the Code tab dry-run diff (from the M6 exploratory session). |
| Auto-update | The M9-04 updater key pair was not created (D33). Only do it if the owner wants auto-update. |

Bug history (all fixed; details in the task files):

| Bug | Fix task / note |
|---|---|
| BUG-M7-001: orphan sidecar on stdin EOF | M1-FIX4 |
| BUG-M5-001: LanceDB schema inference broke code-first ingest | explicit Arrow schema |
| BUG-M6-002 (S1): worker could not create files in new dirs | M6-FIX2 |
| BUG-M6-001: timeline marked never-run stages done | |
| BUG-M4-001: OS locale used for formatting | |
| BUG-M4-002: chat model choice disabled fallback | |
| Router dropped tool calls | |
| `pricing.refresh` swallowed Hard Stop | |
| Case-sensitive `</CONTEXT>` neutralisation | |
| SQLite `OFFSET` without `LIMIT` crashed every restart | MW-01 |
| Base Tauri config referenced staged release resources | M9-FIX1 |

---

## 6. Codebase map

```
apps/
  sidecar/   Node 24 "brain": JSON-RPC 2.0 over stdio, composition root src/container.ts, EventBus, Result<T>
    src/services/       router (llm-router, fallback-decider, circuit-breaker), ledger / pricing / fx / pnl / budget-guard,
                        chat-service, rag/ (ingest, retriever, parsers), pipeline-orchestrator + role-caller + write-transaction
                        + journal-recovery + command-runner, vscode-bridge / launcher, image-service, embedding-dispatcher,
                        activity-recorder (workflow map), secrets-service (Windows Credential Manager)
    src/providers/      LLM, embedding and image adapters (Strategy / Adapter)
    src/infra/          SQLite (Drizzle, migrations 0000–0010), LanceDB, fakes for ITSTUDIO_E2E=1
    test/integration/   L3 tests (spawn the real sidecar; harness.ts)
  desktop/   Tauri v2 shell (src-tauri, Rust) + React 19 UI (src/features: chat, code, cost, gallery, knowledge, settings, workflow)
    src-tauri/tauri.conf.json          debug / dev config
    src-tauri/tauri.conf.release.json  release-only: externalBin sidecar, bundle resources, asset protocol scope
  vscode-ext/  companion extension (WebSocket to the sidecar, token auth)
src/types/schemas.ts   shared contracts (@itstudio/schemas)
config/                seed data (pricing seed, defaults)
e2e/                   WebdriverIO + tauri-driver specs (m1, m4, m5, m6, m8, mw), wdio.conf.ts, run-e2e.mjs
scripts/dev/           run-task.sh, land-task.sh, measure-startup.mjs
scripts/build/         build-sidecar.mjs (esbuild + Node SEA + postject), smoke-sidecar.mjs, build-app.mjs, install-smoke.ps1, make-icon.mjs
scripts/release/       bump-version.mjs (+ node tests)
```

E2E fakes (only active when `ITSTUDIO_E2E=1`):

| Variable | Effect |
|---|---|
| `ITSTUDIO_E2E_LLM_SCRIPT` / `ITSTUDIO_E2E_LLM_TEXT` | scripted LLM replies and tool calls |
| `ITSTUDIO_E2E_EMBEDDING_SCRIPT` | scripted embedding results |
| `ITSTUDIO_E2E_PRICING_HTTP=fail` | pricing fetch fails |
| `ITSTUDIO_E2E_IMAGE_SCRIPT` | scripted image provider outcomes |
| `ITSTUDIO_E2E_CRASH_AT` | crash at a given point, to test journal recovery |

---

## 7. Starting v2 / v3 (only after the owner says go)

v2 and v3 are **fully planned and specified (baseline 2026-10-04)**; nothing is implemented yet.

| What | Where |
|---|---|
| v2 requirements (FR-AG/MEM/CH/OB/GM/FB, NFRs, exact RPC contracts, tables, state machines, error codes, open questions Q-06…Q-08) | `docs/specs/v2-requirements.md` |
| v3 requirements (FR-SV/KV/MT/AL/DK/FS/SA, NFRs, contracts, tables, SSH state machine, open questions Q-09…Q-11) | `docs/specs/v3-requirements.md` |
| Plan: WBS (83 items), dependencies / lanes, critical path, estimates, dependencies to pre-install, risk register, gates | `docs/plans/v2-v3-delivery-plan.md` |
| Status checklist | `ROADMAP.md` (M10 … M19, REL-V2, REL-V3) |
| Work orders | `docs/tasks/M10-00.md` … `docs/tasks/REL-V3.md` — one per item; `Mx-00` = Architect pre-work, `Mx-QA` = gate outline with planned test cases |

How to start a milestone:
1. Get the owner's go-ahead (v2 first unless the owner chooses v3).
2. Do `Mx-00` yourself: apply the milestone's additive contract changes to `src/types/schemas.ts` (SRS §6), pre-install dependencies, ask that milestone's open questions, re-check task files against the code, commit.
3. Run the `C` tasks with `run-task.sh` in dependency order, parallel lanes per the plan §2 (≤ 3 at once, disjoint scopes).
4. Generate migrations after tasks that change `infra/sqlite/schema.ts`; QA each task (§2.3); land.
5. Close with `Mx-QA`: write `docs/qa/Mx-test-cases.md` from the outline, let Codex automate, execute, report.

Design decisions already taken in the SRS (no ADR needed): DD-V2-01…09 (e.g. `start_pipeline` needs a confirmation click; memory extraction on conversation switch, never on exit) and DD-V3-01…09 (e.g. servers are app-global — pending owner confirmation Q-09, see ROADMAP *Doc Debt*).

---

## 8. Environment facts that cost time to rediscover

- **Machine:** Windows 11 Home (no Hyper-V or Windows Sandbox).
  - The repo path contains spaces: `C:\Users\admin\Desktop\File All\Demo project\Project\IT Studio`. Quote it.
  - Codex cannot write there, which is why worktrees under `C:/Users/admin/itstudio-wt/` are used.
- **Toolchain:** Node 24, npm 11, TypeScript **6.0.x** (do not install 7), Rust via rustup (`$USERPROFILE/.cargo/bin` must be on PATH). Pins are in ADR-0002.
- **E2E:**
  - Stack: WebdriverIO + `tauri-driver` + msedgedriver at `C:\Users\admin\.itstudio-tools\msedgedriver.exe`; native driver ports 4454/4455.
  - Full run: `npm run test:e2e`. One spec: `npx wdio run e2e/wdio.conf.ts --spec <file>`.
  - Specs share one app session: per-spec state leaks are the main flakiness source.
- **VS Code E2E:** `npm run test:vscode-e2e`. It must run without `ELECTRON_RUN_AS_NODE` (VS Code terminals set it to 1; the runner strips it). Open only new windows.
- **Release builds:**
  - Release builds ignore `ITSTUDIO_DATA_DIR` (debug-only); release app data lives in `%APPDATA%\com.itstudio.app`.
  - Generated images go to `%APPDATA%\com.itstudio.app\images`; the asset protocol is scoped to that folder.
- **`npm test` scope:** runs the vitest projects (sidecar, desktop, vscode-ext) **and** `node --test scripts/release/*.test.mjs scripts/build/*.test.mjs`. Integration is separate: `npm run test:integration`.
- **Known flakes under load** (stabilised in QA-FLAKE-01; if one reappears, rerun it alone before you debug): DOCX parse, LanceDB contract, Google embedding, `container.test.ts`.
