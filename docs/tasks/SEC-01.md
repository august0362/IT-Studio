# SEC-01 — Production dependency audit hardening

Role: Implementer (ROLES §1.3) · Dependency changes **allowed in this task** (package.json / lockfile only as listed).

## Findings (`npm audit --omit=dev`, 2026-10-03)
- 3 high: `sharp` (libvips CVE-2026-33327/33328/35590/35591) via `@lancedb/lancedb` → `@huggingface/transformers` → `sharp`.
- 1 low: `dompurify` (IN_PLACE hook) via `monaco-editor` 0.57.

## Scope
Root / workspace `package.json` (`overrides` or dependency changes), `package-lock.json`, minimal code changes if an API changes, a release-checklist note in `docs/RUNNING.md` §6.

## Requirements
1. Remove the high findings with the least invasive option, in this order of preference: (a) `overrides` to a patched `sharp` version that still satisfies the dependents; (b) if `@huggingface/transformers` is an optional/peer dependency we never call (we use API embeddings, D4), exclude it so `sharp` is not installed; justify the choice in `## Result`.
2. Low finding: override `dompurify` to a patched version if one exists and Monaco still works (desktop build + Code tab unit tests); otherwise document it as accepted risk (Monaco hover only renders our own content).
3. Add `npm run audit:prod` = `npm audit --omit=dev --audit-level=high`; it must exit 0.
4. All gates pass; LanceDB ingest/retrieval tests still pass.

## Acceptance criteria
- [ ] `npm run audit:prod` exit 0; `npm run typecheck && npm run lint && npm test` exit 0; QA runs integration. Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3 (before/after audit output).
