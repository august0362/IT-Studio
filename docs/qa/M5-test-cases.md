# M5 — Test Case Specification (RAG: parse, chunk, embed, ingest, retrieve, Knowledge UI)

> QA gate `M5-QA` · Author: QA (Claude) · 2026-10-02 · Strategy: `TESTING.md`
> Scope: M5-01…M5-07. Levels: **L1/L2** unit · **L3** real sidecar + real SQLite + real LanceDB in a temp dir, `ITSTUDIO_E2E=1` fake embeddings (deterministic, no network) · **L4** real app (Knowledge tab, chat citations) — executed by QA in the batched E2E session.
> Status: **exists** = automated already · **new** = automate in M5-QA · **split** = currently combined in one `it`, split per ID for traceability.

## 1. Black-box cases

### 1.1 Parsing & discovery (EP)

| ID | Partition | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M5-030 | md / txt / ts / py / pdf / docx / html | each parsed to text; title from first heading or file name; format detected | L2 | P1 | exists (parsers) — verify all 7 |
| TC-M5-031 | Corrupt pdf / zero-byte / binary with `.md` extension | per-file `failed` with AppError; job continues | L3 | P1 | exists (TC-M5-001 corrupt pdf) — add zero-byte + binary |
| TC-M5-032 | Size limit | 20 MB exactly accepted; 20 MB + 1 B skipped with reason | L2 | P1 | exists (discover) — verify |
| TC-M5-033 | Ignored dirs & symlinks | `.git`, `node_modules`, `.itstudio`, `dist`, `build`, `target`; symlink loop | skipped; no hang | L2 | P1 | exists — add symlink loop |
| TC-M5-034 | Path safety | `../outside.md`, absolute path outside workspace, `C:\Windows\win.ini` | `VALIDATION`, nothing queued | L3 | P1 | new |
| TC-M5-035 | Unicode & long paths | Vietnamese file names, path > 260 chars | parsed and listed correctly | L3 | P2 | new |

### 1.2 Chunking (BVA)

| ID | Item | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M5-040 | Target 500 / overlap 80 tokens | chunk sizes ≤ target (except single oversize sentence), overlap present | L1 | P1 | exists — verify |
| TC-M5-041 | Heading-aware split | `sectionPath` trail correct across H1→H3, reset on new H1 | L1 | P1 | exists — verify |
| TC-M5-042 | Edge docs | empty doc, single token, no headings, 10 000-line code file | no empty chunks; deterministic ordinals | L1 | P1 | new (carry-over: **chunker ≥ 90 % branches**) |

### 1.3 Ingest jobs

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M5-001 | Ingest folder (md + ts + corrupt pdf) | job `indexed`, 2 docs, `rag.progress` sequence, ledger `embedding` rows | L3 | P1 | exists — **split** |
| TC-M5-002 | Delete document | rows + vectors removed (`count` drops) | L3 | P1 | exists — **split** |
| TC-M5-003 | Re-ingest unchanged | all `skipped_unchanged`, **zero** new ledger rows | L3 | P1 | exists (in 001) — split |
| TC-M5-004 | Re-ingest changed file | same DocumentId, old chunks gone, new count | L3 | P1 | new |
| TC-M5-005 | All files fail | job `failed` with first AppError | L3 | P2 | new |
| TC-M5-006 | Hard Stop during ingest | job `failed` `BUDGET_HARD_STOP`, remaining files untouched | L3 | P1 | covered by TC-M3-037 |
| TC-M5-007 | Two jobs same project / two projects | FIFO per project; parallel across projects | L2 | P2 | exists (unit) |
| TC-M5-008 | Embedding model dimension change | next ingest re-embeds every document of the project | L2 | P1 | exists (unit) — verify |
| TC-M5-009 | Embedding fallback | primary embedding provider 503 → same-dimension fallback used, metered under the fallback model | L3 | P2 | new |

### 1.4 Retrieval & chat

