# Agent Profile

Agent Profile makes Claude Code repo handoffs trustworthy by launching isolated profile sessions with safe credentials and verifiable session context.

It is a developer workflow layer for people who use Claude Code across multiple repos, roles, accounts, and persona setups. The goal is not to replace Claude Code or become a broad AI platform. The goal is to make one repo handoff clear: which profile was used, which credential set was selected, what session artifacts were rendered, and what can be inspected after the run.

## What it does

- Provides a `myclaude` CLI for profile, auth, render, launch, doctor, daemon, and session commands.
- Ships an Electron desktop app that hosts the local daemon, profile workspace, auth vault, session monitor, provenance views, and persona preview surfaces.
- Models profile context as role, auth profile, project scope, settings, MCP servers, and persona assets such as `CLAUDE.md`, agents, skills, slash commands, and memory seeds.
- Renders per-launch session artifacts for Claude Code instead of relying on shared mutable Claude config.
- Records sessions so users can inspect launch details, drift/provenance, and copy a markdown handoff summary.

## Why this exists

Claude Code is most useful when it has the right tools, credentials, repo context, and instructions. Real developers rarely have just one context:

- Work and personal repos need different Anthropic keys, GitHub tokens, and MCP credentials.
- Backend, frontend, security review, and CI roles need different MCP servers and persona instructions.
- Hand-edited `~/.claude.json`, ad hoc `CLAUDE_CONFIG_DIR` aliases, and shell-exported secrets are brittle.
- Copy-pasted `CLAUDE.md` files drift, and it becomes hard to prove which context produced a result.

Agent Profile treats Claude Code as the execution engine and focuses on the trust loop around it: choose the right context, render it into an isolated session, launch Claude Code, then inspect the session record.

## Core workflow

1. Choose a role and auth profile for the repo task.
2. Render isolated session context: MCP config, settings, helper scripts, and persona files.
3. Launch Claude Code with those rendered paths.
4. Inspect session details, handoff markdown, drift status, and provenance.

## Quick start from a checkout

Prerequisites:

- Node.js 22 or newer.
- pnpm 9.12.0.
- Claude Code installed as `claude` on `PATH` for real launches.
- A working OS secret backend. On Linux, Agent Profile refuses unsafe `basic_text` secret storage unless explicitly overridden for disposable test environments.

Install dependencies and build the CLI:

```sh
pnpm install
pnpm --filter @agent-profile/cli build
node apps/cli/dist/myclaude.js version
```

Run diagnostics:

```sh
node apps/cli/dist/myclaude.js doctor
```

