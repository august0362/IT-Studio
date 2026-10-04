# M16-QA — Milestone QA gate: Metrics, monitoring & alerts

Milestone: M16 · Depends on: M16-01…M16-07 · Size M · Process TESTING §7.

## Planned cases (`docs/qa/M16-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M16-001 | Linux fixtures → expected samples (golden) | EP | L2 | P1 |
| TC-M16-002 | macOS fixtures | EP | L2 | P1 |
| TC-M16-003 | Windows fixtures (object/array forms) | EP | L2 | P1 |
| TC-M16-004 | first sample rates 0; counter reset → 0 | BVA | L2 | P1 |
| TC-M16-005 | garbled sections → partial sample, no crash | error guessing | L2 | P2 |
| TC-M16-010 | watched server polled at interval | scenario | L3 | P1 |
| TC-M16-011 | tab hidden + background off → 0 execs (exit criterion) | NFR-V3-01 | L3 + L4 | P1 |
| TC-M16-012 | background on → all servers polled; interval 3 / 60 boundaries | BVA | L3 | P1 |
| TC-M16-013 | single-flight + late flag; offline after 2 failures | state | L3 | P2 |
| TC-M16-020 | alert debounce (RAM > 90 % for 60 s) fires once, resolves | BVA + state | L2+L3 | P1 |
| TC-M16-021 | rule disabled mid-pending; battery charging ignored | decision table | L2 | P2 |
| TC-M16-030 | card shows CPU/RAM/net/disk; battery hidden when null | scenario | L4 | P1 |
| TC-M16-031 | RAM > 90 % condition → toast (exit criterion) | scenario | L4 | P1 |
| TC-M16-032 | 20 servers at 3 s: no long tasks > 50 ms | NFR-V3-03 | L4 perf | P2 |
| TC-M16-040 | (optional live) real Linux host metrics plausible vs `top`/`free` | acceptance | L5 | P2 |
