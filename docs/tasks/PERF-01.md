# PERF-01 — Sidecar cold start and UI main chunk

Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Problem (measured by QA 2026-10-02/03)
- `node --import tsx src/main.ts` takes ≈ 4 s before `main` runs (e.g. `html-to-text` ≈ 1.7 s, LanceDB native, PDF/DOCX parsers) — slows app start, integration tests (several timeouts) and E2E.
- The E2E crash hook `ITSTUDIO_E2E_CRASH_ON_START` runs only after the whole container graph is imported.
- Desktop main JS chunk 1.13 MB because Recharts (Cost tab) is imported eagerly.

## Scope
- `apps/sidecar/src/main.ts`, `apps/sidecar/src/container.ts` (composition only), the modules that import heavy deps (`services/rag/parsers/**`, `infra/lancedb/vector-store.ts`, `services/pricing-updater.ts`, embedding providers) — switch heavy imports to lazy `await import()` on first use behind the existing ports; no behaviour change.
- `apps/desktop/src/shell/AppShell.tsx` (lazy Cost tab like the Code tab), tests.
- `scripts/dev/measure-startup.mjs` (new): measures sidecar time-to-ready (spawn → `ready` line) 5× and prints the median.

## Requirements
1. Crash-on-start hook runs before importing the container (dynamic import of `./container.js` in `main.ts`).
2. Lazy-load: `html-to-text`, `pdfjs-dist`, `mammoth`, `@lancedb/lancedb` + `apache-arrow`, the pricing updater's HTML conversion — loaded on first use; failures still surface as `Result` errors.
3. Targets: sidecar time-to-ready median **< 1.5 s** in dev (report before/after with the script); desktop main chunk **< 800 kB**; no test changes beyond what the lazy boundaries require; all existing tests pass.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; numbers reported in `## Result`. QA runs integration. Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.
