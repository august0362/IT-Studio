# M9 QA report — packaging and release

Date: 2026-10-14 · Platform: Windows x64 · Gate: `M9-QA` · Status: **in progress** (final build, installer checks, and main-branch regression pass; task integration remains)

This report follows `docs/qa/M9-test-cases.md` and `TESTING.md` §§7–8. A branch build is implementation evidence only; final gate evidence must come from the merged source and the same installers used by install smoke. No M9 sign-off is recorded while a P1 case is pending.

## Artifact provenance

| Source | Artifact | Size | SHA-256 | Use |
| --- | --- | ---: | --- | --- |
| `task/M9-QA` at `ade1580ff20cb48786688aed1a884e7901b20ca5` (M8-QA and MW-04 are ancestors) | SEA `dist-sidecar/itstudio-sidecar-x86_64-pc-windows-msvc.exe` | 96,274,432 bytes | `EDF5FEE2F95705F50DFB039A5B0501F9785A483499BBD76CDBB88C703908054E` | Final sidecar used by both final bundles |
| `task/M9-QA` at `ade1580ff20cb48786688aed1a884e7901b20ca5` | NSIS `apps/desktop/src-tauri/target/release/bundle/nsis/IT Studio_0.1.0_x64-setup.exe` | 93,283,698 bytes | `1D2D7F06EFA98292641C93E5E0F7E8A276D23847E03E085797ED9653A6921A93` | Final artifact used by `smoke:install` |
| `task/M9-QA` at `ade1580ff20cb48786688aed1a884e7901b20ca5` | MSI `apps/desktop/src-tauri/target/release/bundle/msi/IT Studio_0.1.0_x64_en-US.msi` | 147,797,076 bytes | `66B1EC7D957208A8EE064D94708240A4459FB467C170400849A378A2423AB6FE` | Final artifact used by TC-M9-010 |
| `task/M9-QA` at `94c31ceb9928700b21e8cc57c4013278f7d4118c` | NSIS `apps/desktop/src-tauri/target/release/bundle/nsis/IT Studio_0.1.0_x64-setup.exe` | 93,327,517 bytes | `7169B4FF54CB27B78D1B31CF3CAAE0EE43A513A6130FEF0A18FDF8EBDDC88E3C` | Pre-M9-FIX6 QA build; NSIS smoke 7/7 pass |
| `task/M9-QA` at `94c31ceb9928700b21e8cc57c4013278f7d4118c` | MSI `apps/desktop/src-tauri/target/release/bundle/msi/IT Studio_0.1.0_x64_en-US.msi` | 147,797,060 bytes | `9CCF47B4C8DD225AD59B3FFA9F56CFF52830A1C49B5A0462CBA2D3CA85194C98` | Pre-M9-FIX6 QA build; path precedence defect exposed |

The pre-M9-FIX6 `npm run build:app` exited 0 on 2026-10-11 from 14:00:47 to 14:16:22 UTC+07:00 (15m 36s). The build generated a per-user WiX template with 917 resource components, included the embedded Microsoft WebView2 bootstrapper, and emitted both bundles above. The installer hashes were recorded immediately after build; smoke and installation used those exact files.

The 2026-10-11 rebuild on revision `9dfada7b2cdfc5f7e5dffb2d00c3568772a852d3` failed while downloading the Microsoft WebView2 bootstrapper (`timeout: global`); this is historical and was resolved by the successful final build below. On 2026-10-14, `npm run build:app` completed on `ade1580ff20cb48786688aed1a884e7901b20ca5`: sidecar build, release executable, NSIS, WebView2 bootstrapper download, and MSI all succeeded. The final build took approximately 8 minutes based on process and bundle timestamps; an exact wall-clock duration was not captured.

## Case verdicts

