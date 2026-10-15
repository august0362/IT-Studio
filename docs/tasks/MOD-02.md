# MOD-02 — Sidecar feature modules (part 2: core flow modules, slim container)

Milestone: MOD (CONTEXT D37) · **After MOD-01 lands** · Role: Implementer (ROLES §1.3) · Size L · **Deps pre-installed** · Pure refactor: **no behaviour change**

## Goal

Finish the structure defined in `docs/tasks/MOD-01.md` (*Target structure*, *Rules* — binding here too): move **router, chat, pipeline, projects, settings** into `modules/`, and reduce `container.ts` to a composition root.

## Scope

- `apps/sidecar/src/**` for the five modules above and `container.ts`.
- `eslint.config.js` boundaries config if an element needs adjusting.
- This task file (`## Result`).

## Requirements

1. Same move-only rules, `index.ts` / `rpc.ts` / `README.md` per module, tests next to files, `git mv`.
2. `container.ts` ≤ 250 lines: build kernel infra → create modules in dependency order (settings → projects → router → cost → knowledge → images → chat → pipeline → workflow → vscode → web-chat, adjust if the real graph differs) → call each `register…Rpc` → lifecycle (start/stop) in reverse order. No business logic left in it.
3. Remove the now-empty `services/`, `domain/`, `prompts/`, `validation/` (except what moved to `kernel/`) folders.
4. Cross-module calls go through the other module's `index.ts` exports; if a module needs something not exported, export a narrow function/type — never import internals. List new exports in Result.
5. `module-boundaries.test.ts` covers all eleven modules.

## Acceptance criteria

- [ ] `npx prettier --write`, `npm run typecheck`, `npm run lint`, `npm test` pass; QA: full integration, E2E, `smoke:sidecar`, `build:app` — identical pass counts to `main` before MOD-01.

## Hand-back

Append `## Result` per AGENTS.md §3 with a table *old path → new path* and the final module dependency graph (text list `module → depends on`).
