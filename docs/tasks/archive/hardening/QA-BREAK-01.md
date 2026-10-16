# QA-BREAK-01 — Adversarial suite: protocol, input validation, security boundaries

Milestone: v1 hardening (owner request 2026-10-14: "test every case you can think of that could break the project") · Role: Implementer (ROLES §1.3) · Tests only · **Deps pre-installed** · Runs in parallel with QA-BREAK-02 (disjoint scope)

## Goal

Try to break the sidecar and its security boundaries with hostile, malformed and extreme input. Every test asserts the **correct** behaviour from the contracts and decisions. A test that exposes a product defect stays in the suite as `it.fails('QA-BREAK-01-Dnn <description>', …)` so the suite stays green, and the defect is listed in `## Result`. Do **not** fix product code in this task.

## Read first

`AGENTS.md`, `../../../CONTEXT.md` D2, D11, D13, D16, D34, `../../../ARCHITECTURE.md` §3 (IPC), §8 (Worker), §11 (VS Code bridge), `src/types/schemas.ts`, `apps/sidecar/test/integration/harness.ts` (read-only), the existing integration tests for patterns (`protocol.test.ts`, `settings-projects.test.ts`, `secrets.test.ts`, `pipeline.test.ts`, `vscode-bridge.test.ts`, `web-chat.test.ts`).

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

## Result
- Summary: Added adversarial protocol, validation, and security integration coverage for BRK-P01–P08, BRK-V01–V07, and BRK-S01–S07. BRK-P02 invalid-byte coverage and BRK-P08 are explicitly skipped because the provided harness does not expose raw stdin bytes or stdin closure.
- Files changed: `apps/sidecar/test/integration/break-helpers-01.ts`, `apps/sidecar/test/integration/break-protocol.test.ts`, `apps/sidecar/test/integration/break-validation.test.ts`, `apps/sidecar/test/integration/break-security.test.ts`.
- Dependencies added (with reason): None.
- Decisions taken within scope: Duplicate JSON-RPC ids are asserted to receive two independent responses. Unknown-key strictness is recorded as an expected defect using `it.fails`; inspection shows the current Zod object schemas strip unknown keys. Integration tests were not run in the sandbox as specified by this task; QA must run `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/break-*.test.ts` outside it. The scripted LLM fake has no prompt-capture facility, so BRK-S06 verifies document retrieval and a scripted chat completion but cannot directly inspect the prompt boundary.
- Open issues / follow-ups: QA should execute the integration suite outside the sandbox and confirm the defect assertion and platform-specific junction/symlink/bridge cases. Add a scripted prompt-capture hook in a separately scoped task if BRK-S06 needs a direct prompt assertion.

### Defects

| ID | Case | Severity guess | Observed vs expected |
|---|---|---|---|
| QA-BREAK-01-D01 | BRK-P06 | S3 | Inspection indicates unknown keys are stripped by the current Zod object schemas, so `settings.update` and `project.create` may accept and ignore extra keys. Expected: strict validation rejects the requests. The integration assertion is marked `it.fails`; runtime confirmation remains with QA. |

## QA (Claude) — round 1, 2026-10-14

QA ran `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/break-` on the branch: 15 passed, 1 expected fail, 3 skipped, **7 failed**. Triage decisions (Architect):

