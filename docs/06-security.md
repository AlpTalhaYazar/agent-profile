# 06 — Security & Threat Model

## TL;DR

Agent Profile handles user credentials (Anthropic API keys, GitHub PATs, database passwords, MCP OAuth tokens) and runs a local IPC daemon that other processes on the machine can try to reach. The design rests on four invariants: (1) secrets live only in the OS keychain and the Electron Main process memory, never on disk or in env vars, never in the Renderer; (2) IPC is gated today by filesystem permissions and a per-boot cookie, with a host-owned peer-verification hook wired before handshake data is read; native `euid` enforcement remains a tracked hardening item; (3) Claude Code receives secrets through helper scripts driven by short-lived capability tokens — not through env vars; (4) release builds are ASAR-verified, use Electron Fuses to disable attack surfaces like `--inspect` and `RunAsNode`, and enforce platform signing/notarization where Phase 3 Milestone 1 supports it.

## Threat model (STRIDE)

| Category | Threat | Control |
|---|---|---|
| **Spoofing** | Another local user connects to the IPC socket | UDS mode `0600` (POSIX); per-boot handshake cookie; peer-verification hook wired before `hello`. Native `euid(peer) == euid(self)` and explicit Windows pipe DACL enforcement are future hardening items. |
| **Spoofing** | A malicious local process running as the same user impersonates the CLI | Handshake cookie regenerated per daemon boot; capability tokens are per-session; Anthropic API key never cached outside Main |
| **Tampering** | Attacker edits ephemeral session files mid-launch | Session dir mode `0600`; content written atomically via temp + rename; session TTL ≤ session lifetime; session records keep rendered paths inspectable |
| **Tampering** | Attacker replaces `~/.myclaude/ipc-cookie` | File is `0600`; rotated on every daemon boot; stale cookie fails handshake |
| **Tampering** | Attacker replaces signed app binary | ASAR integrity + Electron Fuses (`OnlyLoadAppFromAsar=true`); Phase 3 M1 release verification requires macOS signing/notarization and Windows Authenticode signatures; Linux M1 artifacts are explicitly unsigned |
| **Repudiation** | "I never launched a session with those credentials" | Append-only JSONL audit log at `~/.myclaude/audit.log` with timestamped launch, secret access, and config-change rows; SQLite storage and SIEM export are deferred |
| **Info disclosure** | API keys leak via env vars into logs, shell history, process listings | `ANTHROPIC_API_KEY` never exported; `apiKeyHelper.sh` proxies on demand; Main zeros plaintext buffers after encrypting |
| **Info disclosure** | Secrets leak from the Renderer (web content) | `contextIsolation: true`, `nodeIntegration: false`, narrow `contextBridge`; Renderer never receives secret values, only references |
| **Info disclosure** | Third-party MCP server reads the environment of its host process and finds a secret | Per-MCP-server env via `env:` in `mcp.json` — secrets are scoped, not exported to the whole process tree |
| **Info disclosure** | Crash dump contains secrets | Crashpad redaction filters; secret fields tagged in memory to skip serialization |
| **Denial of service** | Malicious process creates infinite session dirs | Per-user session quota (default 256); GC on session end + daily sweep; rate limit on `resolve` calls per minute |
| **Denial of service** | Main daemon hang wedges all launches | CLI times out on IPC in 5s and offers standalone fallback or diagnostics |
| **Elevation of privilege** | Plugin executes arbitrary code in Main's address space | Plugins run in a `vm`/`isolated-vm` sandbox with no `fs`/`net` by default; capability tokens required for every privileged call |
| **Elevation of privilege** | Attacker uses our signed binary as a code-execution proxy (`RunAsNode` attack) | Fuse disabled: `RunAsNode=false`, `EnableNodeCliInspectArguments=false` |

## Credential storage

### Primary (Main, GUI running)

**`safeStorage`** — Electron's built-in OS-backed encryption. Per-platform:

