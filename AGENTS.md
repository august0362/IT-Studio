# AGENTS.md — Instructions for Codex

The owner delegated project execution to Codex on 2026-10-04, including implementation, necessary design/documentation changes, and verification. The owner's current instructions supersede older task scope restrictions. Keep work focused on the requested product outcome and preserve unrelated user changes.

## 1. Read order (every task)

1. The task file you were given: `docs/tasks/<ID>.md`, together with the owner's latest instructions.
2. `CONTEXT.md` — product, decisions, glossary.
3. `CONVENTIONS.md` — binding coding rules + review checklist (§10).
4. The `ARCHITECTURE.md` sections and `src/types/schemas.ts` sections the task cites.
5. For `Mx-QA` tasks or any test work: `TESTING.md` and the milestone test-case document `docs/qa/Mx-test-cases.md` — implement every case marked automated, using the case ID in the test name (e.g. `it('TC-M2-014 429 on A falls back to B')`).

## 2. Hard rules

- Use task Scope to organize ownership. Necessary adjacent code, generated migrations/assets, wiring, and documentation may be updated under the owner's project-wide authorization. Record meaningful scope additions in the task Result.
- Keep `CONTEXT.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `AGENTS.md`, and `CHANGELOG.md` consistent with completed work.
- Do **not** change existing shapes in `src/types/schemas.ts`. Additive changes only when the task explicitly allows.
- Import contracts from `@itstudio/schemas`; never redeclare them.
- No `any`, `@ts-ignore`, TS `enum`, `namespace`, default exports, `eslint-disable`, `shell: true`, raw SQL, `dangerouslySetInnerHTML`, hard-coded secrets.
- No real network or real keychain in tests.
- Commit and push completed, checked work when authorized by the owner. Preserve unrelated changes; do not use destructive resets.
- Do not install global tools. Add dependencies only if the task lists them (or justify in *Result*).

## 3. Definition of done

- Run `npx prettier --write <changed files>` first; then `npm run typecheck`, `npm run lint` (includes `prettier --check`), `npm test` all pass.
- Every acceptance criterion in the task is met and covered by tests.
- Append to the task file:

```markdown
## Result
- Summary: …
- Files changed: …
- Dependencies added (with reason): …
- Decisions taken within scope: …
- Open issues / follow-ups: …
```

## 4. When blocked

Investigate the cause and use the authorized adjacent paths before declaring a blocker. Record an actual unresolved dependency or decision under `## Blocked`, and continue independent work. Leave the codebase compiling.

## 5. Invocation (maintained by Architect)

```bash
scripts/dev/run-task.sh <ID>            # creates worktree C:/Users/admin/itstudio-wt/<ID> on branch task/<ID>, runs codex exec there
# QA in the worktree, then:
scripts/dev/land-task.sh <ID> "feat(scope): subject [<ID>]"   # commit in worktree, merge --no-ff into main, remove worktree
```

**Codex should work in its own git worktree** (`C:/Users/admin/itstudio-wt/<ID>`). Give each parallel worker explicit file ownership and keep shared contracts/dependencies under one owner. Format changed files only. Preserve user changes when integrating into the main checkout.

**Worktree note:** older Codex sandbox sessions could not write to the repo's Desktop path. OWNER-FB1 runs in an unrestricted worktree; inspect the current environment before reporting a filesystem blocker. Worktrees isolate parallel tasks. You (Codex) will see a normal repo checkout; `node_modules` may be absent — follow the task's dependency instructions before running `npm --cache .npm-cache install`.
Verified 2026-10-02 with codex-cli 0.159.3 (ChatGPT login): writes in worktree + network (npm registry) work.
In the sandbox npm uses a repo-local `.npm-cache/` (gitignored). Parallel agents may use available slots with disjoint file ownership (never two agents editing the same `package.json` / lockfile).
From M1 on, the Architect pre-installs each milestone's dependencies in one commit; tasks marked **"deps pre-installed"** must NOT run `npm install <pkg>` or edit any `package.json` / `package-lock.json` — if a needed package is missing, write `## Blocked`.

**Historical Windows sandbox observations:** earlier sessions encountered denied esbuild/vitest native-helper access, Cargo TLS `SEC_E_NO_CREDENTIALS`, and `tsx` failures on `os.userInfo()`. These are evidence from those environments. Record any reproduced current verification failure under *Open issues* in `## Result`, continue independent work, and arrange verification in a supported environment. Preserve the pinned toolchain.

## 6. Toolchain

Version pins: `docs/decisions/ADR-0002-toolchain-pins.md`. **TypeScript is pinned to 6.0.x — do not install TypeScript 7.**
