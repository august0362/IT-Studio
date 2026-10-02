# CONVENTIONS.md — Engineering Rules (binding for every agent)

> Violations are review blockers unless marked *(guideline)*.

---

## 1. Process rules

1. **No work without a task.** Every code change maps to exactly one ROADMAP task ID and one `docs/tasks/<ID>.md`.
2. **Break work down.** Task size target: ≤ 400 changed lines, ≤ 1 day of work, one concern. Larger → Architect splits it (`M3-04a`, `M3-04b`).
3. **Milestones** close only when all their tasks are checked **and** the milestone's exit criteria (ROADMAP) are verified by QA.
4. **Document context.** New concept → `CONTEXT.md` glossary. New component/flow → `ARCHITECTURE.md`. Non-trivial choice → ADR.
5. **Update log.** Every merged task adds a `CHANGELOG.md` line (§9). Every doc edit bumps the doc's "Last updated" if present.
6. **Contracts first.** If a task needs a new cross-boundary type, the Architect adds it to `schemas.ts` *before* the task is handed to Codex.

## 2. TypeScript

- `tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `isolatedModules`, `verbatimModuleSyntax`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`.
- **Forbidden:** `any` (explicit or implicit), `@ts-ignore`, `@ts-nocheck`, non-null `!` on external data, TS `enum`, `namespace`, parameter properties, default exports (except where a framework requires: Vite config, VS Code `activate` is named anyway).
- **Enum pattern:** `export const X = { A: 'a' } as const; export type X = (typeof X)[keyof typeof X];`
- `@ts-expect-error` allowed only in tests, with a reason comment.
- Unknown input → `unknown` + zod parse. Never cast (`as T`) external data.
- Types-only imports use `import type`.
- Exhaustive switches end with `assertNever(x)` (`apps/sidecar/src/domain/assert.ts`, shared copy in UI).
- Prefer `readonly` fields and `ReadonlyArray` in public types.
- Shared contracts imported as `@itstudio/schemas` (path alias → `src/types/schemas.ts`). Never redeclare a contract type locally.

### 2.1 Identifiers & branded values

- All entity ids are UUID v4 strings from `crypto.randomUUID()`, generated only in the sidecar via `IIdGenerator` (injectable for tests).
- Branded types (`ProjectId`, `MicroUsd`, …) are constructed **only** in `apps/sidecar/src/validation/brand.ts` (zod transforms) and `domain/` constructors. That file is the single place where `as <Brand>` casts are allowed.

## 3. Architecture rules (SOLID applied)

| Principle | Rule in this codebase |
|---|---|
| **S**ingle responsibility | One service = one domain (router ≠ ledger ≠ budget). Files ≤ 300 lines *(guideline)*; functions ≤ 50 lines *(guideline)*. |
| **O**pen/closed | New provider/model/tool/image backend = new adapter class registered in the container. No `if (provider === 'x')` outside the adapter registry. |
| **L**iskov | Every `ILlmProvider` impl must pass the shared adapter contract test suite (`providers/__contract__/`). |
| **I**nterface segregation | Small interfaces: `ILedgerReader` vs `ILedgerWriter`; UI only sees RPC. |
| **D**ependency inversion | Services receive interfaces via constructor; only `container.ts` calls `new` on infra classes. No module-level singletons holding state. |

### 3.1 Mandated patterns

| Pattern | Where |
|---|---|
| Strategy | `ILlmProvider`, `IEmbeddingProvider`, `IImageProvider`, output parsers (tsc/eslint/vitest) |
| Chain of Responsibility | Router ladder traversal (each eligible model handler tries or passes) |
| State | Router request state machine (ARCH §5.3), pipeline stages (ARCH §8.1) — explicit transition tables, illegal transitions throw in dev |
| Repository | All SQLite/LanceDB access (`infra/*Repository.ts`) |
| Adapter | Provider SDK ↔ `LlmRequest/LlmResponse` mapping |
| Observer | `EventBus<RpcNotificationMap>` |
| Unit of Work | `WriteTransaction` (prepare/commit/rollback) |
| Factory | `ProviderRegistry.create(providerId)` |
| Composition Root | `apps/sidecar/src/container.ts` |

### 3.2 Layer dependency rules

```
ui (React)      → rpc client only
rpc             → services, validation
services        → domain, interfaces (ports)
domain          → nothing (pure, no I/O, no Date.now — inject IClock)
providers/infra → implement ports; may use SDKs
```
Enforced by `eslint-plugin-boundaries` (M0-05).

### 3.3 Error handling

- Services return `Result<T>`; throwing allowed only for programmer errors (invariant violations).
- Every `AppError` shown to the user has `remediation` (≥ 1 step).
- Never swallow errors: log at `warn`/`error` with context ids.

## 4. React UI

