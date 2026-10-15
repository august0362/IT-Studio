# MOD-01 — Sidecar feature modules (part 1: structure, rules, leaf modules)

Milestone: MOD (CONTEXT D37) · **After the v1 owner sign-off, before LLMPOOL** · Role: Implementer (ROLES §1.3) · Size L · **Deps pre-installed** · Pure refactor: **no behaviour change**

## Goal

Reorganise `apps/sidecar/src` from layers (one flat `services/` with 33 services, a 1 138-line `container.ts`) into **feature modules** that can be read, tested and removed one at a time — the same idea as `apps/desktop/src/features/*`. Part 1 creates the structure, the dependency rules and moves the leaf modules; MOD-02 moves the core flow modules and slims `container.ts`.

## Target structure (binding)

```text
apps/sidecar/src/
├── main.ts, container.ts        # composition root only (container ≤ 250 lines after MOD-02)
├── kernel/                      # shared, feature-agnostic: no imports from modules/
│   ├── domain/                  # assert, backoff, money, redact, template, token-estimate, path-guard, unified-diff
│   ├── ports/                   # all port interfaces (unchanged files)
│   ├── infra/                   # sqlite, lancedb, logger, clock, id, fs, process runner, keychain, http, native-modules, browser-locator/launcher
│   ├── rpc/                     # rpc-server, line-transport, event-bus
│   ├── validation/              # brand, common, errors, ipc.ts (the RPC schema map stays central)
│   ├── config/, scheduler/
│   └── providers/               # LLM/embedding/image adapters + provider-registry
└── modules/
    ├── cost/        ledger-service, budget-guard, pnl-service, revenue-service, fx-service, pricing-service, pricing-updater, price-source; domain cost, pnl, budget, price-validation; validation cost
    ├── knowledge/   services/rag/*, embedding-dispatcher; domain chunker, mmr; validation rag
    ├── images/      image-service; validation image
    ├── vscode/      vscode-bridge, vscode-launcher, vscode-session-file; validation vscode
    ├── web-chat/    domain web-chat (+ any web-chat service code); validation web-chat-layout
    ├── workflow/    activity-recorder, workflow-internal-events, workflow-qa test; domain workflow-topology; validation workflow
    ├── router/      (MOD-02) llm-router, router-config-service, circuit-breaker, fallback-decider, model-registry; domain router-machine; validation router, models
    ├── chat/        (MOD-02) chat-service, prompts/chat-assistant; validation chat
    ├── pipeline/    (MOD-02) pipeline-orchestrator, role-caller, failure-report-builder, journal-recovery, command-runner; domain pipeline-machine, pipeline-diff, remediation, failure, code-cli, parsers/*; prompts common/pm/coder/reviewer; validation pipeline, worker
    ├── projects/    (MOD-02) project-service, project-context; validation projects
    └── settings/    (MOD-02) settings-service, secrets-service, system-service, default-settings; validation settings
```

Each module folder:

```text
modules/<name>/
├── index.ts     # the ONLY file other modules/container may import: create<Name>Module(deps) + public types
├── rpc.ts       # register<Name>Rpc(server, module) — the server.register(...) calls moved verbatim from container.ts
├── services/ domain/ validation/ prompts/   # as needed; tests stay next to their files
└── README.md    # 5–10 lines: purpose, RPC methods, dependencies (other modules' index + kernel ports)
```

## Rules

1. **Moves only.** Use `git mv`; change import paths and move `server.register(...)` blocks into `rpc.ts`; no logic, naming, signature, error-message or log-field changes. Any unavoidable code change (e.g. a circular import) is listed in Result with the reason.
2. **Dependency rules** (update `eslint.config.js` `eslint-plugin-boundaries` from `sidecarLayers` to these elements; lint must fail on violations):
   - `kernel/**` must not import `modules/**`.
   - `modules/<a>/**` may import `kernel/**`, `@itstudio/schemas` and **only** `modules/<b>/index.ts` of other modules — never their internals.
   - `container.ts` may import `kernel/**` and `modules/*/index.ts` only.
   - Keep the existing domain-purity rules (domain files: no I/O imports).
3. Integration tests (`apps/sidecar/test/integration/**`) and E2E must pass **unchanged** (they talk JSON-RPC only).
4. `apps/desktop`, `apps/vscode-ext`, `src/types/schemas.ts` untouched.

## Part 1 scope — files you may create/modify/move

- `apps/sidecar/src/**` for: creating `kernel/` and moving the shared folders into it; modules **cost, knowledge, images, vscode, web-chat, workflow** (their RPC registration moves to `rpc.ts`, `container.ts` calls `create…Module` + `register…Rpc`).
- `eslint.config.js` (boundaries config only), `apps/sidecar/tsconfig*.json` / `vitest.config.ts` include globs only if paths require it, `scripts/build/**` only if a bundling entry path changes (SEA/esbuild entry stays `main.ts`).
- `docs/ARCHITECTURE.md`: **no** — the Architect updates it at QA.
- This task file (`## Result`).

## Tests / verification

- No new behaviour tests needed; every existing test moves with its file and passes.
- Add `apps/sidecar/src/modules/module-boundaries.test.ts`: walks `modules/*` and asserts each has `index.ts`, `rpc.ts`, `README.md`, and that no file outside a module imports a non-`index.ts` file of it (static import scan).
- `npm run build:sidecar` (or the existing SEA bundle script) still produces a working sidecar; `npm run smoke:sidecar` passes (QA reruns outside the sandbox).

## Acceptance criteria

- [ ] Structure and rules above for the six part-1 modules; `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA runs full integration + E2E + smoke: identical pass counts to `main` before the refactor.

## Hand-back

Append `## Result` per AGENTS.md §3 with a table *old path → new path*.
