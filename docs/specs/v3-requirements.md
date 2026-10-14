# v3 Software Requirements Specification — Agentless Infrastructure Management (M15–M19)

> Structure follows ISO/IEC/IEEE 29148 (SRS). Owner: Architect (Claude). Status: **Baseline 1.0 — 2026-10-04**, approved scope = CONTEXT D24–D30, ADR-0004.
> Binding inputs: `CONTEXT.md` §3, `ARCHITECTURE.md` Part III (§18–§24), `schemas.ts` §17.
> This document adds numbered requirements, exact contracts, data model, state machines, error codes, non-functional targets and traceability. Task files (`docs/tasks/M1x-*.md`) cite requirement IDs (`FR-SV-04`).
> Delivery plan: `docs/plans/v2-v3-delivery-plan.md`.

---

## 1. Introduction

### 1.1 Purpose
Let the owner watch and operate their machines — a Dell home-lab reached via Tailscale, VPSs, any SSH host (Linux, macOS, Windows Server) — from IT Studio, **without installing anything on the hosts**: live metrics and alerts, Docker containers and logs, remote files with safe editing, reboot/shutdown.

### 1.2 Scope
In scope: server registry, encrypted key vault, SSH connection manager with TOFU host-key pinning, per-OS metrics collectors, monitoring modes and alerts, Docker over `dial-stdio`, SFTP file manager with safe edit, system actions with audit, Workflow-map coverage, v3.0.0 release.
Out of scope: password authentication (key only), jump hosts/bastions, port forwarding, metrics history persistence, recursive delete, AI agents operating servers (ARCH §23 — new ADR required), Kubernetes, multi-user.

### 1.3 Stakeholders
Owner (operates own hosts; cares about safety of destructive actions and credential security); Architect/QA; Implementer.

### 1.4 Definitions
**Host** = managed SSH server (`ServerConfig`). **Collector** = per-OS Strategy producing one `ServerMetricsSample` from one exec. **Watch** = UI-declared interest in a server's metrics (tab visible). **Consumer** = a service holding a reference on a pooled SSH connection. **TOFU** = trust on first use.

### 1.5 Design decisions taken in this SRS (within approved scope)
| ID | Decision | Rationale |
|---|---|---|
| DD-V3-01 | Servers, server actions and their activity events are **app-global** (no `projectId`; activity `projectId = null`). D13 ("every persisted entity carries projectId") applies to project work (chat, RAG, pipeline, ledger); infrastructure is not project work. Logged in ROADMAP *Doc Debt* for owner confirmation (Q-09). | `ServerConfig` (already approved in ADR-0004) has no project. |
| DD-V3-02 | SSH library `ssh2`; tests run an in-process `ssh2.Server` on 127.0.0.1 as the fake host (scripted exec, SFTP, `dial-stdio` stream). | One library for client and test double. |
| DD-V3-03 | Remote commands come only from `domain/remote-commands.ts`: a typed catalog of constant command strings per OS. Nothing from the user or a model is interpolated into a shell string; variable inputs (paths, container ids) go through SFTP / Docker APIs. | ARCH §18.4, §24. |
| DD-V3-04 | Windows hosts: commands are `powershell -NoProfile -NonInteractive -Command <constant script>` emitting JSON. | Stable parsing. |
| DD-V3-05 | Key files and upload/download paths are chosen with the Tauri **dialog plugin** in the UI; only the selected absolute path is sent to the sidecar, which reads the file. The private key content never enters the webview. | ARCH §18.1. |
| DD-V3-06 | OS notifications are raised by the **UI** (Tauri notification plugin) when it receives `server.alert` and `osNotifications` is on; background alerts only while the app runs. | Sidecar has no desktop API. |
| DD-V3-07 | Host-key fingerprint format = OpenSSH `SHA256:<base64-no-padding>`. A mismatch can only be resolved by *Trust new key* with the typed server name. | Familiar to users; safe re-pin. |
| DD-V3-08 | The remote editor handles UTF-8 text only; invalid UTF-8 or NUL bytes ⇒ binary (download only). Line endings (LF/CRLF) and a trailing-newline state are preserved on save. | D27 safety. |
| DD-V3-09 | Metrics are sampled with a single exec per poll; first sample rates = 0; history only in memory (10 min ring). | ARCH §19. |

