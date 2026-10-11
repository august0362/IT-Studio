# M9 QA report — packaging and release

Date: 2026-10-11 · Platform: Windows x64 · Gate: `M9-QA` · Status: **in progress**

This report follows `docs/qa/M9-test-cases.md` and `TESTING.md` §§7–8. A branch build is implementation evidence only; final gate evidence must come from the merged source and the same installers used by install smoke. No M9 sign-off is recorded while a P1 case is pending.

## Artifact provenance

| Source | Artifact | Size | SHA-256 | Use |
| --- | --- | ---: | --- | --- |
| `task/M9-FIX2` at `81f8d6f` | NSIS `IT Studio_0.1.0_x64-setup.exe` | 93,246,937 bytes | `52CCFC416FD446C1F12AADC2BC3B153D0E2C9A30153CEA5929F4C76DAB61CBD4` | Implementation build; final smoke pending |
| `task/M9-FIX2` at `81f8d6f` | MSI `IT Studio_0.1.0_x64_en-US.msi` | 147,797,060 bytes | `E5C8D4AC0F807E46FEF26558E2C111FC91175E90497FD2C317EFCD702E9BFD1E` | Implementation build; final smoke pending |

The production `npm run build:app` in that branch exited 0 and included the embedded Microsoft WebView2 bootstrapper. Read-only MSI inspection found `INSTALLDIR` below `LocalAppDataFolder`, 760 files, 923 components with HKCU registry KeyPaths, and the `InvokeBootstrapper` action. These results do not substitute for the final merged-source build or a per-user installation.

## Case verdicts

| Case | Priority | Verdict | Evidence / remaining work |
| --- | --- | --- | --- |
| TC-M9-001 | P1 | Pending | Final SEA artifact integrity and negative fixture check |
| TC-M9-002 | P1 | Pending | Native resolution and missing-module startup check |
| TC-M9-003 | P1 | Pending | Final SEA Ready/ping/shutdown and measured startup |
| TC-M9-004 | P1 | Pending | Debug config guard and Cargo tests |
| TC-M9-005 | P1 | Pending | Both final installers from merged source |
| TC-M9-006 | P1 | Pending | NSIS per-user install/uninstall |
| TC-M9-007 | P1 | Pending | NSIS self-contained smoke with sanitized environment |
| TC-M9-008 | P1 | Pending | Installed Ready observation; owner's existing app-data profile retained |
| TC-M9-009 | P1 | Pending | Final MSI database and WiX regression |
| TC-M9-010 | P1 | Pending | Isolated per-user MSI install/Ready/uninstall |
| TC-M9-011 | P1 | Pending | Version dry-run and pre/post hashes |
| TC-M9-012 | P1 | Pending | Production dependency audit |
| TC-M9-013 | P2 | Pending | Manual release path and deferred updater review |
| TC-M9-014 | P1 | Pending | Full regression, coverage, exploratory session, exit criteria |

## Gate execution log

| Gate | Result | Evidence |
| --- | --- | --- |
| Prettier → typecheck → lint → npm test | Pending | Run on final source |
| Cargo unit tests; integration; full L4 E2E | Pending | Include prior milestone regression |
| Coverage and Stryker mutation | Pending | `QA-TOOL-01` restored runner; measured 83.98% on its four targets |
| Release dry-run and audit | Pending | Confirm no writes and no high/critical advisories |
| Sidecar build, package assertion, and smoke | Pending | Capture final artifact hashes |
| App build, NSIS/MSI install smoke | Pending | Do not overlap E2E with install smoke |
| 20-minute exploratory session | Pending | Record timestamps, observations, and defects |

## Defects and sign-off

No M9 exit verdict yet. M9 remains open until 100% of P1, at least 95% of P2, coverage targets, complete traceability, no open S1/S2 defects, and the full prior-milestone L4 regression are documented. The NSIS smoke uses the real `%APPDATA%\\com.itstudio.app` profile; it must not be described as a fresh-profile test.
