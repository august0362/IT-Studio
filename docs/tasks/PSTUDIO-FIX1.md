# PSTUDIO-FIX1 — Accept a bare TaskSpec from the PM (regression from PSTUDIO-01)

Milestone: v1 add-on · Role: Implementer (ROLES §1.3) · Size S · **Deps pre-installed**

## Problem

After PSTUDIO-01 the PM output must be `{ kind: 'spec', spec } | { kind: 'questions', questions }`. Scripted fixtures (integration `apps/sidecar/test/integration/{pipeline,workflow,vscode-bridge}.test.ts`, E2E) and real models that ignore the envelope return a **bare `TaskSpec`** object. Such runs now fail at SPECIFYING: on `main`, `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/pipeline` fails 10+ cases (timeouts, `expected 'failed' to be 'rolled_back'`), and `break-security` BRK-S03 times out.

## Scope

- `apps/sidecar/src/services/role-caller.ts` (+ its test)
- `apps/sidecar/src/validation/pipeline.ts` (+ its test) only if the PM output schema lives there
- This task file (`## Result`)

## Requirements

1. PM output parsing accepts, in this order: the `{ kind: 'spec' }` envelope, the `{ kind: 'questions' }` envelope (first call only), **or a bare object that validates as `TaskSpec`** → treated exactly as `{ kind: 'spec', spec }`. Anything else → existing invalid-output handling.
2. The second PM call (after answers) also accepts a bare `TaskSpec`.
3. Do not change test fixtures; the existing integration tests must pass unchanged.

## Tests

Unit: bare TaskSpec on first and second call → spec; envelope variants unchanged; garbage → invalid.
QA (outside sandbox, record if the sandbox blocks it): `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/` — all green.

## Acceptance criteria

- [ ] `npx prettier --write <changed files>`, `npm run typecheck`, `npm run lint`, `npm test` pass.

## Hand-back

Append `## Result` per AGENTS.md §3.