| Platform | Backend | Notes |
|---|---|---|
| macOS | Keychain (ACL-bound to app by Team ID + bundle ID) | Strongest isolation; protected from other apps |
| Windows | DPAPI (user-scoped) | Protected from other users; **not** from other apps running as the same user |
| Linux + GNOME | Secret Service via libsecret | Varies by DE |
| Linux + KDE | Secret Service via kwallet6 | Varies by DE |
| Linux headless | `basic_text` | **Not real protection** — detect and refuse to persist |

`safeStorage.encryptString` is called in Main right after secret intake; the plaintext buffer is then overwritten with zeros. The ciphertext is stored in `~/.myclaude/secrets.enc.json` (mode `0600`) keyed by `secretRef`.

### Fallback (CLI standalone, Main not running)

**`@napi-rs/keyring`** — a modern Rust-based N-API binding to `keyring-rs`, prebuilt binaries for every platform (including aarch64 / Alpine / musl), no `node-gyp` needed. Used when:

- The user is running the CLI on a machine without the GUI installed.
- The Main daemon is unreachable for short-lived operations like `myclaude auth list` (read-only, keyring-only).

Writes are **always** routed through Main when Main is available, so the `safeStorage`-encrypted entries and `@napi-rs/keyring` entries don't drift.

### Why not `keytar`

`atom/node-keytar` was archived 2022-12-15; last release 2022-02. VS Code, Azure Storage Explorer, Element, and Joplin have all migrated off it. (claude-research §2.1.) The project explicitly forbids `keytar` in dependencies.

### Linux fallback behavior

On Linux, `safeStorage.getSelectedStorageBackend()` may return `basic_text` (no libsecret/kwallet). **We refuse to persist secrets in this mode.** On `auth add` in `basic_text` mode, the CLI prints:

```
Error: Linux secret service unavailable (basic_text backend detected).
Refusing to persist secrets unencrypted.
Fix:
  Debian/Ubuntu:  sudo apt install libsecret-1-0 gnome-keyring
  Fedora:         sudo dnf install libsecret
  Arch:           sudo pacman -S libsecret

Alternatively, set MYCLAUDE_ALLOW_PLAINTEXT=1 if you understand the risk
(e.g., CI containers with ephemeral filesystem and no network-accessible
secrets).
```

The `MYCLAUDE_ALLOW_PLAINTEXT` escape hatch is deliberately verbose. The CLI still refuses to operate with real Anthropic API keys under it; it's intended for testing with dummy credentials.

## IPC authentication

The current daemon has two enforced layers plus a host-owned peer-verification hook:

### 1. Filesystem permissions

- POSIX UDS path: `$XDG_RUNTIME_DIR/myclaude.sock`, mode `0600`, owned by the user.
- Fallback on macOS where `$XDG_RUNTIME_DIR` is rarely set: `/tmp/myclaude-<uid>.sock`, mode `0600`, owner-only.
- Windows Named Pipe: the path is per-user named; explicit DACL enforcement is tracked with the native peer-auth work.

### 2. Peer-verification hook

On `accept`, `DaemonServer` runs the desktop-owned `verifyPeer(socket)` hook before it creates the handshake decoder. If the hook returns `{ ok: false }` or throws, the socket is closed before any protocol frame is processed. As of this milestone, `verifyPeer` is a documented pass-through because Node does not expose `SO_PEERCRED` (Linux), `LOCAL_PEEREID` (macOS), or the Win32 equivalent without a native binding.

### 3. Handshake cookie

A 32-byte random cookie is generated on every daemon boot and written to `~/.myclaude/ipc-cookie` (mode `0600`). The CLI reads this file and sends it as the first message. Main compares against the in-memory cookie and closes on mismatch.

Current enforcement means an attacker must reach the socket and present the per-boot cookie. On POSIX, owner-only socket permissions are the different-user barrier; true OS peer-credential enforcement remains tracked in [`09-open-questions.md`](09-open-questions.md).

## Capability tokens

After `resolve`, Main returns a capability token:

```
HMAC-SHA256(
  key = perDaemonSigningKey,
  msg = { sessionId, authProfileId, pid, expiresAt }
)
```

- Signing key regenerated on daemon boot; never persisted.
- `expiresAt` = 60s for `session.start`, extended to session lifetime for `secret.get`.
- Revoked on `session.end` or `auth.rotate`.
- Carried in `MYCLAUDE_CAPABILITY_TOKEN` env var to helper scripts (which authenticate to Main, receive a secret, exit).

