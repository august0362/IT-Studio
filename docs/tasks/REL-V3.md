# REL-V3 — Release v3.0.0

Depends on: M19-QA (all v3 milestones signed off) · Roles: Architect + Implementer (scripts only if needed) · Size S
Reference: `docs/RUNNING.md` release checklist, REL-V2, SRS v3 §10.

## Steps
1. Upgrade test from a v2 data dir fixture (settings gain `monitoring`, new tables created, v2 data intact) — `TC-REL3-001` (L3).
2. `npm run audit:prod`; license check of v3 dependencies (`ssh2`, `dockerode`, plugins, `react-virtuoso`).
3. `npm run release:bump -- 3.0.0`; CHANGELOG `[3.0.0]`.
4. Build + smoke: `build:sidecar`, `smoke:sidecar` (verify `ssh2` loads in the SEA binary), `build:app`, `smoke:install`.
5. Packaged-app check against the fake SSH server **and** (if available) one real host: add server, metrics, containers, edit a file, (no reboot unless the owner agrees).
6. Update `docs/RUNNING.md` (Servers tab, guides), HANDOFF, ROADMAP progress.
7. Tag `v3.0.0` locally.

## Acceptance
- [ ] All steps recorded in `docs/qa/REL-V3-report.md`.