Create an auth profile. This stores the Anthropic secret through the CLI/daemon secret path; the value is not printed back:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | node apps/cli/dist/myclaude.js auth add work --anthropic-mode apiKey --stdin
node apps/cli/dist/myclaude.js auth list
```

Create a project role and select it for the current repo:

```sh
node apps/cli/dist/myclaude.js profile create backend --project
node apps/cli/dist/myclaude.js use backend --auth work
```

Render first, then launch:

```sh
node apps/cli/dist/myclaude.js launch --dry-run --role backend --auth work
node apps/cli/dist/myclaude.js launch --role backend --auth work -- --prompt "Review the current repo"
```

Inspect the resulting session:

```sh
node apps/cli/dist/myclaude.js sessions list
node apps/cli/dist/myclaude.js sessions show <sessionId>
node apps/cli/dist/myclaude.js sessions handoff <sessionId>
```

During development, the desktop app can be started from the workspace:

```sh
pnpm -C apps/desktop start
```

## Architecture overview

- `apps/cli` - the `myclaude` command surface. It can run standalone for local operations or route through the desktop daemon when available.
- `apps/desktop` - Electron Main, Renderer, local daemon, safeStorage-backed credential host, IPC handlers, and the desktop workflow UI.
- `apps/helper` - the small helper binary used by generated session scripts to retrieve secrets from the daemon during a Claude Code run.
- `packages/core` - pure TypeScript profile schema, cascade resolution, fragment expansion, provenance, and secret-reference parsing.
- `packages/secrets` - keychain-backed CRUD and secret resolution policy.
- `packages/session-artifacts` - emits Claude Code runtime files such as `mcp.json`, `settings.json`, `apiKeyHelper.sh`, and `headersHelper.sh`.
- `packages/persona-deployer` - materializes persona assets into the isolated session directory.
- `packages/cli-services` - shared read/write service logic for profiles, auth metadata, sessions, drift, handoff summaries, and daemon status.
- `packages/ipc-protocol` - typed JSON-over-socket protocol for CLI-to-daemon communication.
- `packages/capability` - short-lived capability token primitives.
- `packages/ui` - shared desktop UI components.

## Security and trust

Agent Profile's trust model is intentionally local and explicit:

- Launch/render paths do not mutate Claude Code's user-level or repo-level config. They render effective config into an isolated session directory.
- Profile creation and `myclaude use` intentionally write Agent Profile files such as `.myclaude/roles/<role>.yml`, `.myclaude/role`, and `.myclaude/auth`.
- Secret values are not written into rendered MCP/settings files. Anthropic keys and MCP headers are delivered through helper scripts and daemon/keychain lookups.
- Standalone CLI secret operations use `@napi-rs/keyring`; the desktop daemon uses Electron `safeStorage` and stores encrypted entries under the Agent Profile home directory.
- Renderer code receives auth metadata, not raw secret values. Main owns secret prompts and daemon calls.
- CLI-to-daemon IPC is gated by owner-only socket permissions on POSIX, a per-boot cookie, and a host-owned peer-verification hook wired before handshake decoding.
- Native peer-credential enforcement is not complete yet. The current peer-verification hook is documented as pass-through until `SO_PEERCRED`, `LOCAL_PEEREID`, or Windows named-pipe DACL enforcement is implemented through native bindings.
- Release hardening verifies Electron Fuses. Phase 3 Milestone 1 supports signed and notarized macOS release builds, signed Windows release builds, and unsigned Linux M1 artifacts that are verified as unsigned.

## Roadmap status

Shipped in the current repo:

- CLI profile/auth/render/launch/session/doctor surfaces.
- Electron desktop daemon and GUI workflow.
- Profile, auth, persona, and session artifact model.
- Session handoff summary and drift/provenance inspection paths.
- safeStorage/keychain-backed credential handling.
- IPC cookie authentication plus the wired peer-verification hook.
- Desktop release signing/notarization pipeline for macOS and Windows, with Linux M1 unsigned artifact verification.
- Auto-update staged rollout for packaged macOS and Windows releases, gated by `MYCLAUDE_UPDATES` and release rollout metadata.
- Monorepo workspace detection for the current root-to-package chain, plus a compact desktop `cwd` candidate picker.

Next or deferred:

- Sibling workspace glob expansion and broader monorepo management UX.
- Enterprise mode and managed configuration, deferred until design-partner evidence asks for it.
- Plugin SDK and first-party editor adapters.
- Full telemetry/Sentry, deferred until privacy-safe event taxonomy, opt-in policy, and telemetry gates are complete.

## Documentation

- [Security model](docs/06-security.md)
- [Tech stack](docs/07-tech-stack.md)
- [Roadmap](docs/08-roadmap.md)
- [Open questions](docs/09-open-questions.md)
- [Open-source health metrics](docs/open-source-health-metrics.md)
- [Desktop signing and notarization runbook](docs/release/desktop-signing-notarization.md)
- [Core package README](packages/core/README.md)
- [Secrets package README](packages/secrets/README.md)
- [Session artifacts package README](packages/session-artifacts/README.md)
- [Persona deployer package README](packages/persona-deployer/README.md)

## Contributing and development

Common repo checks:

```sh
pnpm test
pnpm typecheck
pnpm lint
```

Useful desktop commands:

```sh
pnpm -C apps/desktop start
pnpm -C apps/desktop package
pnpm -C apps/desktop verify-fuses -- --strict
```

Useful release verification commands after package/make output exists:

```sh
pnpm -C apps/desktop verify-release -- --platform darwin --arch x64 --require-signature --require-notarization
pnpm -C apps/desktop verify-release -- --platform darwin --arch arm64 --require-signature --require-notarization
pnpm -C apps/desktop verify-release -- --platform win32 --arch x64 --require-signature
pnpm -C apps/desktop verify-release -- --platform linux --arch x64 --unsigned-ok
```
