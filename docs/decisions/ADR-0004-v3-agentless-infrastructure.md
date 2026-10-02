# ADR-0004 — v3: Agentless infrastructure management (servers, Docker, files)

- **Status:** Accepted
- **Date:** 2026-10-02
- **Deciders:** User (product owner), Claude (Architect)

## Context

The user wants to manage a Dell home-lab machine (reached via Tailscale) and cloud VPSs from IT Studio. The app should show live metrics, manage Docker containers, browse and edit remote files, and reboot or shut down hosts. Nothing may be installed on the hosts.

## Decision

Adopt CONTEXT D24–D30:

- **Scheduling:** v3 is built after v2, as milestones M15–M19.
- **One SSH connection per server** (`ssh2`), shared by metrics, Docker, SFTP and system actions.
- **Key storage:**
  - Private keys are encrypted at rest. The decryption key lives in the OS keychain, because the Windows Credential Manager blob limit is about 2.5 KB and RSA keys do not fit.
  - Host keys are pinned on first use (TOFU).
- **Monitoring mode is a Settings toggle:**
  - Off (default): polling runs only while the Servers tab is visible.
  - On: background polling with alerts.
- **Docker** is reached through `docker system dial-stdio` over SSH. This replaces the originally proposed "remote port forwarding of docker.sock". It works on every OS, opens no ports and needs no socket forwarding.
- **Remote edits:** a diff is shown, a backup is made, the edit is checked for conflicts and written atomically.
- **Supported targets:** Linux, macOS and Windows Server, via per-OS collector and command strategies.
- **AI agents operating servers** are deferred (ARCH §23). Recording the idea needs no ADR; implementing it needs a new one.

## Alternatives rejected

| Option | Reason |
|---|---|
| Install a monitoring agent (node_exporter, Netdata) | User requirement: agentless |
| Remote-forward `docker.sock` | Wrong direction and Linux-only. `dial-stdio` is simpler and cross-OS |
| Store raw private key in keychain | Exceeds Windows blob limit for RSA keys |
| Always-on polling | Not wanted by default. Offered as an opt-in setting |

## Consequences

- Each target OS needs parser fixtures and tests.
- Docker management requires Docker CLI ≥ 18.09 on the host and permission for the SSH user.
- Passwordless sudo for exactly two commands is needed for reboot/shutdown on Linux/macOS. A setup guide is provided.
