# QA-BREAK-FIX-B — Desktop UI race defects + flaky tests

Milestone: v1 hardening · Role: Implementer (ROLES §1.3) · Size S–M · **Deps pre-installed** · Depends on QA-BREAK-02, UX-02, V1-POLISH-01 (landed)

## Goal

Turn every desktop `it.fails('QA-BREAK-02-Dnn …')` in `apps/desktop/src/features/break-ui-races.test.tsx` into a passing `it(...)` by fixing the product, and remove two load-dependent flaky tests.

## Scope — files you may create/modify

- `apps/desktop/src/features/{cost,chat,code}/**` (+ tests)
- `apps/desktop/src/features/break-ui-races.test.tsx` — only `it.fails` → `it`
- This task file (`## Result`)

## Defects

| ID | Fix |
|---|---|
| QA-BREAK-02-D01 | Add revenue: a second submit while the first `revenue.add` is pending sends nothing (disable the button + in-flight guard). |
| QA-BREAK-02-D02 | ChatPage: switching project clears the selected conversation; the composer can never send with another project's conversation id. |
| QA-BREAK-02-D03 | CodePage: switching project clears the selected run / preview (project-scoped selection). |
| QA-BREAK-02-D04 | CodePage: an older `pipeline.get` response that resolves after a newer one must be ignored (request sequence number per run, or compare a monotonic stage order / `finishedAt`). |
| FLAKE-1 | `ChatPage.test.tsx` "TC-MW-009 opens a conversation selected by a workflow deep link" fails under full-suite load (missing heading) and passes alone. Make it deterministic (await the data the heading depends on with `findBy…` and an explicit timeout ≥ 10 s; no global timeout change). |

## Acceptance criteria

- [ ] All defects fixed, tests are plain `it(...)` and pass; run `npm test` **three times in a row** green (record in Result).
- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.
