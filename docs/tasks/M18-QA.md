# M18-QA — Milestone QA gate: Remote file manager

Milestone: M18 · Depends on: M18-01…M18-05 · Size M · Process TESTING §7.

## Planned cases (`docs/qa/M18-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M18-001 | browse, home, sorting; Windows-host paths | scenario + EP | L3 | P1 |
| TC-M18-002 | remote path traversal corpus rejected | security negative | L2 | P1 |
| TC-M18-003 | delete file / empty dir; non-empty refused; never recursive | decision table | L3 | P1 |
| TC-M18-010 | edit `.env` with diff + backup (exit criterion) | scenario | L3 | P1 |
| TC-M18-011 | concurrent remote change → conflict (exit criterion) | state | L3 | P1 |
| TC-M18-012 | undo restores backup (exit criterion) | scenario | L3 | P1 |
| TC-M18-013 | fault injection during write → old or new content, backup present | NFR-V3-08 | L3 | P1 |
| TC-M18-014 | EOL / trailing newline / BOM preserved; binary & > 5 MB blocked (5 MB ± 1 B) | BVA + EP | L2/L3 | P1 |
| TC-M18-015 | backup retention 5 | BVA | L3 | P2 |
| TC-M18-020 | upload / download 0 B, 5 MB; overwrite confirm; cancel cleans temp files | scenario | L3 | P1 |
| TC-M18-021 | protected local path (app data) rejected | security | L2 | P2 |
| TC-M18-030 | E2E edit compose file → save → undo | scenario | L4 | P1 |
| TC-M18-031 | keyboard-only file manager | usability | L4 | P2 |
| TC-M18-040 | (optional live) edit a file on a real host | acceptance | L5 | P2 |
