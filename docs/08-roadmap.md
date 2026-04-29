# 08 — Roadmap

## TL;DR

Four phases over roughly six months: Phase 0 (prototype, 1–2 weeks) proves the cascade against Claude Code; Phase 1 (CLI Core, 6–8 weeks) ships a headless `myclaude` that fully launches sessions with correct `--mcp-config` isolation and keychain-backed secrets; Phase 2 (Electron GUI + Daemon, 8–10 weeks) adds the GUI, IPC daemon, and `safeStorage`; Phase 3 (Hardening & Distribution, 6–8 weeks) signs, notarizes, ships auto-update, handles monorepo edge cases, and adds the plugin SDK. The first public release target is end of Phase 2; GA is end of Phase 3.

## Phase 0 — Discovery & Prototype

**Duration:** 1–2 weeks
**Owner:** 1 engineer
**Goal:** Validate that the proposed architecture actually works against the current `claude` binary and expose assumptions that would derail Phase 1.

### Deliverables

1. **Throwaway Node.js script** that:
   - Reads a hardcoded `global-shared` + `global-role/backend` YAML pair.
   - Merges them with defu.
   - Writes `/tmp/proto-session/mcp.json`, `settings.json`, `CLAUDE.md`.
   - Spawns `claude --mcp-config ... --settings ...` with `CLAUDE_CONFIG_DIR=/tmp/proto-session/.claude`.
   - Proves the MCP servers load, settings apply, and CLAUDE.md is seen.
2. **Concurrency smoke test:** Spawn 10 parallel prototype sessions against the same project, each with its own session dir. Verify no `.claude.json` corruption by checksumming after 5 minutes of tool activity.
3. **Spike on `apiKeyHelper`:** Confirm Claude Code invokes it at the documented points and that it can return a secret not present in the env.
4. **Short written report (< 1 page):** What worked, what surprised us, any new items for `09-open-questions.md`.

### Exit criteria

- Every deliverable above complete.
- At most 2 new items in open questions.
- No discovered blockers to the Phase 1 design.

## Phase 1 — CLI Core

**Duration:** 6–8 weeks
**Owner:** 1 senior engineer full-time
**Goal:** A production-quality, headless `myclaude` that covers launch, profile management, auth, render, doctor. No GUI, no IPC daemon — standalone CLI with direct `@napi-rs/keyring` access.

### Sprint breakdown (2-week sprints)

| Sprint | Focus | Deliverable |
|---|---|---|
| **1** | Monorepo scaffold + core types | pnpm workspace; `packages/core` exports `ScopeDoc`, `EffectiveSessionConfig`; CI lint + typecheck + Vitest |
| **1–2** | Config store + merge engine | Read/parse YAML with source tracking; defu-based cascade with per-key policies; Zod validation; `myclaude profile show --role X --provenance` |
| **3** | Fragments + secret refs | Fragment expansion; `${secret:...}`, `${env:...}`, `keyring://...` placeholder resolution with mock keychain |
| **3–4** | Secrets package | `@napi-rs/keyring` adapter; `${secret:...}` / `${env:...}` / `keyring://...` resolver; Linux `basic_text` refusal |
| **4** | CLI auth + resolve preview | `myclaude auth add/list/set/rotate/remove`; `render --resolve-secrets`; keychain diagnostics |
| **5** | Persona deployer | `packages/persona-deployer`: CLAUDE.md concat with source markers; agents/skills/commands copy; memory seed; overwrite semantics on filename collision |
| **6** | Session artifacts | `packages/session-artifacts`: emit `mcp.json`, `settings.json`, helper wrapper scripts, and runtime paths; no secrets, spawn, or launch orchestration |
| **7** | Helper binary | `apps/helper`: `myclaude-helper` contract used by `apiKeyHelper.sh` and `headersHelper.sh`; no `claude` spawn |
| **8** | Launch + activation | `myclaude launch`, `use`, `unuse`; activation files/env/defaults; PTY spawn, session cleanup/retain, and dry-run wiring |

