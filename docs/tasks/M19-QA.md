# M19-QA — Milestone QA gate: System actions (and v3 release candidate regression)

Milestone: M19 · Depends on: M19-01…M19-03 · Size M · Process TESTING §7.

## Planned cases (`docs/qa/M19-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M19-001 | reboot Linux (fake): drop → rebooting → online | state | L3 | P1 |
| TC-M19-002 | per-OS command selection (linux / macos / windows / unknown ✗) | decision table | L2 | P1 |
| TC-M19-003 | `sudo -n` failure → `SUDO_REQUIRED` with exact line | error guessing | L2/L3 | P1 |
| TC-M19-004 | typed-name confirmation (exact, case, whitespace) | EP + BVA | L2/L4 | P1 |
| TC-M19-005 | audit log row for every attempt | scenario | L3 | P1 |
| TC-M19-006 | reboot timeout 10 min → offline + remediation | BVA | L2 | P2 |
| TC-M19-007 | shutdown → offline, no reconnect attempts | state | L3 | P1 |
| TC-M19-030 | E2E reboot flow | scenario | L4 | P1 |
| TC-M19-031 | guide commands match catalog | review | manual | P2 |
| TC-M19-040 | (optional live) reboot the owner's test host | acceptance | L5 | P2 |

Regression at this gate: full v3 L3 suite + E2E specs m15–m19 + v1/v2 smoke specs (v3 release candidate).