| Case | Observed | Decision |
|---|---|---|
| BRK-P02 | No response within 5 s after a lone `\r` | **Test defect.** NDJSON frames end at `\n`; a lone `\r` is not a frame end. Send invalid UTF-8 bytes / a lone `\r` **followed by `\n`**, expect `-32700`, then `system.ping` succeeds. |
| BRK-S03 | `workspace.runCommand` returns `-32601 Method not found` | **Product contract debt, S4:** `workspace.readFile` and `workspace.runCommand` are declared in `schemas.ts` / `validation/ipc.ts` but have no sidecar handler. Record it as `QA-BREAK-01-D01` with an `it.fails` that calls both methods and expects a non-`-32601` response. Re-target BRK-S03 at the real command path: put metacharacters into `settings.pipeline.validationCommands[].args` (`&&`, `|`, `;`, `` ` ``, `$(…)`, `%COMSPEC%`), run a scripted pipeline to VALIDATING, and assert the canary file is never created. Also re-check BRK-S01: it currently passes only because the method does not exist; keep it, but name the reason in a comment. |
| BRK-S06 | `rag.query` returned `[]` | **Test defect** (ingest not finished or embedding script/minScore mismatch). Wait for the ingest job's terminal `rag.progress`, use an embedding script that returns identical vectors for document and query. For the prompt check you may now add an **E2E-only** capture hook: in `apps/sidecar/src/container.ts` `scriptedLlmProvider`, when `ITSTUDIO_E2E=1` and `ITSTUDIO_E2E_LLM_CAPTURE=<file>` are set, append each request's messages as one JSON line to that file. Additive only; inactive otherwise; covered by one unit test in `container.test.ts`. |
| BRK-S07 | `session.json` token unchanged right after `restart()` | **Test defect.** The bridge writes a new session file only when it starts. Wait (`waitFor`) until `session.json` holds a different token after triggering the bridge the same way the first session did, then assert the old token is rejected (4401). |
| BRK-V01 | Duplicate root returns `CONFLICT` | **Test defect.** `CONFLICT` is the correct code for a duplicate root; accept `VALIDATION` or `CONFLICT`. |
| BRK-V02 | `pnl.get` returned an error (no `result`) | Print `pnl.error` in the assertion message, then decide: if the request params are wrong, fix the test; if a stored value makes `pnl.get` fail, that is a **product defect** (`QA-BREAK-01-D02`, `it.fails`). |
| BRK-V07 | One URL accepted by `settings.update` | **Accepted behaviour** for the IDN case: `https://раypal.com` is a valid public HTTPS host that `URL` normalises to punycode; the user saves their own sites. Expect acceptance with a punycode `xn--` host for that one, rejection for all others. If any *other* URL is accepted, that is a product defect (`QA-BREAK-01-D03`). |

Skipped cases BRK-P02 (raw bytes) and BRK-P08 (stdin close): **Scope change** — you may add two **additive** methods to `apps/sidecar/test/integration/harness.ts`: `writeBytes(data: Buffer): void` and `endStdin(): void`. Do not change existing signatures; QA-BREAK-02 may add other additive members in parallel.

Additional scope for this round: `apps/sidecar/src/container.ts` (capture hook only), `apps/sidecar/src/container.test.ts` (one test), `apps/sidecar/test/integration/harness.ts` (additive). Keep this file UTF-8 without BOM. Append `## Result — round 2` with the final defect table.

## Result — round 2
- Summary: Applied every round 1 QA decision. The harness now supports raw stdin bytes and stdin closure; BRK-P02 exercises invalid UTF-8 and a lone CR terminated by LF, and BRK-P08 checks graceful exit during an in-flight chat. Added a gated scripted-LLM message capture hook and unit coverage, then used it to assert the RAG document remains within its context delimiters. Updated the command injection case to exercise pipeline validation arguments, accepted duplicate-root `CONFLICT`, and accepted the public IDN URL after punycode normalization.
- Files changed: `apps/sidecar/test/integration/harness.ts`, `apps/sidecar/test/integration/break-protocol.test.ts`, `apps/sidecar/test/integration/break-validation.test.ts`, `apps/sidecar/test/integration/break-security.test.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/container.test.ts`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: `workspace.readFile` and `workspace.runCommand` have no sidecar handlers despite their declared contracts; BRK-S01/S02 identify the read method gap, and BRK-S03 includes an expected failure for both methods while separately testing the actual pipeline command path. The former unknown-key defect is now QA-BREAK-01-D04 so the QA-assigned D01 and D02 identifiers remain stable. QA's accepted IDN URL is stored and checked as an `xn--` hostname. Integration tests were not run because this task documents the sandbox limitation; QA must run `npx vitest run --config vitest.integration.config.ts apps/sidecar/test/integration/break-*.test.ts` outside it.
- Open issues / follow-ups: `npm run typecheck` and `npm run lint` passed. `npm test` stopped in its `pretest` lint-fixture self-test: subprocesses reported access denied for `C:\Users\admin/.config/git/ignore`; the Vitest suite did not start. The direct integration suite still needs its outside-sandbox QA run.

### Final defects

| ID | Case | Severity guess | Observed vs expected |
|---|---|---|---|
| QA-BREAK-01-D01 | BRK-S01, BRK-S02, BRK-S03 | S4 | `workspace.readFile` and `workspace.runCommand` return `-32601 Method not found`, although both methods are declared in the shared contract and IPC validators. Expected: registered handlers enforce the path and command security contracts. A dedicated `it.fails` asserts both method calls do not return `-32601`. |
| QA-BREAK-01-D02 | BRK-V02 | S2 | QA observed `pnl.get` return an error with no result after adversarial money inputs. Expected: a valid range query returns finite P&L with nonnegative integer µUSD totals. The test now includes the actual `pnl.error` in its assertion and is marked `it.fails`; confirm the stored-input failure in the outside-sandbox run. |
| QA-BREAK-01-D04 | BRK-P06 | S3 | Inspection indicates Zod object schemas strip unknown keys, so prototype and extra-key fields can be accepted and ignored. Expected: strict validation rejects the requests and leaves the global object prototype unchanged. The test is marked `it.fails`; runtime confirmation remains with QA. |

## Result — review follow-up
- Summary: Tightened P04/P05 to validate JSON-RPC 2.0 envelopes, unique response IDs, and exactly one of result/error. Corrected V01 to use distinct workspace roots for duplicate-name coverage and accept the observed `CONFLICT` duplicate-root result. Clarified S01/S02 that schema rejection or missing handlers do not prove filesystem containment. S03 now proves the allow-listed `node` command executed, checks shell metacharacters did not create the canary, and exercises a non-allow-listed executable through a real pipeline. The E2E capture hook now captures the provider's separate system prompt, allowing S06 to verify neutralized injection content in the prompt sent to the model.
- Files changed: `apps/sidecar/test/integration/break-protocol.test.ts`, `apps/sidecar/test/integration/break-validation.test.ts`, `apps/sidecar/test/integration/break-security.test.ts`, `apps/sidecar/src/container.ts`, `apps/sidecar/src/container.test.ts`, and this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: `workspace.readFile` hostile-input assertions only establish parameter rejection; filesystem containment stays unverified because the RPC handler is missing. S03's allow-listed executable is `node`, whose completion proof is a file written by the command itself.
- Open issues / follow-ups: `npm run typecheck` passed after updates. ESLint passed for all five changed code/test files; `npm run lint` ran without diagnostics, but the invoking shell session ended without returning an exit code. P04/P05, S01/S02, and S03 passed in focused integration runs; the latest V01 and S06 assertions were adjusted after the prior run and still need the parent QA's full integration rerun. Unit/integration suite execution remains the parent QA's final verification.

## QA-BREAK-01 round 3
- Summary: Split BRK-S02 into independent junction and directory-symlink tests. A denied symlink privilege can now skip only the symlink test; junction escape assertions always run.
- Files changed: `apps/sidecar/test/integration/break-security.test.ts`, this task file.
- Dependencies added (with reason): None.
- Decisions taken within scope: Reused one helper for the link-escape assertions and parameterized the allowed pipeline path by link kind.
- Open issues / follow-ups: Windows denied directory-symlink privilege, so that standalone case was skipped; junction coverage ran successfully.
- Verification: `npx prettier --write apps/sidecar/test/integration/break-security.test.ts` passed; `npm run typecheck` passed; `npm run lint` passed. The full three-file integration run passed with 22 passed, 3 expected failures, and 1 skipped. The targeted BRK-S02 run passed its junction check and skipped only directory-symlink creation because Windows denied the required privilege.
