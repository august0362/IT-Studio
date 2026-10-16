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

## Result
- Summary: Deferred parser, LanceDB/Arrow, embedding SDK, and pricing HTML imports to first use; moved the E2E crash hook ahead of container loading; lazy-loaded the Cost tab. The desktop main chunk is 684.18 kB (target < 800 kB).
- Files changed: `apps/sidecar/src/main.ts`, `apps/sidecar/src/services/rag/parsers/parse-document.ts`, `apps/sidecar/src/infra/lancedb/vector-store.ts`, `apps/sidecar/src/services/pricing-updater.ts`, `apps/sidecar/src/providers/embedding/openai.ts`, `apps/sidecar/src/providers/embedding/google.ts`, `apps/desktop/src/shell/AppShell.tsx`, `scripts/dev/measure-startup.mjs`, `docs/tasks/PERF-01.md`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Kept provider SDK-specific error classification using classes obtained from the deferred imports; the existing `Result` boundaries continue to report parser, pricing, vector store, and embedding failures.
- Open issues / follow-ups: `npm --cache .npm-cache run typecheck`, `npm --cache .npm-cache run lint`, and `npm --cache .npm-cache test` pass (112 files passed, one skipped; 783 tests passed, one skipped). The desktop production build reports `dist/assets/index-Bm1Brz0h.js` at 684.18 kB and the Cost page as a separate 405.50 kB chunk. Startup before/after medians are unavailable: `node scripts/dev/measure-startup.mjs` fails before the sidecar starts because `tsx` calls `os.userInfo()` and the sandbox returns `uv_os_get_passwd ... ENOMEM`. Run the script outside this sandbox to capture both medians; the < 1.5 s startup target remains unverified.

## QA (Claude)
- Measured outside the sandbox (5 runs, time to first stdout message, `ITSTUDIO_E2E=1`, in-memory DB): **before 3.97 s → after 2.82 s median (−29 %)**. The < 1.5 s target is **not met in dev**; the remainder is `tsx` transpiling the TypeScript graph at runtime — re-measure on the esbuild/SEA bundle in M9 (target stays < 1.5 s there). Desktop main chunk 684 kB ✔ (< 800 kB). Defect in `scripts/dev/measure-startup.mjs`: spawns the sidecar without a stdin pipe, so it exits on EOF before "ready" (M1-FIX4 behaviour) — follow-up for Codex.
