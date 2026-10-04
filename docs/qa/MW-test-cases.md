# MW — Workflow map test cases

> QA gate `MW-QA` · D32 · Levels: L2 unit/component · L3 real sidecar/integration · L4 real desktop app (WebDriver).
> Dependency: MW-04 must be integrated before the full MW regression; E2E execution waits for M8-QA to release WebDriver.

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-MW-003 | Scripted chat project and aggregate counters | Router calls are counted for the selected project and for `projectId: null`; existing recorder unit and integration coverage | L2/L3 | P1 | exists |
| TC-MW-004 | RAG chat + pipeline validation command | Retriever, embeddings, and command-runner events are recorded with redacted summaries; existing integration case | L3 | P1 | exists |
| TC-MW-005 | Workflow topology contract | Exact module-to-lane catalogue and every edge ID, endpoint, and schema contract match ARCHITECTURE §13.1 | L2 | P1 | automated |
| TC-MW-006 | Event mapping and redaction | Internal source families map to the expected module/edge/kind; prompt/query text and secret-bearing command arguments do not enter summaries. Existing public-event mapping corpus remains in `activity-recorder.test.ts` | L2 | P1 | automated |
| TC-MW-007 | Activity retention | Seven-day cutoff is strict at the boundary; the 20,000-row cap is applied independently per project | L2 | P1 | automated |
| TC-MW-008 | 100-event notification burst | One burst schedules one animation-frame update and applies all 100 events, counts, and summaries | L2 | P1 | automated |
| TC-MW-009 | Workflow deep links | A selected activity keeps its refs through navigation; Chat selects a conversation, Code a pipeline run, Knowledge an ingest job, and Cost the referenced ledger entry | L2 | P1 | automated |
| TC-MW-010 | Scripted chat routing in the real app | Router call counter increments; Recent shows a completed model summary and omits the prompt | L4 | P1 | passed 2026-10-04 |
| TC-MW-011 | Ingest, RAG chat, and validated pipeline in the real app | Workflow history shows embedding, retriever, and command-runner activity for the same project; summaries omit document/query text and a private pipeline-prompt marker. Secret command args are covered by TC-MW-006 | L4 | P1 | passed 2026-10-04 |

## Automated coverage

- TC-MW-005: `apps/sidecar/src/domain/workflow-topology.test.ts`
- TC-MW-006: `apps/sidecar/src/services/workflow-qa.test.ts`; public mapping corpus remains covered by `apps/sidecar/src/services/activity-recorder.test.ts`.
- TC-MW-007: `apps/sidecar/src/infra/sqlite/activity-repository.test.ts` using real in-memory SQLite.
- TC-MW-008 and TC-MW-009: `apps/desktop/src/features/workflow/WorkflowPage.test.tsx`.
- TC-MW-009 selection consumers: `ChatPage.test.tsx`, `CodePage.test.tsx`, `knowledge-components.test.tsx`, and `LedgerTable.test.tsx`.
- TC-MW-010/011: `e2e/specs/mw/workflow.spec.ts`; both passed with WebDriver after M8-QA released it.

## Hand-back gates

Targeted L2 suites passed. TC-MW-010/011 passed in the MW E2E spec after M8-QA released WebDriver. Do not change TC-MW-004 or its task report as part of this QA work.
