# QA-E2E-FIX4 — Six-attempt stop record

Date: 2026-10-11 · Status: Reopened by owner for a distinct harness approach

## Evidence

- `` says remaining L4 cases were skipped after the sixth fix attempt; their behavior passes at L2/L3.
- `` says TC-M5-020/022/023 were skipped and reported after six attempts; TC-M5-020 had a search-step setup failure while ingest reached Indexed.
- `` says TC-M6-071/072 still failed at validation-shim setup after the sixth attempt and were skipped; L3 coverage exists.
- `docs/HANDOFF.md` §5 proposes one fresh app and data directory per spec plus a DOM snapshot and screenshot on failure. It labels the backlog as 13 cases, but enumerates 15 IDs: TC-M4-022/023/031/033/041–046, TC-M5-020/022/023, and TC-M6-071/072.

## Impact

The historical M4–M6 sign-offs are conditional. ../TESTING.md §7 requires 100% P1 and at least 95% P2 pass, so M9-QA cannot claim the full prior-milestone L4 regression gate while required cases remain unverified. No further repair attempt has been made in this task.

## Decision needed

Authorize a distinct E2E harness approach after the six-attempt stop, or accept a conditional v1 hand-over while keeping the M9 full L4 regression gate open. The recommended option is the isolated-session approach because it produces diagnostic evidence without weakening case assertions.

## Owner decision

On 2026-10-11, admin chose option A: a fresh app and data directory per spec plus DOM and screenshot capture on failure. This authorizes a new harness implementation and targeted re-verification; the historical six attempts remain recorded above.

## QA outcome — 2026-10-11

The authorized approach creates a separate tauri-driver process, app process, `ITSTUDIO_DATA_DIR`, and WebView2 user-data directory for each spec. Worker cleanup is limited to processes started by that worker. The scripted providers and isolated test data require no real provider network or keychain access. The M4–M6 assertions still check the specified behavior, including the actual fallback response badge, Escape cancellation without a response, citation source content, and validation recovery.

### Failure-capture evidence

- A deliberate TC-M4-022 failure produced `C:/Users/admin/AppData/Local/Temp/itstudio-e2e-evidence-Dpzxom/2026-10-11T04-21-56-929Z-TC-M4-022.html` and the matching `.png` file. The DOM and screenshot show the remote scripted app's fallback answer badge. The HTML was 17,593 bytes and the PNG was 64,439 bytes.
- A deliberate TC-MW-011 failure produced `C:/Users/admin/AppData/Local/Temp/itstudio-e2e-evidence-NYbtNC/2026-10-11T04-51-20-126Z-TC-MW-011.html` and the matching `.png` file. The DOM shows the remote Workflow graph and Recent view. The HTML was 199,164 bytes and the PNG was 118,396 bytes.
- The capture uses the registered remote WebDriver session, includes the case ID in both file names, and redacts the scripted API key. Probe-only failures were removed from the specs after verification. No driver or app processes remained from those workers.

### L4 verdicts

| Historical group | Case IDs | Final verdict |
| --- | --- | --- |
| M4 | TC-M4-022, TC-M4-023, TC-M4-031, TC-M4-033, TC-M4-041, TC-M4-042, TC-M4-043, TC-M4-044, TC-M4-045, TC-M4-046 | 10/10 passed |
| M5 | TC-M5-020, TC-M5-022, TC-M5-023 | 3/3 passed |
| M6 | TC-M6-071, TC-M6-072 | 2/2 passed |

All 15 enumerated historical cases passed. The old HANDOFF count of 13 remains a count error; no case was omitted. The first full E2E run passed 13/14 specs. TC-MW-011 could not open its remote session because the harness had not started port 4448 for the MW spec (`ECONNREFUSED http://127.0.0.1:4448/session`); its failure artifacts are under `C:/Users/admin/AppData/Local/Temp/itstudio-e2e-evidence-as5lN2/2026-10-11T04-49-50-262Z-unknown-case`. The worker startup condition and MW diagnostic registration were corrected. A standalone MW rerun passed 2/2 cases. The final configured E2E suite passed **14/14 specs and 44/44 cases** with exit code 0; its evidence directory was `C:/Users/admin/AppData/Local/Temp/itstudio-e2e-evidence-nfvF1Y` and contained no failure artifacts.

### Other verification

- Scoped Prettier, full `npm run typecheck`, full `npm run lint`, and `npm test` passed on the final source. Vitest reported 922 passed and 1 skipped; the Node build/release tests reported 6/6 passed.
- `node --test scripts/dev/measure-startup.test.mjs` passed 5/5 focused cases. The real `node scripts/dev/measure-startup.mjs` completed five Ready measurements at 3307, 3453, 4211, 4687, and 3193 ms (median 3453 ms), exit code 0. The sidecar stdin pipe stayed open until Ready and the child closed cleanly.

### ../TESTING.md §7 impact and follow-up

The historical M4–M6 L4 omissions are resolved and the full configured prior-milestone L4 regression passes, clearing that specific obstacle to the §7 P1/P2 gate. Milestone sign-off still requires QA to check the remaining §7 exit criteria, including the traceability matrix, coverage, defect status, exploratory session, and committed report.

One stale OS temporary directory remains at `C:/Users/admin/AppData/Local/Temp/itstudio-startup-4Sa0m1`. Automatic approval review rejected a requested recursive removal of that exact path. No further removal was attempted; it is unrelated to the passing startup measurements or E2E results.