| ID | Case | Expected | Level | Pri | Status |
|---|---|---|---|---|---|
| TC-M5-010 | `rag.query` ordering & minScore | hits sorted, all ≥ minScore; minScore boundary (= kept, below dropped) | L3 | P1 | exists — **split** |
| TC-M5-011 | Chat with RAG on | assistant has `citation` part for `[1]` = first hit | L3 | P1 | exists — **split** |
| TC-M5-012 | Exactly one embedding call per query | ledger shows 1 embedding row per `rag.query` | L3 | P1 | new (regression for M5-06 fix) |
| TC-M5-013 | Model mismatch | index built with model A, settings switched to model B (different dims) → `rag.query` `VALIDATION` "re-index required" | L3 | P1 | new |
| TC-M5-014 | Prompt injection in documents | doc text contains `</context>` / `</CONTEXT>` + instructions | neutralised in the system prompt sent to the provider (inspect scripted request) | L3 | P1 | new |
| TC-M5-015 | RAG off | no retrieval call, no embedding row | L3 | P2 | new |
| TC-M5-016 | Retrieval failure | embedding provider down → answer still produced without RAG, warning logged | L3 | P2 | new |
| TC-M5-017 | Citation parsing | `[2][1]`, `[9]` out of range, repeated `[1]` | ordered, deduplicated, out-of-range ignored | L1 | P2 | exists (unit) |
| TC-M5-018 | tagFilter all-of | docs tagged {a}, {a,b} → filter [a,b] returns only the second | L3 | P2 | new |

### 1.5 Knowledge UI (L4 — batched E2E session)

| ID | Case | Expected | Pri | Status |
|---|---|---|---|---|
| TC-M5-020 | Add a markdown source → table shows 1 doc → test query returns a hit | as described | P1 | exists (spec written, not executed) |
| TC-M5-021 | Validation error shown | add `../x.md` → inline error with remediation | P2 | new |
| TC-M5-022 | Delete with confirm / cancel | cancel keeps row; confirm removes | P2 | new |
| TC-M5-023 | Chat "Use knowledge" + citation chip | toggle on, send, chip `[1]` opens popover with chunk text (plain text) | P1 | new |

## 2. White-box targets

| Module | Gate | Measured 2026-10-02 (branches) | Action |
|---|---|---|---|
| `domain/chunker.ts` | ≥ 90 % (carry-over M5-02) | 81.6 % | **new tests** |
| `infra/lancedb/vector-store.ts` | ≥ 80 % | 77.2 % | add error-path tests (missing table, dimension mismatch) |
| `services/rag/rag-service.ts`, `retriever.ts`, `discover-files.ts`, `domain/mmr.ts`, `embedding-dispatcher.ts`, `parse-document.ts` | ≥ 90 % / 100 % (mmr) | 88.7–100 % | `parse-document.ts` 88.7 % → ≥ 90 %; `rag-service.ts` 89.2 % → ≥ 90 % |

## 3. Traceability

| Requirement | Cases |
|---|---|
| D4 RAG Method 2 (local index, API embeddings, metered) | TC-M5-001…009, 012 |
| ARCH §7.1 discovery / parse / skip / isolate / progress | TC-M5-030…035, 001…005 |
| ARCH §7.2 minScore, MMR, citations, injection | TC-M5-010…018 |
| ARCH §7.3 embedding model change | TC-M5-008, 013 |
| ARCH §11 prompt-injection neutralisation | TC-M5-014 |
| D7 Hard Stop applies to embeddings | TC-M5-006 (= TC-M3-037) |
| M5-07 UI | TC-M5-020…023 |

## 4. Exploratory charter (20 min, QA)
Ingest a large mixed folder (real repo docs), rename/move files between ingests, delete files on disk after ingest, query in Vietnamese, toggle RAG mid-conversation; look for orphan vectors, duplicate documents, wrong citations, unmetered calls.