| Case | Priority | Verdict | Evidence / remaining work |
| --- | --- | --- | --- |
| TC-M9-001 | P1 | Pass | Final SEA and every manifest hash verified; missing/changed/traversal fixtures rejected (3/3 post-build package tests with TC-M9-002) |
| TC-M9-002 | P1 | Pass | Native-loader unit cases passed; isolated missing native module named in fatal error with exit 2; packaged sidecar loaded native resources during install smoke |
| TC-M9-003 | P1 | Pass with outlier | Final-source Ready/ping/shutdown/exit passed at 452, 427, and 528 ms after the first cold run measured 2,104 ms and exceeded the 1,500 ms target. |
| TC-M9-004 | P1 | Pass | Debug guard Node tests passed; Cargo formatting and 16/16 Rust unit tests passed |
| TC-M9-005 | P1 | Pass | Final `npm run build:app` succeeded on `ade1580ff20cb48786688aed1a884e7901b20ca5`; both installer hashes and byte sizes are recorded above. |
| TC-M9-006 | P1 | Pass | `npm run smoke:install` installed the final NSIS artifact to a unique temp per-user directory and its silent uninstall removed that directory (part of 7/7 checks). |
| TC-M9-007 | P1 | Pass | Final NSIS smoke found the bundled sidecar, reached Ready within 30 seconds with PATH limited to Windows directories, loaded no repository/external `node_modules`, exited app and sidecar gracefully, and uninstalled the temp directory. Log: `.npm-cache/m9-smoke-install-20261014.log`. |
| TC-M9-008 | P1 | Pass (existing profile) | NSIS Ready log was written under the real `%APPDATA%\\com.itstudio.app`; this is not fresh-profile evidence. `itstudio.db` remained 94,208 bytes with its original timestamp; startup only caused expected log/WAL/SHM activity. |
| TC-M9-009 | P1 | Pass | WiX template tests pass; final MSI installed under explicit LocalAppData `INSTALLDIR`. `MsiEnumProductsExW`, queried with the current user's SID, returned `MSIINSTALLCONTEXT_USERUNMANAGED` (2); it returned no product in user-managed context. The HKLM uninstall ARP entry was present, but does not override the Windows Installer context result. |
| TC-M9-010 | P1 | Pass | Final MSI install used explicit `C:\\Users\\admin\\AppData\\Local\\ITStudio-M9-QA-Context-57f5cf8f1f654509bdafd277d5cbdd4e`, despite `PREVIOUS_INSTALLDIR` finding the earlier NSIS temp path. The installed app reached Ready from bundled `itstudio-sidecar.exe`; MSI context was user-unmanaged (2). Exact test product was uninstalled; registration and install directory were removed. App data DB was unchanged. |
| TC-M9-011 | P1 | Pass | Version test matrix passed; `npm run release:bump -- patch --dry-run` exited 0 on 2026-10-11, and SHA-256 of all seven target manifests/changelog files matched before and after. The scoped S1/S2 fixes change no version file. |
| TC-M9-012 | P1 | Pass | `npm run audit:prod` exited 0 on 2026-10-11: three moderate advisories, zero high/critical; the scoped S1/S2 fixes change no dependency file. |
| TC-M9-013 | P2 | Pass | Reviewed `docs/RUNNING.md` §6 against D33 and final package gate: version dry-run, audit, both installer builds, NSIS smoke, isolated MSI Ready/uninstall, and tag are documented; signing and automatic updates remain deferred. |
| TC-M9-014 | P1 | Pass | On 2026-10-14, `npm run test:all` passed on `task/M9-QA`: 933 Vitest passed + 1 skipped, 15 Node tests, 114 integration tests, and 14 E2E specs / 45 tests. A complete rerun on `main` also passed: 932 Vitest passed + 1 skipped, 12 Node tests, 114 integration tests, and 14 E2E specs / 45 tests. |
| TC-M9-015 | P1 | Pass | `CostPage.test.tsx` passed 12/12; the new GUI regression passed in focused Cost (5/5) and full L4 (45 tests). Reversed dates keep Cost mounted with Ready visible. |

## Gate execution log