### Exit criteria

- A developer runs `myclaude auth add work`, `myclaude auth add personal`, defines `backend` + `frontend` role YAMLs, then runs `myclaude launch --role backend --auth work` and `myclaude launch --role frontend --auth personal` in parallel terminals. Both sessions work, no `.claude.json` corruption, correct MCP + persona.
- All Zod schemas stable and committed. Any field rename in Phase 2 requires a schema migration doc.
- Test coverage ≥ 80% on `packages/core` and `packages/secrets`.
- Linux + macOS + Windows smoke tests all pass in CI.

### Risks

- **Claude Code version drift.** If `claude` v2.2.x changes `--mcp-config` semantics, our cascade tests break. Mitigation: pin a tested minor in CI, test against `latest` in a separate nightly job.
- **`node-pty` build issues on Windows.** Mitigation: use `@lydell/node-pty` prebuilt fork; ship prebuilt for Windows on CI.
- **Secret resolution ordering.** If a `${secret:...}` is resolved too late (after some consumer reads it raw), it leaks. Mitigation: the cascade algorithm has explicit phases; a linter test asserts secrets are never read before phase 5.

## Phase 2 — Electron GUI + Daemon

**Duration:** 8–10 weeks
**Owner:** 2 engineers (1 Main, 1 Renderer)
**Goal:** The Electron app ships as a public beta. It exposes the CLI's functionality visually, holds `safeStorage`-encrypted credentials, and serves the CLI over IPC so the CLI can become a daemon client.

### Milestones

1. **Scaffold & hardening (week 1–2)**
   - Electron Forge + `plugin-vite` + `plugin-fuses`
   - `contextIsolation: true`, `nodeIntegration: false`
   - Narrow `contextBridge` API; sender-frame validation on every handler
   - CI verifies fuses are set on every build

   **Status:** Foundation shipped on `feat/phase-2-foundation` (2026-04-28). See [`impl/phase-2-sprint-1-desktop-scaffold.md`](impl/phase-2-sprint-1-desktop-scaffold.md).

2. **IPC daemon (week 2–3)**
   - `packages/ipc-protocol` with typed `Req`/`Resp`
   - UDS / Named Pipe server in Main with `euid` check + cookie handshake
   - `daemon start/stop/status` in CLI
   - Refactor Phase 1 CLI to talk to daemon when available, fall back to standalone otherwise
   - Capability token issuance

   **Status:** Foundation shipped on `feat/phase-2-foundation` (2026-04-28). Read-mostly surface (`auth.list`, `auth.get-secret-ref`, `profile.show`, `sessions.list`, `daemon.{status,stop}`); writes (`auth.add`, `profile.save`, `session.start`, `secret.get`) deferred to milestone 3+. See [`impl/phase-2-sprint-2-ipc-daemon.md`](impl/phase-2-sprint-2-ipc-daemon.md).

3. **Credential migration (week 3–4)**
   - `safeStorage` adapter in Main
   - Migration flow from standalone `@napi-rs/keyring` entries to `safeStorage` on first daemon startup
   - `myclaude-helper` binary that reads `MYCLAUDE_CAPABILITY_TOKEN` and fetches secrets over IPC

   **Status:** Shipped on `feat/phase-2-foundation` (2026-04-28). Write-side
   daemon kinds (`auth.{add,setSecret,rotate,remove}`, `session.{start,end}`,
   `secret.get`, `secrets.migrate`); `SafeStorageStore` with idempotent
   keyring → safeStorage migrator (one-way per ADR 002); helper IPC client
   with standalone fallback; JSONL audit log. Existing `auth/{add,set,rotate,remove}`
   CLI commands not yet refactored onto the transport (deferred — see sprint
   plan). See [`impl/phase-2-sprint-3-credential-migration.md`](impl/phase-2-sprint-3-credential-migration.md)
   and [`adr/002-safestorage-migration-direction.md`](adr/002-safestorage-migration-direction.md).

