# M15-QA — Milestone QA gate: SSH foundation & server registry

Milestone: M15 · Depends on: M15-01…M15-06 · Size M · Process TESTING §7.
Test doubles: in-process fake SSH server (M15-03); optional live check against a real host (Q-10).

## Planned cases (`docs/qa/M15-test-cases.md`)
| ID | Case | Technique | Level | Pri |
|---|---|---|---|---|
| TC-M15-001 | add server validation (host/port/user/name) | EP + BVA | L2/L3 | P1 |
| TC-M15-002 | key import ed25519 / ECDSA / RSA-2048 / RSA-1024 ✗ / public key ✗ / passphrase right / wrong | EP | L2 | P1 |
| TC-M15-003 | vault round trip; tamper → `KEY_INVALID`; buffers zeroed | security | L2 | P1 |
| TC-M15-004 | remove server deletes row, keychain entries, key file | scenario | L3 | P1 |
| TC-M15-010 | connect → online; OS detected (Linux, macOS, Windows scripted) | scenario | L3 | P1 |
| TC-M15-011 | auth failure / unreachable / timeout states + remediation | error guessing | L3 | P1 |
| TC-M15-012 | one TCP connection shared by consumers; idle close 60 s | NFR-V3-02 | L3 | P1 |
| TC-M15-013 | reconnect backoff while consumers exist; none when 0 refs | state | L2 | P2 |
| TC-M15-020 | TOFU first seen accept / reject / timeout | state transition | L3 | P1 |
| TC-M15-021 | host key mismatch blocks before auth; trust-new requires typed name | security | L3 | P1 |
| TC-M15-022 | command catalog static check | static | L1 | P1 |
| TC-M15-023 | no key material in logs / DB / RPC (scan) | security | L3 + scan | P1 |
| TC-M15-030 | Servers tab: add → fingerprint → Online (E2E with fake server) | scenario | L4 | P1 |
| TC-M15-031 | mismatch dialog flow in UI | scenario | L4 | P2 |
| TC-M15-040 | (optional live) Dell via Tailscale: add, confirm, online | acceptance | L5 | P2 |

Exploratory: IPv6 hosts, Windows `DOMAIN\user`, very slow host, host down during dialog.