- Function components + hooks only. State: Zustand (UI/session state), TanStack Query (RPC data). No business logic in components — derive in sidecar.
- Money only through `<Money value={MoneyDisplay}/>` (USD line 1, VND line 2). Never format currency in React.
- Model output rendered only through `<SafeMarkdown>` (react-markdown + rehype-sanitize). `dangerouslySetInnerHTML` is forbidden.
- Styling: Tailwind CSS; component primitives from shadcn/ui (copied into `apps/desktop/src/components/ui`).
- Accessibility: every interactive element keyboard reachable, labelled; color contrast AA.
- Files: `PascalCase.tsx` for components, `useCamelCase.ts` for hooks.

## 5. Naming & layout

| Item | Convention |
|---|---|
| Files (non-component) | `kebab-case.ts` |
| Interfaces for ports | `I` prefix (`ILlmProvider`) — ports only |
| Types / interfaces | `PascalCase` |
| Functions / vars | `camelCase` |
| Constants | `UPPER_SNAKE_CASE` |
| Test files | `*.test.ts(x)` next to the source; contract tests in `__contract__/` |
| RPC methods | `domain.verb` (`ledger.query`) |
| Branches *(dev)* | `task/<ID>-short-slug` *(guideline; main-only is acceptable while solo)* |

## 6. Testing

> Full strategy, levels, black-box/white-box techniques and the milestone QA gate: **`TESTING.md`**. Safety-critical modules require 100 % branch coverage (TESTING.md §4).

- Runner: **vitest** (all packages). UI: @testing-library/react. Extension: `@vscode/test-electron` for 1 smoke test.
- Coverage gate: `domain/` ≥ 90 % lines; services ≥ 80 %; overall ≥ 70 % (M0-06 sets thresholds).
- No real network in tests: providers tested via recorded fixtures (`msw` for HTTP). No real keychain: in-memory `ISecretStore`.
- Every bug fix adds a regression test.
- Required cases per feature: success, each documented failure path, boundary inputs.

## 7. Security rules

| Area | Rule |
|---|---|
| Secrets | Only via `ISecretStore` (keychain). Never in code, config, logs, DB, test fixtures, error messages, child env. Pre-commit `gitleaks`-style scan (M0-05). `.env` files forbidden for provider keys. |
| XSS | No raw HTML from any model/user/RAG source. `<SafeMarkdown>` only. CSP per ARCH §11. |
| SQL injection | Drizzle builder / bound parameters only. `sql.raw` forbidden outside `migrations/`. |
| Command injection | `spawn(file, args, { shell: false })` only; executable + args from allow-list config; never interpolate model/user strings into commands. |
| Path traversal | All workspace paths through `resolveSafe` (ARCH §9.1). |
| Deserialization | All JSON crossing a boundary is zod-parsed. |
| Dependencies | Exact versions in lockfile; justify every new dependency in the task Result section; prefer well-maintained packages. |
| Logging | pino redact list maintained in `infra/logger.ts`; prompts/responses logged only at `debug`. |

## 8. Git & commits (dev pipeline)

- Conventional Commits: `type(scope): subject [TaskID]` — types `feat fix refactor test docs chore build perf`.
  e.g. `feat(router): add circuit breaker [M2-05]`
- Checkpoint commits before each Codex run: `chore: checkpoint before <ID>`.
- Never commit: secrets, `.itstudio/`, build outputs, `node_modules`, `*.db`.
- Commit trailer for AI-authored commits: `Co-Authored-By:` line as configured by the harness.

## 9. Changelog format (`CHANGELOG.md`)

[Keep a Changelog](https://keepachangelog.com) + SemVer. Sections under `## [Unreleased]`: `Added`, `Changed`, `Fixed`, `Security`, `Deprecated`, `Removed`, `Docs`.
Line format: `- <imperative summary> ([<TaskID>](docs/tasks/<TaskID>.md))`.
Release: move Unreleased to `## [x.y.z] - YYYY-MM-DD`.

## 10. Review checklist (QA uses this verbatim)

- [ ] Diff touches only the task's *Scope* paths
- [ ] `typecheck`, `lint`, `test` pass; coverage thresholds hold
- [ ] No `any` / `@ts-ignore` / `eslint-disable` / TS `enum` / default export
- [ ] Contracts used from `@itstudio/schemas`; no local redeclarations; `schemas.ts` unchanged unless task allowed
- [ ] External input zod-validated
- [ ] Services return `Result`; errors carry remediation
- [ ] No secrets; no raw HTML rendering; no string SQL; no `shell: true`; paths via `resolveSafe`
- [ ] Money as integer µUSD; display via `MoneyDisplay`
- [ ] Tests cover success + failure + edge cases; no real network
- [ ] Each acceptance criterion demonstrably met
- [ ] Task file has `## Result`; CHANGELOG line drafted