| Gate | Result | Evidence |
| --- | --- | --- |
| Prettier → typecheck → lint → npm test | Pass | Prettier, typecheck, lint passed. Full unit run passed 933 Vitest + 15 Node tests; one intentionally skipped source test. |
| Cargo unit tests; integration; full L4 E2E | Pass in M9-QA branch | `cargo fmt --check`, 16/16 Rust tests, 18 integration files/114 tests, 14/14 E2E specs and 45/45 cases. The first full E2E run had six transient `UND_ERR_SOCKET` session-creation failures; all failed specs passed individually and the full rerun passed. Historical M4–M6 cases are included. |
| Final-source regression (`npm run test:all`) | Pass on task branch and `main` | 2026-10-14 on `main`: Vitest 932 passed + 1 skipped; Node tests 12/12; integration 114/114; E2E 14/14 specs, 45/45 tests in 3m38s. Exit 0. Main log: `.npm-cache/m9-test-all-main-20261014.log`. Task-branch evidence remains in `.npm-cache/m9-test-all-20261014.log` (933 passed + 1 skipped; 15 Node tests; 114 integration; 14 E2E specs / 45 tests). |
| Coverage and Stryker mutation | Pass | Statements 85.55% (7,793/9,109); services statements 91.81%; domain statements 99.59%, domain branches 97.01%. Six safety-critical domain modules were previously 100% branch. Full production `domain/**` mutation score 77.53%: 1,703 killed, 12 timed out, 477 survived, 20 no coverage, zero errors (399 static mutants ignored). |
| Release dry-run and audit | Pass; dependency/version files fixed | On 2026-10-11 14:49 UTC+07:00, dry-run exited 0 and all seven before/after SHA-256 values matched. `npm run audit:prod` exited 0 with three moderate and no high/critical. No fix task may change those files. |
| Sidecar build, package assertion, and smoke | Pass with startup outliers | Final SEA 96,274,432 bytes; package checks 3/3; first cold smoke 2,104 ms, then 452/427/528 ms. |
| App build, NSIS/MSI install smoke | Pass | Final `npm run build:app` succeeded. Final NSIS `smoke:install` passed 7/7. Final MSI installed to explicit LocalAppData, reached Ready with bundled sidecar, and was uninstalled. `MsiEnumProductsExW` reported current-user unmanaged context 2; the HKLM uninstall ARP entry was separately observed. Logs are `.npm-cache/m9-smoke-install-20261014.log`, `.npm-cache/m9-tc-m9-010-context-install.log`, and `.npm-cache/m9-tc-m9-010-context-uninstall.log`. The existing app-data DB remained unchanged. |
| 20-minute exploratory session | Complete; S1 found and regression verified fixed | Ran 2026-10-11 14:23:55–14:44:04 UTC+07:00 for 1,209.116 seconds in a separate debug app/data directory. Clock: `.npm-cache/m9-explore/session.json`; screenshots below. Custom Cost dates unmounted the UI; M9-FIX7 unit/component and GUI regressions now pass. |

### Exploratory session notes

The debug app ran with `ITSTUDIO_DATA_DIR` and `WEBVIEW2_USER_DATA_FOLDER` under `.npm-cache/m9-explore/`; the release installers were exercised separately above. No provider key was entered or real provider request made.

- Created an isolated project and confirmed empty-name validation, project tab selection, and the Chat/Code/Knowledge/Gallery project views. With no provider key, Chat showed `LADDER_EXHAUSTED`, Code produced a failed Specify stage and skipped later stages, and RAG ingest showed `SECRET_MISSING` for a small local Markdown fixture. The app stayed Ready.
- Switched English/Vietnamese and Light/Dark appearance, inspected all Settings pages, entered and cleared a manual FX rate, and entered then cleared one model price override. The price values restored; the Origin labels did not (M9-OBS-02).
- Confirmed an empty project budget is rejected, saved a $10.125 monthly budget, added a $25.50 USD revenue entry, and checked project/portfolio totals. Added a 263,000 VND entry at 26,300 VND/USD; the project total became $35.50 and 933,650 VND. Last-month filtering hid both entries and this-month filtering restored them. The top-spend widget used the project UUID (M9-OBS-06).
- Turned Auto Fallback off; a keyless Chat request showed the model-choice modal with estimated costs and a 120-second decision timer. Cancel returned `FALLBACK_DECLINED`; Auto Fallback was restored.
- Added an empty custom Web chat link and confirmed save rejected it with URL/name validation; removed the draft and saved defaults. Toggled image generation in isolated settings, inspected Chat and the empty Gallery, then restored the disabled setting. No browser or paid image call was launched.
- Inspected Workflow after RAG and Chat failures. The node/detail mismatch is M9-OBS-05. A Workflow deep link opened Code; with All projects selected it correctly showed read-only mode, and selecting the test project displayed its failed run.
- Verified empty API-key Save does not store a key; Verify without a key returned `SECRET_MISSING` and a clear message. Selected and cleared a router model lock. Navigated between All projects and the isolated project. On Cost & P&L, selected Custom and entered From `2026-10-12`, To `2026-10-10`. The WebView became blank; DOM was `<div id="root"></div>` and remained blank more than two minutes later (M9-OBS-07).

