# HANDOFF — read this first if you are a new AI / engineer continuing IT Studio

> Last updated: **2026-10-04** by the Architect / QA agent (Claude), at a deliberate stop requested by the owner.
> Keep this file current whenever you stop. It complements — does not replace — the binding documents:
>
> | Document | What it is |
> |---|---|
> | `CONTEXT.md` | Product, glossary, **decisions D1–D33**. Wins over every other document. |
> | `ARCHITECTURE.md` | Part I (v1), §13.1 Workflow map, Part II (v2 orchestration hub), Part III (v3 servers). |
> | `src/types/schemas.ts` | All shared contracts (`@itstudio/schemas`). Additive changes only. |
> | `ROADMAP.md` | Task checklist — **source of truth for status** (`- [x]` = done and QA-passed). |
> | `ROLES.md`, `AGENTS.md` | Dev roles; rules for the implementer (Codex). |
> | `CONVENTIONS.md`, `TESTING.md` | Coding rules + review checklist; test levels L1–L4, QA gate procedure. |
> | `docs/RUNNING.md` | How to run, build, install and release the app (owner-facing). |
> | `docs/tasks/<ID>.md` | One work order per task, with Codex `## Result` and QA verdict sections. |
> | `docs/qa/Mx-test-cases.md`, `docs/qa/Mx-report.md` | Milestone QA specs and sign-off reports. |
> | `docs/decisions/ADR-000x-*.md` | ADR-0001 foundations, 0002 toolchain pins, 0003 v2, 0004 v3. |
> | `docs/reports/overnight-2026-10-02.md` | Environment findings (ENV-1 … : sandbox limits). |

---

## 0. TL;DR for the next agent

1. Read §3 (owner rules) and §2 (how work is done) — they are not written anywhere else.
2. Finish the four **in-flight items in §4** in the order given (each has exact resume steps).
3. Then ask the owner before starting v2 (M10). The owner wanted to stop after v1 to try the app themselves.
4. Talk to the owner in **Vietnamese**; write every repo file in **English**.

---

## 1. Status per milestone (2026-10-04)

| Milestone | Tasks done | Status | Notes |
|---|---|---|---|
| M0 env / scaffold | 8/8 | ✅ | |
| M1 sidecar + JSON-RPC | 8/8 | ✅ | report `docs/qa/M1-report.md` |
| M2 router + fallback | 11/11 | ✅ | |
| M3 ledger / pricing / P&L | 8/8 | ✅ signed off | |
| M4 chat UI | 8/8 | ✅ conditional | some E2E cases → `QA-E2E-FIX4` |
| M5 RAG | 8/8 | ✅ conditional | some E2E cases → `QA-E2E-FIX4` |
| M6 pipeline + worker writes | 9/9 | ✅ conditional | some E2E cases → `QA-E2E-FIX4` |
| M7 VS Code companion | 6/6 | ✅ signed off | |
| SEC-01 dependency audit | 1/1 | ✅ | `npm run audit:prod` = 0 high vulnerabilities |
| PERF-01 startup | 1/1 | ✅ | dev sidecar 2.8 s (was 4.0 s); packaged sidecar ~0.6 s warm |
| **MW** Workflow map (D32) | 4/6 | 🟡 | MW-04 implemented, **not landed**; MW-QA not started |
| **M8** image generation | 5/6 | 🟡 | M8-QA automated, **E2E failing**, not landed |
| **M9** packaging | 6/7 | 🟡 | M9-04 (signing / clean VM) marked not needed by D33; M9-QA not started |
| QA tooling | 1/3 | backlog | `QA-E2E-FIX4`, `QA-TOOL-01` |
| **v2** M10–M14 | 0 | ⏸ not started | fully specified (see §7), no task files yet |
| **v3** M15–M19 | 0 | ⏸ not started | fully specified (see §7), no task files yet |

Delivered numbers: about 875 unit tests (1 skipped) and about 111 integration tests. Packaging: SEA sidecar 96 MB, NSIS installer 93 MB, MSI 147 MB (LanceDB native binary is ~317 MB unpacked). Install smoke 7/7.

