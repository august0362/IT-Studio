# M10-QA — Milestone QA gate: Agent Orchestrator

Milestone: M10 · Depends on: M10-01…M10-09 · Roles: QA (Claude) designs + executes, Implementer (Codex) automates · Size M
Process: TESTING.md §7 (lean routine, HANDOFF §2.3).

## Step 1 — QA writes `docs/qa/M10-test-cases.md`
Cover every M10 exit criterion and every FR-AG requirement (traceability matrix). Planned cases (IDs may be refined):

| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M10-001 | 6 built-ins seeded, idempotent on restart | scenario | L3 | P1 |
| TC-M10-002 | clone → edit → persists after restart | scenario | L3 | P1 |
| TC-M10-003 | built-in edit/delete rejected | EP | L3 | P1 |
| TC-M10-004 | agent validation boundaries (name 60/61, prompt 8000/8001, ladder 5/6) | BVA | L2 | P1 |
| TC-M10-010 | agent chat with tool call → run completed, ledger `agent` + `agentRunId` | scenario | L3 | P1 |
| TC-M10-011 | tool policy decision table, forged calls rejected (`TOOL_NOT_ALLOWED`) | decision table | L2+L3 | P1 |
| TC-M10-012 | `start_pipeline` waits for confirmation; dismiss; confirm with edited prompt | state transition | L3 | P1 |
| TC-M10-013 | tool loop 0 / 1 / 6 / 7 calls | path testing | L2 | P1 |
| TC-M10-014 | cancel mid-stream → `cancelled`, partial cost recorded | error guessing | L3 | P2 |
| TC-M10-015 | Hard Stop blocks agent run before provider call | decision table | L3 | P1 |
| TC-M10-020 | routing rules order / catch-all / channel mismatch rejected | decision table | L3 | P2 |
| TC-M10-021 | pipeline regression: M6 L3 suite with agent ladders | regression | L3 | P1 |
| TC-M10-022 | roleAssignment migration (default vs custom) | EP | L3 | P2 |
| TC-M10-030 | Agent Builder clone → rename → reload | scenario | L4 | P1 |
| TC-M10-031 | chat with PM agent → pipeline confirm → Code tab shows run | scenario | L4 | P1 |
| TC-M10-032 | agent cost visible in Cost & P&L by purpose `agent` | scenario | L4 | P2 |
| TC-M10-033 | Workflow map shows Agent runner activity without user text | security negative | L3 | P2 |
| TC-M10-034 | idle 10 min with agents configured → 0 ledger rows | NFR-V2-01 | L3 | P1 |

## Step 2 — Codex automates the cases marked automated
Task text for `run-task.sh M10-QA`: implement the L2/L3 cases in `apps/sidecar/test/integration/agents-qa.test.ts` (+ unit gaps) and L4 in `e2e/specs/m10/*.spec.ts` (per-spec fresh data dir — R-12), case IDs in test names; do not run E2E.

## Step 3 — QA executes
Lean routine + targeted E2E + 20-min exploratory session (agent personas, Vietnamese text, keyboard-only Builder) → `docs/qa/M10-report.md` (verdict, coverage, defects `BUG-M10-nnn`).

## Exit
100 % P1, ≥ 95 % P2, no open S1/S2, coverage gates (§ task files), report committed, ROADMAP M10 ticked, HANDOFF updated.
