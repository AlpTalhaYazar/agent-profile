# 08 — Roadmap

## TL;DR

Four phases over roughly six months: Phase 0 (prototype, 1–2 weeks) proves the cascade against Claude Code; Phase 1 (CLI Core, 6–8 weeks) ships a headless `myclaude` that fully launches sessions with correct `--mcp-config` isolation and keychain-backed secrets; Phase 2 (Electron GUI + Daemon, 8–10 weeks) adds the GUI, IPC daemon, and `safeStorage`; Phase 3 (Hardening & Distribution, 6–8 weeks) signs, notarizes, ships auto-update, handles monorepo edge cases, and gates plugin SDK or enterprise work on core handoff signal. The first public release target is end of Phase 2; GA is end of Phase 3.

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
   - [x] Keyboard navigation (skip link, command palette, scope tree
     arrows, screen shortcuts, Escape/focus restoration)
   - [x] Dark/light mode and reduced-motion checklist coverage
   - [x] First-run wizard that creates the setup marker and walks through
     adding a first Claude credential
   - [x] Accessibility pass (landmarks, headings, status live region,
     manual VoiceOver/contrast checklist)
   - [x] Packaged-app Phase 2 e2e hardening for auth add/rotate and
     session launch/kill

   **Status:** Shipped on `main` (2026-05-03). See [`impl/phase-2-sprint-7-polish-first-run.md`](impl/phase-2-sprint-7-polish-first-run.md).

### Exit criteria

- **GUI/runtime beta readiness:** closed on `main` by Phase 2 milestones 1-7.
  Evidence spans the desktop e2e suite: profile edit/save/reload, auth add
  and rotate, session monitor actions, packaged-app launch/kill runtime,
  provenance inspection, persona preview, first-run, keyboard navigation,
  accessibility checks, and visual contract coverage.
- **Credential migration:** closed by milestone 3; one-way standalone →
  daemon migration is recorded in
  [`impl/phase-2-sprint-3-credential-migration.md`](impl/phase-2-sprint-3-credential-migration.md)
  and ADR 002.
- **Capability-token/runtime path:** covered by the Phase 1 launch work,
  Phase 2 daemon/session milestones, and the packaged-app live-session e2e
  hardening.
- **Distribution/signing gate:** not a Phase 2 closeout item. Phase 3
  Milestone 1 closes macOS signing/notarization, Windows Authenticode signing,
  unsigned Linux M1 artifact verification, Electron Fuse verification, and
  draft-release publishing.

## Phase 3 — Hardening & Distribution

**Duration:** 6–8 weeks
**Owner:** 2 engineers + DevOps
**Goal:** General availability. Signed and notarized macOS builds, signed
Windows builds, verified Linux distribution artifacts, auto-update, monorepo
support, and explicit gates for enterprise mode and plugin SDK.

Telemetry and crash-reporting work is gated by the privacy-safe taxonomy in
[`open-source-health-metrics.md`](open-source-health-metrics.md). Until that
taxonomy, consent copy, redaction tests, and kill-switch tests are complete,
Phase 3 measurement stays local-only or GitHub-derived.

### Milestones

1. **Signing & notarization pipelines (week 1–2)**
   - [x] Apple Developer ID + `@electron/notarize` via App Store Connect API key in CI
   - [x] Windows Authenticode via PFX or HSM/custom `signtool` parameters
   - [x] Linux M1 deb/rpm/ZIP artifacts verified as unsigned; Linux GPG/AppImage deferred
   - [x] CI verifier refuses missing macOS/Windows signatures, missing macOS notarization, missing artifacts, or incorrect Electron Fuses

   **Status:** Shipped on `main` (2026-05-03). Release CI lives in
   [`.github/workflows/release-desktop.yml`](../.github/workflows/release-desktop.yml);
   baseline CI lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml);
   artifact verification lives in
   [`apps/desktop/scripts/verify-release-artifacts.mjs`](../apps/desktop/scripts/verify-release-artifacts.mjs).
   Maintainer operations are documented in
   [`release/desktop-signing-notarization.md`](release/desktop-signing-notarization.md).