4. **Profile Editor (week 4–6)**
   - Scope tree (Jotai atoms) and editor panel
   - Transport-discriminated server forms
   - Live Zod validation
   - Diff preview (effective config delta)
   - Monaco JSON escape hatch

   **Status:** Shipped on `feat/phase-2-foundation` (2026-04-28). M3
   deferrals closed first: auth writes route through transport, launch is
   daemon-aware, and `secret.get` is session/auth-profile bound. The Renderer
   now ships Profile Explorer + Profile Editor through the
   Renderer → Main → Daemon path; `profile.{list,validate,preview,save}` are
   daemon protocol kinds; Playwright `_electron` smoke covers edit/save/reload.
   See [`impl/phase-2-sprint-4-profile-editor.md`](impl/phase-2-sprint-4-profile-editor.md)
   and [`adr/003-renderer-main-daemon-path.md`](adr/003-renderer-main-daemon-path.md).

5. **Auth Vault + Session Monitor (week 6–7)** — *Status: shipped on `feat/phase-2-foundation` (2026-04-29)*
   - [x] Auth CRUD with masked inputs (Renderer modal for set/rotate; Main native child window for `auth.add` plaintext)
   - [x] Session list with live updates (daemon `sessions.event` push channel; Renderer falls back to polling on disconnect)
   - [x] Kill, relaunch, drift detection (daemon handlers + CLI subcommands + Renderer Session Monitor actions)
   See [`impl/phase-2-sprint-5-auth-vault-session-monitor.md`](impl/phase-2-sprint-5-auth-vault-session-monitor.md)
   and [`adr/004-session-event-subscription.md`](adr/004-session-event-subscription.md).

6. **Provenance Inspector + Persona Composer (week 7–8)** — *Status: shipped on `feat/phase-2-foundation` (2026-04-29)*
   - [x] Per-field provenance chain view (mcpServers / env / settings / persona; chain table, suppressedBy + overriddenFields surfaces, redactText on values)
   - [x] Persona preview (rendered CLAUDE.md combined + per-section breakdown, agents/skills/slashCmds/memory catalog, in-memory render via new `persona.render` IPC kind, no disk write)
   See [`impl/phase-2-sprint-6-provenance-persona.md`](impl/phase-2-sprint-6-provenance-persona.md)
   and [`adr/005-persona-render-in-memory.md`](adr/005-persona-render-in-memory.md).

7. **Polish + first-run flow (week 9–10)**
   - Keyboard navigation (Radix)
   - Dark/light mode
   - First-run wizard that creates `~/.myclaude/` and walks through adding a first auth profile
   - Accessibility pass (screen reader labels, focus order)

### Exit criteria

- Every CLI capability reachable from the GUI.
- Credential migration works one-way from standalone → daemon and preserves all entries.
- Capability tokens expire on schedule; lab test attempts reuse after expiry and is rejected.
- E2E Playwright suite covers: add auth, edit role, launch session, kill session, rotate secret.
- Beta release: signed + notarized builds for macOS (x64 + arm64) and Windows (x64); Linux unsigned AppImage.

## Phase 3 — Hardening & Distribution

**Duration:** 6–8 weeks
**Owner:** 2 engineers + DevOps
**Goal:** General availability. Signed, notarized, auto-updating builds on all three OSes. Monorepo support, enterprise mode, plugin SDK.

### Milestones

1. **Signing & notarization pipelines (week 1–2)**
   - Apple Developer ID + `@electron/notarize` via App Store Connect API key in CI
   - Windows Trusted Signing or EV-HSM Authenticode
   - Linux GPG for AppImage; deb/rpm signatures
   - CI job that refuses builds missing any signature or fuse

2. **Auto-update with staged rollouts (week 2–3)**
   - `electron-updater` on GitHub Releases
   - Signed `latest.yml`
   - Monotonic version enforcement; downgrade-attack smoke tests
   - Rollout percentages (`stagingPercentage: 5` → `25` → `100`)

