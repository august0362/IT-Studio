# M17-QA — Milestone QA gate: Docker management

Milestone: M17 · Depends on: M17-01…M17-05 · Size M · Process TESTING §7.
Test doubles: fake Docker Engine behind the fake SSH server (`dial-stdio`); optional live host with Docker (Q-10).

## Planned cases (`docs/qa/M17-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M17-001 | Docker unavailable: not installed / no permission → remediation | EP | L3 | P1 |
| TC-M17-010 | list / inspect (env values redacted) | scenario | L3 | P1 |
| TC-M17-011 | start / stop / restart, invalid id, 404 | EP | L3 | P1 |
| TC-M17-012 | events → UI refresh; unexpected exit → alert; user stop → no alert | decision table | L3 | P1 |
| TC-M17-020 | logs tail/follow, stdout/stderr demux | scenario | L3 | P1 |
| TC-M17-021 | 5 000 lines/s for 60 s: UI responsive, memory bounded, drop banner | NFR-V3-04 | L4 perf | P1 |
| TC-M17-022 | stream limit 4; auto-close on drawer close / container stop | BVA + state | L3 | P2 |
| TC-M17-030 | drawer E2E: list → restart with confirmation → logs | scenario | L4 | P1 |
| TC-M17-031 | no log content in sidecar logs / activity | security | L3 + scan | P2 |
| TC-M17-040 | (optional live) real host containers | acceptance | L5 | P2 |