Evidence screenshots: `project-validation.png`, `chat-sent.png`, `pipeline-no-key.png`, `knowledge-no-key.png`, `cost-project.png`, `cost-portfolio.png`, `theme-vietnamese.png`, `theme-dark.png`, `manual-fallback.png`, `workflow-retriever.png`, `m9-router-lock.png`, `m9-cost-invalid-range.png`, and `m9-cost-invalid-range-persistent.png` under `.npm-cache/m9-explore/`. The source regression E2E suite separately contains automated GUI assertions; this session was ad hoc interaction and visual review.

## Defects and sign-off

No M9 exit verdict yet. Source regression and the M9-FIX6/FIX7 behavior checks pass, final artifact build/install evidence is recorded above, and `npm run test:all` now passes on both the QA branch and `main`. M9 sign-off remains pending integration/review of the QA task branch and its committed report. The NSIS and MSI Ready checks used the real `%APPDATA%\\com.itstudio.app` profile; they are not fresh-profile results. MSI context was verified as per-user unmanaged using `MsiEnumProductsExW`; the separate HKLM uninstall ARP key is not itself evidence of a per-machine Windows Installer context.

### Open observations

- **M9-OBS-01 (S2, resolved by M9-FIX6):** After the NSIS smoke uninstalled from a temporary path, its HKCU default install-path registry value remained. MSI `AppSearch` replaced a caller-supplied `INSTALLDIR` with that stale path. M9-FIX6 changed the WiX search to preserve explicit install paths while retaining upgrade discovery. TC-M9-009 and TC-M9-010 passed against the final MSI: the explicit LocalAppData path won over the stale NSIS path, the bundled sidecar reached Ready, and uninstall removed only the isolated test installation. The owner's app data remained unchanged.
- **M9-OBS-02 (S3):** In isolated debug-app exploration, changing only Claude Opus 5.5's manual price caused every row's Origin column to show `manual_override`; clearing the one override restored its numbers but did not restore the other rows' `seed` labels. No other prices changed. Screenshot: `.npm-cache/m9-explore/pricing-override.png`.
- **M9-OBS-03 (S3):** Workflow's initial graph viewport clipped nodes at its left edge at 1,580×1,000. Clicking Fit View did not visibly bring the clipped nodes fully into view. Screenshot: `.npm-cache/m9-explore/workflow.png`.
- **M9-OBS-04 (performance):** The final-source cold standalone SEA smoke measured 2,104 ms, above the 1,500 ms target; the next three runs measured 452/427/528 ms. Retain the cold-start outlier in the performance record.
- **M9-OBS-05 (S3):** After a zero-hit knowledge search completed, Workflow continued to show Retriever as Active with one in-flight call, while its Now panel said "No activity in flight" and Recent showed the retrieval as Completed. Refresh did not reconcile the indicators. Screenshot: `.npm-cache/m9-explore/workflow-retriever.png`.
- **M9-OBS-06 (S3):** In the all-project Cost view, after adding a $25.50 revenue entry to the isolated QA project, the portfolio totals and project row were correct, but "Top spend by project" displayed the project UUID instead of its name. Screenshot: `.npm-cache/m9-explore/cost-portfolio.png`.
- **M9-OBS-07 (S1, resolved by M9-FIX7):** On the Cost page, choosing Custom and entering From `2026-10-12`, To `2026-10-10` emptied the WebView root. Two screenshots taken more than two minutes apart show the persistent blank window; WebDriver DOM showed only `<div id="root"></div>` plus Monaco support nodes. M9-FIX7 now validates custom ranges before converting dates; `TC-M9-015` passes 12/12 focused component tests and the GUI regression. The Cost page and Ready shell remain visible.