3. **Monorepo support (week 3–4)**
   - `identify-monorepo-root` + pnpm-workspace / turbo / nx / lerna detection
   - Project chain resolution (root → deepest package)
   - UI: picker for "which workspace should `cwd` count as?"
   - Test repo with 3 levels of nested packages

4. **Enterprise mode (week 4–5)**
   - Detect `managed-mcp.json` and gracefully degrade to read-only
   - MDM-deployed `global-shared` scope (IT-controlled)
   - Audit log export to syslog / JSONL / SIEM
   - `MYCLAUDE_ENTERPRISE=1` mode that forbids keychain bypass

5. **Error recovery & telemetry (week 5–6)**
   - Crashpad with redaction filters
   - Opt-in Sentry integration (respect `DO_NOT_TRACK`)
   - `myclaude doctor` with every known failure mode mapped to a fix suggestion
   - Partial-write recovery for all on-disk state (journal + atomic rename, Windows retry loop)

6. **Plugin SDK (week 6–8)**
   - Stable TypeScript API for third-party:
     - MCP client adapters (VS Code, Cursor, Cline, Goose)
     - Custom secret backends (Vault, AWS Secrets Manager, 1Password CLI)
     - Role-activation hooks (run a script on `use`/`launch`)
   - Plugin sandbox via `vm` or `isolated-vm`, no `fs`/`net` by default
   - SDK docs + sample plugin (VS Code adapter) as working reference

### Exit criteria

- Signed, notarized, auto-updating builds on macOS/Windows/Linux (x64 + arm64 where applicable).
- One design-partner organization running the build in production for 4 weeks without a P0 incident.
- Plugin SDK published; at least one third-party adapter in existence.
- Homebrew + Windows Package Manager + apt/yum repos live.

## Non-goals (first release)

These are deliberately excluded from Phase 0 through Phase 3. They may land in v2+.

- **Claude.ai OAuth login switching.** Anthropic's documented position is that third-party tools should use API keys. Agent Profile's "auth profiles" model API keys and cloud credentials, not Claude.ai subscription logins. (chatgpt-research §2.)
- **Team / org profile registry.** No git-tracked public "profile hub" or cloud-synced team registry in v1. Teams can commit `<repo>/.myclaude/` and share that way.
- **MCP proxy gateway.** Gemini-research's in-memory proxy architecture is deferred to v2. Conditions for revisit in [`09-open-questions.md`](09-open-questions.md) item 6.
- **Web UI.** Electron desktop only. No browser-hosted variant.
- **VS Code / Cursor / Cline / Goose adapters.** Shipped through the Phase 3 plugin SDK; no first-party adapters in v1.
- **Background scheduled launches.** Agent Profile does not install system services, launchd agents, or scheduled jobs. `myclaude launch` is always user-initiated or wrapped by the user in their own scheduler.

## Gantt view

```
Phase 0 ▓▓                                              (w1–2)
Phase 1   ▓▓▓▓▓▓▓▓                                      (w3–10)
Phase 2           ▓▓▓▓▓▓▓▓▓▓                            (w11–20)
Phase 3                     ▓▓▓▓▓▓▓▓                    (w21–28)
Public beta                  ↑ end of Phase 2
GA                                          ↑ end of Phase 3
```

## Related documents

- What each phase actually builds: [`02-architecture.md`](02-architecture.md), [`03-profile-schema.md`](03-profile-schema.md), [`04-cli-spec.md`](04-cli-spec.md), [`05-gui-spec.md`](05-gui-spec.md)
- Security guarantees that each phase must not break: [`06-security.md`](06-security.md)
- Library choices for each phase's implementation: [`07-tech-stack.md`](07-tech-stack.md)
- Open trade-offs that could re-scope phases: [`09-open-questions.md`](09-open-questions.md)
