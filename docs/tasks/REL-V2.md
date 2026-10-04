# REL-V2 — Release v2.0.0

Depends on: M14-QA (all v2 milestones signed off) · Roles: Architect (checklist, docs) + Implementer (only if a script needs changes) · Size S
Reference: `docs/RUNNING.md` release checklist, M9 scripts, SRS v2 §10.

## Steps
1. Upgrade test (NFR-V2-10): copy a v1 data dir fixture (`apps/sidecar/test/fixtures/v1-datadir/`, created by QA from a v1 install: projects, chats, ledger, RAG docs) → start the v2 sidecar → migrations apply, seeds added, v1 data intact (`TC-REL2-001`, L3; Codex writes the test if missing).
2. `npm run audit:prod` (0 high); license check of new dependencies.
3. `npm run release:bump -- 2.0.0`; CHANGELOG: move Unreleased → `[2.0.0] - <date>` with a v2 summary.
4. `npm run build:sidecar && npm run smoke:sidecar && npm run build:app && npm run smoke:install`.
5. Update `docs/RUNNING.md` (Inbox, Agents, Memory, guides), `docs/HANDOFF.md` §1, ROADMAP progress table.
6. Tag `v2.0.0` locally (no push unless the owner asks).

## Acceptance
- [ ] All steps green and recorded in `docs/qa/REL-V2-report.md` (versions, sizes, timings).
