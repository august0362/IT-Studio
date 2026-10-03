# M6-FIX2 — Worker cannot create files in new directories (BUG-M6-002, S1)

Role: Implementer (ROLES §1.3) · **Deps pre-installed** · Found in the QA E2E session 2026-10-03 (TC-M6-070: "Failed during Write changes … INTERNAL … rolled back").

## Defect
`PreparedWriteTransaction.commit()` writes `<target>.itstudio-tmp` and renames it without creating the parent directory. Any `create` (or `rename` destination) inside a directory that does not exist yet fails → whole transaction rolled back → pipeline ROLLED_BACK. QA reproduction with `NodeFileSystem`: `create src/new/deep.txt` in an empty workspace → `prepare` ok, `commit` → `INTERNAL`, file absent. Masked so far because (a) the integration fixture pre-creates `src/`, (b) `MemoryFileSystem` silently creates missing parents.

## Read first
- `AGENTS.md`, `ARCHITECTURE.md` §9.2–§9.4 (prepare / commit / rollback / crash recovery, byte-identical rollback), `apps/sidecar/src/services/{write-transaction,journal-recovery}.ts`, `apps/sidecar/src/infra/{memory-file-system,node-file-system}.ts`, `ports/file-system.ts`

## Scope
- `apps/sidecar/src/services/write-transaction.ts` (+ test), `apps/sidecar/src/services/journal-recovery.ts` (+ test, only if the manifest format changes), `apps/sidecar/src/infra/memory-file-system.ts` (+ test), `apps/sidecar/src/infra/__contract__/**` (file-system contract), `apps/sidecar/test/integration/pipeline.test.ts` (one new case)

## Requirements
1. Commit creates missing parent directories (recursive) for `create` targets and `rename` destinations **inside the workspace only** (paths already validated by `resolveSafe`).
2. The journal records every directory the transaction created (deepest last) so that **rollback and crash recovery remove exactly those directories** (if empty) and the tree is byte-identical to before — no leftover empty folders.
3. `MemoryFileSystem.writeFile` / `rename` must fail with the same error kind as Node (`ENOENT`-style `Result` failure) when the parent directory does not exist; add a shared file-system contract test run against both implementations so fakes can no longer hide this class of bug. Fix any existing tests that relied on the lenient behaviour.
4. Write-transaction and path-guard stay at **100 % branches**.

## Tests
- Unit (memory FS, now strict): create in a new nested dir → committed; rollback after partial commit removes created dirs; rename into a new dir.
- Integration `TC-M6-034` (L3): empty workspace (no `src/`), coder creates `src/feature/new.txt`, validation passes → COMPLETED, file on disk. And a variant with failing validation → ROLLED_BACK, tree hash identical (no `src/` left behind).

## Acceptance criteria
- [ ] `npm run typecheck && npm run lint && npm test` exit 0; coverage gates; QA runs integration. Do not run E2E.

## Hand-back
Append `## Result` per AGENTS.md §3.

## Architect decision (resolves Blocked)
Scope extended to `apps/sidecar/src/ports/file-system.ts` and `apps/sidecar/src/infra/node-file-system.ts` (+ their tests and the contract test). Add `rmdirIfEmpty(path: string): Promise<Result<boolean>>` to `IFileSystem` — removes the directory only when it is empty (`true` = removed, `false` = not empty or absent; never recursive, never follows symlinks). Implement it in `NodeFileSystem` (Node `rmdir`, map `ENOTEMPTY`/`ENOENT` to `false`) and `MemoryFileSystem`; update any other `IFileSystem` fakes in tests minimally.