---

## 2. Overall description

### 2.1 Product perspective
New sidecar subsystem (Part III diagram) behind JSON-RPC, a **Servers** tab in the UI, one outbound SSH (TCP) connection per server. No new inbound listeners. No LLM tokens are used by v3 features.

### 2.2 Operating environment
Client: Windows 11 (as v1). Hosts: Linux (systemd, `/proc`), macOS 13+, Windows Server 2019+ with OpenSSH Server and PowerShell 5.1+. Docker CLI ≥ 18.09 on hosts that use M17. Tailscale is transparent (just an IP/hostname).

### 2.3 Constraints
C-1 Agentless. C-2 Key auth only. C-3 Fixed command catalog. C-4 Key material encrypted at rest; keychain holds data keys (2.5 KB blob limit). C-5 Monitoring default = only while visible (D25). C-6 Typed-name confirmation for destructive actions. C-7 i18n en + vi, theme tokens, keyboard operable.

### 2.4 Assumptions
A-1 The owner can add SSH public keys to hosts and (for reboot) add one sudoers line (guide M19-03). A-2 Hosts are reachable from the client (LAN, Tailscale or public IP).

---

## 3. Functional requirements

### 3.1 Server registry & key vault (M15) — `FR-SV`, `FR-KV`
| ID | Requirement | Pri |
|---|---|---|
| FR-SV-01 | Add server: name (1–60, unique case-insensitive), host (hostname, IPv4, IPv6, Tailscale name; no scheme/path), port 1–65535 (default 22), username (1–64, `[A-Za-z0-9._-]`, Windows also `\`), key file path, optional passphrase, tags (≤ 10 × ≤ 24 chars). | M |
| FR-SV-02 | Edit name/host/port/username/tags; *Replace key*; remove server (confirm) deletes the row, both keychain entries and the encrypted key file, and closes the connection. | M |
| FR-KV-01 | Key import accepts OpenSSH (`-----BEGIN OPENSSH PRIVATE KEY-----`) and PEM (RSA/EC/PKCS#8) for ed25519, ECDSA P-256/384/521, RSA ≥ 2048. Encrypted keys require the correct passphrase at import (validated by parsing). Others → `KEY_INVALID` with the reason. | M |
| FR-KV-02 | Vault: random 256-bit data key per server in keychain `itstudio-ssh/<serverId>`; key file encrypted with AES-256-GCM (random 12-byte IV, 16-byte tag, AAD = serverId) to `<dataDir>/ssh/<serverId>.key.enc` (format `v1:` header + iv + tag + ciphertext); passphrase in keychain `itstudio-ssh-pass/<serverId>`. | M |
| FR-KV-03 | Decrypted key buffers exist only during handshake and are zeroed (`buffer.fill(0)`) in `finally`; tampered ciphertext → `KEY_INVALID` "key file damaged — replace key". | M |
| FR-SV-03 | Connection manager: one `ssh2` client per server, lazily opened on first `acquire(consumer)`; consumers `probe`, `metrics`, `docker`, `sftp`, `logs`, `action`; idle close 60 s after the last release; keepalive 15 s (`keepaliveCountMax` 3); handshake timeout 15 s. | M |
| FR-SV-04 | Reconnect with backoff 1, 2, 4, 8, … 60 s (±20 % jitter) only while ≥ 1 consumer holds a reference; state changes emitted as `server.status`. | M |
| FR-SV-05 | Host key TOFU: first connect (no pinned fingerprint) pauses in state `connecting` and emits `server.hostKeyPrompt{firstSeen:true}`; `server.confirmHostKey(accept)` pins (accept) or aborts (`HOST_KEY_UNCONFIRMED`). Prompt expires after 120 s. | M |
| FR-SV-06 | Mismatch → state `host_key_mismatch`, connection refused before authentication completes, prompt with previous + new fingerprint; only `server.trustNewHostKey(fingerprint, confirmName)` re-pins. | M |
| FR-SV-07 | OS detection on first successful connect: `uname -s` → `Linux`/`Darwin`; else PowerShell probe → `windows`; else `unknown` (user may override in edit). | M |
| FR-SV-08 | Auth failure → `auth_failed` with remediation (check user, `authorized_keys`, passphrase); unreachable / timeout → `offline` (`SSH_UNREACHABLE`). | M |
| FR-SV-09 | Servers tab skeleton: card grid (name, host, OS icon, state badge, last error), *Add server* modal with dialog-based key picker, fingerprint confirmation dialog (shows key type + fingerprint + "verify with `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`" hint), edit/remove menu. | M |

### 3.2 Metrics, monitoring & alerts (M16) — `FR-MT`, `FR-AL`
| ID | Requirement | Pri |
|---|---|---|
| FR-MT-01 | Linux collector per ARCH §19.1 table; network excludes `lo`, `docker*`, `veth*`, `br-*`; disks = real filesystems (exclude `tmpfs`, `devtmpfs`, `overlay`, `squashfs`), max 8 mounts by size. | M |
| FR-MT-02 | macOS collector (`top -l 1 -n 0`, `sysctl`, `vm_stat`, `netstat -ib`, `df -kP`, `pmset -g batt`). | M |
| FR-MT-03 | Windows collector (one PowerShell script, JSON: CPU LoadPercentage avg, OS memory, `Get-NetAdapterStatistics` totals of Up adapters, logical fixed disks, `Win32_Battery`, LastBootUpTime). | M |
| FR-MT-04 | Each collector = constant script + pure parser `domain/metrics/<os>.ts`; parser input → `ServerMetricsSample` or `Result` error; malformed sections yield partial samples with nulls where allowed, never throw. | M |
| FR-MT-05 | Rates and CPU% from deltas vs the previous raw counters; counter reset (smaller value) → rate 0; first sample → 0. | M |
| FR-MT-06 | Scheduler: `server.watch(serverIds)` / `server.unwatch(serverIds)` reference-counted per UI view; when `backgroundMonitoring=false` only watched servers are polled; when true all servers are polled. Interval `pollIntervalSeconds` 3–60 (default 5). | M |
| FR-MT-07 | Single-flight per server; a poll taking > 10 s marks the sample `late` (status note) and the next poll waits for completion; poll errors → `offline` after 2 consecutive failures. | M |
| FR-MT-08 | In-memory ring buffer of 10 min per server (`server.history(serverId)` returns it for sparklines on mount). | M |
| FR-AL-01 | Rules (`MonitoringSettings.alertRules`), defaults: offline 30 s; CPU > 90 % for 120 s; RAM > 90 % for 60 s; disk > 90 % (any mount, 0 s); battery < 15 % while discharging (0 s); container exited (event). | M |
| FR-AL-02 | `domain/alert-engine.ts` (pure, 100 % branch): condition must hold continuously for `forSeconds` before firing; fires once; resolves when the condition is false for one sample; emits `server.alert{resolved}`. Rules only evaluated when the server is polled (background on, or watched). | M |
| FR-AL-03 | UI: toast per fired alert (and resolved), alert list panel (last 100, in memory), OS notification when `osNotifications` (DD-V3-06). | M |
| FR-MT-09 | ServerCard: state badge (icon + text), uptime, RAM bar (warning ≥ 80 %, danger ≥ 90 %), CPU sparkline 10 min, Net ↑/↓ auto units (B/s, KB/s, MB/s, 1 decimal), disk bars (top 3 + "more"), battery widget only when `battery != null`, actions menu (Containers, Files, Reboot, Shutdown). | M |
| FR-MT-10 | Settings → Monitoring: background toggle with explanation of traffic/battery cost, interval slider 3–60, alert rules editor (enable, threshold 1–100, forSeconds 0–3600), OS notifications toggle. | M |

### 3.3 Docker (M17) — `FR-DK`
| ID | Requirement | Pri |
|---|---|---|
| FR-DK-01 | `DockerManager` builds a `dockerode` client whose HTTP agent opens an SSH exec channel `docker system dial-stdio` per connection (consumer `docker`). | M |
| FR-DK-02 | Availability check on first use: `docker version` via API; failure → `dockerAvailable=false`, `DOCKER_UNAVAILABLE` with remediation (install Docker CLI ≥ 18.09; add user to `docker` group / Docker Desktop running). | M |
| FR-DK-03 | List (all / running), inspect, start, stop (timeout 10 s), restart; actions validate container id format (`^[a-f0-9]{12,64}$`) and existence. | M |
| FR-DK-04 | Events subscription while the drawer is open or background monitoring is on: `die`/`start`/`stop`/`restart` → `docker.changed{serverId}`; `die` with non-zero exit and not user-initiated → `container_exited` alert. | M |
| FR-DK-05 | Logs: `docker.logs.open(tail 1–5000 default 500, follow, stdout, stderr)` → `LogStreamId`; demultiplex stdout/stderr frames; push `docker.log` chunks ≤ 64 KB, ≤ 20 chunks/s (coalesce); when the per-stream backlog > 2 MB drop oldest and emit `docker.logDropped`. Max 4 open streams; auto-close on drawer close, UI reconnect or server disconnect. | M |
| FR-DK-06 | ContainerDrawer: table (name, image, ports, state chip, status), Start/Stop/Restart (confirmation for Stop/Restart when the container publishes host ports), opens the log viewer. | M |
| FR-DK-07 | Log viewer: virtualised list (react-virtuoso), auto-scroll toggle (pauses when user scrolls up), text filter (plain substring, case-insensitive), stdout/stderr toggles, *Copy visible lines* to the clipboard (no file save — the webview has no file-system plugin; adding one only for this is not justified), max 50 000 lines kept (drop oldest). | M |

### 3.4 Remote files (M18) — `FR-FS`
| ID | Requirement | Pri |
|---|---|---|
| FR-FS-01 | `sftp.list/stat/read/mkdir/rename/delete` over the shared connection (consumer `sftp`); `RemotePath` must be absolute POSIX (Windows `/C:/…`), normalised, no NUL, no `..` after normalisation. | M |
| FR-FS-02 | `read` ≤ 5 MB for the editor; larger → `REMOTE_FILE_TOO_LARGE` (download only); binary / non-UTF-8 → `REMOTE_FILE_BINARY`. Returns content, `sha256`, EOL style, trailing newline flag. | M |
| FR-FS-03 | Safe write (D27): re-read + hash compare (mismatch → `CONFLICT` with current hash) → backup copy `<file>.itstudio-bak-<YYYYMMDDHHmmss>` (same dir, same mode) → write `<file>.itstudio-tmp` → POSIX: `rename` (overwrite); Windows host: `rename` to target after removing target (best-effort atomic, documented) → stat + hash returned. Mode preserved. | M |
| FR-FS-04 | Undo restores the newest `.itstudio-bak-*` of that file via the same safe-write path (backup of the current content first). Backups older than the newest 5 per file are deleted after a successful write. | M |
| FR-FS-05 | Delete: files and **empty** directories only; confirmation in UI; non-empty dir → `VALIDATION` "remove contents first". | M |
| FR-FS-06 | Upload: dialog-picked local file → remote dir; existing target → requires `overwrite: true` (UI confirm); progress via `sftp.progress`; max 2 GB; cancel supported. Download: remote file → dialog-picked local path; progress; cancel. | M |
| FR-FS-07 | RemoteFileManager UI: directory tree + file table (name, size, modified, mode), breadcrumbs, path input, toolbar (new folder, upload, download, rename, delete, refresh), keyboard navigation. | M |
| FR-FS-08 | Editor: Monaco with language by extension/name (`.env`, `*.yml|yaml`, `*.json`, `Dockerfile`, `nginx.conf`/`*.conf`, `*.sh`, `*.ps1`, `*.md`); *Save* always shows a diff (original vs edited) with *Confirm save*; conflict dialog offers *Reload (discard mine)*, *Overwrite (backup still taken)*, *Compare*. *Undo last save* button. | M |

### 3.5 System actions (M19) — `FR-SA`
| ID | Requirement | Pri |
|---|---|---|
| FR-SA-01 | Reboot/shutdown commands per ARCH §22 table from the catalog; Linux/macOS use `sudo -n`; "a password is required" / exit 1 with sudo message → `SUDO_REQUIRED` with the exact sudoers line for that OS/user. | M |
| FR-SA-02 | Confirmation modal requires typing the exact server name; RPC re-checks `confirmName` (case-sensitive). | M |
| FR-SA-03 | Every attempt appended to `server_actions` (id, server id, server name snapshot, action, requested at, result `ok|failed`, error code, message). `server.listActions` shows the audit log. | M |
| FR-SA-04 | After reboot: card state `rebooting` (UI state from the action result); manager retries until online (then "back online after mm:ss") or 10 min → `offline` with remediation. After shutdown: `offline`, no reconnect attempts. | M |
| FR-SA-05 | Server setup guide `docs/guides/server-setup.md` (key generation, authorized_keys, Tailscale, sudoers lines, Docker group, Windows OpenSSH, macOS Remote Login). | M |

### 3.6 Workflow map coverage — `FR-WF3`
| ID | Requirement | Pri |
|---|---|---|
| FR-WF3-01 | New modules (additive `WorkflowModuleId`): `ssh_manager`, `metrics`, `docker`, `sftp`, `system_actions` in a new lane `infra` (additive `WorkflowLane`); shown only in the "All projects" view (DD-V3-01). | S |
| FR-WF3-02 | Summaries contain server name, action, counts, durations — never file contents, paths outside the edited file, or key data. | M |

---

## 4. Non-functional requirements — `NFR-V3`
| ID | Category | Requirement | Verification |
|---|---|---|---|
| NFR-V3-01 | Traffic | `backgroundMonitoring=false` and Servers tab hidden ⇒ 0 SSH exec/poll traffic (idle connection may close after 60 s). | L3 with fake server counters |
| NFR-V3-02 | Efficiency | Exactly one TCP connection per server shared by all consumers. | L3 fake server connection count |
| NFR-V3-03 | Performance | Parser per sample ≤ 5 ms; poll round trip overhead (excl. network) ≤ 50 ms; UI keeps 60 fps-class responsiveness with 20 servers at 3 s (no long task > 50 ms from metrics updates). | L2 bench, L4 perf trace |
| NFR-V3-04 | Performance | Log stream of 5 000 lines/s for 60 s: UI stays responsive (input latency < 100 ms), memory bounded (≤ 50 000 lines). | L4 |
| NFR-V3-05 | Security | Private keys never in RPC results, logs, DB, webview; key buffers zeroed (unit test with spy). | L2 + secret scan |
| NFR-V3-06 | Security | Host-key mismatch blocks before any command or auth data beyond the handshake is sent. | L3 |
| NFR-V3-07 | Security | Command catalog test: no catalog entry contains `${`, backticks or user-derived concatenation (static test). | L1 |
| NFR-V3-08 | Reliability | Network drop during edit save never leaves a truncated target: either old content or new content, backup present. | L3 fault injection |
| NFR-V3-09 | Usability | en + vi, keyboard operable, status not by colour alone. | L2 a11y, L4 |
| NFR-V3-10 | Maintainability | 100 % branch: `key-vault`, `ssh-connection-machine`, `alert-engine`, `remote-path`, `remote-safe-write`, `remote-commands`; parsers ≥ 95 % branch with fixtures from real hosts. | coverage |

---

## 5. Data requirements
| Table | Columns | Keys | Milestone |
|---|---|---|---|
| `servers` | `id` PK, `name`, `name_lower`, `host`, `port` int, `username`, `os`, `host_key_fingerprint` null, `host_key_type` null, `key_configured` int, `key_has_passphrase` int, `tags` JSON, `created_at`, `updated_at` | unique `name_lower` | M15 |
| `server_actions` | `id` PK, `server_id`, `server_name`, `action`, `requested_at`, `result`, `error_code` null, `message` | idx `(server_id, requested_at)` | M19 |

Files: `<dataDir>/ssh/<serverId>.key.enc`. Keychain: `itstudio-ssh/<serverId>` (data key, base64), `itstudio-ssh-pass/<serverId>` (passphrase). Settings: `AppSettings.monitoring: MonitoringSettings` with defaults from FR-AL-01 and `pollIntervalSeconds 5`, `backgroundMonitoring false`, `osNotifications false`.

---

## 6. External interface requirements (added to `schemas.ts` by the Architect in Mx-00 tasks)

### 6.1 Additive changes
```ts
// §1 ErrorCode — new members
SSH_UNREACHABLE, SSH_AUTH_FAILED, HOST_KEY_UNCONFIRMED, HOST_KEY_MISMATCH, KEY_INVALID,
SUDO_REQUIRED, DOCKER_UNAVAILABLE, REMOTE_FILE_TOO_LARGE, REMOTE_FILE_BINARY
// §12 AppSettings — new field (defaults in domain/default-settings.ts; settings migration fills it)
readonly monitoring: MonitoringSettings;
// §12b WorkflowLane — new member 'infra'; WorkflowModuleId — SSH_MANAGER, METRICS, DOCKER, SFTP, SYSTEM_ACTIONS
// §17 ServerConnectionState — new member REBOOTING: 'rebooting'
// §17 ServerMetricsSample — new optional field: readonly late?: boolean;
// §17 ServerConfig — new optional field: readonly hostKeyType?: string;
```

### 6.2 New types
```ts
export interface ServerInput { name: string; host: string; port: number; username: string; tags: readonly string[] }
export interface HostKeyPrompt { serverId: ServerId; keyType: string; fingerprint: string; firstSeen: boolean; previousFingerprint?: string; expiresAt: IsoDateTime }
export interface RemoteFileContent { path: RemotePath; content: string; sha256: Sha256; eol: 'lf' | 'crlf'; trailingNewline: boolean; sizeBytes: number; modifiedAt: IsoDateTime }
export interface RemoteWriteResult { sha256: Sha256; backupPath: RemotePath | null; sizeBytes: number }
export type TransferId = Brand<string, 'TransferId'>;
export interface TransferProgress { transferId: TransferId; direction: 'upload' | 'download'; bytes: number; totalBytes: number; done: boolean; error?: AppError }
export type ServerActionId = Brand<string, 'ServerActionId'>;
export interface ServerActionRecord { id: ServerActionId; serverId: ServerId; serverName: string; action: SystemAction; requestedAt: IsoDateTime; result: 'ok' | 'failed'; errorCode?: ErrorCode; message: string }
```
(All fields `readonly` in the real file.)

### 6.3 RPC methods (additive)
```ts
// M15
'server.list': { params: Empty; result: readonly ServerConfig[] };
'server.add': { params: { server: ServerInput; keyPath: string; passphrase?: string }; result: ServerConfig };
'server.update': { params: { serverId: ServerId; patch: Partial<ServerInput> & { os?: ServerOs } }; result: ServerConfig };
'server.replaceKey': { params: { serverId: ServerId; keyPath: string; passphrase?: string }; result: ServerConfig };
'server.remove': { params: { serverId: ServerId }; result: { removed: boolean } };
'server.connect': { params: { serverId: ServerId }; result: ServerStatus };            // acquires+releases a 'probe' consumer
'server.statusAll': { params: Empty; result: readonly ServerStatus[] };
'server.confirmHostKey': { params: { serverId: ServerId; fingerprint: string; accept: boolean }; result: ServerStatus };
'server.trustNewHostKey': { params: { serverId: ServerId; fingerprint: string; confirmName: string }; result: ServerStatus };
// M16
'server.watch': { params: { serverIds: readonly ServerId[]; viewId: string }; result: { watching: readonly ServerId[] } };
'server.unwatch': { params: { viewId: string }; result: { watching: readonly ServerId[] } };
'server.history': { params: { serverId: ServerId }; result: readonly ServerMetricsSample[] };
// M17
'docker.list': { params: { serverId: ServerId; all: boolean }; result: readonly ContainerInfo[] };
'docker.inspect': { params: { serverId: ServerId; containerId: ContainerId }; result: { info: ContainerInfo; env: readonly string[]; mounts: readonly string[]; restartCount: number } };
'docker.action': { params: { serverId: ServerId; containerId: ContainerId; action: ContainerAction }; result: ContainerInfo };
'docker.watch': { params: { serverId: ServerId; viewId: string }; result: { watching: boolean } };
'docker.unwatch': { params: { viewId: string }; result: { watching: boolean } };
'docker.logs.open': { params: { serverId: ServerId; containerId: ContainerId; tail: number; follow: boolean; stdout: boolean; stderr: boolean }; result: { streamId: LogStreamId } };
'docker.logs.close': { params: { streamId: LogStreamId }; result: { closed: boolean } };
// M18
'sftp.list': { params: { serverId: ServerId; path: RemotePath }; result: readonly RemoteFileEntry[] };
'sftp.stat': { params: { serverId: ServerId; path: RemotePath }; result: RemoteFileEntry };
'sftp.home': { params: { serverId: ServerId }; result: { path: RemotePath } };
'sftp.read': { params: { serverId: ServerId; path: RemotePath }; result: RemoteFileContent };
'sftp.write': { params: RemoteFileWriteRequest & { eol: 'lf' | 'crlf'; trailingNewline: boolean }; result: RemoteWriteResult };
'sftp.undo': { params: { serverId: ServerId; path: RemotePath }; result: RemoteWriteResult };
'sftp.mkdir': { params: { serverId: ServerId; path: RemotePath }; result: RemoteFileEntry };
'sftp.rename': { params: { serverId: ServerId; from: RemotePath; to: RemotePath }; result: RemoteFileEntry };
'sftp.delete': { params: { serverId: ServerId; path: RemotePath }; result: { deleted: boolean } };
'sftp.upload': { params: { serverId: ServerId; localPath: string; remoteDir: RemotePath; overwrite: boolean }; result: { transferId: TransferId } };
'sftp.download': { params: { serverId: ServerId; path: RemotePath; localPath: string }; result: { transferId: TransferId } };
'sftp.cancelTransfer': { params: { transferId: TransferId }; result: { cancelled: boolean } };
// M19
'server.action': { params: { serverId: ServerId; action: SystemAction; confirmName: string }; result: ServerActionRecord };
'server.listActions': { params: { serverId?: ServerId; limit: number }; result: readonly ServerActionRecord[] };
```

### 6.4 Notifications (additive)
```ts
'server.status': ServerStatus;
'server.hostKeyPrompt': HostKeyPrompt;
'server.metrics': ServerMetricsSample;
'server.alert': ServerAlert;
'docker.changed': { serverId: ServerId };
'docker.log': LogChunk;
'docker.logDropped': { streamId: LogStreamId; droppedBytes: number };
'docker.logClosed': { streamId: LogStreamId; reason: 'closed' | 'container_stopped' | 'disconnected' };
'sftp.progress': TransferProgress;
```

### 6.5 Tauri additions
`@tauri-apps/plugin-dialog` (open: files; save) and `@tauri-apps/plugin-notification`; capabilities grant `dialog:allow-open`, `dialog:allow-save`, `notification:default` to the main window only; CSP unchanged.

---

## 7. Behavioural models

### 7.1 SSH connection state machine (`domain/ssh-connection-machine.ts`, 100 % branch)
```
disconnected ──acquire──► connecting ──handshake ok, key pinned & equal──► online
connecting ──host key unknown──► (prompt) ──accept──► online | ──reject/expire──► disconnected (HOST_KEY_UNCONFIRMED)
connecting ──host key differs──► host_key_mismatch ──trustNewHostKey──► connecting
connecting ──auth fail──► auth_failed ──(replaceKey | update)──► disconnected
connecting | online ──network error/timeout──► offline ──backoff (consumers>0)──► connecting
online ──last release + 60 s idle──► disconnected
online ──reboot action ok──► rebooting ──connect ok──► online | ──10 min──► offline
any ──remove server──► (deleted)
```

### 7.2 Alert engine
Per (server, rule): `inactive → pending(since) → firing → inactive(resolved)`; `pending` returns to `inactive` when the condition breaks before `forSeconds`. Clock injected (`IClock`).

### 7.3 Safe remote write — see FR-FS-03; every step is a `Result`; failure after backup leaves target unchanged or restores from backup, then returns the error with remediation listing the backup path.

---

## 8. Error codes & remediation
| Code | Message | Remediation |
|---|---|---|
| `SSH_UNREACHABLE` | "The server did not respond." | "Check that it is powered on and reachable (Tailscale connected?)." / "Check host and port." |
| `SSH_AUTH_FAILED` | "The server rejected the SSH key." | "Check the username." / "Add the public key to ~/.ssh/authorized_keys." / "Re-enter the passphrase via Replace key." |
| `HOST_KEY_UNCONFIRMED` | "The server's identity was not confirmed." | "Connect again and confirm the fingerprint after verifying it on the server." |
| `HOST_KEY_MISMATCH` | "The server's identity changed. Connection blocked." | "Verify the new fingerprint on the server console." / "If expected (reinstall), choose Trust new key." |
| `KEY_INVALID` | "The private key could not be read." | "Use an OpenSSH or PEM key (ed25519, ECDSA or RSA ≥ 2048)." / "Check the passphrase." |
| `SUDO_REQUIRED` | "The server requires a password for this action." | "Add this line with `sudo visudo`: <line>." |
| `DOCKER_UNAVAILABLE` | "Docker is not available for this user." | "Install Docker CLI 18.09+." / "Add the user to the docker group and reconnect." |
| `REMOTE_FILE_TOO_LARGE` | "File is larger than 5 MB." | "Download it instead." |
| `REMOTE_FILE_BINARY` | "This file is not UTF-8 text." | "Download it instead." |

## 9. Traceability
| Decision | Requirements | Tasks | QA doc |
|---|---|---|---|
| D24 | FR-SV-*, NFR-V3-02 | M15-01…M15-06 | M15-test-cases |
| D25 | FR-MT-06, FR-AL-*, NFR-V3-01 | M16-04, M16-05, M16-07 | M16-test-cases |
| D26 | FR-KV-*, FR-SV-05/06, NFR-V3-05/06 | M15-02, M15-04 | M15-test-cases |
| D27 | FR-FS-03/04/08, NFR-V3-08 | M18-02, M18-05 | M18-test-cases |
| D28 | FR-DK-* | M17-* | M17-test-cases |
| D29 | FR-MT-01…05, FR-SA-01, DD-V3-03/04 | M15-04, M16-01…03, M19-01 | M16/M19-test-cases |
| D30 | (deferred — no requirement) | — | — |

## 10. Acceptance (release v3.0.0)
All M15–M19 exit criteria demonstrated against the fake host **and** one real Linux host (owner's Dell via Tailscale, if available — Q-10); all `M` requirements pass; installers rebuilt, install smoke green (M19-05).

## 11. Open questions
| ID | Question | Needed by | Default |
|---|---|---|---|
| Q-09 | Confirm servers are app-global (not per project), DD-V3-01. | M15-00 | Global |
| Q-10 | Real hosts available for live QA (Dell via Tailscale? a VPS? macOS/Windows hosts?). | M15-QA | Fake host + any real Linux host the owner provides |
| Q-11 | Enable background monitoring by default for the home-lab only? (D25 says off.) | M16 | Off for all |
