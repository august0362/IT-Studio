# M6 — QA Report — CONDITIONAL SIGN-OFF (E2E follow-up open)

> Gate `M6-QA` · QA: Claude · 2026-10-03 · Test cases: `docs/qa/M6-test-cases.md`

## Results
| Level | Result |
|---|---|
| L1/L2 unit | all pass; path-guard 100 %, pipeline-machine 100 %, template 100 %, command-runner 95.8 %, orchestrator 85 %; write-transaction **98.95 %** (2 defensive guards unreachable after `resolveSafe` — accepted deviation from the 100 % gate) |
| L3 integration | all pipeline cases pass incl. TC-M6-031 crash mid-commit recovery and TC-M6-034 (create in new directories, byte-identical rollback) |
| L4 E2E | Code tab loads lazily with bundled Monaco (TC-M4-050 pass); pipeline runs now reach WRITING → VALIDATING in the real app (BUG-M6-002 fix verified). **Open (test-setup):** TC-M6-070/071/072 — the E2E project has no passing validation command (default `npm test` fails in an empty temp project); follow-up **QA-E2E-FIX2** |
| Mutation | Stryker 10 × Vitest 5 incompatible (score not measurable, QA-TOOL-01); manual mutation of `template.ts` killed by TC-M6-060 |

## Defects
| ID | Sev | Summary | Status |
|---|---|---|---|
| BUG-M6-002 | **S1** | Worker could not create files in directories that did not exist → every such pipeline rolled back | Fixed (M6-FIX2): parent dirs created, journaled, removed on rollback/recovery; strict memory FS + contract test |
| BUG-M6-001 | S3 | Timeline marked never-run stages as done after an early failure | Fixed (M4-FIX2) |
| SEC-M6-060 | S2 | `</CONTEXT>` (upper/mixed case) not neutralised in context blocks | Fixed (M6-QA) |
| — | — | Run cost was always 0 (attribution lost in the router) | Fixed (M6-08) |

## Exit criteria
- [ ] 100 % P1 pass — **not met at L4**: TC-M6-070/071 open (follow-up QA-E2E-FIX2); the same flows pass at L3 (TC-M6-001/002/034).
- [x] no open S1/S2 · [~] coverage (write-transaction 98.95 %, documented) · [x] traceability · [x] report committed

**Sign-off:** M6 — Agent pipeline is **accepted for the v1 hand-over** with QA-E2E-FIX2 open. — QA (Claude), 2026-10-03

## Update 2026-10-03 (after M6-FIX2, PERF-01, QA-E2E-FIX3)
- **TC-M6-070 passes in the real app**: a scripted pipeline runs PM → Coder → Reviewer → Worker → Validate → **Completed** (confirms BUG-M6-002 fix end to end).
- TC-M6-071 / 072 still fail (validation-shim setup) after the 6th fix attempt → per the user's 6-attempt rule they are **skipped and reported**; behaviour covered at L3 (TC-M6-002, TC-M6-012).
