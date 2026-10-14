# QA-BREAK-01 — Adversarial suite: protocol, input validation, security boundaries

Milestone: v1 hardening (owner request 2026-10-14: "test every case you can think of that could break the project") · Role: Implementer (ROLES §1.3) · Tests only · **Deps pre-installed** · Runs in parallel with QA-BREAK-02 (disjoint scope)

## Goal

Try to break the sidecar and its security boundaries with hostile, malformed and extreme input. Every test asserts the **correct** behaviour from the contracts and decisions. A test that exposes a product defect stays in the suite as `it.fails('QA-BREAK-01-Dnn <description>', …)` so the suite stays green, and the defect is listed in `## Result`. Do **not** fix product code in this task.

## Read first

`AGENTS.md`, `CONTEXT.md` D2, D11, D13, D16, D34, `ARCHITECTURE.md` §3 (IPC), §8 (Worker), §11 (VS Code bridge), `src/types/schemas.ts`, `apps/sidecar/test/integration/harness.ts` (read-only), the existing integration tests for patterns (`protocol.test.ts`, `settings-projects.test.ts`, `secrets.test.ts`, `pipeline.test.ts`, `vscode-bridge.test.ts`, `web-chat.test.ts`).

## Scope — files you may create/modify

- `apps/sidecar/test/integration/break-protocol.test.ts` (new)
- `apps/sidecar/test/integration/break-validation.test.ts` (new)
- `apps/sidecar/test/integration/break-security.test.ts` (new)
- `apps/sidecar/test/integration/break-helpers-01.ts` (new; helpers only for these files)
- `apps/sidecar/test/integration/fixtures/break-01/**` (new)
- This task file (`## Result` / `## Blocked` only)

Do **not** edit `harness.ts`, other tests, product code, configs or `package.json`.

## Cases (name each test with its ID)

### Protocol (L3, real sidecar over stdio)
- **BRK-P01** A 5 MB single NDJSON line: rejected or handled; process stays alive; next `system.ping` succeeds.
- **BRK-P02** Invalid UTF-8 bytes and a lone `\r` mid-stream: `-32700`, process alive.
- **BRK-P03** JSON nested 10 000 levels deep: no stack overflow crash; error response; process alive.
- **BRK-P04** 2 000 concurrent requests mixing valid methods, unknown methods and invalid params: every id answered exactly once; no response lost or duplicated.
- **BRK-P05** Two in-flight requests with the **same id**: process alive and both answered or the duplicate rejected; record which.
- **BRK-P06** Params carrying `__proto__`, `constructor.prototype` and extra unknown keys on `settings.update` and `project.create`: rejected by strict validation, and `({}).polluted` is still `undefined` in a later probe (for example a `settings.get` response is unchanged).
- **BRK-P07** `id` of type object, array, boolean and float: `-32600`, process alive.
- **BRK-P08** stdin closed while a `chat.send` stream is in flight: sidecar exits cleanly within the shutdown budget (BUG-M7-001 regression).

### Input validation (L3)
- **BRK-V01** Project names: empty, whitespace only, 10 000 characters, emoji/RTL/zero-width characters, a name containing a newline, and a duplicate name: each either accepted and round-tripped byte-exactly, or rejected with `VALIDATION`; never a crash or a corrupted `project.list`.
- **BRK-V02** Money: budget and revenue with negative, zero, `NaN`, `Infinity`, `1e308`, more than 6 decimals, `Number.MAX_SAFE_INTEGER + 2` and a string-encoded number: rejected or stored exactly; integer µUSD invariants hold in `pnl.get` (no float drift, no negative totals).
- **BRK-V03** VND revenue with very large values and FX overrides of 0, negative, `1e-12` and `1e12`: rejected or computed without overflow; dual display values are finite.
- **BRK-V04** Date ranges for `ledger.query`, `pnl.get` and `revenue.list`: reversed range, `2026-02-30`, year 0001 and 9999, timezone-less strings and epoch 0: `VALIDATION` or an empty result, never a crash.
- **BRK-V05** Pagination: negative offset, a limit of 0, a limit of 10⁹ and a non-integer limit for `ledger.queryRows`, `chat.getMessages` and `workflow.activity`: bounded or rejected (regression for the SQLite `OFFSET` without `LIMIT` crash fixed in MW-01).
- **BRK-V06** `settings.update` with a partial patch that tries to replace the router ladder with an empty ladder, a ladder of unknown model ids, or duplicates: rejected or normalised; `router.getConfig` remains usable.
- **BRK-V07** `webchat.open` and saved web-chat sites with `javascript:`, `file:`, `data:`, `http://localhost`, `https://127.0.0.1`, an IDN homograph, a 3 000-byte URL and credentials in the URL (`https://user:pw@host`): rejected per D34 / OWNER-FB1 rules.