---

## 2. How work is done (process)

### 2.1 Roles
- **Architect / PM / QA** (an AI like Claude):
  - writes specs (`docs/tasks/<ID>.md`), contracts (`src/types/schemas.ts`, additive only), docs and decisions;
  - pre-installs dependencies; runs QA; resolves merge conflicts; lands work.
  - Does **not** write feature or test code — delegates it (owner's explicit instruction).
- **Implementer**: Codex CLI (`codex-cli 0.159.x`, ChatGPT login), following `AGENTS.md`.

### 2.2 Task lifecycle

1. **Write the spec.** Create `docs/tasks/<ID>.md` using the existing files as templates. Sections, in order: header, Read first, Scope (exact paths), Requirements, Tests, Acceptance criteria, Hand-back. Mark it **"Deps pre-installed"** when you have installed the packages yourself.
2. **Commit the spec on `main`.** `run-task.sh` refuses to run on an uncommitted task file.
3. **Run Codex** as a tracked background job (never detached):
   ```bash
   scripts/dev/run-task.sh <ID> ["extra instruction"]   # creates worktree C:/Users/admin/itstudio-wt/<ID>, branch task/<ID>
   CODEX_EFFORT=medium scripts/dev/run-task.sh <ID>     # cheaper; for test-only or small tasks
   ```
   - Logs go to `$TEMP/itstudio-codex/<ID>.log` and `<ID>.last.txt`.
   - Run up to about 4 jobs in parallel, but only on **disjoint scopes**: never two tasks touching the same `package.json` or lockfile.
4. **QA in the worktree.** Commit the Codex changes on the task branch, then `git merge main` to resolve conflicts early. After that, run the lean QA routine (§2.3).
5. **Fix round.** If a check fails, append `## QA (Claude) — round N` to the task file with the **exact error** and the expected fix, then:
   ```bash
   scripts/dev/run-task.sh <ID> "This is FIX ROUND N: read the QA section at the end of docs/tasks/<ID>.md …"
   ```
6. **Land the task:**
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
| Drizzle migrations | `npm run db:generate -w @itstudio/sidecar`; never hand-written; existing `0000`–`0010`. |
| Integration tests | Codex sandbox: `tsx` fails on `os.userInfo()` (`uv_os_get_passwd ENOMEM`). |
| esbuild / SEA builds, installers | Codex sandbox: esbuild access denied; cargo cannot download crates (TLS). |
| E2E (WebdriverIO, VS Code E2E) | GUI; the Architect runs them. |
| Secrets | Never in files. The owner enters API keys in the app (Settings → API Keys → Windows Credential Manager). |

---

## 3. Owner's working rules (agreed in chat — not written anywhere else)

1. **Language:** chat with the owner in **Vietnamese**; every file in the repo is in **English**.
2. **Autonomy:** work fully automatically. Ask the owner only for real decisions (product scope, money, credentials, anything irreversible). Record decisions in `CONTEXT.md` (next number: **D34**).
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

## 4. In-flight work at the stop (do these first, in this order)

Two worktrees exist (`git worktree list`). Both branches have **all work committed**; nothing is lost if the folders are deleted, as long as the branches are kept.

### 4.1 M8-QA — branch `task/M8-QA`, worktree `C:/Users/admin/itstudio-wt/M8-QA`

**Done:**
- Test cases are in `docs/qa/M8-test-cases.md`.
- Codex automated them: case → file table in the branch's `docs/tasks/M8-QA.md` `## Result`.
- Codex also added the `ITSTUDIO_E2E_IMAGE_SCRIPT` fake (JSON keyed by provider id → `success` | `http:<status>`), active only with `ITSTUDIO_E2E=1`.
- QA merged `main` (resolved `e2e/wdio.conf.ts`: keep both `./specs/m8/images.spec.ts` and `./specs/mw/workflow.spec.ts`, then `shutdown.spec.ts` last).
- QA checks passed: typecheck ✔, lint ✔, unit 860 ✔, integration **111/111 ✔** (TC-M8-001…006).

**Open:** E2E `e2e/specs/m8/images.spec.ts` **fails** (run 2026-10-04, 1 spec, 43 s). Failure detail:
- Failing test: `✖ TC-M8-010 renders the generated image in chat and opens its lightbox`.
- Error: `waitUntil condition timed out after 5000ms`, raised in `openImageSession` at `images.spec.ts:25` (called from line 97).
- Reason: `Cannot read properties of undefined (reading 'isDisplayed')`.
- Line 25 waits for `footer[role="status"]` to contain `Ready v0.1.0`.

**Root cause:** not investigated yet. Hypotheses:
- The spec opens its **own** WebDriver session with `remote({ port: 4449 … })` instead of the session that `wdio.conf.ts` provides. It depends on the extra tauri-driver that the branch's `wdio.conf.ts` starts on port 4449, and the element API behaves differently on that remote session.
- The extra session needs the image fake env vars, which is presumably why Codex added it.

**Resume steps:**
1. Append a `## QA (Claude) — round 1` section to `docs/tasks/M8-QA.md` with the error above.
2. Run `scripts/dev/run-task.sh M8-QA "FIX ROUND 1 …"`. Ask Codex to either:
   - use the standard `browser` session and pass `ITSTUDIO_E2E_IMAGE_SCRIPT` the way other specs pass `ITSTUDIO_E2E_LLM_SCRIPT` (see `e2e/specs/m4/*`); or
   - fix the remote-session usage. Use `await $(...)` element handles, and give `waitUntil` a longer timeout (30 s) for app start.
3. Rerun only that spec. If it passes, write `docs/qa/M8-report.md`, land with `scripts/dev/land-task.sh M8-QA "test(images): M8 QA gate [M8-QA]"`, and tick M8-QA in ROADMAP.

### 4.2 MW-04 — branch `task/MW-04`, worktree `C:/Users/admin/itstudio-wt/MW-04`

**Done:**
- Codex implemented the task (spec `docs/tasks/MW-04.md`, `## Result` on the branch):
  - New typed in-process bus `apps/sidecar/src/services/workflow-internal-events.ts`.
  - Events from:
    - the retriever (hit count, top score, duration; never the query text);
    - the command runner (executable + arg count only, exit code, duration, timed-out);
    - the VS Code bridge (action sent / acked);
    - the image service (started / completed / failed, provider, count, cost);
    - the embedding dispatcher (batch, model, chunks, cost).
  - These are mapped in `activity-recorder.ts`.
  - Desktop: new `apps/desktop/src/state/navigation-intent.ts` store. Deep links from the Workflow panel select the conversation (Chat), the pipeline run (Code), the ingest job (Knowledge) and the ledger row (Cost).
- QA committed the work and merged `main`. Checks passed: typecheck ✔, lint ✔, unit **875 passed / 1 skipped ✔**.
- Design note: image activity is mapped to the **Chat** node because `WorkflowModuleId` has no image node. Accept it, or add an `images` module in a follow-up (an additive schema change plus a topology entry).

**Not yet run:** integration (`npm run test:integration`, including new `TC-MW-004` in `apps/sidecar/test/integration/workflow.test.ts`) and E2E `e2e/specs/mw/workflow.spec.ts` (TC-MW-010, which passed before MW-04).

**Resume steps:**
1. Run those two checks in the worktree.
2. If both are green: `scripts/dev/land-task.sh MW-04 "feat(workflow): internal events + selecting deep links [MW-04]"`. Expect the nothing-to-commit caveat in §2.2, step 6.
3. Tick MW-04 in ROADMAP.

### 4.3 MW-QA — not started
1. Write `docs/qa/MW-test-cases.md`. Scope is in ROADMAP MW-QA:
   - topology completeness vs ARCH §13.1;
   - an event → module mapping table;
   - a redaction corpus (no prompt text or keys in any summary);
   - retention boundaries (7 days / 20 000 rows per project);
   - a live update burst (100 events/s);
   - E2E: chat + ingest + pipeline light up the right nodes and edges.

   Existing IDs: TC-MW-003, TC-MW-004 (L3), TC-MW-010 (L4).
2. Create `docs/tasks/MW-QA.md` → Codex automates it → QA executes it → `docs/qa/MW-report.md`.

### 4.4 M9-QA — not started
1. Write `docs/qa/M9-test-cases.md`. Most cases are re-running existing scripts:

   | Command | What it checks |
   |---|---|
   | `npm run build:sidecar` | builds the SEA sidecar |
   | `npm run smoke:sidecar` | sidecar starts; native modules (better-sqlite3, LanceDB) load; ready under 1.5 s |
   | `npm run build:app` | builds the NSIS + MSI installers |
   | `npm run smoke:install` | silent install into a temp dir; runs with no Node on PATH; clean exit; uninstall |
   | `npm run release:bump -- --dry-run` | version bump |
   | `npm run audit:prod` | dependency audit |
   | `node --test scripts/build/*.test.mjs` | debug-config regression (`tauri-debug-config.test.mjs`) |

   The clean-VM case is replaced by the install smoke (D33). Auto-update is out of scope unless the owner wants it.
2. **Rebuild the installers after M8-QA and MW-04 land** (both change the app), rerun the install smoke, then write `docs/qa/M9-report.md`.

---

## 5. Backlog / known issues (not blocking v1)

| ID / item | Details |
|---|---|
| `QA-E2E-FIX4` | 13 E2E cases skipped after 6 attempts: TC-M4-022/023/031/033/041–046, TC-M5-020/022/023, TC-M6-071/072. Proposed approach: a fresh app + data dir per spec (restart tauri-driver per spec), and a DOM snapshot + screenshot on failure so fixes are not blind. Each case passes at L3; only the GUI automation is flaky or state-dependent. |
| `QA-TOOL-01` | StrykerJS 10 × Vitest 5 workspace reports 0 % kills (tool incompatibility). A manual mutation proved the tests are effective. Fix the configuration or pin a compatible Stryker. |
| Pricing override after restart | Clearing a manual price override after an app restart falls back to the **seed** price, not the last fetched price, because the repository keeps only the latest table (found in M4-FIX3). |
| `scripts/dev/measure-startup.mjs` | Exits early (no stdin pipe, so the sidecar sees EOF and exits by design, BUG-M7-001). Use `npm run smoke:sidecar` for timing. |
| Image node in the workflow map | See §4.2 design note. |
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
e2e/                   WebdriverIO + tauri-driver specs (m1, m4, m5, m6, mw; m8 on branch task/M8-QA), wdio.conf.ts, run-e2e.mjs
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
| `ITSTUDIO_E2E_IMAGE_SCRIPT` | scripted image provider outcomes (branch `task/M8-QA`) |
| `ITSTUDIO_E2E_CRASH_AT` | crash at a given point, to test journal recovery |

---

## 7. Starting v2 / v3 (only after the owner says go)

- **v2 (M10–M14): orchestration hub.** Agents, long-term memory, channels + Outbox approval, Gmail, Facebook Page.
  - Specified in ARCHITECTURE Part II (§14–§18), ADR-0003, `schemas.ts` §14–§16, ROLES §2.x prompts, and the ROADMAP task lists M10-01 … M14-QA.
- **v3 (M15–M19): agentless server management over SSH.** SSH and key vault, metrics collectors, Docker, and so on.
  - Specified in ARCHITECTURE Part III, ADR-0004, `schemas.ts` §17, and ROADMAP M15–M19.
- **No `docs/tasks/M10-*.md` files exist yet.**

  | Step | Action |
  |---|---|
  | 1 | Write the M10 task specs from the ROADMAP lines. |
  | 2 | Pre-install that milestone's dependencies in one commit. |
  | 3 | Run independent tasks in parallel. M10-01 first: it adds the `agents` table, migration and additive `CostPurpose` values. |
  | 4 | Generate migrations as Architect. |
  | 5 | Finish the milestone with the M10-QA gate. |

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