2. **Auto-update with staged rollouts (week 2–3)**
   - [x] Forge-native macOS/Windows auto-update checks through
     `update.electronjs.org` for packaged release builds
   - [x] Explicit kill switch (`MYCLAUDE_UPDATES=0`), dev/test/package gates,
     headless default-off behavior, and Windows Squirrel first-run skip
   - [x] Deterministic local staged rollout from
     `agent-profile-rollout.json` (`stagingPercentage: 5` → `25` → `100`)
   - [x] Release verifier checks macOS updater ZIP and Windows Squirrel
     `RELEASES`/`.nupkg` metadata before publishing
   - [ ] Signed `latest.yml` / electron-builder metadata is not part of the
     current Forge path; Linux auto-update remains deferred

3. **Monorepo support (week 3–4)**
   - [x] Manual `pnpm-workspace.yaml` / `nx.json` / `turbo.json` /
     `lerna.json` / `rush.json` / `package.json#workspaces` / git fallback
     detection
   - [x] Project chain resolution stays root → deepest package for `.myclaude`
     layers
   - [x] UI: compact desktop picker for "which workspace should `cwd` count
     as?"
   - [x] Temp test repo fixture with nested package levels

   **Status:** Shipped on `main` (2026-05-04). V1 detects the current
   root-to-`cwd` candidate chain; sibling workspace glob expansion remains
   deferred.

4. **Enterprise mode gate (week 4–5)**
   - Confirm whether any design-partner organization needs managed config or audit export
   - Keep `managed-mcp.json`, MDM-deployed `global-shared`, SIEM export, and `MYCLAUDE_ENTERPRISE=1` deferred without that signal
   - If signal exists, write the managed-configuration design before implementation

5. **Error recovery & telemetry gates (week 5–6)**
   - Privacy-safe event taxonomy and opt-in policy reviewed before any telemetry SDK
   - No Crashpad, Sentry, PostHog, or network upload until redaction tests and kill switches pass
   - `myclaude doctor` with every known failure mode mapped to a fix suggestion
   - Partial-write recovery for all on-disk state (journal + atomic rename, Windows retry loop)

6. **Plugin SDK gate (week 6–8)**
   - Start only if core handoff usage or agent-builder demand justifies platform expansion
   - If the gate opens, design the stable TypeScript API, sandbox model, SDK docs, and sample plugin before implementation
   - Otherwise continue core handoff, reliability, auto-update, or monorepo work

### Exit criteria

- Signed/notarized macOS builds, signed Windows builds, verified Linux
  distribution artifacts, and auto-update support for the platforms that
  support signed update metadata.
- One design-partner organization running the build in production for 4 weeks without a P0 incident.
- Plugin SDK either remains deferred behind core handoff usage signal or ships with at least one third-party adapter in existence.
- Full telemetry/Sentry remains deferred unless the privacy-safe event taxonomy, consent copy, redaction tests, and kill-switch tests are complete.
- Homebrew + Windows Package Manager + apt/yum repos live.

## Non-goals (first release)

These are deliberately excluded from Phase 0 through Phase 3. They may land in v2+.

- **Claude.ai OAuth login switching.** Anthropic's documented position is that third-party tools should use API keys. Agent Profile's "auth profiles" model API keys and cloud credentials, not Claude.ai subscription logins. (chatgpt-research §2.)
- **Team / org profile registry.** No git-tracked public "profile hub" or cloud-synced team registry in v1. Teams can commit `<repo>/.myclaude/` and share that way.
- **MCP proxy gateway.** Gemini-research's in-memory proxy architecture is deferred to v2. Conditions for revisit in [`09-open-questions.md`](09-open-questions.md) item 6.
- **Web UI.** Electron desktop only. No browser-hosted variant.
- **VS Code / Cursor / Cline / Goose adapters.** Shipped only if the Phase 3 plugin SDK gate opens; no first-party adapters in v1.
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
