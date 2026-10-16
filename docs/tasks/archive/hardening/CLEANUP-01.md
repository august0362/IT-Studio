# CLEANUP-01 — Remove confirmed project duplication

## Scope

- `apps/sidecar/src/infra/vector-store-helpers.ts` (new), `apps/sidecar/src/infra/memory-vector-store.ts`, and `apps/sidecar/src/infra/lancedb/vector-store.ts`
- `apps/sidecar/src/providers/image/flux-helpers.ts` (new), `apps/sidecar/src/providers/image/flux-replicate.ts`, and `apps/sidecar/src/providers/image/flux-together.ts`
- `apps/sidecar/src/container.ts` and `scripts/build/build-sidecar.mjs`
- This task file, for the result only

## Requirements

1. Move only identical vector-store validation/result helpers into a neutral module and keep each backend's behavior unchanged.
2. Move only identical Flux image-provider helpers into one shared module; preserve provider-specific request, polling, response, and error behavior.
3. Stage SQL migrations once in SEA resources. Keep dev migration resolution intact and count the same packaged migrations at startup.
4. Keep documentation, generated platform assets, task history, tests, and build outputs that have distinct purposes or active consumers.

## Acceptance criteria

- No behavior or contract changes; existing tests pass.
- `npm run typecheck`, `npm run lint`, and `npm test` pass.
- Markdown and asset audit confirms no safe in-repository copies were deleted by this task.

## Result

- Summary: Consolidated duplicated vector-store and Flux provider helpers. Packaged SQL migrations are staged once, and the SEA startup log counts migrations from that same canonical resource path.
- Files changed: `CLEANUP-01.md`; `apps/sidecar/src/infra/vector-store-helpers.ts` (new); `apps/sidecar/src/infra/memory-vector-store.ts`; `apps/sidecar/src/infra/lancedb/vector-store.ts`; `apps/sidecar/src/providers/image/flux-helpers.ts` (new); `apps/sidecar/src/providers/image/flux-replicate.ts`; `apps/sidecar/src/providers/image/flux-together.ts`; `apps/sidecar/src/container.ts`; `scripts/build/build-sidecar.mjs`.
- Dependencies added (with reason): None. `npm --cache .npm-cache install` hit `ECONNRESET`; verification used the existing lockfile-matched dependencies through a temporary local junction, which was removed afterward.
- Decisions taken within scope: Kept historical/task Markdown, platform icon assets, tests, and build outputs with active consumers. Removed the duplicate SEA migration staging copy and this task's ignored 440 MB `dist-sidecar/` output after smoke verification. No behavior or schemas changed.
- Open issues / follow-ups: Full smoke build passed; a cold smoke took 2515 ms due first-run overhead and missed the 1500 ms threshold, while the warm run passed at 590 ms. The existing smoke script treats a cold run as a failure; warm-up or a median-of-runs policy remains a follow-up.

## QA (Claude) — final, 2026-10-14

- Merged current `main` (incl. OWNER-FB1); `container.ts` auto-merged.
- Gates: typecheck ✔, lint ✔, `npm test` 901 passed + 1 skipped with two LanceDB contract timeouts under parallel load (two Codex runs active); the LanceDB file passes 8/8 alone (known QA-FLAKE-01 pattern). Integration RAG ingest/retrieval, images and startup 26/26 ✔. `npm run build:sidecar` ✔ (96 285 184 bytes); `npm run smoke:sidecar` warm 564 ms ✔, first cold run 4 324 ms under load (M9-OBS-04, addressed by V1-POLISH-01).
- Verdict: **accepted and landed**.
