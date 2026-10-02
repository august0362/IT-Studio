# M1-FIX2 — Sidecar lifecycle logging (BUG-M1-003)

Milestone: M1 · Depends on: M1-02, M1-05 · Role: Implementer (ROLES §1.3) · **Deps pre-installed**

## Defect
**BUG-M1-003** (S3): after a normal app run, `%APPDATA%/com.itstudio.app/logs` is empty — the sidecar logs nothing at `info`, so restarts and startup problems cannot be diagnosed (ARCH §13).

## Scope
- `apps/sidecar/src/main.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/services/system-service.ts`, tests next to them (+ Result in this file).

## Requirements
1. Log at `info` with `svc` field: `sidecar starting` {version, pid, node version, dataDir}; `migrations applied` {count}; `seeds loaded` {models, warnings count}; `sidecar ready` {startupMs}; `shutdown requested`; `sidecar exiting` {code}.
2. Never log secrets or settings JSON. Keep stdout protocol-only.
3. Tests: capture the logger stream in an in-process container start/stop and assert the lifecycle messages appear in order; assert the daily log file is created in a temp data dir after start.

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0
- [ ] Running the sidecar once creates `logs/sidecar-YYYYMMDD.log` containing the lifecycle lines

## Hand-back
Append `## Result` per AGENTS.md §3.