The token is useless without Main running (no offline forgery possible because the signing key lives only in Main's memory).

## Secret delivery to Claude Code

Anthropic API keys and MCP secrets reach `claude` through two mechanisms.

### `apiKeyHelper`

Generated per session by the artifact emitter:

```sh
# ~/.myclaude/sessions/<uuid>/apiKeyHelper.sh
#!/bin/sh
exec myclaude-helper anthropic "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN"
```

The shell script is only a wrapper. `myclaude-helper` is a small binary (separate from the main CLI) that only knows how to:

1. Read `$MYCLAUDE_SESSION_ID` and `$MYCLAUDE_CAPABILITY_TOKEN` from env (set by `myclaude launch` when spawning `claude`).
2. Connect to Main over the socket.
3. Send `secret.get { capabilityToken, name: "anthropic" }`.
4. Write the returned secret to stdout.
5. Exit 0.

Claude Code invokes `apiKeyHelper` when it needs the API key — usually once per session, sometimes on token refresh. The plaintext key exists briefly in stdout / stdin pipes and `claude`'s memory; never in env vars, never on disk.

Referenced from the rendered `settings.json`:

```json
{ "apiKeyHelper": "/Users/.../sessions/<uuid>/apiKeyHelper.sh" }
```

### `headersHelper`

Identical mechanism for remote HTTP MCP servers that need short-lived OAuth tokens:

```sh
# sessions/<uuid>/headersHelper.sh
#!/bin/sh
exec myclaude-helper mcp-headers "$MYCLAUDE_SESSION_ID" "$MYCLAUDE_CAPABILITY_TOKEN" "$1"
# $1 is the MCP server name; Main returns the appropriate headers
```

Claude Code's MCP client calls this at connection time. As with `apiKeyHelper.sh`, the script only delegates to `myclaude-helper`; it does not contain token material. (chatgpt-research §1.)

### What's *not* injected via env

The project explicitly rejects `ANTHROPIC_API_KEY=... claude ...` as an injection mechanism because:

- The key appears in `ps aux` / `/proc/<pid>/environ` on Linux, readable by the same-user attacker.
- Subprocess inheritance leaks it to any MCP server `claude` spawns.
- Shell history / logging middleware can capture it.

## Supply chain

### Electron Fuses

The app ships with these fuses flipped via `@electron/fuses`:

| Fuse | Value | Rationale |
|---|---|---|
| `RunAsNode` | `false` | Prevents using the signed binary as a generic Node runtime |
| `EnableCookieEncryption` | `true` | Standard hardening |
| `EnableNodeOptionsEnvironmentVariable` | `false` | Ignore `NODE_OPTIONS=--inspect` at runtime |
| `EnableNodeCliInspectArguments` | `false` | Ignore `--inspect` CLI flags to the packaged binary |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | Verify ASAR hash at load |
| `OnlyLoadAppFromAsar` | `true` | Refuse to load app resources from disk outside ASAR |

A CI job verifies every build has these values; a build without them fails to ship.

### Code signing and release verification

Phase 3 Milestone 1 ships the first release-signing pipeline. Forge release
signing is gated by `AGENT_PROFILE_RELEASE=1`; local development packaging can
run without release credentials.

| Platform | Phase 3 M1 behavior | Verification command |
|---|---|---|
| macOS `x64` | ZIP + DMG; Developer ID signed and notarized via App Store Connect API key | `pnpm -C apps/desktop verify-release -- --platform darwin --arch x64 --require-signature --require-notarization` |
| macOS `arm64` | ZIP + DMG; Developer ID signed and notarized via App Store Connect API key | `pnpm -C apps/desktop verify-release -- --platform darwin --arch arm64 --require-signature --require-notarization` |
| Windows `x64` | Squirrel installer; Authenticode signing via PFX or HSM/custom `signtool` params | `pnpm -C apps/desktop verify-release -- --platform win32 --arch x64 --require-signature` |
| Linux `x64` | deb, rpm, and ZIP; unsigned in M1 | `pnpm -C apps/desktop verify-release -- --platform linux --arch x64 --unsigned-ok` |

The verifier also runs the strict Electron Fuses check before platform-specific
signature checks. There is no AppImage maker in M1, and Linux GPG signing is
not implemented in this milestone.

Release workflow signing inputs are documented in
[`release/desktop-signing-notarization.md`](release/desktop-signing-notarization.md).

### Auto-update

Phase 3 Milestone 2 ships packaged-release auto-update checks for macOS and
Windows through Electron Forge's public GitHub update path
(`update.electronjs.org`). The app does not use `electron-updater` in this
milestone because the current Windows maker is Squirrel.Windows, while
`electron-updater`'s simplified Windows path expects electron-builder metadata
and does not support Squirrel.Windows.

Auto-update checks are disabled when `MYCLAUDE_UPDATES=0`, in dev/test/Vitest,
for unpackaged builds, on Linux, and during Windows `--squirrel-firstrun`.
Headless daemon mode also defaults to disabled unless `MYCLAUDE_UPDATES=1` is
set explicitly.

Staged rollout is client-side. The release publishes
`agent-profile-rollout.json` with `{ version, channel: "stable",
stagingPercentage }`; Main stores a random local install id under Electron's
user data directory, hashes it with the target version, and only starts the
updater when the bucket is within the rollout percentage. The id is random and
local-only; it is not derived from machine ids, usernames, repo paths, profile
ids, session ids, or secret data.

This milestone does not claim signed update metadata. There are no signed
`latest.yml` files in the current Forge pipeline. Trust rests on HTTPS, GitHub
Release permissions, and signed/notarized application artifacts for supported
platforms. Linux auto-update remains deferred to a future signed Linux
distribution strategy.

## Audit log

The current runtime writes an append-only JSONL log at
`~/.myclaude/audit.log` (mode `0600`). The daemon appends one row per
security-relevant write:

| Row kind | Current fields | Notes |
|---|---|---|
| `launch` | `ts`, `sessionId`, `event`, `spawnPid`, optional `role`, `authProfileId`, `cwd`, `relaunchedFrom` | Records session start/end/kill lifecycle events. |
| `secret_access` | `ts`, `sessionId`, `secretName`, `callerPid`, `capabilityValid`, optional `reason` | Records helper secret reads by logical name only, never by value. |
| `config_change` | `ts`, `actionKind`, `actor`, `target`, optional `diffSha256` | Records auth/setup metadata mutations. `diffSha256` is reserved and currently `null` for auth writes. |

The log never contains secret values, raw tokens, or plaintext credential
material. SQLite storage at `~/.myclaude/audit.sqlite`, retention policy, and
`myclaude audit export --since ...` for SIEM ingestion are deferred enterprise
or compliance capabilities. They should not be implemented until a named
design-partner organization or compliance owner needs managed audit export and
the managed-configuration design is written first.

## Known limits

- **Same-user attacks on shared machines**: If a user leaves a workstation unlocked, another person with that user's shell can impersonate them. Agent Profile does not defend against session takeover; use OS lock / short idle timeouts.
- **Windows DPAPI scope**: DPAPI protects against *other users*, not *other apps running as the same user*. A malicious tool installed in the user's context can read DPAPI-encrypted blobs. This is an OS-level limit, same for VS Code and every other app.
- **CI runners**: `safeStorage` on `basic_text` mode is rejected by default. For CI, the recommended pattern is to inject secrets via the runner's own vault (GitHub Actions Secrets, Azure Key Vault, 1Password Connect) and let `myclaude` read them via `${env:...}` references that the runner set temporarily.
- **MCP server trust**: An MCP server is running code. We scope its env to just what it needs, but if it's actively malicious it can exfiltrate session data. Users should vet MCP servers the same way they vet npm packages.

## Related documents

- Where the architecture forces these boundaries: [`02-architecture.md#trust-boundaries`](02-architecture.md)
- Protocol details for IPC: [`05-gui-spec.md`](05-gui-spec.md)
- Tech choices backing the security model: [`07-tech-stack.md`](07-tech-stack.md)