### Security boundaries (L3, temp project directories only)
- **BRK-S01** `workspace.readFile` with `..\..\`, an absolute path outside the root, a UNC path, a Windows device name (`CON`, `NUL`, `COM1`), a path with a trailing dot/space, an alternate data stream (`file.txt:secret`) and an 8.3 short name: rejected (D16).
- **BRK-S02** A directory junction and a symlink inside the project pointing outside it: `workspace.readFile` and a pipeline write through it are both rejected; the outside target is byte-identical afterwards. Skip with an explicit reason only if junction creation is impossible on the machine.
- **BRK-S03** `workspace.runCommand` with a non-allow-listed executable, an allow-listed executable followed by `&&`, `|`, `;`, `` ` ``, `$(…)` and `%COMSPEC%` in arguments: never executes a second command (place a canary file that must not be created).
- **BRK-S04** A scripted Coder reply (`ITSTUDIO_E2E_LLM_TEXT`) that writes outside `allowedPaths`, outside the root, to `.git/config` and to an existing file not in `allowedPaths`: the run fails, the journal rolls back, and the project tree is byte-identical (hash the tree before and after).
- **BRK-S05** Secrets: after `secrets.verifyAndSave` with a fake key that fails verification, and after `secrets.set` / `secrets.delete`, the full key string appears in no RPC response, event, log file under the data dir, or SQLite file (scan raw bytes). `secrets.history` shows at most the last 4 characters. Use the scripted verifier and fake key store from the existing tests; no real keychain.
- **BRK-S06** RAG prompt injection: ingest a fixture document containing `</context>`, `</CONTEXT >`, `<\/context>`, full-width `＜/context＞` and a fake "SYSTEM:" instruction; the prompt sent to the scripted LLM keeps the document inside the context block (D11 neutralisation, M6-QA regression).
- **BRK-S07** VS Code bridge: a connection with a wrong token, an empty token, a replayed token after the session rotated, a non-loopback `Origin` header, a 10 MB message and 500 rapid reconnects: all rejected without crashing the sidecar; a valid client still connects afterwards.

## Requirements

1. Use only `startSidecar` from `harness.ts` and fakes already available through `ITSTUDIO_E2E*` variables. No real network, provider or keychain.
2. Every test cleans up its temp directories and child processes, including on failure.
3. Keep each file under 60 s total runtime on a normal run.
4. The Codex sandbox cannot run the integration suite (`tsx` fails on `os.userInfo()`, ENV-1). Run `npm run typecheck` and `npm run lint` there; record that QA must run `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/break-*.test.ts`.

## Acceptance criteria

- [ ] Every case above exists as a test with its ID in the name (or an explicit `it.skip` with the reason the environment prevents it).
- [ ] Every defect found is an `it.fails('QA-BREAK-01-Dnn …')` test and a row in the `## Result` defect table: ID, case, severity guess (S1–S4), observed vs expected behaviour.
- [ ] `npx prettier --write <changed files>`, `npm run typecheck` and `npm run lint` pass.

## Hand-back

Append `## Result` per AGENTS.md §3, including the defect table.
