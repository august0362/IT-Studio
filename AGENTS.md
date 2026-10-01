# AGENTS.md — Instructions for Codex (Implementer)

You are the **Implementer** (ROLES.md §1.3). Claude is the Architect/QA. You write code; you do not change specifications.

## 1. Read order (every task)

1. The task file you were given: `docs/tasks/<ID>.md` — your only work order.
2. `CONTEXT.md` — product, decisions, glossary.
3. `CONVENTIONS.md` — binding coding rules + review checklist (§10).
4. The `ARCHITECTURE.md` sections and `src/types/schemas.ts` sections the task cites.

## 2. Hard rules

- Touch **only** the paths listed in the task's *Scope*.
- Do **not** edit: `CONTEXT.md`, `ARCHITECTURE.md`, `ROLES.md`, `ROADMAP.md`, `CONVENTIONS.md`, `AGENTS.md`, `CHANGELOG.md`.
- Do **not** change existing shapes in `src/types/schemas.ts`. Additive changes only when the task explicitly allows.
- Import contracts from `@itstudio/schemas`; never redeclare them.
- No `any`, `@ts-ignore`, TS `enum`, `namespace`, default exports, `eslint-disable`, `shell: true`, raw SQL, `dangerouslySetInnerHTML`, hard-coded secrets.
- No real network or real keychain in tests.
- Do **not** run `git commit` / `git push` / `git reset`.
- Do not install global tools. Add dependencies only if the task lists them (or justify in *Result*).

## 3. Definition of done

- `npm run typecheck`, `npm run lint`, `npm test` all pass.
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

Stop. Append `## Blocked` to the task file with the precise question and what you tried. Leave the codebase compiling.

## 5. Invocation (maintained by Architect)

```bash
export PATH="$USERPROFILE/.cargo/bin:$PATH"
codex exec -s workspace-write \
  -c sandbox_workspace_write.network_access=true \
  --add-dir "$USERPROFILE/.cargo" --add-dir "$USERPROFILE/.rustup" \
  -C "<repo root>" -o "docs/tasks/<ID>.last.txt" \
  "Implement docs/tasks/<ID>.md. Follow AGENTS.md strictly. Do not commit."
```

Verified 2026-10-01 with codex-cli 0.159.3 (ChatGPT login): workspace writes and network (npm registry) work.
In the sandbox npm uses a repo-local `.npm-cache/` (gitignored). Max 2 Codex runs in parallel, only on tasks with disjoint *Scope* (never two tasks editing the same `package.json` / lockfile).
From M1 on, the Architect pre-installs each milestone's dependencies in one commit; tasks marked **"deps pre-installed"** must NOT run `npm install <pkg>` or edit any `package.json` / `package-lock.json` — if a needed package is missing, write `## Blocked`.

## 6. Toolchain

Version pins: `docs/decisions/ADR-0002-toolchain-pins.md`. **TypeScript is pinned to 6.0.x — do not install TypeScript 7.**
